# Reader

Reader is a standalone private RSS reader app with a lightweight HTML client, static hosting, and a Convex backend for persistence, pagination, and scheduled syncing.

The reader is page-based by default: it loads exact sidebar counts plus the newest 50 summaries first, fetches the selected article body separately, and appends older summaries with infinite scroll. Article summaries and article bodies are stored separately in Convex so list queries do not read full HTML blobs.

The `Today` view is a cached Daily Digest. Each morning, Convex generates one AI-written digest grouped by feed for the current digest timezone. Opening `Today` loads that digest directly instead of auto-opening the first article body, and the digest header can navigate across previously generated digest dates.

Adding a feed is asynchronous: the app creates the feed immediately, makes it visible in the feed list, and queues the first sync in Convex.

Feeds can be removed from the article-list overflow menu while a feed is selected. Removing a feed permanently deletes all RSS feeds in that feed group and all synced articles attached to them.

Reader also has a separate `Library` section in the sidebar. It accepts a single pasted article or YouTube URL, dedupes by canonical URL, and adds the result into `All Articles`, `Today`, and `Saved` without creating an RSS subscription. Standard pages use the readable-body extractor directly. YouTube URLs are converted into transcript-backed articles when captions are available, and otherwise fall back to the video description.

Individual articles can be deleted from the top-right actions in the reading pane. Deletions are soft for feed-backed items so they stay gone on later syncs.

During sync and manual article import, the reader uses Defuddle with a Node DOM shim to extract readable article bodies from fetched pages. A server-side body normalizer removes duplicated lead metadata, utility links, and promo/footer chrome before the article is stored. If an RSS item exposes a richer custom markdown source URL, the sync job still prefers that over page extraction. Scheduled sync runs every 30 minutes and only rewrites feed items when their content hash changes.

When a feed exposes article imagery, the sync job stores `thumbnail_url` on the article and the reader uses it as a hero image at the top of the opened document when appropriate.

Reader can also ingest email newsletters through AgentMail. Newsletters sent to the configured inbox are polled into the app every 15 minutes, grouped under a synthetic `Newsletters` feed, and stored as normal Reader articles so they show up in `Today`, `All Articles`, and the digest pipeline.

## Owns

- Reader-inspired article list and reading surface
- Local static runtime and public config endpoint for the reader UI
- Convex schema, functions, cron sync, and import tooling
- Feed discovery, article state, and manual sync triggers
- AgentMail-backed newsletter polling and ingestion into Reader articles
- Legacy Supabase migration assets kept only for rollback and feed import

## Does not own

- Prism workflows
- Shared runtime code for other apps

## Commands

```bash
npm install
npm run dev
npm test
```

The app serves [index.html](/Users/mjkang/Develop/AgentCompany/apps/reader/index.html) at `http://127.0.0.1:4173`.

Convex backend code lives under [apps/reader/convex](/Users/mjkang/Develop/AgentCompany/apps/reader/convex).

## Environment

Copy [apps/reader/.env.example](/Users/mjkang/Develop/AgentCompany/apps/reader/.env.example) to `apps/reader/.env` or `apps/reader/.env.local` and set:

- `CONVEX_URL`
- `PORT` (optional, defaults to `4173`)

The Reader host only serves static assets and exposes `CONVEX_URL` to the browser through `/api/config`.

If you want Daily Digest generation:

- `OPENAI_API_KEY`
- `READER_DIGEST_MODEL` (optional, defaults to `gpt-4.1-mini`)
- `READER_DIGEST_TIMEZONE` (optional, defaults to `America/Los_Angeles`)

If you want email newsletters inside Reader:

- `AGENTMAIL_API_KEY`
- `READER_NEWSLETTER_INBOX_EMAIL` (optional, defaults to `news@mj-kang.com`)

Reader polls unread messages from that AgentMail inbox every 15 minutes. The first sync will try to create the inbox automatically if it does not already exist, which means the domain behind `READER_NEWSLETTER_INBOX_EMAIL` must already be verified in AgentMail.

If you want to import existing feed definitions from Supabase one time, also set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`

## Vercel deployment

This app can be deployed from the `apps/reader` directory on Vercel.

- `Application Preset`: `Other`
- `Root Directory`: `apps/reader`
- `Build Command`: leave blank
- `Output Directory`: leave blank
- `Install Command`: `npm install`

Set this Vercel environment variable:

- `CONVEX_URL`
- `HUGEICONS_AUTH_TOKEN` for the private `@hugeicons-pro/*` package install used by Reader icons

Do not set `PORT` on Vercel. The deployed app uses static files plus the public config function at [apps/reader/api/config.js](/Users/mjkang/Develop/AgentCompany/apps/reader/api/config.js).

## Convex setup

- Configure the app against your deployment URL, for example `https://quixotic-condor-161.convex.cloud`.
- Run `npm run convex:dev` once in [apps/reader](/Users/mjkang/Develop/AgentCompany/apps/reader) to generate Convex types and link the project locally.
- Deploy the backend with `npm run convex:deploy`.
- Cron syncing and Daily Digest scheduling are defined in [apps/reader/convex/crons.ts](/Users/mjkang/Develop/AgentCompany/apps/reader/convex/crons.ts).
- Newsletter polling is also scheduled in [apps/reader/convex/crons.ts](/Users/mjkang/Develop/AgentCompany/apps/reader/convex/crons.ts).

## One-off Supabase feed import

If you want to carry over existing feed definitions before cutover:

```bash
npm run import:feeds
```

That script reads `feeds` from Supabase and imports only feed definitions into Convex. It does not copy article history, `is_read`, or `is_saved`.
