/**
 * Converts any image blob (WebP, HEIC, PNG, etc.) to a JPEG base64 data URI via canvas.
 * KEI API requires JPEG or PNG; this ensures consistent format.
 */
export async function toJpegBase64(source: Blob, quality = 0.92): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for conversion"));
    };
    img.src = url;
  });
}

/** Reads a blob:// URL (or data: URI) and converts it to a JPEG base64 data URI.
 *  Callers must NOT pass remote https:// URLs — those should be sent to the API as
 *  hosted reference URLs instead. Treating them as base64 silently corrupts uploads
 *  (Buffer.from(url, "base64") produces garbage bytes server-side). */
export async function blobUrlToBase64(blobUrl: string): Promise<string> {
  if (blobUrl.startsWith("data:")) return blobUrl;
  if (!blobUrl.startsWith("blob:")) {
    throw new Error(`blobUrlToBase64: expected blob:/data: URL, got ${blobUrl.slice(0, 32)}…`);
  }
  const res = await fetch(blobUrl);
  const blob = await res.blob();
  return toJpegBase64(blob);
}
