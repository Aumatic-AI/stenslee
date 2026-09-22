"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { resolveImageSrc } from "@/lib/image-src";

const supabase = createSupabaseBrowserClient();

const PAGE_SIZE = 20;

interface SessionRow {
  id: string;
  customerId: string;
  customerName: string;
  staffId: string | null;
  designerName: string;
}

interface DesignItem {
  id: string;
  imageUrl: string;
  styleName: string | null;
  customerName: string;
  designerName: string;
}

interface FilterOption {
  id: string;
  name: string;
}

interface Props {
  onSelect: (imageUrl: string, styleName: string | null) => void;
  onClose: () => void;
}

// Small themed dropdown — matches the pattern used elsewhere in the app
// (page-size picker, image-count picker) instead of a native <select>.
function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedName = value === "all" ? `All ${label}s` : options.find((o) => o.id === value)?.name ?? `All ${label}s`;

  useEffect(() => {
    if (open) {
      setSearch("");
      // Wait a tick for the panel to mount before focusing.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, search]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-10 px-3.5 rounded-xl bg-bg border border-cleo-border hover:border-gold/50 text-ink flex items-center gap-2 transition-colors cursor-pointer text-sm font-mono min-w-[14rem] justify-between"
      >
        <span className="truncate">{selectedName}</span>
        <svg className={`w-3.5 h-3.5 text-muted flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-2 left-0 bg-surface-2 border border-cleo-border rounded-xl shadow-2xl overflow-hidden z-20 w-[18rem] max-h-80 flex flex-col">
            <div className="p-2 border-b border-cleo-border sticky top-0 bg-surface-2 flex-shrink-0">
              <div className="relative">
                <svg className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M18 10.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}s…`}
                  className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-bg border border-cleo-border text-ink text-sm font-mono placeholder:text-muted/60 focus:outline-none focus:border-gold/50"
                />
              </div>
            </div>
            <div className="overflow-y-auto">
              <button
                onClick={() => { onChange("all"); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm font-mono transition-colors cursor-pointer hover:bg-gold/10 ${value === "all" ? "text-gold font-bold bg-gold/5" : "text-ink"}`}
              >
                All {label}s
              </button>
              {filteredOptions.length === 0 ? (
                <p className="px-3 py-3 text-xs font-mono text-muted text-center">No matches</p>
              ) : (
                filteredOptions.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => { onChange(o.id); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm font-mono transition-colors cursor-pointer hover:bg-gold/10 truncate ${value === o.id ? "text-gold font-bold bg-gold/5" : "text-ink"}`}
                  >
                    {o.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function PreviousDesignsModal({ onSelect, onClose }: Props) {
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<"admin" | "designer" | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [customerFilter, setCustomerFilter] = useState("all");
  const [designerFilter, setDesignerFilter] = useState("all");
  const [designs, setDesigns] = useState<DesignItem[]>([]);
  const [hasMore, setHasMore] = useState(true);

  // ── One-time load: role + every in-scope session (lightweight — just
  // metadata, no images) — used for filter options and name lookups. ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Not signed in."); setLoadingSessions(false); return; }

      const { data: staffRow } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
      const currentRole = (staffRow?.role as "admin" | "designer" | undefined) ?? "designer";
      if (cancelled) return;
      setRole(currentRole);

      // Admins see every designer's work; a designer only ever sees their own —
      // "staff_id" really means "handled by", so this also covers sessions
      // an admin ran themself.
      let sessionsQuery = supabase
        .from("sessions")
        .select("id, customer_id, staff_id, customers(name), designer:staff_id(name)")
        .is("deleted_at", null);
      if (currentRole === "designer") sessionsQuery = sessionsQuery.eq("staff_id", user.id);

      const { data: sessionRows, error: sessionsError } = await sessionsQuery;
      if (cancelled) return;
      if (sessionsError || !sessionRows) { setError("Couldn't load previous sessions."); setLoadingSessions(false); return; }

      const mapped: SessionRow[] = sessionRows.map((s) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = s as any;
        const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
        const designer = Array.isArray(row.designer) ? row.designer[0] : row.designer;
        return {
          id: row.id,
          customerId: row.customer_id ?? "",
          customerName: customer?.name ?? "Unknown",
          staffId: row.staff_id ?? null,
          designerName: designer?.name ?? "Unassigned",
        };
      });

      setSessions(mapped);
      setLoadingSessions(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const customerOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    sessions.forEach((s) => { if (s.customerId) map.set(s.customerId, s.customerName); });
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions]);

  const designerOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    sessions.forEach((s) => { if (s.staffId) map.set(s.staffId, s.designerName); });
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions]);

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  const scopedSessionIds = useMemo(() => {
    return sessions
      .filter((s) => customerFilter === "all" || s.customerId === customerFilter)
      .filter((s) => role !== "admin" || designerFilter === "all" || s.staffId === designerFilter)
      .map((s) => s.id);
  }, [sessions, customerFilter, designerFilter, role]);

  // ── Fetch one page of previously-finished designs for the current filter
  // scope. A "design" is now just a session with a selected_design_url set
  // — there's no more separate per-design table (see spec: a session only
  // ever has one finalized design). ──
  const loadPage = useCallback(async (offset: number, replace: boolean) => {
    if (scopedSessionIds.length === 0) {
      if (replace) setDesigns([]);
      setHasMore(false);
      return;
    }
    setLoadingPage(true);
    const { data: designRows, error: designsError } = await supabase
      .from("sessions")
      .select("id, selected_design_url, selected_design_style, created_at")
      .in("id", scopedSessionIds)
      .not("selected_design_url", "is", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (designsError || !designRows) {
      setError("Couldn't load previous designs.");
      setLoadingPage(false);
      return;
    }

    const items: DesignItem[] = designRows.map((d) => {
      const session = sessionById.get(d.id);
      return {
        id: d.id,
        imageUrl: d.selected_design_url!,
        styleName: d.selected_design_style,
        customerName: session?.customerName ?? "Unknown",
        designerName: session?.designerName ?? "Unassigned",
      };
    });

    setDesigns((prev) => (replace ? items : [...prev, ...items]));
    setHasMore(items.length === PAGE_SIZE);
    setLoadingPage(false);
  }, [scopedSessionIds, sessionById]);

  // Fetch page 1 once sessions are loaded, and again whenever a filter changes.
  useEffect(() => {
    if (loadingSessions) return;
    loadPage(0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSessions, customerFilter, designerFilter]);

  const loading = loadingSessions || (loadingPage && designs.length === 0);

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
        className="bg-surface border border-cleo-border rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center justify-between gap-3 flex-shrink-0">
          <h2 className="font-cinzel text-lg font-bold text-ink">Previous Designs</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-bg border border-cleo-border text-muted hover:text-error hover:border-error/40 transition-colors flex items-center justify-center text-lg cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!loadingSessions && !error && sessions.length > 0 && (
          <div className="px-5 sm:px-6 py-3.5 border-b border-cleo-border flex items-center gap-2.5 flex-wrap flex-shrink-0">
            <FilterDropdown label="Customer" value={customerFilter} options={customerOptions} onChange={setCustomerFilter} />
            {role === "admin" && (
              <FilterDropdown label="Designer" value={designerFilter} options={designerOptions} onChange={setDesignerFilter} />
            )}
            <span className="text-muted text-[10px] font-mono ml-auto">
              {designs.length} loaded
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-gold border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <p className="text-error text-sm font-mono text-center py-10">{error}</p>
          ) : sessions.length === 0 || designs.length === 0 ? (
            <p className="text-muted text-sm text-center py-10">No finalized designs yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {designs.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => onSelect(d.imageUrl, d.styleName)}
                    className="group text-left rounded-xl overflow-hidden border border-cleo-border hover:border-gold/50 transition-colors cursor-pointer bg-surface-2"
                  >
                    <div className="aspect-square relative overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={resolveImageSrc(d.imageUrl)} alt={d.styleName ?? "Design"} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-gold text-bg font-cinzel text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg">
                          Use This
                        </span>
                      </div>
                    </div>
                    <div className="px-2.5 py-2">
                      <p className="text-ink text-xs font-cinzel font-bold truncate">{d.styleName ?? "Design"}</p>
                      <p className="text-muted text-[10px] font-mono truncate">
                        {d.customerName}{role === "admin" ? ` · ${d.designerName}` : ""}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center mt-5">
                  <button
                    onClick={() => loadPage(designs.length, false)}
                    disabled={loadingPage}
                    className="px-5 py-2.5 rounded-xl border border-cleo-border text-ink hover:border-gold/50 hover:text-gold transition-colors cursor-pointer font-mono text-xs uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingPage ? "Loading…" : "Load More"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
