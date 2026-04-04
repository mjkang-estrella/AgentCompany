import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";

import type { Doc, Id } from "./_generated/dataModel";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  buildHighlightContext,
  highlightsOverlap
} from "../lib/highlight-anchors.mjs";
import { stripHtml } from "../lib/html.mjs";

const STATS_NAME = "global";
const defaultCounts = () => ({
  all: 0,
  feedGroups: {} as Record<string, number>,
  manual: 0,
  saved: 0,
  today: 0
});

const emptyStoredStats = () => ({
  all: 0,
  feedGroups: {} as Record<string, number>,
  manual: 0,
  saved: 0
});

const scopeValidator = v.union(
  v.literal("all"),
  v.literal("manual"),
  v.literal("saved"),
  v.literal("today")
);

const statsDeltaValidator = v.object({
  all: v.number(),
  feedGroups: v.record(v.string(), v.number()),
  manual: v.number(),
  saved: v.number()
});

const getFeedGroup = (value: { feedGroup?: string; feedFolder?: string; folder?: string }) =>
  value.feedGroup || value.feedFolder || value.folder || "";

const getSourceType = (article: Doc<"articles">) => article.sourceType || "feed";

const articleSummary = (article: Doc<"articles">) => ({
  author: article.author || "",
  feedGroup: getFeedGroup(article),
  feedIconUrl: article.feedIconUrl || "",
  feedId: article.feedId || null,
  feedTitle: article.feedTitle,
  id: article._id,
  isRead: article.isRead,
  isSaved: article.isSaved,
  previewText: article.previewText,
  publishedAt: new Date(article.publishedAt).toISOString(),
  readTimeMinutes: article.readTimeMinutes,
  sourceType: getSourceType(article),
  subtitle: article.subtitle || "",
  thumbnailUrl: article.thumbnailUrl || "",
  title: article.title,
  url: article.url
});

const articleDetail = (
  article: Doc<"articles">,
  body: Doc<"articleBodies"> | null,
  highlights: Doc<"articleHighlights">[]
) => ({
  ...articleSummary(article),
  bodyHtml: body?.bodyHtml || article.bodyHtml || "",
  bodySource: body?.bodySource || article.bodySource || "feed",
  canonicalUrl: article.canonicalUrl || "",
  feedSiteUrl: article.feedSiteUrl || "",
  highlights: highlights.map((highlight) => ({
    color: highlight.color,
    createdAt: new Date(highlight.createdAt).toISOString(),
    endOffset: highlight.endOffset,
    id: highlight._id,
    prefixText: highlight.prefixText,
    selectedText: highlight.selectedText,
    startOffset: highlight.startOffset,
    suffixText: highlight.suffixText
  })),
  summaryHtml: body?.summaryHtml || article.summaryHtml || ""
});

const withoutDeleted = (queryBuilder: any) =>
  queryBuilder.filter((q: any) => q.eq(q.field("deletedAt"), undefined));

const getTodayRange = (timezoneOffsetMinutes: number) => {
  const localNowMs = Date.now() - timezoneOffsetMinutes * 60_000;
  const localStart = new Date(localNowMs);
  localStart.setUTCHours(0, 0, 0, 0);
  const start = localStart.getTime() + timezoneOffsetMinutes * 60_000;
  return {
    end: start + 86_400_000,
    start
  };
};

const normalizeFeedGroupArg = (args: { feedGroup?: string; folder?: string }) =>
  args.feedGroup || args.folder || "";

const clampCount = (value: number) => Math.max(0, value || 0);

const mergeFeedGroupCounts = (
  current: Record<string, number>,
  delta: Record<string, number>
) => {
  const next = { ...current };

  for (const [feedGroup, change] of Object.entries(delta)) {
    const candidate = clampCount((next[feedGroup] || 0) + change);
    if (candidate === 0) {
      delete next[feedGroup];
      continue;
    }

    next[feedGroup] = candidate;
  }

  return next;
};

const getStatsDocument = async (ctx: { db: any }) =>
  ctx.db
    .query("readerStats")
    .withIndex("by_name", (q: any) => q.eq("name", STATS_NAME))
    .unique();

