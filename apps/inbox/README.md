# Inbox

Inbox is a standalone Node.js app for newsletter ingestion, webhook handling, note extraction, and inbox-facing APIs.

## Owns

- AgentMail webhook ingestion
- Email persistence and note storage
- Note extraction pipeline
- Inbox HTTP routes and JSON payloads

## Does not own

- Reader UI
- Prism clarification workflows
- Wallet authentication flows

## Boundary rules

- Keep ingestion, persistence, and API behavior inside `apps/inbox`.
- Other apps should integrate through HTTP, CLI, or exported files, not source imports.
- Treat local SQLite data and worker behavior as Inbox-owned internals.

## Commands

```bash
npm test
npm run dev
```

## Environment

- Inbox can read `apps/inbox/.env` and can also fall back to the repo root `.env` for shared secrets
- App-local overrides belong in `apps/inbox/.env`
- Commit only [apps/inbox/.env.example](/Users/mjkang/Develop/AgentCompany/apps/inbox/.env.example)
