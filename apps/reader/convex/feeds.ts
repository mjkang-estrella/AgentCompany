import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";

import type { Doc } from "./_generated/dataModel";
import { resolveFeedInput } from "../lib/feed-discovery.mjs";

const getFeedGroup = (value) => (value.feedGroup || value.folder || "Uncategorized").trim() || "Uncategorized";

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

const applyStatsDeltaInDb = async (
  ctx: { db: any },
  delta: {
    all: number;
    feedGroups: Record<string, number>;
    manual: number;
    saved: number;
  }
) => {
  const existing = await ctx.db
    .query("readerStats")
    .withIndex("by_name", (q: any) => q.eq("name", "global"))
    .unique();

  const current = existing ? {
    all: existing.all,
    feedGroups: existing.feedGroups,
    manual: existing.manual,
    saved: existing.saved
  } : {
    all: 0,
    feedGroups: {} as Record<string, number>,
    manual: 0,
    saved: 0
  };

  const next = {
    all: clampCount(current.all + delta.all),
    feedGroups: mergeFeedGroupCounts(current.feedGroups, delta.feedGroups),
    manual: clampCount(current.manual + delta.manual),
    saved: clampCount(current.saved + delta.saved)
  };

  if (existing) {
    await ctx.db.patch(existing._id, next);
    return existing._id;
  }

  return ctx.db.insert("readerStats", {
    ...next,
    name: "global"
  });
};

const mapFeed = (feed: Doc<"feeds">) => ({
  feedGroup: getFeedGroup(feed),
  iconUrl: feed.iconUrl || "",
  id: feed._id,
  isActive: feed.isActive,
  lastSyncError: feed.lastSyncError || "",
  lastSyncedAt: feed.lastSyncedAt ? new Date(feed.lastSyncedAt).toISOString() : "",
  siteUrl: feed.siteUrl || "",
  syncStatus: feed.syncStatus,
  title: feed.title,
  url: feed.feedUrl
});

export const getByFeedUrl = internalQuery({
  args: {
    feedUrl: v.string()
  },
  handler: async (ctx, args) =>
    ctx.db.query("feeds").withIndex("by_feed_url", (q) => q.eq("feedUrl", args.feedUrl)).unique()
});

export const listByFeedGroup = internalQuery({
  args: {
    feedGroup: v.string()
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("feeds")
      .withIndex("by_feed_group", (q) => q.eq("feedGroup", args.feedGroup))
      .collect()
});

const removeFeedGroupHandler = async (ctx, rawFeedGroup) => {
  const feedGroup = rawFeedGroup.trim();
  if (!feedGroup) {
    throw new Error("feedGroup is required");
  }

  const feeds = await ctx.runQuery(internal.feeds.listByFeedGroup, { feedGroup });
  if (feeds.length === 0) {
    throw new Error("Feed not found");
  }

  const feedIds = feeds.map((feed) => feed._id);
  await ctx.runMutation(internal.feeds.markFeedsInactive, { feedIds });

  let removedArticles = 0;
  for (const feedId of feedIds) {
    let cursor = null;

    while (true) {
      const batch = await ctx.runQuery(internal.feeds.articleIdBatchForFeed, {
        cursor: cursor || undefined,
        feedId,
        limit: 100
      });

      if (batch.ids.length > 0) {
        removedArticles += batch.ids.length;
        await ctx.runMutation(internal.feeds.deleteArticleIds, {
          articleIds: batch.ids
        });
      }

      if (batch.isDone || !batch.nextCursor) {
        break;
      }

      cursor = batch.nextCursor;
    }
  }

  await ctx.runMutation(internal.feeds.deleteFeedIds, { feedIds });

  return {
    feedGroup,
    removedArticles,
    removedFeeds: feedIds.length
  };
};

export const upsertResolvedFeed = internalMutation({
  args: {
    feedUrl: v.string(),
    feedGroup: v.string(),
    iconUrl: v.optional(v.string()),
    isActive: v.boolean(),
    siteUrl: v.optional(v.string()),
    title: v.string()
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("feeds")
      .withIndex("by_feed_url", (q) => q.eq("feedUrl", args.feedUrl))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        feedGroup: args.feedGroup,
        folder: undefined,
        iconUrl: args.iconUrl,
        isActive: args.isActive,
        lastSyncError: undefined,
        siteUrl: args.siteUrl,
        syncStatus: "queued",
        title: args.title
      });

      return await ctx.db.get(existing._id);
    }

    const feedId = await ctx.db.insert("feeds", {
      feedUrl: args.feedUrl,
      feedGroup: args.feedGroup,
      iconUrl: args.iconUrl,
      isActive: args.isActive,
      siteUrl: args.siteUrl,
      syncStatus: "queued",
      title: args.title
    });

    return await ctx.db.get(feedId);
  }
});

