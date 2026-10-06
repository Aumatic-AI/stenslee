import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/permissions/require-feature";
import { combinePhone, isValidPhone } from "@/lib/phone";

// POST /api/customers/verify-phone — checks the code against the most
// recent unverified, unexpired record for this phone, and marks it
// verified. The actual enforcement that a customer can't be created without
// this happening lives in the DB (customers_require_phone_verification
// trigger) -- this route alone is not what blocks a bypass.
export async function POST(req: NextRequest) {
  const check = await requireFeature("customer_management");
  if (!check.ok) return check.response;

  const { phoneCountryCode, phoneNumber, code } = await req.json();
  if (!isValidPhone(phoneCountryCode, phoneNumber) || !/^\d{6}$/.test(code ?? "")) {
    return NextResponse.json({ error: "Enter a valid phone number and 6-digit code" }, { status: 400 });
  }

  const phone = combinePhone(phoneCountryCode, phoneNumber);
  const service = createServiceClient();

  const { data: row, error } = await service
    .from("customer_phone_verifications")
    .select("id")
    .eq("organization_id", check.result.organizationId)
    .eq("phone", phone)
    .eq("code", code)
    .is("verified_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Incorrect or expired code" }, { status: 400 });

  const { error: updateError } = await service
    .from("customer_phone_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", row.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
