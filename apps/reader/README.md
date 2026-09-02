# Reader

Reader is a standalone private RSS reader app with a lightweight HTML/CSS/JS client, static hosting, and a Convex backend for persistence, pagination, and scheduled syncing.

The reader is page-based by default: it loads exact sidebar counts plus the newest 50 summaries first, fetches the selected article body separately, and appends older summaries with infinite scroll. Article summaries and article bodies are stored in the `articleBodies` Convex table so list queries do not read full HTML blobs. The legacy optional body fields on `articles` are retained only for migration/backfill compatibility.

The `Today` view is a cached Daily Digest. Each morning, Convex generates one AI-written digest grouped by feed for the current digest timezone. Opening `Today` loads that digest directly instead of auto-opening the first article body, and the digest header can navigate across previously generated digest dates.

Adding a feed is asynchronous: the app creates the feed immediately, makes it visible in the feed list, and queues the first sync in Convex.

Feeds can be removed from the article-list overflow menu while a feed is selected. Removing a feed permanently deletes all RSS feeds in that feed group and all synced articles attached to them.

Reader also has a separate `Library` section in the sidebar. It accepts a single pasted article or YouTube URL, dedupes by canonical URL, and adds the result into `All Articles`, `Today`, and `Saved` without creating an RSS subscription. Standard pages use the readable-body extractor directly. YouTube URLs are converted into transcript-backed articles when captions are available, and otherwise fall back to the video description.

For X URLs, Reader resolves direct status links and `t.co` redirects through the same import path. It prefers a complete long-form page extraction, recovers redirect-shaped titles and generic X attribution, and applies the X article normalizer before storage. Ordinary short posts fall back to X oEmbed. The normalizer promotes numbered sections to headings and removes profile and engagement chrome from the reading copy.

Individual articles can be deleted from the top-right actions in the reading pane. Deletions are soft for feed-backed items so they stay gone on later syncs.

During sync and manual article import, the reader uses Defuddle with a Node DOM shim to extract readable article bodies from fetched pages. A server-side body normalizer removes duplicated lead metadata, utility links, and promo/footer chrome before the article is stored. If an RSS item exposes a richer custom markdown source URL, the sync job still prefers that over page extraction. Scheduled sync runs once an hour and only rewrites feed items when their content hash changes. Weak recent bodies are treated as repair candidates, and opening any summary-only article performs one bounded re-extraction attempt while retaining a manual retry action.

Manual article import can optionally fall back to a rendered Browser Use session when a site blocks direct fetching, returns a transient server error, or serves an unusable server-rendered shell. The fallback starts from the site's relevant listing page so client-side-only article routes can render, returns structured Markdown, and passes the result through Reader's normal sanitization and normalization pipeline. Browser Use is never used for successful direct extractions.

When a feed exposes article imagery, the sync job stores `thumbnail_url` on the article and the reader uses it as a hero image at the top of the opened document when appropriate.

Reader is installable as a home-screen app. It ships a web app manifest, Apple home-screen metadata, PNG app icons under `icons/`, and a network-first service worker (`sw.js`) that only falls back to cached files when offline, so an installed copy never shows a stale interface while online. On iPhone, open the site in Safari, tap Share, then "Add to Home Screen"; the app launches full-screen with the status bar and home indicator handled through safe-area insets.

On narrow screens, Reader becomes a two-step flow: the navigation rail turns into a bottom tab bar, the article list fills the screen, and selecting or deep-linking to an article or book opens a full-screen reading surface with a back button in place of the tab bar. The `Today` tab opens the digest directly, and the back button steps from a digest article to the digest and then to the calendar list. Article actions collapse into a compact overflow menu. Desktop keeps the side-by-side rail, list, and reading pane. Motion uses compositor-friendly list and article transitions and respects `prefers-reduced-motion`.

Reader can also ingest email newsletters through AgentMail. Newsletters sent to the configured inbox are polled into the app once an hour, grouped under sender-based feed groups, and stored as normal Reader articles so they show up in `Today`, `All Articles`, and the digest pipeline.

## Owns

- Reader-inspired article list and reading surface
- Local static runtime, stylesheet, and public config endpoint for the reader UI
- Convex schema, functions, cron sync, and import tooling
- Feed discovery, article state, and manual sync triggers
- AgentMail-backed newsletter polling and ingestion into Reader articles

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

If you want rendered-browser fallback for manual article imports:

- `BROWSER_USE_API_KEY`
- `READER_BROWSER_USE_MODEL` (optional, defaults to `bu-mini`)
- `READER_BROWSER_USE_MAX_COST_USD` (optional, defaults to `0.25` per fallback)
- `READER_BROWSER_USE_TIMEOUT_MS` (optional, defaults to `180000`)

Because extraction runs inside Convex, configure the key on the active Convex deployment as well as in local development:

```bash
npx convex env set BROWSER_USE_API_KEY
```

The Reader host only serves static assets and exposes `CONVEX_URL` to the browser through `/api/config`.

If you want Daily Digest generation:

- `OPENAI_API_KEY`
- `READER_DIGEST_MODEL` (optional, defaults to `gpt-4.1-mini`)
- `READER_DIGEST_TIMEZONE` (optional, defaults to `America/Los_Angeles`)

If you want email newsletters inside Reader:

- `AGENTMAIL_API_KEY`
- `READER_NEWSLETTER_INBOX_EMAIL` (optional, defaults to `news@mj-kang.com`)

Reader polls unread messages from that AgentMail inbox once an hour. The first sync will try to create the inbox automatically if it does not already exist, which means the domain behind `READER_NEWSLETTER_INBOX_EMAIL` must already be verified in AgentMail.

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
