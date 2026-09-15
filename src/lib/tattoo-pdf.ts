import jsPDF from "jspdf";
import { resolveImageSrc } from "./image-src";

// ── Page formats + sheet-grid geometry ───────────────────────────────
export interface PageFormat {
  key: string;
  label: string;
  w: number; // mm, portrait
  h: number; // mm, portrait
}

export const PAGE_FORMATS: PageFormat[] = [
  { key: "a4", label: "A4", w: 210, h: 297 },
  { key: "a3", label: "A3", w: 297, h: 420 },
  { key: "a2", label: "A2", w: 420, h: 594 },
  { key: "a5", label: "A5", w: 148, h: 210 },
  { key: "letter", label: "Letter", w: 215.9, h: 279.4 },
  { key: "legal", label: "Legal", w: 215.9, h: 355.6 },
  { key: "tabloid", label: "Tabloid", w: 279.4, h: 431.8 },
  { key: "executive", label: "Executive", w: 184.15, h: 266.7 },
];

export const DEFAULT_PAGE_FORMAT = PAGE_FORMATS[0];

export function pageFormatByKey(key: string): PageFormat {
  return PAGE_FORMATS.find((p) => p.key === key) ?? DEFAULT_PAGE_FORMAT;
}

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

// ── Unit conversion (the tattoo's real-world size is stored in mm) ───
export const MM_PER_INCH = 25.4;
export const MM_PER_CM = 10;

export type SizeUnit = "in" | "cm";

export function mmToUnit(mm: number, unit: SizeUnit): number {
  return unit === "in" ? mm / MM_PER_INCH : mm / MM_PER_CM;
}

export function unitToMm(value: number, unit: SizeUnit): number {
  return unit === "in" ? value * MM_PER_INCH : value * MM_PER_CM;
}

// Default tattoo size — a common stencil size, not tied to any page format.
export const DEFAULT_SIZE_MM = 6 * MM_PER_INCH; // 6 inches
export const MIN_SIZE_MM = 1 * MM_PER_INCH; // 1 inch
export const MAX_SIZE_MM = 20 * MM_PER_INCH; // 20 inches

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
 * Pure geometry shared by the on-screen preview and the export functions so
 * they all agree pixel-for-pixel. `center` is the tattoo's centre in mm on
 * the full grid; `aspect` is the tattoo's natural width/height; `sizeMm` is
 * the tattoo's real-world longer-side size, independent of page format —
 * sheet count only controls how many physical pages a large tattoo tiles
 * across, not the tattoo's own size.
 */
