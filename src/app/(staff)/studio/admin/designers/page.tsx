"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import FilterChips from "@/components/ui/FilterChips";
import type { StaffMember } from "@/lib/staff-types";

type DesignerRow = StaffMember & { session_count: number };

const PAGE_SIZE = 10;
const DESIGNER_SELECT = "id, email, name, role, is_active, created_at, avatar_url";

type ActiveFilter = "all" | "active" | "inactive";

function DesignersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();

  const [designers, setDesigners] = useState<DesignerRow[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DesignerRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Edit modal (name, email, photo, active status)
  const [editingDesigner, setEditingDesigner] = useState<DesignerRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [editAvatarBase64, setEditAvatarBase64] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const editAvatarInputRef = useRef<HTMLInputElement>(null);

  // Pre-select the filter from ?status=active (e.g. linked from the
  // dashboard's "Active" stat card) — defaults to "all" otherwise.
  const initialStatus = searchParams.get("status");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(
    initialStatus === "active" || initialStatus === "inactive" ? initialStatus : "all"
  );

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/studio/login"); return; }

    const { data: staffCheck } = await supabase
      .from("staff").select("role").eq("id", user.id).maybeSingle();
    if (staffCheck?.role !== "admin") { router.push("/studio/designer"); return; }

    // Reads directly from Supabase (RLS already grants admins full access
    // to `staff`) instead of a Next.js API route — see the counts view
    // comment in supabase-schema.sql for why the session count is a
    // separate aggregate query rather than pulling every session row.
    const [staffRes, countsRes] = await Promise.all([
      supabase
        .from("staff")
        .select(DESIGNER_SELECT)
        .eq("role", "designer")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("designer_session_counts").select("designer_id, session_count"),
    ]);

    if (countsRes.error) console.error("designer_session_counts query failed — has the migration in supabase-schema.sql been run?", countsRes.error);

    const cm: Record<string, number> = {};
    (countsRes.data ?? []).forEach((s: { designer_id: string; session_count: number }) => {
      cm[s.designer_id] = s.session_count;
    });

    const des = (staffRes.data ?? []).map((s) => ({ ...s, session_count: cm[s.id] ?? 0 })) as DesignerRow[];
    setDesigners(des);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live search — queries Supabase directly on every keystroke, no debounce.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      const { data, error } = await supabase
        .from("staff")
        .select(DESIGNER_SELECT)
        .eq("role", "designer")
        .is("deleted_at", null)
        .ilike("name", `%${q}%`)
        .order("name", { ascending: true });

      if (cancelled) return;
      if (error) {
        setSearchResults([]);
      } else {
        const countMap: Record<string, number> = {};
        designers.forEach((d) => { countMap[d.id] = d.session_count; });
        setSearchResults((data ?? []).map((s) => ({ ...s, session_count: countMap[s.id] ?? 0 })) as DesignerRow[]);
      }
      setSearching(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function toggleDesigner(id: string, current: boolean) {
    setTogglingId(id);
    // Plain is_active flip — RLS already grants admins direct write access
    // to `staff`, no need for the API route's server-side hop.
    const { error } = await supabase.from("staff").update({ is_active: !current }).eq("id", id);
    if (error) { setTogglingId(null); return; }
    const patch = (arr: DesignerRow[]) =>
      arr.map((d) => d.id === id ? { ...d, is_active: !current } : d);
    setDesigners(patch);
    setSearchResults((prev) => prev ? patch(prev) : prev);
    setTogglingId(null);
  }

  async function deleteDesigner(id: string, name: string) {
    const ok = window.confirm(
      `Remove ${name}? They will no longer appear in the designers list and cannot log in. All past sessions and customer history they worked on will remain intact.`
    );
    if (!ok) return;

    setDeletingId(id);
    const res = await fetch("/api/studio/designers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed to remove designer" }));
      window.alert(error ?? "Failed to remove designer");
      setDeletingId(null);
      return;
    }

    const filterOut = (arr: DesignerRow[]) => arr.filter((d) => d.id !== id);
    setDesigners(filterOut);
    setSearchResults((prev) => prev ? filterOut(prev) : prev);
    setDeletingId(null);
  }

  function openEdit(d: DesignerRow) {
    setEditingDesigner(d);
    setEditName(d.name);
    setEditEmail(d.email);
    setEditActive(d.is_active);
    setEditAvatarPreview(d.avatar_url ?? null);
    setEditAvatarBase64(null);
    setEditError("");
  }

  function closeEdit() {
    if (editSaving) return;
    setEditingDesigner(null);
  }

  function handlePickEditAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setEditAvatarBase64(result);
      setEditAvatarPreview(result);
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDesigner) return;

    const name = editName.trim();
    const email = editEmail.trim();
    if (!name || !email) {
      setEditError("Name and email are required");
      return;
    }

    setEditSaving(true);
    setEditError("");

    const nameChanged = name !== editingDesigner.name;
    const emailChanged = email !== editingDesigner.email;
    const activeChanged = editActive !== editingDesigner.is_active;
    const avatarChanged = !!editAvatarBase64;

    let updated: StaffMember | null = null;

    if (emailChanged || avatarChanged) {
      // Changing the login email needs the Supabase Admin API, and the
      // photo upload needs the storage service role — both only available
      // server-side. Only take this path when one of them actually changed.
      const res = await fetch("/api/studio/designers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingDesigner.id,
          ...(nameChanged ? { name } : {}),
          ...(emailChanged ? { email } : {}),
          ...(activeChanged ? { is_active: editActive } : {}),
          ...(avatarChanged ? { avatarBase64: editAvatarBase64 } : {}),
        }),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed to save changes" }));
        setEditError(error ?? "Failed to save changes");
        setEditSaving(false);
        return;
      }
      ({ staff: updated } = await res.json() as { staff: StaffMember });
    } else if (nameChanged || activeChanged) {
      // A plain name/active-status change — RLS already grants admins
      // direct write access to `staff`, so this skips the API route (and
      // its own server-side Supabase dependency) entirely.
      const updates: { name?: string; is_active?: boolean } = {};
      if (nameChanged) updates.name = name;
      if (activeChanged) updates.is_active = editActive;

      const { data, error } = await supabase
        .from("staff")
        .update(updates)
        .eq("id", editingDesigner.id)
        .select("id, email, name, role, is_active, created_at, avatar_url")
        .single();

      if (error) {
        setEditError("Failed to save changes");
        setEditSaving(false);
        return;
      }
      updated = data as StaffMember;
    }

    if (updated) {
      const patch = (arr: DesignerRow[]) =>
        arr.map((d) => d.id === updated!.id ? { ...d, ...updated } : d);
      setDesigners(patch);
      setSearchResults((prev) => prev ? patch(prev) : prev);
    }

    setEditSaving(false);
    setEditingDesigner(null);
  }

  const isSearchMode = query.trim().length > 0;
  const baseList = isSearchMode ? (searchResults ?? []) : designers;
  const filteredDesigners = baseList.filter(
    (d) => activeFilter === "all" || (activeFilter === "active" ? d.is_active : !d.is_active)
  );
  const isFiltered = isSearchMode || activeFilter !== "all";
  const visible = isFiltered ? filteredDesigners : designers.slice(0, visibleCount);
  const hasMore = !isFiltered && visibleCount < designers.length;

  return (
    <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-3xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-1">Studio Staff</p>
          <h1 className="font-cinzel text-2xl font-black text-ink">Designers</h1>
        </div>
        <span className="ml-auto text-[10px] font-mono text-muted bg-surface border border-cleo-border px-2.5 py-1 rounded-full">
          {searching
            ? "Searching…"
            : isFiltered
              ? `${filteredDesigners.length} match${filteredDesigners.length === 1 ? "" : "es"}`
              : `${visible.length} of ${designers.length}`}
        </span>
        <Link href="/studio/admin/designers/new" className="px-4 py-2 bg-gold text-bg font-cinzel font-bold text-xs tracking-[0.08em] uppercase rounded-lg border border-gold hover:bg-gold-light transition-colors flex-shrink-0">
          + Add Designer
        </Link>
      </div>

      {/* Search bar */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex flex-col gap-3">
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
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

        <FilterChips
          value={activeFilter}
          onChange={setActiveFilter}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
      </motion.div>

      {loading ? (
        <div className="flex items-center gap-3 py-10 justify-center">
          <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          <span className="text-muted text-sm font-mono">Loading designers…</span>
        </div>
      ) : searching ? (
        <div className="flex items-center gap-3 py-10 justify-center">
          <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          <span className="text-muted text-sm font-mono">Searching…</span>
        </div>
      ) : designers.length === 0 ? (
        <div className="bg-surface border border-cleo-border rounded-2xl p-10 text-center">
          <p className="text-muted text-sm">No designers yet. Add one above.</p>
        </div>
      ) : visible.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-surface border border-cleo-border rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
          <span className="text-3xl text-muted/20">✦</span>
          <p className="text-muted text-sm">
            {isSearchMode ? `No designers match "${query}"` : `No ${activeFilter} designers.`}
          </p>
          <button
            onClick={() => { setQuery(""); setActiveFilter("all"); }}
            className="text-gold text-xs font-mono underline cursor-pointer"
          >
            Clear filters
          </button>
        </motion.div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence mode="popLayout">
            {visible.map((d, i) => (
              <motion.div
                key={d.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2, delay: i * 0.03 }}
                className="bg-surface border border-cleo-border rounded-xl px-4 py-3 flex items-center gap-4"
              >
                <Link href={`/studio/admin/designers/${d.id}`} className="flex items-center gap-3 flex-1 min-w-0 group">
                  <div className="relative w-9 h-9 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0 overflow-hidden group-hover:border-gold/50 transition-colors">
                    {d.avatar_url ? (
                      <Image src={d.avatar_url} alt={d.name} fill unoptimized className="object-cover" />
                    ) : (
                      <span className="font-cinzel text-sm font-black text-gold">{d.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-ink text-sm font-semibold truncate group-hover:text-gold transition-colors">{d.name}</p>
                    <p className="text-muted text-xs font-mono truncate">{d.email} · {d.session_count} sessions</p>
                  </div>
                </Link>

                <button
                  onClick={() => toggleDesigner(d.id, d.is_active)}
                  disabled={togglingId === d.id}
                  title={d.is_active ? "Deactivate" : "Activate"}
                  className={`flex-shrink-0 relative w-11 h-6 rounded-full border transition-colors cursor-pointer disabled:opacity-50 ${
                    d.is_active ? "bg-success/20 border-success/40" : "bg-cleo-border border-cleo-border"
                  }`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${
                    d.is_active ? "left-5 bg-success" : "left-0.5 bg-muted"
                  }`} />
                </button>
                <span className={`text-[10px] font-mono uppercase w-10 flex-shrink-0 hidden sm:inline ${d.is_active ? "text-success" : "text-muted/50"}`}>
                  {d.is_active ? "Active" : "Off"}
                </span>

                <button
                  onClick={() => openEdit(d)}
                  title="Edit designer"
                  aria-label={`Edit ${d.name}`}
                  className="flex-shrink-0 w-8 h-8 rounded-lg border border-cleo-border text-muted hover:text-gold hover:border-gold/40 transition-colors flex items-center justify-center cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>

                <button
                  onClick={() => deleteDesigner(d.id, d.name)}
                  disabled={deletingId === d.id}
                  title="Remove designer"
                  aria-label={`Remove ${d.name}`}
                  className="flex-shrink-0 w-8 h-8 rounded-lg border border-cleo-border text-muted hover:text-error hover:border-error/40 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50"
                >
                  {deletingId === d.id ? (
                    <div className="w-3.5 h-3.5 border-2 border-error border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                    </svg>
                  )}
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          {hasMore && (
            <button
              onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
              className="mt-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-gold hover:text-gold-light border border-cleo-border hover:border-gold/40 rounded-xl transition-colors cursor-pointer"
            >
              Load More
            </button>
          )}
        </div>
      )}

      {/* Edit designer modal */}
      <AnimatePresence>
        {editingDesigner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeEdit}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface border border-cleo-border rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-cinzel text-lg font-black text-ink">Edit Designer</h2>
                <button onClick={closeEdit} className="text-muted hover:text-ink transition-colors cursor-pointer">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => editAvatarInputRef.current?.click()}
                    className="relative w-20 h-20 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center overflow-hidden group cursor-pointer"
                  >
                    {editAvatarPreview ? (
                      <Image src={editAvatarPreview} alt="" fill unoptimized className="object-cover" />
                    ) : (
                      <span className="font-cinzel text-2xl font-black text-gold">
                        {editName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="absolute inset-0 bg-bg/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <svg className="w-5 h-5 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  </button>
                  <input
                    ref={editAvatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePickEditAvatar}
                    className="hidden"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-muted text-[11px] font-mono uppercase tracking-wider">Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-bg border border-cleo-border rounded-lg px-3.5 py-2.5 text-ink text-sm focus:outline-none focus:border-gold transition-colors"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-muted text-[11px] font-mono uppercase tracking-wider">Email</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full bg-bg border border-cleo-border rounded-lg px-3.5 py-2.5 text-ink text-sm focus:outline-none focus:border-gold transition-colors"
                  />
                  <p className="text-muted/60 text-[10px]">Changing this changes the login email too.</p>
                </div>

                <div className="flex items-center justify-between bg-bg border border-cleo-border rounded-lg px-3.5 py-2.5">
                  <span className="text-ink text-sm">Active</span>
                  <button
                    type="button"
                    onClick={() => setEditActive((v) => !v)}
                    className={`relative w-11 h-6 rounded-full border transition-colors cursor-pointer ${
                      editActive ? "bg-success/20 border-success/40" : "bg-cleo-border border-cleo-border"
                    }`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${
                      editActive ? "left-5 bg-success" : "left-0.5 bg-muted"
                    }`} />
                  </button>
                </div>

                {editError && <p className="text-error text-xs">{editError}</p>}

                <div className="flex gap-3 mt-1">
                  <button
                    type="button"
                    onClick={closeEdit}
                    className="flex-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-muted border border-cleo-border rounded-xl transition-colors cursor-pointer hover:text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="flex-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-bg bg-gold hover:bg-gold-light rounded-xl transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {editSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function DesignersPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DesignersPageInner />
    </Suspense>
  );
}
