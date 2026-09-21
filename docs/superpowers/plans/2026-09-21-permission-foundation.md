# Permission Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable permission plumbing — a Zustand store that fetches staff/org/feature-access once per app load, a `useFeature()` client hook, and a `requireFeature()` server helper — that every feature will plug into later. **No real feature is gated by this plan.** Wiring `useFeature()`/`requireFeature()` into each of the 18 feature keys and moving files into `src/features/<key>/` is a separate, later plan (one small round per feature key).

**Architecture:** One new Zustand store (`usePermissionStore`, un-persisted — fetched fresh on every app mount per the refresh policy below, never cached across reloads), fetched via a small headless `PermissionBootstrap` client component mounted in the root layout (mirrors `AdminSidebarShell`'s existing mount-once + `onAuthStateChange` pattern). Server-side enforcement is a separate `requireFeature()` helper any API route can call — it does its own independent DB check, so it stays correct even if the client store is stale, tampered with, or skipped entirely (a hacked frontend cannot bypass it).

**Tech Stack:** Zustand (already a project dependency, see `src/store/app-store.ts`), Supabase RPC (`get_effective_access` / `get_all_effective_access` from the schema v4 plan), Next.js Route Handlers.

**Spec:** `docs/superpowers/specs/2026-09-21-multi-tenant-schema-v4-design.md` (the permission-registry section this plumbing serves)

## Prerequisites — must be true before starting Task 1

1. **`docs/superpowers/plans/2026-09-21-multi-tenant-schema-v4.md` has been fully executed** against the live Supabase project (ref `pmcunzmdftksnxswmzsi`) — specifically: `staff.organization_id` exists, `get_effective_access()` and `get_all_effective_access()` exist, and the `usage_logs: staff insert own org` RLS policy exists. Every task below reads or calls one of these.
2. **`.env.local`'s `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`** are filled in with the new project's real values (per `REBUILD_HANDOFF.md`, these are still the literal placeholder strings as of this writing) — without them `npm run dev` cannot reach the new project at all.
3. At least one seeded `organizations` row with a `plans`/`plan_features` grid exists (schema plan Task 6's seed step) and at least one real `staff` row points at it, so Task 8's manual verification has something real to check against.

## Global Constraints

- **No feature gating in this plan.** No API route gets wrapped with `requireFeature()` for real, no UI gets wrapped with `useFeature()` for real, no files move into `src/features/<key>/`. Those all belong to the next plan.
- **The permission store is never persisted to localStorage.** Confirmed refresh policy: refetch fresh every time the app loads (hard reload, reopened tab) — the same mount-once + `onAuthStateChange` pattern `AdminSidebarShell` already uses for its own role check, not a time-based cache.
- **Fail closed.** If the permission check itself fails (network error, malformed response), treat the feature as disabled/blocked — never fail open. This applies to `requireFeature()` specifically; a broken check must never let a gated action through.
- **Backend enforcement runs an independent DB check** — it does not trust anything the client sends about its own permissions.
- The Node-side Supabase fetch reliability note in `AGENTS.md` applies to `requireFeature()`'s server-side RPC call (it's an unavoidable server read — the gate must live where the privileged action happens). It gets a small retry-with-backoff. Everything else in this plan (the store's fetch, `logUsage()`) runs from the browser client, consistent with this codebase's established pattern.

---

## File Structure

- **Modify:** `src/lib/staff-types.ts` — `StaffMember` gains `organization_id`
- **Modify:** `src/lib/supabase-server.ts` — `getStaffSession()` selects the new column
- **Create:** `src/lib/permissions/feature-keys.ts` — the `FeatureKey` union + registry array
- **Create:** `src/store/permission-store.ts` — `usePermissionStore` (Zustand, un-persisted)
- **Create:** `src/lib/permissions/use-feature.ts` — `useFeature()` client hook
- **Create:** `src/components/ui/FeatureLocked.tsx` — shared "not on your plan" UI
- **Create:** `src/lib/permissions/require-feature.ts` — server-only `checkFeature()` / `requireFeature()`
- **Create:** `src/lib/permissions/log-usage.ts` — browser-only `logUsage()`
- **Create:** `src/components/layout/PermissionBootstrap.tsx` — headless mount component
- **Modify:** `src/app/layout.tsx` — mounts `PermissionBootstrap`

All new files live under the existing flat `src/lib/` / `src/store/` / `src/components/` structure — the `src/features/<key>/` move is explicitly the next plan's job, not this one's.

---

### Task 1: Extend `StaffMember` and `getStaffSession()` with `organization_id`

**Files:**
- Modify: `src/lib/staff-types.ts`
- Modify: `src/lib/supabase-server.ts`

**Interfaces:**
- Consumes: `staff.organization_id` (schema v4, Task 3 of the schema plan)
- Produces: `StaffMember.organization_id: string` — consumed by Task 5's `requireFeature()` and by the schema-plan-adjacent app code that already reads `StaffMember` (`getStaffSession()` callers across the existing API routes)

- [ ] **Step 1: Add `organization_id` to `StaffMember`**

In `src/lib/staff-types.ts`, change:

```ts
export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
  avatar_url?: string | null;
  trash_last_viewed_at?: string | null;
}
```

to:

```ts
export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
  avatar_url?: string | null;
  trash_last_viewed_at?: string | null;
  organization_id: string;
}
```

- [ ] **Step 2: Select the new column in `getStaffSession()`**

In `src/lib/supabase-server.ts`, change the select list:

```ts
  const { data: staff } = await supabase
    .from("staff")
    .select("id, email, name, role, is_active, created_at, deleted_at, avatar_url")
    .eq("id", user.id)
    .maybeSingle();
```

to:

```ts
  const { data: staff } = await supabase
    .from("staff")
    .select("id, email, name, role, is_active, created_at, deleted_at, avatar_url, organization_id")
    .eq("id", user.id)
    .maybeSingle();
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no new errors. (If an existing caller of `getStaffSession()` destructures specific fields, adding `organization_id` to the type is additive and can't break it — TypeScript would only complain about a *missing* field, not an extra one.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/staff-types.ts src/lib/supabase-server.ts
git commit -m "Add organization_id to StaffMember and getStaffSession()"
```

---

### Task 2: Feature key registry

**Files:**
- Create: `src/lib/permissions/feature-keys.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `FEATURE_KEYS: readonly string[]`, `type FeatureKey` — consumed by every other task in this plan and by every feature-gating call site in the follow-up plan

- [ ] **Step 1: Write the registry**

The exact 19 feature keys from the spec's Permission Registry (the Rebuild Roadmap's own prose says "18" — miscounting its own table; this list is transcribed directly from that table, which is the actual source of truth):

```ts
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
];

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors (new file, no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/permissions/feature-keys.ts
git commit -m "Add feature key registry"
```

---

### Task 3: `usePermissionStore` — Zustand store for staff/org/access

**Files:**
- Create: `src/store/permission-store.ts`

**Interfaces:**
- Consumes: `FeatureKey` (Task 2), `staff` table columns, `get_all_effective_access(p_organization_id uuid)` RPC (schema plan Task 5)
- Produces: `usePermissionStore` with state `{ status, staff, organizationId, access, error }` and actions `fetchPermissions()`, `clear()` — consumed by Task 4's `useFeature()` and Task 7's `PermissionBootstrap`

- [ ] **Step 1: Write the store**

```ts
import { create } from "zustand";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { isFeatureKey, type FeatureKey } from "@/lib/permissions/feature-keys";

export interface FeatureAccess {
  enabled: boolean;
  limitValue: number | null;
  used: number;
  remaining: number | null;
}

export interface PermissionStaff {
  id: string;
  organizationId: string;
  role: "admin" | "designer";
  name: string;
}

type AccessMap = Partial<Record<FeatureKey, FeatureAccess>>;

interface PermissionState {
  status: "idle" | "loading" | "loaded" | "error";
  staff: PermissionStaff | null;
  access: AccessMap;
  error: string | null;
  fetchPermissions: () => Promise<void>;
  clear: () => void;
}

interface EffectiveAccessRow {
  feature_key: string;
  enabled: boolean;
  limit_value: number | null;
  used: number;
  remaining: number | null;
}

export const usePermissionStore = create<PermissionState>((set) => ({
  status: "idle",
  staff: null,
  access: {},
  error: null,

  fetchPermissions: async () => {
    set({ status: "loading", error: null });
    const supabase = createSupabaseBrowserClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ status: "loaded", staff: null, access: {}, error: null });
      return;
    }

    const { data: staffRow, error: staffError } = await supabase
      .from("staff")
      .select("id, organization_id, role, name, is_active, deleted_at")
      .eq("id", user.id)
      .maybeSingle();

    if (staffError || !staffRow || !staffRow.is_active || staffRow.deleted_at) {
      set({ status: "loaded", staff: null, access: {}, error: staffError?.message ?? null });
      return;
    }

    const { data: rows, error: accessError } = await supabase.rpc(
      "get_all_effective_access",
      { p_organization_id: staffRow.organization_id }
    );

    if (accessError) {
      set({
        status: "error",
        staff: {
          id: staffRow.id,
          organizationId: staffRow.organization_id,
          role: staffRow.role,
          name: staffRow.name,
        },
        access: {},
        error: accessError.message,
      });
      return;
    }

    const access: AccessMap = {};
    for (const row of (rows ?? []) as EffectiveAccessRow[]) {
      if (!isFeatureKey(row.feature_key)) continue; // ignore any future/unknown key defensively
      access[row.feature_key] = {
        enabled: row.enabled,
        limitValue: row.limit_value,
        used: row.used,
        remaining: row.remaining,
      };
    }

    set({
      status: "loaded",
      staff: {
        id: staffRow.id,
        organizationId: staffRow.organization_id,
        role: staffRow.role,
        name: staffRow.name,
      },
      access,
      error: null,
    });
  },

  clear: () => set({ status: "idle", staff: null, access: {}, error: null }),
}));
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/store/permission-store.ts
git commit -m "Add usePermissionStore"
```

---

### Task 4: `useFeature()` hook and `FeatureLocked` UI

**Files:**
- Create: `src/lib/permissions/use-feature.ts`
- Create: `src/components/ui/FeatureLocked.tsx`

**Interfaces:**
- Consumes: `usePermissionStore` (Task 3), `FeatureKey` (Task 2)
- Produces: `useFeature(key): { enabled, limitValue, used, remaining, loading }`, `<FeatureLocked />` component — both consumed by the follow-up per-feature gating plan; exercised in this plan only by Task 8's throwaway verification page

- [ ] **Step 1: Write the hook**

```ts
import { usePermissionStore, type FeatureAccess } from "@/store/permission-store";
import type { FeatureKey } from "@/lib/permissions/feature-keys";

