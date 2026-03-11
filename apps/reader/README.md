# Reader

Reader is a standalone private RSS reader app with a lightweight HTML client, a small Node BFF, and Supabase-backed persistence plus scheduled syncing.

## Owns

- Reader-inspired article list and reading surface
- Local app runtime and JSON API for the reader UI
- Feed discovery, article state, and manual sync triggers
- Supabase schema and Edge Function assets owned by this app

## Does not own

- Inbox ingestion, webhook handling, or persistence
- Prism workflows
- Shared runtime code for other apps

## Commands

```bash
npm install
npm run dev
npm test
```

The app serves [index.html](/Users/mjkang/Develop/AgentCompany/apps/reader/index.html) at `http://127.0.0.1:4173`.

## Environment

Copy [apps/reader/.env.example](/Users/mjkang/Develop/AgentCompany/apps/reader/.env.example) to `apps/reader/.env` or `apps/reader/.env.local` and set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
- `PORT` (optional, defaults to `4173`)

Do not use a publishable key for the server. The Reader BFF performs admin reads and writes against Supabase.

## Supabase setup

- Apply the SQL migrations in [apps/reader/supabase/migrations](/Users/mjkang/Develop/AgentCompany/apps/reader/supabase/migrations).
- Deploy the Edge Function in [apps/reader/supabase/functions/sync-feeds/index.ts](/Users/mjkang/Develop/AgentCompany/apps/reader/supabase/functions/sync-feeds/index.ts).
- Create Vault secrets named `reader_project_url` and `reader_function_api_key`.
- Keep `pg_cron` and `pg_net` enabled so the 15-minute sync job can invoke `sync-feeds`.
