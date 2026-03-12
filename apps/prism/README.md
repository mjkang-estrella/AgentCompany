# Prism

Prism is a standalone Next.js clarification workspace for turning rough ideas into execution-ready specs. It deploys as a Next.js app on Vercel and stores durable state in Supabase.

## Owns

- Clarification UI
- Session and draft editing surfaces
- Prism-specific prompt and research logic
- Prism-owned Supabase schema and migrations
- Prism test fixtures and supporting data

## Does not own

- Reader UI
- Inbox ingestion or persistence logic
- Wallet operations

## Boundary rules

- Keep Prism self-contained under `apps/prism`.
- Do not import from other app directories.
- Share only stable config or generic utilities through `../../packages`.

## Commands

```bash
# install dependencies from the repo root once
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
```

## Environment

- Next.js loads app-local env files, not the repo root `.env`
- Put Prism runtime values in `apps/prism/.env.local`
- Configure these values for local dev and Vercel:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
  - `NEXT_PUBLIC_APP_URL`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `EXA_API_KEY`
- Prism uses Supabase for local and hosted persistence. There is no local SQLite fallback.
- Commit only [apps/prism/.env.example](/Users/mjkang/Develop/AgentCompany/apps/prism/.env.example)

## Vercel Deployment

Prism deploys from the `apps/prism` directory on Vercel using the standard Next.js preset.

- `Framework Preset`: `Next.js`
- `Root Directory`: `apps/prism`
- `Install Command`: `npm install`
- `Build Command`: leave the default Next.js build

Set these Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `EXA_API_KEY`

## Supabase Setup

- Apply the SQL migration in [apps/prism/supabase/migrations](/Users/mjkang/Develop/AgentCompany/apps/prism/supabase/migrations).
- Prism uses server-side route handlers with a privileged Supabase key. Do not expose a publishable key in the browser for v1.
- The Prism tables run with RLS enabled and no `anon` or `authenticated` policies.
