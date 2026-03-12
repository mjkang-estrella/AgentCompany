# Reader

Reader is a standalone private RSS reader app with a lightweight HTML client, a small Node BFF, and Supabase-backed persistence plus scheduled syncing.

The reader is page-based by default: it loads exact sidebar counts plus the newest 50 summaries first, fetches the selected article body separately, and appends older summaries with infinite scroll.

Adding a feed is now treated as create-and-sync: the app verifies that the initial sync actually starts before considering the feed added.

During sync, the reader prefers richer feed-provided sources when available. For example, if an RSS item exposes a custom markdown source URL, the sync job uses that instead of scraping the public article page.

When a feed exposes article imagery, the sync job stores `thumbnail_url` on the article and the reader uses it as a hero image at the top of the opened document when appropriate.

## Owns

- Reader-inspired article list and reading surface
- Local app runtime and JSON API for the reader UI
- Vercel-compatible `api/*` functions and deployment config
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

## Vercel deployment

This app can be deployed from the `apps/reader` directory on Vercel.

- `Application Preset`: `Other`
- `Root Directory`: `apps/reader`
- `Build Command`: leave blank
- `Output Directory`: leave blank
- `Install Command`: `npm install`

Set these Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`

Do not set `PORT` on Vercel. The deployed app uses static files plus the Vercel Functions defined under [apps/reader/api](/Users/mjkang/Develop/AgentCompany/apps/reader/api) and the rewrite rules in [apps/reader/vercel.json](/Users/mjkang/Develop/AgentCompany/apps/reader/vercel.json).

## Supabase setup

- Apply the SQL migrations in [apps/reader/supabase/migrations](/Users/mjkang/Develop/AgentCompany/apps/reader/supabase/migrations).
- Deploy the Edge Function in [apps/reader/supabase/functions/sync-feeds/index.ts](/Users/mjkang/Develop/AgentCompany/apps/reader/supabase/functions/sync-feeds/index.ts).
- Create Vault secrets named `reader_project_url` and `reader_function_api_key`.
- Keep `pg_cron` and `pg_net` enabled so the 15-minute sync job can invoke `sync-feeds`.
