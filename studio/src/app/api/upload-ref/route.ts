import { NextRequest, NextResponse } from "next/server";
import { uploadBase64 } from "@/lib/storage";

// Uploads a base64-encoded image to Supabase Storage immediately.
// prefix: "refs" for reference images (Pinterest / file uploads)
//         "designs" for directly uploaded customer tattoo designs
export async function POST(req: NextRequest) {
  const { sessionId, image, prefix = "refs" } = await req.json();

  if (!sessionId || !image) {
    return NextResponse.json({ error: "sessionId and image are required" }, { status: 400 });
  }

  const allowedPrefixes = ["refs", "designs"];
  if (!allowedPrefixes.includes(prefix as string)) {
    return NextResponse.json({ error: "Invalid prefix" }, { status: 400 });
  }

  try {
    const url = await uploadBase64(image as string, sessionId as string, prefix as string);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
