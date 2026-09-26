import { createSupabaseBrowserClient } from "@/lib/supabase-client";

const supabase = createSupabaseBrowserClient();
const BUCKET = "session-assets";

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Uploads a Blob straight from the browser to Supabase Storage and returns a
// bare storage key ("<bucket>/<path>"), not a full URL — resolve it with
// resolveImageSrc()/toPublicUrl() wherever it's displayed or sent to an
// external API. Used instead of sending the file to a Node API route to
// upload — this machine's Node process is unreliable talking to Supabase
// over the network, while the browser's own network stack isn't.
//
// A handful of attempts with backoff: unlike the Node-side issue above,
// browser uploads are otherwise reliable — an occasional failure here (e.g.
// a 504 from Supabase's own storage endpoint) is a genuine transient blip,
// worth retrying automatically instead of surfacing to the user every time.
const MAX_UPLOAD_ATTEMPTS = 3;

export async function uploadBlobDirect(blob: Blob, sessionId: string, prefix: string): Promise<string> {
  const contentType = blob.type || "image/jpeg";
  const path = `${sessionId}/${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extFromMime(contentType)}`;

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
    if (!error) return `${BUCKET}/${path}`;

    lastError = error.message;
    if (attempt < MAX_UPLOAD_ATTEMPTS) {
      console.warn(`[uploadBlobDirect] attempt ${attempt} failed: ${lastError} — retrying`);
      await sleep(800 * attempt);
    }
  }
  throw new Error(`Upload failed: ${lastError}`);
}

export async function uploadPhotoDirect(blobUrl: string, sessionId: string, prefix: string): Promise<string> {
  const blob = await (await fetch(blobUrl)).blob();
  return uploadBlobDirect(blob, sessionId, prefix);
}

export async function uploadBase64Direct(dataUrl: string, sessionId: string, prefix: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return uploadBlobDirect(blob, sessionId, prefix);
}
