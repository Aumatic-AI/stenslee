// SERVER-ONLY — do not import this in "use client" components.
// It uses next/headers which is only available in Server Components and Route Handlers.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Server Component / Route Handler client (reads session from cookies)
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });
}

// Service-role client — bypasses RLS. Only use in API routes.
export function createServiceClient() {
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export type { StaffRole, StaffMember } from "@/lib/staff-types";
import type { StaffMember } from "@/lib/staff-types";

// Get the logged-in staff member from a server context.
export async function getStaffSession(): Promise<StaffMember | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: staff } = await supabase
    .from("staff")
    .select("id, email, name, role, is_active, created_at, deleted_at, avatar_url, organization_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!staff || !staff.is_active || staff.deleted_at) return null;
  return staff as StaffMember;
}
