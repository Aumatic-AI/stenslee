# Stenslee Studio — rules for Claude Code

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know
This is Next.js 16 — APIs, conventions and file structure differ from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before writing code you're unsure about, and heed deprecation notices. Middleware is `src/proxy.ts` (must stay inside `src/`).
<!-- END:nextjs-agent-rules -->

## What this app is
The studio dashboard (`dashboard.stenslee.com`): tattoo studios' admins and designers manage customers, create AI tattoo designs, preview them on the body, print stencils, keep a design library and message customers on WhatsApp. Customers never log in. Multi-studio: every row is scoped by `organization_id` and protected by RLS.

Full documentation lives in `../docs/` — start with `../docs/README.md`. Read the doc for the feature you are changing before you change it, and update it after.

| Working on | Read |
|---|---|
| Login, signup, single device, proxy | `../docs/features/login-and-signup.md` |
| Customers, phone verification | `../docs/features/customers.md` |
| AI design, chat, rework, prompts | `../docs/features/ai-design/` |
| Placement preview, stencil PDF | `../docs/features/placement-and-stencil/` |
| Library | `../docs/features/library.md` |
| WhatsApp | `../docs/features/whatsapp/` |
| Plans, feature keys, credits, upgrade | `../docs/features/plans-credits-permissions/` |
| Dashboard, designers, trash | `../docs/features/studio-admin.md` |
| Tables, RLS, functions, storage | `../docs/database.md` |
| System design, env vars | `../docs/architecture.md` |

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
- `../supabase-schema.sql` is out of date — the live database is the truth (`../docs/database.md`).
