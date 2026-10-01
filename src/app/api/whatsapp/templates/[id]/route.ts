import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/permissions/require-feature";
import { getOrgWhatsAppConfig } from "@/lib/whatsapp/org-config";
import { deleteTemplate, GraphApiError } from "@/lib/whatsapp/graph";

// DELETE /api/whatsapp/templates/:id — :id is our local row id, but Meta's
// delete endpoint only takes a template `name` (and removes every language
// variant of that name at once) -- so we look up the name first, delete on
// Meta, then clear every local row sharing it.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireFeature("whatsapp");
  if (!check.ok) return check.response;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user!.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const organizationId = check.result.organizationId as string;
  const { id } = await params;

  const { data: row } = await service
    .from("whatsapp_templates")
    .select("name")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const config = await getOrgWhatsAppConfig(organizationId);
  if (!config) return NextResponse.json({ error: "WhatsApp is not connected yet" }, { status: 400 });

  try {
    await deleteTemplate(config.wabaId, config.accessToken, row.name);
  } catch (err) {
    if (err instanceof GraphApiError) return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json({ error: "Failed to delete template on Meta" }, { status: 500 });
  }

  const { error } = await service
    .from("whatsapp_templates")
    .delete()
    .eq("organization_id", organizationId)
    .eq("name", row.name);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
