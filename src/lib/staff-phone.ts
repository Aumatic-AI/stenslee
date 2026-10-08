// SERVER-ONLY — phone checks shared by every route that creates a staff login.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface StaffByPhone {
  id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
  deleted_at: string | null;
}

// The staff record already using this number, if any (a number can be in one studio for now).
export async function findStaffByPhone(service: SupabaseClient, phone: string): Promise<StaffByPhone | null> {
  const { data, error } = await service
    .from("staff")
    .select("id, organization_id, role, is_active, deleted_at")
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Creates the login for a number, or reuses one an unfinished signup left behind.
export async function createOrReuseAuthUser(service: SupabaseClient, phone: string): Promise<{ id: string; created: boolean }> {
  const { data, error } = await service.auth.admin.createUser({ phone, phone_confirm: true });
  if (!error && data.user) return { id: data.user.id, created: true };
  if (error?.code !== "phone_exists") throw error ?? new Error("Failed to create user");

  const { data: existingId, error: lookupError } = await service.rpc("auth_user_id_by_phone", { p_phone: phone.replace(/\D/g, "") });
  if (lookupError || !existingId) throw lookupError ?? new Error("Failed to create user");
  return { id: existingId as string, created: false };
}
