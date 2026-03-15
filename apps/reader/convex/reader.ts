import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";

import type { Doc, Id } from "./_generated/dataModel";

const defaultCounts = () => ({
  all: 0,
  folders: {} as Record<string, number>,
  saved: 0,
  today: 0
});

const scopeValidator = v.union(v.literal("all"), v.literal("saved"), v.literal("today"));

const articleSummary = (article: Doc<"articles">) => ({
  author: article.author || "",
  feedFolder: article.feedFolder,
  feedIconUrl: article.feedIconUrl || "",
  feedId: article.feedId,
  feedTitle: article.feedTitle,
  id: article._id,
  isRead: article.isRead,
  isSaved: article.isSaved,
  previewText: article.previewText,
  publishedAt: new Date(article.publishedAt).toISOString(),
  readTimeMinutes: article.readTimeMinutes,
  thumbnailUrl: article.thumbnailUrl || "",
  title: article.title,
  url: article.url
});

const articleDetail = (article: Doc<"articles">) => ({
  ...articleSummary(article),
  bodyHtml: article.bodyHtml,
  bodySource: article.bodySource,
  feedSiteUrl: article.feedSiteUrl || "",
  summaryHtml: article.summaryHtml
});

const normalizeScope = (scope: "all" | "saved" | "today") => scope;

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
    folder?: string;
    scope: "all" | "saved" | "today";
    timezoneOffsetMinutes: number;
  }
) => {
  let articleQuery;

  if (args.folder) {
    articleQuery = ctx.db
      .query("articles")
      .withIndex("by_feed_folder_and_published_at", (q: any) => q.eq("feedFolder", args.folder))
      .order("desc");
  } else if (args.scope === "saved") {
    articleQuery = ctx.db
      .query("articles")
      .withIndex("by_saved_and_published_at", (q: any) => q.eq("isSaved", true))
      .order("desc");
  } else {
    articleQuery = ctx.db.query("articles").withIndex("by_published_at").order("desc");
  }

  if (args.scope === "saved" && args.folder) {
    articleQuery = articleQuery.filter((q: any) => q.eq(q.field("isSaved"), true));
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

  return articleQuery;
};

const buildCounts = async (
  ctx: any,
  timezoneOffsetMinutes: number
) => {
  const counts = defaultCounts();
  const feeds = await ctx.db.query("feeds").collect();
  const range = getTodayRange(timezoneOffsetMinutes);

  for (const feed of feeds) {
    if (!(feed.folder in counts.folders)) {
      counts.folders[feed.folder] = 0;
    }
  }

  const articles = await ctx.db.query("articles").collect();
  for (const article of articles) {
    counts.all += 1;
    counts.folders[article.feedFolder] = (counts.folders[article.feedFolder] || 0) + 1;
    if (article.isSaved) {
      counts.saved += 1;
    }
    if (article.publishedAt >= range.start && article.publishedAt < range.end) {
      counts.today += 1;
    }
  }

  return counts;
};

export const bootstrap = query({
  args: {
    folder: v.optional(v.string()),
    limit: v.optional(v.number()),
    scope: scopeValidator,
    selectedArticleId: v.optional(v.id("articles")),
    timezoneOffsetMinutes: v.number()
  },
  handler: async (ctx, args) => {
    const pagination = await buildArticleQuery(ctx, {
      folder: args.folder || "",
      scope: normalizeScope(args.scope),
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
    folder: v.optional(v.string()),
    limit: v.optional(v.number()),
    scope: scopeValidator,
    timezoneOffsetMinutes: v.number()
  },
  handler: async (ctx, args) => {
    const pagination = await buildArticleQuery(ctx, {
      folder: args.folder || "",
      scope: normalizeScope(args.scope),
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
    if (!article) {
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
    if (!article) {
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

export const matchingArticleIdPage = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    folder: v.optional(v.string()),
    limit: v.optional(v.number()),
    scope: scopeValidator,
    timezoneOffsetMinutes: v.number()
  },
  handler: async (ctx, args) => {
    const pagination = await buildArticleQuery(ctx, {
      folder: args.folder || "",
      scope: normalizeScope(args.scope),
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
        folder: args.folder || "",
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
