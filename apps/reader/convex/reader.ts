import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";

import type { Doc, Id } from "./_generated/dataModel";

const defaultCounts = () => ({
  all: 0,
  feedGroups: {} as Record<string, number>,
  manual: 0,
  saved: 0,
  today: 0
});

const scopeValidator = v.union(
  v.literal("all"),
  v.literal("manual"),
  v.literal("saved"),
  v.literal("today")
);

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
  thumbnailUrl: article.thumbnailUrl || "",
  title: article.title,
  url: article.url
});

const articleDetail = (article: Doc<"articles">) => ({
  ...articleSummary(article),
  bodyHtml: article.bodyHtml,
  bodySource: article.bodySource,
  canonicalUrl: article.canonicalUrl || "",
  feedSiteUrl: article.feedSiteUrl || "",
  summaryHtml: article.summaryHtml
});

const withoutDeleted = (query: any) =>
  query.filter((q: any) => q.eq(q.field("deletedAt"), undefined));

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

const buildCounts = async (ctx: any, timezoneOffsetMinutes: number) => {
  const counts = defaultCounts();
  const feeds = await ctx.db.query("feeds").collect();
  const range = getTodayRange(timezoneOffsetMinutes);

  for (const feed of feeds) {
    const feedGroup = getFeedGroup(feed);
    if (feedGroup && !(feedGroup in counts.feedGroups)) {
      counts.feedGroups[feedGroup] = 0;
    }
  }

  const articles = await ctx.db.query("articles").collect();
  for (const article of articles) {
    if (article.deletedAt) {
      continue;
    }

    counts.all += 1;

    if (getSourceType(article) === "feed") {
      const feedGroup = getFeedGroup(article);
      if (feedGroup) {
        counts.feedGroups[feedGroup] = (counts.feedGroups[feedGroup] || 0) + 1;
      }
    }

    if (article.isSaved) {
      counts.saved += 1;
    }
    if (getSourceType(article) === "manual") {
      counts.manual += 1;
    }
    if (article.publishedAt >= range.start && article.publishedAt < range.end) {
      counts.today += 1;
    }
  }

  return counts;
};

const normalizeFeedGroupArg = (args: { feedGroup?: string; folder?: string }) =>
  args.feedGroup || args.folder || "";

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

    return articleDetail(article);
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
    if (typeof args.isRead === "boolean") {
      patch.isRead = args.isRead;
      patch.readAt = args.isRead ? Date.now() : undefined;
    }
    if (typeof args.isSaved === "boolean") {
      patch.isSaved = args.isSaved;
      patch.savedAt = args.isSaved ? Date.now() : undefined;
    }

    await ctx.db.patch(args.articleId, patch);
    const updated = await ctx.db.get(args.articleId);
    if (!updated) {
      throw new Error("Article not found after update");
    }

    return articleDetail(updated);
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

    await ctx.db.patch(args.articleId, {
      deletedAt: Date.now(),
      isRead: false,
      isSaved: false,
      readAt: undefined,
      savedAt: undefined
    });

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
