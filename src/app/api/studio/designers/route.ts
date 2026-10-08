import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { uploadBase64 } from "@/lib/storage";
import { requireSeatAvailable } from "@/lib/permissions/require-feature";
import { isValidPhone, combinePhone } from "@/lib/phone";
import { findStaffByPhone, createOrReuseAuthUser, type StaffByPhone } from "@/lib/staff-phone";

// POST /api/studio/designers — create a new designer (admin only)
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role, organization_id").eq("id", user.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, phoneCountryCode, phoneNumber } = await req.json();
  if (!name?.trim() || !isValidPhone(phoneCountryCode, phoneNumber)) {
    return NextResponse.json({ error: "name and a valid phone number are required" }, { status: 400 });
  }
  const phone = combinePhone(phoneCountryCode, phoneNumber);

  let existing: StaffByPhone | null;
  try {
    existing = await findStaffByPhone(service, phone);
  } catch {
    return NextResponse.json({ error: "Couldn't check this number. Please try again." }, { status: 500 });
  }

  // Never say which studio: the other studio's team is private.
  if (existing && existing.organization_id !== requester.organization_id) {
    return NextResponse.json(
      { error: "This number is already registered with another studio on Stenslee. A number can only be in one studio for now, so please use a different number.", code: "in_other_studio" },
      { status: 409 }
    );
  }
  if (existing && !existing.deleted_at) {
    const error = existing.is_active
      ? `This number is already on your team${existing.role === "admin" ? " as an admin" : ""}.`
      : "This designer is already in your studio but deactivated. Turn them back on from the Designers list.";
    return NextResponse.json({ error, code: "already_in_studio" }, { status: 409 });
  }

  // Server-side seat-limit gate — live headcount against the plan, not a
  // usage-log check (see requireSeatAvailable's own comment for why).
  const seatCheck = await requireSeatAvailable("designer");
  if (!seatCheck.ok) return seatCheck.response;

  // A designer removed from this studio earlier comes back with their history.
  if (existing) {
    const { data: restored, error: restoreError } = await service
      .from("staff")
      .update({ deleted_at: null, is_active: true, name: name.trim() })
      .eq("id", existing.id)
      .select()
      .single();
    if (restoreError) return NextResponse.json({ error: restoreError.message }, { status: 500 });
    return NextResponse.json({ staff: restored, restored: true }, { status: 200 });
  }

  // phone_confirm skips OTP verification: the admin is vouching for this number.
  let authUser: { id: string; created: boolean };
  try {
    authUser = await createOrReuseAuthUser(service, phone);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Failed to create user" }, { status: 500 });
  }

  // Insert staff row — joins the same organization as the admin creating them.
  const { data: staffRow, error: staffError } = await service
    .from("staff")
    .insert({
      id: authUser.id,
      organization_id: seatCheck.organizationId,
      phone_country_code: phoneCountryCode,
      phone_number: phoneNumber,
      name: name.trim(),
      role: "designer",
      is_active: true,
    })
    .select()
    .single();

  if (staffError) {
    // Roll back only a login we just created, never a reused one.
    if (authUser.created) await service.auth.admin.deleteUser(authUser.id);
    return NextResponse.json({ error: staffError.message }, { status: 500 });
  }

  return NextResponse.json({ staff: staffRow }, { status: 201 });
}

// PATCH /api/studio/designers — toggle is_active, and/or edit name/photo
// (admin only). Every field is optional — only what's provided gets
// updated, so the same endpoint serves both the quick active/inactive
// toggle and the full "Edit" modal on the designers list. Stays a server
// route because the photo upload needs the storage service role; a plain
// is_active/name-only change could go direct from the client, but bundling
// it here keeps one consistent save path. Phone is not editable here —
// it's the login identity, set once at creation.
export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, is_active, name, avatarBase64 } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Prevent admin from deactivating themselves
  if (typeof is_active === "boolean" && id === user.id) {
    return NextResponse.json({ error: "Cannot deactivate your own account" }, { status: 400 });
  }

  const updates: { is_active?: boolean; name?: string; avatar_key?: string } = {};
  if (typeof is_active === "boolean") updates.is_active = is_active;
  if (typeof name === "string" && name.trim()) updates.name = name.trim();

  if (typeof avatarBase64 === "string" && avatarBase64) {
    try {
      updates.avatar_key = await uploadBase64(avatarBase64, id, "avatars");
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
    .select("id, phone, name, role, is_active, created_at, avatar_key")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, staff: data });
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
