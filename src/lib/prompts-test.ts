// ============================================================
// CLEOPATRA INK STUDIO — Placement Prompts (minimal test version)
// Same lesson learned in prompts-rework.ts: long constraint lists and
// ALL-CAPS "critical" blocks measurably made results worse — a short,
// direct instruction got better fidelity from the image model. This file
// applies that same idea to body-placement composites, as a side-by-side
// test against the full-length versions in prompts.ts.
// ============================================================

export type SurfaceType = "flat" | "face" | "hand";

export function classifySurface(targetBodyArea: string): SurfaceType {
  const a = (targetBodyArea || "").toLowerCase();
  if (/face|nose|cheek|forehead|chin|jaw|temple|eyelid|ear/.test(a)) return "face";
  if (/hand|finger|knuckle|palm|thumb/.test(a)) return "hand";
  return "flat";
}

// ── Standard mode — no composite editor, just the design (+ optional body photo) ──
export function buildPlacementPrompt(placementDescription: string, hasBodyPhoto: boolean): string {
  const where = placementDescription.trim() || "the most fitting visible spot";
  return hasBodyPhoto
    ? `Image 1 is a tattoo design on a white background — treat white as transparent. Image 2 is a photo of a person. Realistically tattoo this design onto their ${where}, following the skin's natural curves and lighting.`
    : `Image 1 is a tattoo design on a white background — treat white as transparent. Generate a realistic photo of a person with this tattooed on their ${where}.`;
}

// ── Composite mode — flat body parts (arm, back, chest, leg, etc.) ──
export function buildCompositePrompt(): string {
  return `Image 1 is a body photo with a tattoo design roughly overlaid at the intended spot and size. Image 2 is the clean tattoo design. Image 3 is the original body photo. Render a realistic photo of the tattoo naturally inked onto the skin at that exact spot — same pose, background, and crop as Image 3.`;
}

// ── Composite mode — hand or face (needs to wrap curves/creases) ──
export function buildCompositePromptForComplexAnatomy(surface: "face" | "hand"): string {
  return `Image 1 is a ${surface} photo with a tattoo design roughly overlaid at the intended spot and size. Image 2 is the clean tattoo design. Image 3 is the original ${surface} photo. Render a realistic photo of the tattoo naturally inked onto the skin at that exact spot, wrapped around the ${surface}'s natural curves — same pose, background, and crop as Image 3.`;
}
