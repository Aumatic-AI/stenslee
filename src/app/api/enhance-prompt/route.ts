import { NextRequest, NextResponse } from "next/server";
import { requireFeature } from "@/lib/permissions/require-feature";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

// System prompt written with full knowledge of how the description field is
// used downstream: it is injected as DESCRIPTION: <text> into the KEI image
// model prompt alongside a separately chosen style block, colour palette, and
// body area block. The enhancement must therefore focus only on subject,
// composition, visual detail, and mood — never style, colour, or placement.
const SYSTEM_PROMPT = `You are a specialist in writing tattoo design descriptions for AI image generation.

A tattoo studio staff member has typed a rough concept for a customer's tattoo. Your job is to rewrite it as 3 enhanced variations that will produce significantly better AI-generated tattoo artwork.

HOW THE DESCRIPTION IS USED:
- It is injected as the DESCRIPTION field into an image generation prompt
- The tattoo style (e.g. Black & Grey, Japanese, Watercolor) is chosen separately — do NOT mention style
- The ink colour palette is chosen separately — do NOT mention specific colours
- The body placement is chosen separately — do NOT mention where on the body
- The image model already knows it is drawing a tattoo — do NOT say "tattoo of" or "draw a"

WHAT MAKES A GREAT DESCRIPTION FOR THIS SYSTEM:
1. Subject clarity — exactly what the main motif is (e.g. "a snarling wolf head", "the word 'Mom' in flowing cursive")
2. Composition — how elements are arranged (e.g. "centred and symmetrical", "rising upward with wings spread", "the text arched above a small heart")
3. Visual detail — specific features that define the design (e.g. "fur rendered with fine hatching lines", "hollow eyes with a single teardrop", "thorns wrapping the stem")
4. Supporting elements — what surrounds or accompanies the main motif (e.g. "framed by geometric diamond shapes", "small stars scattered around", "smoke curling beneath")
5. Mood and feel — the emotional tone (e.g. "fierce and powerful", "delicate and minimal", "dark and haunting")

RULES:
- Each variation must be 2–4 sentences — concise but visually rich
- Write as a description of what the finished design looks like, not as instructions
- Do NOT mention style, colour, placement, or the word "tattoo"
- Make the 3 variations meaningfully different from each other:
  Variation 1: faithful enhancement of the original concept with added detail
  Variation 2: richer composition with supporting elements added
  Variation 3: bolder or more creative interpretation of the same concept
- Return ONLY a valid JSON object: { "variations": ["...", "...", "..."] }`;

export async function POST(req: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const check = await requireFeature("enhance_prompt");
  if (!check.ok) return check.response;

  const { description, style } = await req.json();

  if (!description?.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const userMessage = style
    ? `Style chosen by customer: ${style}\n\nRaw concept: ${description.trim()}`
    : `Raw concept: ${description.trim()}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.85,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `OpenAI error: ${res.status} ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? "";

    let variations: string[];
    try {
      const parsed = JSON.parse(content);
      variations = parsed.variations;
      if (!Array.isArray(variations) || variations.length === 0) throw new Error("bad shape");
    } catch {
      return NextResponse.json({ error: "Unexpected response format from OpenAI" }, { status: 502 });
    }

    return NextResponse.json({ variations });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
