import { buildSummarySourceHash } from "../lib/article-summary.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { handleMcp, tools, tokenMatches, validateArguments } from "../lib/mcp.mjs";
import { readTool } from "../lib/mcp-data.mjs";

// A bounded in-memory query adapter exercises the same data handlers as Convex.
function database({ changedBody = false, changedTitle = false, legacyBody = false } = {}) {
  const tables = {
    feeds: [{ _id: "f1", title: "RSS", feedUrl: "https://rss.test", isActive: true }, { _id: "f2", title: "Mail", feedUrl: "agentmail://newsletters/mail", isActive: true }],
    articles: [
      { _id: "a1", title: "AI News", url: "https://news.test/1", feedId: "f2", feedGroup: "AI", feedTitle: "Mail", publishedAt: Date.parse("2026-11-15T12:00:00Z"), isSaved: true, bodyHtml: "<p>legacy</p>" },
      { _id: "a2", title: "AI RSS", url: "https://news.test/2", feedId: "f1", feedTitle: "RSS", publishedAt: Date.parse("2026-11-14T12:00:00Z"), isSaved: false },
      { _id: "a3", title: "Deleted", publishedAt: 1, deletedAt: 2 },
      { _id: "a4", title: "Manual", url: "https://news.test/4", sourceType: "manual", publishedAt: 2, isSaved: false }
    ],
    articleBodies: [{ articleId: "a1", bodyHtml: "<p>abcdefghij</p>" }],
    articleSummaries: [{ articleId: "a1", status: "ready", gist: "Gist", keyPoints: ["Point"], takeaway: "Takeaway" }],
    dailyDigests: [{ localDate: "2026-11-14", timezone: "America/Los_Angeles", status: "ready", intro: "Today", articleCount: 2, sections: [{ feedTitle: "Mail", summary: "Summary", articles: [{ id: "a1" }, { id: "a3" }] }] }]
  };
  tables.articleSummaries[0].sourceHash = buildSummarySourceHash({ bodyHtml: legacyBody ? tables.articles[0].bodyHtml : tables.articleBodies[0].bodyHtml, title: tables.articles[0].title });
  if (changedBody) tables.articleBodies[0].bodyHtml = "<p>Updated content</p>";
  if (changedTitle) tables.articles[0].title = "Updated title";
  if (legacyBody) tables.articleBodies = [];
  return {
    normalizeId: (table, id) => id.startsWith(table === "articles" ? "a" : "f") ? id : null,
    get: async id => Object.values(tables).flat().find(row => row._id === id) || null,
    query(table) {
      let rows = [...tables[table]];
      const builder = {
        eq(key, value) { rows = rows.filter(row => row[key] === value); return this; },
        gte(key, value) { rows = rows.filter(row => row[key] >= value); return this; },
        lt(key, value) { rows = rows.filter(row => row[key] < value); return this; },
        search(key, value) { rows = rows.filter(row => row[key].toLowerCase().includes(value.toLowerCase())); return this; }
      };
      return {
        withIndex(_name, callback) { callback(builder); return this; },
        withSearchIndex(_name, callback) { callback(builder); return this; },
        order(direction) { rows.sort((a, b) => (a.publishedAt - b.publishedAt) * (direction === "desc" ? -1 : 1)); return this; },
        async paginate({ cursor, numItems }) { const start = Number(cursor || 0); return { page: rows.slice(start, start + numItems), isDone: start + numItems >= rows.length, continueCursor: String(start + numItems) }; },
        async unique() { return rows[0] || null; },
        async take(n) { return rows.slice(0, n); }
      };
    }
  };
}
const db = database();
const invoke = (name, args) => readTool(db, name, args, new Date("2026-11-15T02:00:00Z"));
const request = (message, overrides = {}) => new Request("https://test.convex.site/mcp", { method: "POST", headers: { authorization: "Bearer test-only-token", "content-type": "application/json", accept: "application/json, text/event-stream", ...overrides.headers }, body: typeof message === "string" ? message : JSON.stringify(message), ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "headers")) });
const serve = req => handleMcp(req, { token: "test-only-token", callTool: invoke });
const rpc = (method, params) => ({ jsonrpc: "2.0", id: 1, method, params });

