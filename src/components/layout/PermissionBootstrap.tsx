"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { usePermissionStore } from "@/store/permission-store";

// Headless -- renders nothing, just triggers the permission fetch. Mounted
// once in the root layout, so it fires once per hard page load / reopened
// tab (the confirmed refresh policy -- no localStorage cache, no polling),
// plus again if a *different* staff member signs in without a full reload
// (SIGNED_IN), or clears on sign-out.
//
// Deliberately narrowed to just SIGNED_IN/SIGNED_OUT -- Supabase's client
// also fires TOKEN_REFRESHED/INITIAL_SESSION on its own, including every
// time the browser tab regains focus (it pauses its refresh timer while
// hidden and re-validates on visibility regain). Reacting to those too
// re-ran this fetch (and every other subscriber's own re-fetch) on every
// tab-switch, for no actual permission change.
export default function PermissionBootstrap() {
  const fetchPermissions = usePermissionStore((s) => s.fetchPermissions);
  const clear = usePermissionStore((s) => s.clear);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    fetchPermissions();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clear();
      } else if (event === "SIGNED_IN") {
        fetchPermissions();
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
