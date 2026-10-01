import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createServiceClient } from "@/lib/supabase-server";

// GET — Meta's one-time webhook verification handshake when you save the
// callback URL in the App Dashboard.
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

function isValidSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", process.env.META_APP_SECRET!).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

interface StatusEntry {
  id: string;
  status: string;
  recipient_id?: string;
}

// POST — the only field we're subscribed to is `messages`. Coexistence
// delivers both message status updates (statuses[]) AND the customer's
// inbound replies (messages[]) on this same field, since the phone app and
// Cloud API share one account. We only ever read `statuses` — any inbound
// `messages[]` entry is intentionally ignored and never persisted (see
// TEMP_WHATSAPP.md section 1: no inbox, no message history in our app).
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!isValidSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const service = createServiceClient();

  const statuses: StatusEntry[] = (payload?.entry ?? [])
    .flatMap((entry: { changes?: Array<{ field: string; value?: { statuses?: StatusEntry[] } }> }) => entry.changes ?? [])
    .filter((change: { field: string }) => change.field === "messages")
    .flatMap((change: { value?: { statuses?: StatusEntry[] } }) => change.value?.statuses ?? []);

  for (const s of statuses) {
    await service
      .from("whatsapp_sends")
      .update({ status: s.status, error_reason: s.status === "failed" ? "Delivery failed — see Meta dashboard for detail" : null })
      .eq("wamid", s.id);
  }

  // Meta requires a fast 200 regardless of content, or it retries/backs off.
  return NextResponse.json({ ok: true });
}
