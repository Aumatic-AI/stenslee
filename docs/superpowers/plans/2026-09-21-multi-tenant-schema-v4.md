# Multi-Tenant Schema v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `supabase-schema.sql` (v3, single-tenant) with a v4 schema that adds multi-tenancy (`organizations`) and a plan/permission system (`plans`, `plan_features`, `organization_feature_overrides`, `usage_logs`, `platform_admins`), folds `tattoo_designs`/`placements`/`user_preferences` into `sessions`, and applies cleanly to the empty new Supabase project (ref `pmcunzmdftksnxswmzsi`).

**Architecture:** One growing SQL file, `supabase-schema.sql`, built section-by-section across 6 phases in strict FK-dependency order (plan catalog → tenants → staff/customers → sessions/chat → permission engine/RLS → apply+seed+verify). Because the file is `DROP ... CASCADE` then `CREATE`, at the end of every phase the *entire accumulated file* can be re-run from scratch against the empty project — that re-run **is** the phase's test. Application code is **not** touched by this plan (separate follow-up).

**Tech Stack:** PostgreSQL (Supabase), applied via the Supabase MCP server (`mcp__supabase__execute_sql` for iterative phases, `mcp__supabase__apply_migration` for the final recorded migration in Phase 6). These are deferred tools — call `ToolSearch` with `query: "select:mcp__supabase__execute_sql,mcp__supabase__apply_migration,mcp__supabase__list_tables"` once per session before first use.

**Spec:** `docs/superpowers/specs/2026-09-21-multi-tenant-schema-v4-design.md`

## Global Constraints

- **Schema-only.** No application code (`src/**`) changes in this plan — see the spec's "Out of scope" section. `AGENTS.md`'s Database Tables section documenting old names is also **not** updated here; that happens in the app-code follow-up plan.
- **No cached seat counters.** `organizations` never gets `designer_seats_used`/`admin_seats_used` columns. Seat checks are always a live `count(*)` against `staff`.
- **No data migration.** The target project is empty — every phase applies fresh `CREATE`s, never an `ALTER` against existing rows.
- **Enums stay `text not null check (col in (...))`**, never native Postgres `ENUM` — matches the existing codebase convention.
- **Every timestamp column ends in `_at`** (`last_login_at`, not `last_login`).
- **`usage_logs` gets no `updated_at`** — append-only audit log, on purpose.
- Target Supabase project ref: `pmcunzmdftksnxswmzsi`. Applying SQL to it via the Supabase MCP is safe to do repeatedly in this plan — the project holds no data anyone depends on yet.

---

## File Structure

Single file, rewritten in place, grown incrementally:

- **Modify:** `supabase-schema.sql` (repo root) — replaces the entire v3 file. Each phase below appends a clearly-commented section; nothing from earlier phases is edited by a later one except the `DROP` block (written complete in Phase 1) and the final `-- VERIFY` comment block (Phase 6).

No other repo files change in this plan.

---

### Task 1: Plan catalog — `platform_admins`, `plans`, `plan_features`

**Files:**
- Modify: `supabase-schema.sql` (new file content, replacing v3 entirely)

**Interfaces:**
- Consumes: nothing (first table group, no FK dependencies on anything else in v4)
- Produces: `platform_admins(id uuid PK, email, name, is_active)`, `plans(id uuid PK, name, price_cents, billing_interval, is_active)`, `plan_features(plan_id FK, feature_key, enabled, limit_value, updated_by FK → platform_admins, PK (plan_id, feature_key))`, shared trigger function `set_updated_at()` — every later table with an `updated_at` column attaches this same trigger.

- [ ] **Step 1: Write the header, extensions, and complete DROP block**

Replace the entire contents of `supabase-schema.sql` with:

