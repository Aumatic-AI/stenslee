"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { resolveImageSrc } from "@/lib/image-src";

interface Props {
  bodyPhotoUrl: string;
  tattooImageUrl: string;
  onConfirm: (compositeBase64: string) => void;
  onReset: () => void;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const isLocal = src.startsWith("blob:") || src.startsWith("data:");
  const resolvedSrc = resolveImageSrc(src);

  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!isLocal) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Image failed to load: ${resolvedSrc} — ${String(e)}`));
    img.src = resolvedSrc;
  });
}

export default function TattooPlacementEditor({ bodyPhotoUrl, tattooImageUrl, onConfirm, onReset }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tattooAspect, setTattooAspect] = useState(1);
  // The body photo's natural aspect ratio drives the container size so the
  // user always sees the entire photo with no cropping. Null while loading.
  const [bodyAspect, setBodyAspect] = useState<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Mutable refs for event handlers so closures stay fresh
  const stateRef = useRef({ pos: { x: 0, y: 0 }, size: 0, rotation: 0 });
  stateRef.current = { pos, size, rotation };

  const dragRef = useRef<{ startMX: number; startMY: number; startPX: number; startPY: number } | null>(null);
  const resizeRef = useRef<{ startMX: number; startMY: number; startSize: number } | null>(null);
  const rotateRef = useRef<{ startAngle: number; startRotation: number; cx: number; cy: number } | null>(null);

  // Re-initialize the tattoo placement whenever either source changes.
  useEffect(() => {
    setInitialized(false);
  }, [bodyPhotoUrl, tattooImageUrl]);

  // Load the body photo to discover its natural aspect ratio.
  useEffect(() => {
    setBodyAspect(null);
    const img = new Image();
    img.onload = () => {
      const a = img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : 4 / 3;
      setBodyAspect(a);
    };
    img.onerror = () => setBodyAspect(4 / 3);
    img.src = bodyPhotoUrl;
  }, [bodyPhotoUrl]);

  // Load the tattoo design to discover its aspect.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setTattooAspect(img.naturalWidth > 0 ? img.naturalWidth / img.naturalHeight : 1);
    };
    img.src = tattooImageUrl;
  }, [tattooImageUrl]);

  // Once the container has been sized by the body photo's aspect, drop the
  // tattoo in the centre at ~35% width.
  useEffect(() => {
    if (bodyAspect === null || initialized) return;
    const raf = requestAnimationFrame(() => {
      const c = containerRef.current;
      if (!c) return;
      setPos({ x: c.offsetWidth / 2, y: c.offsetHeight / 2 });
      setSize(c.offsetWidth * 0.35);
      setRotation(0);
      setInitialized(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [bodyAspect, initialized]);

  const tattooWidth = size;
  const tattooHeight = tattooAspect > 0 ? size / tattooAspect : size;

  // Memoized — this style object is applied on every pointer move (60fps during drag).
  // Without memo a new object is created each frame, causing unnecessary reconciliation.
  const overlayStyle = useMemo(() => ({
    position: "absolute" as const,
    left: pos.x - tattooWidth / 2,
    top: pos.y - tattooHeight / 2,
    width: tattooWidth,
    height: tattooHeight,
    transform: `rotate(${rotation}deg)`,
    transformOrigin: "center center",
    cursor: "move",
    touchAction: "none" as const,
    mixBlendMode: "multiply" as const,
  }), [pos.x, pos.y, tattooWidth, tattooHeight, rotation]);

  // ── Drag ────────────────────────────────────────────────────────────
  const onDragMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startMX;
    const dy = e.clientY - dragRef.current.startMY;
    setPos({ x: dragRef.current.startPX + dx, y: dragRef.current.startPY + dy });
  }, []);

  const onDragUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragUp);
  }, [onDragMove]);

  function handleDragDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    dragRef.current = { startMX: e.clientX, startMY: e.clientY, startPX: pos.x, startPY: pos.y };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp);
  }

  // ── Resize (corner handle) ───────────────────────────────────────────
  const onResizeMove = useCallback((e: PointerEvent) => {
    if (!resizeRef.current) return;
    const dx = e.clientX - resizeRef.current.startMX;
    const dy = e.clientY - resizeRef.current.startMY;
    const delta = (dx + dy) / 2;
    setSize(Math.max(40, resizeRef.current.startSize + delta));
  }, []);

  const onResizeUp = useCallback(() => {
    resizeRef.current = null;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeUp);
  }, [onResizeMove]);

  function handleResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startMX: e.clientX, startMY: e.clientY, startSize: size };
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", onResizeUp);
  }

  // ── Rotate (top-center handle) ────────────────────────────────────────
  const onRotateMove = useCallback((e: PointerEvent) => {
    if (!rotateRef.current) return;
    const angle = Math.atan2(e.clientY - rotateRef.current.cy, e.clientX - rotateRef.current.cx) * (180 / Math.PI);
    setRotation(rotateRef.current.startRotation + (angle - rotateRef.current.startAngle));
  }, []);

  const onRotateUp = useCallback(() => {
    rotateRef.current = null;
    window.removeEventListener("pointermove", onRotateMove);
    window.removeEventListener("pointerup", onRotateUp);
  }, [onRotateMove]);

  function handleRotateDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const cx = rect.left + pos.x;
    const cy = rect.top + pos.y;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    rotateRef.current = { startAngle, startRotation: rotation, cx, cy };
    window.addEventListener("pointermove", onRotateMove);
    window.addEventListener("pointerup", onRotateUp);
  }

  // ── Scroll to resize ──────────────────────────────────────────────────
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    setSize((s) => Math.max(40, s - e.deltaY * 0.4));
  }

  // ── Export composite via canvas ───────────────────────────────────────
  // The canvas renders at the body photo's full natural resolution (not the
  // on-screen container size) so we don't lose detail, and so the result
  // matches the source photo's framing exactly. Tattoo coordinates picked in
  // display space are scaled up uniformly — possible because the container's
  // aspect ratio is locked to the body image's aspect ratio.
  async function handleConfirm() {
    setExporting(true);
    setExportError(null);
    try {
      const container = containerRef.current!;
      const cw = container.offsetWidth;

      const bodyImg = await loadImage(bodyPhotoUrl);
      const bw = bodyImg.naturalWidth;
      const bh = bodyImg.naturalHeight;
      if (bw === 0 || bh === 0) throw new Error("Body photo failed to load");

      const canvas = document.createElement("canvas");
      canvas.width = bw;
      canvas.height = bh;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bodyImg, 0, 0, bw, bh);

      // Display → image scale. Since container.aspectRatio === bw/bh, a single
      // uniform scale factor applies to both axes.
      const scale = bw / cw;

      const tattooImg = await loadImage(tattooImageUrl);
      const { pos: p, size: s, rotation: r } = stateRef.current;
      const tw = s * scale;
      const th = tattooAspect > 0 ? tw / tattooAspect : tw;
      const px = p.x * scale;
      const py = p.y * scale;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((r * Math.PI) / 180);
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(tattooImg, -tw / 2, -th / 2, tw, th);
      ctx.restore();

      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      onConfirm(dataUrl);
    } catch (err) {
      setExportError((err as Error).message ?? "Failed to capture placement. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted text-xs font-mono uppercase tracking-widest">Position Your Tattoo</p>

      {bodyAspect === null ? (
        <div
          className="rounded-xl border border-cleo-border bg-surface-2 flex items-center justify-center"
          style={{ aspectRatio: "4/3" }}
        >
          <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
      <div
        ref={containerRef}
        className="relative rounded-xl overflow-hidden border border-gold/30 select-none mx-auto bg-black"
        style={{ aspectRatio: bodyAspect, maxHeight: "70vh", maxWidth: "100%" }}
        onWheel={handleWheel}
      >
        {/* Body photo — `object-contain` is safe because the container's aspect
            ratio is locked to the image's natural aspect; this just guards
            against any sub-pixel rounding. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={bodyPhotoUrl} alt="Body" className="w-full h-full object-contain pointer-events-none" />

        {/* Tattoo overlay */}
        {initialized && size > 0 && (
          <div
            onPointerDown={handleDragDown}
            style={overlayStyle}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tattooImageUrl}
              alt="Tattoo"
              className="w-full h-full object-contain pointer-events-none"
              style={{ opacity: 0.88 }}
            />

            {/* Dashed selection border */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: "1.5px dashed rgba(201,168,76,0.75)",
                pointerEvents: "none",
                borderRadius: 2,
              }}
            />

            {/* Rotate handle — top center */}
            <div
              data-handle="rotate"
              onPointerDown={handleRotateDown}
              title="Rotate"
              style={{
                position: "absolute",
                top: -22,
                left: "50%",
                transform: "translateX(-50%)",
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#C9A84C",
                border: "2px solid white",
                cursor: "grab",
                touchAction: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                color: "#1a1a1a",
              }}
            >
              ↻
            </div>

            {/* Resize handle — bottom-right corner */}
            <div
              data-handle="resize"
              onPointerDown={handleResizeDown}
              title="Resize"
              style={{
                position: "absolute",
                bottom: -9,
                right: -9,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#C9A84C",
                border: "2px solid white",
                cursor: "se-resize",
                touchAction: "none",
              }}
            />
          </div>
        )}

        {/* Hint */}
        <div className="absolute bottom-2 left-2 right-2 flex justify-center pointer-events-none">
          <div className="bg-black/65 backdrop-blur-sm text-white/80 text-[10px] font-mono px-3 py-1 rounded-lg">
            Drag · Corner handle to resize · Top circle to rotate · Scroll to resize
          </div>
        </div>
      </div>
      )}

      {/* Export error */}
      {exportError && (
        <div className="bg-error/10 border border-error/30 rounded-xl px-4 py-3">
          <p className="text-error text-xs font-mono">{exportError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="flex-1 py-3 rounded-xl font-cinzel text-sm tracking-wide border border-cleo-border text-muted hover:text-ink hover:border-gold/40 transition-all cursor-pointer"
        >
          ↺ Change Photo
        </button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleConfirm}
          disabled={exporting}
          className="flex-1 bg-gold text-bg font-cinzel font-bold text-sm tracking-[0.08em] uppercase py-3 rounded-xl border border-gold hover:bg-gold-light transition-colors cursor-pointer disabled:opacity-60"
        >
          {exporting ? "Capturing…" : "✦ Confirm Placement"}
        </motion.button>
      </div>
    </div>
  );
}
