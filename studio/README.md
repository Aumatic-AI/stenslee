# Cleopatra Ink Studio

AI-powered tattoo design platform for **in-shop use by staff**. A designer looks up (or creates) a customer by phone, runs the flow — style → generate → refine → placement → finalize — and prints an A4 stencil. Customers never log in; staff act on their behalf.

See [`AGENTS.md`](./AGENTS.md) for the full architecture reference and [`progress.md`](./progress.md) for status.

## Stack

- **Next.js** (App Router) + TypeScript
- **Supabase** — Auth (staff), PostgreSQL, Storage (`session-assets`)
- **KEI API** (`api.kie.ai`) — `gpt-image-2-image-to-image` for design generation, `nano-banana-pro` for the final body-placement render
- **Tailwind CSS v4** — dark/gold theme, Cinzel font

## Getting Started

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint
```

## Environment Variables

Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
KEI_API_KEY
CRON_SECRET                  # shared secret for the session-cleanup cron
PINTEREST_ACCESS_TOKEN       # optional — enables Pinterest reference search
```

## Database Setup

Run `supabase-schema.sql` in the Supabase SQL editor (creates tables, RLS, functions, storage buckets, seeds the admin). After deploying, uncomment and run the cron block at the bottom of that file to enable session cleanup.
