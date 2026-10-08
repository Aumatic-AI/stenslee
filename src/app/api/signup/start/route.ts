import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { isValidPhone, combinePhone } from "@/lib/phone";
import { ALREADY_IN_STUDIO, isValidEmail, phoneDigits } from "@/lib/signup";
import { findStaffByPhone, type StaffByPhone } from "@/lib/staff-phone";

const MAX_NAME_LENGTH = 80;

// POST /api/signup/start — saves a new studio's details so the SMS hook will send this number a code.
export async function POST(req: NextRequest) {
  const { studioName, name, email, phoneCountryCode, phoneNumber } = await req.json().catch(() => ({}));
  const cleanStudio = typeof studioName === "string" ? studioName.trim() : "";
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!cleanStudio || !cleanName || !isValidPhone(phoneCountryCode, phoneNumber)) {
    return NextResponse.json({ error: "Studio name, your name and a valid mobile number are required." }, { status: 400 });
  }
  if (!isValidEmail(cleanEmail)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (cleanStudio.length > MAX_NAME_LENGTH || cleanName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: `Names can be at most ${MAX_NAME_LENGTH} characters.` }, { status: 400 });
  }

  const service = createServiceClient();
  const phone = combinePhone(phoneCountryCode, phoneNumber);

  let existing: StaffByPhone | null;
  try {
    existing = await findStaffByPhone(service, phone);
  } catch {
    return NextResponse.json({ error: "Couldn't check this number. Please try again." }, { status: 500 });
  }
  if (existing?.is_active && !existing.deleted_at) {
    return NextResponse.json({ error: ALREADY_IN_STUDIO, code: "already_registered" }, { status: 409 });
  }
  if (existing) {
    return NextResponse.json(
      { error: "This number was used with a studio on Stenslee before, so it can't create a new studio. Please use a different number.", code: "number_unavailable" },
      { status: 409 }
    );
  }

  const { error } = await service.from("signup_requests").upsert({
    phone: phoneDigits(phone),
    phone_country_code: phoneCountryCode,
    phone_number: phoneNumber,
    studio_name: cleanStudio,
    name: cleanName,
    email: cleanEmail,
    created_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: "Couldn't start signup. Please try again." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
