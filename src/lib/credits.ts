// SERVER-ONLY -- do not import from a "use client" file.
//
// AI generation credits: 10 per image, across every image-generating route
// (AI Design, Rework, Flash Isolate, Placement). The actual balance lives on
// organizations.ai_credits_remaining and is only ever touched through the
// reserve_ai_credits()/refund_ai_credits() Postgres functions below -- both
// are revoked from the anon/authenticated roles (see supabase-schema.sql),
// so a studio's own session has no path, direct or via RPC, to grant itself
// credits. Calling them requires the service-role client specifically.
import { createServiceClient } from "@/lib/supabase-server";

export const CREDITS_PER_IMAGE = 10;

// Atomically reserves credits for up to `requestedCount` images in one
// database round trip -- the check ("enough left?") and the spend happen as
// the same atomic step, so concurrent requests racing for the same balance
// can't double-spend it. Returns how many images the balance actually
// covers, from 0 up to requestedCount -- the caller shrinks its batch to
// this number instead of failing the whole request outright.
export async function reserveCredits(organizationId: string, requestedCount: number): Promise<number> {
  const service = createServiceClient();
  const { data, error } = await service.rpc("reserve_ai_credits", {
    p_organization_id: organizationId,
    p_requested_count: requestedCount,
  });
  if (error) {
    console.error("[credits] reserve_ai_credits failed:", error);
    return 0; // fail closed -- never let generation through unmetered
  }
  return data ?? 0;
}

// Gives back credits for images that were reserved but failed to generate
// (KEI error, timeout, or a failed download of an otherwise-successful
// result) -- a studio is only ever charged for a real, finished image.
export async function refundCredits(organizationId: string, imageCount: number): Promise<void> {
  if (imageCount <= 0) return;
  const service = createServiceClient();
  const { error } = await service.rpc("refund_ai_credits", {
    p_organization_id: organizationId,
    p_image_count: imageCount,
  });
  if (error) console.error("[credits] refund_ai_credits failed:", error);
}
