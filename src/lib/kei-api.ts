// KEI API client — HTTP calls only, no prompt logic.
// All ai_design prompts live in src/features/ai-design/prompts.ts

const BASE_URL = "https://api.kie.ai";
const API_KEY = process.env.KEI_API_KEY!;

// Re-export prompt types and builder so existing importers don't break
export type { RefinementImage, RefinementInfo } from "@/features/ai-design/prompts";
export { buildTattooPrompt } from "@/features/ai-design/prompts";

export interface KeiTaskResult {
  status: "pending" | "processing" | "success" | "failed";
  imageUrl?: string;
  failMsg?: string;
  failCode?: string | number;
}

// Thrown when KEI rejects a task because the account is out of credits / balance.
// This is a hard stop, not a transient error — callers must NOT retry.
export class KeiCreditsError extends Error {
  constructor(public readonly detail: string) {
    super(`KEI insufficient credits: ${detail}`);
    this.name = "KeiCreditsError";
  }
}

// Matches the various ways KEI signals an exhausted balance. Kept narrow so it
// only catches credit/quota issues, not unrelated failures.
const CREDITS_PATTERN = /insufficient|not enough|no\s+credit|out of credit|credit|balance|quota|arrears|payment required/i;

function isCreditsMessage(msg: string): boolean {
  return CREDITS_PATTERN.test(msg);
}

export type KeiModel = "gpt-image-2-image-to-image" | "nano-banana-pro";

export interface CreateKeiTaskOptions {
  model?: KeiModel;
}

export async function createKeiTask(
  prompt: string,
  inputUrls: string[],
  options: CreateKeiTaskOptions = {}
): Promise<string> {
  const model = options.model ?? "gpt-image-2-image-to-image";

  // nano-banana-pro (Gemini 3 Pro Image) uses `image_input`; gpt-image uses `input_urls`.
  const input =
    model === "nano-banana-pro"
      ? {
          prompt,
          image_input: inputUrls,
          aspect_ratio: "1:1",
          resolution: "1K",
          output_format: "png",
        }
      : { prompt, input_urls: inputUrls, aspect_ratio: "1:1", resolution: "1K" };

  const body = { model, input };

  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/jobs/createTask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
      });

      if (res.status >= 500) {
        const text = await res.text().catch(() => "");
        throw new Error(`KEI createTask HTTP ${res.status}: ${text.slice(0, 150)}`);
      }

      // Payment Required — account is out of credits. Hard stop, never retry.
      if (res.status === 402) {
        const text = await res.text().catch(() => "");
        throw new KeiCreditsError(text.slice(0, 150) || "HTTP 402 Payment Required");
      }

      const json = await res.json();
      console.log("[kei createTask]", `attempt=${attempt}`, JSON.stringify(json).slice(0, 300));

      if (json.code !== 200) {
        const msg = String(json.msg ?? "");
        // Exhausted balance — hard stop. Throwing KeiCreditsError skips the
        // retry loop (the catch below rethrows it immediately).
        if (json.code === 402 || isCreditsMessage(msg)) throw new KeiCreditsError(msg || `code ${json.code}`);
        const isTransient = /internal|timeout|temporar|try again|busy|503|502|504/i.test(msg);
        if (!isTransient || attempt === maxAttempts) throw new Error(`KEI createTask failed: ${msg}`);
        throw new Error(`KEI createTask transient: ${msg}`);
      }

      return json.data.taskId as string;
    } catch (err) {
      // Credits errors are non-retryable — surface immediately.
      if (err instanceof KeiCreditsError) throw err;
      lastError = err as Error;
      if (attempt < maxAttempts) {
        const delayMs = 1500 * attempt;
        console.warn(`[kei createTask] attempt ${attempt} failed: ${lastError.message} — retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error("KEI createTask failed: unknown error");
}

export async function pollKeiTask(taskId: string): Promise<KeiTaskResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      redirect: "follow",
    });
  } catch (err) {
    console.warn(`[kei poll] network error for ${taskId}: ${(err as Error).message} — treating as pending`);
    return { status: "pending" };
  }

  if (res.status >= 500) {
    console.warn(`[kei poll] HTTP ${res.status} for ${taskId} — treating as pending`);
    return { status: "pending" };
  }

  const text = await res.text();
  console.log("[kei poll]", res.status, res.url, text.slice(0, 300));

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    console.warn(`[kei poll] non-JSON for ${taskId} — treating as pending`);
    return { status: "pending" };
  }

  const data = (json.data ?? {}) as Record<string, unknown>;

  if (json.code !== 200) {
    const msg = String(json.msg ?? "");
    if (/not found|invalid task/i.test(msg)) throw new Error(`KEI poll failed (code=${json.code}): ${msg}`);
    console.warn(`[kei poll] non-200 code=${json.code} msg=${msg} — treating as pending`);
    return { status: "pending" };
  }

  const state = data.state as string;
  const status: KeiTaskResult["status"] =
    state === "success" ? "success" :
    state === "fail"    ? "failed"  :
    state === "generating" ? "processing" : "pending";

  let imageUrl: string | undefined;
  if (status === "success" && data.resultJson) {
    try {
      const result = JSON.parse(data.resultJson as string) as Record<string, unknown>;
      imageUrl = (result.resultUrls as string[] | undefined)?.[0];
    } catch { /* leave undefined */ }
  }

  let failMsg: string | undefined;
  let failCode: string | number | undefined;
  if (status === "failed") {
    failMsg =
      (data.failMsg as string | undefined) ??
      (data.errorMessage as string | undefined) ??
      (data.errorMsg as string | undefined) ??
      (data.failureReason as string | undefined) ??
      (json.msg as string | undefined);
    failCode =
      (data.failCode as string | number | undefined) ??
      (data.errorCode as string | number | undefined);
  }

  return { status, imageUrl, failMsg, failCode };
}

export class KeiTaskFailedError extends Error {
  taskId: string;
  failMsg?: string;
  failCode?: string | number;
  constructor(taskId: string, failMsg?: string, failCode?: string | number) {
    const detail = failMsg ? `${failMsg}${failCode ? ` (code=${failCode})` : ""}` : "no detail returned";
    super(`Task ${taskId} failed: ${detail}`);
    this.name = "KeiTaskFailedError";
    this.taskId = taskId;
    this.failMsg = failMsg;
    this.failCode = failCode;
  }
}

export async function waitForKeiTask(taskId: string, timeoutMs = 240_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    const result = await pollKeiTask(taskId);
    if (result.status === "success" && result.imageUrl) return result.imageUrl;
    if (result.status === "failed") {
      if (result.failMsg && isCreditsMessage(result.failMsg)) throw new KeiCreditsError(result.failMsg);
      throw new KeiTaskFailedError(taskId, result.failMsg, result.failCode);
    }
  }
  throw new Error(`Task ${taskId} timed out`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
