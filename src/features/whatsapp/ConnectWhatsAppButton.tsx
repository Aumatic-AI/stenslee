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

// Loads the Facebook JS SDK exactly once per page lifetime (a second
// `<script>` injection would re-run fbAsyncInit and double-init FB).
function loadFacebookSdk(onReady: () => void) {
  if (window.FB) { onReady(); return; }
  window.fbAsyncInit = () => {
    window.FB!.init({
      appId: process.env.NEXT_PUBLIC_META_APP_ID!,
      xfbml: true,
      version: "v23.0",
    });
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
      let data: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type !== "WA_EMBEDDED_SIGNUP") return;
      // Coexistence (WhatsApp Business app number) finishes with only the WABA id.
      if (data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" && data.data?.waba_id) {
        signupDataRef.current = { wabaId: data.data.waba_id, coexistence: true };
        checkBothReady();
      }
      if (data.event === "FINISH" && data.data?.waba_id) {
        signupDataRef.current = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id, coexistence: false };
        checkBothReady();
      }
      if (data.event === "CANCEL") {
        setConnecting(false);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  async function checkBothReady() {
    if (!signupDataRef.current || !codeRef.current) return; // wait for the other half
    setError("");
    try {
      const res = await fetch("/api/whatsapp/connect/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: codeRef.current,
          wabaId: signupDataRef.current.wabaId,
          phoneNumberId: signupDataRef.current.phoneNumberId,
          coexistence: signupDataRef.current.coexistence,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to connect");
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setConnecting(false);
      signupDataRef.current = null;
      codeRef.current = null;
    }
  }

  function handleConnect() {
    if (!window.FB) return;
    setError("");
    setConnecting(true);
    signupDataRef.current = null;
    codeRef.current = null;
    window.FB.login(
      (response) => {
        if (response.authResponse?.code) {
          codeRef.current = response.authResponse.code;
          checkBothReady();
        } else {
          setConnecting(false);
        }
      },
      {
        config_id: process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID!,
        response_type: "code",
        override_default_response_type: true,
        extras: { version: "v3", setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      }
    );
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
