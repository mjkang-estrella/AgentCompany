# Reader

Reader is a standalone private RSS reader app with a lightweight HTML/CSS/JS client, static hosting, and a Convex backend for persistence, pagination, and scheduled syncing.

The reader is page-based by default: it loads exact sidebar counts plus the newest 50 summaries first, fetches the selected article body separately, and appends older summaries with infinite scroll. Article summaries and article bodies are stored in the `articleBodies` Convex table so list queries do not read full HTML blobs. The legacy optional body fields on `articles` are retained only for migration/backfill compatibility.

The `Today` view is a cached Daily Digest. Each morning, Convex generates one AI-written digest grouped by feed for the current digest timezone. Opening `Today` loads that digest directly instead of auto-opening the first article body, and the digest header can navigate across previously generated digest dates.

Every article also gets an AI summary in the Inspector panel on the right of the reading pane, above the highlights. It is built for scanning before reading: a one-to-two sentence gist, three to six key points that follow the article's own order, and a one-line takeaway. Summaries are generated at sync time: feed sync, newsletter polling, and Library imports queue every new or content-changed article for summarization right after it is stored, so the summary is normally ready before the article is opened. Opening an article that still has no fresh summary (older archive items, re-extracted bodies, or a failed run) generates one on the spot; a summary is regenerated only when the stored body changes or you press the regenerate button in the panel. Summary rows live in the `articleSummaries` Convex table and are removed with the article.

Adding a feed is asynchronous: the app creates the feed immediately, makes it visible in the feed list, and queues the first sync in Convex.

Feeds can be removed from the article-list overflow menu while a feed is selected. Removing a feed permanently deletes all RSS feeds in that feed group and all synced articles attached to them.

Reader also has a separate `Library` section in the sidebar. It accepts a single pasted article or YouTube URL, dedupes by canonical URL, and adds the result into `All Articles`, `Today`, and `Saved` without creating an RSS subscription. Standard pages use the readable-body extractor directly. YouTube URLs are converted into transcript-backed articles when captions are available, and otherwise fall back to the video description.

For X URLs, Reader resolves direct status links and `t.co` redirects through the same import path. It prefers a complete long-form page extraction, recovers redirect-shaped titles and generic X attribution, and applies the X article normalizer before storage. Ordinary short posts fall back to X oEmbed. The normalizer promotes numbered sections to headings and removes profile and engagement chrome from the reading copy.

Individual articles can be deleted from the top-right actions in the reading pane. Deletions are soft for feed-backed items so they stay gone on later syncs.

During sync and manual article import, the reader uses Defuddle with a Node DOM shim to extract readable article bodies from fetched pages. A server-side body normalizer removes duplicated lead metadata, utility links, and promo/footer chrome before the article is stored. If an RSS item exposes a richer custom markdown source URL, the sync job still prefers that over page extraction. Scheduled sync runs once an hour and only rewrites feed items when their content hash changes. Weak recent bodies are treated as repair candidates, and opening any summary-only article performs one bounded re-extraction attempt while retaining a manual retry action.

Manual article import can optionally fall back to a rendered Browser Use session when a site blocks direct fetching, returns a transient server error, or serves an unusable server-rendered shell. The fallback starts from the site's relevant listing page so client-side-only article routes can render, returns structured Markdown, and passes the result through Reader's normal sanitization and normalization pipeline. Browser Use is never used for successful direct extractions.

When a feed exposes article imagery, the sync job stores `thumbnail_url` on the article and the reader uses it as a hero image at the top of the opened document when appropriate.

Reader is installable as a home-screen app. It ships a web app manifest, Apple home-screen metadata, PNG app icons under `icons/`, and a network-first service worker (`sw.js`) that only falls back to cached files when offline, so an installed copy never shows a stale interface while online. Browser modules are cache-busted through the import map in `index.html`; bump the shared `?v=` there whenever `app.js`, `icons.js`, `styles.css`, or any `lib/` module used by the browser changes. The Cloudflare proxy in front of `reader.mj-kang.com` extends the browser cache for scripts to four hours, so a stale module paired with a fresh `app.js` breaks startup otherwise; `test/pwa.test.mjs` checks that every module reachable from `app.js` is versioned. On iPhone, open the site in Safari, tap Share, then "Add to Home Screen"; the app launches full-screen with the status bar handled through safe-area insets; following Apple's Human Interface Guidelines for iOS 26, the phone tab bar floats above content on a translucent pill, inset from the edges and resting above the home indicator's safe area, with the list and reading surfaces reserving clearance beneath it.

On narrow screens, Reader becomes a two-step flow: the navigation rail turns into a floating bottom tab bar, the article list fills the screen, and selecting or deep-linking to an article or book opens a full-screen reading surface with a list (hamburger) button in place of the tab bar; the button uses a list icon so it is not confused with the previous/next chevrons beside it. The `Today` tab opens the digest directly, and the list button steps from a digest article to the digest and then to the calendar list. Article actions collapse into a compact overflow menu. Desktop keeps the side-by-side rail, list, and reading pane. Motion uses compositor-friendly list and article transitions and respects `prefers-reduced-motion`.

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

The Inspector AI summary uses the same `OPENAI_API_KEY`. It reuses `READER_DIGEST_MODEL` unless you set:

