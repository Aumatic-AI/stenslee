# Cleopatra Ink Studio — Progress Tracker

_Last updated: 2026-06-05 (2)_

---

## Overall Status: **Core Platform Fully Functional**

Staff login, role-based access, customer management, session overview, streaming generation, style-accurate AI, A4 print/stencil studio, and body placement are all live and optimised.

---

## Completed

### Infrastructure & Auth
- [x] Next.js App Router + TypeScript strict mode
- [x] Supabase Auth (`@supabase/ssr`) — cookie-based staff sessions, 24hr timeout enforced in middleware
- [x] Role-based route protection: unauthenticated → login; designer blocked from `/studio/admin/*`
- [x] Zustand store with throttled localStorage persistence + Supabase hydration

### Database
- [x] `staff` table with `role`, `is_active`, `last_login`, `deleted_at` (soft-delete)
- [x] `sessions`, `tattoo_designs`, `placements`, `users`, `user_preferences` tables
- [x] RLS: admin sees all rows; designer sees only own sessions
- [x] `finalize_session` RPC — marks finalized rows, prunes siblings, marks session completed

### Staff Portal
- [x] `/studio/login` — email+password login, role-based redirect, password visibility toggle
- [x] `/studio/designer` — phone lookup (new/existing customer), recent 5 sessions
- [x] `/studio/admin` — stats, designer list with activate/deactivate, recent sessions
- [x] `/studio/admin/customers` — all customers, live search by name/phone
- [x] `/studio/admin/designers/[id]` — designer profile, stats, session history, password reset
- [x] `/studio/admin/designers/new` — create designer account
- [x] `/studio/admin/settings` — change admin password
- [x] Designer soft-delete — preserves staff row so historical attribution survives; blocks login
- [x] Designer password reset — admin-only; shown once, never persisted

### Session Flow
- [x] Design page — two modes: **AI Design** (style → generate → refine) and **Direct Upload**
- [x] Streaming generation — 5 KEI tasks in parallel; each streams as it completes; per-slot retry; proceed while generating
- [x] Refinement loop — customer feedback + selected variations → new generation
- [x] Refinement creativity toggle — "Creative Variation" (default) blends freely; "Minor Changes Only" (faithful mode) preserves the selected design and applies only the described changes
- [x] "Refined from" strip — source designs shown above refined results as large clickable thumbnails; opens full-screen lightbox with arrow navigation; cleared automatically on fresh generate
- [x] Text Tattoo mode toggle — switches model to `nano-banana-pro` and uses text-optimised prompt (font accuracy, letter spacing, text-object composition); works with both initial generation and refinement including faithful mode
- [x] Reference image mandatory — at least one required before Generate is enabled; Wikipedia fallback removed; API returns 400 without refs
- [x] Per-card download button — hover reveals down-arrow icon on each generated design; fetches image via proxy as blob and saves as PNG (bypasses cross-origin restriction on Supabase URLs)
- [x] Unselected card circle removed — empty selection indicator circle on unselected cards removed; gold numbered badge on selected cards retained
- [x] "Enhance with AI" — button appears inline with the description label when text is present; calls `/api/enhance-prompt` (GPT-4o-mini) and returns 3 enhanced variations; staff taps one to fill the textarea and edit freely before generating; panel auto-dismisses on new typing
- [x] Placement page — describe or upload body photo → drag/scale/rotate editor → AI composite
- [x] `SessionOverview` — shared read-only view (admin + designer): design, references, placement, download
- [x] `/customer/[userId]` — tattoo history with role-validated back navigation

