"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import {
  DEFAULT_COUNTRY_CODE,
  isValidPhone,
  combinePhone,
  sanitizeCountryCodeInput,
  sanitizePhoneNumberInput,
} from "@/lib/phone";
import OtpInput from "@/components/ui/OtpInput";
import { useResendCooldown } from "@/lib/use-resend-cooldown";

const NOT_REGISTERED = "This number isn't registered. Ask your studio admin to add you.";

// Messages for the ?error= reasons the proxy and session guard redirect with.
const ERROR_PARAM_MESSAGES: Record<string, string> = {
  access_denied: "Your account has been deactivated. Contact the admin.",
  session_expired: "Your session has expired. Please sign in again.",
  signed_in_elsewhere: "You were logged out because your account was signed in on another device.",
};

// Unknown numbers get "otp_disabled" from Supabase or a "not registered" refusal from the SMS hook.
function otpErrorMessage(err: { message: string; code?: string }) {
  if (err.code === "otp_disabled" || /(isn't|not) registered/i.test(err.message)) return NOT_REGISTERED;
  return err.message;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() => ERROR_PARAM_MESSAGES[params.get("error") ?? ""] ?? "");
  const resendCooldown = useResendCooldown(isValidPhone(countryCode, phoneNumber) ? combinePhone(countryCode, phoneNumber) : "");

  const nextPath = params.get("next") ?? "";

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidPhone(countryCode, phoneNumber)) {
      setError("Enter a valid phone number.");
      return;
    }
    setLoading(true);
    setError("");

    const supabase = createSupabaseBrowserClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: combinePhone(countryCode, phoneNumber),
      // Only staff an admin already added can sign in -- never create accounts here.
      options: { shouldCreateUser: false },
    });
    setLoading(false);

    if (otpError) {
      setError(otpErrorMessage(otpError));
      return;
    }
    setOtp("");
    setStep("otp");
    resendCooldown.start();
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) return;
    setLoading(true);
    setError("");

    const supabase = createSupabaseBrowserClient();
    const phone = combinePhone(countryCode, phoneNumber);
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone, token: otp, type: "sms" });

    if (verifyError) {
      setError("Incorrect or expired code.");
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
      await supabase.auth.signOut({ scope: "local" });
      setError(staff ? "Your account has been deactivated. Contact the admin." : NOT_REGISTERED);
      setLoading(false);
      return;
    }

    // Make this login the only active one, then end every other device's session.
    const { error: claimError } = await supabase.rpc("claim_staff_session");
    if (claimError) {
      await supabase.auth.signOut({ scope: "local" });
      setError("Couldn't finish signing in. Please try again.");
      setLoading(false);
      return;
    }
    await supabase.auth.signOut({ scope: "others" });

    const dest = nextPath || (staff.role === "admin" ? "/studio/admin" : "/studio/designer");
    router.push(dest);
    router.refresh();
  }

  async function handleResend() {
    if (resendCooldown.secondsLeft > 0) return;
    setLoading(true);
    setError("");
    const supabase = createSupabaseBrowserClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: combinePhone(countryCode, phoneNumber),
      // Only staff an admin already added can sign in -- never create accounts here.
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (otpError) { setError(otpErrorMessage(otpError)); return; }
    resendCooldown.start();
  }

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
          <span className="text-[10px] font-mono tracking-[0.2em] text-muted uppercase">Staff Portal</span>
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-gold/30" />
        </div>
      </div>

      {step === "phone" ? (
        <form onSubmit={handleSendCode} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">Phone Number</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="tel"
                autoComplete="tel-country-code"
                value={countryCode}
                onChange={(e) => { setCountryCode(sanitizeCountryCodeInput(e.target.value)); setError(""); }}
                className="w-16 bg-surface border border-cleo-border rounded-xl px-3 py-3.5 text-ink text-base text-center focus:outline-none focus:border-gold transition-colors"
              />
              <input
                type="text"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={phoneNumber}
                onChange={(e) => { setPhoneNumber(sanitizePhoneNumberInput(e.target.value)); setError(""); }}
                className="flex-1 bg-surface border border-cleo-border rounded-xl px-4 py-3.5 text-ink text-base placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
              />
            </div>
          </div>

          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-error text-sm font-mono">
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
            {loading ? "Sending code…" : "Send Code →"}
          </motion.button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono tracking-[0.15em] uppercase text-muted">
              Code sent via WhatsApp to {countryCode}{phoneNumber}
            </label>
            <OtpInput value={otp} onChange={(v) => { setOtp(v); setError(""); }} autoFocus />
          </div>

          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-error text-sm font-mono">
              {error}
            </motion.p>
          )}

          <motion.button
            type="submit"
            disabled={loading || otp.length !== 6}
            whileHover={{ scale: loading ? 1 : 1.02 }}
            whileTap={{ scale: loading ? 1 : 0.97 }}
            className="mt-2 w-full bg-gold text-bg font-cinzel font-bold text-base tracking-[0.1em] uppercase py-4 rounded-xl border border-gold hover:bg-gold-light transition-colors shadow-[0_0_24px_rgba(201,168,76,0.2)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? "Verifying…" : "Verify →"}
          </motion.button>

          <div className="flex items-center justify-between text-xs font-mono">
            <button type="button" onClick={() => { setStep("phone"); setError(""); }} className="text-muted hover:text-gold transition-colors cursor-pointer">
              ← Change number
            </button>
            <button type="button" onClick={handleResend} disabled={loading || resendCooldown.secondsLeft > 0} className="text-muted hover:text-gold transition-colors cursor-pointer disabled:opacity-50">
              {resendCooldown.secondsLeft > 0 ? `Resend in ${resendCooldown.secondsLeft}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      <p className="text-center text-muted text-[10px] font-mono tracking-widest">
        STENSLEE © 2026
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
