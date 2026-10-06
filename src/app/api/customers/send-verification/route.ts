import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { createServiceClient } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/permissions/require-feature";
import { combinePhone, isValidPhone } from "@/lib/phone";
import { sendAuthOtp } from "@/lib/whatsapp/graph";

// POST /api/customers/send-verification — sends a 6-digit WhatsApp code to
// a prospective new customer's number. Customers never get a Supabase Auth
// account (confirmed elsewhere in this codebase), so this is a separate,
// lightweight verification record -- not signInWithOtp. Reuses the same
// platform WhatsApp sender + Authentication template as staff login.
export async function POST(req: NextRequest) {
  const check = await requireFeature("customer_management");
  if (!check.ok) return check.response;

  const { phoneCountryCode, phoneNumber } = await req.json();
  if (!isValidPhone(phoneCountryCode, phoneNumber)) {
    return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
  }

  const phone = combinePhone(phoneCountryCode, phoneNumber);
  const code = String(randomInt(100000, 1000000));
  const service = createServiceClient();

  const { error: insertError } = await service.from("customer_phone_verifications").insert({
    organization_id: check.result.organizationId,
    phone,
    code,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  try {
    // Same format as auth OTPs: plain digits, no leading "+".
    await sendAuthOtp(phone.replace(/\D/g, ""), code);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send WhatsApp code" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
