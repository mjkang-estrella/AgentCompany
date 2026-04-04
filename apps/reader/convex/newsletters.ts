import { v } from "convex/values";

import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";

import {
  NEWSLETTER_FEED_GROUP,
  getNewsletterInboxEmail,
  hasAgentMailApiKey
} from "../lib/newsletters.mjs";

const NEWSLETTER_STATUS_NAME = "default";

const newsletterSyncStatus = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("error")
);

const defaultNewsletterState = () => ({
  configured: hasAgentMailApiKey(),
  inboxEmail: getNewsletterInboxEmail(),
  lastError: "",
  lastImportedCount: 0,
  lastMessageAt: "",
  lastProcessedCount: 0,
  lastSyncedAt: "",
  status: "idle"
});

export const getSyncState = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("newsletterSyncStates")
      .withIndex("by_name", (q) => q.eq("name", NEWSLETTER_STATUS_NAME))
      .unique()
});

export const upsertSyncState = internalMutation({
  args: {
    inboxEmail: v.string(),
    lastError: v.optional(v.string()),
    lastImportedCount: v.optional(v.number()),
    lastMessageAt: v.optional(v.number()),
    lastProcessedCount: v.optional(v.number()),
    lastSyncedAt: v.optional(v.number()),
    status: newsletterSyncStatus
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("newsletterSyncStates")
      .withIndex("by_name", (q) => q.eq("name", NEWSLETTER_STATUS_NAME))
      .unique();

    const patch = {
      inboxEmail: args.inboxEmail,
      lastError: args.lastError,
      lastImportedCount: args.lastImportedCount ?? 0,
      lastMessageAt: args.lastMessageAt,
      lastProcessedCount: args.lastProcessedCount ?? 0,
      lastSyncedAt: args.lastSyncedAt,
      status: args.status
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return ctx.db.insert("newsletterSyncStates", {
      ...patch,
      name: NEWSLETTER_STATUS_NAME
    });
  }
});

export const ensureNewsletterFeed = internalMutation({
  args: {
    key: v.string(),
    siteUrl: v.optional(v.string()),
    title: v.string()
  },
  handler: async (ctx, args) => {
    const feedUrl = `agentmail://newsletters/${args.key}`;
    const existing = await ctx.db
      .query("feeds")
      .withIndex("by_feed_url", (q) => q.eq("feedUrl", feedUrl))
      .unique();

    if (existing) {
      const patch = {};
      if (existing.feedGroup !== NEWSLETTER_FEED_GROUP) {
        patch.feedGroup = NEWSLETTER_FEED_GROUP;
      }
      if (existing.isActive) {
        patch.isActive = false;
      }
      if (existing.syncStatus !== "idle") {
        patch.syncStatus = "idle";
      }
      if ((existing.siteUrl || "") !== (args.siteUrl || "")) {
        patch.siteUrl = args.siteUrl;
      }
      if (existing.title !== args.title) {
        patch.title = args.title;
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }

      return existing._id;
    }

    return ctx.db.insert("feeds", {
      feedGroup: NEWSLETTER_FEED_GROUP,
      feedUrl,
      isActive: false,
      siteUrl: args.siteUrl,
      syncStatus: "idle",
      title: args.title
    });
  }
});

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const stored = await ctx.runQuery(internal.newsletters.getSyncState, {});
    const defaults = defaultNewsletterState();

    if (!stored) {
      return defaults;
    }

    return {
      configured: defaults.configured,
      inboxEmail: stored.inboxEmail || defaults.inboxEmail,
      lastError: stored.lastError || "",
      lastImportedCount: stored.lastImportedCount || 0,
      lastMessageAt: stored.lastMessageAt
        ? new Date(stored.lastMessageAt).toISOString()
        : "",
      lastProcessedCount: stored.lastProcessedCount || 0,
      lastSyncedAt: stored.lastSyncedAt
        ? new Date(stored.lastSyncedAt).toISOString()
        : "",
      status: stored.status || "idle"
    };
  }
});

export const syncNow = action({
  args: {},
  handler: async (ctx) =>
    ctx.runAction(internal.newslettersNode.syncInbox, {
      createIfMissing: true
    })
});
