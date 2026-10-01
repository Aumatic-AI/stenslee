import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/permissions/require-feature";

// GET /api/whatsapp/send/status?wamids=a,b,c — lightweight poll the Send
// Result screen calls every few seconds so Sent -> Delivered -> Read shows
// up without us building out Realtime just for this. Scoped to the caller's
// own org via requireFeature, same as every other route here.
export async function GET(req: NextRequest) {
  const check = await requireFeature("whatsapp");
  if (!check.ok) return check.response;

  const wamids = (req.nextUrl.searchParams.get("wamids") ?? "").split(",").filter(Boolean);
  if (wamids.length === 0) return NextResponse.json({ statuses: [] });

  const service = createServiceClient();
  const { data, error } = await service
    .from("whatsapp_sends")
    .select("wamid, status, error_reason")
    .eq("organization_id", check.result.organizationId)
    .in("wamid", wamids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ statuses: data });
}
