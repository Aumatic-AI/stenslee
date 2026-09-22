// SERVER-ONLY -- do not import from a "use client" file.
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { FeatureKey } from "@/lib/permissions/feature-keys";

export interface FeatureAccessInfo {
  enabled: boolean;
  limitValue: number | null;
  used: number;
  remaining: number | null;
}

export type FeatureBlockReason =
  | "unauthenticated"
  | "no_organization"
  | "disabled"
  | "limit_reached"
  | "check_failed";

export interface FeatureCheckResult {
  allowed: boolean;
  organizationId: string | null;
  staffId: string | null;
  access: FeatureAccessInfo | null;
  reason?: FeatureBlockReason;
}

interface EffectiveAccessRow {
  enabled: boolean;
  limit_value: number | null;
  used: number;
  remaining: number | null;
}

// Retries a Supabase call up to `attempts` extra times with a short backoff.
// Covers the transient case of the Node-side Supabase fetch flakiness noted
// in AGENTS.md; if every attempt still fails, the caller treats it as
// "check_failed" and blocks the action (fail closed, never fail open).
async function withRetry<T>(
  fn: () => Promise<{ data: T | null; error: { message: string } | null }>,
  attempts = 2
): Promise<{ data: T | null; error: { message: string } | null }> {
  let last: { data: T | null; error: { message: string } | null } = { data: null, error: { message: "not attempted" } };
  for (let i = 0; i <= attempts; i++) {
    try {
      last = await fn();
      if (!last.error) return last;
    } catch (err) {
      last = { data: null, error: { message: err instanceof Error ? err.message : "unknown error" } };
    }
    if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
  }
  return last;
}

export async function checkFeature(featureKey: FeatureKey): Promise<FeatureCheckResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { allowed: false, organizationId: null, staffId: null, access: null, reason: "unauthenticated" };
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("organization_id, is_active, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!staff || !staff.is_active || staff.deleted_at || !staff.organization_id) {
    return { allowed: false, organizationId: null, staffId: user.id, access: null, reason: "no_organization" };
  }

  const { data, error } = await withRetry<EffectiveAccessRow[]>(async () =>
    supabase.rpc("get_effective_access", {
      p_organization_id: staff.organization_id,
      p_feature_key: featureKey,
    })
  );

  if (error || !data || data.length === 0) {
    return {
      allowed: false,
      organizationId: staff.organization_id,
      staffId: user.id,
      access: null,
      reason: "check_failed",
    };
  }

  const row = data[0];
  const access: FeatureAccessInfo = {
    enabled: row.enabled,
    limitValue: row.limit_value,
    used: row.used,
    remaining: row.remaining,
  };

  if (!access.enabled) {
    return { allowed: false, organizationId: staff.organization_id, staffId: user.id, access, reason: "disabled" };
  }
  if (access.remaining !== null && access.remaining <= 0) {
    return { allowed: false, organizationId: staff.organization_id, staffId: user.id, access, reason: "limit_reached" };
  }
  return { allowed: true, organizationId: staff.organization_id, staffId: user.id, access };
}

const REASON_STATUS: Record<FeatureBlockReason, number> = {
  unauthenticated: 401,
  no_organization: 403,
  disabled: 403,
  limit_reached: 403,
  check_failed: 503,
};

const REASON_MESSAGE: Record<FeatureBlockReason, string> = {
  unauthenticated: "Not signed in",
  no_organization: "Staff account is not linked to an organization",
  disabled: "This feature is not available on your current plan",
  limit_reached: "Usage limit reached for this feature this period",
  check_failed: "Could not verify permissions — please try again",
};

// Convenience wrapper for route handlers:
//   const check = await requireFeature("ai_design");
//   if (!check.ok) return check.response;
//   // ... proceed, using check.result.organizationId / staffId
export async function requireFeature(
  featureKey: FeatureKey
): Promise<{ ok: true; result: FeatureCheckResult } | { ok: false; response: NextResponse }> {
  const result = await checkFeature(featureKey);
  if (result.allowed) return { ok: true, result };

  const reason = result.reason ?? "check_failed";
  return {
    ok: false,
    response: NextResponse.json(
      { error: REASON_MESSAGE[reason], reason },
      { status: REASON_STATUS[reason] }
    ),
  };
}

// designer_seats / admin_seats are NOT usage-log-based like every other
// limit -- per the schema design, seat limits are checked live against a
// real headcount (count(*) from staff where ... role = $1 and is_active),
// never a cached counter or a usage_logs count. get_effective_access() for
// these two keys is only used for its enabled/limit_value fields here; its
// used/remaining fields are meaningless for seats and ignored.
export async function requireSeatAvailable(
  role: "admin" | "designer"
): Promise<{ ok: true; organizationId: string } | { ok: false; response: NextResponse }> {
  const featureKey: FeatureKey = role === "admin" ? "admin_seats" : "designer_seats";
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("organization_id, is_active, deleted_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!staff || !staff.is_active || staff.deleted_at || !staff.organization_id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Staff account is not linked to an organization" }, { status: 403 }),
    };
  }

  const { data, error } = await supabase.rpc("get_effective_access", {
    p_organization_id: staff.organization_id,
    p_feature_key: featureKey,
  });
  if (error || !data || data.length === 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Could not verify seat limit — please try again" }, { status: 503 }),
    };
  }

  const { enabled, limit_value: limitValue } = data[0] as { enabled: boolean; limit_value: number | null };
  if (!enabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${role === "admin" ? "Admin" : "Designer"} accounts are not available on your current plan`, reason: "disabled" },
        { status: 403 }
      ),
    };
  }

  if (limitValue !== null) {
    const { count, error: countError } = await supabase
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", staff.organization_id)
      .eq("role", role)
      .eq("is_active", true)
      .is("deleted_at", null);
    if (countError) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Could not verify seat limit — please try again" }, { status: 503 }),
      };
    }
    if ((count ?? 0) >= limitValue) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Seat limit reached — your plan allows ${limitValue} ${role} account${limitValue === 1 ? "" : "s"}`, reason: "limit_reached" },
          { status: 403 }
        ),
      };
    }
  }

  return { ok: true, organizationId: staff.organization_id };
}
