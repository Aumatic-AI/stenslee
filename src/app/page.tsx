"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

// Redirect-only -- renders nothing. The branded full-page splash for "we
// don't know where to send you yet" lives solely in AdminSidebarShell
// (mounted in the root layout, wrapping this page as `children`): showing
// a second, near-identical splash here too meant that once the shell had
// already decided to show the sidebar, this page's own copy of it would
// render nested inside the sidebar's content pane instead of covering the
// full viewport -- sidebar and splash on screen at once.
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    async function redirect() {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/studio/login");
        return;
      }

      const { data: staff } = await supabase
        .from("staff")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      router.replace(staff?.role === "admin" ? "/studio/admin" : "/studio/designer");
    }
    redirect();
  }, [router]);

  return null;
}
