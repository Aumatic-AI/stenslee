"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { resolveBackUrl } from "@/lib/auth-utils";
import { startFlashGeneration, checkFlashJob, watchFlashGeneration } from "@/features/flash-isolate/flash-generation";
import TattooPrintStudio from "@/features/print-stencil/TattooPrintStudio";

// ── Types ─────────────────────────────────────────────────────

interface SessionDetail {
  id: string;
  style: string | null;
  description: string | null;
  flow_type: "ai_design" | "rework";
  status: string;
  created_at: string;
  completed_at: string | null;
  deleted_at: string | null;
  customers: { name: string; phone: string } | null;
  designer: { name: string; email: string } | null;
  selected_design_url: string | null;
  selected_design_style: string | null;
  flash_image_url: string | null;
  placement_text: string | null;
  placement_body_photo_url: string | null;
  placement_composite_url: string | null;
}

// ── Internal sub-components ───────────────────────────────────

function Img({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className={`flex items-center justify-center bg-surface-2 ${className}`}>
        <span className="text-muted/30 text-2xl">✦</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={`object-cover ${className}`} onError={() => setErr(true)} />;
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="font-cinzel text-sm font-bold tracking-[0.18em] text-muted uppercase">{title}</h2>
      {count !== undefined && (
        <span className="text-[10px] font-mono text-muted/60 bg-surface border border-cleo-border px-2 py-0.5 rounded-full">
          {count}
        </span>
      )}
      <div className="flex-1 h-px bg-cleo-border" />
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────

interface SessionOverviewProps {
  sessionId: string;
  /** Raw ?from= query param — validated against the viewer's actual role */
  from?: string;
  /** Fallback back-button destination when `from` isn't usable */
  defaultBackUrl: string;
  /** Fallback back-button label when `from` isn't usable */
  defaultBackLabel: string;
}

function SessionOverviewSkeleton() {
  return (
    <div className="min-h-[100dvh] bg-bg flex flex-col">
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center">
        <div className="skeleton h-3 w-16 rounded" />
      </header>

      <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-5xl mx-auto w-full flex flex-col gap-8">
        {/* Session card */}
        <div className="bg-surface border border-cleo-border rounded-2xl p-5 sm:p-6 flex flex-col gap-6">
          <div className="flex justify-end">
            <div className="skeleton h-5 w-20 rounded-full" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1.3fr_1fr_auto] items-start gap-x-8 gap-y-6">
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-4">
                <div className="skeleton w-14 h-14 rounded-full flex-shrink-0" />
                <div className="flex flex-col gap-1.5">
                  <div className="skeleton h-2.5 w-16 rounded" />
                  <div className="skeleton h-5 w-32 rounded" />
                  <div className="skeleton h-3 w-24 rounded" />
                </div>
              </div>
              <div className="flex gap-2.5">
                <div className="skeleton h-9 w-32 rounded-lg" />
                <div className="skeleton h-9 w-24 rounded-lg" />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:border-l sm:border-cleo-border sm:pl-8">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <div className="skeleton h-2.5 w-16 rounded" />
                  <div className="skeleton h-3.5 w-28 rounded" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:border-l sm:border-cleo-border sm:pl-8">
              <div className="skeleton h-2.5 w-20 rounded" />
              <div className="skeleton w-full sm:w-36 aspect-square rounded-xl" />
            </div>
          </div>
        </div>

        {/* Generic secondary section (reference images / before-after / placement) */}
        <div className="flex flex-col gap-4">
          <div className="skeleton h-3 w-32 rounded" />
          <div className="bg-surface border border-cleo-border rounded-2xl p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="skeleton aspect-square rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function SessionOverview({ sessionId, from, defaultBackUrl, defaultBackLabel }: SessionOverviewProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [reworkSourcePhoto, setReworkSourcePhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [backUrl, setBackUrl] = useState(defaultBackUrl);
  const [backLabel, setBackLabel] = useState(defaultBackLabel);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flashUrl, setFlashUrl] = useState<string | null>(null);
  const [flashState, setFlashState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [flashError, setFlashError] = useState<string | null>(null);
  // No more per-design table to check "has anything been generated yet" —
  // read straight from chat_messages instead.
  const [hasChatHistory, setHasChatHistory] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/studio/login"); return; }

      const { data: staffRow } = await supabase
        .from("staff")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      const role = (staffRow?.role as "admin" | "designer" | undefined) ?? null;
      const resolved = resolveBackUrl(from, role, defaultBackUrl, defaultBackLabel);
      setBackUrl(resolved.backUrl);
      setBackLabel(resolved.backLabel);

      const { data } = await supabase
        .from("sessions")
        .select(`
          id, style, description, flow_type, status, created_at, completed_at, deleted_at,
          customers(name, phone),
          designer:staff_id(name, email),
          selected_design_url, selected_design_style, flash_image_url,
          placement_text, placement_body_photo_url, placement_composite_url
        `)
        .eq("id", sessionId)
        .maybeSingle();

      if (!data) { setNotFound(true); setLoading(false); return; }
      setSession(data as unknown as SessionDetail);

      const { count: chatCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);
      setHasChatHistory((chatCount ?? 0) > 0);

      // Rework has no separate "reference images" upload step — the original
      // photo of the existing tattoo is stored as the first chat turn's
      // image instead (there's no rework_source_photo_url column populated
      // anywhere), so pull it from there for the before/after comparison.
      if (data.flow_type === "rework") {
        const { data: firstUserMsg } = await supabase
          .from("chat_messages")
          .select("image_urls")
          .eq("session_id", sessionId)
          .eq("role", "user")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        setReworkSourcePhoto(firstUserMsg?.image_urls?.[0] ?? null);
      }

      // List reference images from Supabase Storage
      const { data: files } = await supabase.storage
        .from("session-assets")
        .list(`${sessionId}/refs`, { limit: 20 });

      if (files && files.length > 0) {
        const urls = files
          .filter((f) => f.name !== ".emptyFolderPlaceholder")
          .map((f) => supabase.storage.from("session-assets").getPublicUrl(`${sessionId}/refs/${f.name}`).data.publicUrl);
        setRefImages(urls);
      }

      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Flash/sticker version — pick up an in-flight job (started when the
  // design was finalized, possibly from a different tab) or show it once
  // it's already saved. Never auto-starts a job on its own. ─────
  useEffect(() => {
    if (!session || session.flow_type !== "rework") return;
    // Already have it (or nothing selected yet) — nothing to check. The
    // saved URL is read straight from session during render, not mirrored
    // into state here.
    if (!session.selected_design_url || session.flash_image_url) return;

    let cancelled = false;
    (async () => {
      const status = await checkFlashJob(sessionId);
      if (cancelled) return;
      if (!status.found) return; // no job running — stays in the default "idle" state
      setFlashState("loading");
      const url = await watchFlashGeneration(sessionId, (state, detail) => {
        if (cancelled) return;
        if (state === "loading") setFlashState("loading");
        if (state === "error") { setFlashState("error"); setFlashError(detail ?? "This image failed to generate."); }
      });
      if (cancelled) return;
      if (url) { setFlashUrl(url); setFlashState("done"); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.flow_type, session?.selected_design_url, session?.flash_image_url]);

  async function handleGenerateFlash() {
    if (!session?.selected_design_url) return;
    setFlashState("loading");
    setFlashError(null);
    await startFlashGeneration(sessionId, session.selected_design_url);
    const url = await watchFlashGeneration(sessionId, (state, detail) => {
      if (state === "error") { setFlashState("error"); setFlashError(detail ?? "This image failed to generate."); }
    });
    if (url) { setFlashUrl(url); setFlashState("done"); }
  }

  // ── Loading ──────────────────────────────────────────────────
  if (loading) {
    return <SessionOverviewSkeleton />;
  }

  if (notFound || !session) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4">
        <p className="font-cinzel text-xl text-ink">Session not found.</p>
        <Link href={backUrl} className="text-gold underline font-mono text-sm">← {backLabel}</Link>
      </div>
    );
  }

  const customer = Array.isArray(session.customers) ? session.customers[0] : session.customers;
  const designer = Array.isArray(session.designer) ? session.designer[0] : session.designer;

  // If anything's already been generated, resume in Chat to keep iterating/
  // selecting (generation results live there now, not on the Design page);
  // otherwise resume at Design/Rework to start from scratch.
  const continueUrl = hasChatHistory ? `/${session.id}/chat` : `/${session.id}/design`;

  // flashUrl (local state) covers a just-finished generation before the
  // session reload catches up; otherwise read the saved value straight off
  // the session row.
  const resolvedFlashUrl = flashUrl ?? session.flash_image_url ?? null;
  const resolvedFlashState = resolvedFlashUrl ? "done" : flashState;
  // Rework prints the sticker (clean design, no skin/shadows) — a photo of
  // it on-body would make a bad stencil. Nothing to print until it exists.
  const printableImageUrl = session.flow_type === "rework" ? resolvedFlashUrl : session.selected_design_url;
  const hasPlacement = !!(session.placement_text || session.placement_body_photo_url || session.placement_composite_url);

  const statusColor =
    session.status === "completed" ? "text-success bg-success/10 border-success/30" :
    session.status === "abandoned"  ? "text-error bg-error/10 border-error/30" :
    "text-gold bg-gold/10 border-gold/30";

  // Soft delete only — nothing is ever removed. Hides the session from
  // staff lists (deleted_at is filtered out there) while keeping every
  // design, chat message and placement intact and restorable.
  async function handleDelete() {
    setDeleting(true);
    const { error } = await supabase
      .from("sessions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", sessionId);
    setDeleting(false);
    if (error) { setActionError(error.message); return; }
    router.push(backUrl);
  }

  return (
    <div className="min-h-[100dvh] bg-bg flex flex-col">
      {/* Header — just Back; everything else lives in the page body now */}
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center">
        <Link href={backUrl} className="text-muted hover:text-gold transition-colors text-xs font-mono tracking-wider flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {backLabel}
        </Link>
      </header>

      {/* Deleted banner — soft delete only, so this is always recoverable */}
      {session.deleted_at && (
        <div className="px-4 sm:px-6 py-3 bg-error/10 border-b border-error/30">
          <p className="text-error text-xs font-mono">
            This session was deleted on {new Date(session.deleted_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}. Viewing read-only — restore or permanently delete it from{" "}
            <Link href="/studio/admin/trash" className="underline underline-offset-2 hover:text-error/80">Recently Deleted</Link>.
          </p>
        </div>
      )}

      {actionError && (
        <div className="px-4 sm:px-6 py-2 bg-error/10 border-b border-error/30">
          <p className="text-error text-xs font-mono">{actionError}</p>
        </div>
      )}

      {/* Print studio modal */}
      <AnimatePresence>
        {printOpen && printableImageUrl && (
          <TattooPrintStudio
            imageUrl={printableImageUrl}
            subtitle={`${session.style ?? session.selected_design_style ?? "Custom"} · ${customer?.name ?? "Design"}`}
            filenameBase={`tattoo-stencil-${session.id}`}
            onClose={() => setPrintOpen(false)}
          />
        )}
      </AnimatePresence>

      <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-5xl mx-auto w-full flex flex-col gap-8">

        {/* ── 1. Session card — customer/actions | meta | approved image ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="bg-surface border border-cleo-border rounded-2xl p-5 sm:p-6 flex flex-col gap-6">
          <div className="flex items-center justify-end gap-2">
            {session.flow_type === "rework" && (
              <span className="text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-full border border-gold/40 text-gold bg-gold/10">
                Rework
              </span>
            )}
            <span className={`text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-full border ${statusColor}`}>
              {session.status}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1.3fr_1fr_auto] items-start gap-x-8 gap-y-6">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
                <span className="font-cinzel text-2xl font-black text-gold">
                  {customer?.name?.charAt(0).toUpperCase() ?? "?"}
                </span>
              </div>
              <div>
                <p className="text-muted/50 text-[10px] font-mono uppercase tracking-widest mb-0.5">Customer</p>
                <p className="text-ink font-cinzel font-black text-lg leading-none">{customer?.name ?? "Unknown"}</p>
                <p className="text-muted text-sm font-mono mt-1">{customer?.phone ?? "—"}</p>
              </div>
            </div>

            {/* Session actions — Edit / Delete, kept inside the page instead
                of the top navbar */}
            {!session.deleted_at && (
              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  onClick={() => router.push(continueUrl)}
                  className="h-9 px-4 rounded-lg bg-gold/95 border border-gold text-bg font-cinzel font-bold text-[10px] tracking-widest uppercase hover:bg-gold-light transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span>✦ {session.status === "active" ? "Continue Design" : "Edit"}</span>
                </button>
                {printableImageUrl && (
                  <button
                    onClick={() => setPrintOpen(true)}
                    className="h-9 px-4 rounded-lg border border-cleo-border text-ink hover:border-gold/50 transition-colors flex items-center gap-1.5 cursor-pointer font-cinzel font-bold text-[10px] tracking-widest uppercase"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    Download
                  </button>
                )}
                {confirmingDelete ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-muted">Delete session?</span>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="h-9 px-3 rounded-lg bg-error/90 border border-error text-white font-cinzel font-bold text-[10px] tracking-widest uppercase hover:bg-error transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {deleting ? "Deleting…" : "Confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleting}
                      className="h-9 px-3 rounded-lg bg-surface-2 border border-cleo-border text-muted font-mono text-[10px] uppercase hover:text-ink transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    className="h-9 px-4 rounded-lg border border-cleo-border text-muted/70 hover:text-error hover:border-error/50 transition-colors flex items-center gap-1.5 cursor-pointer font-mono text-[10px] uppercase tracking-wider"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0v13a1 1 0 01-1 1H8a1 1 0 01-1-1V7h10z" />
                    </svg>
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 text-sm sm:border-l sm:border-cleo-border sm:pl-8">
            <div className="flex flex-col gap-0.5">
              <span className="text-muted/60 text-[10px] font-mono uppercase tracking-widest">Handled By</span>
              <span className="text-ink font-cinzel font-bold">{designer?.name ?? "Unassigned"}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-muted/60 text-[10px] font-mono uppercase tracking-widest">Started</span>
              <span className="text-ink font-mono text-xs">
                {new Date(session.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            {session.completed_at && (
              <div className="flex flex-col gap-0.5">
                <span className="text-muted/60 text-[10px] font-mono uppercase tracking-widest">Completed</span>
                <span className="text-success font-mono text-xs">
                  {new Date(session.completed_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            )}
          </div>

          {/* Approved design image — sticker/flash for Rework, the
              generated design itself for AI Design */}
          {session.selected_design_url && (
            <div className="flex flex-col gap-2 sm:border-l sm:border-cleo-border sm:pl-8">
              <span className="text-muted/60 text-[10px] font-mono uppercase tracking-widest">
                {session.flow_type === "rework" ? "Sticker Version" : "Approved Design"}
              </span>
              {session.flow_type === "rework" ? (
                resolvedFlashState === "done" && resolvedFlashUrl ? (
                  <button onClick={() => setLightbox(resolvedFlashUrl)}
                    className="w-full sm:w-36 aspect-square rounded-xl overflow-hidden border-2 border-gold/50 cursor-zoom-in bg-white">
                    <Img url={resolvedFlashUrl} alt="Isolated tattoo design" className="w-full h-full object-contain!" />
                  </button>
                ) : resolvedFlashState === "loading" ? (
                  <div className="w-full sm:w-36 aspect-square rounded-xl border border-cleo-border bg-surface-2 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-gold/50 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="w-full sm:w-36 aspect-square rounded-xl border border-dashed border-cleo-border bg-surface-2 flex flex-col items-center justify-center gap-2 p-3 text-center">
                    {resolvedFlashState === "error" && flashError && (
                      <p className="text-error text-[10px] font-mono leading-snug">{flashError}</p>
                    )}
                    <button onClick={handleGenerateFlash}
                      className="text-[10px] font-mono uppercase tracking-wider text-gold hover:text-gold-light underline underline-offset-2 cursor-pointer">
                      {resolvedFlashState === "error" ? "↻ Retry" : "✦ Generate"}
                    </button>
                  </div>
                )
              ) : (
                <button onClick={() => setLightbox(session.selected_design_url!)}
                  className="w-full sm:w-36 aspect-square rounded-xl overflow-hidden border-2 border-gold/50 cursor-zoom-in">
                  <Img url={session.selected_design_url!} alt="Final approved design" className="w-full h-full" />
                </button>
              )}
            </div>
          )}
          </div>
        </motion.div>

        {/* ── 2. Reference images (AI Design only) — only shown when images exist ── */}
        {refImages.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}
          className="flex flex-col gap-4">
          <SectionHeader title="Reference Images" count={refImages.length} />
          <div className="flex flex-wrap gap-3">
            {refImages.map((url, i) => (
              <button key={i} onClick={() => setLightbox(url)}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-cleo-border hover:border-gold/50 transition-colors cursor-zoom-in flex-shrink-0">
                <Img url={url} alt={`Reference ${i + 1}`} className="w-full h-full" />
              </button>
            ))}
          </div>
        </motion.div>
        )}

        {/* ── 3. Before & After (Rework only) ──────────────── */}
        {session.flow_type === "rework" && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}
          className="flex flex-col gap-4">
          <SectionHeader title="Before & After" />
          <div className="bg-surface border border-cleo-border rounded-2xl p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Original Photo</p>
                {reworkSourcePhoto ? (
                  <button onClick={() => setLightbox(reworkSourcePhoto)}
                    className="aspect-square rounded-xl overflow-hidden border border-cleo-border hover:border-gold/40 transition-colors cursor-zoom-in">
                    <Img url={reworkSourcePhoto} alt="Original tattoo photo" className="w-full h-full" />
                  </button>
                ) : (
                  <div className="aspect-square rounded-xl border border-cleo-border bg-surface-2 flex items-center justify-center">
                    <p className="text-muted/50 text-xs font-mono">Not available</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Finalized Design</p>
                {session.selected_design_url ? (
                  <button onClick={() => setLightbox(session.selected_design_url!)}
                    className="aspect-square rounded-xl overflow-hidden border-2 border-gold/40 hover:border-gold transition-colors cursor-zoom-in shadow-[0_0_20px_rgba(201,168,76,0.15)]">
                    <Img url={session.selected_design_url} alt="Finalized rework design" className="w-full h-full" />
                  </button>
                ) : (
                  <div className="aspect-square rounded-xl border border-cleo-border bg-surface-2 flex items-center justify-center">
                    <p className="text-muted/50 text-xs font-mono">Not finalized yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
        )}

        {/* ── 4. Placement (AI Design only — Rework has no placement step) ── */}
        {session.flow_type === "ai_design" && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }} className="flex flex-col gap-4">
          <SectionHeader title="Placement" />
          {!hasPlacement ? (
            <div className="bg-surface border border-cleo-border rounded-xl p-6 text-center">
              <p className="text-muted text-sm">No placement data recorded.</p>
            </div>
          ) : (
            <div className="bg-surface border border-cleo-border rounded-2xl p-5 flex flex-col gap-5">
              {session.placement_text && (
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-gold flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Placement Area</p>
                    <p className="text-ink font-semibold">{session.placement_text}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Body Photo</p>
                  {session.placement_body_photo_url ? (
                    <button onClick={() => setLightbox(session.placement_body_photo_url!)}
                      className="aspect-square rounded-xl overflow-hidden border border-cleo-border hover:border-gold/40 transition-colors cursor-zoom-in">
                      <Img url={session.placement_body_photo_url} alt="Body photo" className="w-full h-full" />
                    </button>
                  ) : (
                    <div className="aspect-square rounded-xl border border-cleo-border bg-surface-2 flex items-center justify-center">
                      <p className="text-muted/50 text-xs font-mono">No photo uploaded</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Final Composite</p>
                  {session.placement_composite_url ? (
                    <button onClick={() => setLightbox(session.placement_composite_url!)}
                      className="aspect-square rounded-xl overflow-hidden border-2 border-gold/40 hover:border-gold transition-colors cursor-zoom-in shadow-[0_0_20px_rgba(201,168,76,0.15)]">
                      <Img url={session.placement_composite_url} alt="Tattoo on body" className="w-full h-full" />
                    </button>
                  ) : (
                    <div className="aspect-square rounded-xl border border-cleo-border bg-surface-2 flex items-center justify-center">
                      <p className="text-muted/50 text-xs font-mono">Not generated</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.div>
        )}

        {/* ── 5. Customer request — last, only shown when data exists ── */}
        {(session.style || session.description) && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }}
          className="flex flex-col gap-4">
          <SectionHeader title="Customer Request" />
          <div className="bg-surface border border-cleo-border rounded-2xl p-5 flex flex-col gap-4">
            {session.style && (
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Tattoo Style</p>
                <p className="text-gold font-cinzel font-bold text-base">{session.style}</p>
              </div>
            )}
            {session.style && session.description && <div className="h-px bg-cleo-border" />}
            {session.description && (
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Description / Prompt</p>
                <p className="text-ink text-sm leading-relaxed">{session.description}</p>
              </div>
            )}
          </div>
        </motion.div>
        )}

      </div>

      {/* ── Lightbox ─────────────────────────────────────────── */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            key="lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <button onClick={() => setLightbox(null)}
              className="absolute top-5 right-5 w-10 h-10 rounded-full bg-surface/80 border border-cleo-border text-ink hover:text-error transition-colors flex items-center justify-center text-xl cursor-pointer">
              ×
            </button>
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.2 }}
              src={lightbox}
              alt="Full size"
              className="max-w-full max-h-[90vh] object-contain rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
