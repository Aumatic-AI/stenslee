import { usePermissionStore, type FeatureAccess } from "@/store/permission-store";
import type { FeatureKey } from "@/lib/permissions/feature-keys";

export interface FeatureState extends FeatureAccess {
  loading: boolean;
}

const LOCKED: FeatureAccess = { enabled: false, limitValue: null, used: 0, remaining: null };

// Cosmetic only -- the real gate is requireFeature() on the server (see
// src/lib/permissions/require-feature.ts). This hook exists to show/hide UI,
// never to be the only thing standing between a customer and a blocked action.
export function useFeature(key: FeatureKey): FeatureState {
  const status = usePermissionStore((s) => s.status);
  const access = usePermissionStore((s) => s.access[key]);

  if (status === "idle" || status === "loading") {
    return { ...LOCKED, loading: true };
  }
  return { ...(access ?? LOCKED), loading: false };
}
