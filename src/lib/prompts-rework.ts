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
}

export function buildReworkPrompt(opts: ReworkOptions): string {
  const { description, mode, editInstruction } = opts;

  if (editInstruction) {
    return `You are a tattoo artist. Image 1 is a photo of an existing tattoo. ${editInstruction.trim()}`;
  }

  const action = mode === "cover" ? "cover up" : "extend";
  return `You are a tattoo artist. Image 1 is a photo of an existing tattoo. ${action} it: ${description.trim()}`;
}
