import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";

import { hashArticleContent } from "../lib/content-hash.mjs";
import { normalizeFeedGroupName } from "../lib/feed-group-name.mjs";
import { canonicalizeUrl } from "../lib/html.mjs";

const normalizeFeedGroup = (value: { feedGroup?: string; feedFolder?: string; folder?: string }) =>
  normalizeFeedGroupName(value.feedGroup || value.feedFolder || value.folder || "Uncategorized");

export const importFeeds = action({
  args: {
    feeds: v.array(
      v.object({
        feedGroup: v.optional(v.string()),
        feedUrl: v.string(),
        folder: v.optional(v.string()),
        iconUrl: v.optional(v.string()),
        isActive: v.boolean(),
        siteUrl: v.optional(v.string()),
        title: v.string()
      })
    )
  },
  handler: async (ctx, args) => {
    const imported = [];

    for (const feed of args.feeds) {
      const saved = await ctx.runMutation(internal.feeds.upsertResolvedFeed, {
        feedGroup: normalizeFeedGroup(feed),
        feedUrl: feed.feedUrl,
        iconUrl: feed.iconUrl,
        isActive: feed.isActive,
        siteUrl: feed.siteUrl,
        title: feed.title
      });
      if (!saved) {
        continue;
      }

      imported.push(saved._id);
      await ctx.scheduler.runAfter(0, internal.sync.runFeed, { feedId: saved._id });
    }

    return {
      imported: imported.length,
      queued: imported.length
    };
  }
});

export const backfillFeedGroups = action({
  args: {},
  handler: async (ctx) => {
    const allFeeds = await ctx.runQuery(internal.migration.listFeeds, {});
    const feedGroupById = new Map(allFeeds.map((feed) => [feed._id, normalizeFeedGroup(feed)]));

    let migratedFeeds = 0;
    for (const feed of allFeeds) {
      const feedGroup = normalizeFeedGroup(feed);
      await ctx.runMutation(internal.migration.patchFeedDocument, {
        feedGroup,
        feedId: feed._id
      });
      migratedFeeds += 1;
    }

    const articles = await ctx.runQuery(internal.migration.listArticleIds, {});
    let migratedArticles = 0;
    for (const articleId of articles) {
      const article = await ctx.runQuery(internal.migration.getArticleDocument, { articleId });
      if (!article) {
        continue;
      }

      const sourceType = article.sourceType || "feed";
      const resolvedFeedGroup = feedGroupById.get(article.feedId);
      const feedGroup = sourceType === "manual"
        ? ""
        : (
            (resolvedFeedGroup && resolvedFeedGroup !== "Uncategorized" ? resolvedFeedGroup : "") ||
            article.feedGroup ||
            article.feedFolder ||
            resolvedFeedGroup ||
            "Uncategorized"
          );

      const canonicalUrl = canonicalizeUrl(article.url);
      await ctx.runMutation(internal.migration.patchArticleDocument, {
        articleId,
        bodyHtml: article.bodyHtml || "",
        bodySource: article.bodySource || "feed",
        canonicalUrl,
        contentHash: hashArticleContent({
          author: article.author || "",
          bodyHtml: article.bodyHtml || "",
          canonicalUrl,
          previewText: article.previewText,
          publishedAt: article.publishedAt,
          summaryHtml: article.summaryHtml || article.bodyHtml || "",
          thumbnailUrl: article.thumbnailUrl || "",
          title: article.title,
          url: article.url
        }),
        feedGroup,
        sourceType,
        summaryHtml: article.summaryHtml || article.bodyHtml || ""
      });
      migratedArticles += 1;
    }

    return {
      migratedArticles,
      migratedFeeds
    };
  }
});

export const listFeeds = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("feeds").collect()
});

export const listArticleIds = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("articles").collect()).map((article) => article._id)
});

export const getArticleDocument = internalQuery({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) => ctx.db.get(args.articleId)
});

export const patchFeedDocument = internalMutation({
  args: {
    feedGroup: v.string(),
    feedId: v.id("feeds")
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedId, {
      feedGroup: args.feedGroup,
      folder: undefined
    });
  }
});

export const patchArticleDocument = internalMutation({
  args: {
    articleId: v.id("articles"),
    canonicalUrl: v.string(),
    contentHash: v.string(),
    bodyHtml: v.optional(v.string()),
    bodySource: v.optional(v.union(v.literal("feed"), v.literal("fetched"))),
    feedGroup: v.string(),
    sourceType: v.union(v.literal("feed"), v.literal("manual")),
    summaryHtml: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.articleId, {
      bodyHtml: undefined,
      bodySource: undefined,
      canonicalUrl: args.canonicalUrl,
      contentHash: args.contentHash,
      feedGroup: args.feedGroup,
      feedFolder: undefined,
      sourceType: args.sourceType,
      summaryHtml: undefined
    });
  }
});

export const backfillBodiesAndStats = action({
  args: {},
  handler: async (ctx) => {
    const allFeeds = await ctx.runQuery(internal.migration.listFeeds, {});
    const feedGroupById = new Map(allFeeds.map((feed) => [feed._id, normalizeFeedGroup(feed)]));
    const articleIds = await ctx.runQuery(internal.migration.listArticleIds, {});

    const stats = {
      all: 0,
      feedGroups: {} as Record<string, number>,
      manual: 0,
      saved: 0
    };

    for (const articleId of articleIds) {
      const article = await ctx.runQuery(internal.migration.getArticleDocument, { articleId });
      if (!article) {
        continue;
      }

      const sourceType = article.sourceType || "feed";
      const resolvedFeedGroup = feedGroupById.get(article.feedId);
      const feedGroup = sourceType === "manual"
        ? ""
        : (
            (resolvedFeedGroup && resolvedFeedGroup !== "Uncategorized" ? resolvedFeedGroup : "") ||
            article.feedGroup ||
            article.feedFolder ||
            resolvedFeedGroup ||
            "Uncategorized"
          );
      const canonicalUrl = canonicalizeUrl(article.url);
      const bodyHtml = article.bodyHtml || "";
      const summaryHtml = article.summaryHtml || bodyHtml;
      const bodySource = article.bodySource || "feed";
      const contentHash = hashArticleContent({
        author: article.author || "",
        bodyHtml,
        canonicalUrl,
        previewText: article.previewText,
        publishedAt: article.publishedAt,
        summaryHtml,
        thumbnailUrl: article.thumbnailUrl || "",
        title: article.title,
        url: article.url
      });

      await ctx.runMutation(internal.reader.upsertArticleBody, {
        articleId,
        bodyHtml,
        bodySource,
        summaryHtml
      });
      await ctx.runMutation(internal.migration.patchArticleDocument, {
        articleId,
        bodyHtml,
        bodySource,
        canonicalUrl,
        contentHash,
        feedGroup,
        sourceType,
        summaryHtml
      });

      if (!article.deletedAt) {
        stats.all += 1;
        if (article.isSaved) {
          stats.saved += 1;
        }
        if (sourceType === "manual") {
          stats.manual += 1;
        } else if (feedGroup) {
          stats.feedGroups[feedGroup] = (stats.feedGroups[feedGroup] || 0) + 1;
        }
      }
    }

    await ctx.runMutation(internal.reader.replaceStats, { stats });

    return {
      migratedArticles: articleIds.length,
      stats
    };
  }
});
