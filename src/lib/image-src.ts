// Resolves a stored value — a bare Supabase Storage key (e.g.
// "session-assets/abc/refs/1.jpg"), a still-external URL (e.g. a Pinterest
// reference image never re-uploaded), or a transient blob:/data: URI — into
// something an <img>, <canvas>, or jsPDF can load safely, same-origin where
// it matters.
//
// DB columns store bare keys, not full URLs, precisely so a storage-provider
// migration only ever touches STORAGE_BASE_URL below, not every row.
//
// Our own Supabase Storage objects are public and already serve permissive
// CORS headers, so a bare key resolves straight to its public URL — no
// proxy needed. A genuine external URL (not ours) goes through
// /api/proxy-image instead, which re-serves it same-origin. Prefer the
// direct path whenever possible: the proxy is a server-side (Node) fetch, a
// real, unnecessary point of failure for something entirely solvable in the
// browser.
const SUPABASE_STORAGE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const STORAGE_BASE_URL = `${SUPABASE_STORAGE_ORIGIN}/storage/v1/object/public`;

// Turns a DB-stored value into a real, fetchable URL. Safe to call from
// both server and browser code (e.g. right before handing a list of image
// URLs to an external API that must fetch them itself).
export function toPublicUrl(value: string): string {
  if (/^https?:\/\//.test(value)) return value;
  return `${STORAGE_BASE_URL}/${value}`;
}

export function resolveImageSrc(src: string): string {
  if (src.startsWith("blob:") || src.startsWith("data:")) return src;
  const url = toPublicUrl(src);
  if (SUPABASE_STORAGE_ORIGIN && url.startsWith(SUPABASE_STORAGE_ORIGIN)) return url;
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

// Null-safe wrapper for the common "DB column might not be set yet" case.
export function getStorageUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return resolveImageSrc(key);
}
