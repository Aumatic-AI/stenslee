import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { sendAuthOtp } from "@/lib/whatsapp/graph";

// Supabase's Send SMS Hook -- called instead of a built-in SMS provider on
// every signInWithOtp({ phone }), for BOTH apps (studio + super-admin share
// one Supabase project, so this one endpoint serves both). Verifies the
// request really came from Supabase (Standard Webhooks signing, same scheme
// Supabase's own docs describe), then relays the code over WhatsApp instead
// of SMS. Configure the hook URL + secret once in Supabase Dashboard ->
// Authentication -> Hooks -> Send SMS hook.
function isValidSupabaseSignature(rawBody: string, req: NextRequest): boolean {
  const id = req.headers.get("webhook-id");
  const timestamp = req.headers.get("webhook-timestamp");
  const signatureHeader = req.headers.get("webhook-signature");
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  const secretBytes = Buffer.from(secret.replace(/^v1,whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(signedContent, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected, "base64");

  // Header can carry multiple space-separated "v1,<sig>" values.
  return signatureHeader.split(" ").some((part) => {
    const sig = part.startsWith("v1,") ? part.slice(3) : part;
    const providedBuf = Buffer.from(sig, "base64");
    return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!isValidSupabaseSignature(rawBody, req)) {
    console.error("[send-whatsapp-otp] rejected: invalid Supabase webhook signature");
    return NextResponse.json({ error: { http_code: 401, message: "Invalid signature" } }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as { user?: { phone?: string }; sms?: { otp?: string } };
  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    console.error("[send-whatsapp-otp] rejected: payload missing phone or otp", payload);
    return NextResponse.json({ error: { http_code: 400, message: "Missing phone or otp in payload" } }, { status: 400 });
  }

  console.log(`[send-whatsapp-otp] sending code to ${phone}`);
  try {
    // Supabase stores (and sends us) the phone as plain digits, no leading
    // "+" -- same format Meta's Graph API expects for `to` (see send/route.ts).
    const result = await sendAuthOtp(phone.replace(/\D/g, ""), otp);
    console.log("[send-whatsapp-otp] Meta accepted the send:", JSON.stringify(result));
  } catch (err) {
    console.error("[send-whatsapp-otp] Meta send failed:", err);
    return NextResponse.json(
      { error: { http_code: 500, message: err instanceof Error ? err.message : "Failed to send WhatsApp OTP" } },
      { status: 500 }
    );
  }

  return NextResponse.json({});
}
