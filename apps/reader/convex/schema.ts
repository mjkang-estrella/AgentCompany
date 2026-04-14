import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const syncStatus = v.union(
  v.literal("idle"),
  v.literal("queued"),
  v.literal("running"),
  v.literal("error")
);

const digestStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("ready"),
  v.literal("failed")
);

const newsletterSyncStatus = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("error")
);

export default defineSchema({
  feeds: defineTable({
    feedUrl: v.string(),
    feedGroup: v.optional(v.string()),
    folder: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    isActive: v.boolean(),
    lastSyncError: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    siteUrl: v.optional(v.string()),
    syncStatus,
    title: v.string()
  })
    .index("by_feed_url", ["feedUrl"])
    .index("by_feed_group", ["feedGroup"])
    .index("by_is_active", ["isActive"]),

  articles: defineTable({
    author: v.optional(v.string()),
    canonicalUrl: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
    bodySource: v.optional(v.union(v.literal("feed"), v.literal("fetched"))),
    contentHash: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    externalId: v.string(),
    feedGroup: v.optional(v.string()),
    feedFolder: v.optional(v.string()),
    feedIconUrl: v.optional(v.string()),
    feedId: v.optional(v.id("feeds")),
    feedSiteUrl: v.optional(v.string()),
    feedTitle: v.string(),
    isRead: v.boolean(),
    isSaved: v.boolean(),
    isYoutube: v.optional(v.boolean()),
    previewText: v.string(),
    publishedDigestDate: v.optional(v.string()),
    publishedAt: v.number(),
    readAt: v.optional(v.number()),
    readTimeMinutes: v.number(),
    savedAt: v.optional(v.number()),
    sourceType: v.optional(v.union(v.literal("feed"), v.literal("manual"))),
    summaryHtml: v.optional(v.string()),
    subtitle: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    title: v.string(),
    url: v.string()
  })
    .index("by_feed_and_external_id", ["feedId", "externalId"])
    .index("by_published_at", ["publishedAt"])
    .index("by_deleted_published_at", ["deletedAt", "publishedAt"])
    .index("by_feed_group_source_deleted_published_at", ["feedGroup", "sourceType", "deletedAt", "publishedAt"])
    .index("by_saved_deleted_published_at", ["isSaved", "deletedAt", "publishedAt"])
    .index("by_saved_source_deleted_feed_group_published_at", ["isSaved", "sourceType", "deletedAt", "feedGroup", "publishedAt"])
    .index("by_source_deleted_published_at", ["sourceType", "deletedAt", "publishedAt"])
    .index("by_source_title_deleted_published_at", ["sourceType", "feedTitle", "deletedAt", "publishedAt"])
    .index("by_digest_date_source_deleted_published_at", ["publishedDigestDate", "sourceType", "deletedAt", "publishedAt"])
    .index("by_feed_id_and_published_at", ["feedId", "publishedAt"])
    .index("by_canonical_url", ["canonicalUrl"]),

  articleBodies: defineTable({
    articleId: v.id("articles"),
    bodyHtml: v.string(),
    bodySource: v.union(v.literal("feed"), v.literal("fetched")),
    summaryHtml: v.string()
  }).index("by_article_id", ["articleId"]),

  articleHighlights: defineTable({
    articleId: v.id("articles"),
    color: v.string(),
    createdAt: v.number(),
    endOffset: v.number(),
    prefixText: v.string(),
    selectedText: v.string(),
    startOffset: v.number(),
    suffixText: v.string()
  })
    .index("by_article_id", ["articleId"])
    .index("by_article_id_and_start_offset", ["articleId", "startOffset"]),

  books: defineTable({
    accent: v.string(),
    author: v.string(),
    coverImage: v.optional(v.string()),
    coverTone: v.string(),
    createdAt: v.number(),
    description: v.string(),
    highlightParagraphs: v.optional(v.array(v.string())),
    slug: v.string(),
    notes: v.optional(v.string()),
    sections: v.optional(v.array(v.object({
      highlightParagraphs: v.optional(v.array(v.string())),
      id: v.string(),
      notes: v.string(),
      status: v.string(),
      title: v.string()
    }))),
    status: v.string(),
    title: v.string(),
    updatedAt: v.number()
  })
    .index("by_created_at", ["createdAt"])
    .index("by_slug", ["slug"]),

  readerStats: defineTable({
    all: v.number(),
    feedGroups: v.record(v.string(), v.number()),
    manual: v.number(),
    name: v.string(),
    saved: v.number()
  }).index("by_name", ["name"]),

  readerDailyStats: defineTable({
    feedCount: v.number(),
    localDate: v.string()
  }).index("by_local_date", ["localDate"]),

  dailyDigests: defineTable({
    articleCount: v.number(),
    articleIds: v.array(v.id("articles")),
    error: v.optional(v.string()),
    generatedAt: v.optional(v.number()),
    intro: v.string(),
    localDate: v.string(),
    sections: v.array(
      v.object({
        articles: v.array(
          v.object({
            author: v.optional(v.string()),
            id: v.id("articles"),
            previewText: v.string(),
            publishedAt: v.string(),
            subtitle: v.optional(v.string()),
            title: v.string(),
            url: v.string()
          })
        ),
        feedGroup: v.optional(v.string()),
        feedIconUrl: v.optional(v.string()),
        feedKey: v.string(),
        feedTitle: v.string(),
        summary: v.string()
      })
    ),
    status: digestStatus,
    timezone: v.string()
  }).index("by_date_and_timezone", ["localDate", "timezone"]),

  newsletterSyncStates: defineTable({
    inboxEmail: v.string(),
    lastError: v.optional(v.string()),
    lastImportedCount: v.number(),
    lastMessageAt: v.optional(v.number()),
    lastProcessedCount: v.number(),
    lastSyncedAt: v.optional(v.number()),
    name: v.string(),
    status: newsletterSyncStatus
  }).index("by_name", ["name"])
});