const getArticleBodyDocument = async (ctx: { db: any }, articleId: Id<"articles">) =>
  ctx.db
    .query("articleBodies")
    .withIndex("by_article_id", (q: any) => q.eq("articleId", articleId))
    .unique();

const getArticleHighlightDocuments = async (ctx: { db: any }, articleId: Id<"articles">) =>
  ctx.db
    .query("articleHighlights")
    .withIndex("by_article_id_and_start_offset", (q: any) => q.eq("articleId", articleId))
    .order("asc")
    .collect();

const upsertArticleBodyDocument = async (
  ctx: { db: any },
  args: {
    articleId: Id<"articles">;
    bodyHtml: string;
    bodySource: "feed" | "fetched";
    summaryHtml: string;
  }
) => {
  const existing = await getArticleBodyDocument(ctx, args.articleId);

  if (existing) {
    await ctx.db.patch(existing._id, {
      bodyHtml: args.bodyHtml,
      bodySource: args.bodySource,
      summaryHtml: args.summaryHtml
    });
    return existing._id;
  }

  return ctx.db.insert("articleBodies", args);
};

const deleteArticleBodyDocument = async (ctx: { db: any }, articleId: Id<"articles">) => {
  const existing = await getArticleBodyDocument(ctx, articleId);
  if (existing) {
    await ctx.db.delete(existing._id);
  }
};

const replaceStatsDocument = async (
  ctx: { db: any },
  stats: ReturnType<typeof emptyStoredStats>
) => {
  const existing = await getStatsDocument(ctx);

  if (existing) {
    await ctx.db.patch(existing._id, stats);
    return existing._id;
  }

  return ctx.db.insert("readerStats", {
    ...stats,
    name: STATS_NAME
  });
};

const applyStatsDeltaInDb = async (
  ctx: { db: any },
  delta: ReturnType<typeof emptyStoredStats>
) => {
  const existing = await getStatsDocument(ctx);
  const current = existing ? {
    all: existing.all,
    feedGroups: existing.feedGroups,
    manual: existing.manual,
    saved: existing.saved
  } : emptyStoredStats();

  const next = {
    all: clampCount(current.all + delta.all),
    feedGroups: mergeFeedGroupCounts(current.feedGroups, delta.feedGroups),
    manual: clampCount(current.manual + delta.manual),
    saved: clampCount(current.saved + delta.saved)
  };

  return replaceStatsDocument(ctx, next);
};

const statsDeltaForArticle = (
  article: Pick<Doc<"articles">, "feedGroup" | "isSaved" | "sourceType">
) => {
  const delta = emptyStoredStats();
  delta.all = 1;
  if (article.isSaved) {
    delta.saved = 1;
  }
  if (getSourceType(article as Doc<"articles">) === "manual") {
    delta.manual = 1;
  } else {
    const feedGroup = getFeedGroup(article);
    if (feedGroup) {
      delta.feedGroups[feedGroup] = 1;
    }
  }

  return delta;
};

const negateStatsDelta = (delta: ReturnType<typeof emptyStoredStats>) => ({
  all: -delta.all,
  feedGroups: Object.fromEntries(
    Object.entries(delta.feedGroups).map(([feedGroup, count]) => [feedGroup, -count])
  ),
  manual: -delta.manual,
  saved: -delta.saved
});

const buildArticleQuery = (
  ctx: any,
  args: {
    feedGroup?: string;
    scope: "all" | "manual" | "saved" | "today";
    timezoneOffsetMinutes: number;
  }
) => {
  let articleQuery;

  if (args.feedGroup) {
    articleQuery = ctx.db
      .query("articles")
      .withIndex("by_feed_group_and_published_at", (q: any) => q.eq("feedGroup", args.feedGroup))
      .order("desc")
      .filter((q: any) => q.eq(q.field("sourceType"), "feed"));
  } else if (args.scope === "saved") {
    articleQuery = ctx.db
      .query("articles")
      .withIndex("by_saved_and_published_at", (q: any) => q.eq("isSaved", true))
      .order("desc");
  } else if (args.scope === "manual") {
    articleQuery = ctx.db
      .query("articles")
      .withIndex("by_published_at")
      .order("desc")
      .filter((q: any) => q.eq(q.field("sourceType"), "manual"));
  } else {
    articleQuery = ctx.db.query("articles").withIndex("by_published_at").order("desc");
  }

  if (args.scope === "saved" && args.feedGroup) {
    articleQuery = articleQuery.filter((q: any) =>
      q.and(
        q.eq(q.field("isSaved"), true),
        q.eq(q.field("sourceType"), "feed"),
        q.eq(q.field("feedGroup"), args.feedGroup)
      )
    );
  }

  if (args.scope === "today") {
    const range = getTodayRange(args.timezoneOffsetMinutes);
    articleQuery = articleQuery.filter((q: any) =>
      q.and(
        q.gte(q.field("publishedAt"), range.start),
        q.lt(q.field("publishedAt"), range.end)
      )
    );
  }

  return withoutDeleted(articleQuery);
};

