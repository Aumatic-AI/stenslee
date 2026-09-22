// Resolves an image URL for canvas-safe loading (drawing to <canvas>,
// jsPDF, etc. without tainting it).
//
// Our own Supabase Storage objects (session-assets bucket) are public and
// already serve permissive CORS headers, so they can be loaded directly in
// the browser with crossOrigin="anonymous" — no proxy needed. Anything else
// goes through /api/proxy-image, which re-serves it same-origin. Prefer the
// direct path whenever possible: the proxy is a server-side (Node) fetch,
// which is a real, unnecessary point of failure for something entirely
// solvable in the browser.
const SUPABASE_STORAGE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL;

export function resolveImageSrc(src: string): string {
  if (src.startsWith("blob:") || src.startsWith("data:")) return src;
  if (SUPABASE_STORAGE_ORIGIN && src.startsWith(SUPABASE_STORAGE_ORIGIN)) return src;
  return `/api/proxy-image?url=${encodeURIComponent(src)}`;
}
