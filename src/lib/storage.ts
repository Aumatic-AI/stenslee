import { createServiceClient } from "./supabase-server";

const BUCKET = "session-assets";

function makePath(sessionId: string | undefined, prefix: string, ext = "jpg") {
  const session = sessionId || "anon";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${session}/${prefix}/${stamp}.${ext}`;
}

function extFromContentType(contentType: string | null): string {
  if (!contentType) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// This machine's Node process intermittently fails TLS handshakes to Supabase
// (ECONNRESET / "fetch failed") while the same call almost always succeeds on
// retry — the browser's network stack never has this problem, only Node's.
// A short retry absorbs that instead of failing the whole upload on one blip.
async function uploadWithRetry(path: string, buffer: Buffer, contentType: string, attempts = 3): Promise<void> {
  const supabase = createServiceClient();
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false });
    if (!error) return;
    lastError = new Error(error.message);
    if (attempt < attempts) await sleep(400 * attempt);
  }
  throw new Error(`Storage upload failed: ${lastError?.message}`);
}

/**
 * Upload a base64-encoded image (with or without data-URI prefix) to Supabase
 * Storage. Returns a bare storage key ("<bucket>/<path>"), not a full URL —
 * resolve it with resolveImageSrc()/toPublicUrl() wherever it's displayed or
 * sent to an external API.
 */
export async function uploadBase64(
  base64Data: string,
  sessionId: string | undefined,
  prefix: string
): Promise<string> {
  const match = base64Data.match(/^data:([^;]+);base64,/);
  const contentType = match?.[1] ?? "image/jpeg";
  const pureBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(pureBase64, "base64");
  const ext = extFromContentType(contentType);
  const path = makePath(sessionId, prefix, ext);

  await uploadWithRetry(path, buffer, contentType);

  return `${BUCKET}/${path}`;
}

/**
 * Fetch a remote URL (e.g. KEI tempfile) and re-upload it to Supabase
 * Storage. Returns a bare storage key, same as uploadBase64.
 */
export async function uploadFromUrl(
  sourceUrl: string,
  sessionId: string | undefined,
  prefix: string
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${sourceUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "image/png";
  const ext = extFromContentType(contentType);
  const path = makePath(sessionId, prefix, ext);

  await uploadWithRetry(path, buffer, contentType);

  return `${BUCKET}/${path}`;
}
