import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { uploadBase64Direct } from "@/lib/browser-upload";

const supabase = createSupabaseBrowserClient();

const POLL_INTERVAL_MS = 3000;
const MAX_NOT_FOUND_ATTEMPTS = 3; // grace period for a job that was *just* started

export interface FlashSlot {
  status: "pending" | "done" | "error";
  imageBase64?: string;
  reason?: string;
}

function flashJobKey(designId: string): string {
  return `flash:${designId}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fire-and-forget: tells the server to start isolating the tattoo onto a
// plain white background. The caller doesn't need to await the result —
// it just needs the job to exist so any page watching (this tab now, or
// Session Details later) can pick it up and persist the outcome.
export async function startFlashGeneration(designId: string, sourceImageUrl: string): Promise<void> {
  await fetch("/api/generate-flash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ designId, imageUrl: sourceImageUrl }),
  });
}

// Single, un-retried check — used to decide up front whether a job exists
// at all before committing to a watch loop (so "never started" reads as
// idle, not as a false "generation failed").
export async function checkFlashJob(designId: string): Promise<{ found: boolean; done: boolean; slot?: FlashSlot }> {
  const res = await fetch(`/api/generation-status?sessionId=${encodeURIComponent(flashJobKey(designId))}`);
  const data = await res.json();
  if (!data.found) return { found: false, done: false };
  return { found: true, done: !!data.done, slot: data.slots?.[0] };
}

// Polls an in-flight flash job to completion, uploading the result and
// persisting it on the design row. Safe to call from more than one page at
// once — whichever one is open when the job finishes does the persisting.
export async function watchFlashGeneration(
  sessionId: string,
  designId: string,
  onTick?: (state: "loading" | "error" | "done", detail?: string) => void
): Promise<string | null> {
  let notFoundStreak = 0;

  while (true) {
    let status;
    try {
      status = await checkFlashJob(designId);
    } catch {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!status.found) {
      notFoundStreak++;
      if (notFoundStreak >= MAX_NOT_FOUND_ATTEMPTS) {
        onTick?.("error", "Generation failed unexpectedly on the server.");
        return null;
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    notFoundStreak = 0;

    const slot = status.slot;
    if (!slot || slot.status === "pending") {
      onTick?.("loading");
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (slot.status === "error" || !slot.imageBase64) {
      onTick?.("error", slot.reason ?? "This image failed to generate.");
      return null;
    }

    try {
      const url = await uploadBase64Direct(slot.imageBase64, sessionId, "flash");
      await supabase.from("tattoo_designs").update({ flash_image_url: url }).eq("id", designId);
      onTick?.("done");
      return url;
    } catch (err) {
      onTick?.("error", (err as Error).message);
      return null;
    }
  }
}
