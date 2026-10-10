# Stenslee Studio

The studio dashboard for Stenslee (`dashboard.stenslee.com`). Tattoo studio admins and designers log in with a WhatsApp code to manage customers, create AI tattoo designs, preview them on the customer's body, print stencils, keep a design library and message customers on WhatsApp. Customers never log in.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS v4
- Supabase — Postgres (multi-studio with RLS), Auth (phone login, codes via WhatsApp), Storage, Realtime
- KIE.ai (image models), OpenAI (description enhancer), Meta WhatsApp Business Platform

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

Create `.env.local` with the variables listed in the workspace docs (`docs/architecture.md` → Environment variables).

## Documentation

Full documentation lives in the workspace `docs/` folder (one level up, outside this repo): overview, architecture, database, development guide and a doc per feature. Rules for Claude Code are in [`CLAUDE.md`](./CLAUDE.md).