export const queueSync = internalMutation({
  args: {
    feedId: v.id("feeds")
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedId, {
      lastSyncError: undefined,
      syncStatus: "queued"
    });

    return await ctx.db.get(args.feedId);
  }
});

export const markFeedsInactive = internalMutation({
  args: {
    feedIds: v.array(v.id("feeds"))
  },
  handler: async (ctx, args) => {
    for (const feedId of args.feedIds) {
      await ctx.db.patch(feedId, {
        isActive: false,
        syncStatus: "error"
      });
    }
  }
});

export const articleIdBatchForFeed = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    feedId: v.id("feeds"),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("articles")
      .withIndex("by_feed_id_and_published_at", (q) => q.eq("feedId", args.feedId))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.min(Math.max(args.limit || 100, 1), 200)
      });

    return {
      ids: page.page.map((article) => article._id),
      isDone: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor
    };
  }
});

export const deleteArticleIds = internalMutation({
  args: {
    articleIds: v.array(v.id("articles"))
  },
  handler: async (ctx, args) => {
    const delta = {
      all: 0,
      feedGroups: {} as Record<string, number>,
      manual: 0,
      saved: 0
    };

    for (const articleId of args.articleIds) {
      const article = await ctx.db.get(articleId);
      const body = await ctx.db
        .query("articleBodies")
        .withIndex("by_article_id", (q) => q.eq("articleId", articleId))
        .unique();

      if (body) {
        await ctx.db.delete(body._id);
      }

      if (article && !article.deletedAt) {
        delta.all -= 1;
        if (article.isSaved) {
          delta.saved -= 1;
        }
        if ((article.sourceType || "feed") === "manual") {
          delta.manual -= 1;
        } else {
          const feedGroup = getFeedGroup(article);
          if (feedGroup) {
            delta.feedGroups[feedGroup] = (delta.feedGroups[feedGroup] || 0) - 1;
          }
        }
      }

      await ctx.db.delete(articleId);
    }

    if (
      delta.all !== 0 ||
      delta.saved !== 0 ||
      delta.manual !== 0 ||
      Object.keys(delta.feedGroups).length > 0
    ) {
      await applyStatsDeltaInDb(ctx, delta);
    }
  }
});

export const deleteFeedIds = internalMutation({
  args: {
    feedIds: v.array(v.id("feeds"))
  },
  handler: async (ctx, args) => {
    for (const feedId of args.feedIds) {
      await ctx.db.delete(feedId);
    }
  }
});

export const add = action({
  args: {
    feedGroup: v.optional(v.string()),
    folder: v.optional(v.string()),
    inputUrl: v.string()
  },
  handler: async (ctx, args) => {
    const resolved = await resolveFeedInput(args.inputUrl);
    const feed = await ctx.runMutation(internal.feeds.upsertResolvedFeed, {
      feedUrl: resolved.feedUrl,
      feedGroup: getFeedGroup(args),
      iconUrl: resolved.faviconUrl || undefined,
      isActive: true,
      siteUrl: resolved.siteUrl || undefined,
      title: resolved.title || "Untitled feed"
    });

    if (!feed) {
      throw new Error("Could not create feed");
    }

    await ctx.scheduler.runAfter(0, internal.sync.runFeed, { feedId: feed._id });
    return {
      feed: mapFeed(feed),
      syncStatus: "queued"
    };
  }
});

export const syncOne = action({
  args: {
    feedId: v.id("feeds")
  },
  handler: async (ctx, args) => {
    const feed = await ctx.runMutation(internal.feeds.queueSync, { feedId: args.feedId });
    if (!feed) {
      throw new Error("Feed not found");
    }

    await ctx.scheduler.runAfter(0, internal.sync.runFeed, { feedId: args.feedId });
    return {
      feed: mapFeed(feed),
      syncStatus: "queued"
    };
  }
});

export const removeOrganization = action({
  args: {
    feedGroup: v.string()
  },
  handler: async (ctx, args) => removeFeedGroupHandler(ctx, args.feedGroup)
});

export const removeFeedGroup = action({
  args: {
    feedGroup: v.string()
  },
  handler: async (ctx, args) => removeFeedGroupHandler(ctx, args.feedGroup)
});
