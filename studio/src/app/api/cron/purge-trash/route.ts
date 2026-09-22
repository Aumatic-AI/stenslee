import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { deleteSessionStorage } from "@/lib/session-storage-cleanup";

// Scheduled purge for the admin's "Recently Deleted" tab — see the PURGE JOB
// section in supabase-schema.sql for the pg_cron job that calls this daily.
// Sessions soft-deleted more than that org's trash_retention plan limit ago
// get permanently removed: files from session-assets, then the row
// (cascades to chat_messages). This route is the only place that actually
// touches storage/tables — the cron job itself just triggers this HTTP
// call, nothing more.
export const maxDuration = 300;

// Fallback used only if an org's plan has no trash_retention row at all
// (get_effective_access comes back disabled/no limit) -- matches the
// original single-tenant default so an unconfigured org doesn't accidentally
// keep trash forever.
const DEFAULT_RETENTION_DAYS = 30;

interface EffectiveAccessRow {
  enabled: boolean;
  limit_value: number | null;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Retention is a per-org plan limit (trash_retention), not a single global
  // constant -- pull every trashed session's org + deleted_at, then compute
  // each org's own cutoff before filtering.
  const { data: trashedSessions, error: queryError } = await supabase
    .from("sessions")
    .select("id, organization_id, deleted_at")
    .not("deleted_at", "is", null);

  if (queryError) {
    console.error("[purge-trash] Failed to query trashed sessions:", queryError.message);
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (!trashedSessions || trashedSessions.length === 0) {
    console.log("[purge-trash] No trashed sessions found.");
    return NextResponse.json({ purged: 0, filesRemoved: 0 });
  }

  const orgIds = Array.from(new Set(trashedSessions.map((s) => s.organization_id as string)));
  const retentionDaysByOrg = new Map<string, number>();
  for (const orgId of orgIds) {
    const { data, error } = await supabase.rpc("get_effective_access", {
      p_organization_id: orgId,
      p_feature_key: "trash_retention",
    });
    const row: EffectiveAccessRow | null = !error && data && data.length > 0 ? data[0] : null;
    retentionDaysByOrg.set(
      orgId,
      row?.enabled && row.limit_value !== null ? row.limit_value : DEFAULT_RETENTION_DAYS
    );
  }

  const now = Date.now();
  const expiredSessions = trashedSessions.filter((s) => {
    const retentionDays = retentionDaysByOrg.get(s.organization_id as string) ?? DEFAULT_RETENTION_DAYS;
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    return new Date(s.deleted_at as string).getTime() < cutoff;
  });

  if (expiredSessions.length === 0) {
    console.log("[purge-trash] No sessions past their org's retention window yet.");
    return NextResponse.json({ purged: 0, filesRemoved: 0 });
  }

  console.log(`[purge-trash] Found ${expiredSessions.length} session(s) past their org's retention window.`);

  let totalFilesRemoved = 0;
  const purged: string[] = [];
  const failed: string[] = [];

  for (const session of expiredSessions) {
    try {
      const filesRemoved = await deleteSessionStorage(supabase, session.id);
      totalFilesRemoved += filesRemoved;

      const { error: deleteError } = await supabase.from("sessions").delete().eq("id", session.id);
      if (deleteError) throw new Error(deleteError.message);

      purged.push(session.id);
      console.log(`[purge-trash] Session ${session.id} purged (${filesRemoved} files).`);
    } catch (err) {
      failed.push(session.id);
      console.error(`[purge-trash] Failed to purge session ${session.id}:`, (err as Error).message);
    }
  }

  return NextResponse.json({
    purged: purged.length,
    failed: failed.length,
    filesRemoved: totalFilesRemoved,
    sessionIds: purged,
    ...(failed.length > 0 && { failedIds: failed }),
  });
}