const countTodayArticles = async (ctx: any, timezoneOffsetMinutes: number) => {
  const range = getTodayRange(timezoneOffsetMinutes);
  const articles = await withoutDeleted(
    ctx.db
      .query("articles")
      .withIndex("by_published_at")
      .order("desc")
      .filter((q: any) =>
        q.and(
          q.eq(q.field("sourceType"), "feed"),
          q.gte(q.field("publishedAt"), range.start),
          q.lt(q.field("publishedAt"), range.end)
        )
      )
  ).collect();

  return articles.length;
};

const buildCounts = async (ctx: any, timezoneOffsetMinutes: number) => {
  const stats = await ctx.db
    .query("readerStats")
    .withIndex("by_name", (q: any) => q.eq("name", STATS_NAME))
    .unique();

  const counts = {
    ...(stats ? {
      all: stats.all,
      feedGroups: { ...stats.feedGroups },
      manual: stats.manual,
      saved: stats.saved
    } : emptyStoredStats()),
    today: await countTodayArticles(ctx, timezoneOffsetMinutes)
  };

  const feeds = await ctx.db.query("feeds").collect();
  for (const feed of feeds) {
    const feedGroup = getFeedGroup(feed);
    if (feedGroup && !(feedGroup in counts.feedGroups)) {
      counts.feedGroups[feedGroup] = 0;
    }
  }

  return counts;
};

export const getArticleBody = internalQuery({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("articleBodies")
      .withIndex("by_article_id", (q) => q.eq("articleId", args.articleId))
      .unique()
});

export const upsertArticleBody = internalMutation({
  args: {
    articleId: v.id("articles"),
    bodyHtml: v.string(),
    bodySource: v.union(v.literal("feed"), v.literal("fetched")),
    summaryHtml: v.string()
  },
  handler: async (ctx, args) => upsertArticleBodyDocument(ctx, args)
});

export const deleteArticleBody = internalMutation({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) => deleteArticleBodyDocument(ctx, args.articleId)
});

export const replaceStats = internalMutation({
  args: {
    stats: v.object({
      all: v.number(),
      feedGroups: v.record(v.string(), v.number()),
      manual: v.number(),
      saved: v.number()
    })
  },
  handler: async (ctx, args) => replaceStatsDocument(ctx, args.stats)
});

export const applyStatsDelta = internalMutation({
  args: {
    delta: statsDeltaValidator
  },
  handler: async (ctx, args) => applyStatsDeltaInDb(ctx, args.delta)
});

export const bootstrap = query({
  args: {
    feedGroup: v.optional(v.string()),
    folder: v.optional(v.string()),
    limit: v.optional(v.number()),
    scope: scopeValidator,
    selectedArticleId: v.optional(v.id("articles")),
    timezoneOffsetMinutes: v.number()
  },
  handler: async (ctx, args) => {
    const pagination = await buildArticleQuery(ctx, {
      feedGroup: normalizeFeedGroupArg(args),
      scope: args.scope,
      timezoneOffsetMinutes: args.timezoneOffsetMinutes
    }).paginate({
      cursor: null,
      numItems: Math.min(Math.max(args.limit || 50, 1), 100)
    });

    const articles = pagination.page.map(articleSummary);
    const selectedArticleId = articles.some((article) => article.id === args.selectedArticleId)
      ? args.selectedArticleId
      : (articles[0]?.id || null);

    return {
      articles,
      counts: await buildCounts(ctx, args.timezoneOffsetMinutes),
      hasMore: !pagination.isDone,
      nextCursor: pagination.isDone ? null : pagination.continueCursor,
      selectedArticleId
    };
  }
});

