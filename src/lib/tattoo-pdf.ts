import jsPDF from "jspdf";
import { resolveImageSrc } from "./image-src";

// ── A4 + sheet-grid geometry ────────────────────────────────────────
// A single A4 page in millimetres (portrait).
export const A4_MM = { w: 210, h: 297 };

// Safe-area inset drawn around the assembled tattoo. Office/consumer printers
// typically refuse to print within 1–2mm of the paper edge, so a full-bleed
// PDF gets silently cropped. The line is a guide only — the tattoo can still
// overflow it; it just shows where the printer is likely to clip.
export const STENCIL_MARGIN_MM = 2;

// How N sheets are arranged into a grid (portrait-leaning per product spec).
// The tattoo is tiled across the whole grid as ONE large image; each sheet
// holds one piece, printed at 100% and taped together.
export const SHEET_GRID: Record<number, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 },
  2: { cols: 1, rows: 2 },
  4: { cols: 2, rows: 2 },
  8: { cols: 2, rows: 4 },
};

export const SHEET_COUNTS = [1, 2, 4, 8] as const;
export type SheetCount = (typeof SHEET_COUNTS)[number];

export function stencilGrid(count: number): { cols: number; rows: number } {
  return SHEET_GRID[count] ?? SHEET_GRID[1];
}

export interface StencilLayout {
  cols: number;
  rows: number;
  totalW: number; // mm — full grid width
  totalH: number; // mm — full grid height
  tattooLeft: number; // mm — tattoo box left on the grid
  tattooTop: number; // mm — tattoo box top on the grid
  tattooW: number; // mm
  tattooH: number; // mm
}

/**
 * Pure geometry shared by the on-screen preview and the PDF export so both
 * agree pixel-for-pixel. `center` is the tattoo's centre in mm on the full
 * grid; `aspect` is the tattoo's natural width/height.
 *
 * At 100% the tattoo's longer side equals the grid's shorter side, so it sits
 * comfortably inside a single column/row; the % can push it larger (it then
 * spans multiple sheets) or smaller.
 */
export function computeStencilLayout(opts: {
  count: number;
  sizePercent: number;
  aspect: number;
  center: { x: number; y: number };
}): StencilLayout {
  const { cols, rows } = stencilGrid(opts.count);
  const totalW = cols * A4_MM.w;
  const totalH = rows * A4_MM.h;
  const baseSize = Math.min(totalW, totalH);
  const longSide = baseSize * (opts.sizePercent / 100);

  const aspect = opts.aspect > 0 ? opts.aspect : 1;
  let tattooW: number;
  let tattooH: number;
  if (aspect >= 1) {
    tattooW = longSide;
    tattooH = longSide / aspect;
  } else {
    tattooH = longSide;
    tattooW = longSide * aspect;
  }

  return {
    cols,
    rows,
    totalW,
    totalH,
    tattooLeft: opts.center.x - tattooW / 2,
    tattooTop: opts.center.y - tattooH / 2,
    tattooW,
    tattooH,
  };
}

/** Default centre for a given sheet count — middle of the full grid. */
export function defaultStencilCenter(count: number): { x: number; y: number } {
  const { cols, rows } = stencilGrid(count);
  return { x: (cols * A4_MM.w) / 2, y: (rows * A4_MM.h) / 2 };
}