test("native constant-time token verification and fail-closed auth", async () => {
  assert.equal(await tokenMatches("abc", "abc"), true);
  for (const supplied of ["abd", "abcd", "", undefined]) assert.equal(await tokenMatches("abc", supplied), false);
  assert.equal(await tokenMatches(undefined, "abc"), false);
  for (const authorization of ["", "Bearer wrong", "Basic test-only-token"]) {
    const response = await serve(request(rpc("tools/list"), { headers: { authorization } }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
  }
});
test("initialize, tools/list, and every tools/call through HTTP transport", async () => {
  const initialized = await (await serve(request(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })))).json();
  assert.equal(initialized.result.protocolVersion, "2025-06-18");
  const listed = await (await serve(request(rpc("tools/list")))).json();
  assert.equal(listed.result.tools.length, 5);
  for (const tool of tools) {
    const args = tool.name === "get_article" ? { id: "a1", includeBody: true } : tool.name === "search_articles" ? { query: "AI" } : {};
    const response = await serve(request(rpc("tools/call", { name: tool.name, arguments: args })));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.result.isError, false, tool.name);
    assert.ok(JSON.parse(body.result.content[0].text));
  }
});
test("transport errors, notifications, origin and method validation", async () => {
  assert.equal((await serve(request({ jsonrpc: "2.0", method: "notifications/initialized" }))).status, 202);
  assert.equal((await serve(request(rpc("ping"), { headers: { origin: "https://evil.test" } }))).status, 403);
  assert.equal((await serve(new Request("https://test.convex.site/mcp", { headers: { authorization: "Bearer test-only-token" } }))).status, 405);
  assert.equal((await serve(request(rpc("ping"), { headers: { "mcp-protocol-version": "invalid" } }))).status, 400);
  assert.equal((await serve(request(rpc("ping"), { headers: { accept: "application/json" } }))).status, 406);
  for (const [message, code] of [["{", -32700], [[], -32600], [rpc("unknown"), -32601], [rpc("tools/call", { name: "mutate" }), -32602]]) {
    assert.equal((await (await serve(request(message))).json()).error.code, code);
  }
  const failed = await (await serve(request(rpc("tools/call", { name: "get_article", arguments: { id: "bad" } })))).json();
  assert.equal(failed.result.isError, true);
});
test("strict schemas reject malformed, oversized and out-of-range arguments", () => {
  for (const [name, args] of [["get_digest", { date: "2026-02-30" }], ["list_articles", { limit: 51 }], ["list_articles", { limit: 1.5 }], ["list_articles", { saved: "yes" }], ["list_articles", { since: "yesterday" }], ["get_article", { id: "a1", mutate: true }], ["search_articles", { query: " " }], ["get_article", { id: "a1", bodyOffset: -1 }]]) assert.throws(() => validateArguments(name, args));
});
test("article body pagination, summary, missing and deleted articles", async () => {
  const article = await invoke("get_article", { id: "a1", includeBody: true, bodyLimit: 4 });
  assert.equal(article.body.text, "abcd");
  assert.equal(article.body.nextOffset, 4);
  assert.equal(article.summary.gist, "Gist");
  assert.equal(article.readerUrl, "https://reader.mj-kang.com/all/ai-news");
  const tail = await invoke("get_article", { id: "a1", includeBody: true, bodyOffset: 8 });
  assert.equal(tail.body.text, "ij");
  assert.equal(tail.body.nextOffset, null);
  assert.equal((await invoke("get_article", { id: "a2" })).summary, null);
  assert.equal((await invoke("get_article", { id: "a1" })).body, undefined);
  await assert.rejects(invoke("get_article", { id: "a3" }));
});
test("digest timezone default, missing dates and deleted article exclusion", async () => {
  const digest = await invoke("get_digest", {});
  assert.equal(digest.date, "2026-11-14");
  assert.equal(digest.sections[0].articles.length, 1);
  assert.equal((await invoke("get_digest", { date: "2020-01-01" })).status, "missing");
});
test("article filters, feed/saved intersection and continuation across empty pages", async () => {
  assert.equal((await invoke("list_articles", { source: "newsletter" })).articles[0].id, "a1");
  assert.equal((await invoke("list_articles", { source: "feed" })).articles[0].id, "a2");
  assert.equal((await invoke("list_articles", { source: "manual" })).articles[0].id, "a4");
  assert.equal((await invoke("list_articles", { feed: "f2", saved: false })).articles.length, 0);
  assert.equal((await invoke("list_articles", { feedGroup: "AI", saved: true })).articles.length, 1);
  assert.equal((await invoke("list_articles", { since: "2026-11-14T00:00:00Z", until: "2026-11-15T00:00:00Z" })).articles[0].id, "a2");
  const first = await invoke("list_articles", { source: "feed", limit: 1 });
  assert.equal(first.articles.length, 0);
  assert.ok(first.nextCursor);
  assert.equal((await invoke("list_articles", { source: "feed", limit: 1, cursor: first.nextCursor })).articles[0].id, "a2");
});
test("feeds paginate with newsletter classification and search excludes deleted", async () => {
  const first = await invoke("list_feeds", { limit: 1 });
  const second = await invoke("list_feeds", { limit: 1, cursor: first.nextCursor });
  assert.equal(second.feeds[0].source, "newsletter");
  assert.equal(second.nextCursor, null);
  assert.equal((await invoke("search_articles", { query: "AI", limit: 1 })).articles.length, 1);
  assert.equal((await invoke("search_articles", { query: "Deleted" })).articles.length, 0);
});


test("cached summary freshness follows current body and title without requesting body output", async () => {
  for (const options of [{}, { legacyBody: true }]) {
    const result = await readTool(database(options), "get_article", { id: "a1" });
    assert.equal(result.summary.isStale, false);
    assert.equal(result.body, undefined);
  }
  for (const options of [{ changedBody: true }, { changedTitle: true }]) {
    const result = await readTool(database(options), "get_article", { id: "a1" });
    assert.equal(result.summary.isStale, true);
    assert.equal(result.summary.status, "ready");
    assert.equal(result.body, undefined);
  }
});
