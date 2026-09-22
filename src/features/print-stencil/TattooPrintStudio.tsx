"use client";

import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  SHEET_COUNTS,
  STENCIL_MARGIN_MM,
  PAGE_FORMATS,
  DEFAULT_PAGE_FORMAT,
  DEFAULT_SIZE_MM,
  MIN_SIZE_MM,
  MAX_SIZE_MM,
  DEFAULT_INK_TONE,
  MIN_INK_TONE,
  MAX_INK_TONE,
  inkToneFilter,
  mmToUnit,
  unitToMm,
  computeStencilLayout,
  defaultStencilCenter,
  loadTrimmedStencilImage,
  downloadTattooStencilPdf,
  downloadTattooStencilImage,
  type SheetCount,
  type PageFormat,
  type SizeUnit,
} from "@/features/print-stencil/tattoo-pdf";

interface TattooInstance {
  id: string;
  center: { x: number; y: number };
  sizeMm: number;
  rotation: number;
  mirrored: boolean;
}

interface Props {
  imageUrl: string;
  /** Used to compose the download filename. */
  subtitle?: string;
  filenameBase?: string;
  onClose: () => void;
}

type ExportFormat = "pdf" | "png" | "jpeg";

export default function TattooPrintStudio({ imageUrl, subtitle, filenameBase = "tattoo-stencil", onClose }: Props) {
  const [count, setCount] = useState<SheetCount>(1);
  const [marginMm, setMarginMm] = useState(STENCIL_MARGIN_MM);
  const [pageFormat, setPageFormat] = useState<PageFormat>(DEFAULT_PAGE_FORMAT);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("in");
  const [inkTone, setInkTone] = useState(DEFAULT_INK_TONE);
  const [isPageSizeOpen, setIsPageSizeOpen] = useState(false);
  const pageSizeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pageSizeRef.current && !pageSizeRef.current.contains(event.target as Node)) {
        setIsPageSizeOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const nextId = useRef(2);
  const [instances, setInstances] = useState<TattooInstance[]>([
    { id: "1", center: defaultStencilCenter(1, DEFAULT_PAGE_FORMAT), sizeMm: DEFAULT_SIZE_MM, rotation: 0, mirrored: true },
  ]);
  const [selectedId, setSelectedId] = useState("1");

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [aspect, setAspect] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  // Load the design once and trim its empty frame so sizing/positioning track
  // the actual ink. The trimmed image is reused for both preview and export.
  useEffect(() => {
    let cancelled = false;
    loadTrimmedStencilImage(imageUrl)
      .then((loaded) => {
        if (cancelled) return;
        setImg(loaded);
        setAspect(loaded.naturalWidth > 0 ? loaded.naturalWidth / loaded.naturalHeight : 1);
      })
      .catch((err) => !cancelled && setLoadError((err as Error).message));
    return () => { cancelled = true; };
  }, [imageUrl]);

  // Switch sheet count, recentre all instances on the new grid.
  function handleCountChange(n: SheetCount) {
    const newCenter = defaultStencilCenter(n, pageFormat);
    setCount(n);
    setInstances(prev => prev.map(inst => ({ ...inst, center: newCenter })));
  }

  // Switch page format, recentre all instances on the new grid.
  function handlePageFormatChange(p: PageFormat) {
    const newCenter = defaultStencilCenter(count, p);
    setPageFormat(p);
    setInstances(prev => prev.map(inst => ({ ...inst, center: newCenter })));
    setIsPageSizeOpen(false);
  }

  // Measure the available preview area so we can scale mm → px to fit.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute layout for every instance (cols/rows/totalW/totalH are identical across all).
  const instanceLayouts = useMemo(
    () => instances.map(inst => computeStencilLayout({ count, sizeMm: inst.sizeMm, aspect, center: inst.center, pageSize: pageFormat })),
    [instances, count, aspect, pageFormat]
  );

  // Grid dimensions — same for every instance, so read from the first.
  const { cols, rows, totalW, totalH } = instanceLayouts[0];

  const selectedIndex = instances.findIndex(i => i.id === selectedId);
  const selected = instances[selectedIndex] ?? instances[0];
  const selectedLayout = instanceLayouts[selectedIndex] ?? instanceLayouts[0];

  function updateSelected(patch: Partial<Omit<TattooInstance, "id">>) {
    setInstances(prev => prev.map(inst => inst.id === selectedId ? { ...inst, ...patch } : inst));
  }

  // Fit the whole grid inside the stage with a little breathing room.
  const { scale, dispW, dispH } = useMemo(() => {
    const pad = 24;
    const availW = Math.max(0, stage.w - pad * 2);
    const availH = Math.max(0, stage.h - pad * 2);
    const s = availW > 0 && availH > 0 ? Math.min(availW / totalW, availH / totalH) : 0;
    return { scale: s, dispW: totalW * s, dispH: totalH * s };
  }, [stage.w, stage.h, totalW, totalH]);

  // ── Drag the selected tattoo across the grid ──────────────────────
  const dragRef = useRef<{
    instanceId: string;
    startMX: number;
    startMY: number;
    startCX: number;
    startCY: number;
  } | null>(null);

  const onDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || scale <= 0) return;
    const dxMm = (e.clientX - d.startMX) / scale;
    const dyMm = (e.clientY - d.startMY) / scale;
    setInstances(prev => prev.map(inst =>
      inst.id === d.instanceId
        ? { ...inst, center: {
            x: Math.min(totalW, Math.max(0, d.startCX + dxMm)),
            y: Math.min(totalH, Math.max(0, d.startCY + dyMm)),
          }}
        : inst
    ));
  }, [scale, totalW, totalH]);

  function handleDragDown(e: React.PointerEvent, instId: string, instCenter: { x: number; y: number }) {
    e.preventDefault();
    setSelectedId(instId);
    dragRef.current = { instanceId: instId, startMX: e.clientX, startMY: e.clientY, startCX: instCenter.x, startCY: instCenter.y };
    function move(ev: PointerEvent) { onDragMove(ev); }
    function up() {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function handleDuplicate() {
    const id = String(nextId.current++);
    const src = selected;
    const offset = 20; // mm — offset so the copy is visibly separate
    setInstances(prev => [
      ...prev,
      {
        ...src,
        id,
        center: {
          x: Math.min(totalW, src.center.x + offset),
          y: Math.min(totalH, src.center.y + offset),
        },
      },
    ]);
    setSelectedId(id);
  }

  function handleDelete() {
    if (instances.length <= 1) return;
    const idx = instances.findIndex(i => i.id === selectedId);
    const remaining = instances.filter(i => i.id !== selectedId);
    setInstances(remaining);
    setSelectedId(remaining[Math.max(0, idx - 1)].id);
  }

  async function handleDownload() {
    if (downloading || !img) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const sharedOpts = {
        imageUrl,
        image: img,
        count,
        pageSize: pageFormat,
        instances: instances.map(({ center, sizeMm, rotation, mirrored }) => ({ center, sizeMm, rotation, mirrored })),
        subtitle,
        marginMm,
        inkTone,
      };
      if (exportFormat === "pdf") {
        await downloadTattooStencilPdf({
          ...sharedOpts,
          filename: `${filenameBase}-${count}x${pageFormat.label}.pdf`,
        });
      } else {
        await downloadTattooStencilImage({
          ...sharedOpts,
          format: exportFormat,
          filename: `${filenameBase}.${exportFormat}`,
        });
      }
    } catch (err) {
      setDownloadError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const gridStyle = useMemo(() => ({
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
  }), [cols, rows]);

  const safeAreaStyle = useMemo(() => ({
    left: marginMm * scale,
    top: marginMm * scale,
    right: marginMm * scale,
    bottom: marginMm * scale,
    border: "1px solid #b4b4b4",
  }), [marginMm, scale]);

  // Slider range in the current display unit.
  const sliderMin = sizeUnit === "in" ? 1 : 2.5;
  const sliderMax = sizeUnit === "in" ? 20 : 50;
  const sliderStep = sizeUnit === "in" ? 0.25 : 0.5;
  const sizeInCurrentUnit = mmToUnit(selected.sizeMm, sizeUnit);
  const pctOfPage = Math.round((selected.sizeMm / Math.min(pageFormat.w, pageFormat.h)) * 100);

  function handleSizeInput(value: string) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    const mm = Math.min(MAX_SIZE_MM, Math.max(MIN_SIZE_MM, unitToMm(n, sizeUnit)));
    updateSelected({ sizeMm: mm });
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col lg:flex-row"
    >
      {/* ── Preview (left / center) ──────────────────────────────────── */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10">
          <div>
            <p className="text-gold text-[10px] font-mono tracking-[0.2em] uppercase">Print Studio</p>
            <p className="text-white/60 text-xs font-mono mt-0.5">
              {cols}×{rows} grid · {pageFormat.label} · {Math.round(totalW)}×{Math.round(totalH)}mm · print at 100%
            </p>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden w-9 h-9 rounded-full bg-white/10 text-white hover:bg-error/30 transition-colors flex items-center justify-center text-xl cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
          {loadError ? (
            <p className="text-error text-sm font-mono max-w-xs text-center">{loadError}</p>
          ) : !img || scale <= 0 ? (
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          ) : (
            <div
              className="relative shadow-2xl select-none overflow-hidden"
              style={{ width: dispW, height: dispH, background: "#ffffff" }}
            >
              {/* Sheet grid overlay — dashed lines show where to cut & tape */}
              <div
                className="absolute inset-0 grid pointer-events-none z-10"
                style={gridStyle}
              >
                {Array.from({ length: cols * rows }).map((_, i) => (
                  <div
                    key={i}
                    className="border border-dashed border-gold/40 flex items-start justify-start"
                  >
                    <span className="m-1 text-[8px] font-mono text-gold/50 bg-white/70 px-1 rounded">
                      {cols * rows > 1 ? `R${Math.floor(i / cols) + 1}·C${(i % cols) + 1}` : pageFormat.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Safe-area guide — matches the thin grey line in the PDF. */}
              <div
                aria-hidden
                className="absolute pointer-events-none z-30"
                style={safeAreaStyle}
              />

              {/* All tattoo instances — click/drag to select & reposition */}
              {instances.map((inst, i) => {
                const layout = instanceLayouts[i];
                const isSelected = inst.id === selectedId;
                return (
                  <img
                    key={inst.id}
                    src={img.src}
                    alt={`Tattoo stencil ${i + 1}`}
                    onPointerDown={(e) => handleDragDown(e, inst.id, inst.center)}
                    draggable={false}
                    className="absolute z-20 cursor-move"
                    style={{
                      left: layout.tattooLeft * scale,
                      top: layout.tattooTop * scale,
                      width: layout.tattooW * scale,
                      height: layout.tattooH * scale,
                      maxWidth: "none",
                      maxHeight: "none",
                      transform: `${inst.mirrored ? "scaleX(-1) " : ""}rotate(${inst.rotation}deg)`,
                      touchAction: "none",
                      objectFit: "contain",
                      filter: inkTone !== DEFAULT_INK_TONE ? inkToneFilter(inkTone) : undefined,
                      outline: isSelected ? "2px solid rgba(201,168,76,0.85)" : "none",
                      outlineOffset: "3px",
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 py-2 border-t border-white/10">
          <p className="text-white/40 text-[10px] font-mono text-center">
            Drag the design to reposition · Print at 100% · Grey border = {marginMm}mm printer safe-area
          </p>
        </div>
      </div>

      {/* ── Right sidebar — controls ─────────────────────────────────── */}
      <div className="w-full lg:w-80 flex-shrink-0 bg-surface border-t lg:border-t-0 lg:border-l border-cleo-border flex flex-col">
        <div className="hidden lg:flex items-center justify-between px-5 py-4 border-b border-cleo-border">
          <h2 className="font-cinzel text-sm font-bold tracking-[0.15em] text-ink uppercase">Stencil Options</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-2 text-muted hover:text-error transition-colors flex items-center justify-center text-lg cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-6">
          {/* Page format */}
          <div ref={pageSizeRef} className="relative flex flex-col gap-2">
            <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Page size</label>
            <button
              type="button"
              onClick={() => setIsPageSizeOpen((v) => !v)}
              className="w-full bg-bg border border-cleo-border hover:border-gold/50 rounded-lg px-3 py-2.5 text-ink transition-colors flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-baseline gap-2">
                <span className="font-cinzel font-bold text-sm text-gold">{pageFormat.label}</span>
                <span className="text-[10px] text-muted font-mono">{pageFormat.w}×{pageFormat.h}mm</span>
              </span>
              <svg
                className={`w-3.5 h-3.5 text-muted transition-transform flex-shrink-0 ${isPageSizeOpen ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isPageSizeOpen && (
              <div className="absolute top-full mt-2 left-0 w-full bg-surface-2 border border-cleo-border rounded-xl shadow-2xl overflow-hidden z-50 max-h-64 overflow-y-auto">
                {PAGE_FORMATS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => handlePageFormatChange(p)}
                    className={`w-full text-left px-3 py-2.5 flex items-baseline gap-2 transition-colors hover:bg-gold/10 cursor-pointer ${
                      pageFormat.key === p.key ? "bg-gold/20" : ""
                    }`}
                  >
                    <span className={`font-cinzel font-bold text-sm ${pageFormat.key === p.key ? "text-gold" : "text-ink"}`}>
                      {p.label}
                    </span>
                    <span className="text-[10px] text-muted font-mono">{p.w}×{p.h}mm</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sheet count */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">How many sheets</label>
            <div className="grid grid-cols-4 gap-1.5">
              {SHEET_COUNTS.map((n) => (
                <button
                  key={n}
                  onClick={() => handleCountChange(n)}
                  className={`py-2.5 rounded-lg font-cinzel font-bold text-sm border transition-all cursor-pointer ${
                    count === n
                      ? "bg-gold text-bg border-gold shadow-[0_0_12px_rgba(201,168,76,0.3)]"
                      : "bg-bg text-muted border-cleo-border hover:border-gold/40 hover:text-ink"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-muted/50 text-[10px] font-mono">For large tattoos that need tiling across multiple sheets.</p>
          </div>

          {/* Copies */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Copies on sheet</label>
              <span className="text-white/40 text-[10px] font-mono">{instances.length} total</span>
            </div>
            {instances.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {instances.map((inst, i) => (
                  <button
                    key={inst.id}
                    onClick={() => setSelectedId(inst.id)}
                    className={`w-8 h-8 rounded-lg font-mono text-xs border transition-all cursor-pointer ${
                      inst.id === selectedId
                        ? "bg-gold text-bg border-gold"
                        : "bg-bg text-muted border-cleo-border hover:border-gold/40 hover:text-ink"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleDuplicate}
                className="flex-1 py-2 rounded-lg border border-cleo-border text-muted hover:border-gold/40 hover:text-gold text-xs font-mono transition-all cursor-pointer bg-bg"
              >
                + Duplicate
              </button>
              {instances.length > 1 && (
                <button
                  onClick={handleDelete}
                  className="px-3 py-2 rounded-lg border border-cleo-border text-muted hover:border-error/40 hover:text-error text-xs font-mono transition-all cursor-pointer bg-bg"
                >
                  Remove
                </button>
              )}
            </div>
            {instances.length > 1 && (
              <p className="text-muted/50 text-[10px] font-mono">
                Editing copy {selectedIndex + 1} of {instances.length}. Click a tattoo in the preview to select it.
              </p>
            )}
          </div>

          {/* Tattoo size — real-world, in inches or cm */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Tattoo size</label>
              <div className="flex items-center gap-1 bg-bg border border-cleo-border rounded-lg p-0.5">
                {(["in", "cm"] as const).map((u) => (
                  <button
                    key={u}
                    onClick={() => setSizeUnit(u)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono uppercase transition-colors cursor-pointer ${
                      sizeUnit === u ? "bg-gold text-bg" : "text-muted hover:text-ink"
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={sliderMin}
                max={sliderMax}
                step={sliderStep}
                value={sizeInCurrentUnit}
                onChange={(e) => handleSizeInput(e.target.value)}
                className="flex-1 accent-gold cursor-pointer"
              />
              <div className="relative flex-shrink-0 w-[4.5rem]">
                <input
                  type="number"
                  min={mmToUnit(MIN_SIZE_MM, sizeUnit)}
                  max={mmToUnit(MAX_SIZE_MM, sizeUnit)}
                  step={sizeUnit === "in" ? 0.1 : 0.5}
                  value={Math.round(sizeInCurrentUnit * 100) / 100}
                  onChange={(e) => handleSizeInput(e.target.value)}
                  className="w-full bg-bg border border-cleo-border rounded-lg pl-2 pr-6 py-1.5 text-ink text-xs font-mono focus:outline-none focus:border-gold transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted text-[10px] font-mono pointer-events-none">{sizeUnit}</span>
              </div>
            </div>
            <p className="text-muted/50 text-[10px] font-mono">
              ≈ {mmToUnit(selected.sizeMm, sizeUnit === "in" ? "cm" : "in").toFixed(1)}{sizeUnit === "in" ? "cm" : "in"} ·
              {" "}{pctOfPage}% of one {pageFormat.label} sheet ·
              {" "}{Math.round(selectedLayout.tattooW)}×{Math.round(selectedLayout.tattooH)}mm on paper
            </p>
          </div>

          {/* Rotation */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Rotation</label>
              <span className="text-gold text-xs font-mono font-bold">{selected.rotation}°</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[0, 90, 180, 270].map((deg) => (
                <button
                  key={deg}
                  onClick={() => updateSelected({ rotation: deg })}
                  className={`py-2 rounded-lg font-mono text-xs border transition-all cursor-pointer ${
                    selected.rotation === deg
                      ? "bg-gold text-bg border-gold"
                      : "bg-bg text-muted border-cleo-border hover:border-gold/40 hover:text-ink"
                  }`}
                >
                  {deg}°
                </button>
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={selected.rotation}
              onChange={(e) => updateSelected({ rotation: Number(e.target.value) })}
              className="w-full accent-gold cursor-pointer"
            />
          </div>

          {/* Mirror toggle */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted block">Mirror for skin transfer</label>
              <p className="text-muted/50 text-[10px] font-mono mt-0.5 leading-snug">
                Flips the design so it reads correctly once the stencil is pressed onto skin. Keep ON — vital for text. Off prints it as-drawn.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={selected.mirrored}
              onClick={() => updateSelected({ mirrored: !selected.mirrored })}
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 cursor-pointer ${selected.mirrored ? "bg-gold" : "bg-surface-2 border border-cleo-border"}`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${selected.mirrored ? "left-[26px]" : "left-0.5"}`}
              />
            </button>
          </div>

          {/* Safe-area margin */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Safe-area margin</label>
              <span className="text-gold text-xs font-mono font-bold">{marginMm}mm</span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              step={0.5}
              value={marginMm}
              onChange={(e) => setMarginMm(Number(e.target.value))}
              className="w-full accent-gold cursor-pointer"
            />
            <div className="flex justify-between text-[9px] font-mono text-muted/40">
              <span>0mm</span>
              <span>10mm</span>
              <span>20mm</span>
            </div>
            <p className="text-muted/50 text-[10px] font-mono leading-snug">
              Grey border inset shown in preview. Printed in the PDF only — PNG/JPEG exports are the flat design with no guide lines.
            </p>
          </div>

          {/* Ink darkness */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Ink darkness</label>
              <span className="text-gold text-xs font-mono font-bold">
                {inkTone === DEFAULT_INK_TONE ? "Normal" : inkTone < 0 ? `${-inkTone}% Darker` : `${inkTone}% Lighter`}
              </span>
            </div>
            <input
              type="range"
              min={MIN_INK_TONE}
              max={MAX_INK_TONE}
              step={2}
              value={inkTone}
              onChange={(e) => setInkTone(Number(e.target.value))}
              className="w-full accent-gold cursor-pointer"
            />
            <div className="flex justify-between text-[9px] font-mono text-muted/40">
              <span>Darker</span>
              <span>Normal</span>
              <span>Lighter</span>
            </div>
            <p className="text-muted/50 text-[10px] font-mono leading-snug">
              Adjusts how dark or light the ink prints — matches faded or heavily saturated reference designs. Applied to the preview and every export.
            </p>
          </div>

          {/* Export format */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">File format</label>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { key: "pdf", label: "PDF" },
                { key: "png", label: "PNG" },
                { key: "jpeg", label: "JPEG" },
              ] as const).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setExportFormat(f.key)}
                  className={`py-2.5 rounded-lg font-cinzel font-bold text-xs border transition-all cursor-pointer ${
                    exportFormat === f.key
                      ? "bg-gold text-bg border-gold shadow-[0_0_12px_rgba(201,168,76,0.3)]"
                      : "bg-bg text-muted border-cleo-border hover:border-gold/40 hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-muted/50 text-[10px] font-mono">
              {exportFormat === "pdf"
                ? "One page per sheet, with cut/tape guides — best for printing at true size."
                : "One flat image of the whole layout — best for sharing or a quick reference."}
            </p>
          </div>
        </div>

        {/* Download */}
        <div className="px-5 py-4 border-t border-cleo-border flex flex-col gap-2">
          {downloadError && (
            <p className="text-error text-[11px] font-mono leading-snug break-words">{downloadError}</p>
          )}
          <motion.button
            whileHover={img && !downloading ? { scale: 1.02 } : {}}
            whileTap={img && !downloading ? { scale: 0.97 } : {}}
            onClick={handleDownload}
            disabled={!img || downloading}
            className="w-full py-3.5 rounded-xl bg-gold text-bg font-cinzel font-bold text-sm tracking-[0.1em] uppercase border border-gold hover:bg-gold-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(201,168,76,0.2)]"
          >
            {downloading ? (
              <>
                <span className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
                Preparing…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                {exportFormat === "pdf"
                  ? `Download ${count} × ${pageFormat.label} PDF`
                  : `Download ${exportFormat.toUpperCase()}`}
              </>
            )}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
