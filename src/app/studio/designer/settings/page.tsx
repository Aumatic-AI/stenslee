"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

export default function DesignerSettingsPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/studio/login"); return; }

      const { data: staffRow } = await supabase
        .from("staff")
        .select("name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (!staffRow) { router.push("/studio/login"); return; }
      setName(staffRow.name);
      setAvatarPreview(staffRow.avatar_url ?? null);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);
      setAvatarBase64(dataUrl);
      setSaved(false);
    };
    reader.readAsDataURL(file);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    setSaved(false);

    const res = await fetch("/api/studio/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        avatarBase64: avatarBase64 ?? undefined,
      }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Couldn't save changes — please try again.");
      setSaving(false);
      return;
    }

    setAvatarBase64(null);
    setSaving(false);
    setSaved(true);
  }

  return (
    <main className="min-h-[100dvh] bg-bg flex flex-col">
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center gap-3">
        <Link
          href="/studio/designer"
          className="text-muted hover:text-gold transition-colors text-xs font-mono tracking-wider flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Dashboard
        </Link>
        <span className="text-cleo-border">/</span>
        <span className="text-muted text-xs font-mono">My Profile</span>
      </header>

      <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-md mx-auto w-full flex flex-col gap-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-1">Settings</p>
          <h1 className="font-cinzel text-2xl font-black text-ink">My Profile</h1>
        </motion.div>

        <motion.form
          onSubmit={handleSave}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="bg-surface border border-cleo-border rounded-2xl p-5 sm:p-6 flex flex-col gap-5"
        >
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative w-24 h-24 rounded-full bg-gold/10 border-2 border-gold/30 hover:border-gold transition-colors flex items-center justify-center overflow-hidden cursor-pointer group"
            >
              {avatarPreview ? (
                <Image src={avatarPreview} alt="Profile photo" fill unoptimized className="object-cover" />
              ) : (
                <span className="font-cinzel text-3xl font-black text-gold">
                  {name.charAt(0).toUpperCase() || "?"}
                </span>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-white text-[10px] font-mono uppercase tracking-wider">Change</span>
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handlePickFile}
              className="hidden"
            />
            <p className="text-muted text-[10px] font-mono uppercase tracking-wider">Tap photo to change</p>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Display name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setSaved(false); }}
              placeholder="Your name"
              className="bg-bg border border-cleo-border rounded-xl px-4 py-3 text-ink text-base placeholder:text-muted/40 focus:outline-none focus:border-gold transition-colors"
            />
          </div>

          {error && <p className="text-error text-xs">{error}</p>}
          {saved && !error && <p className="text-success text-xs">Saved.</p>}

          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="py-3 bg-gold text-bg font-cinzel font-bold text-sm tracking-[0.08em] uppercase rounded-xl border border-gold hover:bg-gold-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </motion.form>
      </div>
    </main>
  );
}
