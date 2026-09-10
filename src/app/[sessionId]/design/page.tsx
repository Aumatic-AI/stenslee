"use client";

import { use, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useDropzone } from "react-dropzone";
import Image from "next/image";
import { useAppStore } from "@/store/app-store";
import type { DesignVariant } from "@/store/app-store";
import CameraCapture from "@/components/camera/CameraCapture";
import DesignPatternSVG from "@/components/design/DesignPatternSVG";
import StyleSelect from "@/components/ui/StyleSelect";
import PinterestSearch from "@/components/pinterest/PinterestSearch";
import { blobUrlToBase64 } from "@/lib/image-utils";
import { resolveImageSrc } from "@/lib/image-src";
import { TATTOO_COLORS } from "@/lib/tattoo-colors";
import { TypographyGenerator } from "@/components/typography/TypographyGenerator";

const SERVICE_UNAVAILABLE_MSG =
  "AI generation credits are exhausted. Please contact the admin to top up the credits and restore the service.";

// Pre-computed once at module load — avoids parseInt on every render cycle.
// Maps hex (uppercase) → check icon colour so light swatches stay readable.
const COLOUR_CHECK: Record<string, string> = Object.fromEntries(
  TATTOO_COLORS.map((c) => {
    const r = parseInt(c.hex.slice(1, 3), 16);
    const g = parseInt(c.hex.slice(3, 5), 16);
    const b = parseInt(c.hex.slice(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return [c.hex.toUpperCase(), lum > 0.55 ? "#0A0A0A" : "#F5F5F5"];
  })
);

const STAGE_MESSAGES = [
  "Reading your brief…",
  "Sketching variations in your style…",
  "Refining linework and shading…",
  "Polishing final details…",
];


export default function DesignPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();

  const {
    tattooStyle, setTattooStyle,
    tattooDescription, setTattooDescription,
    targetBodyArea, setTargetBodyArea,
    referenceImages, addReferenceImage, removeReferenceImage, replaceReferenceImage,
    selectedColors, toggleColor, clearColors,
    generatedDesigns, generateDesigns, addGeneratedDesign, finishGenerating,
    selectedDesigns, toggleDesignSelection, clearDesignSelection,
    selectDesign,
    refinementText, setRefinementText,
    isGenerating, iterationCount,
    customerName,
    persistDesigns,
    hydrateFromSession,
  } = useAppStore();

  const [hydrating, setHydrating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [totalSlots, setTotalSlots] = useState(5);
  // Per-slot failure tracking: each entry keeps the original stream `event.index`
  // so the same slot can be retried (or fail again) without losing its identity.
  const [failedSlots, setFailedSlots] = useState<Array<{ slotIndex: number; reason: string }>>([]);
  // Slot indices currently being retried (count: 1 re-generation in flight).
  const [retryingSlots, setRetryingSlots] = useState<Set<number>>(new Set());
  // Set when KEI reports exhausted credits — disables retries and shows a clear,
  // non-retryable banner instead of the generic "transient, tap retry" copy.
  const [creditsExhausted, setCreditsExhausted] = useState(false);
  // Snapshot of the designs that were selected when the last refinement was triggered.
  // Shown above the refined results grid so staff can compare source vs output.
  const [refineSourceDesigns, setRefineSourceDesigns] = useState<typeof selectedDesigns>([]);
  const prevDesignCountRef = useRef(0);

  // Tick elapsed seconds while a generation is in flight — used for the
  // progress UI so the user has an honest sense of wait time.
  useEffect(() => {
    if (!isGenerating) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isGenerating]);

  const stageIdx = Math.min(STAGE_MESSAGES.length - 1, Math.floor(elapsed / 25));
  const expectedSeconds = 120;
  const progressPct = Math.min(95, (elapsed / expectedSeconds) * 100);

  // ── Design mode: AI generation vs direct customer upload ──
  const [designMode, setDesignMode] = useState<"ai" | "direct">("ai");
  const [directImageUrl, setDirectImageUrl] = useState<string | null>(null);
  const [directImagePreview, setDirectImagePreview] = useState<string | null>(null);
  const [uploadingDirect, setUploadingDirect] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [proceedingDirect, setProceedingDirect] = useState(false);

  const [faithfulMode, setFaithfulMode] = useState(false);
  const [isTextTattoo, setIsTextTattoo] = useState(false);
  const [showTypographyModal, setShowTypographyModal] = useState(false);
  const [textTattooRefUrl, setTextTattooRefUrl] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedVariations, setEnhancedVariations] = useState<string[] | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"upload" | "camera" | "pinterest">("upload");
  const [showCamera, setShowCamera] = useState(false);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [viewingSourceIndex, setViewingSourceIndex] = useState<number | null>(null);
  // Maps blob URL → Pinterest pin ID so we can show an "Added" badge in the
  // search grid and prevent accidental duplicates. Cleared when the matching
  // reference image is removed.
  const [pinIdByUrl, setPinIdByUrl] = useState<Record<string, string>>({});
  const designsRef = useRef<HTMLDivElement>(null);
  const refinementRef = useRef<HTMLDivElement>(null);

  // Restore state from Supabase on mount (handles full-page reload mid-session).
  // The page renders immediately from localStorage (Zustand persist). Supabase
  // hydration runs in the background and fills in anything missing or stale.
  // Redirect only fires after hydration confirms data is genuinely absent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateFromSession(sessionId);
      if (!cancelled) setHydrating(true);
    })();
    return () => { cancelled = true; };
  }, [sessionId, hydrateFromSession]);

  useEffect(() => {
    // Wait until hydration has confirmed state before redirecting — prevents
    // a blank-store first render from bouncing the user away.
    if (hydrating && !customerName) router.replace("/");
  }, [hydrating, customerName, router]);

  // Scroll to grid when first image arrives
  useEffect(() => {
    if (prevDesignCountRef.current === 0 && generatedDesigns.length === 1) {
      setTimeout(() => designsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    }
    prevDesignCountRef.current = generatedDesigns.length;
  }, [generatedDesigns.length]);

  useEffect(() => {
    if (selectedDesigns.length > 0 && refinementRef.current) {
      setTimeout(() => refinementRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
    }
  }, [selectedDesigns.length]);

  // Keyboard nav for the lightbox
  useEffect(() => {
    if (viewingIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setViewingIndex(null);
      if (e.key === "ArrowRight") setViewingIndex((i) => (i === null ? null : (i + 1) % generatedDesigns.length));
      if (e.key === "ArrowLeft") setViewingIndex((i) => (i === null ? null : (i - 1 + generatedDesigns.length) % generatedDesigns.length));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewingIndex, generatedDesigns.length]);

  // Keyboard nav for the source designs lightbox
  useEffect(() => {
    if (viewingSourceIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setViewingSourceIndex(null);
      if (e.key === "ArrowRight") setViewingSourceIndex((i) => (i === null ? null : (i + 1) % refineSourceDesigns.length));
      if (e.key === "ArrowLeft") setViewingSourceIndex((i) => (i === null ? null : (i - 1 + refineSourceDesigns.length) % refineSourceDesigns.length));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewingSourceIndex, refineSourceDesigns.length]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp", ".heic"] },
    maxFiles: 5,
    onDrop: (files) => {
      files.forEach((f) => addReferenceImage(URL.createObjectURL(f)));
    },
  });

  function handleRemoveReference(index: number) {
    const url = referenceImages[index];
    if (url && pinIdByUrl[url]) {
      setPinIdByUrl((prev) => {
        const next = { ...prev };
        delete next[url];
        return next;
      });
    }
    removeReferenceImage(index);
  }

  async function handleAddPinterestPin(blobUrl: string, pin: { id: string }) {
    // Add the blob URL immediately so the UI responds instantly
    addReferenceImage(blobUrl);
    setPinIdByUrl((prev) => ({ ...prev, [blobUrl]: pin.id }));

    // Upload to Supabase Storage in the background so the image is
    // persisted permanently (blob URLs die on page refresh and can't
    // be listed from storage for the admin overview).
    try {
      const b64 = await blobUrlToBase64(blobUrl);
      const res = await fetch("/api/upload-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, image: b64 }),
      });

      if (res.ok) {
        const { url: permanentUrl } = await res.json();
        // Swap blob URL → permanent Supabase Storage URL
        replaceReferenceImage(blobUrl, permanentUrl);
        setPinIdByUrl((prev) => {
          const next = { ...prev };
          delete next[blobUrl];
          return { ...next, [permanentUrl]: pin.id };
        });
        URL.revokeObjectURL(blobUrl); // free browser memory
      }
    } catch (err) {
      console.warn("Pinterest image upload failed — keeping blob URL:", err);
      // Blob URL stays as fallback; image will still work for this session
    }
  }

  const addedPinIds = referenceImages
    .map((url) => pinIdByUrl[url])
    .filter((id): id is string => Boolean(id));

  // ── Typography Handler ────────────────────────────────────
  async function handleTypographyGenerated(dataUrl: string, font: string) {
    const b64 = dataUrl.split(",")[1];
    setUploadingDirect(true);
    try {
      const res = await fetch("/api/upload-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, image: b64, prefix: "designs" }),
      });
      if (!res.ok) throw new Error("Upload failed");
      const { url: permanentUrl } = await res.json();
      
      addReferenceImage(permanentUrl);
      setTextTattooRefUrl(permanentUrl);
      
      const { setTextTattooDetails } = useAppStore.getState();
      setTextTattooDetails(font);
      
      setShowTypographyModal(false);
    } catch (err) {
      console.error("Typography save failed:", err);
    } finally {
      setUploadingDirect(false);
    }
  }

  // ── Direct upload handlers ────────────────────────────────
  async function handleDirectFileDrop(files: File[]) {
    const file = files[0];
    if (!file) return;
    setDirectError(null);
    setUploadingDirect(true);

    // Show a local preview immediately
    const previewUrl = URL.createObjectURL(file);
    setDirectImagePreview(previewUrl);
    setDirectImageUrl(null);

    try {
      const b64 = await blobUrlToBase64(previewUrl);
      const res = await fetch("/api/upload-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, image: b64, prefix: "designs" }),
      });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      setDirectImageUrl(url);
      URL.revokeObjectURL(previewUrl);
      setDirectImagePreview(url);
    } catch (err) {
      setDirectError((err as Error).message);
      setDirectImagePreview(null);
    } finally {
      setUploadingDirect(false);
    }
  }

  async function handleProceedDirect() {
    if (!directImageUrl) return;
    setProceedingDirect(true);
    try {
      const design: DesignVariant = {
        id: `direct-${Date.now()}`,
        imageUrl: directImageUrl,
        gradient: gradients[0],
        patternType: "mandala",
        styleName: "Customer Design",
      };
      const [persisted] = await persistDesigns([design]);
      const finalDesign = persisted ?? design;
      finishGenerating([finalDesign]);
      selectDesign(finalDesign);
      router.push(`/${sessionId}/placement`);
    } catch (err) {
      setDirectError((err as Error).message);
      setProceedingDirect(false);
    }
  }

  const {
    getRootProps: getDirectRootProps,
    getInputProps: getDirectInputProps,
    isDragActive: isDirectDragActive,
  } = useDropzone({
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp", ".heic"] },
    maxFiles: 1,
    onDrop: handleDirectFileDrop,
  });

  const canGenerate = tattooDescription.trim().length > 0 && referenceImages.length > 0;
  const hasGenerated = generatedDesigns.length > 0;
  const hasSelection = selectedDesigns.length > 0;

  const gradients = [
    "radial-gradient(ellipse at 50% 40%, #4a0080 0%, #1a0030 40%, #0d0010 100%)",
    "radial-gradient(ellipse at 40% 35%, #8b0000 0%, #3a0000 40%, #0a0000 100%)",
    "radial-gradient(ellipse at 45% 45%, #1a2a4a 0%, #0a1a2a 50%, #000a0d 100%)",
    "radial-gradient(ellipse at 45% 45%, #c9a84c 0%, #6b4800 50%, #1a1000 100%)",
    "radial-gradient(ellipse at 55% 40%, #1a3a1a 0%, #0a1a08 50%, #000500 100%)",
  ];
  const placeholders = ["mandala", "geometric", "tribal", "floral", "dark"] as const;

  async function callGenerateAPI(payload: Record<string, unknown>) {
    const count = (payload.count as number) ?? 5;
    setGenError(null);
    setLastPayload(payload);
    setFailedSlots([]);
    setRetryingSlots(new Set());
    setCreditsExhausted(false);
    setTotalSlots(count);
    setViewingSourceIndex(null);
    prevDesignCountRef.current = 0;
    generateDesigns(); // clears generatedDesigns, sets isGenerating: true

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json();
        const detail = json.details ? ` (${Array.isArray(json.details) ? json.details.join("; ") : JSON.stringify(json.details)})` : "";
        throw new Error(`${json.error ?? "Generation failed"}${detail}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let designIndex = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: { type: string; index?: number; image?: { id: string; imageUrl: string }; reason?: string; code?: string };
          try { event = JSON.parse(line); } catch { continue; }

          if (event.type === "result" && event.image) {
            const i = designIndex++;
            const design: DesignVariant = {
              id: event.image.id,
              imageUrl: event.image.imageUrl,
              gradient: gradients[i % gradients.length],
              patternType: placeholders[i % placeholders.length],
              styleName: `Variation ${i + 1}${tattooStyle ? ` — ${tattooStyle}` : ""}`,
            };
            // Persist to DB then add to store so it's immediately visible
            persistDesigns([design]).then(([persisted]) => {
              addGeneratedDesign(persisted ?? design);
            });
          } else if (event.type === "error") {
            const slotIndex = event.index ?? 0;
            console.warn(`[generate] slot ${slotIndex} failed:`, event.reason);
            if (event.code === "insufficient_credits") setCreditsExhausted(true);
            setFailedSlots((prev) => [...prev, { slotIndex, reason: event.reason ?? "Generation failed" }]);
          } else if (event.type === "done") {
            finishGenerating(); // sets isGenerating: false, keeps accumulated designs
          }
        }
      }
    } catch (err) {
      console.error("Generation error:", err);
      setGenError((err as Error).message);
      finishGenerating(); // keep any images that already arrived
    }
  }

  function handleRetryGenerate() {
    if (lastPayload) callGenerateAPI(lastPayload);
  }

  // Per-slot retry — fires a single-slot generation using the original payload
  // and keeps the original slotIndex so the failed card can be re-shown if it
  // fails again. Runs independently of the main stream; safe to invoke before
  // or after the main generation has finished.
  async function handleRetrySlot(slotIndex: number) {
    if (!lastPayload || retryingSlots.has(slotIndex) || creditsExhausted) return;
    setFailedSlots((prev) => prev.filter((s) => s.slotIndex !== slotIndex));
    setRetryingSlots((prev) => {
      const next = new Set(prev);
      next.add(slotIndex);
      return next;
    });

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lastPayload, count: 1 }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Retry failed (${res.status})`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotResult = false;
      let gotError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: { type: string; image?: { id: string; imageUrl: string }; reason?: string; code?: string };
          try { event = JSON.parse(line); } catch { continue; }

          if (event.type === "result" && event.image) {
            // Slot the retried image into the same visual position as the
            // failed card by using the original slotIndex for naming/palette.
            const design: DesignVariant = {
              id: event.image.id,
              imageUrl: event.image.imageUrl,
              gradient: gradients[slotIndex % gradients.length],
              patternType: placeholders[slotIndex % placeholders.length],
              styleName: `Variation ${slotIndex + 1}${tattooStyle ? ` — ${tattooStyle}` : ""}`,
            };
            persistDesigns([design]).then(([persisted]) => {
              addGeneratedDesign(persisted ?? design);
            });
            gotResult = true;
          } else if (event.type === "error") {
            if (event.code === "insufficient_credits") setCreditsExhausted(true);
            gotError = event.reason ?? "Generation failed";
          }
        }
      }

      if (!gotResult) {
        setFailedSlots((prev) => [...prev, { slotIndex, reason: gotError ?? "No image returned" }]);
      }
    } catch (err) {
      setFailedSlots((prev) => [...prev, { slotIndex, reason: (err as Error).message }]);
    } finally {
      setRetryingSlots((prev) => {
        const next = new Set(prev);
        next.delete(slotIndex);
        return next;
      });
    }
  }

  // Split references into local (blob:/data: → needs base64 conversion) and
  // already-hosted (https → pass through as URL). Pinterest pins start as blob URLs
  // but are swapped to permanent Supabase URLs by replaceReferenceImage once their
  // background upload completes — sending those as base64 corrupts them.
  async function splitReferences(): Promise<{ images: string[]; urls: string[] }> {
    const local = referenceImages.filter((r) => r.startsWith("blob:") || r.startsWith("data:"));
    const urls = referenceImages.filter((r) => !r.startsWith("blob:") && !r.startsWith("data:"));
    // Convert all local blobs in parallel instead of sequentially
    const images = await Promise.all(local.map((r) => blobUrlToBase64(r)));
    return { images, urls };
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    setRefineSourceDesigns([]);
    const { images, urls } = await splitReferences();
    const { textTattooFont } = useAppStore.getState();
    
    callGenerateAPI({
      sessionId,
      description: tattooDescription,
      style: tattooStyle,
      images,
      referenceImageUrls: urls,
      isTextTattoo,
      colors: selectedColors,
      targetBodyArea,
      count: 5,
      ...(isTextTattoo && textTattooFont
        ? { textTattooFont } 
        : {}),
    });
  }

  async function handleRefine() {
    if (!refinementText.trim() || selectedDesigns.length === 0) return;

    setRefineSourceDesigns([...selectedDesigns]);

    const refineImageUrls = selectedDesigns
      .map((d) => d.imageUrl)
      .filter((url): url is string => !!url);

    const selectedDesignNames = selectedDesigns.map((d) => d.styleName);
    const { images, urls } = await splitReferences();

    callGenerateAPI({
      sessionId,
      description: tattooDescription,
      style: tattooStyle,
      images,
      referenceImageUrls: urls,
      refineImageUrls,
      refinementText,
      faithfulMode,
      isTextTattoo,
      selectedDesignNames,
      colors: selectedColors,
      targetBodyArea,
      count: 5,
    });
  }

  function handleProceed() {
    // Use first selected design as the primary
    const primary = selectedDesigns[0];
    if (primary) {
      selectDesign(primary);
      router.push(`/${sessionId}/placement`);
    }
  }

  const viewingDesign = viewingIndex !== null ? generatedDesigns[viewingIndex] : null;
  const viewingIsSelected = viewingDesign ? selectedDesigns.some((d) => d.id === viewingDesign.id) : false;
  const viewingSelectionOrder = viewingDesign ? selectedDesigns.findIndex((d) => d.id === viewingDesign.id) + 1 : 0;
  const viewingCanSelect = !viewingIsSelected && selectedDesigns.length < 4;

  return (
    <>
      <AnimatePresence>
        {showCamera && (
          <CameraCapture
            onCapture={(url) => {
              setShowCamera(false);
              if (designMode === "direct") {
                // In direct mode, camera capture is the design itself
                setDirectImagePreview(url);
                setDirectImageUrl(null);
                blobUrlToBase64(url).then((b64) =>
                  fetch("/api/upload-ref", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionId, image: b64, prefix: "designs" }),
                  })
                  .then((r) => r.json())
                  .then(({ url: permanentUrl }) => { setDirectImageUrl(permanentUrl); setDirectImagePreview(permanentUrl); })
                  .catch(() => setDirectError("Upload failed — please try again"))
                );
              } else {
                addReferenceImage(url);
              }
            }}
            onClose={() => setShowCamera(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Typography Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {showTypographyModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-xl my-auto"
            >
              <TypographyGenerator
                onDesignGenerated={handleTypographyGenerated}
                onCancel={() => {
                  setShowTypographyModal(false);
                  setIsTextTattoo(false); // Cancel means we didn't add the text
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Design lightbox modal ─────────────────────────────────── */}
      <AnimatePresence>
        {viewingDesign && (
          <motion.div
            key="lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setViewingIndex(null)}
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
          >
            {/* Close button */}
            <button
              onClick={(e) => { e.stopPropagation(); setViewingIndex(null); }}
              className="absolute top-4 right-4 sm:top-6 sm:right-6 w-10 h-10 rounded-full bg-surface/80 border border-cleo-border text-ink hover:bg-error/20 hover:border-error/40 hover:text-error transition-colors flex items-center justify-center text-xl leading-none z-10 cursor-pointer"
              aria-label="Close"
            >
              ×
            </button>

            {/* Prev */}
            {generatedDesigns.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewingIndex((i) => (i === null ? null : (i - 1 + generatedDesigns.length) % generatedDesigns.length));
                }}
                className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-surface/80 border border-cleo-border text-ink hover:bg-gold/20 hover:border-gold/40 hover:text-gold transition-colors flex items-center justify-center z-10 cursor-pointer"
                aria-label="Previous design"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}

            {/* Next */}
            {generatedDesigns.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewingIndex((i) => (i === null ? null : (i + 1) % generatedDesigns.length));
                }}
                className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-surface/80 border border-cleo-border text-ink hover:bg-gold/20 hover:border-gold/40 hover:text-gold transition-colors flex items-center justify-center z-10 cursor-pointer"
                aria-label="Next design"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            {/* Content card */}
            <motion.div
              key={viewingDesign.id}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-3xl flex flex-col gap-4 max-h-[90vh]"
            >
              {/* Image */}
              <div
                className="relative rounded-2xl overflow-hidden border-2 border-gold/30 shadow-[0_0_60px_rgba(201,168,76,0.25)]"
                style={{ background: viewingDesign.gradient }}
              >
                <div className="aspect-square max-h-[68vh] mx-auto relative">
                  {viewingDesign.imageUrl ? (
                    <Image
                      src={viewingDesign.imageUrl}
                      alt={viewingDesign.styleName}
                      fill
                      priority
                      unoptimized
                      sizes="(max-width: 768px) 100vw, 68vh"
                      className="object-contain"
                    />
                  ) : (
                    <DesignPatternSVG type={viewingDesign.patternType} />
                  )}
                </div>

                {/* Badges */}
                <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm text-ink/80 text-xs font-mono px-2.5 py-1 rounded-lg">
                  #{viewingIndex! + 1} of {generatedDesigns.length}
                </div>
                {viewingIsSelected && (
                  <div className="absolute top-3 right-3 w-9 h-9 rounded-full bg-gold shadow-lg flex items-center justify-center">
                    <span className="text-bg text-sm font-black font-mono">{viewingSelectionOrder}</span>
                  </div>
                )}
              </div>

              {/* Info + Action bar */}
              <div className="bg-surface border border-cleo-border rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-cinzel text-base sm:text-lg font-bold text-ink leading-tight truncate">
                    {viewingDesign.styleName}
                  </p>
                  <p className="text-muted text-xs mt-0.5">
                    {viewingIsSelected
                      ? `Currently selected — position #${viewingSelectionOrder}`
                      : viewingCanSelect
                      ? "Tap select to add this design to your selection"
                      : "Selection limit reached (4) — deselect another to add this"}
                  </p>
                </div>

                <motion.button
                  whileHover={viewingIsSelected || viewingCanSelect ? { scale: 1.03 } : {}}
                  whileTap={viewingIsSelected || viewingCanSelect ? { scale: 0.97 } : {}}
                  onClick={() => {
                    if (viewingIsSelected || viewingCanSelect) {
                      toggleDesignSelection(viewingDesign);
                    }
                  }}
                  disabled={!viewingIsSelected && !viewingCanSelect}
                  className={[
                    "px-6 py-3 rounded-xl font-cinzel font-bold text-sm tracking-[0.08em] uppercase border transition-colors cursor-pointer whitespace-nowrap",
                    viewingIsSelected
                      ? "bg-surface-2 border-error/40 text-error hover:bg-error/10"
                      : viewingCanSelect
                      ? "bg-gold border-gold text-bg hover:bg-gold-light shadow-[0_0_20px_rgba(201,168,76,0.3)]"
                      : "bg-surface-2 border-cleo-border text-muted cursor-not-allowed",
                  ].join(" ")}
                >
                  {viewingIsSelected ? "✕ Deselect" : viewingCanSelect ? "✓ Select" : "Limit Reached"}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Source designs lightbox ───────────────────────────────────── */}
      <AnimatePresence>
        {viewingSourceIndex !== null && refineSourceDesigns[viewingSourceIndex] && (() => {
          const src = refineSourceDesigns[viewingSourceIndex];
          return (
            <motion.div
              key="source-lightbox"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setViewingSourceIndex(null)}
              className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
            >
              <button
                onClick={(e) => { e.stopPropagation(); setViewingSourceIndex(null); }}
                className="absolute top-4 right-4 sm:top-6 sm:right-6 w-10 h-10 rounded-full bg-surface/80 border border-cleo-border text-ink hover:bg-error/20 hover:border-error/40 hover:text-error transition-colors flex items-center justify-center text-xl leading-none z-10 cursor-pointer"
                aria-label="Close"
              >
                ×
              </button>

              {refineSourceDesigns.length > 1 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setViewingSourceIndex((i) => (i === null ? null : (i - 1 + refineSourceDesigns.length) % refineSourceDesigns.length)); }}
                    className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-surface/80 border border-cleo-border text-ink hover:bg-gold/20 hover:border-gold/40 hover:text-gold transition-colors flex items-center justify-center z-10 cursor-pointer"
                    aria-label="Previous"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setViewingSourceIndex((i) => (i === null ? null : (i + 1) % refineSourceDesigns.length)); }}
                    className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-surface/80 border border-cleo-border text-ink hover:bg-gold/20 hover:border-gold/40 hover:text-gold transition-colors flex items-center justify-center z-10 cursor-pointer"
                    aria-label="Next"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </button>
                </>
              )}

              <motion.div
                key={src.id}
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-3xl flex flex-col gap-4 max-h-[90vh]"
              >
                <div
                  className="relative rounded-2xl overflow-hidden border-2 border-gold/30 shadow-[0_0_60px_rgba(201,168,76,0.25)]"
                  style={{ background: src.gradient }}
                >
                  <div className="aspect-square max-h-[68vh] mx-auto relative">
                    {src.imageUrl ? (
                      <Image src={src.imageUrl} alt={src.styleName} fill priority unoptimized sizes="(max-width: 768px) 100vw, 68vh" className="object-contain" />
                    ) : (
                      <DesignPatternSVG type={src.patternType} />
                    )}
                  </div>
                  <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm text-ink/80 text-xs font-mono px-2.5 py-1 rounded-lg">
                    Refined from · {refineSourceDesigns.length > 1 ? `${viewingSourceIndex + 1} of ${refineSourceDesigns.length}` : "source"}
                  </div>
                </div>
                <div className="bg-surface border border-cleo-border rounded-2xl p-4 sm:p-5">
                  <p className="font-cinzel text-base sm:text-lg font-bold text-ink leading-tight">{src.styleName}</p>
                  <p className="text-muted text-xs mt-0.5">This design was used as the refinement source</p>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 page-with-mobile-footer flex flex-col gap-6 sm:gap-8">
        {/* Heading */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <p className="text-gold text-[11px] sm:text-xs font-mono tracking-[0.2em] uppercase mb-1.5">Step 1 of 2 — Design</p>
          <h1 className="font-cinzel text-xl sm:text-3xl font-black text-ink leading-tight">
            {designMode === "ai" ? "Describe your tattoo" : "Upload existing design"}
          </h1>
          <p className="text-muted text-xs sm:text-sm mt-1.5 sm:mt-2 leading-relaxed">
            {designMode === "ai"
              ? "Choose a style, describe your idea, and optionally add a reference image."
              : "Customer has a ready design — upload it and proceed directly to placement."}
          </p>
        </motion.div>

        {/* ── Mode switcher ──────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.04 }}
          className="flex gap-2 p-1 bg-surface rounded-xl border border-cleo-border w-full flex-wrap sm:flex-nowrap sm:w-fit">
          {[
            { 
              mode: "ai" as const, 
              label: "AI Design", 
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              )
            },

            { 
              mode: "direct" as const, 
              label: "Upload Existing", 
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              )
            },
          ].map(({ mode: m, label, icon }) => (
            <button
              key={m}
              onClick={() => setDesignMode(m)}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-cinzel font-bold text-xs tracking-[0.08em] uppercase transition-all cursor-pointer whitespace-nowrap ${
                designMode === m
                  ? "bg-gold text-bg shadow-[0_0_12px_rgba(201,168,76,0.3)]"
                  : "text-muted hover:text-ink hover:bg-surface-2"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </motion.div>

        {/* ── Direct upload card ─────────────────────────────────── */}
        {designMode === "direct" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="bg-surface rounded-2xl border border-cleo-border p-4 sm:p-6 flex flex-col gap-5"
          >
            {!directImagePreview ? (
              /* Drop zone */
              <div
                {...getDirectRootProps()}
                className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed py-14 px-6 text-center cursor-pointer transition-colors ${
                  isDirectDragActive ? "border-gold bg-gold/5" : "border-cleo-border hover:border-gold/50 hover:bg-surface-2"
                }`}
              >
                <input {...getDirectInputProps()} />
                {uploadingDirect ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                    <p className="text-muted text-sm font-mono">Uploading…</p>
                  </div>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center">
                      <svg className="w-6 h-6 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-ink font-cinzel font-bold text-sm">
                        {isDirectDragActive ? "Drop the image here" : "Drop the design image"}
                      </p>
                      <p className="text-muted text-xs mt-1">or click to browse · JPG, PNG, WEBP</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCamera(true);
                      }}
                      className="text-xs font-mono text-muted hover:text-gold transition-colors underline underline-offset-2 cursor-pointer"
                    >
                      Use camera instead
                    </button>
                  </>
                )}
              </div>
            ) : (
              /* Preview + actions */
              <div className="flex flex-col gap-4">
                <div className="relative rounded-xl overflow-hidden border-2 border-gold/40 aspect-square max-h-72 mx-auto w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={directImagePreview} alt="Customer design" className="w-full h-full object-contain bg-surface-2" />
                  {uploadingDirect && (
                    <div className="absolute inset-0 bg-bg/70 flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  <button
                    onClick={() => { setDirectImagePreview(null); setDirectImageUrl(null); setDirectError(null); }}
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-bg/80 border border-cleo-border text-muted hover:text-error transition-colors flex items-center justify-center text-lg cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                {directError && (
                  <p className="text-error text-sm font-mono text-center">{directError}</p>
                )}

                <motion.button
                  onClick={handleProceedDirect}
                  disabled={!directImageUrl || uploadingDirect || proceedingDirect}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  className="w-full py-4 bg-gold text-bg font-cinzel font-bold text-base tracking-[0.1em] uppercase rounded-xl border border-gold hover:bg-gold-light transition-colors shadow-[0_0_24px_rgba(201,168,76,0.2)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {proceedingDirect ? "Saving…" : uploadingDirect ? "Uploading…" : "✦ Proceed to Placement →"}
                </motion.button>
              </div>
            )}
          </motion.div>
        )}

        {/* ── AI Design mode content ────────────────────────────── */}
        {designMode === "ai" && <>

        {/* ── Input card ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="bg-surface rounded-2xl border border-cleo-border p-4 sm:p-6 flex flex-col gap-5"
        >
          {/* Style picker */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">
              Tattoo Style <span className="text-muted/50 normal-case">(optional but recommended)</span>
            </label>
            <StyleSelect value={tattooStyle} onChange={setTattooStyle} />
          </div>

          {/* Body placement hint */}
          <BodyAreaPicker value={targetBodyArea} onChange={setTargetBodyArea} />

          {/* Description */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">Describe your tattoo</label>
              {tattooDescription.trim().length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    setEnhancing(true);
                    setEnhancedVariations(null);
                    setEnhanceError(null);
                    try {
                      const res = await fetch("/api/enhance-prompt", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ description: tattooDescription, style: tattooStyle }),
                      });
                      const json = await res.json();
                      if (!res.ok) throw new Error(json.error ?? "Enhancement failed");
                      setEnhancedVariations(json.variations);
                    } catch (err) {
                      setEnhanceError((err as Error).message);
                    } finally {
                      setEnhancing(false);
                    }
                  }}
                  disabled={enhancing}
                  className="flex items-center gap-1.5 text-[10px] font-cinzel font-bold tracking-[0.08em] uppercase text-gold hover:text-gold-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {enhancing ? (
                    <>
                      <div className="w-3 h-3 border border-gold border-t-transparent rounded-full animate-spin" />
                      Enhancing…
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                      Enhance with AI
                    </>
                  )}
                </button>
              )}
            </div>
            <textarea
              rows={4}
              placeholder={
                tattooStyle
                  ? `Describe your ${tattooStyle} tattoo… e.g. A fierce lion face with a detailed mane, surrounded by geometric shapes and fine line roses…`
                  : "e.g. A detailed mandala with lotus petals, geometric outer rings, and a crescent moon at the top. Fine lines, sacred geometry feel…"
              }
              value={tattooDescription}
              onChange={(e) => { setTattooDescription(e.target.value); setEnhancedVariations(null); setEnhanceError(null); }}
              className="bg-bg border border-cleo-border rounded-xl px-4 py-3.5 text-ink text-sm placeholder:text-muted/50 focus:border-gold focus:outline-none transition-colors resize-none leading-relaxed"
            />

            {/* Enhance error */}
            {enhanceError && (
              <p className="text-error text-[10px] font-mono">{enhanceError}</p>
            )}

            {/* Enhanced variations panel */}
            <AnimatePresence>
              {enhancedVariations && enhancedVariations.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-mono tracking-[0.15em] uppercase text-gold">
                      ✦ {enhancedVariations.length} enhanced versions — tap to use
                    </p>
                    <button
                      type="button"
                      onClick={() => setEnhancedVariations(null)}
                      className="text-muted hover:text-ink text-xs transition-colors cursor-pointer"
                    >
                      ✕ Dismiss
                    </button>
                  </div>
                  {enhancedVariations.map((variation, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setTattooDescription(variation); setEnhancedVariations(null); }}
                      className="text-left w-full bg-bg border border-cleo-border hover:border-gold/50 hover:bg-gold/5 rounded-xl px-4 py-3 transition-colors cursor-pointer group"
                    >
                      <p className="text-[10px] font-mono text-gold/70 mb-1 group-hover:text-gold transition-colors">
                        Version {i + 1}
                      </p>
                      <p className="text-ink text-xs leading-relaxed">{variation}</p>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Text tattoo toggle */}
          <div className="flex items-center gap-3 p-3 bg-bg rounded-xl border border-cleo-border">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-cinzel font-bold text-ink leading-tight">
                Text Tattoo Mode
              </p>
              <p className="text-muted text-[10px] mt-0.5 leading-snug">
                {isTextTattoo
                  ? "Uses a text-optimised model — accurate fonts, lettering & mixed elements"
                  : "Turn on if the tattoo contains words, names, quotes, or lettering"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = !isTextTattoo;
                setIsTextTattoo(next);
                if (next) {
                  setShowTypographyModal(true);
                } else {
                  if (textTattooRefUrl) {
                    const idx = referenceImages.indexOf(textTattooRefUrl);
                    if (idx !== -1) {
                      removeReferenceImage(idx);
                    }
                    setTextTattooRefUrl(null);
                    const { setTextTattooDetails } = useAppStore.getState();
                    setTextTattooDetails(null);
                  }
                }
              }}
              aria-pressed={isTextTattoo}
              className={`flex-shrink-0 w-11 h-6 rounded-full border transition-colors cursor-pointer flex items-center px-0.5 ${
                isTextTattoo
                  ? "bg-gold border-gold justify-end"
                  : "bg-surface-2 border-cleo-border justify-start"
              }`}
            >
              <span className={`w-5 h-5 rounded-full shadow transition-all ${isTextTattoo ? "bg-bg" : "bg-muted"}`} />
            </button>
          </div>

          {/* Colour palette */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">
                Palette <span className="text-muted/40 normal-case">(optional)</span>
              </label>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className={selectedColors.length > 0 ? "text-gold" : "text-muted/60"}>
                  {selectedColors.length === 0
                    ? "Black & grey"
                    : `${selectedColors.length} ink${selectedColors.length === 1 ? "" : "s"}`}
                </span>
                {selectedColors.length > 0 && (
                  <button
                    onClick={() => clearColors()}
                    className="text-muted hover:text-gold transition-colors uppercase tracking-wider cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5 scrollbar-thin">
              {TATTOO_COLORS.map((c) => {
                const isSelected = selectedColors.some(
                  (h) => h.toUpperCase() === c.hex.toUpperCase()
                );
                const checkColor = COLOUR_CHECK[c.hex.toUpperCase()] ?? "#F5F5F5";

                return (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => toggleColor(c.hex)}
                    title={`${c.name} — ${c.usage}`}
                    aria-label={`${c.name} ${isSelected ? "(selected)" : ""}`}
                    aria-pressed={isSelected}
                    className={[
                      "group relative flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-md cursor-pointer transition-all duration-150",
                      "ring-1 ring-inset",
                      isSelected
                        ? "ring-gold shadow-[0_0_0_2px_rgba(201,168,76,0.35)] -translate-y-0.5"
                        : "ring-white/10 hover:ring-gold/50 hover:-translate-y-0.5",
                    ].join(" ")}
                    style={{ backgroundColor: c.hex }}
                  >
                    {isSelected && (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={checkColor}
                        strokeWidth={3.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="absolute inset-1 pointer-events-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {/* Hover tooltip — anchored ABOVE the swatch so it never collides with the next row */}
                    <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 whitespace-nowrap text-[10px] font-mono text-ink bg-bg border border-cleo-border px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg">
                      {c.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reference images */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">
                  Reference Images <span className="text-error/70 normal-case font-mono">*required</span>
                </label>
                {referenceImages.length > 0 && (
                  <span className="text-[10px] font-mono text-gold bg-gold/10 border border-gold/30 px-2 py-0.5 rounded-full">
                    {referenceImages.length}/5
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 bg-bg rounded-lg border border-cleo-border p-0.5 w-full sm:w-auto">
                {(["upload", "camera", "pinterest"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setInputMode(mode)}
                    className={`flex-1 sm:flex-none px-2 sm:px-3 py-1.5 sm:py-1 rounded-md text-[11px] sm:text-xs font-cinzel tracking-wide transition-all whitespace-nowrap ${inputMode === mode ? "bg-gold text-bg font-bold" : "text-muted hover:text-ink"}`}
                  >
                    {mode === "upload" ? "📁 Upload" : mode === "camera" ? "📷 Camera" : "🔍 Pinterest"}
                  </button>
                ))}
              </div>
            </div>

            {/* Uploaded thumbnails grid */}
            <AnimatePresence>
              {referenceImages.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="grid grid-cols-3 sm:grid-cols-5 gap-2"
                >
                  {referenceImages.map((url, i) => (
                    <motion.div
                      key={url}
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{ duration: 0.2 }}
                      className="relative group rounded-xl overflow-hidden border border-cleo-border bg-surface-2"
                      style={{ aspectRatio: "1" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Reference ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => handleRemoveReference(i)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center leading-none shadow-sm"
                      >
                        ×
                      </button>
                      <div className="absolute bottom-1 left-1 bg-black/60 text-white/70 text-[9px] font-mono px-1.5 py-0.5 rounded">
                        {i + 1}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Add more / first upload */}
            <AnimatePresence mode="wait">
              {referenceImages.length < 5 && inputMode === "upload" && (
                <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div
                    {...getRootProps()}
                    className={`rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                      isDragActive ? "border-gold bg-gold/5" : "border-cleo-border hover:border-gold/40"
                    } ${referenceImages.length > 0 ? "py-4" : "py-7"}`}
                  >
                    <input {...getInputProps()} />
                    <div className="flex items-center justify-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-gold text-lg flex-shrink-0">+</div>
                      {referenceImages.length === 0 ? (
                        <div>
                          <p className="text-ink text-sm font-cinzel">Drop images or click to browse</p>
                          <p className="text-muted text-xs">Up to 5 photos — JPEG, PNG, WEBP, HEIC</p>
                        </div>
                      ) : (
                        <p className="text-muted text-sm font-cinzel">
                          Add more photos ({5 - referenceImages.length} remaining)
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
              {referenceImages.length < 5 && inputMode === "camera" && (
                <motion.div key="camera" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <button
                    onClick={() => setShowCamera(true)}
                    className={`w-full rounded-xl border-2 border-dashed border-cleo-border hover:border-gold/40 transition-all ${referenceImages.length > 0 ? "py-4" : "py-7"}`}
                  >
                    <div className="flex items-center justify-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-xl flex-shrink-0">📷</div>
                      {referenceImages.length === 0 ? (
                        <div className="text-left">
                          <p className="text-ink text-sm font-cinzel">Open Camera</p>
                          <p className="text-muted text-xs">Take a live reference photo</p>
                        </div>
                      ) : (
                        <p className="text-muted text-sm font-cinzel">
                          Take another photo ({5 - referenceImages.length} remaining)
                        </p>
                      )}
                    </div>
                  </button>
                </motion.div>
              )}
              {inputMode === "pinterest" && (
                <motion.div key="pinterest" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <PinterestSearch
                    onAdd={handleAddPinterestPin}
                    remainingSlots={5 - referenceImages.length}
                    addedPinIds={addedPinIds}
                  />
                </motion.div>
              )}
              {referenceImages.length >= 5 && inputMode !== "pinterest" && (
                <motion.div key="full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-2">
                  <p className="text-muted text-xs font-mono">Maximum 5 reference images reached</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Service-unavailable (out of credits) — non-retryable, no Retry button */}
          {creditsExhausted && (
            <div className="bg-error/10 border border-error/40 rounded-xl px-4 py-3 flex items-start gap-3">
              <svg className="w-5 h-5 text-error flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-error text-xs font-cinzel leading-relaxed">{SERVICE_UNAVAILABLE_MSG}</p>
            </div>
          )}

          {/* Error */}
          {genError && !isGenerating && !creditsExhausted && (
            <div className="bg-error/10 border border-error/30 rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-error text-xs font-mono leading-relaxed break-words">{genError}</p>
                <p className="text-muted text-[10px] mt-1">
                  Usually a transient AI service issue. Tap Retry to try again.
                </p>
              </div>
              <button
                onClick={handleRetryGenerate}
                disabled={isGenerating || !lastPayload}
                className="flex-shrink-0 bg-gold text-bg font-cinzel font-bold text-[10px] tracking-[0.1em] uppercase px-3 py-2 rounded-lg border border-gold hover:bg-gold-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ↺ Retry
              </button>
            </div>
          )}

          {/* Generate button */}
          <motion.button
            whileHover={canGenerate && !isGenerating ? { scale: 1.02 } : {}}
            whileTap={canGenerate && !isGenerating ? { scale: 0.97 } : {}}
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
            className={`w-full py-4 rounded-xl font-cinzel font-bold text-base tracking-[0.08em] uppercase transition-all border ${
              canGenerate && !isGenerating
                ? "bg-gold text-bg border-gold hover:bg-gold-light cursor-pointer"
                : "bg-surface-2 text-muted border-cleo-border cursor-not-allowed"
            }`}
          >
            {isGenerating
              ? "Generating…"
              : hasGenerated
              ? "✦ Regenerate from Scratch"
              : !tattooDescription.trim()
              ? "Describe your tattoo first"
              : referenceImages.length === 0
              ? "Add a reference image to generate"
              : "✦ Generate Tattoo Designs"}
          </motion.button>
        </motion.div>

        </>} {/* end designMode === "ai" Input Card */}

        {(designMode === "ai") && <>

        {/* ── Loading spinner — only while no images have arrived yet ─── */}
        <AnimatePresence>
          {isGenerating && generatedDesigns.length === 0 && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 py-10"
            >
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-2 border-gold/15 animate-ping" />
                <div className="absolute inset-2 rounded-full border-2 border-gold/30 animate-spin" style={{ animationDuration: "2s" }} />
                <div className="absolute inset-4 rounded-full border-2 border-gold animate-spin" style={{ animationDuration: "1.2s", animationDirection: "reverse" }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-gold animate-pulse" />
                </div>
              </div>
              <div className="text-center">
                <p className="font-cinzel text-lg font-bold text-ink">
                  {iterationCount > 1 ? `Refining — Pass ${iterationCount}…` : "Crafting Your Designs…"}
                </p>
                <motion.p
                  key={stageIdx}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-muted text-sm mt-1"
                >
                  {STAGE_MESSAGES[stageIdx]}
                </motion.p>
                <p className="text-muted/60 text-[10px] font-mono tracking-widest mt-3 uppercase">
                  {elapsed}s elapsed · usually takes 1–2 min
                </p>
              </div>
              <div className="w-64 h-1 bg-surface-2 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gold rounded-full"
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3 w-full max-w-lg">
                {Array.from({ length: totalSlots }).map((_, i) => (
                  <div key={i} className="rounded-xl overflow-hidden border border-cleo-border">
                    <div className="aspect-square skeleton" />
                    <div className="p-2 bg-surface"><div className="h-2 skeleton rounded w-12" /></div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Design grid — shown as soon as first image arrives ──────── */}
        <AnimatePresence>
          {hasGenerated && (
            <motion.div
              key={`designs-${iterationCount}`}
              ref={designsRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col gap-5"
            >
              {/* Refined-from strip — shown when this is a refinement pass */}
              {iterationCount > 1 && refineSourceDesigns.length > 0 && (
                <div className="flex flex-col gap-2.5 p-3 sm:p-4 bg-bg rounded-xl border border-cleo-border/60">
                  <p className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">
                    Refined from
                  </p>
                  <div className="flex items-start gap-3 flex-wrap">
                    {refineSourceDesigns.map((d, i) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setViewingSourceIndex(i)}
                        className="group flex flex-col gap-1.5 cursor-pointer"
                      >
                        <div
                          className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border-2 border-cleo-border group-hover:border-gold/50 transition-colors relative flex-shrink-0"
                          style={{ background: d.gradient }}
                        >
                          {d.imageUrl ? (
                            <Image
                              src={d.imageUrl}
                              alt={d.styleName}
                              fill
                              unoptimized
                              sizes="112px"
                              className="object-cover"
                            />
                          ) : (
                            <DesignPatternSVG type={d.patternType} />
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-mono">🔍 View</span>
                          </div>
                        </div>
                        <p className="text-muted text-[10px] font-cinzel text-center w-24 sm:w-28 truncate group-hover:text-ink transition-colors">
                          {refineSourceDesigns.length > 1 ? `Image ${i + 1}` : d.styleName}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Header row */}
              <div className="flex items-start sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-cinzel text-lg sm:text-xl font-bold text-ink leading-tight">
                    {iterationCount > 1 ? `Refined Designs — Pass ${iterationCount}` : "Your Designs"}
                  </h2>
                  <p className="text-muted text-[11px] sm:text-xs mt-0.5 leading-snug">
                    {hasSelection
                      ? isGenerating
                        ? `${selectedDesigns.length} selected — proceed now or wait for the rest`
                        : `${selectedDesigns.length} selected — refine or proceed`
                      : isGenerating
                      ? `${generatedDesigns.length} of ${totalSlots} ready · still generating…`
                      : "Tap a design to view it full-size, then select"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                  {hasSelection && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={() => clearDesignSelection()}
                      className="text-muted text-[11px] font-cinzel tracking-wide hover:text-gold transition-colors px-2 py-1 rounded border border-cleo-border hover:border-gold/40 cursor-pointer"
                    >
                      Clear
                    </motion.button>
                  )}
                  <span className={`text-[10px] font-mono px-2 sm:px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors ${
                    hasSelection
                      ? "text-gold border-gold/40 bg-gold/10"
                      : "text-muted border-cleo-border"
                  }`}>
                    {hasSelection
                      ? `${selectedDesigns.length} / 4`
                      : isGenerating
                      ? `${generatedDesigns.length} / ${totalSlots}`
                      : `${generatedDesigns.length} variation${generatedDesigns.length === 1 ? "" : "s"}`}
                  </span>
                </div>
              </div>

              {/* Grid — real cards + skeleton placeholders during streaming */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                {/* Real design cards */}
                {generatedDesigns.map((design, i) => {
                  const selectionIndex = selectedDesigns.findIndex((d) => d.id === design.id);
                  const isSelected = selectionIndex !== -1;
                  const selectionOrder = selectionIndex + 1;
                  const canSelect = !isSelected && selectedDesigns.length < 4;

                  return (
                    <motion.div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setViewingIndex(i);
                        }
                      }}
                      key={design.id}
                      initial={{ opacity: 0, scale: 0.88, y: 14 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                      whileHover={{ scale: 1.03, y: -3 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setViewingIndex(i)}
                      className={[
                        "relative rounded-2xl overflow-hidden text-left border-2 transition-all duration-250 cursor-pointer group",
                        isSelected
                          ? "border-gold shadow-[0_0_20px_rgba(201,168,76,0.45)]"
                          : "border-cleo-border hover:border-gold/40",
                      ].join(" ")}
                    >
                      <div className="aspect-square relative" style={{ background: design.gradient }}>
                        {design.imageUrl ? (
                          <Image
                            src={design.imageUrl}
                            alt={design.styleName}
                            fill
                            unoptimized
                            sizes="(max-width: 640px) 50vw, 25vw"
                            className="object-cover"
                          />
                        ) : (
                          <DesignPatternSVG type={design.patternType} />
                        )}
                        {isSelected && (
                          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-gold shadow-lg flex items-center justify-center">
                            <span className="text-bg text-xs font-black font-mono">{selectionOrder}</span>
                          </motion.div>
                        )}
                        <div className="absolute top-2 left-2">
                          <span className="bg-black/60 backdrop-blur-sm text-ink/70 text-[9px] font-mono px-1.5 py-0.5 rounded">
                            #{i + 1}
                          </span>
                        </div>
                        {isSelected && <div className="absolute inset-0 ring-2 ring-inset ring-gold/30 rounded-t-2xl pointer-events-none" />}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center pointer-events-none">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-gold text-bg font-cinzel text-[10px] font-bold tracking-[0.1em] uppercase px-3 py-1.5 rounded-lg shadow-lg">
                            🔍 View
                          </span>
                        </div>
                        {design.imageUrl && (
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch(resolveImageSrc(design.imageUrl!));
                                const blob = await res.blob();
                                const blobUrl = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = blobUrl;
                                a.download = `${design.styleName.replace(/\s+/g, "-")}.png`;
                                a.click();
                                URL.revokeObjectURL(blobUrl);
                              } catch { /* silent — image still viewable */ }
                            }}
                            className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gold hover:border-gold z-10 cursor-pointer"
                            aria-label={`Download ${design.styleName}`}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <div className={`px-3 py-2.5 transition-colors ${isSelected ? "bg-gold/10" : "bg-surface"}`}>
                        <p className={`text-xs font-cinzel font-bold leading-tight ${isSelected ? "text-gold" : "text-ink"}`}>
                          {design.styleName}
                        </p>
                        <p className="text-muted text-[10px] mt-0.5">
                          {isSelected ? `Selected #${selectionOrder}` : canSelect ? "Tap to view" : "Tap to view"}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}

                {/* Skeleton placeholders for slots still being generated.
                    Only shown during the initial streaming pass (isGenerating);
                    per-slot retries render their own retrying skeleton below. */}
                {isGenerating && Array.from({
                  length: Math.max(0, totalSlots - generatedDesigns.length - failedSlots.length - retryingSlots.size),
                }).map((_, i) => (
                  <div key={`skeleton-${i}`} className="rounded-2xl overflow-hidden border-2 border-cleo-border">
                    <div className="aspect-square skeleton" />
                    <div className="p-3 bg-surface flex flex-col gap-1.5">
                      <div className="h-2.5 skeleton rounded w-3/4" />
                      <div className="h-2 skeleton rounded w-1/2" />
                    </div>
                  </div>
                ))}

                {/* Retrying-slot skeletons — one per slot whose Retry button was clicked */}
                {Array.from(retryingSlots).map((idx) => (
                  <div key={`retrying-${idx}`} className="rounded-2xl overflow-hidden border-2 border-gold/30">
                    <div className="aspect-square skeleton relative">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-7 h-7 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                      </div>
                    </div>
                    <div className="p-3 bg-surface flex flex-col gap-1.5">
                      <p className="text-gold text-[10px] font-mono">Retrying…</p>
                      <div className="h-2 skeleton rounded w-1/2" />
                    </div>
                  </div>
                ))}

                {/* Failed slot cards with per-slot Retry button */}
                {failedSlots.map((slot) => (
                  <div key={`failed-${slot.slotIndex}`} className="rounded-2xl overflow-hidden border-2 border-error/30 bg-surface">
                    <div className="aspect-square bg-error/5 flex flex-col items-center justify-center gap-2 p-3">
                      <svg className="w-6 h-6 text-error/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      <p className="text-error/60 text-[10px] font-mono text-center">
                        {creditsExhausted ? "Unavailable" : "Failed"}
                      </p>
                      {!creditsExhausted && (
                        <button
                          onClick={() => handleRetrySlot(slot.slotIndex)}
                          className="bg-gold text-bg font-cinzel font-bold text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 rounded-lg border border-gold hover:bg-gold-light transition-colors cursor-pointer mt-1"
                        >
                          ↺ Retry
                        </button>
                      )}
                    </div>
                    <div className="p-3 bg-surface">
                      <p className="text-error/50 text-[10px] font-mono truncate" title={slot.reason}>
                        {creditsExhausted ? `#${slot.slotIndex + 1} — service unavailable` : `#${slot.slotIndex + 1} — ${slot.reason}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Refinement + Proceed panel ──────────────────────────── */}
        {/* Shown whenever the user has selected at least one design — including
            while other slots are still streaming. Refine stays disabled during
            generation (refining would wipe the in-flight stream). */}
        <AnimatePresence>
          {hasSelection && (
            <motion.div
              key="refinement"
              ref={refinementRef}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.35 }}
              className="bg-surface rounded-2xl border border-gold/30 overflow-hidden"
            >
              {/* Selected designs row */}
              <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-4 border-b border-cleo-border/60">
                <p className="text-gold text-[11px] sm:text-xs font-mono tracking-[0.15em] uppercase mb-1">
                  You selected {selectedDesigns.length} design{selectedDesigns.length > 1 ? "s" : ""}
                </p>
                {selectedDesigns.length > 1 && (
                  <p className="text-muted text-[10px] font-mono mb-3 leading-snug">
                    Refer to them as &quot;Image 1&quot;, &quot;Image 2&quot;, etc. in your refinement notes below
                  </p>
                )}
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  {selectedDesigns.map((d, i) => {
                    const globalIndex = generatedDesigns.findIndex((gd) => gd.id === d.id);
                    return (
                      <div key={d.id} className="flex items-center gap-2 bg-bg rounded-xl border border-gold/20 p-1.5 sm:p-2 pr-2.5 sm:pr-3">
                        <div className="relative">
                          <div
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg overflow-hidden flex-shrink-0 relative"
                            style={{ background: d.gradient }}
                          >
                            {d.imageUrl ? (
                              <Image
                                src={d.imageUrl}
                                alt={d.styleName}
                                fill
                                sizes="40px"
                                className="object-cover"
                              />
                            ) : (
                              <DesignPatternSVG type={d.patternType} />
                            )}
                          </div>
                          <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gold flex items-center justify-center">
                            <span className="text-bg text-[9px] font-black">{i + 1}</span>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-ink text-[11px] sm:text-xs font-cinzel font-bold leading-tight truncate max-w-[120px] sm:max-w-[160px]">{d.styleName}</p>
                          <p className="text-muted text-[9px] truncate">
                            {selectedDesigns.length > 1 ? `→ "Image ${i + 1}"` : `Design #${globalIndex + 1}`}
                          </p>
                        </div>
                        <button
                          onClick={() => toggleDesignSelection(d)}
                          aria-label={`Remove ${d.styleName}`}
                          className="ml-1 w-6 h-6 flex items-center justify-center text-muted hover:text-error transition-colors text-base leading-none cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 sm:p-5 flex flex-col gap-4">
                {/* Faithful / Creative toggle */}
                <div className="flex items-center gap-3 p-3 bg-bg rounded-xl border border-cleo-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-cinzel font-bold text-ink leading-tight">
                      {faithfulMode ? "Minor Changes Only" : "Creative Variation"}
                    </p>
                    <p className="text-muted text-[10px] mt-0.5 leading-snug">
                      {faithfulMode
                        ? "Preserve the selected design exactly — apply only the changes you describe"
                        : "Blend and reinterpret the selected design with creative freedom"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFaithfulMode((v) => !v)}
                    aria-pressed={faithfulMode}
                    className={`flex-shrink-0 w-11 h-6 rounded-full border transition-colors cursor-pointer flex items-center px-0.5 ${
                      faithfulMode
                        ? "bg-gold border-gold justify-end"
                        : "bg-surface-2 border-cleo-border justify-start"
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full shadow transition-all ${faithfulMode ? "bg-bg" : "bg-muted"}`} />
                  </button>
                </div>

                {/* Refinement input */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">
                    What do you like? What to change?
                  </label>
                  <textarea
                    rows={3}
                    placeholder={
                      faithfulMode
                        ? `e.g. Make the linework slightly bolder, add a small star above the main element, darken the shading in the background only…`
                        : selectedDesigns.length > 1
                        ? `e.g. I love the linework style of Image 1 (${selectedDesigns[0]?.styleName}) and the colour/shading of Image 2 (${selectedDesigns[1]?.styleName}). Combine them — keep Image 1's composition but use Image 2's shading technique…`
                        : `e.g. Keep the overall composition of ${selectedDesigns[0]?.styleName ?? "this design"} but make the linework bolder, add more detail in the centre, and darken the shading…`
                    }
                    value={refinementText}
                    onChange={(e) => setRefinementText(e.target.value)}
                    className="bg-bg border border-cleo-border rounded-xl px-4 py-3 text-ink text-sm placeholder:text-muted/40 focus:border-gold focus:outline-none transition-colors resize-none leading-relaxed"
                  />
                </div>

                {/* Inline buttons — hidden on mobile in favour of the sticky footer */}
                <div className="hidden sm:flex flex-col sm:flex-row gap-3">
                  <motion.button
                    whileHover={refinementText.trim() && !isGenerating ? { scale: 1.02 } : {}}
                    whileTap={refinementText.trim() && !isGenerating ? { scale: 0.97 } : {}}
                    onClick={handleRefine}
                    disabled={!refinementText.trim() || isGenerating}
                    title={isGenerating ? "Wait for generation to finish before refining" : undefined}
                    className={`flex-1 py-3.5 rounded-xl font-cinzel font-bold text-sm tracking-wide uppercase border transition-all ${
                      refinementText.trim() && !isGenerating
                        ? "bg-surface-2 border-gold/40 text-gold hover:bg-gold/10 cursor-pointer"
                        : "bg-surface-2 border-cleo-border text-muted cursor-not-allowed"
                    }`}
                  >
                    ↺ Refine &amp; Generate Again
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleProceed}
                    className="flex-1 bg-gold text-bg font-cinzel font-bold text-base tracking-[0.08em] uppercase py-3.5 rounded-xl border border-gold hover:bg-gold-light transition-colors cursor-pointer shadow-[0_0_20px_rgba(201,168,76,0.2)]"
                  >
                    {selectedDesigns.length === 1
                      ? "✦ Proceed to Placement →"
                      : `✦ Proceed with Design #${generatedDesigns.findIndex((d) => d.id === selectedDesigns[0]?.id) + 1} →`}
                  </motion.button>
                </div>

                {selectedDesigns.length > 1 && (
                  <p className="text-muted text-[10px] font-mono text-center">
                    Proceeding with your first selection as the primary design
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        </>} {/* end designMode === "ai" */}
      </div>

      {/* ── Sticky mobile CTA bar (AI mode only) */}
      {(designMode === "ai") && <>{/* ── Sticky mobile CTA bar ─────────────────────────────────────
          Mirrors the primary action for the current state so the user
          never has to scroll back up. Inline desktop buttons remain. */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-bg/95 backdrop-blur-md border-t border-cleo-border px-4 pt-3 pb-safe">
        {/* Order matters: selection wins over generation status so the user can
            proceed as soon as they've picked a design, even if other slots
            haven't streamed in yet. */}
        {hasSelection ? (
          <div className="flex gap-2">
            <button
              onClick={handleRefine}
              disabled={!refinementText.trim() || isGenerating}
              className={`flex-1 py-3 rounded-xl font-cinzel font-bold text-[11px] tracking-[0.06em] uppercase border transition-colors ${
                refinementText.trim() && !isGenerating
                  ? "bg-surface-2 border-gold/40 text-gold cursor-pointer"
                  : "bg-surface-2 border-cleo-border text-muted/50 cursor-not-allowed"
              }`}
            >
              ↺ Refine
            </button>
            <button
              onClick={handleProceed}
              className="flex-[1.4] py-3 rounded-xl font-cinzel font-bold text-sm tracking-[0.06em] uppercase bg-gold text-bg border border-gold cursor-pointer shadow-[0_0_18px_rgba(201,168,76,0.25)]"
            >
              ✦ Proceed →
            </button>
          </div>
        ) : isGenerating ? (
          <button
            disabled
            className="w-full py-3.5 rounded-xl font-cinzel font-bold text-sm tracking-[0.08em] uppercase bg-surface-2 text-muted border border-cleo-border cursor-not-allowed"
          >
            {generatedDesigns.length > 0
              ? `${generatedDesigns.length} of ${totalSlots} ready…`
              : "Generating…"}
          </button>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`w-full py-3.5 rounded-xl font-cinzel font-bold text-sm tracking-[0.08em] uppercase border transition-colors ${
              canGenerate
                ? "bg-gold text-bg border-gold cursor-pointer shadow-[0_0_18px_rgba(201,168,76,0.25)]"
                : "bg-surface-2 text-muted border-cleo-border cursor-not-allowed"
            }`}
          >
            {hasGenerated
              ? "✦ Regenerate"
              : !tattooDescription.trim()
              ? "Describe your tattoo first"
              : referenceImages.length === 0
              ? "Add a reference image"
              : "✦ Generate Designs"}
          </button>
        )}
      </div>
      </>} {/* end designMode === "ai" sticky CTA */}
    </>
  );
}

// ── Body-area picker ──────────────────────────────────────────────
// Optional design-time hint for the AI: lets the customer say where on the
// body the tattoo will live so the model picks an appropriate aspect/flow.
// Empty value = no hint, AI generates as before.

const BODY_AREA_CHIPS = [
  "Forearm",
  "Upper Arm",
  "Shoulder",
  "Wrist",
  "Chest",
  "Back",
  "Ribs",
  "Thigh",
  "Calf",
  "Ankle",
  "Neck",
] as const;

function BodyAreaPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isPreset = (BODY_AREA_CHIPS as readonly string[]).includes(value);
  const [customOpen, setCustomOpen] = useState(value !== "" && !isPreset);

  function pickPreset(label: string) {
    if (value === label) {
      onChange("");
    } else {
      onChange(label);
      setCustomOpen(false);
    }
  }

  function toggleCustom() {
    if (customOpen) {
      // Closing — wipe whatever was typed so the AI doesn't pick up a stale hint.
      if (!isPreset) onChange("");
      setCustomOpen(false);
    } else {
      // Opening — clear any preset selection so the input owns the value.
      if (isPreset) onChange("");
      setCustomOpen(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">
          Body placement <span className="text-muted/50 normal-case">(optional — helps the AI compose better)</span>
        </label>
        {value && (
          <button
            type="button"
            onClick={() => { onChange(""); setCustomOpen(false); }}
            className="text-[10px] font-mono text-muted hover:text-gold uppercase tracking-wider cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {BODY_AREA_CHIPS.map((label) => {
          const selected = value === label;
          return (
            <button
              key={label}
              type="button"
              onClick={() => pickPreset(label)}
              aria-pressed={selected}
              className={`px-3 py-1.5 rounded-full text-xs font-mono border transition-colors cursor-pointer ${
                selected
                  ? "bg-gold text-bg border-gold"
                  : "bg-bg text-muted border-cleo-border hover:border-gold/40 hover:text-ink"
              }`}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={toggleCustom}
          aria-pressed={customOpen}
          className={`px-3 py-1.5 rounded-full text-xs font-mono border transition-colors cursor-pointer ${
            customOpen || (!isPreset && value !== "")
              ? "bg-gold text-bg border-gold"
              : "bg-bg text-muted border-cleo-border hover:border-gold/40 hover:text-ink"
          }`}
        >
          Custom…
        </button>
      </div>

      {customOpen && (
        <input
          type="text"
          autoFocus
          value={isPreset ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. inner bicep, between shoulder blades, top of foot…"
          className="bg-bg border border-cleo-border rounded-xl px-4 py-2.5 text-ink text-sm placeholder:text-muted/50 focus:border-gold focus:outline-none transition-colors"
        />
      )}
    </div>
  );
}
