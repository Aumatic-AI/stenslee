"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Image from "next/image";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { getStorageUrl } from "@/lib/image-src";

interface AdminProfile {
  id: string;
  name: string;
  avatar_key: string | null;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [staff, setStaff] = useState<AdminProfile | null>(null);

  // Profile (name + avatar) — collapsed by default, opened via "Edit Profile"
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/studio/login"); return; }

      const { data: staffRow } = await supabase
        .from("staff").select("id, name, role, avatar_key").eq("id", user.id).maybeSingle();
      if (staffRow?.role !== "admin") { router.push("/studio/designer"); return; }

      setStaff(staffRow);
      setName(staffRow.name);
      setAvatarPreview(getStorageUrl(staffRow.avatar_key));
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openProfileEdit() {
    setProfileError("");
    setProfileSaved(false);
    setProfileOpen(true);
  }

  function closeProfileEdit() {
    // Reset any unsaved edits back to the current saved values.
    if (staff) {
      setName(staff.name);
      setAvatarPreview(getStorageUrl(staff.avatar_key));
    }
    setAvatarBase64(null);
    setProfileError("");
    setProfileOpen(false);
  }

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);
      setAvatarBase64(dataUrl);
      setProfileSaved(false);
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !name.trim()) return;
    setProfileSaving(true);
    setProfileError("");
    setProfileSaved(false);

    const trimmed = name.trim();

    if (avatarBase64) {
      // Photo upload needs the storage service role — only path that needs
      // the API route.
      const res = await fetch("/api/studio/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, avatarBase64 }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setProfileError(json.error ?? "Couldn't save changes — please try again.");
        setProfileSaving(false);
        return;
      }
      const { staff: updated } = await res.json() as { staff: AdminProfile };
      setStaff(updated);
      setAvatarPreview(getStorageUrl(updated.avatar_key));
    } else {
      // A plain name change — RLS already grants admins direct write
      // access to their own staff row, so this skips the API route.
      const { data: updated, error } = await supabase
        .from("staff")
        .update({ name: trimmed })
        .eq("id", staff.id)
        .select("id, name, avatar_key")
        .single();

      if (error) {
        setProfileError("Couldn't save changes — please try again.");
        setProfileSaving(false);
        return;
      }
      setStaff(updated);
    }

    setAvatarBase64(null);
    setProfileSaving(false);
    setProfileSaved(true);
    setProfileOpen(false);
  }

  return (
    <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-md mx-auto w-full flex flex-col gap-8">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-1">Settings</p>
        <h1 className="font-cinzel text-2xl font-black text-ink">My Profile</h1>
      </motion.div>

      {/* Profile: name + avatar */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="bg-surface border border-cleo-border rounded-2xl p-5 sm:p-6 flex flex-col gap-5"
      >
        {!profileOpen ? (
          <div className="flex items-center gap-4">
            <div className="relative w-14 h-14 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center overflow-hidden flex-shrink-0">
              {staff?.avatar_key ? (
                <Image src={getStorageUrl(staff.avatar_key)!} alt={staff.name} fill unoptimized className="object-cover" />
              ) : (
                <span className="font-cinzel text-xl font-black text-gold">{name.charAt(0).toUpperCase() || "?"}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-ink font-semibold truncate">{name || "—"}</p>
            </div>
            <button
              onClick={openProfileEdit}
              className="px-3 py-1.5 text-[10px] font-cinzel font-bold tracking-[0.15em] uppercase rounded-lg border border-gold/40 text-gold hover:bg-gold/10 transition-colors cursor-pointer flex-shrink-0"
            >
              Edit Profile
            </button>
          </div>
        ) : (
          <form onSubmit={handleSaveProfile} className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative w-24 h-24 rounded-full bg-gold/10 border-2 border-gold/30 hover:border-gold transition-colors flex items-center justify-center overflow-hidden cursor-pointer group"
              >
                {avatarPreview ? (
                  <Image src={avatarPreview} alt="Profile photo" fill unoptimized className="object-cover" />
                ) : (
                  <span className="font-cinzel text-3xl font-black text-gold">{name.charAt(0).toUpperCase() || "?"}</span>
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

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Display name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setProfileSaved(false); }}
                placeholder="Your name"
                autoFocus
                className="bg-bg border border-cleo-border rounded-xl px-4 py-3 text-ink text-base placeholder:text-muted/40 focus:outline-none focus:border-gold transition-colors"
              />
            </div>

            {profileError && <p className="text-error text-xs">{profileError}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeProfileEdit}
                disabled={profileSaving}
                className="px-4 py-3 text-xs font-cinzel font-bold uppercase tracking-widest rounded-xl text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={profileSaving || !name.trim()}
                className="flex-1 py-3 bg-gold text-bg font-cinzel font-bold text-sm tracking-[0.08em] uppercase rounded-xl border border-gold hover:bg-gold-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {profileSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        )}
        {profileSaved && !profileOpen && <p className="text-success text-xs">Saved.</p>}
      </motion.div>
    </div>
  );
}
