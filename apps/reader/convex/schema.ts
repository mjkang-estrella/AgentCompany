import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const syncStatus = v.union(
  v.literal("idle"),
  v.literal("queued"),
  v.literal("running"),
  v.literal("error")
);

export default defineSchema({
  feeds: defineTable({
    feedUrl: v.string(),
    folder: v.string(),
    iconUrl: v.optional(v.string()),
    isActive: v.boolean(),
    lastSyncError: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    siteUrl: v.optional(v.string()),
    syncStatus,
    title: v.string()
  })
    .index("by_feed_url", ["feedUrl"])
    .index("by_folder", ["folder"])
    .index("by_is_active", ["isActive"]),

  articles: defineTable({
    author: v.optional(v.string()),
    bodyHtml: v.string(),
    bodySource: v.union(v.literal("feed"), v.literal("fetched")),
    externalId: v.string(),
    feedFolder: v.string(),
    feedIconUrl: v.optional(v.string()),
    feedId: v.id("feeds"),
    feedSiteUrl: v.optional(v.string()),
    feedTitle: v.string(),
    isRead: v.boolean(),
    isSaved: v.boolean(),
    previewText: v.string(),
    publishedAt: v.number(),
    readAt: v.optional(v.number()),
    readTimeMinutes: v.number(),
    savedAt: v.optional(v.number()),
    summaryHtml: v.string(),
    thumbnailUrl: v.optional(v.string()),
    title: v.string(),
    url: v.string()
  })
    .index("by_feed_and_external_id", ["feedId", "externalId"])
    .index("by_published_at", ["publishedAt"])
    .index("by_feed_folder_and_published_at", ["feedFolder", "publishedAt"])
    .index("by_saved_and_published_at", ["isSaved", "publishedAt"])
    .index("by_feed_id_and_published_at", ["feedId", "publishedAt"])
});
