// The full feature-key registry from the Permission Registry (Rebuild
// Roadmap artifact, section 03). Kept as one array so a Super Admin "create
// plan" screen (later, Phase 4) can always render every key without
// hand-typing any of them, and so getFeatureKind() below has one source of
// truth for which keys are pure toggles vs. limited.
export const FEATURE_KEYS = [
  "customer_management",
  "upload_existing",
  "browse_previous",
  "ai_design",
  "rework",
  "text_tattoo",
  "flash_isolate",
  "enhance_prompt",
  "pinterest_search",
  "camera_capture",
  "placement",
  "print_stencil",
  "designer_seats",
  "admin_seats",
  "admin_dashboard",
  "trash_retention",
  "storage_quota",
  "design_library",
  "library_file_size_limit",
  "catalog",
  "whatsapp",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

// Keys that can carry a limit_value (Toggle+Limit or pure Limit in the
// registry). Everything else is a pure Toggle. Not enforced anywhere in
// this plan -- available for the follow-up plan's UI (e.g. only showing a
// "limit" input in the Super Admin plan editor for these keys).
export const LIMITED_FEATURE_KEYS: readonly FeatureKey[] = [
  "ai_design",
  "rework",
  "flash_isolate",
  "enhance_prompt",
  "pinterest_search",
  "placement",
  "designer_seats",
  "admin_seats",
  "trash_retention",
  "storage_quota",
  "library_file_size_limit",
];

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}
