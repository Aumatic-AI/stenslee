"use client";

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser-only Supabase client. Safe to import in "use client" components.
// Uses cookies (not localStorage) so the session is readable by middleware.
//
// cookieOptions.name is set explicitly (not left to the @supabase/ssr
// default of `sb-<project-ref>-auth-token`) because the super-admin app
// connects to this SAME Supabase project. Browsers scope cookies by
// domain+path only, never by port -- so on localhost, studio (:3000) and
// super-admin (:3001) share one cookie jar, and two apps using the same
// default cookie name would silently overwrite each other's session on
// every login. Must match the name used in supabase-server.ts and
// proxy.ts in this app exactly, or the proxy won't find the cookie this
// sets.
export function createSupabaseBrowserClient() {
  return createBrowserClient(url, anonKey, {
    cookieOptions: { name: "sb-cleopatra-studio-auth" },
  });
}
