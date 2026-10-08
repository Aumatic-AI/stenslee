"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { DEFAULT_COUNTRY_CODE, isValidPhone, combinePhone } from "@/lib/phone";
import OtpInput from "@/components/ui/OtpInput";
import PhoneInput from "@/components/ui/PhoneInput";
import { useResendCooldown } from "@/lib/use-resend-cooldown";

const INPUT_CLASS =
  "bg-surface border border-cleo-border rounded-xl px-4 py-3.5 text-ink text-base placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors";
const SUBMIT_CLASS =
  "mt-2 w-full bg-gold text-bg font-cinzel font-bold text-base tracking-[0.1em] uppercase py-4 rounded-xl border border-gold hover:bg-gold-light transition-colors shadow-[0_0_24px_rgba(201,168,76,0.2)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer";
const LABEL_CLASS = "text-xs font-mono tracking-[0.15em] uppercase text-muted";

function SignupForm() {
  const router = useRouter();
  const [step, setStep] = useState<"details" | "otp">("details");
  const [studioName, setStudioName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const resendCooldown = useResendCooldown(isValidPhone(countryCode, phoneNumber) ? combinePhone(countryCode, phoneNumber) : "");

  function clearError() {
    setError("");
    setAlreadyRegistered(false);
  }

  // Saves the details (so the hook will send this number a code), then asks Supabase for the code.
  async function requestCode(): Promise<boolean> {
    const res = await fetch("/api/signup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studioName: studioName.trim(), name: name.trim(), email: email.trim(), phoneCountryCode: countryCode, phoneNumber }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Couldn't start signup. Please try again.");
      setAlreadyRegistered(body.code === "already_registered");
      return false;
    }

    const supabase = createSupabaseBrowserClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: combinePhone(countryCode, phoneNumber),
      options: { shouldCreateUser: true },
    });
    if (otpError) {
      setError(otpError.message);
      return false;
    }
    resendCooldown.start();
    return true;
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!studioName.trim() || !name.trim()) {
      setError("Enter your studio name and your name.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (!isValidPhone(countryCode, phoneNumber)) {
      setError("Enter a valid mobile number.");
      return;
    }
    setLoading(true);
    clearError();
    const sent = await requestCode();
    setLoading(false);
    if (!sent) return;
    setOtp("");
    setStep("otp");
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) return;
    setLoading(true);
    clearError();

    const supabase = createSupabaseBrowserClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: combinePhone(countryCode, phoneNumber),
      token: otp,
      type: "sms",
    });
    if (verifyError) {
      setError("Incorrect or expired code.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/signup/complete", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      await supabase.auth.signOut({ scope: "local" });
      setError(body.error ?? "Couldn't create your studio. Please try again.");
      setAlreadyRegistered(body.code === "already_registered");
      setLoading(false);
      return;
    }

    // Same as login: this becomes the account's one active session.
    await supabase.rpc("claim_staff_session");
    router.push("/studio/admin");
    router.refresh();
  }

  async function handleResend() {
    if (resendCooldown.secondsLeft > 0) return;
    setLoading(true);
    clearError();
    await requestCode();
    setLoading(false);
  }

  const errorBlock = error && (
    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-error text-sm font-mono">
      {alreadyRegistered ? (
        <>
          {error}{" "}
          <Link href="/studio/login" className="text-gold underline underline-offset-2">
            Log in instead
          </Link>
        </>
      ) : (
        error
      )}
    </motion.p>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-sm z-10 flex flex-col gap-8"
    >
      <div className="flex flex-col items-center gap-3">
        <h1>
          <Image src="/stenslee-logo.png" alt="Stenslee" width={886} height={167} priority className="h-10 w-auto" />
        </h1>
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent to-gold/30" />
          <span className="text-[10px] font-mono tracking-[0.2em] text-muted uppercase">Create your studio</span>
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-gold/30" />
        </div>
      </div>

      {step === "details" ? (
        <form onSubmit={handleSendCode} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="studio-name" className={LABEL_CLASS}>Studio Name</label>
            <input
              id="studio-name"
              type="text"
              autoComplete="organization"
              placeholder="Ink & Iron Tattoo"
              maxLength={80}
              value={studioName}
              onChange={(e) => { setStudioName(e.target.value); clearError(); }}
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="your-name" className={LABEL_CLASS}>Your Name</label>
            <input
              id="your-name"
              type="text"
              autoComplete="name"
              placeholder="Jane Doe"
              maxLength={80}
              value={name}
              onChange={(e) => { setName(e.target.value); clearError(); }}
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className={LABEL_CLASS}>Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@yourstudio.com"
              maxLength={254}
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError(); }}
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="mobile-number" className={LABEL_CLASS}>Mobile Number</label>
            <PhoneInput
              id="mobile-number"
              countryCode={countryCode}
              phoneNumber={phoneNumber}
              onCountryCodeChange={(code) => { setCountryCode(code); clearError(); }}
              onPhoneNumberChange={(number) => { setPhoneNumber(number); clearError(); }}
            />
          </div>

          {errorBlock}

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: loading ? 1 : 1.02 }}
            whileTap={{ scale: loading ? 1 : 0.97 }}
            className={SUBMIT_CLASS}
          >
            {loading ? "Sending code…" : "Send Code →"}
          </motion.button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLASS}>Code sent via WhatsApp to {countryCode}{phoneNumber}</label>
            <OtpInput value={otp} onChange={(v) => { setOtp(v); clearError(); }} autoFocus />
          </div>

          {errorBlock}

          <motion.button
            type="submit"
            disabled={loading || otp.length !== 6}
            whileHover={{ scale: loading ? 1 : 1.02 }}
            whileTap={{ scale: loading ? 1 : 0.97 }}
            className={SUBMIT_CLASS}
          >
            {loading ? "Creating studio…" : "Verify & Create →"}
          </motion.button>

          <div className="flex items-center justify-between text-xs font-mono">
            <button type="button" onClick={() => { setStep("details"); clearError(); }} className="text-muted hover:text-gold transition-colors cursor-pointer">
              ← Edit details
            </button>
            <button type="button" onClick={handleResend} disabled={loading || resendCooldown.secondsLeft > 0} className="text-muted hover:text-gold transition-colors cursor-pointer disabled:opacity-50">
              {resendCooldown.secondsLeft > 0 ? `Resend in ${resendCooldown.secondsLeft}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      <p className="text-center text-muted text-xs font-mono">
        Already have an account?{" "}
        <Link href="/studio/login" className="text-gold hover:text-gold-light transition-colors">
          Log in
        </Link>
      </p>

      <p className="text-center text-muted text-[10px] font-mono tracking-widest">
        STENSLEE © 2026
      </p>
    </motion.div>
  );
}

export default function StudioSignupPage() {
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

      <SignupForm />
    </main>
  );
}
