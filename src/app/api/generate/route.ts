import { NextRequest } from "next/server";
import { buildTattooPrompt, createKeiTask, waitForKeiTask, KeiTaskFailedError, KeiCreditsError } from "@/lib/kei-api";
import type { RefinementInfo } from "@/lib/kei-api";
import { uploadBase64 } from "@/lib/storage";

// Fetching from KEI works reliably from this server (unlike uploading TO
// Supabase, which doesn't) — so download the result here but hand the bytes
// to the browser as base64 and let IT do the unreliable-from-Node upload.
async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  const contentType = res.headers.get("content-type") ?? "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

type RunResult =
  | { ok: true; url: string }
  | { ok: false; reason: string; taskId?: string; credits?: boolean };

async function runOneTask(prompt: string, inputUrls: string[], model: "gpt-image-2-image-to-image" | "nano-banana-pro" = "gpt-image-2-image-to-image"): Promise<RunResult> {
  let taskId: string | undefined;
  try {
    taskId = await createKeiTask(prompt, inputUrls, { model });
    const url = await waitForKeiTask(taskId);
    return { ok: true, url };
  } catch (err) {
    if (err instanceof KeiCreditsError) {
      return { ok: false, reason: err.message, credits: true };
    }
    if (err instanceof KeiTaskFailedError) {
      return { ok: false, reason: err.failMsg ?? "Unknown KEI failure", taskId: err.taskId };
    }
    return { ok: false, reason: (err as Error).message, taskId };
  }
}

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const {
    sessionId,
    description,
    style,
    images: b64Images = [],
    referenceImageUrls = [] as string[],
    refineImageUrls = [] as string[],
    refinementText = "",
    faithfulMode = false,
    isTextTattoo = false,
    selectedDesignNames = [] as string[],
    colors = [] as string[],
    targetBodyArea = "",
    count = 5,
    textTattooFont,
  } = await req.json();

  if (!description?.trim()) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }

  const isRefinement = refineImageUrls.length > 0 && refinementText.trim().length > 0;

  // ── Build input URL list ─────────────────────────────────────────────
  // References can come in two shapes:
  //   - `images`: base64 payloads (fresh blob URLs from dropzone/camera) → upload here
  //   - `referenceImageUrls`: already-hosted URLs (Pinterest pins uploaded in the background) → pass through
  // Mixing them lets us avoid re-uploading already-stored Pinterest images.
  let uploadedRefUrls: string[] = [];
  if ((b64Images as string[]).length > 0) {
    try {
      uploadedRefUrls = await Promise.all(
        (b64Images as string[]).map((b64) => uploadBase64(b64, sessionId, "refs"))
      );
    } catch (err) {
      return Response.json({ error: `Image upload failed: ${(err as Error).message}` }, { status: 500 });
    }
  }

  const hostedRefs = (referenceImageUrls as string[]).filter((u) => typeof u === "string" && u.length > 0);
  const allRefs = [...uploadedRefUrls, ...hostedRefs];

  if (!isRefinement && allRefs.length === 0) {
    return Response.json({ error: "At least one reference image is required" }, { status: 400 });
  }

  let inputUrls: string[];
  if (isRefinement) {
    inputUrls = [...(refineImageUrls as string[]), ...allRefs];
  } else {
    inputUrls = allRefs;
  }

  // ── Build prompt ─────────────────────────────────────────────────────
  let refinementInfo: RefinementInfo | undefined;
  if (isRefinement) {
    refinementInfo = {
      text: refinementText as string,
      faithfulMode: faithfulMode as boolean,
      selectedImages: (refineImageUrls as string[]).map((_, i) => ({
        name: (selectedDesignNames as string[])[i] ?? `Variation ${i + 1}`,
        index: i + 1,
      })),
    };
  }

  const hasUserRefs = allRefs.length > 0;
  const generationModel = (isTextTattoo as boolean) ? "nano-banana-pro" : "gpt-image-2-image-to-image";
  const prompt = buildTattooPrompt(
    description,
    style ?? "",
    hasUserRefs,
    refinementInfo,
    Array.isArray(colors) ? (colors as string[]) : [],
    typeof targetBodyArea === "string" ? targetBodyArea : "",
    isTextTattoo as boolean,
    textTattooFont ? { font: textTattooFont } : undefined
  );

  // ── Stream results as each task completes ────────────────────────────
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const emit = (event: object) =>
    writer.write(encoder.encode(JSON.stringify(event) + "\n"));

  (async () => {
    const tasks = Array.from({ length: count }, (_, index) =>
      runOneTask(prompt, inputUrls, generationModel)
        .then(async (result) => {
          if (!result.ok) {
            console.warn(`[generate] task ${index} failed: ${result.reason}`);
            await emit({
              type: "error",
              index,
              reason: result.reason,
              ...(result.credits ? { code: "insufficient_credits" } : {}),
            });
            return;
          }
          try {
            const imageBase64 = await fetchAsBase64(result.url);
            await emit({
              type: "result",
              index,
              image: { id: `kei-${Date.now()}-${index}`, imageBase64 },
            });
          } catch (err) {
            console.error(`[generate] fetching result failed for task ${index}:`, err);
            await emit({ type: "error", index, reason: `Image fetch failed: ${(err as Error).message}` });
          }
        })
        .catch(async (err) => {
          await emit({ type: "error", index, reason: (err as Error).message });
        })
    );

    await Promise.allSettled(tasks);
    await emit({ type: "done" });
    await writer.close();
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
