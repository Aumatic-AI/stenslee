import { NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { ALREADY_IN_STUDIO, phoneDigits, signupCutoffIso, slugify } from "@/lib/signup";

type ServiceClient = ReturnType<typeof createServiceClient>;

// Inserts the org, adding a short random suffix if the slug is already taken.
async function createOrganization(
  service: ServiceClient,
  name: string,
  email: string | null,
  plan: { id: string; ai_credits_included: number } | null
) {
  const base = slugify(name) || "studio";
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await service
      .from("organizations")
      .insert({
        name,
        email,
        slug,
        plan_id: plan?.id ?? null,
        ...(plan ? { ai_credits_remaining: plan.ai_credits_included } : {}),
      })
      .select("id")
      .single();
    if (!error) return data.id as string;
    if (error.code !== "23505") throw error;
  }
  throw new Error("Couldn't find a free slug");
}

// POST /api/signup/complete — after the code is verified: creates the studio and makes this user its admin.
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.phone) return NextResponse.json({ error: "Please verify your number first." }, { status: 401 });

  const service = createServiceClient();
  const { data: request } = await service
    .from("signup_requests")
    .select("phone, phone_country_code, phone_number, studio_name, name, email")
    .eq("phone", phoneDigits(user.phone))
    .gte("created_at", signupCutoffIso())
    .maybeSingle();
  if (!request) return NextResponse.json({ error: "This signup has expired. Please start again." }, { status: 400 });

  const { data: existingStaff } = await service.from("staff").select("id").eq("id", user.id).maybeSingle();
  if (existingStaff) {
    return NextResponse.json({ error: ALREADY_IN_STUDIO, code: "already_registered" }, { status: 409 });
  }

  // New studios start on the free plan.
  const { data: plan } = await service
    .from("plans")
    .select("id, ai_credits_included")
    .eq("is_active", true)
    .eq("price_cents", 0)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let organizationId: string;
  try {
    organizationId = await createOrganization(service, request.studio_name, request.email, plan);
  } catch {
    return NextResponse.json({ error: "Couldn't create your studio. Please try again." }, { status: 500 });
  }

  const { error: staffError } = await service.from("staff").insert({
    id: user.id,
    organization_id: organizationId,
    name: request.name,
    role: "admin",
    is_active: true,
    phone_country_code: request.phone_country_code,
    phone_number: request.phone_number,
  });
  if (staffError) {
    await service.from("organizations").delete().eq("id", organizationId);
    return NextResponse.json({ error: "Couldn't create your studio. Please try again." }, { status: 500 });
  }

  await service.from("signup_requests").delete().eq("phone", request.phone);
  return NextResponse.json({ ok: true });
}