export const getCounts = query({
  args: {
    timezoneOffsetMinutes: v.number()
  },
  handler: async (ctx, args) => ({
    counts: await buildCounts(ctx, args.timezoneOffsetMinutes)
  })
});

export const listArticles = query({
  args: {
    cursor: v.optional(v.string()),
    feedGroup: v.optional(v.string()),
    folder: v.optional(v.string()),
    limit: v.optional(v.number()),
    scope: scopeValidator,
    timezoneOffsetMinutes: v.number()
  },
  handler: async (ctx, args) => {
    const pagination = await buildArticleQuery(ctx, {
      feedGroup: normalizeFeedGroupArg(args),
      scope: args.scope,
      timezoneOffsetMinutes: args.timezoneOffsetMinutes
    }).paginate({
      cursor: args.cursor ?? null,
      numItems: Math.min(Math.max(args.limit || 50, 1), 100)
    });

    return {
      articles: pagination.page.map(articleSummary),
      hasMore: !pagination.isDone,
      nextCursor: pagination.isDone ? null : pagination.continueCursor
    };
  }
});

export const getArticle = query({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.deletedAt) {
      throw new Error("Article not found");
    }

    const body = await getArticleBodyDocument(ctx, args.articleId);
    const highlights = await getArticleHighlightDocuments(ctx, args.articleId);

    return articleDetail(article, body, highlights);
  }
});

export const listHighlights = query({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.deletedAt) {
      throw new Error("Article not found");
    }

    const highlights = await getArticleHighlightDocuments(ctx, args.articleId);
    return highlights.map((highlight) => ({
      color: highlight.color,
      createdAt: new Date(highlight.createdAt).toISOString(),
      endOffset: highlight.endOffset,
      id: highlight._id,
      prefixText: highlight.prefixText,
      selectedText: highlight.selectedText,
      startOffset: highlight.startOffset,
      suffixText: highlight.suffixText
    }));
  }
});

export const updateArticle = mutation({
  args: {
    articleId: v.id("articles"),
    isRead: v.optional(v.boolean()),
    isSaved: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.deletedAt) {
      throw new Error("Article not found");
    }

    const patch: Partial<Doc<"articles">> = {};
    let savedDelta = 0;

    if (typeof args.isRead === "boolean") {
      patch.isRead = args.isRead;
      patch.readAt = args.isRead ? Date.now() : undefined;
    }
    if (typeof args.isSaved === "boolean" && args.isSaved !== article.isSaved) {
      patch.isSaved = args.isSaved;
      patch.savedAt = args.isSaved ? Date.now() : undefined;
      savedDelta = args.isSaved ? 1 : -1;
    }

    await ctx.db.patch(args.articleId, patch);
    if (savedDelta !== 0) {
      await applyStatsDeltaInDb(ctx, {
        all: 0,
        feedGroups: {},
        manual: 0,
        saved: savedDelta
      });
    }

    const updated = await ctx.db.get(args.articleId);
    if (!updated) {
      throw new Error("Article not found after update");
    }

    const body = await getArticleBodyDocument(ctx, args.articleId);
    const highlights = await getArticleHighlightDocuments(ctx, args.articleId);

    return articleDetail(updated, body, highlights);
  }
});

