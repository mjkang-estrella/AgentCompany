# Environment Strategy

This repository uses a two-layer environment model.

## 1. Root `.env`

Use the repository root `.env` as a shared local secret registry for repo-level tooling and secret sync.

Examples:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `EXA_API_KEY`
- `AGENTMAIL_API_KEY`

Rules:

- Commit only [.env.example](/Users/mjkang/Develop/AgentCompany/.env.example)
- Do not put app-only values here when they are meaningful only to one product
- `ops/id` syncs this file into 1Password on purpose
- Do not assume every framework auto-loads the root `.env`

## 2. App-local env files

Each app may have its own `.env.example` for app-specific runtime settings.

Examples:

- `apps/prism/.env.local` for local Next.js settings
- `apps/inbox/.env` for local server overrides
- `apps/reader/.env.local` for local app URL overrides

Rules:

- Commit only `.env.example`
- Prefer app-local files for ports, database paths, and public app URLs
- If an app runtime does not auto-load the root `.env`, export the values in your shell or mirror the required keys into the app-local env file

## Current policy

- Shared secret examples live in the repo root `.env.example`
- The real source of truth should be your shell environment or a secret manager such as 1Password
- The root `.env` is a local convenience file, not a guaranteed runtime loader for every app
- Prism owns `PRISM_CODEX_DB_PATH` and `NEXT_PUBLIC_APP_URL`
- Reader owns `NEXT_PUBLIC_APP_URL`
- Inbox owns `PORT`, `DATABASE_PATH`, and `SQLITE_PATH`
