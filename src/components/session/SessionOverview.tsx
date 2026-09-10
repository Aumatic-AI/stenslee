"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { resolveBackUrl } from "@/lib/auth-utils";
import TattooPrintStudio from "@/components/print/TattooPrintStudio";

// ── Types ─────────────────────────────────────────────────────

interface DesignRow {
  id: string;
  image_url: string;
  style_name: string | null;
  pattern_type: string | null;
  iteration: number;
  is_finalized: boolean;
}

interface PlacementRow {
  id: string;
  placement_text: string | null;
  body_photo_url: string | null;
  final_composite_url: string | null;
  is_finalized: boolean;
}

interface SessionDetail {
  id: string;
  tattoo_style: string | null;
  tattoo_description: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  users: { first_name: string; phone: string } | null;
  designer: { name: string; email: string } | null;
  tattoo_designs: DesignRow[];
  placements: PlacementRow[];
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

// ── Main component ────────────────────────────────────────────

export default function SessionOverview({ sessionId, from, defaultBackUrl, defaultBackLabel }: SessionOverviewProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [backUrl, setBackUrl] = useState(defaultBackUrl);
  const [backLabel, setBackLabel] = useState(defaultBackLabel);

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
          id, tattoo_style, tattoo_description, status, created_at, completed_at,
          users(first_name, phone),
          designer:designer_id(name, email),
          tattoo_designs(id, image_url, style_name, pattern_type, iteration, is_finalized),
          placements(id, placement_text, body_photo_url, final_composite_url, is_finalized)
        `)
        .eq("id", sessionId)
        .maybeSingle();

      if (!data) { setNotFound(true); setLoading(false); return; }
      setSession(data as unknown as SessionDetail);

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

  // ── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (notFound || !session) {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4">
        <p className="font-cinzel text-xl text-ink">Session not found.</p>
        <Link href={backUrl} className="text-gold underline font-mono text-sm">← {backLabel}</Link>
      </main>
    );
  }

  const customer = Array.isArray(session.users) ? session.users[0] : session.users;
  const designer = Array.isArray(session.designer) ? session.designer[0] : session.designer;
  const designs = Array.isArray(session.tattoo_designs) ? session.tattoo_designs : [];
  const placements = Array.isArray(session.placements) ? session.placements : [];

  // If any design was already generated, resume at Placement (the design
  // page auto-selects one of them on hydration); otherwise resume at Design.
  const continueUrl = designs.length > 0 ? `/${session.id}/placement` : `/${session.id}/design`;

  const finalDesign = designs.find((d) => d.is_finalized);
  const finalPlacement =
    placements.find((p) => p.is_finalized) ??
    placements.find((p) => p.final_composite_url) ??
    placements[0];

  const statusColor =
    session.status === "completed" ? "text-success bg-success/10 border-success/30" :
    session.status === "abandoned"  ? "text-error bg-error/10 border-error/30" :
    "text-gold bg-gold/10 border-gold/30";

  return (
    <main className="min-h-[100dvh] bg-bg flex flex-col">
      {/* Header */}
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center gap-3">
        <Link href={backUrl} className="text-muted hover:text-gold transition-colors text-xs font-mono tracking-wider flex items-center gap-1.5 flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {backLabel}
        </Link>
        <span className="text-cleo-border">/</span>
        <span className="text-muted text-xs font-mono truncate">Session #{sessionId}</span>
        <div className="ml-auto flex items-center gap-3">
          {/* Continue — active sessions left mid-flow have no other way back in */}
          {session.status === "active" && (
            <button
              onClick={() => router.push(continueUrl)}
              className="h-8 px-3 rounded-lg bg-gold/95 border border-gold text-bg font-cinzel font-bold text-[10px] tracking-[0.1em] uppercase hover:bg-gold-light transition-colors flex items-center gap-1.5 cursor-pointer shadow-[0_0_16px_rgba(201,168,76,0.25)]"
            >
              <span>✦ Continue Design</span>
            </button>
          )}
          {/* Download — opens the print studio (A4 stencil layout) */}
          {finalDesign && (
            <button
              onClick={() => setPrintOpen(true)}
              className="h-8 px-3 rounded-lg bg-gold/95 border border-gold text-bg font-cinzel font-bold text-[10px] tracking-[0.1em] uppercase hover:bg-gold-light transition-colors flex items-center gap-1.5 cursor-pointer shadow-[0_0_16px_rgba(201,168,76,0.25)]"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
              <span className="hidden sm:inline">Download</span>
              <span className="sm:hidden">PDF</span>
            </button>
          )}
          <span className={`text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-full border ${statusColor}`}>
            {session.status}
          </span>
        </div>
      </header>

      {/* Print studio modal */}
      <AnimatePresence>
        {printOpen && finalDesign && (
          <TattooPrintStudio
            imageUrl={finalDesign.image_url}
            subtitle={`${session.tattoo_style ?? finalDesign.style_name ?? "Custom"} · Session #${session.id}`}
            filenameBase={`tattoo-stencil-${session.id}`}
            onClose={() => setPrintOpen(false)}
          />
        )}
      </AnimatePresence>

      <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-5xl mx-auto w-full flex flex-col gap-8">

        {/* ── 1. Session card ──────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="bg-surface border border-cleo-border rounded-2xl p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
              <span className="font-cinzel text-xl font-black text-gold">
                {customer?.first_name?.charAt(0).toUpperCase() ?? "?"}
              </span>
            </div>
            <div>
              <p className="text-ink font-cinzel font-black text-lg leading-none">{customer?.first_name ?? "Unknown"}</p>
              <p className="text-muted text-sm font-mono mt-0.5">{customer?.phone ?? "—"}</p>
              <p className="text-muted/50 text-[10px] font-mono uppercase tracking-widest mt-1">Customer</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted text-xs font-mono uppercase tracking-wider">Session</span>
              <span className="text-ink font-mono font-bold">#{session.id}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted text-xs font-mono uppercase tracking-wider">Designer</span>
              <span className="text-ink font-semibold">{designer?.name ?? "Unassigned"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted text-xs font-mono uppercase tracking-wider">Started</span>
              <span className="text-ink font-mono text-xs">
                {new Date(session.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            {session.completed_at && (
              <div className="flex justify-between gap-2">
                <span className="text-muted text-xs font-mono uppercase tracking-wider">Completed</span>
                <span className="text-success font-mono text-xs">
                  {new Date(session.completed_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── 2. Customer request — only shown when data exists ── */}
        {(session.tattoo_style || session.tattoo_description) && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}
          className="flex flex-col gap-4">
          <SectionHeader title="Customer Request" />
          <div className="bg-surface border border-cleo-border rounded-2xl p-5 flex flex-col gap-4">
            {session.tattoo_style && (
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Tattoo Style</p>
                <p className="text-gold font-cinzel font-bold text-base">{session.tattoo_style}</p>
              </div>
            )}
            {session.tattoo_style && session.tattoo_description && <div className="h-px bg-cleo-border" />}
            {session.tattoo_description && (
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Description / Prompt</p>
                <p className="text-ink text-sm leading-relaxed">{session.tattoo_description}</p>
              </div>
            )}
          </div>
        </motion.div>
        )}

        {/* ── 3. Reference images — only shown when images exist ── */}
        {refImages.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}
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

        {/* ── 4. Approved design ───────────────────────────── */}
        {finalDesign && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }} className="flex flex-col gap-4">
            <SectionHeader title="Approved Design" />
            <div className="bg-surface border border-gold/30 rounded-2xl p-5 flex flex-col sm:flex-row gap-5 shadow-[0_0_30px_rgba(201,168,76,0.1)]">
              <button onClick={() => setLightbox(finalDesign.image_url)}
                className="w-full sm:w-48 aspect-square rounded-xl overflow-hidden border-2 border-gold/50 flex-shrink-0 cursor-zoom-in">
                <Img url={finalDesign.image_url} alt="Final approved design" className="w-full h-full" />
              </button>
              <div className="flex flex-col gap-3 justify-center">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted mb-1">Style</p>
                  <p className="text-gold font-cinzel font-bold">{finalDesign.style_name ?? session.tattoo_style ?? "—"}</p>
                </div>
                {finalDesign.pattern_type && (
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-muted mb-1">Pattern Type</p>
                    <p className="text-ink text-sm capitalize">{finalDesign.pattern_type}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted mb-1">Generation Round</p>
                  <p className="text-ink text-sm font-mono">Round {finalDesign.iteration}</p>
                </div>
                <span className="text-[10px] font-cinzel font-black uppercase tracking-widest text-gold bg-gold/10 border border-gold/30 px-3 py-1 rounded-full w-fit">
                  ✦ Customer Approved
                </span>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── 5. Placement ─────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }} className="flex flex-col gap-4">
          <SectionHeader title="Placement" />
          {!finalPlacement ? (
            <div className="bg-surface border border-cleo-border rounded-xl p-6 text-center">
              <p className="text-muted text-sm">No placement data recorded.</p>
            </div>
          ) : (
            <div className="bg-surface border border-cleo-border rounded-2xl p-5 flex flex-col gap-5">
              {finalPlacement.placement_text && (
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-gold flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Placement Area</p>
                    <p className="text-ink font-semibold">{finalPlacement.placement_text}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Body Photo</p>
                  {finalPlacement.body_photo_url ? (
                    <button onClick={() => setLightbox(finalPlacement.body_photo_url!)}
                      className="aspect-square rounded-xl overflow-hidden border border-cleo-border hover:border-gold/40 transition-colors cursor-zoom-in">
                      <Img url={finalPlacement.body_photo_url} alt="Body photo" className="w-full h-full" />
                    </button>
                  ) : (
                    <div className="aspect-square rounded-xl border border-cleo-border bg-surface-2 flex items-center justify-center">
                      <p className="text-muted/50 text-xs font-mono">No photo uploaded</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted">Final Composite</p>
                  {finalPlacement.final_composite_url ? (
                    <button onClick={() => setLightbox(finalPlacement.final_composite_url!)}
                      className="aspect-square rounded-xl overflow-hidden border-2 border-gold/40 hover:border-gold transition-colors cursor-zoom-in shadow-[0_0_20px_rgba(201,168,76,0.15)]">
                      <Img url={finalPlacement.final_composite_url} alt="Tattoo on body" className="w-full h-full" />
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
    </main>
  );
}
