"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        opts: {
          config_id: string;
          response_type: string;
          override_default_response_type: boolean;
          extras: { version: string; setup: Record<string, never>; featureType: string; sessionInfoVersion: string };
        }
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

interface EmbeddedSignupData {
  wabaId: string;
  phoneNumberId?: string;
  coexistence: boolean;
}

let sdkLoadStarted = false;

const LOG = "[whatsapp-connect]";

// Loads the Facebook JS SDK exactly once per page lifetime (a second
// `<script>` injection would re-run fbAsyncInit and double-init FB).
function loadFacebookSdk(onReady: () => void) {
  if (window.FB) { onReady(); return; }
  window.fbAsyncInit = () => {
    const initOptions = { appId: process.env.NEXT_PUBLIC_META_APP_ID!, xfbml: true, version: "v23.0" };
    console.log(LOG, "Facebook SDK loaded, FB.init with", initOptions);
    window.FB!.init(initOptions);
    onReady();
  };
  if (sdkLoadStarted) return;
  sdkLoadStarted = true;
  const script = document.createElement("script");
  script.src = "https://connect.facebook.net/en_US/sdk.js";
  script.async = true;
  script.defer = true;
  document.body.appendChild(script);
}

export default function ConnectWhatsAppButton({ onConnected }: { onConnected: () => void }) {
  const [sdkReady, setSdkReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  // The finish event and FB.login's code can arrive in either order; connect once both are in.
  const signupDataRef = useRef<EmbeddedSignupData | null>(null);
  const codeRef = useRef<string | null>(null);

  useEffect(() => {
    loadFacebookSdk(() => setSdkReady(true));

    function handleMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      // Every Facebook message (mostly SDK chatter) at verbose level; Embedded Signup events are logged below.
      console.debug(LOG, "message from", event.origin, event.data);
      let data: { type?: string; event?: string; version?: string; data?: Record<string, unknown> & { waba_id?: string; phone_number_id?: string } };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type !== "WA_EMBEDDED_SIGNUP") return;
      console.log(LOG, `Embedded Signup event "${data.event}" from popup:`, data);
      // Coexistence (WhatsApp Business app number) finishes with only the WABA id.
      if (data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" && data.data?.waba_id) {
        signupDataRef.current = { wabaId: data.data.waba_id, coexistence: true };
        console.log(LOG, "Coexistence finish: saved signup data", signupDataRef.current);
        checkBothReady();
      } else if (data.event === "FINISH" && data.data?.waba_id) {
        signupDataRef.current = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id, coexistence: false };
        console.log(LOG, "Normal finish: saved signup data", signupDataRef.current);
        checkBothReady();
      } else if (data.event === "CANCEL") {
        console.warn(LOG, "Popup cancelled or closed. Details from Meta:", data.data);
        setConnecting(false);
      } else if (data.event === "ERROR") {
        console.error(LOG, "Meta reported an error in the popup:", data.data);
      } else {
        console.warn(LOG, "Event not handled (missing waba_id or unknown event):", data);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  async function checkBothReady() {
    if (!signupDataRef.current || !codeRef.current) {
      console.log(LOG, "Waiting for the other half:", { haveSignupEvent: !!signupDataRef.current, haveCode: !!codeRef.current });
      return;
    }
    setError("");
    const payload = {
      code: codeRef.current,
      wabaId: signupDataRef.current.wabaId,
      phoneNumberId: signupDataRef.current.phoneNumberId,
      coexistence: signupDataRef.current.coexistence,
    };
    console.log(LOG, "Both halves ready, POST /api/whatsapp/connect/callback with", payload);
    try {
      const res = await fetch("/api/whatsapp/connect/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      console.log(LOG, `Callback responded ${res.status}:`, body);
      if (!res.ok) throw new Error(body.error || "Failed to connect");
      console.log(LOG, "WhatsApp connected successfully");
      onConnected();
    } catch (err) {
      console.error(LOG, "Connect failed:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setConnecting(false);
      signupDataRef.current = null;
      codeRef.current = null;
    }
  }

  function handleConnect() {
    if (!window.FB) {
      console.error(LOG, "Connect clicked but the Facebook SDK is not loaded");
      return;
    }
    setError("");
    setConnecting(true);
    signupDataRef.current = null;
    codeRef.current = null;
    const loginOptions = {
      config_id: process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID!,
      response_type: "code",
      override_default_response_type: true,
      extras: { version: "v3", setup: {} as Record<string, never>, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
    };
    console.log(LOG, "Opening Embedded Signup popup with FB.login options", loginOptions);
    window.FB.login((response) => {
      console.log(LOG, "Popup closed, FB.login response:", response);
      if (response.authResponse?.code) {
        codeRef.current = response.authResponse.code;
        console.log(LOG, "Got authorization code from popup:", response.authResponse.code);
        checkBothReady();
      } else {
        console.warn(LOG, "Popup closed without an authorization code (cancelled, or login failed)");
        setConnecting(false);
      }
    }, loginOptions);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Button onClick={handleConnect} loading={connecting} disabled={!sdkReady} size="lg">
        Connect to WhatsApp
      </Button>
      {error && <p className="text-error text-xs text-center max-w-xs">{error}</p>}
    </div>
  );
}
