import { NextRequest } from "next/server";
import { createKeiTask, waitForKeiTask, KeiTaskFailedError, KeiCreditsError } from "@/lib/kei-api";
import { buildReworkPrompt } from "@/lib/prompts-rework";
import { uploadBase64, uploadFromUrl } from "@/lib/storage";

type RunResult =
  | { ok: true; url: string }
  | { ok: false; reason: string; taskId?: string; credits?: boolean };

async function runOneTask(prompt: string, inputUrls: string[]): Promise<RunResult> {
  let taskId: string | undefined;
  try {
    taskId = await createKeiTask(prompt, inputUrls, { model: "gpt-image-2-image-to-image" });
    const url = await waitForKeiTask(taskId);
    return { ok: true, url };
  } catch (err) {
    if (err instanceof KeiCreditsError) return { ok: false, reason: err.message, credits: true };
    if (err instanceof KeiTaskFailedError) return { ok: false, reason: err.failMsg ?? "Unknown KEI failure", taskId: err.taskId };
    return { ok: false, reason: (err as Error).message, taskId };
  }
}

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const {
    sessionId,
    description = "",
    mode,
    style = "",
    colors = [] as string[],
    count = 5,
    sourcePhoto,       // base64 — first generation only
    sourcePhotoUrl,    // already-hosted — first generation, resumed session
    editInstruction = "",
    editSourceUrls = [] as string[],
  } = await req.json();

  if (mode !== "cover" && mode !== "extend") {
    return Response.json({ error: "mode must be 'cover' or 'extend'" }, { status: 400 });
  }

  const isEdit = editInstruction.trim().length > 0;

  if (isEdit && editSourceUrls.length === 0) {
    return Response.json({ error: "At least one reference image is required to edit" }, { status: 400 });
  }
  if (!isEdit && !description.trim()) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }

  let sourceUrl: string;
  if (isEdit) {
    sourceUrl = editSourceUrls[0];
  } else if (sourcePhotoUrl) {
    sourceUrl = sourcePhotoUrl;
  } else if (sourcePhoto) {
    try {
      sourceUrl = await uploadBase64(sourcePhoto, sessionId, "rework-source");
    } catch (err) {
      return Response.json({ error: `Photo upload failed: ${(err as Error).message}` }, { status: 500 });
    }
  } else {
    return Response.json({ error: "A photo of the existing tattoo is required" }, { status: 400 });
  }

  const inputUrls = isEdit ? editSourceUrls : [sourceUrl];

  const prompt = buildReworkPrompt({
    description,
    mode,
    style,
    colorHexes: Array.isArray(colors) ? colors : [],
    editInstruction: isEdit ? editInstruction : undefined,
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit = (event: object) => writer.write(encoder.encode(JSON.stringify(event) + "\n"));

  (async () => {
    const clampedCount = Math.min(5, Math.max(1, Number(count) || 5));
    const tasks = Array.from({ length: clampedCount }, (_, index) =>
      runOneTask(prompt, inputUrls)
        .then(async (result) => {
          if (!result.ok) {
            console.warn(`[generate-rework] task ${index} failed: ${result.reason}`);
            await emit({ type: "error", index, reason: result.reason, ...(result.credits ? { code: "insufficient_credits" } : {}) });
            return;
          }
          try {
            const url = await uploadFromUrl(result.url, sessionId, "rework");
            await emit({ type: "result", index, image: { id: `kei-${Date.now()}-${index}`, imageUrl: url } });
          } catch (err) {
            console.error(`[generate-rework] storage upload failed for task ${index}:`, err);
            await emit({ type: "error", index, reason: `Image upload failed: ${(err as Error).message}` });
          }
        })
        .catch(async (err) => {
          await emit({ type: "error", index, reason: (err as Error).message });
        })
    );

    await Promise.allSettled(tasks);
    await emit({ type: "done", sourcePhotoUrl: !isEdit ? sourceUrl : undefined });
    await writer.close();
  })();

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
