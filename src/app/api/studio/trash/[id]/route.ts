import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { deleteSessionStorage } from "@/lib/session-storage-cleanup";

// DELETE /api/studio/trash/[id] — permanently delete one soft-deleted
// session (admin only). Removes its files from session-assets, then the
// row itself, which cascades to tattoo_designs/placements/chat_messages.
// This is the "Delete" button on the Recently Deleted list — irreversible,
// unlike the ordinary soft-delete everywhere else in the app.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: session } = await service.from("sessions").select("id, deleted_at").eq("id", id).maybeSingle();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!session.deleted_at) {
    return NextResponse.json({ error: "Only a soft-deleted session can be permanently deleted" }, { status: 400 });
  }

  const filesRemoved = await deleteSessionStorage(service, id);

  const { error } = await service.from("sessions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, filesRemoved });
}
