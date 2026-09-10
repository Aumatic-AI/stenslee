"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { getClientRole } from "@/lib/auth-utils";

export default function AdminSettingsPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getClientRole().then((role) => {
      if (role !== "admin") router.replace("/studio/designer");
    });
  }, [router]);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setError("Passwords do not match."); return; }

    setLoading(true);
    const supabase = createSupabaseBrowserClient();

    // Re-authenticate with current password first to validate it
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) { setError("Session expired. Please log in again."); setLoading(false); return; }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    });
    if (signInErr) { setError("Current password is incorrect."); setLoading(false); return; }

    const { error: updateErr } = await supabase.auth.updateUser({ password: next });
    setLoading(false);

    if (updateErr) { setError(updateErr.message); return; }

    setSuccess(true);
    setCurrent(""); setNext(""); setConfirm("");
    setTimeout(() => router.push("/studio/admin"), 2000);
  }

  return (
    <div className="min-h-[100dvh] bg-bg flex flex-col">
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center gap-3">
        <Link href="/studio/admin" className="text-muted hover:text-gold transition-colors text-xs font-mono tracking-wider flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Admin
        </Link>
        <span className="text-cleo-border">/</span>
        <span className="text-muted text-xs font-mono">Settings</span>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md flex flex-col gap-6"
        >
          <div>
            <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-1">Security</p>
            <h1 className="font-cinzel text-2xl font-black text-ink">Change Password</h1>
          </div>

          {success ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-success/10 border border-success/30 rounded-xl p-5 text-center"
            >
              <p className="text-success font-cinzel font-bold tracking-wide">Password updated successfully.</p>
              <p className="text-muted text-xs font-mono mt-1">Redirecting to admin…</p>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {[
                { label: "Current Password", value: current, onChange: setCurrent },
                { label: "New Password", value: next, onChange: setNext },
                { label: "Confirm New Password", value: confirm, onChange: setConfirm },
              ].map(({ label, value, onChange }) => (
                <div key={label} className="flex flex-col gap-1.5">
                  <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">{label}</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={value}
                    onChange={(e) => { onChange(e.target.value); setError(""); }}
                    className="bg-surface border border-cleo-border rounded-xl px-4 py-3.5 text-ink text-base placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
                  />
                </div>
              ))}

              {error && <p className="text-error text-sm font-mono">{error}</p>}

              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: loading ? 1 : 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="mt-2 w-full bg-gold text-bg font-cinzel font-bold text-base tracking-[0.1em] uppercase py-4 rounded-xl border border-gold hover:bg-gold-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? "Updating…" : "Update Password →"}
              </motion.button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