// ── Image loading (CORS-safe) ────────────────────────────────────────
export function loadStencilImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const isLocal = src.startsWith("blob:") || src.startsWith("data:");
    if (!isLocal) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load tattoo image: ${src}`));
    img.src = resolveImageSrc(src);
  });
}

function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Trimmed image failed to load"));
    img.src = dataUrl;
  });
}

/**
 * Load the design and trim its empty (near-white / transparent) margins so the
 * returned image is the actual tattoo content — not the square frame it was
 * generated inside. This makes the size % reference the real ink relative to
 * A4, and keeps scaling centred on the ink (no drift when the content was
 * off-centre in the original frame). Falls back to the untrimmed image if the
 * canvas is tainted or no content is found.
 */
export async function loadTrimmedStencilImage(src: string): Promise<HTMLImageElement> {
  const img = await loadStencilImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return img;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return img;
  ctx.drawImage(img, 0, 0);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return img; // cross-origin taint — can't inspect pixels, use as-is
  }

  // A pixel counts as ink if it's visible AND not near-white. Tattoo designs
  // are line art on a white (or transparent) ground, so this isolates the art.
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= 16) continue;
      if (data[i] < 244 || data[i + 1] < 244 || data[i + 2] < 244) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return img; // blank — nothing to trim

  // A hair of padding so anti-aliased edges aren't clipped.
  const padX = Math.round((maxX - minX + 1) * 0.02);
  const padY = Math.round((maxY - minY + 1) * 0.02);
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(w - 1, maxX + padX);
  maxY = Math.min(h - 1, maxY + padY);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  // Negligible margin — keep the original (avoids a needless re-encode).
  if (cw >= w * 0.98 && ch >= h * 0.98) return img;

  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const octx = out.getContext("2d");
  if (!octx) return img;
  octx.drawImage(img, minX, minY, cw, ch, 0, 0, cw, ch);

  return imageFromDataUrl(out.toDataURL("image/png"));
}

// ── Multi-page stencil PDF ──────────────────────────────────────────
export interface StencilInstance {
  sizePercent: number;
  rotation: number;
  mirrored: boolean;
  center: { x: number; y: number };
}

export interface StencilPdfOptions {
  imageUrl: string;
  count: number;
  instances: StencilInstance[];
  /** Pre-loaded image to reuse the preview's load (skips a second fetch). */
  image?: HTMLImageElement;
  subtitle?: string;
  filename?: string;
  /** Safe-area margin in mm. Defaults to STENCIL_MARGIN_MM (2mm). */
  marginMm?: number;
}

/**
 * Render the tattoo tiled across the sheet grid and emit one A4 page per sheet
 * (row-major). Each page is the full-bleed slice of the design that belongs on
 * that physical sheet, drawn at true mm scale so printing at 100% yields the
 * intended size. A faint corner label aids assembly.
 */
export async function downloadTattooStencilPdf({
  imageUrl,
  count,
  instances,
  image,
  subtitle,
  filename = "tattoo-stencil.pdf",
  marginMm = STENCIL_MARGIN_MM,
}: StencilPdfOptions): Promise<void> {
  const img = image ?? (await loadStencilImage(imageUrl));
  const aspect = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
  const { cols, rows } = stencilGrid(count);
  // Pre-compute layout for every instance once — cols/rows/totalW/totalH are identical across all.
  const layouts = instances.map(inst =>
    computeStencilLayout({ count, sizePercent: inst.sizePercent, aspect, center: inst.center })
  );

  // 150 DPI is plenty: the source design is ~1K, so higher DPI adds file size
  // without real detail. pxPerMm = DPI / 25.4.
  const DPI = 150;
  const pxPerMm = DPI / 25.4;
  const sheetWpx = Math.round(A4_MM.w * pxPerMm);
  const sheetHpx = Math.round(A4_MM.h * pxPerMm);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const total = cols * rows;

  let pageIndex = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (pageIndex > 0) doc.addPage();

      const canvas = document.createElement("canvas");
      canvas.width = sheetWpx;
      canvas.height = sheetHpx;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sheetWpx, sheetHpx);

      // Render every instance onto this sheet's canvas.
      for (let ii = 0; ii < instances.length; ii++) {
        const inst = instances[ii];
        const { tattooLeft, tattooTop, tattooW, tattooH } = layouts[ii];

        const dx = (tattooLeft - col * A4_MM.w) * pxPerMm;
        const dy = (tattooTop - row * A4_MM.h) * pxPerMm;
        const dw = tattooW * pxPerMm;
        const dh = tattooH * pxPerMm;

        const cxpx = dx + dw / 2;
        const cypx = dy + dh / 2;
        ctx.save();
        ctx.translate(cxpx, cypx);
        if (inst.mirrored) ctx.scale(-1, 1);
        if (inst.rotation) ctx.rotate((inst.rotation * Math.PI) / 180);
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }

      // Faint assembly label, top-left corner.
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.font = `${Math.round(3.5 * pxPerMm)}px sans-serif`;
      ctx.textBaseline = "top";
      const label = total > 1 ? `Sheet ${pageIndex + 1}/${total} · R${row + 1}·C${col + 1}` : "Stencil";
      ctx.fillText(label, 4 * pxPerMm, 4 * pxPerMm);

      doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, A4_MM.w, A4_MM.h);

      // Outer safe-area guide. Each sheet draws only the segments that sit on
      // an exterior edge of the assembled grid; corners terminate at the
      // perpendicular margin so taped sheets form one continuous rectangle.
      const M = marginMm;
      const exteriorLeft   = col === 0;
      const exteriorRight  = col === cols - 1;
      const exteriorTop    = row === 0;
      const exteriorBottom = row === rows - 1;

      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.2);

      if (exteriorTop) {
        const x1 = exteriorLeft  ? M : 0;
        const x2 = exteriorRight ? A4_MM.w - M : A4_MM.w;
        doc.line(x1, M, x2, M);
      }
      if (exteriorBottom) {
        const x1 = exteriorLeft  ? M : 0;
        const x2 = exteriorRight ? A4_MM.w - M : A4_MM.w;
        doc.line(x1, A4_MM.h - M, x2, A4_MM.h - M);
      }
      if (exteriorLeft) {
        const y1 = exteriorTop    ? M : 0;
        const y2 = exteriorBottom ? A4_MM.h - M : A4_MM.h;
        doc.line(M, y1, M, y2);
      }
      if (exteriorRight) {
        const y1 = exteriorTop    ? M : 0;
        const y2 = exteriorBottom ? A4_MM.h - M : A4_MM.h;
        doc.line(A4_MM.w - M, y1, A4_MM.w - M, y2);
      }

      pageIndex++;
    }
  }

  // Trailing metadata page footer note isn't added; the label per sheet plus
  // the filename carry assembly context. Subtitle is reserved for the caller's
  // filename composition.
  void subtitle;

  doc.save(filename);
}
