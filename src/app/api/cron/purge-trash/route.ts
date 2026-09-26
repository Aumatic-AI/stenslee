import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { deleteSessionStorage } from "@/lib/session-storage-cleanup";
import { purgeLibraryFile } from "@/lib/library-storage";

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

  // Trashed folder_files -- deleting a folder soft-deletes every file inside
  // it too (see trashLibraryFolder), so this alone covers both a directly
  // deleted file and everything that came from a deleted folder.
  const { data: trashedLibraryFiles, error: libraryQueryError } = await supabase
    .from("folder_files")
    .select("id, organization_id, storage_key, deleted_at")
    .not("deleted_at", "is", null);

  if (libraryQueryError) {
    console.error("[purge-trash] Failed to query trashed library files:", libraryQueryError.message);
  }

  const orgIds = Array.from(new Set([
    ...(trashedSessions ?? []).map((s) => s.organization_id as string),
    ...(trashedLibraryFiles ?? []).map((f) => f.organization_id as string),
  ]));
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
  const isExpired = (organizationId: string, deletedAt: string) => {
    const retentionDays = retentionDaysByOrg.get(organizationId) ?? DEFAULT_RETENTION_DAYS;
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    return new Date(deletedAt).getTime() < cutoff;
  };

  const expiredSessions = (trashedSessions ?? []).filter((s) =>
    isExpired(s.organization_id as string, s.deleted_at as string)
  );

  let totalFilesRemoved = 0;
  const purgedSessions: string[] = [];
  const failedSessions: string[] = [];

  for (const session of expiredSessions) {
    try {
      const filesRemoved = await deleteSessionStorage(supabase, session.id);
      totalFilesRemoved += filesRemoved;

      const { error: deleteError } = await supabase.from("sessions").delete().eq("id", session.id);
      if (deleteError) throw new Error(deleteError.message);

      purgedSessions.push(session.id);
      console.log(`[purge-trash] Session ${session.id} purged (${filesRemoved} files).`);
    } catch (err) {
      failedSessions.push(session.id);
      console.error(`[purge-trash] Failed to purge session ${session.id}:`, (err as Error).message);
    }
  }

  const expiredLibraryFiles = (trashedLibraryFiles ?? []).filter((f) =>
    isExpired(f.organization_id as string, f.deleted_at as string)
  );

  const purgedLibraryFiles: string[] = [];
  const failedLibraryFiles: string[] = [];

  for (const file of expiredLibraryFiles) {
    try {
      await purgeLibraryFile(supabase, { id: file.id, storage_key: file.storage_key as string });
      purgedLibraryFiles.push(file.id);
    } catch (err) {
      failedLibraryFiles.push(file.id);
      console.error(`[purge-trash] Failed to purge library file ${file.id}:`, (err as Error).message);
    }
  }

  // Folders are structural, never shown in Trash themselves -- once every
  // file under a trashed folder has been purged (or it was always empty),
  // an expired folder with nothing left under it is just a leftover shell.
  const { data: trashedFolders } = await supabase
    .from("folders")
    .select("id, organization_id, deleted_at")
    .not("deleted_at", "is", null);

  let purgedFolders = 0;
  for (const folder of trashedFolders ?? []) {
    if (!isExpired(folder.organization_id as string, folder.deleted_at as string)) continue;
    const [{ count: childFolders }, { count: childFiles }] = await Promise.all([
      supabase.from("folders").select("id", { count: "exact", head: true }).eq("parent_folder_id", folder.id),
      supabase.from("folder_files").select("id", { count: "exact", head: true }).eq("folder_id", folder.id),
    ]);
    if ((childFolders ?? 0) > 0 || (childFiles ?? 0) > 0) continue;
    const { error } = await supabase.from("folders").delete().eq("id", folder.id);
    if (!error) purgedFolders++;
  }

  console.log(
    `[purge-trash] Sessions: ${purgedSessions.length} purged, ${totalFilesRemoved} files removed. ` +
    `Library: ${purgedLibraryFiles.length} files purged, ${purgedFolders} empty folders removed.`
  );

  return NextResponse.json({
    sessions: { purged: purgedSessions.length, failed: failedSessions.length, filesRemoved: totalFilesRemoved, ...(failedSessions.length > 0 && { failedIds: failedSessions }) },
    library: { purgedFiles: purgedLibraryFiles.length, failedFiles: failedLibraryFiles.length, purgedFolders, ...(failedLibraryFiles.length > 0 && { failedIds: failedLibraryFiles }) },
  });
}
