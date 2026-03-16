import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";

import { canonicalizeUrl } from "../lib/html.mjs";

const normalizeFeedGroup = (value: { feedGroup?: string; feedFolder?: string; folder?: string }) =>
  (value.feedGroup || value.feedFolder || value.folder || "Uncategorized").trim() || "Uncategorized";

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

      await ctx.runMutation(internal.migration.patchArticleDocument, {
        articleId,
        canonicalUrl: canonicalizeUrl(article.url),
        feedGroup,
        sourceType
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
    feedGroup: v.string(),
    sourceType: v.union(v.literal("feed"), v.literal("manual"))
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.articleId, {
      canonicalUrl: args.canonicalUrl,
      feedGroup: args.feedGroup,
      feedFolder: undefined,
      sourceType: args.sourceType
    });
  }
});
