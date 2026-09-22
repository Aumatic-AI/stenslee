// ============================================================
// CLEOPATRA INK STUDIO — Rework (Cover-Up / Extend) Prompts
// Kept deliberately minimal: over-specifying constraints (mode explanations,
// DO/DON'T lists, "don't add a white background" type lines) measurably
// made results worse — the model followed a short, direct instruction on
// the actual photo far better than a long list of simultaneous rules.
// ============================================================

export interface ReworkOptions {
  description: string;
  mode: "cover" | "extend";
  /** Set when this is a chat edit turn on a prior rework result, not the first generation. */
  editInstruction?: string;
  /** How many images are actually being sent as input_urls — 1 for the first
   *  generation (just the source photo), or however many were selected for
   *  an edit turn. Must match the real count, since that's exactly how many
   *  images the model receives. */
  imageCount?: number;
}

function imageReference(count: number): string {
  return count > 1 ? `Images 1-${count}` : "Image 1";
}

export function buildReworkPrompt(opts: ReworkOptions): string {
  const { description, mode, editInstruction, imageCount = 1 } = opts;

  if (editInstruction) {
    const trimmed = editInstruction.trim();
    // No "you are a tattoo artist / this is a photo of..." framing here — on
    // a single reference image, that framing measurably pushed the model
    // toward redrawing the whole thing as tattoo-flash-style line art instead
    // of making a small photo edit. The user's own side-by-side test against
    // ChatGPT/Gemini showed the bare instruction, with nothing else added,
    // is what gets a clean in-place edit. Only add a reference note when
    // there's real ambiguity about which image(s) the instruction means.
    return imageCount > 1 ? `${imageReference(imageCount)} show the existing tattoo. ${trimmed}` : trimmed;
  }

  const action = mode === "cover" ? "cover up" : "extend";
  return `You are a tattoo artist. Image 1 is a photo of an existing tattoo. ${action} it: ${description.trim()}`;
}
