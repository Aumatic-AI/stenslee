// SERVER-ONLY — loads an org's WhatsApp connection (decrypting the stored
// token) for use by the templates/send/connect API routes.
import { createServiceClient } from "@/lib/supabase-server";
import { decryptToken } from "@/lib/whatsapp/crypto";

export interface OrgWhatsAppConfig {
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
}

export async function getOrgWhatsAppConfig(organizationId: string): Promise<OrgWhatsAppConfig | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("organizations")
    .select("whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_access_token_enc")
    .eq("id", organizationId)
    .maybeSingle();

  if (!data?.whatsapp_waba_id || !data.whatsapp_phone_number_id || !data.whatsapp_access_token_enc) {
    return null;
  }

  return {
    wabaId: data.whatsapp_waba_id,
    phoneNumberId: data.whatsapp_phone_number_id,
    accessToken: decryptToken(data.whatsapp_access_token_enc),
  };
}