export function computeStencilLayout(opts: {
  count: number;
  sizeMm: number;
  aspect: number;
  center: { x: number; y: number };
  pageSize: PageFormat;
}): StencilLayout {
  const { cols, rows } = stencilGrid(opts.count);
  const totalW = cols * opts.pageSize.w;
  const totalH = rows * opts.pageSize.h;
  const longSide = opts.sizeMm;

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

/** Default centre for a given sheet count + page format — middle of the full grid. */
export function defaultStencilCenter(count: number, pageSize: PageFormat): { x: number; y: number } {
  const { cols, rows } = stencilGrid(count);
  return { x: (cols * pageSize.w) / 2, y: (rows * pageSize.h) / 2 };
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
 * generated inside. This makes the size setting reference the real ink, and
 * keeps scaling centred on the ink (no drift when the content was off-centre
 * in the original frame). Falls back to the untrimmed image if the canvas is
 * tainted or no content is found.
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

// ── Shared render helpers ─────────────────────────────────────────────
export interface StencilInstance {
  sizeMm: number;
  rotation: number;
  mirrored: boolean;
  center: { x: number; y: number };
}

export interface StencilExportOptions {
  imageUrl: string;
  count: number;
  pageSize: PageFormat;
  instances: StencilInstance[];
  /** Pre-loaded image to reuse the preview's load (skips a second fetch). */
  image?: HTMLImageElement;
  subtitle?: string;
  filename?: string;
  /** Safe-area margin in mm. Defaults to STENCIL_MARGIN_MM (2mm). */
  marginMm?: number;
  /**
   * Ink tone adjustment: 0 = normal, negative = darker/bolder ink, positive =
   * lighter/faded ink. Range [MIN_INK_TONE, MAX_INK_TONE]. Defaults to
   * DEFAULT_INK_TONE (0). See `inkToneFilter()` for how this maps to a CSS
   * filter.
   */
  inkTone?: number;
}

// Ink darkness/lightness adjustment, applied identically to the on-screen
// preview and every export format so what you see is what prints.
export const DEFAULT_INK_TONE = 0;
export const MIN_INK_TONE = -100; // darkest / boldest
export const MAX_INK_TONE = 100; // lightest / most faded

/**
 * A plain brightness() filter looked wrong at both ends: darkening also
 * greyed out the white background (multiplying 255 by <100% isn't white
 * anymore), and lightening barely affected near-black ink (multiplying ~0 by
 * >100% is still ~0). A contrast-only darken fixed the grey-background
 * problem but overcorrected — it left the background pinned to pure white
 * instead of darkening along with the ink. Both ends now combine contrast
 * (keeps ink legible against the background as everything shifts) with
 * brightness (moves the whole image, background included, toward black or
 * white) so darker/lighter genuinely affects the whole page, not just the ink.
 */
export function inkToneFilter(tone: number): string {
  if (tone === 0) return "none";
  if (tone < 0) {
    // Darker: dim everything (brightness) while boosting contrast so the ink
    // stays legible against the now-darker background instead of flattening
    // into one grey mass.
    const t = -tone;
    const contrast = 100 + t * 0.8; // tone -100 → 180%
    const brightness = 100 - t * 0.35; // tone -100 → 65%
    return `contrast(${contrast}%) brightness(${brightness}%)`;
  }
  // Lighter: drop contrast (ink fades toward grey) and lift brightness
  // (pushes it further toward white) together for a visible fade.
  const contrast = 100 - tone * 0.6; // tone 100 → 40%
  const brightness = 100 + tone * 0.5; // tone 100 → 150%
  return `contrast(${contrast}%) brightness(${brightness}%)`;
}

const EXPORT_DPI = 150; // plenty for a ~1K source design; higher adds file size, not detail

/** Draws one tattoo instance, centred + rotated + mirrored, at the given pixel box. */
function drawInstance(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  inst: StencilInstance,
  dx: number, dy: number, dw: number, dh: number,
  inkTone: number = DEFAULT_INK_TONE
) {
  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  if (inst.mirrored) ctx.scale(-1, 1);
  if (inst.rotation) ctx.rotate((inst.rotation * Math.PI) / 180);
  ctx.filter = inkToneFilter(inkTone);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/**
 * Render the tattoo tiled across the sheet grid and emit one page per sheet
 * (row-major), sized to the selected page format. Each page is the full-bleed
 * slice of the design that belongs on that physical sheet, drawn at true mm
 * scale so printing at 100% yields the tattoo's real-world size. A faint
 * corner label aids assembly.
 */
export async function downloadTattooStencilPdf({
  imageUrl,
  count,
  pageSize,
  instances,
  image,
  subtitle,
  filename = "tattoo-stencil.pdf",
  marginMm = STENCIL_MARGIN_MM,
  inkTone = DEFAULT_INK_TONE,
}: StencilExportOptions): Promise<void> {
  const img = image ?? (await loadStencilImage(imageUrl));
  const aspect = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
  const { cols, rows } = stencilGrid(count);
  const layouts = instances.map(inst =>
    computeStencilLayout({ count, sizeMm: inst.sizeMm, aspect, center: inst.center, pageSize })
  );

  const pxPerMm = EXPORT_DPI / MM_PER_INCH;
  const sheetWpx = Math.round(pageSize.w * pxPerMm);
  const sheetHpx = Math.round(pageSize.h * pxPerMm);

  const doc = new jsPDF({ unit: "mm", format: [pageSize.w, pageSize.h], orientation: "portrait" });
  const total = cols * rows;

  let pageIndex = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (pageIndex > 0) doc.addPage([pageSize.w, pageSize.h], "portrait");

      const canvas = document.createElement("canvas");
      canvas.width = sheetWpx;
      canvas.height = sheetHpx;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sheetWpx, sheetHpx);

      for (let ii = 0; ii < instances.length; ii++) {
        const { tattooLeft, tattooTop, tattooW, tattooH } = layouts[ii];
        drawInstance(
          ctx, img, instances[ii],
          (tattooLeft - col * pageSize.w) * pxPerMm,
          (tattooTop - row * pageSize.h) * pxPerMm,
          tattooW * pxPerMm,
          tattooH * pxPerMm,
          inkTone
        );
      }

      // Faint assembly label, top-left corner.
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.font = `${Math.round(3.5 * pxPerMm)}px sans-serif`;
      ctx.textBaseline = "top";
      const label = total > 1 ? `Sheet ${pageIndex + 1}/${total} · R${row + 1}·C${col + 1}` : "Stencil";
      ctx.fillText(label, 4 * pxPerMm, 4 * pxPerMm);

      doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageSize.w, pageSize.h);

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
        const x2 = exteriorRight ? pageSize.w - M : pageSize.w;
        doc.line(x1, M, x2, M);
      }
      if (exteriorBottom) {
        const x1 = exteriorLeft  ? M : 0;
        const x2 = exteriorRight ? pageSize.w - M : pageSize.w;
        doc.line(x1, pageSize.h - M, x2, pageSize.h - M);
      }
      if (exteriorLeft) {
        const y1 = exteriorTop    ? M : 0;
        const y2 = exteriorBottom ? pageSize.h - M : pageSize.h;
        doc.line(M, y1, M, y2);
      }
      if (exteriorRight) {
        const y1 = exteriorTop    ? M : 0;
        const y2 = exteriorBottom ? pageSize.h - M : pageSize.h;
        doc.line(pageSize.w - M, y1, pageSize.w - M, y2);
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

/**
 * Render the same tiled layout as one flat PNG/JPEG image instead of a
 * multi-page PDF — the whole grid becomes a single image at true mm scale,
 * since raster formats have no concept of multiple "pages" to tile across.
 */
export async function downloadTattooStencilImage({
  imageUrl,
  count,
  pageSize,
  instances,
  image,
  filename = "tattoo-stencil.png",
  format = "png",
  inkTone = DEFAULT_INK_TONE,
}: StencilExportOptions & { format?: "png" | "jpeg" }): Promise<void> {
  const img = image ?? (await loadStencilImage(imageUrl));
  const aspect = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
  const layouts = instances.map(inst =>
    computeStencilLayout({ count, sizeMm: inst.sizeMm, aspect, center: inst.center, pageSize })
  );
  const { totalW, totalH } = layouts[0];

  const pxPerMm = EXPORT_DPI / MM_PER_INCH;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(totalW * pxPerMm);
  canvas.height = Math.round(totalH * pxPerMm);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let ii = 0; ii < instances.length; ii++) {
    const { tattooLeft, tattooTop, tattooW, tattooH } = layouts[ii];
    drawInstance(ctx, img, instances[ii], tattooLeft * pxPerMm, tattooTop * pxPerMm, tattooW * pxPerMm, tattooH * pxPerMm, inkTone);
  }

  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = canvas.toDataURL(mime, format === "jpeg" ? 0.92 : undefined);

  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
