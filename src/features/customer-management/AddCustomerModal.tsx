"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { usePermissionStore } from "@/store/permission-store";
import { DEFAULT_COUNTRY_CODE, combinePhone, isValidPhone, sanitizeCountryCodeInput, sanitizePhoneNumberInput } from "@/lib/phone";
import OtpInput from "@/components/ui/OtpInput";
import { useResendCooldown } from "@/lib/use-resend-cooldown";

interface NewCustomer {
  id: string;
  name: string;
  phone: string;
  created_at: string;
}

interface Props {
  onClose: () => void;
  onCreated: (customer: NewCustomer) => void;
}

// Matches the designer dashboard's inline "no matches — create one" form
// (src/app/(staff)/studio/designer/page.tsx) — same two inputs, same phone
// validation, same duplicate-phone pre-check, same OTP-verify step.
export default function AddCustomerModal({ onClose, onCreated }: Props) {
  const supabase = createSupabaseBrowserClient();
  const [step, setStep] = useState<"details" | "verify">("details");
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const resendCooldown = useResendCooldown(isValidPhone(countryCode, phoneNumber) ? combinePhone(countryCode, phoneNumber) : "");

  const canSubmit = name.trim().length > 0 && isValidPhone(countryCode, phoneNumber);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");

    // Same duplicate-phone guard as the designer dashboard's create flow.
    const phone = combinePhone(countryCode, phoneNumber);
    const { data: existing } = await supabase
      .from("customers")
      .select("id, name, phone, created_at")
      .eq("phone", phone)
      .maybeSingle();

    if (existing) {
      setSaving(false);
      setError(`A customer with this phone number already exists: ${existing.name}.`);
      return;
    }

    const res = await fetch("/api/customers/send-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneCountryCode: countryCode, phoneNumber }),
    });
    setSaving(false);

    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({ error: "Couldn't send the code" }));
      setError(msg ?? "Couldn't send the code");
      return;
    }

    setOtp("");
    setStep("verify");
    resendCooldown.start();
  }

  async function handleVerifyAndCreate(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) return;
    setSaving(true);
    setError("");

    const verifyRes = await fetch("/api/customers/verify-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneCountryCode: countryCode, phoneNumber, code: otp }),
    });
    if (!verifyRes.ok) {
      const { error: msg } = await verifyRes.json().catch(() => ({ error: "Incorrect or expired code" }));
      setSaving(false);
      setError(msg ?? "Incorrect or expired code");
      return;
    }

    const organizationId = usePermissionStore.getState().staff?.organizationId;
    if (!organizationId) {
      setSaving(false);
      setError("Could not determine your organization — try reloading the page.");
      return;
    }

    const { data: customer, error: insertError } = await supabase
      .from("customers")
      .insert({ name: name.trim(), phone_country_code: countryCode, phone_number: phoneNumber, organization_id: organizationId })
      .select("id, name, phone, created_at")
      .single();

    setSaving(false);
    if (insertError || !customer) {
      setError(insertError?.message ?? "Couldn't create the customer.");
      return;
    }

    onCreated(customer);
  }

  async function handleResend() {
    if (resendCooldown.secondsLeft > 0) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/customers/send-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneCountryCode: countryCode, phoneNumber }),
    });
    setSaving(false);
    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({ error: "Couldn't send the code" }));
      setError(msg ?? "Couldn't send the code");
      return;
    }
    resendCooldown.start();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-cleo-border rounded-2xl w-full max-w-sm flex flex-col overflow-hidden"
      >
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-cleo-border flex items-center justify-between gap-3">
          <h2 className="font-cinzel text-lg font-bold text-ink">Add Customer</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-bg border border-cleo-border text-muted hover:text-error hover:border-error/40 transition-colors flex items-center justify-center text-lg cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {step === "details" ? (
        <form onSubmit={handleSendCode} className="px-5 sm:px-6 py-5 flex flex-col gap-3">
          <input
            type="text"
            autoFocus
            placeholder="Customer full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-bg border border-cleo-border rounded-xl px-4 py-3 text-ink text-base placeholder:text-muted/40 focus:outline-none focus:border-gold transition-colors"
          />
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="tel"
              placeholder="+91"
              value={countryCode}
              onChange={(e) => setCountryCode(sanitizeCountryCodeInput(e.target.value))}
              className="w-20 flex-shrink-0 bg-bg border border-cleo-border rounded-xl px-3 py-3 text-ink font-mono text-base text-center placeholder:text-muted/40 focus:outline-none focus:border-gold transition-colors"
            />
            <input
              type="tel"
              inputMode="numeric"
              placeholder="98765 43210"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(sanitizePhoneNumberInput(e.target.value))}
              className="flex-1 min-w-0 bg-bg border border-cleo-border rounded-xl px-4 py-3 text-ink font-mono text-base placeholder:text-muted/40 focus:outline-none focus:border-gold transition-colors"
            />
          </div>

          {error && <p className="text-error text-xs">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit || saving}
            className="mt-1 py-3 bg-gold text-bg font-cinzel font-bold text-sm tracking-[0.08em] uppercase rounded-xl border border-gold hover:bg-gold-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? "Sending…" : "Send Code →"}
          </button>
        </form>
        ) : (
        <form onSubmit={handleVerifyAndCreate} className="px-5 sm:px-6 py-5 flex flex-col gap-3">
          <p className="text-muted text-xs text-center">
            Code sent via WhatsApp to {countryCode}{phoneNumber}
          </p>
          <OtpInput value={otp} onChange={(v) => { setOtp(v); setError(""); }} autoFocus />

          {error && <p className="text-error text-xs text-center">{error}</p>}

          <button
            type="submit"
            disabled={otp.length !== 6 || saving}
            className="mt-1 py-3 bg-gold text-bg font-cinzel font-bold text-sm tracking-[0.08em] uppercase rounded-xl border border-gold hover:bg-gold-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? "Verifying…" : "✦ Verify & Add Customer"}
          </button>

          <div className="flex items-center justify-between text-xs font-mono">
            <button type="button" onClick={() => { setStep("details"); setError(""); }} className="text-muted hover:text-gold transition-colors cursor-pointer">
              ← Change number
            </button>
            <button type="button" onClick={handleResend} disabled={saving || resendCooldown.secondsLeft > 0} className="text-muted hover:text-gold transition-colors cursor-pointer disabled:opacity-50">
              {resendCooldown.secondsLeft > 0 ? `Resend in ${resendCooldown.secondsLeft}s` : "Resend code"}
            </button>
          </div>
        </form>
        )}
      </motion.div>
    </motion.div>
  );
}
