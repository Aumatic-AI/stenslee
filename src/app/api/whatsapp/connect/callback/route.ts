import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/permissions/require-feature";
import {
  exchangeCodeForToken,
  subscribeWabaWebhook,
  registerPhoneNumber,
  listPhoneNumbers,
  requestSmbAppSync,
  maskToken,
  GraphApiError,
} from "@/lib/whatsapp/graph";

// 2-step PIN we set when registering a brand-new (non-coexistence) number.
const DEFAULT_REGISTRATION_PIN = "468024";

const LOG = "[whatsapp-connect]";

// POST /api/whatsapp/connect/callback — finishes Embedded Signup: swaps the code for a token, then saves the number.
export async function POST(req: NextRequest) {
  const check = await requireFeature("whatsapp");
  if (!check.ok) {
    console.warn(LOG, "callback refused by feature check", check.response.status);
    return check.response;
  }
  const organizationId = check.result.organizationId;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user!.id).maybeSingle();
  if (requester?.role !== "admin") {
    console.warn(LOG, "callback refused: caller is not an admin", { userId: user?.id, role: requester?.role, organizationId });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { code, wabaId, phoneNumberId, coexistence } = body;
  console.log(LOG, "callback received from browser", { organizationId, userId: user!.id, code, wabaId, phoneNumberId, coexistence });
  if (!code || !wabaId) {
    console.warn(LOG, "callback missing code or wabaId", body);
    return NextResponse.json({ error: "code and wabaId are required" }, { status: 400 });
  }

  try {
    console.log(LOG, "step 1: exchanging code for access token");
    const accessToken = await exchangeCodeForToken(code);
    console.log(LOG, "step 1 done: got access token", maskToken(accessToken));

    console.log(LOG, "step 2: subscribing our app to WABA webhooks", { wabaId });
    const subscribed = await subscribeWabaWebhook(wabaId, accessToken);
    console.log(LOG, "step 2 done:", subscribed);

    console.log(LOG, "step 3: listing phone numbers on WABA", { wabaId });
    const numbers = await listPhoneNumbers(wabaId, accessToken);
    console.log(LOG, "step 3 done: numbers on WABA", numbers);
    const number = numbers.find((n) => n.id === phoneNumberId) ?? numbers[0];
    if (!number) {
      console.error(LOG, "no phone number found on WABA", { wabaId, phoneNumberId });
      return NextResponse.json({ error: "No phone number found on this WhatsApp account" }, { status: 400 });
    }
    console.log(LOG, "using phone number", { chosen: number, requestedPhoneNumberId: phoneNumberId ?? null });

    if (coexistence) {
      // Already registered by the WhatsApp Business app; we only trigger the syncs Meta requires and ignore the data.
      console.log(LOG, "step 4 (coexistence): requesting smb_app_state_sync and history sync", { phoneNumberId: number.id });
      const stateSync = await requestSmbAppSync(number.id, accessToken, "smb_app_state_sync");
      console.log(LOG, "smb_app_state_sync requested:", stateSync);
      const historySync = await requestSmbAppSync(number.id, accessToken, "history");
      console.log(LOG, "history sync requested:", historySync);
    } else {
      // A brand-new number isn't active for sending until it's registered (else error 133010).
      console.log(LOG, "step 4 (normal number): registering phone number", { phoneNumberId: number.id });
      const registered = await registerPhoneNumber(number.id, accessToken, DEFAULT_REGISTRATION_PIN);
      console.log(LOG, "number registered:", registered);
    }

    const update = {
      whatsapp_waba_id: wabaId,
      whatsapp_phone_number_id: number.id,
      whatsapp_display_phone_number: number.display_phone_number ?? null,
      // Stored as plain text for now; encryption will be added back later.
      whatsapp_access_token_enc: accessToken,
      whatsapp_connected_at: new Date().toISOString(),
    };
    console.log(LOG, "step 5: saving connection to organization", { organizationId, ...update, whatsapp_access_token_enc: maskToken(accessToken) });
    const { error } = await service.from("organizations").update(update).eq("id", organizationId);

    if (error) {
      console.error(LOG, "saving connection failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.log(LOG, "connected successfully", { organizationId, wabaId, phoneNumberId: number.id, coexistence: !!coexistence });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GraphApiError) {
      console.error(LOG, `Graph API error ${err.status}: ${err.message}`, JSON.stringify(err.body));
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error(LOG, "unexpected error", err);
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

  console.log(LOG, "disconnecting WhatsApp", { organizationId: check.result.organizationId, userId: user!.id });
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

  if (error) {
    console.error(LOG, "disconnect failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  console.log(LOG, "disconnected", { organizationId: check.result.organizationId });
  return NextResponse.json({ ok: true });
}
