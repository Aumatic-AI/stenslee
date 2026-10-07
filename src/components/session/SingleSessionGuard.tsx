"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { getSessionId, isReplacedSession } from "@/lib/session-id";

// Logs this device out as soon as the same account signs in on another device.
export default function SingleSessionGuard() {
  // Off on the login page, where a fresh login hasn't claimed its session yet.
  const active = usePathname() !== "/studio/login";

  useEffect(() => {
    if (!active) return;
    const supabase = createSupabaseBrowserClient();
    let channel: RealtimeChannel | null = null;
    let userId: string | null = null;
    let thisSessionId: string | null = null;
    let kickedOut = false;
    let cancelled = false;

    const kickOut = async () => {
      if (kickedOut) return;
      kickedOut = true;
      await supabase.auth.signOut({ scope: "local" });
      window.location.replace("/studio/login?error=signed_in_elsewhere");
    };

    const compare = (currentSessionId: string | null | undefined) => {
      if (isReplacedSession(currentSessionId, thisSessionId)) kickOut();
    };

    const recheck = async () => {
      if (!userId) return;
      const { data } = await supabase.from("staff").select("current_session_id").eq("id", userId).maybeSingle();
      compare(data?.current_session_id);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") recheck();
    };

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      userId = session.user.id;
      thisSessionId = getSessionId(session.access_token);
      await recheck();
      if (cancelled) return;
      channel = supabase
        .channel(`staff-session-${userId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "staff", filter: `id=eq.${userId}` },
          (payload) => compare((payload.new as { current_session_id?: string | null }).current_session_id)
        )
        .subscribe();
    })();

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [active]);

  return null;
}
