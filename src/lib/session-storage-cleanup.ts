// SERVER-ONLY — needs the service-role client to bypass RLS (no storage
// delete policy exists for staff; hard-deleting a session's files is only
// ever done from a trusted server route).
import { createServiceClient } from "@/lib/supabase-server";

const BUCKET = "session-assets";
const PREFIXES = ["refs", "designs", "body", "composites", "previews"];

// Deletes every file stored under `{sessionId}/` in the session-assets
// bucket. Returns the count of files removed. Shared by both hard-delete
// paths — the admin's one-off "delete permanently" action and the
// scheduled 30-day trash purge — since both need the exact same cleanup.
export async function deleteSessionStorage(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string
): Promise<number> {
  const allPaths: string[] = [];

  for (const prefix of PREFIXES) {
    const { data: files } = await supabase.storage
      .from(BUCKET)
      .list(`${sessionId}/${prefix}`, { limit: 1000 });

    if (files && files.length > 0) {
      files.forEach((f) => allPaths.push(`${sessionId}/${prefix}/${f.name}`));
    }
  }

  if (allPaths.length === 0) return 0;

  const { error } = await supabase.storage.from(BUCKET).remove(allPaths);
  if (error) {
    console.error(`[session-storage-cleanup] Failed for session ${sessionId}:`, error.message);
  }
  return allPaths.length;
}
