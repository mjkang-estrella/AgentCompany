import { stripHtml } from "./html.mjs";
import { slugifySegment } from "./reader-routes.mjs";
import { getDigestTimezone, getTimeZoneDateKey } from "./daily-digest.mjs";
import { validateArguments } from "./mcp.mjs";

const clip = (value, length = 1000) => String(value || "").slice(0, length);
const readerUrl = title => `https://reader.mj-kang.com/all/${slugifySegment(title)}`;
const metadata = article => ({
  id: article._id, title: clip(article.title), url: article.url,
  readerUrl: readerUrl(article.title), author: clip(article.author, 300),
  feed: article.feedId ?? null, feedGroup: article.feedGroup || article.feedFolder || "",
  feedTitle: clip(article.feedTitle, 300), sourceType: article.sourceType || "feed",
  publishedAt: new Date(article.publishedAt).toISOString(), saved: article.isSaved,
  previewText: clip(article.previewText)
});
const byArticle = (db, table, id) => db.query(table).withIndex("by_article_id", q => q.eq("articleId", id)).unique();
const isNewsletter = feed => feed?.feedUrl.startsWith("agentmail://newsletters/") || false;

// Internal read-only adapter. One bounded page per request; no scheduler/actions/mutations.
export async function readTool(db, name, input, now = new Date()) {
  const args = validateArguments(name, input);
  const limit = args.limit ?? 20;
  if (name === "get_article") {
    const id = db.normalizeId("articles", args.id);
    const article = id ? await db.get(id) : null;
    if (!article || article.deletedAt !== undefined) throw new Error("Article not found");
    const summary = await byArticle(db, "articleSummaries", id);
    const result = { ...metadata(article), canonicalUrl: article.canonicalUrl || article.url,
      summary: summary ? { status: summary.status, gist: clip(summary.gist, 2000), keyPoints: summary.keyPoints.slice(0, 8).map(point => clip(point)), takeaway: clip(summary.takeaway) } : null };
    if (args.includeBody) {
      const body = await byArticle(db, "articleBodies", id);
      const text = stripHtml(body?.bodyHtml || article.bodyHtml || body?.summaryHtml || article.summaryHtml || "");
      const offset = args.bodyOffset ?? 0;
      const end = offset + (args.bodyLimit ?? 6000);
      result.body = { text: text.slice(offset, end), offset, totalCharacters: text.length, nextOffset: end < text.length ? end : null };
    }
    return result;
  }
  if (name === "get_digest") {
    const timezone = getDigestTimezone();
    const date = args.date || getTimeZoneDateKey(timezone, now);
    const digest = await db.query("dailyDigests").withIndex("by_date_and_timezone", q => q.eq("localDate", date).eq("timezone", timezone)).unique();
    if (!digest) return { date, timezone, status: "missing", sections: [] };
    let remaining = 100;
    const sections = [];
    for (const section of digest.sections.slice(0, 30)) {
      const articles = [];
      for (const article of section.articles.slice(0, remaining)) {
        const live = await db.get(article.id);
        if (live && live.deletedAt === undefined) articles.push({ id: article.id, title: clip(live.title), url: live.url, readerUrl: readerUrl(live.title) });
      }
      remaining -= Math.min(section.articles.length, remaining);
      sections.push({ feedTitle: clip(section.feedTitle, 300), summary: clip(section.summary, 3000), articles });
    }
    return { date, timezone, status: digest.status, intro: clip(digest.intro, 4000), articleCount: digest.articleCount,
      readerUrl: `https://reader.mj-kang.com/today/${date}`, sections,
      truncated: digest.sections.length > 30 || digest.sections.reduce((n, s) => n + s.articles.length, 0) > 100 };
  }
  if (name === "list_feeds") {
    const page = await db.query("feeds").order("asc").paginate({ numItems: limit, cursor: args.cursor ?? null });
    return { feeds: page.page.map(feed => ({ id: feed._id, title: clip(feed.title, 300), feedGroup: feed.feedGroup || feed.folder || "", url: feed.siteUrl || feed.feedUrl, feedUrl: feed.feedUrl, source: isNewsletter(feed) ? "newsletter" : "feed", active: feed.isActive })), nextCursor: page.isDone ? null : page.continueCursor };
  }
  if (name === "search_articles") {
    const articles = await db.query("articles").withSearchIndex("search_title", q => q.search("title", args.query).eq("deletedAt", undefined)).take(limit);
    return { articles: articles.map(metadata) };
  }
  const range = q => {
    if (args.since) q = q.gte("publishedAt", Date.parse(args.since));
    if (args.until) q = q.lt("publishedAt", Date.parse(args.until));
    return q;
  };
  let query;
  if (args.feed) {
    const id = db.normalizeId("feeds", args.feed);
    if (!id) throw new Error("Invalid feed ID");
    query = db.query("articles").withIndex("by_feed_id_and_published_at", q => range(q.eq("feedId", id)));
  } else if (args.saved !== undefined) {
    query = db.query("articles").withIndex("by_saved_deleted_published_at", q => range(q.eq("isSaved", args.saved).eq("deletedAt", undefined)));
  } else {
    query = db.query("articles").withIndex("by_deleted_published_at", q => range(q.eq("deletedAt", undefined)));
  }
  const page = await query.order("desc").paginate({ numItems: limit, cursor: args.cursor ?? null });
  const feeds = new Map();
  const articles = [];
  for (const article of page.page) {
    if ((args.saved !== undefined && article.isSaved !== args.saved) || article.deletedAt !== undefined || (args.feedGroup && (article.feedGroup || article.feedFolder) !== args.feedGroup)) continue;
    if (article.feedId && !feeds.has(article.feedId)) feeds.set(article.feedId, await db.get(article.feedId));
    const source = article.sourceType === "manual" ? "manual" : isNewsletter(feeds.get(article.feedId)) ? "newsletter" : "feed";
    if (args.source && args.source !== source) continue;
    articles.push({ ...metadata(article), source });
  }
  return { articles, nextCursor: page.isDone ? null : page.continueCursor };
}
