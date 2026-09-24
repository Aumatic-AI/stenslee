"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { usePermissionStore } from "@/store/permission-store";

// Headless -- renders nothing, just triggers the permission fetch. Mounted
// once in the root layout, so it fires once per hard page load / reopened
// tab (the confirmed refresh policy -- no localStorage cache, no polling),
// plus again if a *different* staff member signs in without a full reload,
// or clears on sign-out.
//
// Narrowed to SIGNED_IN/SIGNED_OUT, AND checks the user id actually
// changed -- Supabase's client re-fires SIGNED_IN on its own for the
// *same* already-logged-in user whenever the browser tab regains focus
// (its internal session-recovery check on visibility regain notifies
// subscribers again even when nothing changed). Reacting to every
// SIGNED_IN re-ran this fetch (and every other subscriber's own re-fetch)
// on every tab-switch, for no actual permission change.
export default function PermissionBootstrap() {
  const fetchPermissions = usePermissionStore((s) => s.fetchPermissions);
  const clear = usePermissionStore((s) => s.clear);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let lastUserId: string | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      lastUserId = user?.id ?? null;
      fetchPermissions();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        lastUserId = null;
        clear();
        return;
      }
      if (event === "SIGNED_IN") {
        const userId = session?.user?.id ?? null;
        if (userId && userId !== lastUserId) {
          lastUserId = userId;
          fetchPermissions();
        }
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
