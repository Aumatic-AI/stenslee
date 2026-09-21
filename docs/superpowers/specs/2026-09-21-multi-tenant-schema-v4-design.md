# Stenslee Multi-Tenant Schema v4 — Design Spec

Status: approved (chat), pending implementation plan
Scope: **database schema only.** Application code rewiring (feature gating,
`src/features/<key>/` folder moves, Super Admin panel UI) is an explicit
follow-up, not covered here.

## Context

Cleopatra Ink Studio is being rebuilt as **Stenslee**, a multi-tenant SaaS
version of the same in-shop tattoo design tool — one studio per
`organizations` row instead of a single hard-coded studio. Full context:

- `AGENTS.md` (repo root) — current single-tenant architecture
- `docs/PROJECT_SCOPE.md` — current feature list, plain language
- `REBUILD_HANDOFF.md` (repo root, will be superseded by this spec + the plan)
- Rebuild Roadmap artifact (external, referenced in the handoff) — original
  source for the new schema; **this spec overrides it** on the one point
  where they disagree (seat counters, below)

The target Supabase project (`pmcunzmdftksnxswmzsi`) is **completely empty**
— no tables, no data. This is a from-scratch `CREATE`, not a live migration:
there is no "backfill a default org onto existing rows" step, because there
are no existing rows. `supabase-schema.sql` gets replaced outright with a v4
that is correct from the start.

## Decisions locked in this session

- **No cached seat counters.** `organizations` does **not** get
  `designer_seats_used`/`admin_seats_used` columns (the Rebuild Roadmap
  artifact's ER diagram still shows them — that page is stale on this
  point). Seat-limit checks run live:
  `count(*) from staff where organization_id = $1 and role = $2 and is_active and deleted_at is null`,
  backed by a partial index `staff(organization_id, role) where deleted_at is null and is_active`.
- **No data migration.** New project starts empty; nothing to import from
  the old single-tenant database.
- **This plan is schema-only.** `requireFeature()`/`useFeature()` wiring,
  `src/features/<key>/` folder moves, and the Super Admin panel are a
  separate follow-up plan, written after each affected app file is read in
  full.

## Target schema

### New tables

| Table | Purpose | Key columns |
|---|---|---|
| `platform_admins` | Your team (Super Admins) — not tenant-scoped, separate from `staff` | `id`, `email`, `name`, `is_active` |
| `plans` | Subscription tiers | `id`, `name`, `description`, `price_cents`, `billing_interval` (`month`\|`year`), `is_active` |
| `plan_features` | Default grid: (plan, feature_key) → enabled, limit | PK `(plan_id, feature_key)`, `enabled`, `limit_value`, `updated_by` → `platform_admins` |
| `organizations` | One row per studio (tenant) | `id`, `name`, `slug`, `plan_id` → `plans`, `status` |
| `organization_feature_overrides` | Per-org exceptions to the plan default — always wins when present | PK `(organization_id, feature_key)`, `enabled`, `limit_value`, `updated_by` → `platform_admins` |
| `usage_logs` | One row per action — audit trail + limit counter | `id`, `organization_id`, `staff_id`, `session_id`, `feature_key`, `action`, `target_id`, `metadata` (jsonb), `created_at` (no `updated_at` — append-only) |

`plan_features` / `organization_feature_overrides` use a composite primary
key that is also the foreign key — no surrogate `id`.

### Renamed / restructured existing tables

- **`users` → `customers`**, `first_name` → `name` (no `last_name` ever
  existed).
- **`staff`**: `last_login` → `last_login_at`; gains `organization_id` →
  `organizations`, `updated_at`.
- **`sessions`**: gains `organization_id`, `updated_at`; `user_id` →
  `customer_id`, `designer_id` → `staff_id` (role-neutral name — an admin's
  own session still sets it); `tattoo_style`/`tattoo_description`/
  `target_body_area` → `style`/`description`/`body_area`. Gains
  `selected_design_url`, `selected_design_style`, `flash_image_url`,
  `placement_text`, `placement_body_photo_url`, `placement_composite_url`.
- **`chat_messages`**: gains `organization_id`, `updated_at`; drops
  `design_ids[]` (no table left for it to point to) — `image_urls[]` stays
  as the only array.

### Removed entirely

