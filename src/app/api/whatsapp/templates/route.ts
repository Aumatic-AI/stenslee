import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/permissions/require-feature";
import { getOrgWhatsAppConfig } from "@/lib/whatsapp/org-config";
import { listTemplates, createTemplate, GraphApiError } from "@/lib/whatsapp/graph";

async function requireAdminOrg() {
  const check = await requireFeature("whatsapp");
  if (!check.ok) return { ok: false as const, response: check.response };

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user!.id).maybeSingle();
  if (requester?.role !== "admin") {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, organizationId: check.result.organizationId as string, service };
}

// GET /api/whatsapp/templates — refreshes from Meta (source of truth for
// status) and upserts the local cache, then returns the cache. Keeps the
// Templates screen accurate without the frontend ever touching Meta directly.
export async function GET() {
  const auth = await requireAdminOrg();
  if (!auth.ok) return auth.response;

  const config = await getOrgWhatsAppConfig(auth.organizationId);
  if (!config) return NextResponse.json({ error: "WhatsApp is not connected yet" }, { status: 400 });

  try {
    const metaTemplates = await listTemplates(config.wabaId, config.accessToken);

    for (const t of metaTemplates) {
      await auth.service.from("whatsapp_templates").upsert(
        {
          organization_id: auth.organizationId,
          meta_template_id: t.id,
          name: t.name,
          category: t.category,
          language: t.language,
          status: t.status,
          components: t.components,
        },
        { onConflict: "organization_id,name,language" }
      );
    }

    const { data, error } = await auth.service
      .from("whatsapp_templates")
      .select("id, name, category, language, status, components, created_at")
      .eq("organization_id", auth.organizationId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ templates: data });
  } catch (err) {
    if (err instanceof GraphApiError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
  }
}

// Turns "Hi {{1}}, your appointment is on {{2}}." into Meta's component
// shape, auto-filling the "example" Meta requires for any template that
// uses variables (without one, template creation is rejected outright).
function buildBodyComponent(bodyText: string) {
  const variableCount = new Set(Array.from(bodyText.matchAll(/{{\s*(\d+)\s*}}/g)).map((m) => m[1])).size;
  if (variableCount === 0) return { type: "BODY", text: bodyText };
  return {
    type: "BODY",
    text: bodyText,
    example: { body_text: [Array.from({ length: variableCount }, (_, i) => `Sample ${i + 1}`)] },
  };
}

// POST /api/whatsapp/templates — body: { name, category, language, bodyText }
export async function POST(req: NextRequest) {
  const auth = await requireAdminOrg();
  if (!auth.ok) return auth.response;

  const config = await getOrgWhatsAppConfig(auth.organizationId);
  if (!config) return NextResponse.json({ error: "WhatsApp is not connected yet" }, { status: 400 });

  const { name, category, language, bodyText } = await req.json();
  if (!name?.trim() || !category || !language || !bodyText?.trim()) {
    return NextResponse.json({ error: "name, category, language and bodyText are required" }, { status: 400 });
  }
  if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) {
    return NextResponse.json({ error: "category must be MARKETING, UTILITY or AUTHENTICATION" }, { status: 400 });
  }

  const components = [buildBodyComponent(bodyText.trim())];
  const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");

  try {
    const created = await createTemplate(config.wabaId, config.accessToken, {
      name: normalizedName,
      category,
      language,
      components,
    });

    const { data, error } = await auth.service
      .from("whatsapp_templates")
      .insert({
        organization_id: auth.organizationId,
        meta_template_id: created.id,
        name: normalizedName,
        category,
        language,
        status: created.status ?? "PENDING",
        components,
      })
      .select("id, name, category, language, status, components, created_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ template: data }, { status: 201 });
  } catch (err) {
    if (err instanceof GraphApiError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}
