"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { usePermissionStore } from "@/store/permission-store";

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
// formatting/validation, same duplicate-phone pre-check.
function formatPhone(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export default function AddCustomerModal({ onClose, onCreated }: Props) {
  const supabase = createSupabaseBrowserClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = name.trim().length > 0 && phone.replace(/\D/g, "").length === 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");

    // Same duplicate-phone guard as the designer dashboard's create flow.
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

    const organizationId = usePermissionStore.getState().staff?.organizationId;
    if (!organizationId) {
      setSaving(false);
      setError("Could not determine your organization — try reloading the page.");
      return;
    }

    const { data: customer, error: insertError } = await supabase
      .from("customers")
      .insert({ name: name.trim(), phone, organization_id: organizationId })
      .select("id, name, phone, created_at")
      .single();

    setSaving(false);
    if (insertError || !customer) {
      setError(insertError?.message ?? "Couldn't create the customer.");
      return;
    }

    onCreated(customer);
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

        <form onSubmit={handleSubmit} className="px-5 sm:px-6 py-5 flex flex-col gap-3">
          <input
            type="text"
            autoFocus
            placeholder="Customer full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-bg border border-cleo-border rounded-xl px-4 py-3 text-ink text-base placeholder:text-muted/40 focus:outline-none focus:border-gold transition-colors"
          />
          <input
            type="tel"
            inputMode="numeric"
            placeholder="(555) 000-0000"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            className="bg-bg border border-cleo-border rounded-xl px-4 py-3 text-ink font-mono text-base placeholder:text-muted/40 focus:outline-none focus:border-gold transition-colors"
          />

          {error && <p className="text-error text-xs">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit || saving}
            className="mt-1 py-3 bg-gold text-bg font-cinzel font-bold text-sm tracking-[0.08em] uppercase rounded-xl border border-gold hover:bg-gold-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? "Creating…" : "✦ Add Customer"}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}
