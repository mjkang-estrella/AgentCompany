# Prism

Prism is a standalone Next.js clarification workspace for turning rough ideas into execution-ready specs.

## Owns

- Clarification UI
- Session and draft editing surfaces
- Prism-specific prompt and research logic
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
- Export shared secrets in your shell or mirror the needed keys locally when running Prism
- App-local overrides belong in `apps/prism/.env.local`
- Commit only [apps/prism/.env.example](/Users/mjkang/Develop/AgentCompany/apps/prism/.env.example)
