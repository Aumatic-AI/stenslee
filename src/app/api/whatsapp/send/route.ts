import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createServiceClient } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/permissions/require-feature";
import { getOrgWhatsAppConfig } from "@/lib/whatsapp/org-config";
import { sendTemplateMessage, GraphApiError } from "@/lib/whatsapp/graph";

interface SendResult {
  customerId: string;
  name: string;
  phone: string;
  ok: boolean;
  wamid: string | null;
  error: string | null;
}

// POST /api/whatsapp/send — body: { customerIds: string[], templateName,
// language, variables: string[] }. Loops customers one at a time (Meta has
// no batch-send endpoint) and logs every attempt to whatsapp_sends,
// success or failure, before returning the per-customer result list.
export async function POST(req: NextRequest) {
  const check = await requireFeature("whatsapp");
  if (!check.ok) return check.response;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const service = createServiceClient();
  const { data: requester } = await service.from("staff").select("role").eq("id", user!.id).maybeSingle();
  if (requester?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const organizationId = check.result.organizationId as string;
  const { customerIds, templateName, language, variables } = await req.json() as {
    customerIds: string[];
    templateName: string;
    language: string;
    variables: string[];
  };

  if (!Array.isArray(customerIds) || customerIds.length === 0 || !templateName?.trim() || !language?.trim()) {
    return NextResponse.json({ error: "customerIds, templateName and language are required" }, { status: 400 });
  }

  const config = await getOrgWhatsAppConfig(organizationId);
  if (!config) return NextResponse.json({ error: "WhatsApp is not connected yet" }, { status: 400 });

  const { data: customers, error: customersError } = await service
    .from("customers")
    .select("id, name, phone")
    .eq("organization_id", organizationId)
    .in("id", customerIds);
  if (customersError) return NextResponse.json({ error: customersError.message }, { status: 500 });

  const results: SendResult[] = [];

  for (const customer of customers ?? []) {
    const to = customer.phone.replace(/\D/g, "");
    let wamid: string | null = null;
    let ok = false;
    let errorMessage: string | null = null;

    if (!to) {
      errorMessage = "No usable phone number on file";
    } else {
      try {
        const sent = await sendTemplateMessage(config.phoneNumberId, config.accessToken, to, templateName, language, variables ?? []);
        wamid = sent.messages?.[0]?.id ?? null;
        ok = true;
      } catch (err) {
        errorMessage = err instanceof GraphApiError ? err.message : "Send failed";
      }
    }

    await service.from("whatsapp_sends").insert({
      organization_id: organizationId,
      customer_id: customer.id,
      sent_by: user!.id,
      template_name: templateName,
      to_phone: to || customer.phone,
      wamid,
      status: ok ? "accepted" : "failed",
      error_reason: errorMessage,
    });

    results.push({ customerId: customer.id, name: customer.name, phone: customer.phone, ok, wamid, error: errorMessage });
  }

  return NextResponse.json({ results });
}
