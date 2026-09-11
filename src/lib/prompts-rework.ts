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
  style?: string;
  colorHexes?: string[];
  /** Set when this is a chat edit turn on a prior rework result, not the first generation. */
  editInstruction?: string;
}

function buildStyleClause(style?: string): string {
  return style?.trim() ? `Render the new artwork in a ${style.trim()} style.` : "";
}

function buildColorClause(colorHexes: string[] = []): string {
  if (colorHexes.length === 0) return "Use black & grey ink only — no color fills.";
  return `Use ONLY these ink colors for the new artwork: ${colorHexes.join(", ")}.`;
}

const MODE_INSTRUCTIONS: Record<ReworkOptions["mode"], string> = {
  cover: "COVER-UP: Fully replace the existing tattoo with the new design. None of the old ink should remain visible — the new artwork must completely conceal it through its own linework, shading, and density.",
  extend: "EXTEND: Keep the existing tattoo visible and build the new artwork around and with it, so the old and new ink read as one continuous, intentional piece.",
};

export function buildReworkPrompt(opts: ReworkOptions): string {
  const { description, mode, style, colorHexes = [], editInstruction } = opts;

  const task = editInstruction
    ? `Apply this change to the tattoo photo: "${editInstruction.trim()}"`
    : `New tattoo idea: ${description.trim()}`;

  return `
You are a professional tattoo artist retouching a real photo of a customer's existing tattoo. Image 1 is a photo of skin with an existing tattoo on it.

${MODE_INSTRUCTIONS[mode]}

${task}

${buildStyleClause(style)}
${buildColorClause(colorHexes)}

DO:
- Keep the same skin, body part, angle, lighting, and photo framing as Image 1 — only the tattoo ink changes.
- Make the result look like a real, freshly-tattooed photograph, not a flat illustration or a copy-pasted overlay.
- Match how ink actually sits on skin: it follows body contours, curves, and creases.

DO NOT:
- Do not change the person's skin tone, body shape, camera angle, or background.
- Do not add a white background, canvas, or paper — this is a photo of skin, not a flat design.
- Do not caption, label, or add any text/watermarks to the image.

OUTPUT: One photorealistic photo, same framing as Image 1, showing only the tattoo ink changed.
`.trim();
}
