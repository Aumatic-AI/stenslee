import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// Called once when the chat screen opens — returns the full transcript for a
// session so the UI can render it directly, instead of reconstructing "who
// said what" from tattoo_designs rows.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return Response.json({ error: "sessionId is required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, image_urls, design_ids, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ messages: data ?? [] });
}
