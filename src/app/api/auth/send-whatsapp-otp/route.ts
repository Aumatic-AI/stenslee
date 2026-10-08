import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { sendAuthOtp } from "@/lib/whatsapp/graph";
import { createServiceClient } from "@/lib/supabase-server";
import { phoneDigits, signupCutoffIso } from "@/lib/signup";

const NOT_REGISTERED = "This number isn't registered. Ask your admin to add you.";

// Codes go to active studio staff, or a number that just filled in the signup form; fails closed if the lookup errors.
async function isAllowedToLogIn(userId: string, phone: string): Promise<"allowed" | "denied" | "check_failed"> {
  const service = createServiceClient();
  const controller = new AbortController();
  // Keeps the hook well inside Supabase's 5s limit even if this lookup stalls.
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const [staffRes, signupRes] = await Promise.all([
      service.from("staff").select("is_active, deleted_at").eq("id", userId).abortSignal(controller.signal).maybeSingle(),
      service
        .from("signup_requests")
        .select("phone")
        .eq("phone", phoneDigits(phone))
        .gte("created_at", signupCutoffIso())
        .abortSignal(controller.signal)
        .maybeSingle(),
    ]);
    if (staffRes.error || signupRes.error) return "check_failed";
    const activeStaff = !!staffRes.data && staffRes.data.is_active && !staffRes.data.deleted_at;
    return activeStaff || !!signupRes.data ? "allowed" : "denied";
  } catch {
    return "check_failed";
  } finally {
    clearTimeout(timeout);
  }
}

// Supabase's Send SMS Hook -- called instead of a built-in SMS provider on
// every signInWithOtp({ phone }) from the studio app. Verifies the
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

  const payload = JSON.parse(rawBody) as { user?: { id?: string; phone?: string }; sms?: { otp?: string } };
  const userId = payload.user?.id;
  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!userId || !phone || !otp) {
    console.error("[send-whatsapp-otp] rejected: payload missing user id, phone or otp");
    return NextResponse.json({ error: { http_code: 400, message: "Missing user, phone or otp in payload" } }, { status: 400 });
  }

  // HTTP 200 + error body on purpose: Supabase only passes the message through this way.
  const access = await isAllowedToLogIn(userId, phone);
  if (access === "denied") {
    console.warn(`[send-whatsapp-otp] refused: ${phone} is not an active staff member or pending signup`);
    return NextResponse.json({ error: { http_code: 403, message: NOT_REGISTERED } });
  }
  if (access === "check_failed") {
    console.error(`[send-whatsapp-otp] refused: could not verify ${phone} against staff/signups`);
    return NextResponse.json({
      error: { http_code: 503, message: "Couldn't verify this number right now. Please try again." },
    });
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