```sql
-- ============================================================
-- STENSLEE — Supabase Schema (v4 — Multi-Tenant)
-- Run this in the Supabase SQL Editor for a fresh install.
-- Target: a completely empty Supabase project. This file is safe to
-- re-run from scratch at any point during development (DROP-first).
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ── Drop existing tables (clean slate, reverse FK order) ────
-- Full v4 target list, even though most CREATEs appear in later
-- sections of this file (added phase by phase) -- listing them all here
-- up front is what makes a full re-run of this file idempotent.
drop table if exists usage_logs                     cascade;
drop table if exists chat_messages                  cascade;
drop table if exists sessions                       cascade;
drop table if exists organization_feature_overrides cascade;
drop table if exists customers                      cascade;
drop table if exists staff                          cascade;
drop table if exists organizations                  cascade;
drop table if exists plan_features                  cascade;
drop table if exists plans                          cascade;
drop table if exists platform_admins                cascade;
-- old v3 names, dropped too in case this ever runs against a v3 database
drop table if exists user_preferences cascade;
drop table if exists placements       cascade;
drop table if exists tattoo_designs   cascade;
drop table if exists users            cascade;

-- storage.objects is Supabase-managed, never dropped by this script -- but
-- its policy references is_admin()/is_designer() below, so it must be
-- dropped before those functions are, or the function drops fail with
-- "cannot drop function ... because other objects depend on it".
drop policy if exists "session-assets: staff upload" on storage.objects;

drop function if exists finalize_session(text, uuid, uuid);
drop function if exists finalize_session(text);
drop function if exists finalize_rework_session(text, uuid);
drop function if exists get_staff_role();
drop function if exists get_staff_org();
drop function if exists is_admin();
drop function if exists is_designer();
drop function if exists get_effective_access(uuid, text);
drop function if exists get_all_effective_access(uuid);
drop function if exists search_customers(text);
drop function if exists set_updated_at();

-- ── SHARED: auto-maintain updated_at ─────────────────────────
-- Attached via a BEFORE UPDATE trigger to every table below that has an
-- updated_at column, so the app never has to remember to set it by hand.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

- [ ] **Step 2: Apply to the empty Supabase project**

Load the Supabase MCP tools if not already loaded this session:
`ToolSearch({ query: "select:mcp__supabase__execute_sql", max_results: 1 })`

Then run the full file content above via `mcp__supabase__execute_sql` against project ref `pmcunzmdftksnxswmzsi`.

Expected result: no errors. (The `drop ... if exists` statements are no-ops against an empty database; the trigger function is created.)

- [ ] **Step 3: Verify the trigger function exists**

Run via `mcp__supabase__execute_sql`:

```sql
select proname from pg_proc where proname = 'set_updated_at';
```

Expected: one row, `set_updated_at`.

- [ ] **Step 4: Append `platform_admins`, `plans`, `plan_features`**

Append to `supabase-schema.sql`:

```sql
-- ── 1. PLATFORM ADMINS ──────────────────────────────────────
-- Your team (Super Admins) who run the Stenslee platform itself. Not
-- tenant-scoped, and deliberately separate from `staff` (studio staff).
create table platform_admins (
  id          uuid        primary key default uuid_generate_v4(),
  email       text        not null unique,
  name        text        not null,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at before update on platform_admins
  for each row execute function set_updated_at();

comment on table platform_admins is 'Super Admins who manage organizations, plans, and feature overrides across every studio. Not tenant-scoped.';

-- ── 2. PLANS ────────────────────────────────────────────────
create table plans (
  id               uuid        primary key default uuid_generate_v4(),
  name             text        not null,
  description      text,
  price_cents      int         not null default 0,
  billing_interval text        not null default 'month'
                     check (billing_interval in ('month', 'year')),
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger set_updated_at before update on plans
  for each row execute function set_updated_at();

comment on table plans is 'Subscription tiers. is_active = false hides a retired plan from new signups without breaking orgs already on it. No new columns are ever added here for a new tier -- that''s just another row.';

-- ── 3. PLAN FEATURES ────────────────────────────────────────
-- Default feature grid: (plan, feature_key) -> enabled, limit_value.
-- Composite primary key doubles as the natural key -- no surrogate id.
create table plan_features (
  plan_id      uuid        not null references plans(id) on delete cascade,
  feature_key  text        not null,
  enabled      boolean     not null default false,
  limit_value  int,
  updated_by   uuid        references platform_admins(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (plan_id, feature_key)
);

create trigger set_updated_at before update on plan_features
  for each row execute function set_updated_at();

comment on table plan_features is 'Default access grid for every plan, one row per (plan, feature_key). limit_value is null for pure toggles and for uncapped limits.';
```

- [ ] **Step 5: Apply and verify the three tables**

Run the appended SQL via `mcp__supabase__execute_sql`, then verify:

```sql
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('platform_admins', 'plans', 'plan_features')
 order by table_name;
```

Expected: exactly the 3 rows `plan_features`, `platform_admins`, `plans`.

- [ ] **Step 6: Verify the plan_features composite primary key**

```sql
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'plan_features'::regclass and contype = 'p';
```

Expected: one row whose definition is `PRIMARY KEY (plan_id, feature_key)`.

- [ ] **Step 7: Insert a throwaway plan + feature row to confirm constraints work, then clean up**

```sql
insert into plans (name, price_cents) values ('__test_plan__', 100) returning id;
-- copy the returned id into the next statement
insert into plan_features (plan_id, feature_key, enabled, limit_value)
values ('<id-from-above>', 'ai_design', true, 150);
select * from plan_features where feature_key = 'ai_design';
delete from plan_features where feature_key = 'ai_design';
delete from plans where name = '__test_plan__';
```

Expected: the insert succeeds, the select shows one row with `enabled = true, limit_value = 150`, cleanup leaves both tables empty again.

- [ ] **Step 8: Commit**

```bash
git add supabase-schema.sql
git commit -m "Add plan catalog tables (platform_admins, plans, plan_features) to schema v4"
```

---

### Task 2: Tenant root — `organizations`, `organization_feature_overrides`

**Files:**
- Modify: `supabase-schema.sql`

**Interfaces:**
- Consumes: `plans(id)`, `platform_admins(id)`, `set_updated_at()` trigger function (Task 1)
- Produces: `organizations(id uuid PK, name, slug, plan_id FK, status)`, `organization_feature_overrides(organization_id FK, feature_key, enabled, limit_value, updated_by FK, PK (organization_id, feature_key))` — both consumed by every later task (staff/customers/sessions all reference `organizations.id`; the permission engine in Task 5 reads `organization_feature_overrides`).

- [ ] **Step 1: Append `organizations`**

```sql
-- ── 4. ORGANIZATIONS ────────────────────────────────────────
-- One row per studio client (tenant).
create table organizations (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  slug        text        not null unique,
  plan_id     uuid        references plans(id) on delete restrict,
  status      text        not null default 'active'
                check (status in ('active', 'suspended', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on organizations(plan_id);

create trigger set_updated_at before update on organizations
  for each row execute function set_updated_at();

comment on table organizations is 'One row per studio (tenant). plan_id drives default feature access via plan_features; organization_feature_overrides can override per-org. No cached seat counters -- seat limits (designer_seats/admin_seats feature keys) are checked live via count(*) against staff, see Task 3.';
```

- [ ] **Step 2: Apply and verify**

Run via `mcp__supabase__execute_sql`, then:

```sql
select table_name from information_schema.tables
 where table_schema = 'public' and table_name = 'organizations';
```

Expected: one row.

- [ ] **Step 3: Append `organization_feature_overrides`**

```sql
-- ── 5. ORGANIZATION FEATURE OVERRIDES ───────────────────────
-- Per-org exceptions to the plan default. A row here for (org, feature_key)
-- always wins over plan_features, replacing both enabled and limit_value
-- wholesale (not merged field-by-field).
create table organization_feature_overrides (
  organization_id uuid        not null references organizations(id) on delete cascade,
  feature_key     text        not null,
  enabled         boolean     not null default false,
  limit_value     int,
  updated_by      uuid        references platform_admins(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, feature_key)
);

create trigger set_updated_at before update on organization_feature_overrides
  for each row execute function set_updated_at();

comment on table organization_feature_overrides is 'Per-org exceptions to plan_features. Presence of a row for (org, feature_key) always wins over the plan default -- checked first by getEffectiveAccess() (Task 5).';
```

- [ ] **Step 4: Apply and verify FK + PK**

```sql
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'organization_feature_overrides'::regclass
 order by contype;
```

Expected: rows for the primary key `(organization_id, feature_key)`, the FK to `organizations`, and the FK to `platform_admins`.

- [ ] **Step 5: Insert a throwaway org (with a real plan FK) + an override, confirm the "always wins" shape is queryable, then clean up**

```sql
insert into plans (name, price_cents) values ('__test_plan__', 0) returning id;
insert into organizations (name, slug, plan_id) values ('__test_org__', '__test_org__', '<plan-id-from-above>') returning id;
insert into organization_feature_overrides (organization_id, feature_key, enabled, limit_value)
values ('<org-id-from-above>', 'ai_design', false, null);
select * from organization_feature_overrides where feature_key = 'ai_design';
delete from organization_feature_overrides where feature_key = 'ai_design';
delete from organizations where slug = '__test_org__';
delete from plans where name = '__test_plan__';
```

Expected: the select shows the override row (`enabled = false`), cleanup succeeds without FK errors (children deleted before parents).

- [ ] **Step 6: Commit**

```bash
git add supabase-schema.sql
git commit -m "Add organizations and organization_feature_overrides to schema v4"
```

---

### Task 3: Staff & customers — rename, org-scope, RLS helper functions, seat-limit index

**Files:**
- Modify: `supabase-schema.sql`

**Interfaces:**
- Consumes: `organizations(id)` (Task 2)
- Produces: `staff(id uuid PK → auth.users, organization_id FK, email, name, role, is_active, last_login_at, deleted_at, trash_last_viewed_at, avatar_url)`, `customers(id uuid PK, organization_id FK, name, phone)`, functions `get_staff_role()`, `get_staff_org()`, `is_admin()`, `is_designer()` — all four consumed by Task 5's RLS policies; `staff_org_role_active_idx` — the index the live seat-limit `count(*)` check in the (separate, follow-up) app-code plan relies on.

- [ ] **Step 1: Append `staff`**

```sql
-- ── 6. STAFF ────────────────────────────────────────────────
-- Linked 1:1 to Supabase Auth (auth.users), scoped to one organization.
create table staff (
  id                    uuid        primary key references auth.users(id) on delete cascade,
  organization_id       uuid        not null references organizations(id) on delete cascade,
  email                 text        not null unique,
  name                  text        not null,
  role                  text        not null default 'designer'
                          check (role in ('admin', 'designer')),
  is_active             boolean     not null default true,
  last_login_at         timestamptz,
  deleted_at            timestamptz,
  trash_last_viewed_at  timestamptz,
  avatar_url            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index on staff(organization_id);
-- Backs the live seat-limit count (designer_seats/admin_seats feature
-- keys): how many active staff of a given role does this org have right
-- now. Partial so soft-deleted/inactive rows never bloat the index.
create index staff_org_role_active_idx on staff(organization_id, role)
  where deleted_at is null and is_active;

create trigger set_updated_at before update on staff
  for each row execute function set_updated_at();

comment on table staff is 'Studio staff (designers + admin), scoped to one organization. Auth via Supabase Auth email+password. last_login_at enforces 24hr session timeout in middleware. deleted_at is a soft-delete marker -- non-null means hidden from admin list and blocked from logging in, row kept so historical sessions still resolve "handled by X". Seat limits are checked live via count(*) + staff_org_role_active_idx, never a cached counter.';
```

- [ ] **Step 2: Append `customers`**

```sql
-- ── 7. CUSTOMERS ────────────────────────────────────────────
-- Formerly `users`. Phone-based identification, no login.
create table customers (
  id               uuid        primary key default uuid_generate_v4(),
  organization_id  uuid        not null references organizations(id) on delete cascade,
  name             text        not null,
  phone            text        not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, phone)
);

create index on customers(organization_id);

create trigger set_updated_at before update on customers
  for each row execute function set_updated_at();

comment on table customers is 'Customer records (formerly `users`, first_name renamed to name). Phone is unique per organization, not globally -- two different studios may each have a customer sharing the same phone number. No auth -- staff acts on their behalf.';
```

- [ ] **Step 3: Apply and verify both tables + the seat-limit index**

```sql
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('staff', 'customers')
 order by table_name;

select indexname from pg_indexes
 where tablename = 'staff' and indexname = 'staff_org_role_active_idx';

select conname from pg_constraint
 where conrelid = 'customers'::regclass and contype = 'u';
```

Expected: both tables present; the partial index exists; a unique constraint exists on `customers` (the `(organization_id, phone)` pair).

- [ ] **Step 4: Append the RLS helper functions**

```sql
-- ── RLS HELPER FUNCTIONS ─────────────────────────────────────
create or replace function get_staff_role()
returns text language sql security definer stable as $$
  select role from staff where id = auth.uid();
$$;

create or replace function get_staff_org()
returns uuid language sql security definer stable as $$
  select organization_id from staff where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql security definer stable as $$
  select coalesce(
    (select true from staff where id = auth.uid() and role = 'admin' and is_active = true),
    false
  );
$$;

create or replace function is_designer()
returns boolean language sql security definer stable as $$
  select coalesce(
    (select true from staff where id = auth.uid() and role = 'designer' and is_active = true),
    false
  );
$$;
```

- [ ] **Step 5: Apply and verify the functions exist**

```sql
select proname from pg_proc
 where proname in ('get_staff_role', 'get_staff_org', 'is_admin', 'is_designer')
 order by proname;
```

Expected: all 4 names returned.

- [ ] **Step 6: Insert a throwaway org + staff row (no RLS enabled yet, so a direct insert as the service role works) to confirm the FK/unique constraints, then clean up**

```sql
insert into plans (name, price_cents) values ('__test_plan__', 0) returning id;
insert into organizations (name, slug, plan_id) values ('__test_org__', '__test_org__', '<plan-id>') returning id;
-- staff.id must reference a real auth.users row; skip the staff insert if
-- no test auth user exists yet -- FK correctness was already exercised by
-- the organizations/customers inserts above, and full end-to-end staff
-- creation is verified in Task 6 once a real auth user exists.
insert into customers (organization_id, name, phone) values ('<org-id>', '__test_cust__', '5550001111');
select * from customers where name = '__test_cust__';
delete from customers where name = '__test_cust__';
delete from organizations where slug = '__test_org__';
delete from plans where name = '__test_plan__';
```

Expected: customer insert/select/cleanup succeeds.

- [ ] **Step 7: Commit**

```bash
git add supabase-schema.sql
git commit -m "Add staff and customers tables plus RLS helper functions to schema v4"
```

---

### Task 4: Sessions & chat — full rewrite, finalize RPC, views, customer search

**Files:**
- Modify: `supabase-schema.sql`

**Interfaces:**
- Consumes: `organizations(id)`, `customers(id)`, `staff(id)` (Tasks 2–3)
- Produces: `sessions(id text PK, organization_id FK, customer_id FK, staff_id FK, style, description, body_area, flow_type, rework_source_photo_url, rework_mode, status, selected_design_url, selected_design_style, flash_image_url, placement_text, placement_body_photo_url, placement_composite_url, deleted_at)`, `chat_messages(id uuid PK, organization_id FK, session_id FK, role, content, image_urls text[])`, function `finalize_session(p_session_id text)`, views `designer_session_counts`, `customer_session_stats`, function `search_customers(q text)`. All consumed by Task 5 (RLS policies) and by the separate app-code follow-up plan.

- [ ] **Step 1: Append `sessions`**

```sql
-- ── 8. SESSIONS ─────────────────────────────────────────────
-- One session = one tattoo design journey, scoped to one organization.
create table sessions (
  id                        text        primary key,
  organization_id           uuid        not null references organizations(id) on delete cascade,
  customer_id               uuid        references customers(id) on delete set null,
  staff_id                  uuid        references staff(id) on delete set null,
  style                     text,
  description               text,
  body_area                 text,
  flow_type                 text        not null default 'ai_design'
                              check (flow_type in ('ai_design', 'rework')),
  rework_source_photo_url   text,
  rework_mode               text        check (rework_mode in ('cover', 'extend')),
  status                    text        not null default 'active'
                              check (status in ('active', 'completed', 'abandoned')),
  selected_design_url       text,
  selected_design_style     text,
  flash_image_url           text,
  placement_text            text,
  placement_body_photo_url  text,
  placement_composite_url   text,
  created_at                timestamptz not null default now(),
  completed_at              timestamptz,
  deleted_at                timestamptz,
  updated_at                timestamptz not null default now()
);

create index on sessions(organization_id);
create index on sessions(customer_id);
create index on sessions(staff_id);
create index on sessions(status);
create index on sessions(created_at);
create index on sessions(deleted_at) where deleted_at is not null;

create trigger set_updated_at before update on sessions
  for each row execute function set_updated_at();

comment on table sessions is 'One row per tattoo design session, scoped to one organization. staff_id means "handled by" -- an admin running their own session still sets it, same as a designer. selected_design_* / placement_* replace v3''s tattoo_designs/placements tables: a session only ever has one finalized design and one current placement. status = ''completed'' marks both as final -- no separate is_finalized flag. deleted_at is a soft-delete marker (30-day recoverable trash, see the PURGE JOB section below).';
```

- [ ] **Step 2: Append `chat_messages`**

```sql
-- ── 9. CHAT MESSAGES ─────────────────────────────────────────
create table chat_messages (
  id               uuid        primary key default uuid_generate_v4(),
  organization_id  uuid        not null references organizations(id) on delete cascade,
  session_id       text        not null references sessions(id) on delete cascade,
  role             text        not null check (role in ('user', 'assistant')),
  content          text,
  image_urls       text[]      not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index on chat_messages(organization_id);
create index on chat_messages(session_id, created_at);

create trigger set_updated_at before update on chat_messages
  for each row execute function set_updated_at();

comment on table chat_messages is 'Chat screen transcript, one row per turn. v3''s design_ids[] is gone -- there is no tattoo_designs table left for it to point to. image_urls stays as the only array.';
```

- [ ] **Step 3: Apply and verify both tables**

```sql
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('sessions', 'chat_messages')
 order by table_name;
```

Expected: both present.

- [ ] **Step 4: Append the simplified `finalize_session` RPC**

```sql
-- ── FUNCTION: finalize_session ───────────────────────────────
-- The design and placement are already written onto `sessions` the
-- moment staff picks them (selected_design_url / placement_composite_url)
-- -- this just marks the session done. Collapses v3's finalize_session +
-- finalize_rework_session into one function, since there are no more
-- per-design/per-placement row IDs to pass in.
create or replace function finalize_session(p_session_id text)
returns void language plpgsql security definer as $$
begin
  update sessions set status = 'completed', completed_at = now() where id = p_session_id;
end;
$$;
```

- [ ] **Step 5: Append the aggregate views and customer search function**

```sql
-- ── AGGREGATE VIEWS (performance) ────────────────────────────
create or replace view public.designer_session_counts
with (security_invoker = true) as
select staff_id, count(*)::int as session_count
from public.sessions
where staff_id is not null
group by staff_id;

create or replace view public.customer_session_stats
with (security_invoker = true) as
select
  customer_id,
  count(*)::int as session_count,
  max(completed_at) as last_session_at
from public.sessions
where customer_id is not null
  and status = 'completed'
group by customer_id;

-- ── CUSTOMER SEARCH (name + phone, partial match) ────────────
-- security_invoker means this runs with the caller's own row-level
-- security, so once Task 5's RLS policy on `customers` is in place this
-- naturally only searches the caller's own organization -- no explicit
-- organization_id parameter needed.
create or replace function public.search_customers(q text)
returns table (id uuid, name text, phone text)
language sql
stable
security invoker
as $$
  select id, name, phone
  from public.customers
  where name ilike '%' || q || '%'
     or (
       btrim(q) ~ '^[0-9 ()+-]+$'
       and regexp_replace(phone, '\D', '', 'g') ilike '%' || regexp_replace(q, '\D', '', 'g') || '%'
     )
  order by name
  limit 10;
$$;
```

- [ ] **Step 6: Apply and verify**

```sql
select proname from pg_proc where proname in ('finalize_session', 'search_customers') order by proname;
select viewname from pg_views where viewname in ('designer_session_counts', 'customer_session_stats') order by viewname;
```

Expected: both functions and both views present.

- [ ] **Step 7: End-to-end insert test — org → customer → session → chat message → finalize — then clean up**

```sql
insert into plans (name, price_cents) values ('__test_plan__', 0) returning id;
insert into organizations (name, slug, plan_id) values ('__test_org__', '__test_org__', '<plan-id>') returning id;
insert into customers (organization_id, name, phone) values ('<org-id>', '__test_cust__', '5550001111') returning id;
insert into sessions (id, organization_id, customer_id, style, status)
values ('__test_session__', '<org-id>', '<customer-id>', 'traditional', 'active');
insert into chat_messages (organization_id, session_id, role, content)
values ('<org-id>', '__test_session__', 'user', 'make it bigger');
select finalize_session('__test_session__');
select status, completed_at from sessions where id = '__test_session__';
select * from public.search_customers('test');

delete from chat_messages where session_id = '__test_session__';
delete from sessions where id = '__test_session__';
delete from customers where name = '__test_cust__';
delete from organizations where slug = '__test_org__';
delete from plans where name = '__test_plan__';
```

Expected: `finalize_session` leaves `status = 'completed'` with `completed_at` set; `search_customers('test')` returns the test customer before cleanup.

- [ ] **Step 8: Commit**

```bash
git add supabase-schema.sql
git commit -m "Add sessions and chat_messages tables, finalize_session RPC, views, and search_customers to schema v4"
```

---

### Task 5: Permission engine + complete RLS pass — `usage_logs`, `getEffectiveAccess()`, storage policy

**Files:**
- Modify: `supabase-schema.sql`

**Interfaces:**
- Consumes: every table from Tasks 1–4, `get_staff_org()`/`is_admin()`/`is_designer()` (Task 3)
- Produces: `usage_logs(id uuid PK, organization_id FK, staff_id FK, session_id FK, feature_key, action, target_id, metadata jsonb, created_at)`, function `get_effective_access(p_organization_id uuid, p_feature_key text)`, function `get_all_effective_access(p_organization_id uuid) returns table(feature_key, enabled, limit_value, used, remaining)` — the batch form the app-load permission fetch calls (see the separate permission-foundation implementation plan), RLS enabled + policies on every tenant table, storage bucket + storage RLS policy (carried over from v3, unchanged). This is the last schema-content task — Task 6 only applies and seeds what's already written.

- [ ] **Step 1: Append `usage_logs`**

```sql
-- ── 10. USAGE LOGS ───────────────────────────────────────────
-- One row per action: audit trail AND, counted for the period, a limit
-- counter. No updated_at -- append-only, a row is written once, never edited.
create table usage_logs (
  id               uuid        primary key default uuid_generate_v4(),
  organization_id  uuid        not null references organizations(id) on delete cascade,
  staff_id         uuid        references staff(id) on delete set null,
  session_id       text        references sessions(id) on delete set null,
  feature_key      text        not null,
  action           text        not null,
  target_id        uuid,
  metadata         jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

-- The one index the whole permission system's performance rides on: the
-- per-period usage count that runs on every limited action.
create index usage_logs_org_feature_period_idx
  on usage_logs(organization_id, feature_key, created_at);

comment on table usage_logs is 'One row per staff action. Append-only audit trail; also the source of per-period usage counts for limit-type feature keys, via usage_logs_org_feature_period_idx.';
```

- [ ] **Step 2: Apply and verify**

```sql
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'usage_logs';
select indexname from pg_indexes where tablename = 'usage_logs' and indexname = 'usage_logs_org_feature_period_idx';
```

Expected: table and composite index both present.

- [ ] **Step 3: Append `get_effective_access()`**

```sql
-- ── FUNCTION: get_effective_access ───────────────────────────
-- The one real permission gate. Checks organization_feature_overrides
-- first, falls back to the org's plan_features row. For a limit-type key
-- (limit_value is not null), also counts usage_logs for the current
-- calendar month via usage_logs_org_feature_period_idx and reports how
-- many uses remain. An action is allowed only when enabled = true AND
-- (limit_value is null OR remaining > 0).
create or replace function get_effective_access(
  p_organization_id uuid,
  p_feature_key     text
)
returns table (enabled boolean, limit_value int, used int, remaining int)
language plpgsql
security definer
stable
as $$
declare
  v_enabled     boolean;
  v_limit       int;
  v_used        int;
begin
  select o.enabled, o.limit_value into v_enabled, v_limit
    from organization_feature_overrides o
   where o.organization_id = p_organization_id and o.feature_key = p_feature_key;

  if not found then
    select pf.enabled, pf.limit_value into v_enabled, v_limit
      from plan_features pf
      join organizations org on org.plan_id = pf.plan_id
     where org.id = p_organization_id and pf.feature_key = p_feature_key;
  end if;

  if not found and v_enabled is null then
    return query select false, null::int, 0, 0;
    return;
  end if;

  if v_limit is null then
    return query select coalesce(v_enabled, false), null::int, 0, null::int;
    return;
  end if;

  select count(*)::int into v_used
    from usage_logs
   where organization_id = p_organization_id
     and feature_key = p_feature_key
     and created_at >= date_trunc('month', now());

  return query select coalesce(v_enabled, false), v_limit, v_used, greatest(v_limit - v_used, 0);
end;
$$;

comment on function get_effective_access is 'Server-side permission + limit check. organization_feature_overrides always wins when a row is present; otherwise falls back to plan_features for the org''s plan. remaining is null for an uncapped/toggle-only feature.';

-- ── FUNCTION: get_all_effective_access ───────────────────────
-- Batch version of get_effective_access -- one row per feature_key the
-- org's plan defines, in one round trip. Built for the app-load fetch
-- (fetching all ~18 feature keys individually every time a staff member
-- opens the app would be 18 round trips for no reason). Logic mirrors
-- get_effective_access exactly, just set-based instead of per-key.
create or replace function get_all_effective_access(p_organization_id uuid)
returns table (feature_key text, enabled boolean, limit_value int, used int, remaining int)
language plpgsql
security definer
stable
as $$
declare
  v_plan_id uuid;
begin
  select plan_id into v_plan_id from organizations where id = p_organization_id;

  return query
  with base as (
    -- One row per feature_key known to this org's plan, with the
    -- override (if any) already applied on top of the plan default.
    select
      pf.feature_key,
      coalesce(o.enabled, pf.enabled)         as enabled,
      case when o.feature_key is not null then o.limit_value else pf.limit_value end as limit_value
    from plan_features pf
    left join organization_feature_overrides o
      on o.organization_id = p_organization_id and o.feature_key = pf.feature_key
    where pf.plan_id = v_plan_id
  ),
  usage as (
    select ul.feature_key, count(*)::int as used
      from usage_logs ul
     where ul.organization_id = p_organization_id
       and ul.created_at >= date_trunc('month', now())
       -- Qualified as base.* (not bare feature_key/limit_value): those bare
       -- names are ambiguous here against this function's own RETURNS
       -- TABLE OUT parameters of the same names -- Postgres raises
       -- "column reference is ambiguous" (42702) without the qualifier.
       and ul.feature_key in (select base.feature_key from base where base.limit_value is not null)
     group by ul.feature_key
  )
  select
    b.feature_key,
    b.enabled,
    b.limit_value,
    coalesce(u.used, 0) as used,
    case when b.limit_value is null then null else greatest(b.limit_value - coalesce(u.used, 0), 0) end as remaining
  from base b
  left join usage u on u.feature_key = b.feature_key;
end;
$$;

comment on function get_all_effective_access is 'Batch form of get_effective_access -- returns every feature_key the org''s plan defines in one call. Used for the app-load permission fetch (see the foundation implementation plan).';
```

- [ ] **Step 4: Apply and verify with a plan default + an override that beats it**

```sql
insert into plans (name, price_cents) values ('__test_plan__', 0) returning id;
insert into plan_features (plan_id, feature_key, enabled, limit_value) values ('<plan-id>', 'ai_design', true, 100);
insert into organizations (name, slug, plan_id) values ('__test_org__', '__test_org__', '<plan-id>') returning id;

-- 1. No override yet: should return the plan default (enabled=true, limit=100, used=0, remaining=100)
select * from get_effective_access('<org-id>', 'ai_design');

-- 2. Add an override that disables it entirely
insert into organization_feature_overrides (organization_id, feature_key, enabled, limit_value)
values ('<org-id>', 'ai_design', false, null);

-- 3. Should now return enabled=false (override wins), not the plan's enabled=true
select * from get_effective_access('<org-id>', 'ai_design');

delete from organization_feature_overrides where organization_id = '<org-id>';
delete from organizations where slug = '__test_org__';
delete from plan_features where plan_id = '<plan-id>';
delete from plans where name = '__test_plan__';
```

Expected: query 1 returns `enabled=true, limit_value=100, used=0, remaining=100`; query 3 returns `enabled=false` — confirming the override beats the plan default, satisfying the spec's success criterion for this function.

- [ ] **Step 4b: Verify `get_all_effective_access` returns the same numbers in one call**

Re-using the same test org (recreate it if Step 4's cleanup already ran):

```sql
insert into plans (name, price_cents) values ('__test_plan__', 0) returning id;
insert into plan_features (plan_id, feature_key, enabled, limit_value) values
  ('<plan-id>', 'ai_design', true, 100),
  ('<plan-id>', 'camera_capture', true, null);
insert into organizations (name, slug, plan_id) values ('__test_org__', '__test_org__', '<plan-id>') returning id;

select * from get_all_effective_access('<org-id>') order by feature_key;

delete from organizations where slug = '__test_org__';
delete from plan_features where plan_id = '<plan-id>';
delete from plans where name = '__test_plan__';
```

Expected: two rows — `ai_design` with `enabled=true, limit_value=100, used=0, remaining=100`, and `camera_capture` with `enabled=true, limit_value=null, used=0, remaining=null` — matching what `get_effective_access` would return per-key, confirming the batch and single-key functions agree.

- [ ] **Step 5: Append RLS enable + policies for every tenant table**

```sql
-- ── ROW-LEVEL SECURITY ──────────────────────────────────────
alter table organizations                   enable row level security;
alter table organization_feature_overrides  enable row level security;
alter table staff                           enable row level security;
alter table customers                       enable row level security;
alter table sessions                        enable row level security;
alter table chat_messages                   enable row level security;
alter table usage_logs                      enable row level security;

-- NOTE: API routes use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS
-- entirely. These policies apply to direct Supabase client calls from the
-- browser (studio UI), scoped to the caller's own organization.

-- ORGANIZATIONS (a staff member reads only their own org row)
create policy "organizations: staff read own" on organizations for select
  using (id = get_staff_org());

-- ORGANIZATION FEATURE OVERRIDES (admin of that org can read its own overrides)
create policy "org_overrides: admin read own" on organization_feature_overrides for select
  using (is_admin() and organization_id = get_staff_org());

-- STAFF
create policy "staff: admin full access within org" on staff for all
  using (is_admin() and organization_id = get_staff_org());
create policy "staff: read own row" on staff for select
  using (auth.uid() = id);

-- CUSTOMERS
create policy "customers: staff read own org"   on customers for select
  using (organization_id = get_staff_org());
create policy "customers: staff insert own org" on customers for insert
  with check (organization_id = get_staff_org());
create policy "customers: staff update own org" on customers for update
  using (organization_id = get_staff_org());

-- SESSIONS
create policy "sessions: admin full access within org" on sessions for all
  using (is_admin() and organization_id = get_staff_org());
create policy "sessions: designer own sessions" on sessions for all
  using (is_designer() and organization_id = get_staff_org() and staff_id = auth.uid());

-- CHAT MESSAGES
create policy "chat: admin full access within org" on chat_messages for all
  using (is_admin() and organization_id = get_staff_org());
create policy "chat: designer own" on chat_messages for all using (
  is_designer() and organization_id = get_staff_org() and exists (
    select 1 from sessions s
     where s.id = chat_messages.session_id and s.staff_id = auth.uid()
  )
);

-- USAGE LOGS
create policy "usage_logs: admin read own org" on usage_logs for select
  using (is_admin() and organization_id = get_staff_org());
-- Insert allowed from the browser (not just the service role) -- consistent
-- with this codebase's established pattern of writing from the browser
-- client wherever RLS allows, since Node-side Supabase calls from this
-- app's own server are unreliable on at least one dev machine (see
-- AGENTS.md). A staff member logging their own usage is no more sensitive
-- than the sessions/chat_messages writes already done this way.
create policy "usage_logs: staff insert own org" on usage_logs for insert
  with check (organization_id = get_staff_org() and (staff_id is null or staff_id = auth.uid()));
```

- [ ] **Step 6: Append the storage bucket + storage RLS policy (unchanged from v3)**

```sql
-- ── STORAGE BUCKETS ─────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('session-assets',   'session-assets',   true, 20971520,
   array['image/jpeg','image/png','image/webp']),
  ('reference-images', 'reference-images', true, 10485760,
   array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Lets staff upload directly from the browser instead of routing through
-- a Node-side server upload (see AGENTS.md's Node/Supabase fetch note).
-- Carried over unchanged from v3: role-only check, no session/org
-- ownership check at the storage layer -- a pre-existing gap, not
-- introduced or closed by this migration.
create policy "session-assets: staff upload" on storage.objects for insert
  with check (bucket_id = 'session-assets' and (is_admin() or is_designer()));
```

- [ ] **Step 7: Apply and verify RLS is enabled everywhere expected**

```sql
select relname, relrowsecurity from pg_class
 where relname in ('organizations', 'organization_feature_overrides', 'staff',
                    'customers', 'sessions', 'chat_messages', 'usage_logs')
 order by relname;
```

Expected: `relrowsecurity = true` for all 7 rows.

- [ ] **Step 8: Cross-org isolation test — simulate two authenticated staff via `set local role`**

`mcp__supabase__execute_sql` connects with a privileged role that bypasses RLS entirely, so this test can't just run plain selects — it needs to simulate being logged in as a specific `staff` row using Supabase's standard RLS-testing technique (`set local role authenticated` + the `request.jwt.claim.sub` setting `auth.uid()` reads from), inside a transaction that's rolled back so no state lingers:

```sql
-- Two real auth.users rows (SQL-only, same pattern as this file's own
-- seed block) so the staff FK has a valid target -- no actual signup/
-- login flow needed for this test.
insert into auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  aud, role, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', '__test_staff_a__@example.com', crypt('x', gen_salt('bf',10)), now(), 'authenticated', 'authenticated', now(), now(), '{}', '{}'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', '__test_staff_b__@example.com', crypt('x', gen_salt('bf',10)), now(), 'authenticated', 'authenticated', now(), now(), '{}', '{}')
returning id, email;
-- note the two returned ids as <staff-a-uid> / <staff-b-uid>

insert into plans (name, price_cents) values ('__test_plan__', 0) returning id;
insert into organizations (name, slug, plan_id) values
  ('__test_org_a__', '__test_org_a__', '<plan-id>'),
  ('__test_org_b__', '__test_org_b__', '<plan-id>')
returning id, slug;
-- note <org-a-id> / <org-b-id>

insert into staff (id, organization_id, email, name, role) values
  ('<staff-a-uid>', '<org-a-id>', '__test_staff_a__@example.com', 'Staff A', 'designer'),
  ('<staff-b-uid>', '<org-b-id>', '__test_staff_b__@example.com', 'Staff B', 'designer');

insert into sessions (id, organization_id, staff_id, status) values
  ('__test_session_a__', '<org-a-id>', '<staff-a-uid>', 'active'),
  ('__test_session_b__', '<org-b-id>', '<staff-b-uid>', 'active');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '<staff-a-uid>';
select auth.uid();                                          -- sanity check: returns <staff-a-uid>
select id from sessions where id = '__test_session_b__';    -- expect 0 rows (org B, blocked)
select id from sessions where id = '__test_session_a__';    -- expect 1 row (own org)
rollback;

-- Cleanup, back on the privileged connection
delete from sessions where id in ('__test_session_a__', '__test_session_b__');
delete from staff where email in ('__test_staff_a__@example.com', '__test_staff_b__@example.com');
delete from organizations where slug in ('__test_org_a__', '__test_org_b__');
delete from plans where name = '__test_plan__';
delete from auth.users where email in ('__test_staff_a__@example.com', '__test_staff_b__@example.com');
```

Expected: the first `select` inside the transaction returns zero rows, the second returns exactly one — confirming org isolation, satisfying the spec's RLS success criterion. The `rollback` means none of the transaction's own reads have side effects; the cleanup block after it removes the seed rows created before the transaction.

- [ ] **Step 9: Commit**

```bash
git add supabase-schema.sql
git commit -m "Add usage_logs, get_effective_access(), and complete RLS pass to schema v4"
```

---

### Task 6: Apply final schema, seed, and run full verification

**Files:**
- Modify: `supabase-schema.sql` (final touch: verify-queries comment block only)

**Interfaces:**
- Consumes: the complete file from Tasks 1–5
- Produces: the live schema in project `pmcunzmdftksnxswmzsi`, recorded as a named migration; one seed `platform_admins` row, one seed `plans` row with a full `plan_features` grid, one seed `organizations` row

- [ ] **Step 1: Append the closing PURGE JOB and VERIFY comment block**

```sql
-- ── PURGE JOB — Recently Deleted retention (30 days) ─────────
-- Unchanged in shape from v3, updated comment: cascades now only reach
-- chat_messages (tattoo_designs/placements no longer exist to cascade to).
--
-- ⚠ REQUIRED SETUP before this does anything: replace YOUR-DEPLOYED-DOMAIN
-- and YOUR_CRON_SECRET below, then run this block in the SQL Editor.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'purge-expired-trash',
  '0 3 * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR-DEPLOYED-DOMAIN/api/cron/purge-trash',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── VERIFY ───────────────────────────────────────────────────
-- select table_name from information_schema.tables where table_schema = 'public' order by table_name;
-- select id, name, plan_id, status from organizations;
-- select id, email, role, organization_id, is_active from staff;
-- select * from get_effective_access('<org-id>', 'ai_design');
```

- [ ] **Step 2: Apply the complete, final `supabase-schema.sql` as one recorded migration**

Load the tool if needed: `ToolSearch({ query: "select:mcp__supabase__apply_migration", max_results: 1 })`.

Call `mcp__supabase__apply_migration` with `project_id: "pmcunzmdftksnxswmzsi"`, `name: "v4_multi_tenant_schema"`, and the full contents of `supabase-schema.sql` as the migration SQL.

Expected: migration applies with no errors against the empty project.

- [ ] **Step 3: Verify every expected table exists and no v3 leftovers remain**

```sql
select table_name from information_schema.tables where table_schema = 'public' order by table_name;
```

Expected: exactly `chat_messages`, `customers`, `organization_feature_overrides`, `organizations`, `plan_features`, `plans`, `platform_admins`, `sessions`, `staff`, `usage_logs` — no `tattoo_designs`, `placements`, `user_preferences`, or `users`.

- [ ] **Step 4: Seed the first platform admin, plan, and organization**

Adjust the email to a real address before running:

```sql
insert into platform_admins (email, name) values ('admin@stenslee.com', 'Platform Admin')
on conflict (email) do nothing;

insert into plans (name, description, price_cents, billing_interval, is_active)
values ('Starter', 'Default plan for new studios', 0, 'month', true)
returning id;
```

Then insert one `plan_features` row per registry key from the spec, using the returned plan id — all 18 keys from the spec's Permission Registry, each explicitly enabled/disabled and limited per the "Super Admin — Creating a Plan" example in the Rebuild Roadmap (e.g. `ai_design` enabled with `limit_value = 150`, `catalog`/`whatsapp` disabled, seat/storage/retention keys enabled with their limits). This mirrors exactly what the (separate, later) Super Admin "create plan" UI will do — one `plan_features` row per key, nothing hand-typed outside this grid.

```sql
insert into organizations (name, slug, plan_id, status)
values ('Cleopatra Ink Studio', 'cleopatra-ink-studio', '<starter-plan-id>', 'active');
```

- [ ] **Step 5: Final smoke test — run the spec's Success Criteria checks against the seeded data**

```sql
select * from get_effective_access(
  (select id from organizations where slug = 'cleopatra-ink-studio'),
  'ai_design'
);
```

Expected: `enabled = true`, `limit_value` and `remaining` matching whatever was seeded for `ai_design` in Step 4 — confirming the end-to-end path (organizations → plans → plan_features → get_effective_access) works on real seeded data, not just throwaway test rows.

- [ ] **Step 6: Commit**

```bash
git add supabase-schema.sql
git commit -m "Finalize schema v4: purge job, verify block, apply as recorded migration, seed first org/plan"
```

---

## Self-Review Notes

- **Spec coverage:** every table, rename, removal, RPC, index, and RLS point from the spec's "Target schema" section has a task (Tasks 1–5); the spec's Success Criteria are exercised as explicit verification steps in Tasks 1, 2, 5, and 6.
- **Seat counters:** confirmed no `designer_seats_used`/`admin_seats_used` column anywhere in Task 2; Task 3's comment on `staff` explicitly documents the live-count approach instead.
- **Type/name consistency:** `organization_id`, `staff_id`, `customer_id`, `feature_key`, `limit_value` are spelled identically across every task; `get_effective_access()` (Task 5) is the one and only permission-check function, matching the name used throughout the spec (the spec's `getEffectiveAccess` is written in the camelCase the app-code layer will eventually use — the SQL function itself follows this codebase's snake_case convention, same as `is_admin`/`is_designer`).
- **Out of scope confirmed absent:** no `requireFeature()`/`useFeature()`, no `src/features/` folder changes, no application file edits anywhere in this plan.
