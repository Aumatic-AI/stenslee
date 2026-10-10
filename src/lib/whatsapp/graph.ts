// SERVER-ONLY — thin wrapper around the Meta Graph API calls this feature
// needs. No SDK: these are all plain REST calls, and the surface area is
// small enough that a dependency would cost more than it saves.
const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v26.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class GraphApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

// Logs only the start and end of a token so logs never hold the full secret.
export function maskToken(token: string): string {
  return `${token.slice(0, 8)}…${token.slice(-4)} (${token.length} chars)`;
}

async function graphFetch(path: string, init: RequestInit & { accessToken: string }) {
  const { accessToken, headers, ...rest } = init;
  const method = rest.method ?? "GET";
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...rest,
    headers: { ...headers, Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => null);
  console.log(`[graph] ${method} ${path} -> ${res.status}`, JSON.stringify(body));
  if (!res.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message || `Graph API error (${res.status})`;
    throw new GraphApiError(message, res.status, body);
  }
  return body;
}

// Exchanges the one-time code Embedded Signup returns (via FB.login's
// authResponse) for a long-lived, non-expiring token scoped to the business
// the studio just connected. Uses the App's own id+secret, never the
// studio's — that's what tells Meta which Tech Provider app this token
// belongs to.
export async function exchangeCodeForToken(code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    code,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    console.error(`[graph] GET /oauth/access_token -> ${res.status} code exchange failed`, JSON.stringify(body));
    const message = body?.error?.message || "Failed to exchange Embedded Signup code for a token";
    throw new GraphApiError(message, res.status, body);
  }
  const { access_token, ...rest } = body;
  console.log(`[graph] GET /oauth/access_token -> ${res.status} token ${maskToken(access_token)}`, JSON.stringify(rest));
  return access_token as string;
}

// Wires this WABA's events (message status updates) to our app's webhook —
// without this call, Meta never sends us anything for that WABA even though
// our app-level Webhooks config is already set up.
export async function subscribeWabaWebhook(wabaId: string, accessToken: string) {
  return graphFetch(`/${wabaId}/subscribed_apps`, { method: "POST", accessToken });
}

// Embedded Signup does not activate the number for sending by itself --
// without this call, every send fails with error 133010 ("Phone number not
// registered"). `pin` is the number's existing 2-step-verification PIN if it
// has one, or any 6-digit PIN to set if it doesn't.
export async function registerPhoneNumber(phoneNumberId: string, accessToken: string, pin: string) {
  return graphFetch(`/${phoneNumberId}/register`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
}

// Coexistence's finish event only returns the WABA id, so the number is looked up here.
export async function listPhoneNumbers(
  wabaId: string,
  accessToken: string
): Promise<Array<{ id: string; display_phone_number: string }>> {
  const body = await graphFetch(`/${wabaId}/phone_numbers?fields=id,display_phone_number`, { method: "GET", accessToken });
  return body?.data ?? [];
}

// Coexistence: both syncs must be requested within 24h of onboarding or Meta disconnects the number.
export async function requestSmbAppSync(
  phoneNumberId: string,
  accessToken: string,
  syncType: "smb_app_state_sync" | "history"
) {
  return graphFetch(`/${phoneNumberId}/smb_app_data`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
  });
}

export interface WhatsAppTemplateComponent {
  type: string;
  text?: string;
  format?: string;
  parameters?: Array<{ type: string; text?: string }>;
}

export interface MetaTemplate {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  components: WhatsAppTemplateComponent[];
}

export async function listTemplates(wabaId: string, accessToken: string): Promise<MetaTemplate[]> {
  const body = await graphFetch(
    `/${wabaId}/message_templates?fields=id,name,category,language,status,components&limit=100`,
    { method: "GET", accessToken }
  );
  return (body?.data ?? []) as MetaTemplate[];
}

export async function createTemplate(
  wabaId: string,
  accessToken: string,
  template: { name: string; category: string; language: string; components: WhatsAppTemplateComponent[] }
): Promise<{ id: string; status: string; category: string }> {
  return graphFetch(`/${wabaId}/message_templates`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(template),
  });
}

export async function deleteTemplate(wabaId: string, accessToken: string, name: string) {
  return graphFetch(`/${wabaId}/message_templates?name=${encodeURIComponent(name)}`, {
    method: "DELETE",
    accessToken,
  });
}

export interface SendTemplateResult {
  messages: Array<{ id: string }>;
  contacts: Array<{ input: string; wa_id: string }>;
}

export async function sendTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  language: string,
  bodyParameters: string[],
  // Fills a template's URL-button placeholder (e.g. an Authentication
  // template's "Copy code" button has its own {{1}} inside the URL --
  // https://www.whatsapp.com/otp/code/?...&code={{1}} -- separate from the
  // body's {{1}}. Omitting this when the template has such a button causes
  // Meta error 131008, "Required parameter is missing".
  buttonUrlParameter?: string
): Promise<SendTemplateResult> {
  const components = [
    ...(bodyParameters.length > 0
      ? [{ type: "body", parameters: bodyParameters.map((text) => ({ type: "text", text })) }]
      : []),
    ...(buttonUrlParameter
      ? [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: buttonUrlParameter }] }]
      : []),
  ];
  return graphFetch(`/${phoneNumberId}/messages`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(components.length > 0 ? { components } : {}),
      },
    }),
  });
}

// Sends a login OTP via the platform's own WhatsApp number (WHATSAPP_AUTH_*
// env vars) -- separate from every org's own connected WABA, since login
// isn't scoped to a tenant. Used only by the Send SMS Hook route.
export async function sendAuthOtp(phone: string, code: string): Promise<SendTemplateResult> {
  const phoneNumberId = process.env.WHATSAPP_AUTH_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_AUTH_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_AUTH_TEMPLATE_NAME;
  // Must match the exact language variant chosen when the template was
  // created in WhatsApp Manager (e.g. "en" vs "en_US") -- a mismatch here is
  // Meta error 132001, "Template name does not exist in the translation".
  const language = process.env.WHATSAPP_AUTH_TEMPLATE_LANGUAGE || "en_US";
  if (!phoneNumberId || !accessToken || !templateName) {
    throw new Error("WHATSAPP_AUTH_PHONE_NUMBER_ID, WHATSAPP_AUTH_ACCESS_TOKEN and WHATSAPP_AUTH_TEMPLATE_NAME must all be set");
  }
  return sendTemplateMessage(phoneNumberId, accessToken, phone, templateName, language, [code], code);
}
