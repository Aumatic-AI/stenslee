import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/permissions/require-feature";
import { encryptToken } from "@/lib/whatsapp/crypto";
import { exchangeCodeForToken, subscribeWabaWebhook, registerPhoneNumber, GraphApiError } from "@/lib/whatsapp/graph";

// POST /api/whatsapp/connect/callback — the browser calls this once
// Embedded Signup finishes: it hands us the one-time `code` from FB.login's
// authResponse plus the wabaId/phoneNumberId Meta posted via the
// WA_EMBEDDED_SIGNUP window message. We exchange the code for a permanent
// token server-side (the app secret never reaches the browser) and wire the
// webhook before saving anything.
export async function POST(req: NextRequest) {
  const check = await requireFeature("whatsapp");
  if (!check.ok) return check.response;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user!.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { code, wabaId, phoneNumberId, displayPhoneNumber, pin } = await req.json();
  if (!code || !wabaId || !phoneNumberId || !pin) {
    return NextResponse.json({ error: "code, wabaId, phoneNumberId and pin are required" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be exactly 6 digits" }, { status: 400 });
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    await subscribeWabaWebhook(wabaId, accessToken);
    // Embedded Signup alone doesn't activate the number for sending -- this
    // does. Without it, every send fails with error 133010.
    await registerPhoneNumber(phoneNumberId, accessToken, pin);

    const { error } = await service
      .from("organizations")
      .update({
        whatsapp_waba_id: wabaId,
        whatsapp_phone_number_id: phoneNumberId,
        whatsapp_display_phone_number: displayPhoneNumber ?? null,
        whatsapp_access_token_enc: encryptToken(accessToken),
        whatsapp_connected_at: new Date().toISOString(),
      })
      .eq("id", check.result.organizationId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GraphApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Failed to connect WhatsApp" }, { status: 500 });
  }
}

// DELETE /api/whatsapp/connect/callback — disconnect, so a studio can redo
// the flow (e.g. with a different number) instead of being stuck once connected.
export async function DELETE() {
  const check = await requireFeature("whatsapp");
  if (!check.ok) return check.response;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user!.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { error } = await service
    .from("organizations")
    .update({
      whatsapp_waba_id: null,
      whatsapp_phone_number_id: null,
      whatsapp_display_phone_number: null,
      whatsapp_access_token_enc: null,
      whatsapp_connected_at: null,
    })
    .eq("id", check.result.organizationId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
