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

async function graphFetch(path: string, init: RequestInit & { accessToken: string }) {
  const { accessToken, headers, ...rest } = init;
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...rest,
    headers: { ...headers, Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => null);
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
    const message = body?.error?.message || "Failed to exchange Embedded Signup code for a token";
    throw new GraphApiError(message, res.status, body);
  }
  return body.access_token as string;
}

// Wires this WABA's events (message status updates) to our app's webhook —
// without this call, Meta never sends us anything for that WABA even though
// our app-level Webhooks config is already set up.
export async function subscribeWabaWebhook(wabaId: string, accessToken: string) {
  return graphFetch(`/${wabaId}/subscribed_apps`, { method: "POST", accessToken });
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
  bodyParameters: string[]
): Promise<SendTemplateResult> {
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
        ...(bodyParameters.length > 0
          ? { components: [{ type: "body", parameters: bodyParameters.map((text) => ({ type: "text", text })) }] }
          : {}),
      },
    }),
  });
}