### AI Prompts (`src/lib/prompts.ts`)
- [x] All prompt text in one file — no logic in route handlers or API clients
- [x] `STYLE_PROMPT_DESCRIPTORS` — 70+ styles mapped to linework, shading, color, composition, feel, subjects from studio definitions; injected via `buildStyleBlock()` for style-accurate output
- [x] `buildBodyAreaBlock()` — body area hint + strict "no anatomy in output" constraint
- [x] `inferCameraFrame()` — maps placement text to photographer framing when no body photo provided
- [x] Composite prompt locks size/position from editor; clean design sent for detail reference only
- [x] `buildFaithfulRefinementPrompt()` — "Minor Changes Only" mode: preserves all design elements, applies only the specific changes described
- [x] Placement prompts rewritten for photorealism — white background treated as transparent, ink-beneath-epidermis realism, skin texture over ink, lighting passes over tattoo, no sticker effect
- [x] Composite prompt position locking strengthened — hard constraint language with explicit failure condition for any deviation

### Style Selection
- [x] 70+ styles in searchable dropdown, organised by category (Black & Grey, Color, Traditional, Realism, Linework, Dotwork, Japanese, Modern, Blackwork, specialty)

### Placement Editor
- [x] Canvas drag/scale/rotate overlay — positions tattoo at exact size and angle
- [x] Composite preview shows full body without crop (`object-contain`, no forced aspect ratio)
- [x] Reference image remove button always visible (not hover-only), red

### Print / Stencil Studio
- [x] Full-screen A4 modal — drag to position, size slider (20–200%), rotation, mirror (default ON)
- [x] Multi-page A4 PDF — 1/2/4/8 sheets; auto-crops empty frame to ink; 2mm safe-area guide
- [x] WYSIWYG preview matches exported PDF

### Infrastructure
- [x] Pinterest reference images — uploaded to Supabase Storage immediately; blob swapped to permanent URL
- [x] Cron cleanup — deletes sessions older than 24hr + all storage files; runs every 30min
- [x] Insufficient-credits handling — non-retryable error with clear staff-facing message
- [x] `?from=` back navigation — role-validated; admin URLs stripped for designers

### Performance
- [x] Middleware parallelised — `getSession()` (cookie-local) + `Promise.all(getUser, staff query)` — saves ~200–400ms per navigation
- [x] Pages render instantly from localStorage — hydration runs in background; eliminates 1–2s blank screen
- [x] Reference image conversion parallelised — `Promise.all()` instead of sequential loop
- [x] localStorage writes throttled to one per 400ms — removes jank during streaming generation
- [x] Font preconnect — `<link rel="preconnect">` for Google Fonts in layout
- [x] `next/image` for all Supabase-hosted images — WebP, correct `sizes`, 1-year cache TTL
- [x] `computeStencilLayout` memoised in Print Studio — only recomputes when inputs change
- [x] Tattoo overlay style memoised in Placement Editor — no object recreation during 60fps drag
- [x] Colour luminance lookup precomputed at module load — no per-render `parseInt` in colour swatches

---

## Not Started / Remaining

- [ ] Line-art / stencil edge conversion (prints design as-is; no thresholding)
- [ ] SVG/vector export from print studio
- [ ] AR camera overlay (real-time body preview)
- [ ] Appointment booking integration

---

## Known Issues

- ~~KEI uses a Wikipedia placeholder when no reference images are provided~~ — **fixed**: reference image is now mandatory; Wikipedia fallback removed; API returns 400 if called without refs
- `finalize_session` RPC has a `user_preferences NOT NULL` edge case — fallback in store handles it silently
- Pinterest requires `PINTEREST_ACCESS_TOKEN` env var — silently unavailable if not set
- `OPENAI_API_KEY` required for the Enhance with AI feature — returns 500 if missing
- Cron cleanup requires `pg_cron` + `pg_net` enabled in Supabase Dashboard; cron block in `supabase-schema.sql` must be run manually after deploy
- Render free tier cold start is 30–60s — use an uptime pinger or upgrade to paid tier

---

## SQL Setup (Fresh Install)
1. Run `supabase-schema.sql` — creates all tables, RLS, functions, storage buckets, seeds admin
2. After deploying: uncomment and run the cron block at the bottom of `supabase-schema.sql`
