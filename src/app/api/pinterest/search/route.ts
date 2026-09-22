import { NextRequest, NextResponse } from "next/server";
import { requireFeature } from "@/lib/permissions/require-feature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pinterest's official v5 API does not expose a global pin-search endpoint to
 * third-party apps. The endpoint below is the same JSON resource that
 * pinterest.com itself calls from the browser when a user searches — it
 * returns rich pin data without OAuth. We proxy it from the server so the
 * client never sees Pinterest URLs / headers directly and CORS is not in play.
 */
const PINTEREST_SEARCH_URL = "https://www.pinterest.com/resource/BaseSearchResource/get/";

type RawPinImage = {
  url?: string;
  width?: number;
  height?: number;
};

type RawPin = {
  id?: string;
  title?: string | null;
  grid_title?: string | null;
  description?: string | null;
  dominant_color?: string | null;
  link?: string | null;
  images?: Record<string, RawPinImage> | null;
  type?: string;
};

type NormalizedPin = {
  id: string;
  imageUrl: string;       // medium-resolution display image (564x is Pinterest's main thumb)
  fullImageUrl: string;   // original/largest
  width: number;
  height: number;
  title: string;
  description: string;
  dominantColor: string;
  sourceUrl: string;
};

function pickImage(images: RawPin["images"]): {
  display: string;
  full: string;
  width: number;
  height: number;
  dominant?: string;
} | null {
  if (!images) return null;
  // Pinterest typically returns: "60x60", "236x", "474x", "564x", "736x", "orig"
  const orig = images.orig ?? images["736x"] ?? images["564x"];
  const display = images["564x"] ?? images["474x"] ?? images["736x"] ?? images.orig ?? images["236x"];
  if (!display?.url) return null;
  return {
    display: display.url,
    full: orig?.url ?? display.url,
    width: display.width ?? 564,
    height: display.height ?? 564,
  };
}

function normalize(pin: RawPin): NormalizedPin | null {
  if (!pin?.id) return null;
  const img = pickImage(pin.images);
  if (!img) return null;
  return {
    id: pin.id,
    imageUrl: img.display,
    fullImageUrl: img.full,
    width: img.width,
    height: img.height,
    title: (pin.grid_title ?? pin.title ?? "").trim(),
    description: (pin.description ?? "").trim(),
    dominantColor: pin.dominant_color ?? "#1a1a1a",
    sourceUrl: pin.link ?? `https://www.pinterest.com/pin/${pin.id}/`,
  };
}

export async function GET(req: NextRequest) {
  const check = await requireFeature("pinterest_search");
  if (!check.ok) return check.response;

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const bookmark = req.nextUrl.searchParams.get("bookmark") ?? undefined;
  const pageSize = Math.min(Number(req.nextUrl.searchParams.get("pageSize") ?? "25"), 50);

  if (!q) {
    return NextResponse.json({ error: "query (q) is required" }, { status: 400 });
  }

  // Pinterest's internal endpoint takes `data` as a JSON-encoded query param.
  // `bookmarks` is how pagination is passed (an array, even for one bookmark).
  const data = {
    options: {
      query: q,
      scope: "pins",
      page_size: pageSize,
      ...(bookmark ? { bookmarks: [bookmark] } : {}),
    },
    context: {},
  };

  const source_url = `/search/pins/?q=${encodeURIComponent(q)}&rs=typed`;

  const url = new URL(PINTEREST_SEARCH_URL);
  url.searchParams.set("source_url", source_url);
  url.searchParams.set("data", JSON.stringify(data));
  url.searchParams.set("_", String(Date.now()));

  try {
    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        // Pinterest is sensitive about these — they identify the request as
        // coming from a real browser session rather than a bot.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `https://www.pinterest.com${source_url}`,
        "X-Pinterest-AppState": "active",
        "X-Pinterest-PWS-Handler": "www/search/[scope].js",
        "X-Pinterest-Source-Url": source_url,
        "X-Requested-With": "XMLHttpRequest",
        "X-APP-VERSION": "9d0e8d3",
      },
      // Don't cache server-side; results are query-dependent.
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Pinterest upstream returned ${upstream.status}` },
        { status: 502 }
      );
    }

    const payload = (await upstream.json()) as {
      resource_response?: {
        data?: { results?: RawPin[] } | RawPin[];
        bookmark?: string;
      };
    };

    const raw = payload.resource_response?.data;
    const rawResults: RawPin[] = Array.isArray(raw) ? raw : raw?.results ?? [];

    const pins = rawResults
      .filter((r) => r.type === "pin" || r.type === undefined)
      .map(normalize)
      .filter((p): p is NormalizedPin => p !== null);

    return NextResponse.json({
      pins,
      bookmark: payload.resource_response?.bookmark ?? null,
      query: q,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Pinterest fetch failed: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}
