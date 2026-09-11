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
  const ref = imageReference(imageCount);

  if (editInstruction) {
    const subject = imageCount > 1 ? "show the existing tattoo" : "is a photo of the existing tattoo";
    return `You are a tattoo artist. ${ref} ${subject}. ${editInstruction.trim()}`;
  }

  const action = mode === "cover" ? "cover up" : "extend";
  return `You are a tattoo artist. ${ref} is a photo of an existing tattoo. ${action} it: ${description.trim()}`;
}
