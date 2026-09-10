"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import type { StaffMember } from "@/lib/staff-types";
import Link from "next/link";

interface SessionRow {
  id: string;
  tattoo_style: string | null;
  status: string;
  created_at: string;
  users: { first_name: string } | null;
  designer: { name: string } | null;
}

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [admin, setAdmin] = useState<StaffMember | null>(null);
  const [recentSessions, setRecentSessions] = useState<SessionRow[]>([]);
  const [stats, setStats] = useState({ totalDesigners: 0, activeDesigners: 0, totalCustomers: 0, finalDesigns: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/studio/login"); return; }

    const { data: staffCheck } = await supabase
      .from("staff").select("role").eq("id", user.id).maybeSingle();
    if (staffCheck?.role !== "admin") { router.push("/studio/designer"); return; }

    const [staffRes, sessionsRes, totalRes, finalDesignsRes] = await Promise.all([
      fetch("/api/studio/designers"),
      supabase
        .from("sessions")
        .select("id, tattoo_style, status, created_at, users(first_name), designer:designer_id(name)")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("tattoo_designs").select("id", { count: "exact", head: true }).eq("is_finalized", true),
    ]);

    if (staffRes.ok) {
      const { staff: allStaff } = await staffRes.json() as { staff: StaffMember[] };

      // Count sessions per designer
      const { data: counts } = await supabase
        .from("sessions")
        .select("designer_id");

      const countMap: Record<string, number> = {};
      (counts ?? []).forEach((s: { designer_id: string | null }) => {
        if (s.designer_id) countMap[s.designer_id] = (countMap[s.designer_id] ?? 0) + 1;
      });

      const des = allStaff
        .filter((s) => s.role === "designer")
        .map((s) => ({ ...s, session_count: countMap[s.id] ?? 0 }));

      setAdmin(allStaff.find((s) => s.id === user.id && s.role === "admin") ?? null);
      setStats((prev) => ({
        ...prev,
        totalDesigners: des.length,
        activeDesigners: des.filter((d) => d.is_active).length,
      }));
    }

    if (sessionsRes.data) {
      setRecentSessions(sessionsRes.data as unknown as SessionRow[]);
    }

    setStats((prev) => ({
      ...prev,
      totalCustomers: totalRes.count ?? 0,
      finalDesigns: finalDesignsRes.count ?? 0,
    }));

    setLoading(false);
  }, [router, supabase]);

  useEffect(() => { load(); }, [load]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/studio/login");
    router.refresh();
  }

  const statusColor = (s: string) =>
    s === "completed" ? "text-success" : s === "abandoned" ? "text-error" : "text-gold";

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          <p className="text-muted font-mono text-sm tracking-widest">LOADING…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-bg flex flex-col">
      {/* Header */}
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 relative flex-shrink-0">
            <Image src="/cleopatra-logo.svg" alt="Cleopatra" fill className="object-contain" />
          </div>
          <div>
            <p className="font-cinzel text-[11px] font-bold tracking-[0.15em] text-gold uppercase leading-none">Cleopatra Ink</p>
            <p className="text-[10px] font-mono text-muted tracking-wider leading-none mt-0.5">Admin Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:block text-ink text-sm font-semibold">{admin?.name}</span>
          <span className="text-[9px] font-mono tracking-widest uppercase px-2 py-1 rounded-md bg-gold/10 border border-gold/30 text-gold">Admin</span>
          <button onClick={handleLogout} className="text-muted hover:text-error transition-colors text-xs font-mono tracking-wider px-3 py-2 rounded-lg border border-cleo-border hover:border-error/40 cursor-pointer">
            Logout
          </button>
        </div>
      </header>

      <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-4xl mx-auto w-full flex flex-col gap-8">

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-3">Studio Overview</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Designers", value: stats.totalDesigners, href: "/studio/admin/designers" },
              { label: "Active", value: stats.activeDesigners, href: "/studio/admin/designers?status=active" },
              { label: "Customers", value: stats.totalCustomers, href: "/studio/admin/customers" },
              { label: "Final Designs", value: stats.finalDesigns },
            ].map((stat) =>
              stat.href ? (
                <Link key={stat.label} href={stat.href} className="bg-surface border border-cleo-border rounded-xl p-4 hover:border-gold/40 transition-colors group">
                  <p className="font-cinzel text-2xl font-black text-gold leading-none">{stat.value}</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-muted text-[10px] font-mono uppercase tracking-widest">{stat.label}</p>
                    <span className="text-[10px] font-mono text-muted/60 group-hover:text-gold transition-colors">View →</span>
                  </div>
                </Link>
              ) : (
                <div key={stat.label} className="bg-surface border border-cleo-border rounded-xl p-4">
                  <p className="font-cinzel text-2xl font-black text-gold leading-none">{stat.value}</p>
                  <p className="text-muted text-[10px] font-mono uppercase tracking-widest mt-1">{stat.label}</p>
                </div>
              )
            )}
          </div>
        </motion.div>

        {/* Recent Sessions */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }} className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <h2 className="font-cinzel text-sm font-bold tracking-[0.18em] text-muted uppercase">Recent Sessions</h2>
            <div className="flex-1 h-px bg-cleo-border" />
            <span className="text-[10px] font-mono text-muted">Last 5</span>
          </div>

          {recentSessions.length === 0 ? (
            <div className="bg-surface border border-cleo-border rounded-xl p-6 text-center">
              <p className="text-muted text-sm">No sessions yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recentSessions.map((s) => {
                const customer = Array.isArray(s.users) ? s.users[0] : s.users;
                const designer = Array.isArray(s.designer) ? s.designer[0] : s.designer;
                return (
                  <Link key={s.id} href={`/studio/admin/sessions/${s.id}?from=/studio/admin`} className="bg-surface border border-cleo-border rounded-xl px-4 py-3 flex items-center gap-4 hover:border-gold/40 transition-colors group">
                    <div className="flex-1 min-w-0">
                      <p className="text-ink text-sm font-semibold truncate group-hover:text-gold transition-colors">
                        {customer?.first_name ?? "Unknown Customer"}
                      </p>
                      <p className="text-muted text-xs font-mono truncate">
                        {s.tattoo_style || "No style"} · by {designer?.name ?? "Unassigned"}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-xs font-mono font-bold uppercase ${statusColor(s.status)}`}>{s.status}</p>
                      <p className="text-muted/60 text-[10px] font-mono">
                        {new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-muted/50 group-hover:text-gold transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                );
              })}
            </div>
          )}
        </motion.div>

      </div>
    </div>
  );
}
