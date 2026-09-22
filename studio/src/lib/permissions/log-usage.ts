"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import type { FeatureKey } from "@/lib/permissions/feature-keys";

export interface LogUsageParams {
  organizationId: string;
  featureKey: FeatureKey;
  action: string;
  staffId?: string | null;
  sessionId?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

// Written from the browser client, not a server route -- consistent with
// this codebase's established pattern of writing from the browser wherever
// RLS allows (see AGENTS.md's Node/Supabase fetch note). Call this only
// after the gated action has actually succeeded (e.g. a generation batch
// finished), never before -- a failed action must not consume the quota.
export async function logUsage(params: LogUsageParams): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("usage_logs").insert({
    organization_id: params.organizationId,
    staff_id: params.staffId ?? null,
    session_id: params.sessionId ?? null,
    feature_key: params.featureKey,
    action: params.action,
    target_id: params.targetId ?? null,
    metadata: params.metadata ?? {},
  });
  if (error) {
    console.error("logUsage failed:", error);
  }
}
