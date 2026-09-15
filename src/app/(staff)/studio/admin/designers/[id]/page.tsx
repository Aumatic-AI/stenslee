"use client";

import { useState, useEffect, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import type { StaffMember } from "@/lib/staff-types";

interface DesignRow {
  image_url: string;
  style_name: string | null;
  is_finalized: boolean;
}

interface SessionRow {
  id: string;
  tattoo_style: string | null;
  tattoo_description: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  users: { first_name: string; phone: string } | null;
  tattoo_designs: DesignRow[];
}

function TattooThumb({ url }: { url: string }) {
  const [err, setErr] = useState(false);
  if (err) return <div className="w-full h-full flex items-center justify-center"><span className="text-muted/30 text-xl">✦</span></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="Design" className="w-full h-full object-cover" onError={() => setErr(true)} />;
}

function DesignerDetailSkeleton() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center gap-3">
        <div className="skeleton h-3 w-20 rounded" />
      </header>
      <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-4xl mx-auto w-full flex flex-col gap-7">
        <div className="bg-surface border border-cleo-border rounded-2xl p-5 sm:p-6 flex items-center gap-5">
          <div className="skeleton w-14 h-14 rounded-full flex-shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="skeleton h-4 w-36 rounded" />
            <div className="skeleton h-3 w-44 rounded" />
            <div className="skeleton h-2.5 w-40 rounded" />
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <div className="skeleton h-7 w-10 rounded" />
            <div className="skeleton h-6 w-32 rounded-lg" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-surface border border-cleo-border rounded-xl p-4 flex flex-col items-center gap-2">
              <div className="skeleton h-6 w-8 rounded" />
              <div className="skeleton h-2.5 w-16 rounded" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-cleo-border rounded-2xl p-4 flex gap-4">
                <div className="skeleton w-20 h-20 sm:w-24 sm:h-24 rounded-xl flex-shrink-0" />
                <div className="flex-1 flex flex-col justify-center gap-1.5">
                  <div className="skeleton h-3.5 w-28 rounded" />
                  <div className="skeleton h-2.5 w-40 rounded" />
                  <div className="skeleton h-2.5 w-20 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DesignerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [designer, setDesigner] = useState<StaffMember | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Password reset
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [lastSetPassword, setLastSetPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // Edit designer modal (name, email, photo, active status) — same modal as
  // the Designers list page, so admins get one consistent editing experience.
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [editAvatarBase64, setEditAvatarBase64] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const editAvatarInputRef = useRef<HTMLInputElement>(null);

  function openEdit() {
    if (!designer) return;
    setEditName(designer.name);
    setEditEmail(designer.email);
    setEditActive(designer.is_active);
    setEditAvatarPreview(designer.avatar_url ?? null);
    setEditAvatarBase64(null);
    setEditError("");
    setEditOpen(true);
  }

  function closeEdit() {
    if (editSaving) return;
    setEditOpen(false);
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
    if (!designer) return;

    const name = editName.trim();
    const email = editEmail.trim();
    if (!name || !email) {
      setEditError("Name and email are required");
      return;
    }

    setEditSaving(true);
    setEditError("");

    const nameChanged = name !== designer.name;
    const emailChanged = email !== designer.email;
    const activeChanged = editActive !== designer.is_active;
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
          id: designer.id,
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
      // direct write access to `staff`, so this skips the API route.
      const updates: { name?: string; is_active?: boolean } = {};
      if (nameChanged) updates.name = name;
      if (activeChanged) updates.is_active = editActive;

      const { data, error } = await supabase
        .from("staff")
        .update(updates)
        .eq("id", designer.id)
        .select("id, email, name, role, is_active, created_at, avatar_url")
        .single();

      if (error) {
        setEditError("Failed to save changes");
        setEditSaving(false);
        return;
      }
      updated = data as StaffMember;
    }

    if (updated) setDesigner((prev) => (prev ? { ...prev, ...updated } : prev));
    setEditSaving(false);
    setEditOpen(false);
  }

  function generatePassword() {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let pwd = "";
    const bytes = new Uint32Array(12);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 12; i++) pwd += charset[bytes[i] % charset.length];
    setNewPassword(pwd);
    setShowNewPassword(true);
    setResetError(null);
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setResetError("Password must be at least 6 characters.");
      return;
    }
    setResetLoading(true);
    setResetError(null);
    const res = await fetch("/api/studio/designers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password: newPassword }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed to reset password" }));
      setResetError(error ?? "Failed to reset password");
      setResetLoading(false);
      return;
    }
    setLastSetPassword(newPassword);
    setNewPassword("");
    setShowNewPassword(false);
    setResetOpen(false);
    setResetLoading(false);
  }

  async function copyPassword() {
    if (!lastSetPassword) return;
    try {
      await navigator.clipboard.writeText(lastSetPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard might be blocked
    }
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/studio/login"); return; }

      const { data: selfStaff } = await supabase
        .from("staff").select("role").eq("id", user.id).maybeSingle();
      if (selfStaff?.role !== "admin") { router.push("/studio/designer"); return; }

      const [designerRes, sessionsRes] = await Promise.all([
        supabase
          .from("staff")
          .select("id, email, name, role, is_active, created_at, avatar_url")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("sessions")
          .select(`
            id, tattoo_style, tattoo_description, status, created_at, completed_at,
            users(first_name, phone),
            tattoo_designs(image_url, style_name, is_finalized)
          `)
          .eq("designer_id", id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ]);

      if (!designerRes.data) { setNotFound(true); setLoading(false); return; }
      setDesigner(designerRes.data as StaffMember);
      setSessions((sessionsRes.data ?? []) as unknown as SessionRow[]);
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const statusColor = (s: string) =>
    s === "completed" ? "text-success" : s === "abandoned" ? "text-error" : "text-gold";

  if (loading) {
    return <DesignerDetailSkeleton />;
  }

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <p className="font-cinzel text-xl text-ink">Designer not found.</p>
        <Link href="/studio/admin/designers" className="text-gold underline font-mono text-sm">Back to designers</Link>
      </div>
    );
  }

  const completedSessions = sessions.filter((s) => s.status === "completed");
  const activeSessions = sessions.filter((s) => s.status === "active");

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center gap-3">
        <Link href="/studio/admin/designers" className="text-muted hover:text-gold transition-colors text-xs font-mono tracking-wider flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Designers
        </Link>
        <span className="text-cleo-border">/</span>
        <span className="text-muted text-xs font-mono truncate">{designer?.name}</span>
      </header>

      <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-4xl mx-auto w-full flex flex-col gap-7">

        {/* Designer profile */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="bg-surface border border-cleo-border rounded-2xl p-5 sm:p-6 flex items-center gap-5">
          <div className="relative w-14 h-14 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {designer?.avatar_url ? (
              <Image src={designer.avatar_url} alt={designer.name} fill unoptimized className="object-cover" />
            ) : (
              <span className="font-cinzel text-2xl font-black text-gold">{designer?.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-cinzel text-xl font-black text-ink">{designer?.name}</h1>
            <p className="text-muted text-sm font-mono">{designer?.email}</p>
            <p className="text-muted/60 text-xs font-mono tracking-widest uppercase mt-1">
              Designer · Joined {new Date(designer!.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long" })}
            </p>
          </div>
          <div className="text-right flex-shrink-0 flex flex-col items-end gap-2">
            <div>
              <p className="font-cinzel text-3xl font-black text-gold leading-none">{sessions.length}</p>
              <p className="text-muted text-[10px] font-mono uppercase tracking-widest mt-1">Total Sessions</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={openEdit}
                className="px-3 py-1.5 text-[10px] font-cinzel font-bold tracking-[0.15em] uppercase rounded-lg border border-cleo-border text-muted hover:text-gold hover:border-gold/40 transition-colors cursor-pointer"
              >
                Edit Profile
              </button>
              <button
                onClick={() => { setResetOpen(true); setResetError(null); setLastSetPassword(null); }}
                className="px-3 py-1.5 text-[10px] font-cinzel font-bold tracking-[0.15em] uppercase rounded-lg border border-gold/40 text-gold hover:bg-gold/10 transition-colors cursor-pointer"
              >
                Reset Password
              </button>
            </div>
          </div>
        </motion.div>

        {/* Password reset — only shown when triggered */}
        {(resetOpen || lastSetPassword) && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="bg-surface border border-cleo-border rounded-2xl p-5 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-cinzel text-xs font-bold tracking-[0.18em] text-muted uppercase">Reset Password</p>
              <p className="text-muted/70 text-xs font-mono mt-1">
                Set a new password. We don&apos;t store it — write it down now.
              </p>
            </div>
            <button
              onClick={() => { setResetOpen(false); setLastSetPassword(null); setNewPassword(""); setResetError(null); setShowNewPassword(false); }}
              aria-label="Close"
              className="flex-shrink-0 w-7 h-7 rounded-lg border border-cleo-border text-muted hover:text-ink hover:border-ink/40 transition-colors flex items-center justify-center cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {lastSetPassword && (
            <div className="bg-gold/5 border border-gold/30 rounded-xl p-4 flex flex-col gap-2">
              <p className="text-[10px] font-mono tracking-widest uppercase text-gold">New password — copy it now</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-bg border border-cleo-border rounded-lg px-3 py-2 text-ink font-mono text-sm break-all select-all">
                  {lastSetPassword}
                </code>
                <button
                  onClick={copyPassword}
                  className="flex-shrink-0 px-3 py-2 text-xs font-mono uppercase tracking-wider rounded-lg border border-gold/40 text-gold hover:bg-gold/10 transition-colors cursor-pointer"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <p className="text-muted/70 text-[10px] font-mono">
                  This will disappear when you leave the page.
                </p>
                <button
                  onClick={() => setLastSetPassword(null)}
                  className="text-muted hover:text-ink text-xs font-mono underline cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {resetOpen && (
            <form onSubmit={handleReset} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">New password</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setResetError(null); }}
                    placeholder="At least 6 characters"
                    className="w-full bg-bg border border-cleo-border rounded-xl px-4 py-3 pr-11 text-ink text-base placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-gold transition-colors"
                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                  >
                    {showNewPassword ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {resetError && (
                <p className="text-error text-xs font-mono">{resetError}</p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={generatePassword}
                  className="px-3 py-2 text-xs font-mono uppercase tracking-wider rounded-lg border border-cleo-border text-muted hover:text-gold hover:border-gold/40 transition-colors cursor-pointer"
                >
                  Generate
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => { setResetOpen(false); setNewPassword(""); setResetError(null); setShowNewPassword(false); }}
                  disabled={resetLoading}
                  className="px-3 py-2 text-xs font-mono uppercase tracking-wider rounded-lg text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading || newPassword.length < 6}
                  className="px-4 py-2 text-xs font-cinzel font-bold uppercase tracking-widest rounded-lg bg-gold text-bg border border-gold hover:bg-gold-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {resetLoading ? "Saving…" : "Set Password"}
                </button>
              </div>
            </form>
          )}
        </motion.div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Completed", value: completedSessions.length, color: "text-success" },
            { label: "In Progress", value: activeSessions.length, color: "text-gold" },
            { label: "Total Designs", value: sessions.reduce((n, s) => n + s.tattoo_designs.length, 0), color: "text-ink" },
          ].map((stat) => (
            <div key={stat.label} className="bg-surface border border-cleo-border rounded-xl p-4 text-center">
              <p className={`font-cinzel text-2xl font-black leading-none ${stat.color}`}>{stat.value}</p>
              <p className="text-muted text-[10px] font-mono uppercase tracking-widest mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Sessions list */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <h2 className="font-cinzel text-sm font-bold tracking-[0.18em] text-muted uppercase">All Sessions</h2>
            <div className="flex-1 h-px bg-cleo-border" />
          </div>

          {sessions.length === 0 ? (
            <div className="bg-surface border border-cleo-border rounded-2xl p-10 text-center">
              <p className="text-muted text-sm">No sessions yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sessions.map((s, i) => {
                const customer = Array.isArray(s.users) ? s.users[0] : s.users;
                const designs = Array.isArray(s.tattoo_designs) ? s.tattoo_designs : [];
                const finalDesign = designs.find((d) => d.is_finalized) ?? designs[0];
                const dateLabel = new Date(s.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

                return (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="bg-surface border border-cleo-border rounded-2xl overflow-hidden hover:border-gold/30 transition-colors"
                  >
                    <div className="p-4 flex gap-4">
                      {/* Design thumbnail */}
                      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-surface-2 border border-cleo-border flex-shrink-0">
                        {finalDesign?.image_url ? (
                          <button type="button" onClick={() => setViewingImage(finalDesign.image_url)} className="w-full h-full cursor-pointer hover:opacity-80 transition-opacity">
                            <TattooThumb url={finalDesign.image_url} />
                          </button>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="text-2xl text-muted/20">✦</span>
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-ink font-semibold truncate">{customer?.first_name ?? "Unknown"}</p>
                            <span className={`text-[10px] font-mono font-bold uppercase flex-shrink-0 ${statusColor(s.status)}`}>{s.status}</span>
                          </div>
                          {customer?.phone && (
                            <p className="text-muted text-xs font-mono">{customer.phone}</p>
                          )}
                          {s.tattoo_style && (
                            <p className="text-gold text-xs font-cinzel font-bold tracking-wider truncate">{s.tattoo_style}</p>
                          )}
                          {s.tattoo_description && (
                            <p className="text-muted text-xs line-clamp-1">{s.tattoo_description}</p>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-2">
                          <p className="text-muted/50 text-[10px] font-mono">{dateLabel} · {designs.length} design{designs.length !== 1 ? "s" : ""}</p>
                          <Link
                            href={`/studio/admin/sessions/${s.id}?from=/studio/admin/designers/${id}`}
                            className="text-[10px] font-cinzel tracking-widest text-gold/60 hover:text-gold uppercase transition-colors"
                          >
                            View →
                          </Link>
                        </div>
                      </div>
                    </div>

                    {/* Design thumbnails strip (if multiple) */}
                    {designs.length > 1 && (
                      <div className="border-t border-cleo-border px-4 py-3 flex gap-2 overflow-x-auto">
                        {designs.map((d, j) => (
                          <div key={j} className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border ${d.is_finalized ? "border-gold/50" : "border-cleo-border"}`}>
                            {d.image_url ? (
                              <button type="button" onClick={() => setViewingImage(d.image_url!)} className="w-full h-full cursor-pointer hover:opacity-80 transition-opacity block">
                                <TattooThumb url={d.image_url} />
                              </button>
                            ) : (
                              <div className="w-full h-full bg-surface-2" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* Edit designer modal */}
      <AnimatePresence>
        {editOpen && designer && (
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

      <AnimatePresence>
        {viewingImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setViewingImage(null)}
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 cursor-pointer"
          >
            <button
              onClick={(e) => { e.stopPropagation(); setViewingImage(null); }}
              className="absolute top-4 right-4 sm:top-6 sm:right-6 w-10 h-10 rounded-full bg-surface/80 border border-cleo-border text-ink hover:bg-error/20 hover:border-error/40 hover:text-error transition-colors flex items-center justify-center text-xl leading-none z-10 cursor-pointer"
            >
              ×
            </button>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.3 }}
              className="relative w-full max-w-2xl aspect-square rounded-2xl overflow-hidden border border-gold/30 shadow-2xl bg-black"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={viewingImage} alt="Design Fullscreen" className="w-full h-full object-contain" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
