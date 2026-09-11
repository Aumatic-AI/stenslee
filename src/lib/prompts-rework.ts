// ============================================================
// CLEOPATRA INK STUDIO — Rework (Cover-Up / Extend) Prompts
// Separate from prompts.ts on purpose: this is a photo-edit operation on an
// existing photo, not a from-scratch flat design on a white background —
// different job, different constraints, kept isolated so neither prompt
// has to carry the other's assumptions.
// ============================================================

export interface ReworkOptions {
  description: string;
  mode: "cover" | "extend";
  /** Set when this is a chat edit turn on a prior rework result, not the first generation. */
  editInstruction?: string;
}

const MODE_INSTRUCTIONS: Record<ReworkOptions["mode"], string> = {
  cover: "Fully replace the existing tattoo with the new design — none of the old ink should remain visible.",
  extend: "Keep the existing tattoo visible and build the new artwork around and with it, so old and new ink read as one continuous piece.",
};

export function buildReworkPrompt(opts: ReworkOptions): string {
  const { description, mode, editInstruction } = opts;

  // Edit turns get a short, single-focus instruction on purpose — a long list
  // of simultaneous DO/DON'T constraints measurably made the model worse at
  // following the one thing that actually mattered (e.g. asking to add red
  // ink while also being told "black & grey only" a few lines down). A
  // terse instruction close to how a person would actually phrase it, on
  // the actual photo, is what the equivalent image-edit tools do well with.
  if (editInstruction) {
    return `Image 1 is a photo of a real tattoo on skin. ${editInstruction.trim()} Keep everything else in the photo — the skin, body part, angle, lighting, and background — exactly as it is.`;
  }

  return `
You are a professional tattoo artist retouching a real photo of a customer's existing tattoo. Image 1 is a photo of skin with an existing tattoo on it.

${MODE_INSTRUCTIONS[mode]}

New tattoo idea: ${description.trim()}

Keep the same skin, body part, angle, lighting, and photo framing as Image 1 — only the tattoo ink changes. Make the result look like a real, freshly-tattooed photograph, with ink that follows the body's contours, not a flat illustration or a copy-pasted overlay. Do not add a white background, canvas, or paper — this is a photo of skin. Do not add captions, labels, or watermarks.
`.trim();
}
