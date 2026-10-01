"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { useFeature } from "@/lib/permissions/use-feature";
import { FeatureLocked } from "@/components/ui/FeatureLocked";
import ConnectWhatsAppButton from "@/features/whatsapp/ConnectWhatsAppButton";
import TemplatesPanel from "@/features/whatsapp/TemplatesPanel";
import SendMessagePanel from "@/features/whatsapp/SendMessagePanel";

interface ConnectionState {
  connected: boolean;
  displayPhoneNumber: string | null;
}

type Tab = "templates" | "send";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.72.45 3.4 1.3 4.87L2 22l5.36-1.4a9.9 9.9 0 004.68 1.19h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.02c-.24.68-1.4 1.3-1.93 1.38-.5.08-1.13.11-1.83-.11-.42-.13-.96-.31-1.65-.6-2.9-1.25-4.79-4.17-4.94-4.36-.14-.2-1.18-1.57-1.18-3 0-1.42.75-2.12 1.02-2.41.26-.29.57-.36.76-.36h.55c.18 0 .42-.03.65.5.24.55.82 1.9.89 2.04.07.14.11.31.02.5-.09.19-.14.31-.28.48-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.93 1.94 1.22 2.22 1.36.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.18-.28.36-.23.6-.14.24.09 1.55.73 1.81.86.27.14.45.2.51.32.07.11.07.65-.17 1.33z" />
    </svg>
  );
}

export default function WhatsAppPage() {
  const supabase = createSupabaseBrowserClient();
  const whatsappFeature = useFeature("whatsapp");

  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("templates");
  const [disconnecting, setDisconnecting] = useState(false);

  // Loads connection status; always ends in connection or loadError, never stuck loading.
  async function loadConnection() {
    setLoadError("");
    try {
      // Refreshes the session before any server-route fetches fire.
      await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadError("You're not signed in — please log in again.");
        return;
      }

      const { data: staff, error: staffError } = await supabase
        .from("staff").select("organization_id").eq("id", user.id).maybeSingle();
      if (staffError) { setLoadError(`Couldn't load your staff record: ${staffError.message}`); return; }
      if (!staff?.organization_id) {
        setLoadError("Your account isn't linked to an organization — please reload or contact an admin.");
        return;
      }

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("whatsapp_waba_id, whatsapp_display_phone_number")
        .eq("id", staff.organization_id)
        .maybeSingle();
      if (orgError) { setLoadError(`Couldn't load connection status: ${orgError.message}`); return; }

      setConnection({ connected: !!org?.whatsapp_waba_id, displayPhoneNumber: org?.whatsapp_display_phone_number ?? null });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Something went wrong loading this page.");
    }
  }

  useEffect(() => {
    async function run() { await loadConnection(); }
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    await fetch("/api/whatsapp/connect/callback", { method: "DELETE" });
    setDisconnecting(false);
    setConnection({ connected: false, displayPhoneNumber: null });
  }

  if (!whatsappFeature.loading && !whatsappFeature.enabled) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <FeatureLocked title="WhatsApp not available" message="Sending WhatsApp messages isn't included in your current plan." />
      </div>
    );
  }

  return (
    <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-3xl mx-auto w-full flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[#25D366]/10 border border-[#25D366]/30 flex items-center justify-center flex-shrink-0">
          <WhatsAppIcon className="w-5 h-5 text-[#25D366]" />
        </div>
        <div>
          <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-1">Messaging</p>
          <h1 className="font-cinzel text-2xl font-black text-ink">WhatsApp</h1>
        </div>
      </div>

      {loadError ? (
        <div className="bg-surface border border-error/30 rounded-2xl p-8 flex flex-col items-center gap-3 text-center">
          <p className="text-error text-sm">{loadError}</p>
          <button
            onClick={() => loadConnection()}
            className="text-gold text-xs font-mono uppercase tracking-widest underline cursor-pointer"
          >
            Try again
          </button>
        </div>
      ) : connection === null ? (
        <div className="skeleton h-40 rounded-2xl" />
      ) : !connection.connected ? (
        <div className="bg-surface border border-cleo-border rounded-2xl p-10 flex flex-col items-center gap-4 text-center">
          <WhatsAppIcon className="w-10 h-10 text-[#25D366]" />
          <div>
            <p className="text-ink font-semibold">Connect your WhatsApp Business number</p>
            <p className="text-muted text-sm mt-1 max-w-sm">
              Use the number you already use in your WhatsApp Business app — it keeps working there exactly as before.
            </p>
          </div>
          <ConnectWhatsAppButton onConnected={loadConnection} />
        </div>
      ) : (
        <>
          <div className="bg-surface border border-cleo-border rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
            <p className="text-ink text-sm flex-1">
              Connected{connection.displayPhoneNumber ? ` — ${connection.displayPhoneNumber}` : ""}
            </p>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-muted hover:text-error text-xs font-mono uppercase tracking-widest underline cursor-pointer disabled:opacity-50"
            >
              {disconnecting ? "…" : "Disconnect"}
            </button>
          </div>

          <div className="flex gap-2 border-b border-cleo-border">
            {(["templates", "send"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-xs font-cinzel font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px cursor-pointer ${
                  tab === t ? "text-gold border-gold" : "text-muted border-transparent hover:text-ink"
                }`}
              >
                {t === "templates" ? "Templates" : "Send Message"}
              </button>
            ))}
          </div>

          {tab === "templates" ? <TemplatesPanel /> : <SendMessagePanel />}
        </>
      )}
    </div>
  );
}
