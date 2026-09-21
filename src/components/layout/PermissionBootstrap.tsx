"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { usePermissionStore } from "@/store/permission-store";

// Headless -- renders nothing, just triggers the permission fetch. Mounted
// once in the root layout, so it fires once per hard page load / reopened
// tab (the confirmed refresh policy -- no localStorage cache, no polling),
// plus again on any real auth change in the same tab (sign-in/sign-out),
// mirroring AdminSidebarShell's existing role-check pattern for the same
// reason: a mount-once effect alone would keep showing the previous staff
// member's permissions if a different one signs in without a full reload.
export default function PermissionBootstrap() {
  const fetchPermissions = usePermissionStore((s) => s.fetchPermissions);
  const clear = usePermissionStore((s) => s.clear);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    fetchPermissions();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clear();
      } else {
        fetchPermissions();
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
