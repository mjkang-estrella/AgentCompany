# Prism

Prism is a standalone Next.js clarification workspace for turning rough ideas into execution-ready specs. It deploys on Vercel and stores durable state in Convex.

## Owns

- Clarification UI
- Session and draft editing surfaces
- Prism-specific prompt and research logic
- Prism-owned Convex schema and functions
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
  - `CONVEX_DEPLOYMENT` for local Convex development
  - `NEXT_PUBLIC_CONVEX_URL`
  - `NEXT_PUBLIC_APP_URL`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `EXA_API_KEY`
- Prism uses separate Convex development and production deployments.
- Commit only [apps/prism/.env.example](/Users/mjkang/Develop/AgentCompany/apps/prism/.env.example)

## Vercel Deployment

Prism deploys from the `apps/prism` directory on Vercel using the standard Next.js preset.

- `Framework Preset`: `Next.js`
- `Root Directory`: `apps/prism`
- `Install Command`: `npm install`
- `Build Command`: `npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd "npm run build"`

Set these Vercel environment variables:

- `CONVEX_DEPLOY_KEY`
- `NEXT_PUBLIC_APP_URL`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `EXA_API_KEY`

## Convex setup

- Run `npx convex dev` from `apps/prism` to configure or update the development deployment.
- Convex functions live in `apps/prism/convex` and preserve Prism's external UUID session IDs.
- Next.js route handlers keep the LLM workflow server-side and use the Convex HTTP client for persistence.