export interface FeatureState extends FeatureAccess {
  loading: boolean;
}

const LOCKED: FeatureAccess = { enabled: false, limitValue: null, used: 0, remaining: null };

// Cosmetic only -- the real gate is requireFeature() on the server (see
// src/lib/permissions/require-feature.ts). This hook exists to show/hide UI,
// never to be the only thing standing between a customer and a blocked action.
export function useFeature(key: FeatureKey): FeatureState {
  const status = usePermissionStore((s) => s.status);
  const access = usePermissionStore((s) => s.access[key]);

  if (status === "idle" || status === "loading") {
    return { ...LOCKED, loading: true };
  }
  return { ...(access ?? LOCKED), loading: false };
}
```

- [ ] **Step 2: Write the locked-state UI component**

```tsx
interface FeatureLockedProps {
  title?: string;
  message?: string;
  className?: string;
}

// Shared "not available on your plan" state -- matches the dark/gold theme
// (see AGENTS.md's Styling section) so every gated feature renders the same
// locked state instead of each one inventing its own.
export function FeatureLocked({
  title = "Not available on your plan",
  message,
  className = "",
}: FeatureLockedProps) {
  return (
    <div
      className={`rounded-xl border border-gold/20 bg-surface/40 px-5 py-6 flex flex-col items-center gap-2 text-center ${className}`}
    >
      <svg className="w-6 h-6 text-gold/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
      <p className="font-cinzel text-sm font-bold tracking-wide text-gold uppercase">{title}</p>
      {message && <p className="text-muted text-xs max-w-xs">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permissions/use-feature.ts src/components/ui/FeatureLocked.tsx
git commit -m "Add useFeature() hook and FeatureLocked component"
```

---

### Task 5: Server-side `checkFeature()` / `requireFeature()`

**Files:**
- Create: `src/lib/permissions/require-feature.ts`

**Interfaces:**
- Consumes: `FeatureKey` (Task 2), `createSupabaseServerClient` (`src/lib/supabase-server.ts`), `get_effective_access(p_organization_id uuid, p_feature_key text)` RPC (schema plan Task 5)
- Produces: `checkFeature(key): Promise<FeatureCheckResult>`, `requireFeature(key): Promise<{ok:true,result} | {ok:false,response:NextResponse}>` — the function every gated API route calls in the follow-up plan; exercised in this plan only by Task 8's throwaway verification route

- [ ] **Step 1: Write the helper**

```ts
// SERVER-ONLY -- do not import from a "use client" file.
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { FeatureKey } from "@/lib/permissions/feature-keys";

export interface FeatureAccessInfo {
  enabled: boolean;
  limitValue: number | null;
  used: number;
  remaining: number | null;
}

export type FeatureBlockReason =
  | "unauthenticated"
  | "no_organization"
  | "disabled"
  | "limit_reached"
  | "check_failed";

export interface FeatureCheckResult {
  allowed: boolean;
  organizationId: string | null;
  staffId: string | null;
  access: FeatureAccessInfo | null;
  reason?: FeatureBlockReason;
}

interface EffectiveAccessRow {
  enabled: boolean;
  limit_value: number | null;
  used: number;
  remaining: number | null;
}

// Retries a Supabase call up to `attempts` extra times with a short backoff.
// Covers the transient case of the Node-side Supabase fetch flakiness noted
// in AGENTS.md; if every attempt still fails, the caller treats it as
// "check_failed" and blocks the action (fail closed, never fail open).
async function withRetry<T>(
  fn: () => Promise<{ data: T | null; error: { message: string } | null }>,
  attempts = 2
): Promise<{ data: T | null; error: { message: string } | null }> {
  let last: { data: T | null; error: { message: string } | null } = { data: null, error: { message: "not attempted" } };
  for (let i = 0; i <= attempts; i++) {
    try {
      last = await fn();
      if (!last.error) return last;
    } catch (err) {
      last = { data: null, error: { message: err instanceof Error ? err.message : "unknown error" } };
    }
    if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
  }
  return last;
}

export async function checkFeature(featureKey: FeatureKey): Promise<FeatureCheckResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { allowed: false, organizationId: null, staffId: null, access: null, reason: "unauthenticated" };
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("organization_id, is_active, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!staff || !staff.is_active || staff.deleted_at || !staff.organization_id) {
    return { allowed: false, organizationId: null, staffId: user.id, access: null, reason: "no_organization" };
  }

  const { data, error } = await withRetry<EffectiveAccessRow[]>(() =>
    supabase.rpc("get_effective_access", {
      p_organization_id: staff.organization_id,
      p_feature_key: featureKey,
    })
  );

  if (error || !data || data.length === 0) {
    return {
      allowed: false,
      organizationId: staff.organization_id,
      staffId: user.id,
      access: null,
      reason: "check_failed",
    };
  }

  const row = data[0];
  const access: FeatureAccessInfo = {
    enabled: row.enabled,
    limitValue: row.limit_value,
    used: row.used,
    remaining: row.remaining,
  };

  if (!access.enabled) {
    return { allowed: false, organizationId: staff.organization_id, staffId: user.id, access, reason: "disabled" };
  }
  if (access.remaining !== null && access.remaining <= 0) {
    return { allowed: false, organizationId: staff.organization_id, staffId: user.id, access, reason: "limit_reached" };
  }
  return { allowed: true, organizationId: staff.organization_id, staffId: user.id, access };
}

const REASON_STATUS: Record<FeatureBlockReason, number> = {
  unauthenticated: 401,
  no_organization: 403,
  disabled: 403,
  limit_reached: 403,
  check_failed: 503,
};

const REASON_MESSAGE: Record<FeatureBlockReason, string> = {
  unauthenticated: "Not signed in",
  no_organization: "Staff account is not linked to an organization",
  disabled: "This feature is not available on your current plan",
  limit_reached: "Usage limit reached for this feature this period",
  check_failed: "Could not verify permissions — please try again",
};

// Convenience wrapper for route handlers:
//   const check = await requireFeature("ai_design");
//   if (!check.ok) return check.response;
//   // ... proceed, using check.result.organizationId / staffId
export async function requireFeature(
  featureKey: FeatureKey
): Promise<{ ok: true; result: FeatureCheckResult } | { ok: false; response: NextResponse }> {
  const result = await checkFeature(featureKey);
  if (result.allowed) return { ok: true, result };

  const reason = result.reason ?? "check_failed";
  return {
    ok: false,
    response: NextResponse.json(
      { error: REASON_MESSAGE[reason], reason },
      { status: REASON_STATUS[reason] }
    ),
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/permissions/require-feature.ts
git commit -m "Add server-side checkFeature()/requireFeature() helper"
```

---

### Task 6: Browser-side `logUsage()`

**Files:**
- Create: `src/lib/permissions/log-usage.ts`

**Interfaces:**
- Consumes: `FeatureKey` (Task 2), `createSupabaseBrowserClient`, the `usage_logs: staff insert own org` RLS policy (schema plan Task 5)
- Produces: `logUsage(params): Promise<void>` — called by the browser after a gated action succeeds, in the follow-up plan (e.g. once a generation batch completes)

- [ ] **Step 1: Write the helper**

```ts
"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import type { FeatureKey } from "@/lib/permissions/feature-keys";

export interface LogUsageParams {
  organizationId: string;
  featureKey: FeatureKey;
  action: string;
  staffId?: string | null;
  sessionId?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

// Written from the browser client, not a server route -- consistent with
// this codebase's established pattern of writing from the browser wherever
// RLS allows (see AGENTS.md's Node/Supabase fetch note). Call this only
// after the gated action has actually succeeded (e.g. a generation batch
// finished), never before -- a failed action must not consume the quota.
export async function logUsage(params: LogUsageParams): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("usage_logs").insert({
    organization_id: params.organizationId,
    staff_id: params.staffId ?? null,
    session_id: params.sessionId ?? null,
    feature_key: params.featureKey,
    action: params.action,
    target_id: params.targetId ?? null,
    metadata: params.metadata ?? {},
  });
  if (error) {
    console.error("logUsage failed:", error);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/permissions/log-usage.ts
git commit -m "Add browser-side logUsage() helper"
```

---

### Task 7: `PermissionBootstrap` — fetch on app load, mount in root layout

**Files:**
- Create: `src/components/layout/PermissionBootstrap.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `usePermissionStore` (Task 3)
- Produces: nothing new exported — this is the wiring that makes `usePermissionStore`'s state actually populate

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { usePermissionStore } from "@/store/permission-store";

// Headless -- renders nothing, just triggers the permission fetch. Mounted
// once in the root layout, so it fires once per hard page load / reopened
// tab (the confirmed refresh policy -- no localStorage cache, no polling),
// plus again on any real auth change in the same tab (sign-in/sign-out),
// mirroring AdminSidebarShell's existing role-check pattern for the same
// reason: a mount-once effect alone would keep showing the previous staff
// member's permissions if a different one signs in without a full reload.
export default function PermissionBootstrap() {
  const fetchPermissions = usePermissionStore((s) => s.fetchPermissions);
  const clear = usePermissionStore((s) => s.clear);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    fetchPermissions();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clear();
      } else {
        fetchPermissions();
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
```

- [ ] **Step 2: Mount it in the root layout**

In `src/app/layout.tsx`, add the import:

```ts
import PermissionBootstrap from "@/components/layout/PermissionBootstrap";
```

and change:

```tsx
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <AdminSidebarShell>{children}</AdminSidebarShell>
      </body>
```

to:

```tsx
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <PermissionBootstrap />
        <AdminSidebarShell>{children}</AdminSidebarShell>
      </body>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/PermissionBootstrap.tsx src/app/layout.tsx
git commit -m "Mount PermissionBootstrap in root layout"
```

---

### Task 8: End-to-end manual verification (throwaway debug page + route, removed after)

**Files:**
- Create (temporary, deleted at the end of this task): `src/app/(staff)/studio/_debug/permissions/page.tsx`
- Create (temporary, deleted at the end of this task): `src/app/api/_debug/check-feature/route.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7
- Produces: nothing permanent — this task only proves the plumbing works end to end against the real (seeded) Supabase project before the follow-up plan starts building on it

- [ ] **Step 1: Confirm prerequisites are actually met**

Run via `mcp__supabase__execute_sql` (load with `ToolSearch({ query: "select:mcp__supabase__execute_sql", max_results: 1 })` if not already loaded):

```sql
select column_name from information_schema.columns where table_name = 'staff' and column_name = 'organization_id';
select proname from pg_proc where proname in ('get_effective_access', 'get_all_effective_access');
select id, name, organization_id from staff limit 5;
```

Expected: the column exists, both functions exist, and at least one real `staff` row with a non-null `organization_id` comes back. If not, stop and finish the schema plan first — nothing below will work.

- [ ] **Step 2: Confirm `.env.local` points at the real project**

Check (do not print the values) that neither placeholder string remains:

```bash
grep -c "TODO_new_project" .env.local
```

Expected: `0`. If not, fill in the real `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` before continuing.

- [ ] **Step 3: Create the throwaway permission debug page**

```tsx
"use client";

import { usePermissionStore } from "@/store/permission-store";

// TEMPORARY -- for Task 8 verification only. Deleted at the end of this task.
export default function DebugPermissionsPage() {
  const state = usePermissionStore((s) => s);
  return (
    <pre className="p-6 text-xs text-ink whitespace-pre-wrap">
      {JSON.stringify({ status: state.status, staff: state.staff, access: state.access, error: state.error }, null, 2)}
    </pre>
  );
}
```

- [ ] **Step 4: Run the dev server and check the page**

```bash
npm run dev
```

Log in as a seeded staff member at `/studio/login`, then visit `/studio/_debug/permissions`.

Expected: JSON showing `status: "loaded"`, a `staff` object with the correct `organizationId`, and an `access` map with one entry per feature key seeded in the schema plan's Task 6 (e.g. `ai_design: { enabled: true, limitValue: 150, used: 0, remaining: 150 }`).

- [ ] **Step 5: Confirm an override actually changes what the page shows**

Via `mcp__supabase__execute_sql`, insert a real override for the logged-in staff member's org:

```sql
insert into organization_feature_overrides (organization_id, feature_key, enabled, limit_value)
values ('<seeded-org-id>', 'catalog', true, null);
```

Reload `/studio/_debug/permissions` (a full reload, matching the confirmed refresh policy — this store does not poll).

Expected: `access.catalog.enabled` is now `true` (it defaults to `false` on every plan per the spec). Clean up:

```sql
delete from organization_feature_overrides where organization_id = '<seeded-org-id>' and feature_key = 'catalog';
```

- [ ] **Step 6: Create the throwaway server-side check route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireFeature } from "@/lib/permissions/require-feature";
import { isFeatureKey } from "@/lib/permissions/feature-keys";

// TEMPORARY -- for Task 8 verification only. Deleted at the end of this task.
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key || !isFeatureKey(key)) {
    return NextResponse.json({ error: "pass ?key=<a valid feature key>" }, { status: 400 });
  }
  const check = await requireFeature(key);
  if (!check.ok) return check.response;
  return NextResponse.json({ allowed: true, result: check.result });
}
```

- [ ] **Step 7: Exercise it while still logged in (same browser session, cookies attached)**

```
GET /api/_debug/check-feature?key=catalog
```

Expected: `403` with `{"error":"This feature is not available on your current plan","reason":"disabled"}` (catalog is off by default per the seed).

```
GET /api/_debug/check-feature?key=ai_design
```

Expected: `200` with `{"allowed":true,"result":{"allowed":true,"organizationId":"...","staffId":"...","access":{"enabled":true,"limitValue":150,"used":0,"remaining":150}}}` (or whatever was actually seeded).

- [ ] **Step 8: Confirm it blocks a real limit, not just a toggle**

Via `mcp__supabase__execute_sql`, find the seeded `ai_design` limit and insert exactly that many `usage_logs` rows for the test org this month:

```sql
select limit_value from plan_features pf
  join organizations o on o.plan_id = pf.plan_id
 where o.id = '<seeded-org-id>' and pf.feature_key = 'ai_design';
-- e.g. 150 -- use the real number in the next statement

insert into usage_logs (organization_id, feature_key, action)
select '<seeded-org-id>', 'ai_design', 'batch_generated'
from generate_series(1, 150); -- replace 150 with the real limit_value from above
```

Repeat Step 7's `ai_design` request:

```
GET /api/_debug/check-feature?key=ai_design
```

Expected: `403` with `{"error":"Usage limit reached for this feature this period","reason":"limit_reached"}`.

Clean up:

```sql
delete from usage_logs where organization_id = '<seeded-org-id>' and feature_key = 'ai_design' and action = 'batch_generated';
```

- [ ] **Step 9: Delete both throwaway files**

```bash
rm -rf "src/app/(staff)/studio/_debug"
rm -rf "src/app/api/_debug"
```

- [ ] **Step 10: Confirm the app still builds clean with the debug files gone**

Run: `npx tsc --noEmit -p .` and `npm run build`
Expected: both succeed with no errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Verify permission foundation end-to-end (debug scaffolding removed)"
```

---

## Self-Review Notes

- **Spec/scope coverage:** state management (Task 3), fetched on app load per the confirmed refresh policy (Task 7), frontend gating primitive (Task 4), backend enforcement that independently re-checks rather than trusting the client (Task 5), usage logging (Task 6) — every piece the user asked for has a task, and Task 8 proves they work together against real seeded data, not just that they type-check.
- **No feature actually gated:** confirmed — Tasks 1–7 add only reusable plumbing; Task 8's debug page/route are explicitly temporary and deleted in the same task, so no permanent code depends on them.
- **Fail-closed confirmed:** `checkFeature()`'s `check_failed` path returns `allowed: false`; there is no code path where a Supabase error results in `allowed: true`.
- **Type/name consistency:** `FeatureKey`, `FeatureAccess`/`FeatureAccessInfo`, `organizationId`/`organization_id` (JS camelCase vs. DB snake_case, mapped explicitly at each boundary) are used identically across Tasks 2–8.
- **Dependency on the schema plan is explicit and checked first:** Task 8 Step 1 fails loudly (and tells the executor to stop) if the schema plan wasn't actually applied, rather than this plan silently assuming it.
