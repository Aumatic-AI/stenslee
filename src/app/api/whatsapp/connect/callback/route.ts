import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/permissions/require-feature";
import { encryptToken } from "@/lib/whatsapp/crypto";
import {
  exchangeCodeForToken,
  subscribeWabaWebhook,
  registerPhoneNumber,
  listPhoneNumbers,
  requestSmbAppSync,
  GraphApiError,
} from "@/lib/whatsapp/graph";

// 2-step PIN we set when registering a brand-new (non-coexistence) number.
const DEFAULT_REGISTRATION_PIN = "468024";

// POST /api/whatsapp/connect/callback — finishes Embedded Signup: swaps the code for a token, then saves the number.
export async function POST(req: NextRequest) {
  const check = await requireFeature("whatsapp");
  if (!check.ok) return check.response;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user!.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { code, wabaId, phoneNumberId, coexistence } = await req.json();
  if (!code || !wabaId) {
    return NextResponse.json({ error: "code and wabaId are required" }, { status: 400 });
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    await subscribeWabaWebhook(wabaId, accessToken);

    const numbers = await listPhoneNumbers(wabaId, accessToken);
    const number = numbers.find((n) => n.id === phoneNumberId) ?? numbers[0];
    if (!number) {
      return NextResponse.json({ error: "No phone number found on this WhatsApp account" }, { status: 400 });
    }

    if (coexistence) {
      // Already registered by the WhatsApp Business app; we only trigger the syncs Meta requires and ignore the data.
      await requestSmbAppSync(number.id, accessToken, "smb_app_state_sync");
      await requestSmbAppSync(number.id, accessToken, "history");
    } else {
      // A brand-new number isn't active for sending until it's registered (else error 133010).
      await registerPhoneNumber(number.id, accessToken, DEFAULT_REGISTRATION_PIN);
    }

    const { error } = await service
      .from("organizations")
      .update({
        whatsapp_waba_id: wabaId,
        whatsapp_phone_number_id: number.id,
        whatsapp_display_phone_number: number.display_phone_number ?? null,
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