- **`tattoo_designs`**, **`placements`** — folded onto `sessions`
  (`selected_design_*`, `placement_*`). A session only ever has one
  finalized design and one current placement — a 1-to-1 fact, not a table
  of many rows. Every AI-generated candidate already lives in
  `chat_messages.image_urls[]`; `sessions.status = 'completed'` is what
  marks both as final. Cost accepted: per-candidate metadata (style/
  iteration of designs not picked) is no longer queryable — nothing today
  reads it.
- **`user_preferences`** — decided not needed.

### RPCs

- `finalize_session` / `finalize_rework_session` collapse into a single
  simplified function: `update sessions set status = 'completed', completed_at = now() where id = $1`.
  No design/placement IDs to pass in anymore — they're already set on
  `sessions` the moment they're chosen, not at finalize time. The old
  `user_preferences` analytics side-effect is dropped along with the table.
- `get_staff_role()`, `is_admin()`, `is_designer()` — same shape as today,
  but every check now implicitly resolves the caller's `staff.organization_id`
  for use in RLS policies (see below).
- `search_customers(q)` — same behavior, updated for the `customers` table
  name and `name` column.

### Permission engine

- `getEffectiveAccess(org_id, feature_key)` — server-side SQL function.
  Checks `organization_feature_overrides` first; falls back to
  `plan_features` for the org's `plan_id`. For a limit-type key, also counts
  `usage_logs` for the current period using the
  `(organization_id, feature_key, created_at)` composite index — the index
  the whole permission system's performance rides on. Returns whatever
  shape (enabled boolean + remaining/limit) the follow-up app-code plan
  needs to consume; exact return type decided when that plan is written.
- This schema plan creates the function and its supporting tables/indexes
  only. Wiring it into API routes (`requireFeature()`) and the UI
  (`useFeature()`) is out of scope here — every feature key defaults to
  fully enabled at the database level until the follow-up plan gates them.

### RLS

- Every tenant-scoped table (`staff`, `customers`, `sessions`,
  `chat_messages`, `usage_logs`, `organization_feature_overrides`) gets
  policies scoped by the caller's `organization_id` (via `staff` lookup),
  replacing today's role-only checks.
- `platform_admins` and `plans`/`plan_features` are not tenant-scoped —
  gated by platform-admin identity, not `organization_id`.
- **Carried over unchanged, not fixed here:** `storage.objects`'s existing
  insert policy checks role only (admin/designer), not session/org
  ownership. This is a pre-existing gap, not introduced by this migration,
  and the Rebuild Roadmap's Phase 1 checklist doesn't call for closing it.
  Left as-is; flag if this should change.

### Indexes

- Every `organization_id` column, indexed.
- `usage_logs(organization_id, feature_key, created_at)` — composite,
  supports the per-period usage count on every limited action.
- `staff(organization_id, role) where deleted_at is null and is_active` —
  partial index backing live seat-limit counts.
- Existing indexes on `sessions`/`chat_messages` carry over under their new
  column names (`deleted_at` partial index, `status`, `created_at`, etc.).

### Aggregate views

- `designer_session_counts`, `customer_session_stats` — same shape as
  today, updated for renamed columns (`staff_id`, `customer_id`) and,
  if useful, scoped by `organization_id`.

### Storage

- Buckets (`session-assets`, `reference-images`) and their config are
  unchanged by this plan.

## Out of scope (separate follow-up plan)

- `requireFeature()` (server) / `useFeature()` (client) implementation and
  wiring into every API route + UI component.
- `src/features/<key>/` folder restructuring (Phase 3 of the Rebuild
  Roadmap's build order).
- Super Admin panel (Phase 4): All Clients, Client Detail, Plans, Platform
  Usage screens.
- Catalog / WhatsApp Marketing features (Phase 5, deferred).
- Rewiring `src/store/app-store.ts` (`persistDesigns`/`persistPlacement`),
  `chat`/`design`/`placement` pages, `flash-generation.ts`,
  `PreviousDesignsModal.tsx` — all listed in `REBUILD_HANDOFF.md`'s
  "Application code known to need rewiring" section.

## Success criteria

- `supabase-schema.sql` v4 fully replaces v3, applies cleanly to the empty
  new Supabase project with no errors.
- Every table, column, rename, and removal above is present and matches.
- `getEffectiveAccess()` returns a sane result for a manually-inserted
  test org/plan/feature-key combination, including an override that
  correctly beats the plan default.
- RLS: a staff row in org A cannot select/insert/update a row belonging to
  org B, verified by test queries under two different staff identities.
- No leftover references anywhere in the SQL file to `tattoo_designs`,
  `placements`, `user_preferences`, or the old column names.