export const addHighlight = mutation({
  args: {
    articleId: v.id("articles"),
    endOffset: v.number(),
    prefixText: v.string(),
    selectedText: v.string(),
    startOffset: v.number(),
    suffixText: v.string()
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.deletedAt) {
      throw new Error("Article not found");
    }

    const body = await getArticleBodyDocument(ctx, args.articleId);
    const fullText = stripHtml(body?.bodyHtml || article.bodyHtml || "");
    const context = buildHighlightContext(fullText, args.startOffset, args.endOffset);
    if (!context.selectedText) {
      throw new Error("Highlight text is empty");
    }

    const existing = await getArticleHighlightDocuments(ctx, args.articleId);
    const candidate = {
      endOffset: context.endOffset,
      startOffset: context.startOffset
    };

    for (const highlight of existing) {
      if (
        highlight.startOffset === candidate.startOffset &&
        highlight.endOffset === candidate.endOffset
      ) {
        throw new Error("That text is already highlighted");
      }

      if (highlightsOverlap(highlight, candidate)) {
        throw new Error("Overlapping highlights are not supported yet");
      }
    }

    const highlightId = await ctx.db.insert("articleHighlights", {
      articleId: args.articleId,
      color: DEFAULT_HIGHLIGHT_COLOR,
      createdAt: Date.now(),
      endOffset: context.endOffset,
      prefixText: context.prefixText,
      selectedText: context.selectedText,
      startOffset: context.startOffset,
      suffixText: context.suffixText
    });

    return {
      color: DEFAULT_HIGHLIGHT_COLOR,
      createdAt: new Date().toISOString(),
      endOffset: context.endOffset,
      id: highlightId,
      prefixText: context.prefixText,
      selectedText: context.selectedText,
      startOffset: context.startOffset,
      suffixText: context.suffixText
    };
  }
});

export const removeHighlight = mutation({
  args: {
    highlightId: v.id("articleHighlights")
  },
  handler: async (ctx, args) => {
    const highlight = await ctx.db.get(args.highlightId);
    if (!highlight) {
      throw new Error("Highlight not found");
    }

    await ctx.db.delete(args.highlightId);
    return { highlightId: args.highlightId };
  }
});

export const deleteArticle = mutation({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.deletedAt) {
      throw new Error("Article not found");
    }

    await deleteArticleBodyDocument(ctx, args.articleId);
    await ctx.db.patch(args.articleId, {
      deletedAt: Date.now(),
      isRead: false,
      isSaved: false,
      readAt: undefined,
      savedAt: undefined
    });
    await applyStatsDeltaInDb(ctx, negateStatsDelta(statsDeltaForArticle(article)));

    return {
      articleId: args.articleId
    };
  }
});

export const matchingArticleIdPage = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    feedGroup: v.optional(v.string()),
    folder: v.optional(v.string()),
    limit: v.optional(v.number()),
    scope: scopeValidator,
    timezoneOffsetMinutes: v.number()
  },
  handler: async (ctx, args) => {
    const pagination = await buildArticleQuery(ctx, {
      feedGroup: normalizeFeedGroupArg(args),
      scope: args.scope,
      timezoneOffsetMinutes: args.timezoneOffsetMinutes
    }).paginate({
      cursor: args.cursor ?? null,
      numItems: Math.min(Math.max(args.limit || 100, 1), 200)
    });

    return {
      cursor: pagination.isDone ? null : pagination.continueCursor,
      ids: pagination.page.map((article) => article._id),
      isDone: pagination.isDone
    };
  }
});

export const markArticleIdsRead = internalMutation({
  args: {
    articleIds: v.array(v.id("articles"))
  },
  handler: async (ctx, args) => {
    const readAt = Date.now();
    for (const articleId of args.articleIds) {
      await ctx.db.patch(articleId, {
        isRead: true,
        readAt
      });
    }

    return args.articleIds.length;
  }
});

export const markAllRead = action({
  args: {
    feedGroup: v.optional(v.string()),
    folder: v.optional(v.string()),
    scope: scopeValidator,
    timezoneOffsetMinutes: v.number()
  },
  handler: async (ctx, args) => {
    let cursor: string | null = null;
    let updated = 0;

    while (true) {
      const page = await ctx.runQuery(internal.reader.matchingArticleIdPage, {
        cursor: cursor || undefined,
        feedGroup: normalizeFeedGroupArg(args),
        limit: 100,
        scope: args.scope,
        timezoneOffsetMinutes: args.timezoneOffsetMinutes
      });

      if (page.ids.length > 0) {
        updated += await ctx.runMutation(internal.reader.markArticleIdsRead, {
          articleIds: page.ids as Id<"articles">[]
        });
      }

      if (page.isDone || !page.cursor) {
        break;
      }

      cursor = page.cursor;
    }

    return { updated };
  }
});
