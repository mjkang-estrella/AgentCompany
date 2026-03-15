import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";

import type { Doc } from "./_generated/dataModel";
import { resolveFeedInput } from "../lib/feed-discovery.mjs";

const mapFeed = (feed: Doc<"feeds">) => ({
  folder: feed.folder,
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

export const upsertResolvedFeed = internalMutation({
  args: {
    feedUrl: v.string(),
    folder: v.string(),
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
        folder: args.folder,
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
      folder: args.folder,
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

export const add = action({
  args: {
    folder: v.optional(v.string()),
    inputUrl: v.string()
  },
  handler: async (ctx, args) => {
    const resolved = await resolveFeedInput(args.inputUrl);
    const feed = await ctx.runMutation(internal.feeds.upsertResolvedFeed, {
      feedUrl: resolved.feedUrl,
      folder: (args.folder || "").trim() || "Uncategorized",
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
