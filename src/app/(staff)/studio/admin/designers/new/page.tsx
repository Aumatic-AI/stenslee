"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { getClientRole } from "@/lib/auth-utils";

export default function NewDesignerPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    getClientRole().then((role) => {
      if (role !== "admin") router.replace("/studio/designer");
    });
  }, [router]);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required.";
    if (!form.email.trim()) e.email = "Email is required.";
    if (form.password.length < 8) e.password = "Password must be at least 8 characters.";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    setServerError("");

    const res = await fetch("/api/studio/designers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setServerError(data.error ?? "Failed to create designer.");
      return;
    }

    router.push("/studio/admin");
  }

  function field(key: keyof typeof form, label: string, type = "text", placeholder = "") {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">{label}</label>
        <input
          type={type}
          placeholder={placeholder}
          value={form[key]}
          onChange={(e) => { setForm((p) => ({ ...p, [key]: e.target.value })); setErrors((p) => ({ ...p, [key]: "" })); }}
          className={`bg-surface border rounded-xl px-4 py-3.5 text-ink text-base placeholder:text-muted/50 focus:outline-none transition-colors ${
            errors[key] ? "border-error" : "border-cleo-border focus:border-gold"
          }`}
        />
        {errors[key] && <p className="text-error text-xs font-mono">{errors[key]}</p>}
      </div>
    );
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
        <span className="text-muted text-xs font-mono">New Designer</span>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md flex flex-col gap-6"
        >
          <div>
            <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-1">Add Designer</p>
            <h1 className="font-cinzel text-2xl font-black text-ink">New Designer Account</h1>
            <p className="text-muted text-sm mt-1">The designer will use this email and password to log in.</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {field("name", "Full Name", "text", "e.g. Jordan Smith")}
            {field("email", "Email Address", "email", "jordan@studio.com")}
            {field("password", "Temporary Password", "password", "Min 8 characters")}

            {serverError && (
              <p className="text-error text-sm font-mono">{serverError}</p>
            )}

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="mt-2 w-full bg-gold text-bg font-cinzel font-bold text-base tracking-[0.1em] uppercase py-4 rounded-xl border border-gold hover:bg-gold-light transition-colors shadow-[0_0_24px_rgba(201,168,76,0.2)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? "Creating…" : "Create Designer →"}
            </motion.button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
