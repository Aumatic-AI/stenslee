"use client";

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser-only Supabase client. Safe to import in "use client" components.
// Uses cookies (not localStorage) so the session is readable by middleware.
export function createSupabaseBrowserClient() {
  return createBrowserClient(url, anonKey);
}
