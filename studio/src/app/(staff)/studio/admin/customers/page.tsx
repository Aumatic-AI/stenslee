"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { useFeature } from "@/lib/permissions/use-feature";
import { FeatureLocked } from "@/components/ui/FeatureLocked";

const PAGE_SIZE = 10;

interface Customer {
  id: string;
  name: string;
  phone: string;
  created_at: string;
  session_count: number;
  last_session_at: string | null;
}

// Attaches session_count/last_session_at (from customer_session_stats) onto a
// bare {id, name, phone[, created_at]} row list — used for both the
// paginated browse list and the search-result list.
async function withStats(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  rows: { id: string; name: string; phone: string; created_at?: string }[]
): Promise<Customer[]> {
  if (rows.length === 0) return [];
  const { data: stats, error } = await supabase
    .from("customer_session_stats")
    .select("customer_id, session_count, last_session_at")
    .in("customer_id", rows.map((r) => r.id));
  if (error) console.error("customer_session_stats query failed — has the migration in supabase-schema.sql been run?", error);

  const countMap: Record<string, number> = {};
  const latestMap: Record<string, string> = {};
  (stats ?? []).forEach((s: { customer_id: string; session_count: number; last_session_at: string | null }) => {
    countMap[s.customer_id] = s.session_count;
    if (s.last_session_at) latestMap[s.customer_id] = s.last_session_at;
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    created_at: r.created_at ?? "",
    session_count: countMap[r.id] ?? 0,
    last_session_at: latestMap[r.id] ?? null,
  }));
}

function CustomerRowSkeleton() {
  return (
    <div className="bg-surface border border-cleo-border rounded-xl px-4 py-3.5 flex items-center gap-4">
      <div className="skeleton w-10 h-10 rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="skeleton h-3.5 w-28 rounded" />
        <div className="skeleton h-2.5 w-24 rounded" />
      </div>
      <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0">
        <div className="skeleton h-3.5 w-16 rounded" />
        <div className="skeleton h-2.5 w-24 rounded" />
      </div>
      <div className="skeleton w-4 h-4 rounded flex-shrink-0" />
    </div>
  );
}

export default function CustomersPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const customerManagementFeature = useFeature("customer_management");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Customer[] | null>(null);
  const [searching, setSearching] = useState(false);

  const loadPage = useCallback(async (offset: number) => {
    const { data, count } = await supabase
      .from("customers")
      .select("id, name, phone, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const withCounts = await withStats(supabase, data ?? []);
    setTotalCount(count ?? 0);
    return withCounts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/studio/login"); return; }

      const { data: staffRow } = await supabase
        .from("staff").select("role").eq("id", user.id).maybeSingle();
      if (staffRow?.role !== "admin") { router.push("/studio/designer"); return; }

      const rows = await loadPage(0);
      setCustomers(rows);
      setLoading(false);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLoadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const rows = await loadPage(customers.length);
    setCustomers((prev) => [...prev, ...rows]);
    setLoadingMore(false);
  }

  // Live search — queries on every keystroke (no debounce), searches name +
  // phone via the same RPC used on the designer dashboard.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      const { data } = await supabase.rpc("search_customers", { q });
      const withCounts = await withStats(supabase, data ?? []);
      if (cancelled) return;
      setSearchResults(withCounts);
      setSearching(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const isSearchMode = query.trim().length > 0;
  const displayed = isSearchMode ? (searchResults ?? []) : customers;
  const hasMore = !isSearchMode && customers.length < totalCount;

  if (!customerManagementFeature.loading && !customerManagementFeature.enabled) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <FeatureLocked title="Customers not available" message="Customer management isn't included in your current plan." />
      </div>
    );
  }

  return (
    <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-3xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-1">Studio Records</p>
          <h1 className="font-cinzel text-2xl font-black text-ink">Customers</h1>
        </div>
        <span className="ml-auto text-[10px] font-mono text-muted bg-surface border border-cleo-border px-2.5 py-1 rounded-full">
          {searching
            ? "Searching…"
            : isSearchMode
              ? `${displayed.length} match${displayed.length === 1 ? "" : "es"}`
              : `${customers.length} of ${totalCount}`}
        </span>
      </div>

      {/* Search bar */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or phone number…"
            className="w-full bg-surface border border-cleo-border rounded-xl pl-11 pr-10 py-3.5 text-ink text-sm placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
          />
          <AnimatePresence>
            {query && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-cleo-border flex items-center justify-center text-muted hover:text-ink transition-colors cursor-pointer"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => <CustomerRowSkeleton key={i} />)}
        </div>
      ) : searching ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <CustomerRowSkeleton key={i} />)}
        </div>
      ) : displayed.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-surface border border-cleo-border rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
          <span className="text-3xl text-muted/20">✦</span>
          <p className="text-muted text-sm">
            {isSearchMode ? `No customers match "${query}"` : "No customers yet."}
          </p>
          {isSearchMode && (
            <button onClick={() => setQuery("")} className="text-gold text-xs font-mono underline cursor-pointer">
              Clear search
            </button>
          )}
        </motion.div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence mode="popLayout">
            {displayed.map((c, i) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2, delay: isSearchMode ? 0 : i * 0.03 }}
              >
                <Link
                  href={`/customer/${c.id}?from=/studio/admin/customers`}
                  className="bg-surface border border-cleo-border rounded-xl px-4 py-3.5 flex items-center gap-4 hover:border-gold/40 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0 group-hover:border-gold/40 transition-colors">
                    <span className="font-cinzel text-sm font-black text-gold">
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-ink font-semibold truncate group-hover:text-gold transition-colors">
                      {c.name}
                    </p>
                    <p className="text-muted text-xs font-mono">{c.phone}</p>
                  </div>

                  <div className="text-right flex-shrink-0 hidden sm:block">
                    <p className="text-ink text-sm font-cinzel font-bold">
                      {c.session_count}
                      <span className="text-muted font-normal text-xs ml-1">
                        {c.session_count === 1 ? "session" : "sessions"}
                      </span>
                    </p>
                    <p className="text-muted/60 text-[10px] font-mono">
                      {c.last_session_at
                        ? `Last: ${new Date(c.last_session_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                        : c.created_at
                          ? `Since ${new Date(c.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
                          : ""}
                    </p>
                  </div>

                  <div className="sm:hidden text-right flex-shrink-0">
                    <p className="font-cinzel font-black text-gold text-base leading-none">{c.session_count}</p>
                    <p className="text-muted text-[9px] font-mono uppercase tracking-wider mt-0.5">sessions</p>
                  </div>

                  <svg className="w-4 h-4 text-muted/30 group-hover:text-gold/60 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </motion.div>
            ))}
          </AnimatePresence>
          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="mt-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-gold hover:text-gold-light border border-cleo-border hover:border-gold/40 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load More"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
