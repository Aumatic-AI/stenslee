import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { uploadBase64 } from "@/lib/storage";
import { requireSeatAvailable } from "@/lib/permissions/require-feature";

// POST /api/studio/designers — create a new designer (admin only)
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Server-side seat-limit gate — live headcount against the plan, not a
  // usage-log check (see requireSeatAvailable's own comment for why).
  const seatCheck = await requireSeatAvailable("designer");
  if (!seatCheck.ok) return seatCheck.response;

  const { email, name, password } = await req.json();
  if (!email?.trim() || !name?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "email, name and password are required" }, { status: 400 });
  }

  // Create auth user via Supabase Admin API
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message ?? "Failed to create user" }, { status: 500 });
  }

  // Insert staff row — joins the same organization as the admin creating them.
  const { data: staffRow, error: staffError } = await service
    .from("staff")
    .insert({ id: authData.user.id, organization_id: seatCheck.organizationId, email, name, role: "designer", is_active: true })
    .select()
    .single();

  if (staffError) {
    // Roll back auth user
    await service.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: staffError.message }, { status: 500 });
  }

  return NextResponse.json({ staff: staffRow }, { status: 201 });
}

// PATCH /api/studio/designers — toggle is_active, and/or edit name/email/
// photo (admin only). Every field is optional — only what's provided gets
// updated, so the same endpoint serves both the quick active/inactive
// toggle and the full "Edit" modal on the designers list. Stays a server
// route because changing email requires the Supabase Admin API (service
// role); a plain is_active/name-only change could go direct from the
// client, but bundling it here keeps one consistent save path.
export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, is_active, name, email, avatarBase64 } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Prevent admin from deactivating themselves
  if (typeof is_active === "boolean" && id === user.id) {
    return NextResponse.json({ error: "Cannot deactivate your own account" }, { status: 400 });
  }

  const updates: { is_active?: boolean; name?: string; email?: string; avatar_url?: string } = {};
  if (typeof is_active === "boolean") updates.is_active = is_active;
  if (typeof name === "string" && name.trim()) updates.name = name.trim();

  if (typeof email === "string" && email.trim()) {
    const newEmail = email.trim();
    const { error: authError } = await service.auth.admin.updateUserById(id, { email: newEmail });
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });
    updates.email = newEmail;
  }

  if (typeof avatarBase64 === "string" && avatarBase64) {
    try {
      updates.avatar_url = await uploadBase64(avatarBase64, id, "avatars");
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await service
    .from("staff")
    .update(updates)
    .eq("id", id)
    .select("id, email, name, role, is_active, created_at, avatar_url")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, staff: data });
}

// PUT /api/studio/designers — reset a designer's password (admin only).
// The new password is applied to Supabase Auth only — never stored in our DB.
export async function PUT(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, password } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (typeof password !== "string" || password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  if (id === user.id) {
    return NextResponse.json({ error: "Use admin settings to change your own password" }, { status: 400 });
  }

  const { data: target } = await service
    .from("staff")
    .select("role, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Designer not found" }, { status: 404 });
  if (target.role === "admin") {
    return NextResponse.json({ error: "Cannot reset an admin password from here" }, { status: 400 });
  }
  if (target.deleted_at) {
    return NextResponse.json({ error: "Cannot reset password for a removed designer" }, { status: 400 });
  }

  const { error } = await service.auth.admin.updateUserById(id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/studio/designers — soft-delete a designer (admin only).
// Keeps the staff row so historical sessions still resolve "designed by X",
// but hides the designer from the admin list and blocks them from logging in.
export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  if (id === user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const { data: target } = await service.from("staff").select("role").eq("id", id).maybeSingle();
  if (!target) return NextResponse.json({ error: "Designer not found" }, { status: 404 });
  if (target.role === "admin") {
    return NextResponse.json({ error: "Cannot delete an admin account" }, { status: 400 });
  }

  const { error } = await service
    .from("staff")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
