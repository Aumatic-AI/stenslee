"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

const supabase = createSupabaseBrowserClient();
const PAGE_SIZE = 20;

interface SessionRow {
  id: string;
  style: string | null;
  created_at: string;
  customerName: string;
  designerName: string;
}

interface Props {
  onClose: () => void;
}

export default function ActiveSessionsModal({ onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(async (offset: number, replace: boolean) => {
    if (replace) setLoading(true); else setLoadingMore(true);

    const { data, error: err, count } = await supabase
      .from("sessions")
      .select("id, style, created_at, customers(name), designer:staff_id(name)", { count: "exact" })
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (err || !data) {
      setError("Couldn't load active sessions.");
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: SessionRow[] = (data as any[]).map((r) => ({
      id: r.id,
      style: r.style,
      created_at: r.created_at,
      customerName: (Array.isArray(r.customers) ? r.customers[0] : r.customers)?.name ?? "Unknown",
      designerName: (Array.isArray(r.designer) ? r.designer[0] : r.designer)?.name ?? "Unassigned",
    }));

    setSessions((prev) => (replace ? rows : [...prev, ...rows]));
    setTotal(count ?? rows.length);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => { loadPage(0, true); }, [loadPage]);

  const hasMore = sessions.length < total;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-cleo-border rounded-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden"
      >
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center justify-between gap-3 flex-shrink-0">
          <div>
            <h2 className="font-cinzel text-lg font-bold text-ink">Active Sessions</h2>
            <p className="text-muted text-[10px] font-mono mt-0.5">{total} in progress</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-bg border border-cleo-border text-muted hover:text-error hover:border-error/40 transition-colors flex items-center justify-center text-lg cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-bg border border-cleo-border rounded-xl px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <div className="skeleton h-3.5 w-28 rounded" />
                    <div className="skeleton h-2.5 w-40 rounded" />
                  </div>
                  <div className="skeleton h-2.5 w-10 rounded flex-shrink-0" />
                </div>
              ))}
            </div>
          ) : error ? (
            <p className="text-error text-sm font-mono text-center py-10">{error}</p>
          ) : sessions.length === 0 ? (
            <p className="text-muted text-sm text-center py-10">No active sessions right now.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {sessions.map((s) => (
                  <Link
                    key={s.id}
                    href={`/studio/admin/sessions/${s.id}?from=/studio/admin`}
                    className="bg-bg border border-cleo-border rounded-xl px-4 py-3 flex items-center gap-4 hover:border-gold/40 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-ink text-sm font-semibold truncate group-hover:text-gold transition-colors">{s.customerName}</p>
                      <p className="text-muted text-xs font-mono truncate">{s.style || "No style"} · by {s.designerName}</p>
                    </div>
                    <p className="text-muted/60 text-[10px] font-mono flex-shrink-0">
                      {new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                    <svg className="w-4 h-4 text-muted/50 group-hover:text-gold transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}
              </div>
              {hasMore && (
                <button
                  onClick={() => loadPage(sessions.length, false)}
                  disabled={loadingMore}
                  className="w-full mt-3 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-gold hover:text-gold-light border border-cleo-border hover:border-gold/40 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load More"}
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
