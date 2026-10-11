# Stenslee Studio — rules for Claude Code

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know
This is Next.js 16 — APIs, conventions and file structure differ from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before writing code you're unsure about, and heed deprecation notices. Middleware is `src/proxy.ts` (must stay inside `src/`).
<!-- END:nextjs-agent-rules -->

## What this app is
The studio dashboard (`dashboard.stenslee.com`): tattoo studios' admins and designers manage customers, create AI tattoo designs, preview them on the body, print stencils, keep a design library and message customers on WhatsApp. Customers never log in. Multi-studio: every row is scoped by `organization_id` and protected by RLS.

Docs live in `docs/`. Read the relevant section before changing something, and update it when behaviour changes.

| Working on | Read |
|---|---|
| Architecture, how a request flows | `docs/technical.md` §1–2 |
| Login, signup, one device, proxy | `docs/technical.md` §3 |
| RLS, which Supabase client, phone formats | `docs/technical.md` §4–5 |
| Plans, feature keys, seats, credits | `docs/technical.md` §6 |
| AI generation, jobs, prompts, session state | `docs/technical.md` §7–8 |
| Images and storage | `docs/technical.md` §9 · `docs/database.md` §6 |
| WhatsApp | `docs/technical.md` §10 |
| Trash, retention, purge | `docs/technical.md` §11 |
| Adding a route, feature key, table or AI action | `docs/technical.md` §13 (recipes) |
| Env vars, local dev, production | `docs/technical.md` §14–16 |
| Known issues | `docs/technical.md` §17 · `docs/database.md` §10 |
| Tables, columns, RLS, functions, triggers | `docs/database.md` |

## Commands
```bash
npm run dev                 # next dev --webpack, http://localhost:3000
npx tsc --noEmit -p .       # type check
npx eslint <changed files>  # lint
npx next build              # production build (stop the dev server first)
```
No automated tests: type check + lint + build, then exercise the feature in a browser (also at 390 px width).

## Rules
- **Comments:** one short line, two at most. Never paragraph comments.
- **Soft delete:** sessions, staff and library files use `deleted_at`; every list query filters `deleted_at is null`. Permanent deletion only via `/api/studio/trash/[id]` or the purge job.
- **Long AI work = start job + poll** (`src/lib/generation-jobs.ts` + `/api/generation-status`). Never hold a request open.
- **AI credits:** reserve before calling KIE, refund on failure (`src/lib/credits.ts`).
- **Feature checks:** server routes use `requireFeature` / `requireSeatAvailable` (`src/lib/permissions/require-feature.ts`). New feature keys go in `src/lib/permissions/feature-keys.ts` AND `../super-admin/src/lib/feature-registry.ts`.
- **Database access:** browser Supabase client by default (RLS protects it). Service role (`createServiceClient`) only in server files and only when RLS must be skipped.
- **Privileged routes** must check the caller's role AND that the target row belongs to the caller's studio.
- **UI:** no native `<select>` (use the custom dropdowns); phone fields use `<PhoneInput>` + `src/lib/phone.ts`; dark/gold theme tokens.
- **Prompts:** keep AI prompts short and direct.
- **Login-code hook** (`/api/auth/send-whatsapp-otp`) must answer refusals with HTTP 200 + `{error:{http_code,message}}`, and finish well inside Supabase's ~5 s limit.
- **JSX spacing:** after a closing tag followed by text that contains HTML entities (`&rsquo;` etc.), write an explicit `{" "}`.

## Gotchas
- One Supabase project is shared by local dev and production — data changes are real.
- One Send SMS hook for the whole project; pointing it at a local/ngrok URL breaks production logins.
- One Meta webhook URL per app (production) — delivery statuses never reach a local server.
- Server calls to `supabase.co` failing (`ECONNRESET`, `check_failed`) on this Windows machine = ISP DNS block; DNS over HTTPS fixes it.
- Never run two dev servers (or a build) on this folder at once; after starting a background dev server, kill its `node.exe` when done.
- `../supabase-schema.sql` is out of date — the live database is the truth (`docs/database.md`). After a schema change, update `docs/database.md`.
