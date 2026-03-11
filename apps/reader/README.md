# Reader

Reader is a standalone Next.js app that recreates the public Readwise Reader login shell and a mock authenticated workspace.

## Owns

- Reader-style UI surface
- Mock reading data and local interactions
- Reader-specific layout, notes, and chat panels

## Does not own

- Inbox ingestion logic
- Prism clarification flows
- Wallet operations

## Boundary rules

- Keep Reader self-contained under `apps/reader`.
- Do not import source code from another app.
- Share only stable generic code through `../../packages`.

## Routes

- `/login` recreates the public Readwise auth screen
- `/` renders the authenticated Reader-style app shell

## Commands

```bash
# install dependencies from the repo root once
npm run dev -- --port 3100
npm run build
npm run lint
npm run typecheck
```

## Environment

- Next.js loads app-local env files, not the repo root `.env`
- App-local overrides belong in `apps/reader/.env.local`
- Commit only [apps/reader/.env.example](/Users/mjkang/Develop/AgentCompany/apps/reader/.env.example)

## Notes

- The current app uses mock data and local interactions only.
- Exact parity with the production Reader product would require authenticated product access.
