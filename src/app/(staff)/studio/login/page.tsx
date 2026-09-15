"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const errorParam = params.get("error");
  const nextPath = params.get("next") ?? "";

  useEffect(() => {
    if (errorParam === "access_denied") setError("Your account has been deactivated. Contact the admin.");
    if (errorParam === "session_expired") setError("Your session has expired. Please sign in again.");
  }, [errorParam]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { data: staff } = await supabase
      .from("staff")
      .select("role, is_active, deleted_at")
      .eq("id", user!.id)
      .maybeSingle();

    if (!staff || !staff.is_active || staff.deleted_at) {
      await supabase.auth.signOut();
      setError("Your account has been deactivated. Contact the admin.");
      setLoading(false);
      return;
    }

    await supabase
      .from("staff")
      .update({ last_login: new Date().toISOString() })
      .eq("id", user!.id);

    const dest = nextPath || (staff.role === "admin" ? "/studio/admin" : "/studio/designer");
    router.push(dest);
    router.refresh();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-sm z-10 flex flex-col gap-8"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 relative">
          <Image src="/cleopatra-logo.svg" alt="Cleopatra Ink Studio" fill className="object-contain" />
        </div>
        <div className="text-center">
          <h1 className="font-cinzel text-2xl font-black tracking-[0.12em] text-ink uppercase">Cleopatra</h1>
          <p className="font-cinzel text-xs font-bold tracking-[0.22em] text-gold uppercase">Ink Studio</p>
        </div>
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent to-gold/30" />
          <span className="text-[10px] font-mono tracking-[0.2em] text-muted uppercase">Staff Portal</span>
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-gold/30" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">Email</label>
          <input
            type="email"
            autoComplete="email"
            placeholder="you@studio.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            className="bg-surface border border-cleo-border rounded-xl px-4 py-3.5 text-ink text-base placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              className="w-full bg-surface border border-cleo-border rounded-xl px-4 py-3.5 pr-11 text-ink text-base placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-gold transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
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

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-error text-sm font-mono"
          >
            {error}
          </motion.p>
        )}

        <motion.button
          type="submit"
          disabled={loading}
          whileHover={{ scale: loading ? 1 : 1.02 }}
          whileTap={{ scale: loading ? 1 : 0.97 }}
          className="mt-2 w-full bg-gold text-bg font-cinzel font-bold text-base tracking-[0.1em] uppercase py-4 rounded-xl border border-gold hover:bg-gold-light transition-colors shadow-[0_0_24px_rgba(201,168,76,0.2)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? "Signing in…" : "Sign In →"}
        </motion.button>
      </form>

      <p className="text-center text-muted text-[10px] font-mono tracking-widest">
        CLEOPATRA INK STUDIO © 2026
      </p>
    </motion.div>
  );
}

export default function StudioLoginPage() {
  return (
    <main className="min-h-[100dvh] bg-bg flex flex-col items-center justify-center px-5 py-10 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.025] hidden sm:block"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,#c9a84c 0px,#c9a84c 1px,transparent 1px,transparent 60px),repeating-linear-gradient(90deg,#c9a84c 0px,#c9a84c 1px,transparent 1px,transparent 60px)",
        }}
      />
      {[
        "top-4 left-4 border-t-2 border-l-2 rounded-tl",
        "top-4 right-4 border-t-2 border-r-2 rounded-tr",
        "bottom-4 left-4 border-b-2 border-l-2 rounded-bl",
        "bottom-4 right-4 border-b-2 border-r-2 rounded-br",
      ].map((cls) => (
        <div key={cls} className={`absolute w-8 h-8 border-gold/25 ${cls}`} />
      ))}

      <Suspense fallback={
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <LoginForm />
      </Suspense>
    </main>
  );
}