- `READER_SUMMARY_MODEL` (optional, defaults to the digest model)

Without `OPENAI_API_KEY` on the Convex deployment, sync skips summary generation and the Inspector shows a short note instead of a summary.

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

## Remote MCP for AI Newsletter

Endpoint shape: `https://<deployment>.convex.site/mcp`. After production deployment,
Reader's endpoint is **https://quixotic-condor-161.convex.site/mcp** (confirmed from
Reader's public `/api/config`). Convex HTTP actions serve stateless Streamable HTTP
with JSON responses, no sessions or SSE streams. Supported protocol versions:
`2025-11-25`, `2025-06-18`, `2025-03-26`. GET/DELETE return 405.

All requests require `Authorization: Bearer <READER_MCP_TOKEN>`; an absent,
incorrect, or unconfigured token returns 401. Native Web Crypto HMAC verification
provides constant-time MAC comparison. Origin, when present, must match the
endpoint's origin or `https://reader.mj-kang.com`. Server-to-server clients
normally omit Origin. Configure the bot with the endpoint and a custom bearer
header; OAuth discovery/registration is not implemented.

From `apps/reader`, set a development token with `npx convex env set READER_MCP_TOKEN`
(the CLI prompts for its value), then run `npx convex dev --once`. Use a random,
high-entropy token stored in 1Password, not in source or the frontend.

**Production steps for MJ to approve, not performed by this PR:** select Reader's
production deployment, run `npx convex env set --prod READER_MCP_TOKEN`, then
`npx convex deploy` from `apps/reader`. Deployment also builds the title search
index. Verify the endpoint before connecting the bot. Rotating the env var
immediately invalidates the old token.

```bash
# Populate READER_MCP_TOKEN securely in your shell.
MCP_URL=https://quixotic-condor-161.convex.site/mcp
curl "$MCP_URL" \
  -H "Authorization: Bearer $READER_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"AI Newsletter","version":"1"}}}'
curl "$MCP_URL" \
  -H "Authorization: Bearer $READER_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
# Tool call body example:
# {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_digest","arguments":{}}}
```

Schemas (`?` means optional; unknown fields rejected; complete JSON Schemas are
returned by `tools/list`):

| Tool | Arguments |
| --- | --- |
| `get_digest` | `date?: YYYY-MM-DD` (default today in digest timezone) |
| `list_articles` | `feed?: string ID`, `feedGroup?: string`, `source?: "newsletter" or "feed" or "manual"`, `since?: UTC ISO timestamp`, `until?: UTC ISO timestamp`, `saved?: boolean`, `limit?: integer 1–50`, `cursor?: string` |
| `get_article` | `id: string`, `includeBody?: boolean`, `bodyOffset?: integer 0–10000000`, `bodyLimit?: integer 1–12000` |
| `search_articles` | `query: string 1–200 chars`, `limit?: integer 1–50` |
| `list_feeds` | `limit?: integer 1–50`, `cursor?: string` |

Lists default to 20. `since` is inclusive, `until` exclusive, both UTC instants
such as `2026-11-15T00:00:00Z`. Article lists read one bounded page and apply
residual filters, so an empty page can still have `nextCursor`. Continue with
unchanged filters until the cursor is null. Newsletter feeds use the existing
`agentmail://newsletters/` URLs. Manual Library entries remain a separate source.
Search is native full-text **title** search, not body/summary substring search.

Article details include cached summary status, `isStale` (compared against the
current article body and title), gist, up to eight key points, and
takeaway (null if no summary). Optional plain-text bodies default to 6,000
characters; follow `body.nextOffset`. Metadata and summary strings are capped.
Digests use `READER_DIGEST_TIMEZONE` (default `America/Los_Angeles`), cap at 30
sections/100 article references, and report `truncated`. Deleted references are
omitted; cached prose may still mention deleted articles. Source URLs and Reader
slug links are included; duplicate titles can make existing Reader slug routing
ambiguous. Tools never generate summaries, fetch pages, or mutate data.

### Existing public-function auth finding

Existing public Reader Convex queries, mutations, and actions have no identity
checks or authorization guards. Anyone with the deployment URL can call them:
examples include `reader:listArticles`, `reader:getArticle`, `digest:getForDate`,
`reader:updateArticle`, `reader:deleteArticle`, and `feeds:removeFeedGroup`.
Public actions also expose imports, syncs, and AI generation. Reader publishes
the deployment URL via `/api/config`. **The MCP token protects only `/mcp`, not
these existing functions.** Their behavior is unchanged here; securing them needs
a separate client/auth migration. The new MCP data query is internal-only.

Validation for this implementation: `npm test --workspace apps/reader` passes
106 tests, including MCP transport/auth and data-adapter tests. An anonymous local
Convex deployment also passed initialize, tools/list, all five tools/call, and
401 smoke checks. Reader has no existing lint/typecheck scripts. Targeted ESLint
(no-unused-vars/no-unreachable) passes for the added JavaScript. A strict Convex
TypeScript check using the CLI-generated configuration reports 73 pre-existing
diagnostics, identical to the unchanged baseline; this PR adds none. Those
existing errors are outside this feature's scope, so a fully green strict
backend typecheck remains outstanding.
