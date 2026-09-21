import { create } from "zustand";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { isFeatureKey, type FeatureKey } from "@/lib/permissions/feature-keys";

export interface FeatureAccess {
  enabled: boolean;
  limitValue: number | null;
  used: number;
  remaining: number | null;
}

export interface PermissionStaff {
  id: string;
  organizationId: string;
  role: "admin" | "designer";
  name: string;
}

type AccessMap = Partial<Record<FeatureKey, FeatureAccess>>;

interface PermissionState {
  status: "idle" | "loading" | "loaded" | "error";
  staff: PermissionStaff | null;
  access: AccessMap;
  error: string | null;
  fetchPermissions: () => Promise<void>;
  clear: () => void;
}

interface EffectiveAccessRow {
  feature_key: string;
  enabled: boolean;
  limit_value: number | null;
  used: number;
  remaining: number | null;
}

export const usePermissionStore = create<PermissionState>((set) => ({
  status: "idle",
  staff: null,
  access: {},
  error: null,

  fetchPermissions: async () => {
    set({ status: "loading", error: null });
    const supabase = createSupabaseBrowserClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ status: "loaded", staff: null, access: {}, error: null });
      return;
    }

    const { data: staffRow, error: staffError } = await supabase
      .from("staff")
      .select("id, organization_id, role, name, is_active, deleted_at")
      .eq("id", user.id)
      .maybeSingle();

    if (staffError || !staffRow || !staffRow.is_active || staffRow.deleted_at) {
      set({ status: "loaded", staff: null, access: {}, error: staffError?.message ?? null });
      return;
    }

    const { data: rows, error: accessError } = await supabase.rpc(
      "get_all_effective_access",
      { p_organization_id: staffRow.organization_id }
    );

    if (accessError) {
      set({
        status: "error",
        staff: {
          id: staffRow.id,
          organizationId: staffRow.organization_id,
          role: staffRow.role,
          name: staffRow.name,
        },
        access: {},
        error: accessError.message,
      });
      return;
    }

    const access: AccessMap = {};
    for (const row of (rows ?? []) as EffectiveAccessRow[]) {
      if (!isFeatureKey(row.feature_key)) continue; // ignore any future/unknown key defensively
      access[row.feature_key] = {
        enabled: row.enabled,
        limitValue: row.limit_value,
        used: row.used,
        remaining: row.remaining,
      };
    }

    set({
      status: "loaded",
      staff: {
        id: staffRow.id,
        organizationId: staffRow.organization_id,
        role: staffRow.role,
        name: staffRow.name,
      },
      access,
      error: null,
    });
  },

  clear: () => set({ status: "idle", staff: null, access: {}, error: null }),
}));
