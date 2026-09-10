"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

interface Customer {
  id: string;
  first_name: string;
  phone: string;
  created_at: string;
  session_count: number;
  last_session_at: string | null;
}

export default function CustomersPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filtered, setFiltered] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/studio/login"); return; }

    const { data: staffRow } = await supabase
      .from("staff").select("role").eq("id", user.id).maybeSingle();
    if (staffRow?.role !== "admin") { router.push("/studio/designer"); return; }

    // Fetch all customers with their session counts
    const { data: users } = await supabase
      .from("users")
      .select("id, first_name, phone, created_at")
      .order("created_at", { ascending: false });

    if (!users) { setLoading(false); return; }

    // Fetch session counts and latest session date per user
    const { data: sessions } = await supabase
      .from("sessions")
      .select("user_id, created_at");

    const countMap: Record<string, number> = {};
    const latestMap: Record<string, string> = {};
    (sessions ?? []).forEach((s: { user_id: string | null; created_at: string }) => {
      if (!s.user_id) return;
      countMap[s.user_id] = (countMap[s.user_id] ?? 0) + 1;
      if (!latestMap[s.user_id] || s.created_at > latestMap[s.user_id]) {
        latestMap[s.user_id] = s.created_at;
      }
    });

    const enriched: Customer[] = users.map((u) => ({
      ...u,
      session_count: countMap[u.id] ?? 0,
      last_session_at: latestMap[u.id] ?? null,
    }));

    setCustomers(enriched);
    setFiltered(enriched);
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => { load(); }, [load]);

  // Filter on search change
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q) { setFiltered(customers); return; }
    setFiltered(
      customers.filter(
        (c) =>
          c.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
          c.phone.toLowerCase().includes(q)
      )
    );
  }, [search, customers]);

  return (
    <div className="min-h-[100dvh] bg-bg flex flex-col">
      {/* Header */}
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center gap-3">
        <Link href="/studio/admin" className="text-muted hover:text-gold transition-colors text-xs font-mono tracking-wider flex items-center gap-1.5 flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Admin
        </Link>
        <span className="text-cleo-border">/</span>
        <span className="text-muted text-xs font-mono">Customers</span>
        <span className="ml-auto text-[10px] font-mono text-muted bg-surface border border-cleo-border px-2.5 py-1 rounded-full">
          {filtered.length} {filtered.length === 1 ? "customer" : "customers"}
        </span>
      </header>

      <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-3xl mx-auto w-full flex flex-col gap-5">

        {/* Search bar */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by phone number…"
              autoFocus
              className="w-full bg-surface border border-cleo-border rounded-xl pl-11 pr-10 py-3.5 text-ink text-sm placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
            />
            <AnimatePresence>
              {search && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => setSearch("")}
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
          <div className="flex items-center gap-3 py-10 justify-center">
            <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
            <span className="text-muted text-sm font-mono">Loading customers…</span>
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="bg-surface border border-cleo-border rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
            <span className="text-3xl text-muted/20">✦</span>
            <p className="text-muted text-sm">
              {search ? `No customers match "${search}"` : "No customers yet."}
            </p>
            {search && (
              <button onClick={() => setSearch("")} className="text-gold text-xs font-mono underline cursor-pointer">
                Clear search
              </button>
            )}
          </motion.div>
        ) : (
          <div className="flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {filtered.map((c, i) => (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.2, delay: search ? 0 : i * 0.03 }}
                >
                  <Link
                    href={`/customer/${c.id}?from=/studio/admin/customers`}
                    className="bg-surface border border-cleo-border rounded-xl px-4 py-3.5 flex items-center gap-4 hover:border-gold/40 transition-colors group"
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0 group-hover:border-gold/40 transition-colors">
                      <span className="font-cinzel text-sm font-black text-gold">
                        {c.first_name.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-ink font-semibold truncate group-hover:text-gold transition-colors">
                        {c.first_name}
                      </p>
                      <p className="text-muted text-xs font-mono">{c.phone}</p>
                    </div>

                    {/* Stats */}
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
                          : `Since ${new Date(c.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`}
                      </p>
                    </div>

                    {/* Mobile session count */}
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
          </div>
        )}
      </div>
    </div>
  );
}
