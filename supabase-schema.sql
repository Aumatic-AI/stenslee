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

comment on table organization_feature_overrides is 'Per-org exceptions to plan_features. Presence of a row for (org, feature_key) always wins over the plan default -- checked first by getEffectiveAccess() (Task 5)';

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
