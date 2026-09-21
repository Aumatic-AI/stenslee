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
