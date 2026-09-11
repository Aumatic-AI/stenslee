"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAppStore } from "@/store/app-store";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { resolveImageSrc } from "@/lib/image-src";

const supabase = createSupabaseBrowserClient();

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

// Uploads a Blob straight from the browser to Supabase Storage and returns
// its public URL. Used instead of sending the file to a Node API route to
// upload — this machine's Node process is unreliable talking to Supabase
// over the network, while the browser's own network stack isn't.
async function uploadBlobDirect(blob: Blob, sessionId: string, prefix: string): Promise<string> {
  const contentType = blob.type || "image/jpeg";
  const path = `${sessionId}/${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extFromMime(contentType)}`;
  const { error } = await supabase.storage.from("session-assets").upload(path, blob, { contentType, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return supabase.storage.from("session-assets").getPublicUrl(path).data.publicUrl;
}

async function uploadPhotoDirect(blobUrl: string, sessionId: string, prefix: string): Promise<string> {
  const blob = await (await fetch(blobUrl)).blob();
  return uploadBlobDirect(blob, sessionId, prefix);
}

async function uploadBase64Direct(dataUrl: string, sessionId: string, prefix: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return uploadBlobDirect(blob, sessionId, prefix);
}

interface DesignRow {
  id: string;
  image_url: string;
  style_name: string | null;
  iteration: number;
  is_finalized: boolean;
  user_instruction: string | null;
  parent_design_ids: string[];
  created_at: string;
}

interface Batch {
  iteration: number;
  userInstruction: string | null;
  images: DesignRow[];
  /** Thumbnails to show alongside the instruction — the source photo for a
   *  first rework batch, or the selected image(s) an edit was based on. */
  referenceUrls: string[];
}

interface JobSlot {
  status: "pending" | "done" | "error";
  imageBase64?: string;
  reason?: string;
  code?: string;
}

const COUNT_OPTIONS = [1, 2, 3, 4, 5] as const;
const POLL_INTERVAL_MS = 1500;

function ChatInner({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editTargetId = searchParams.get("edit");

  const {
    flowType, reworkMode, reworkPhoto,
    tattooStyle, tattooDescription, targetBodyArea, selectedColors, referenceImages,
    isTextTattoo, textTattooFont,
    pendingGeneration, setPendingGeneration,
    persistDesigns, selectDesign, finalizeReworkSession,
  } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [finalizedId, setFinalizedId] = useState<string | null>(null);
  const [reworkDone, setReworkDone] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  // Authoritative session context — read from the DB, not just the in-memory
  // store, so reopening a session later (e.g. "Continue Design" from history)
  // still shows correct chips even if the store has a different session loaded.
  const [sessionFlowType, setSessionFlowType] = useState<"ai_design" | "rework">(flowType);
  const [sessionReworkMode, setSessionReworkMode] = useState<"cover" | "extend">(reworkMode);
  const [sessionStyle, setSessionStyle] = useState(tattooStyle);
  const [sessionDescription, setSessionDescription] = useState(tattooDescription);
  const [sessionSourcePhotoUrl, setSessionSourcePhotoUrl] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState("");
  const [count, setCount] = useState(5);
  const [sending, setSending] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const didKickoffRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const processedSlotsRef = useRef<Set<number>>(new Set());

  function findDesign(id: string): DesignRow | undefined {
    for (const b of batches) {
      const found = b.images.find((img) => img.id === id);
      if (found) return found;
    }
    return undefined;
  }

  // ── Load session + existing thread ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: session } = await supabase
        .from("sessions")
        .select("user_id, flow_type, rework_mode, rework_source_photo_url, tattoo_style, tattoo_description")
        .eq("id", sessionId)
        .maybeSingle();
      if (!cancelled && session) {
        setCustomerId(session.user_id ?? null);
        setSessionFlowType((session.flow_type as "ai_design" | "rework" | null) ?? flowType);
        setSessionReworkMode((session.rework_mode as "cover" | "extend" | null) ?? reworkMode);
        setSessionStyle(session.tattoo_style ?? tattooStyle);
        setSessionDescription(session.tattoo_description ?? tattooDescription);
        setSessionSourcePhotoUrl(session.rework_source_photo_url ?? null);
      }

      const { data: designs } = await supabase
        .from("tattoo_designs")
        .select("id, image_url, style_name, iteration, is_finalized, user_instruction, parent_design_ids, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true }) as { data: DesignRow[] | null };

      if (cancelled) return;

      const byId = new Map((designs ?? []).map((d) => [d.id, d]));
      const grouped = new Map<number, Batch>();
      (designs ?? []).forEach((d) => {
        const b = grouped.get(d.iteration) ?? {
          iteration: d.iteration,
          userInstruction: d.user_instruction,
          images: [],
          referenceUrls: (d.parent_design_ids ?? [])
            .map((pid) => byId.get(pid)?.image_url)
            .filter((u): u is string => !!u),
        };
        b.images.push(d);
        grouped.set(d.iteration, b);
      });
      const sortedBatches = [...grouped.values()].sort((a, b) => a.iteration - b.iteration);
      // First batch of a rework thread has no parent — its "reference" is the
      // original uploaded photo instead.
      if (sortedBatches[0] && sortedBatches[0].referenceUrls.length === 0) {
        const sourceUrl = session?.rework_source_photo_url;
        if (sourceUrl) sortedBatches[0].referenceUrls = [sourceUrl];
      }
      setBatches(sortedBatches);

      const finalized = (designs ?? []).find((d) => d.is_finalized);
      if (finalized) setFinalizedId(finalized.id);

      setLoading(false);

      if (editTargetId) {
        setSelectedIds(new Set([editTargetId]));
      }

      if (pendingGeneration && !didKickoffRef.current && sortedBatches.length === 0) {
        didKickoffRef.current = true;
        setPendingGeneration(false);
        startGeneration(true, []);
        return;
      }

      // Resume watching a generation that was still running when this page
      // loaded (e.g. a reload mid-generation, or reopening from another tab).
      if (!didKickoffRef.current) {
        didKickoffRef.current = true;
        const res = await fetch(`/api/generation-status?sessionId=${sessionId}`);
        const status = await res.json();
        if (!cancelled && status.found && !status.done) {
          const alreadyHave = sortedBatches.find((b) => b.iteration === status.iteration)?.images.length ?? 0;
          processedSlotsRef.current = new Set(Array.from({ length: alreadyHave }, (_, i) => i));
          const referenceUrls: string[] = (status.parentDesignIds ?? [])
            .map((pid: string) => byId.get(pid)?.image_url)
            .filter((u: string | undefined): u is string => !!u);
          setBatches((prev) => {
            if (prev.some((b) => b.iteration === status.iteration)) return prev;
            return [...prev, { iteration: status.iteration, userInstruction: status.userInstruction, images: [], referenceUrls }];
          });
          setSending(true);
          watchJob(status.iteration, status.parentDesignIds ?? [], status.userInstruction ?? undefined);
        }
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [batches, pendingCount]);

  // ── Poll a running job until every slot resolves ─────────────
  async function watchJob(iteration: number, parentDesignIds: string[], userInstruction: string | undefined) {
    const prefix = sessionFlowType === "rework" ? "rework" : "designs";

    while (true) {
      let status: { found: boolean; done: boolean; slots: JobSlot[] };
      try {
        const res = await fetch(`/api/generation-status?sessionId=${sessionId}`);
        status = await res.json();
      } catch {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (!status.found) break; // expired/unknown — nothing more to watch

      for (let i = 0; i < status.slots.length; i++) {
        if (processedSlotsRef.current.has(i)) continue;
        const slot = status.slots[i];
        if (slot.status === "pending") continue;
        processedSlotsRef.current.add(i);
        setPendingCount((c) => Math.max(0, c - 1));

        if (slot.status === "error") {
          if (slot.code === "insufficient_credits") {
            setError("AI generation credits are exhausted. Please contact the admin to top up and restore the service.");
          }
          continue;
        }
        if (!slot.imageBase64) continue;

        try {
          const imageUrl = await uploadBase64Direct(slot.imageBase64, sessionId, prefix);
          const [persisted] = await persistDesigns(
            [{ id: `kei-${iteration}-${i}`, imageUrl, gradient: "", patternType: "mandala", styleName: `Variation ${i + 1}` }],
            { iteration, parentDesignIds, userInstruction }
          );
          const row: DesignRow = {
            id: persisted.dbId ?? persisted.id,
            image_url: persisted.imageUrl!,
            style_name: persisted.styleName,
            iteration,
            is_finalized: false,
            user_instruction: userInstruction ?? null,
            parent_design_ids: parentDesignIds,
            created_at: new Date().toISOString(),
          };
          setBatches((prev) => prev.map((b) => (b.iteration === iteration ? { ...b, images: [...b.images, row] } : b)));
        } catch (err) {
          setError((err as Error).message);
        }
      }

      if (status.done) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    setSending(false);
    setPendingCount(0);
    setSelectedIds(new Set());
    setInstruction("");
  }

  // ── Start a new generation / edit ────────────────────────────
  async function startGeneration(isFirst: boolean, editSourceIds: string[]) {
    setSending(true);
    setError(null);
    const thisCount = isFirst ? 5 : count;
    setPendingCount(thisCount);
    processedSlotsRef.current = new Set();

    const selectedRows = editSourceIds.map(findDesign).filter((r): r is DesignRow => !!r);
    const editSourceUrls = selectedRows.map((r) => r.image_url);
    const instructionForTurn = isFirst ? undefined : instruction.trim();
    const nextIteration = batches.length > 0 ? Math.max(...batches.map((b) => b.iteration)) + 1 : 1;

    const referenceUrls = isFirst
      ? sessionFlowType === "rework"
        ? (reworkPhoto ? [reworkPhoto] : [])
        : referenceImages.slice(0, 5)
      : editSourceUrls;

    setBatches((prev) => [...prev, { iteration: nextIteration, userInstruction: instructionForTurn ?? null, images: [], referenceUrls }]);

    try {
      let res: Response;
      if (sessionFlowType === "rework") {
        const body: Record<string, unknown> = {
          sessionId, iteration: nextIteration, mode: sessionReworkMode, count: thisCount,
          parentDesignIds: isFirst ? [] : editSourceIds,
        };
        if (isFirst) {
          body.description = sessionDescription;
          if (reworkPhoto) body.sourcePhotoUrl = await uploadPhotoDirect(reworkPhoto, sessionId, "rework-source");
        } else {
          body.editInstruction = instructionForTurn;
          body.editSourceUrls = editSourceUrls;
        }
        res = await fetch("/api/generate-rework", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      } else {
        const localRefs = referenceImages.filter((r) => r.startsWith("blob:") || r.startsWith("data:"));
        const hostedRefs = referenceImages.filter((r) => !r.startsWith("blob:") && !r.startsWith("data:"));
        // Upload local refs straight from the browser instead of sending base64
        // to the server to upload — same reliability fix as the rework photo.
        const uploadedRefs = isFirst
          ? await Promise.all(localRefs.map((r) => uploadPhotoDirect(r, sessionId, "refs")))
          : [];
        const body: Record<string, unknown> = {
          sessionId, iteration: nextIteration, description: sessionDescription, style: sessionStyle,
          images: [], referenceImageUrls: isFirst ? [...uploadedRefs, ...hostedRefs] : [],
          isTextTattoo, colors: selectedColors, targetBodyArea, count: thisCount,
          parentDesignIds: isFirst ? [] : editSourceIds,
          ...(isTextTattoo && textTattooFont ? { textTattooFont } : {}),
        };
        if (!isFirst) {
          body.refineImageUrls = editSourceUrls;
          body.refinementText = instructionForTurn;
          body.selectedDesignNames = selectedRows.map((r) => r.style_name ?? "Design");
        }
        res = await fetch("/api/generate", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Generation failed");
      }

      const started = await res.json();
      if (started.sourcePhotoUrl) {
        // Save the uploaded source photo back to the session so a later
        // reopen (e.g. via "Continue Design") can still show it.
        await supabase.from("sessions").update({ rework_source_photo_url: started.sourcePhotoUrl }).eq("id", sessionId);
      }

      await watchJob(nextIteration, isFirst ? [] : editSourceIds, instructionForTurn);
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
      setPendingCount(0);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSend() {
    if (sending) return;
    if (selectedIds.size === 0) { setError("Select at least one image to edit — the instruction alone isn't enough, pick what it applies to."); return; }
    if (!instruction.trim()) return;
    startGeneration(false, [...selectedIds]);
  }

  async function handleUse(row: DesignRow) {
    if (sessionFlowType === "rework") {
      setFinalizing(row.id);
      try {
        await finalizeReworkSession(row.id);
        setReworkDone(true);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setFinalizing(null);
      }
    } else {
      selectDesign({ id: row.id, dbId: row.id, gradient: "", patternType: "mandala", styleName: row.style_name ?? "Design", imageUrl: row.image_url });
      router.push(`/${sessionId}/placement`);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (reworkDone) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-surface border border-gold/30 rounded-2xl p-8 max-w-sm w-full flex flex-col items-center gap-4 text-center"
        >
          <div className="w-16 h-16 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="font-cinzel text-xl font-black text-ink">Rework Complete</h1>
          <p className="text-muted text-sm">The finished design has been saved to this customer&apos;s history.</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => router.push(customerId ? `/customer/${customerId}` : "/")}
            className="w-full bg-gold text-bg font-cinzel font-bold text-sm tracking-[0.08em] uppercase py-3.5 rounded-xl border border-gold hover:bg-gold-light transition-colors cursor-pointer"
          >
            ✦ Back to Dashboard
          </motion.button>
        </motion.div>
      </div>
    );
  }

  const contextChips = sessionFlowType === "rework"
    ? [{ label: sessionReworkMode === "cover" ? "Cover-Up" : "Extend & Blend" }]
    : [
        ...(sessionStyle ? [{ label: sessionStyle }] : []),
        ...(targetBodyArea ? [{ label: targetBodyArea }] : []),
      ];

  const viewingRow = viewingId ? findDesign(viewingId) : null;

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Context bar */}
      <div className="border-b border-cleo-border bg-surface/60 px-4 sm:px-6 py-2.5 flex items-center gap-2 flex-wrap flex-shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted/60">
          {sessionFlowType === "rework" ? "Rework" : "AI Design"}
        </span>
        {contextChips.map((c) => (
          <span key={c.label} className="text-[10px] font-mono px-2 py-1 rounded-full bg-bg border border-cleo-border text-muted">
            {c.label}
          </span>
        ))}
        {sessionFlowType !== "rework" && selectedColors.length > 0 && (
          <span className="flex items-center gap-1 px-1.5 py-1 rounded-full bg-bg border border-cleo-border">
            {selectedColors.slice(0, 5).map((hex) => (
              <span key={hex} className="w-3 h-3 rounded-full ring-1 ring-inset ring-white/20" style={{ backgroundColor: hex }} />
            ))}
          </span>
        )}
        {sessionFlowType === "rework" && (reworkPhoto || sessionSourcePhotoUrl) && (
          <div className="w-7 h-7 rounded-md overflow-hidden border border-cleo-border ml-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={reworkPhoto ?? resolveImageSrc(sessionSourcePhotoUrl!)} alt="Source" className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col gap-6">
        {batches.map((batch) => (
          <div key={batch.iteration} className="flex flex-col gap-3">
            {/* "User" message */}
            <div className="flex justify-end">
              <div className="max-w-[85%] sm:max-w-md bg-gold/10 border border-gold/30 rounded-2xl rounded-tr-sm px-4 py-2.5 flex flex-col gap-2">
                {batch.referenceUrls.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {batch.referenceUrls.map((url, i) => (
                      <div key={i} className="w-14 h-14 rounded-lg overflow-hidden border border-gold/30 flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={resolveImageSrc(url)} alt="Reference" className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-ink text-sm leading-relaxed">
                  {batch.userInstruction ?? sessionDescription}
                </p>
              </div>
            </div>

            {/* AI response — grid of images for this batch */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 sm:gap-3 max-w-3xl">
              {batch.images.map((row) => {
                const isSelected = selectedIds.has(row.id);
                const isFinalized = row.id === finalizedId;
                return (
                  <div
                    key={row.id}
                    onClick={() => setViewingId(row.id)}
                    className="relative group rounded-xl overflow-hidden border border-cleo-border bg-surface-2 cursor-pointer"
                    style={{ aspectRatio: "1" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={resolveImageSrc(row.image_url)} alt={row.style_name ?? "Design"} className="w-full h-full object-cover" />

                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelect(row.id); }}
                      className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors cursor-pointer ${
                        isSelected ? "bg-gold border-gold" : "bg-black/50 border-white/40 hover:border-gold"
                      }`}
                      title="Select for editing"
                    >
                      {isSelected && (
                        <svg className="w-3 h-3 text-bg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>

                    {isFinalized && (
                      <div className="absolute top-1.5 left-1.5 right-1.5 flex justify-center">
                        <span className="text-[9px] font-mono uppercase tracking-wider bg-gold text-bg px-2 py-0.5 rounded-full">Finalized</span>
                      </div>
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); handleUse(row); }}
                      disabled={finalizing === row.id}
                      className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm text-white text-[10px] font-mono uppercase tracking-wider py-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-gold hover:text-bg disabled:opacity-50"
                    >
                      {finalizing === row.id ? "Saving…" : "✦ Use this"}
                    </button>
                  </div>
                );
              })}

              {/* Loading placeholders for the in-flight batch */}
              {sending && batch.iteration === batches[batches.length - 1]?.iteration &&
                Array.from({ length: pendingCount }).map((_, i) => (
                  <div key={`loading-${i}`} className="rounded-xl overflow-hidden border border-cleo-border" style={{ aspectRatio: "1" }}>
                    <div className="w-full h-full skeleton flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-gold/50 border-t-transparent rounded-full animate-spin" />
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        ))}

        {error && (
          <div className="bg-error/10 border border-error/30 rounded-xl px-4 py-3 max-w-3xl">
            <p className="text-error text-xs font-mono leading-relaxed">{error}</p>
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-cleo-border bg-surface px-4 sm:px-6 py-3 flex-shrink-0 flex flex-col gap-2">
        {selectedIds.size > 0 && (
          <p className="text-[10px] font-mono text-gold uppercase tracking-wider">
            {selectedIds.size} image{selectedIds.size === 1 ? "" : "s"} selected as reference
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={selectedIds.size === 0 ? "Select an image above, then describe your change…" : "e.g. Make the mane fuller, remove the small stars…"}
            className="flex-1 bg-bg border border-cleo-border rounded-xl px-3.5 py-2.5 text-ink text-sm placeholder:text-muted/50 focus:border-gold focus:outline-none transition-colors resize-none max-h-28"
          />
          <div className="flex items-center gap-1 bg-bg border border-cleo-border rounded-lg p-1 flex-shrink-0">
            {COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`w-7 h-7 rounded-md text-xs font-mono font-bold transition-colors cursor-pointer ${
                  count === n ? "bg-gold text-bg" : "text-muted hover:text-ink"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            onClick={handleSend}
            disabled={sending || !instruction.trim() || selectedIds.size === 0}
            className="flex-shrink-0 w-11 h-11 rounded-xl bg-gold text-bg flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-gold-light transition-colors"
          >
            {sending ? (
              <div className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Full-screen viewer */}
      {viewingRow && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setViewingId(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
        >
          <button
            onClick={() => setViewingId(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors flex items-center justify-center text-xl cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
          <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-center gap-4 max-w-2xl w-full">
            <div className="relative w-full rounded-2xl overflow-hidden border border-cleo-border" style={{ aspectRatio: "1" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resolveImageSrc(viewingRow.image_url)} alt={viewingRow.style_name ?? "Design"} className="w-full h-full object-contain bg-black" />
            </div>
            <div className="flex items-center gap-3 w-full max-w-sm">
              <button
                onClick={() => { toggleSelect(viewingRow.id); setViewingId(null); }}
                className={`flex-1 py-3 rounded-xl font-cinzel font-bold text-xs tracking-[0.08em] uppercase border transition-colors cursor-pointer ${
                  selectedIds.has(viewingRow.id)
                    ? "bg-gold text-bg border-gold"
                    : "bg-transparent text-white border-white/30 hover:border-gold"
                }`}
              >
                {selectedIds.has(viewingRow.id) ? "✓ Selected" : "Select to Edit"}
              </button>
              <button
                onClick={() => { setViewingId(null); handleUse(viewingRow); }}
                disabled={finalizing === viewingRow.id}
                className="flex-1 py-3 rounded-xl bg-gold text-bg font-cinzel font-bold text-xs tracking-[0.08em] uppercase border border-gold hover:bg-gold-light transition-colors cursor-pointer disabled:opacity-50"
              >
                {finalizing === viewingRow.id ? "Saving…" : "✦ Use this"}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export default function ChatPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" /></div>}>
      <ChatInner sessionId={sessionId} />
    </Suspense>
  );
}
