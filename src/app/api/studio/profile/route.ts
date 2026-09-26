import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, getStaffSession } from "@/lib/supabase-server";
import { uploadBase64 } from "@/lib/storage";

// PATCH /api/studio/profile — update a staff member's own name/avatar,
// or (admin only) another staff member's name/avatar.
export async function PATCH(req: NextRequest) {
  const requester = await getStaffSession();
  if (!requester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { staffId, name, avatarBase64 } = await req.json();
  const targetId = staffId || requester.id;

  if (targetId !== requester.id && requester.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: { name?: string; avatar_key?: string } = {};

  if (typeof name === "string" && name.trim()) {
    updates.name = name.trim();
  }

  if (typeof avatarBase64 === "string" && avatarBase64) {
    try {
      updates.avatar_key = await uploadBase64(avatarBase64, targetId, "avatars");
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("staff")
    .update(updates)
    .eq("id", targetId)
    .select("id, name, avatar_key")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: data });
}
