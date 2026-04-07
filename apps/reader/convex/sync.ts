import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";

import { parseFeed } from "../lib/feed-utils.mjs";
import { hashArticleContent } from "../lib/content-hash.mjs";
import { extractPageWithDefuddle } from "../lib/page-extractor.mjs";
import { normalizeArticleContent } from "../lib/article-body-normalizer.mjs";
import {
  canonicalizeUrl,
  estimateReadTime,
  renderMarkdownFragment,
  sanitizeFragment,
  stripHtml
} from "../lib/html.mjs";

const DEFAULT_HEADERS = {
  "user-agent": "AgentCompany Reader/1.0 (+https://agent.company)"
};
const MAX_SYNC_ENTRIES = 50;
const RECENT_RECHECK_LIMIT = 5;

const resolveUrl = (value: string, baseUrl: string) => {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
};

const findFirstImageUrl = (html: string, baseUrl: string) => {
  if (!html) {
    return "";
  }

  const match = String(html).match(/<img\b[^>]*\bsrc=["']([^"']+)["']/iu);
  return resolveUrl(match?.[1] || "", baseUrl);
};

const fetchText = async (url: string) => {
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} (${response.status})`);
  }

  return {
    text: await response.text(),
    url: response.url
  };
};

const normalizePublishedAt = (value: string) => {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.valueOf()) ? Date.now() : parsed.valueOf();
};

const maybeFetchArticleBody = async (
  url: string,
  existingHtml: string,
  markdownUrl = ""
) => {
  if (stripHtml(existingHtml).length >= 400 || (!url && !markdownUrl)) {
    return {
      author: "",
      bodyHtml: sanitizeFragment(existingHtml),
      bodySource: "feed" as const,
      canonicalUrl: canonicalizeUrl(url),
      publishedAt: "",
      quality: "usable" as const,
      readTimeMinutes: estimateReadTime(existingHtml),
      rejectionReason: "",
      siteName: "",
      thumbnailUrl: "",
      title: ""
    };
  }

  if (markdownUrl) {
    try {
      const markdown = await fetchText(markdownUrl);
      const rendered = renderMarkdownFragment(markdown.text);
      if (stripHtml(rendered).length > stripHtml(existingHtml).length) {
        return {
          author: "",
          bodyHtml: rendered,
          bodySource: "fetched" as const,
          canonicalUrl: canonicalizeUrl(url),
          publishedAt: "",
          quality: "usable" as const,
          readTimeMinutes: estimateReadTime(rendered),
          rejectionReason: "",
          siteName: "",
          thumbnailUrl: "",
          title: ""
        };
      }
    } catch {
      // Fall through to page extraction.
    }
  }

  if (url) {
    try {
      const page = await fetchText(url);
      const extracted = await extractPageWithDefuddle(page.text, page.url);
      if (
        extracted.quality === "usable" &&
        stripHtml(extracted.bodyHtml).length > stripHtml(existingHtml).length
      ) {
        return {
          author: extracted.author,
          bodyHtml: extracted.bodyHtml,
          bodySource: "fetched" as const,
          canonicalUrl: extracted.canonicalUrl,
          publishedAt: extracted.publishedAt,
          quality: extracted.quality,
          readTimeMinutes: extracted.readTimeMinutes,
          rejectionReason: extracted.rejectionReason,
          siteName: extracted.siteName,
          thumbnailUrl: extracted.thumbnailUrl,
          title: extracted.title
        };
      }
    } catch {
      // Fall through to feed body.
    }
  }

  return {
    author: "",
    bodyHtml: sanitizeFragment(existingHtml),
    bodySource: "feed" as const,
    canonicalUrl: canonicalizeUrl(url),
    publishedAt: "",
    quality: "weak" as const,
    readTimeMinutes: estimateReadTime(existingHtml),
    rejectionReason: "feed-body-retained",
    siteName: "",
    thumbnailUrl: "",
    title: ""
  };
};

const statsDeltaForArticle = (article: {
  feedGroup: string;
  isSaved?: boolean;
  sourceType: "feed" | "manual";
}) => {
  const delta = {
    all: 1,
    feedGroups: {} as Record<string, number>,
    manual: 0,
    saved: article.isSaved ? 1 : 0
  };

  if (article.sourceType === "manual") {
    delta.manual = 1;
  } else if (article.feedGroup) {
    delta.feedGroups[article.feedGroup] = 1;
  }

  return delta;
};

const negateDelta = (delta: ReturnType<typeof statsDeltaForArticle>) => ({
  all: -delta.all,
  feedGroups: Object.fromEntries(
    Object.entries(delta.feedGroups).map(([feedGroup, count]) => [feedGroup, -count])
  ),
  manual: -delta.manual,
  saved: -delta.saved
});

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

export const getFeed = internalQuery({
  args: {
    feedId: v.id("feeds")
  },
  handler: async (ctx, args) => ctx.db.get(args.feedId)
});

export const getSyncArticleMeta = internalQuery({
  args: {
    externalId: v.string(),
    feedId: v.id("feeds")
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("articles")
      .withIndex("by_feed_and_external_id", (q) =>
        q.eq("feedId", args.feedId).eq("externalId", args.externalId)
      )
      .unique()
});

export const ensureFeedActive = internalQuery({
  args: {
    feedId: v.id("feeds")
  },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    return Boolean(feed && feed.isActive);
  }
});

export const listActiveFeedIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const feeds = await ctx.db
      .query("feeds")
      .withIndex("by_is_active", (q) => q.eq("isActive", true))
      .collect();

    return feeds.map((feed) => feed._id);
  }
});

export const markFeedRunning = internalMutation({
  args: {
    feedId: v.id("feeds")
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedId, {
      lastSyncError: undefined,
      syncStatus: "running"
    });
  }
});

export const markFeedSuccess = internalMutation({
  args: {
    feedId: v.id("feeds"),
    iconUrl: v.optional(v.string()),
    lastSyncedAt: v.number(),
    siteUrl: v.optional(v.string()),
    title: v.string()
  },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    if (!feed) {
      return;
    }

    const patch: Record<string, unknown> = {
      lastSyncError: undefined,
      lastSyncedAt: args.lastSyncedAt,
      syncStatus: "idle"
    };

    if ((feed.iconUrl || "") !== (args.iconUrl || "")) {
      patch.iconUrl = args.iconUrl;
    }
    if ((feed.siteUrl || "") !== (args.siteUrl || "")) {
      patch.siteUrl = args.siteUrl;
    }
    if (feed.title !== args.title) {
      patch.title = args.title;
    }

    await ctx.db.patch(args.feedId, patch);
  }
});

export const markFeedError = internalMutation({
  args: {
    feedId: v.id("feeds"),
    message: v.string()
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedId, {
      lastSyncError: args.message,
      syncStatus: "error"
    });
  }
});

export const upsertArticles = internalMutation({
  args: {
    articles: v.array(
      v.object({
        author: v.optional(v.string()),
        bodyHtml: v.string(),
        bodySource: v.union(v.literal("feed"), v.literal("fetched")),
        canonicalUrl: v.optional(v.string()),
        contentHash: v.string(),
        externalId: v.string(),
        feedGroup: v.string(),
        feedIconUrl: v.optional(v.string()),
        feedId: v.id("feeds"),
        feedSiteUrl: v.optional(v.string()),
        feedTitle: v.string(),
        previewText: v.string(),
        publishedAt: v.number(),
        readTimeMinutes: v.number(),
        sourceType: v.union(v.literal("feed"), v.literal("manual")),
        summaryHtml: v.string(),
        subtitle: v.optional(v.string()),
        thumbnailUrl: v.optional(v.string()),
        title: v.string(),
        url: v.string()
      })
    )
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const article of args.articles) {
      const existing = await ctx.db
        .query("articles")
        .withIndex("by_feed_and_external_id", (q) =>
          q.eq("feedId", article.feedId).eq("externalId", article.externalId)
        )
        .unique();

      if (existing?.deletedAt) {
        skipped += 1;
        continue;
      }

      if (existing) {
        const metadataChanged =
          existing.author !== article.author ||
          (existing.canonicalUrl || "") !== (article.canonicalUrl || "") ||
          getFeedGroup(existing) !== article.feedGroup ||
          (existing.feedIconUrl || "") !== (article.feedIconUrl || "") ||
          (existing.feedSiteUrl || "") !== (article.feedSiteUrl || "") ||
          existing.feedTitle !== article.feedTitle ||
          existing.previewText !== article.previewText ||
          existing.publishedAt !== article.publishedAt ||
          existing.readTimeMinutes !== article.readTimeMinutes ||
          getSourceType(existing) !== article.sourceType ||
          (existing.subtitle || "") !== (article.subtitle || "") ||
          (existing.thumbnailUrl || "") !== (article.thumbnailUrl || "") ||
          existing.title !== article.title ||
          existing.url !== article.url;

        const contentChanged = (existing.contentHash || "") !== article.contentHash;

        if (!metadataChanged && !contentChanged) {
          skipped += 1;
          continue;
        }

        const statsDelta = {
          all: 0,
          feedGroups: {} as Record<string, number>,
          manual: 0,
          saved: 0
        };
        const previousFeedGroup = getFeedGroup(existing);
        if (previousFeedGroup !== article.feedGroup && getSourceType(existing) === "feed") {
          if (previousFeedGroup) {
            statsDelta.feedGroups[previousFeedGroup] = -1;
          }
          if (article.feedGroup) {
            statsDelta.feedGroups[article.feedGroup] =
              (statsDelta.feedGroups[article.feedGroup] || 0) + 1;
          }
        }

        await ctx.db.patch(existing._id, {
          author: article.author,
          bodyHtml: undefined,
          bodySource: undefined,
          canonicalUrl: article.canonicalUrl,
          contentHash: article.contentHash,
          feedGroup: article.feedGroup,
          feedFolder: undefined,
          feedIconUrl: article.feedIconUrl,
          feedSiteUrl: article.feedSiteUrl,
          feedTitle: article.feedTitle,
          previewText: article.previewText,
          publishedAt: article.publishedAt,
          readTimeMinutes: article.readTimeMinutes,
          sourceType: article.sourceType,
          summaryHtml: undefined,
          subtitle: article.subtitle,
          thumbnailUrl: article.thumbnailUrl,
          title: article.title,
          url: article.url
        });

        if (contentChanged) {
          const body = await ctx.db
            .query("articleBodies")
            .withIndex("by_article_id", (q) => q.eq("articleId", existing._id))
            .unique();

          if (body) {
            await ctx.db.patch(body._id, {
              bodyHtml: article.bodyHtml,
              bodySource: article.bodySource,
              summaryHtml: article.summaryHtml
            });
          } else {
            await ctx.db.insert("articleBodies", {
              articleId: existing._id,
              bodyHtml: article.bodyHtml,
              bodySource: article.bodySource,
              summaryHtml: article.summaryHtml
            });
          }
        }

        if (Object.keys(statsDelta.feedGroups).length > 0) {
          await applyStatsDeltaInDb(ctx, statsDelta);
        }

        updated += 1;
        continue;
      }

      const articleId = await ctx.db.insert("articles", {
        author: article.author,
        bodyHtml: undefined,
        bodySource: undefined,
        canonicalUrl: article.canonicalUrl,
        contentHash: article.contentHash,
        deletedAt: undefined,
        externalId: article.externalId,
        feedGroup: article.feedGroup,
        feedIconUrl: article.feedIconUrl,
        feedId: article.feedId,
        feedSiteUrl: article.feedSiteUrl,
        feedTitle: article.feedTitle,
        isRead: false,
        isSaved: false,
        previewText: article.previewText,
        publishedAt: article.publishedAt,
        readTimeMinutes: article.readTimeMinutes,
        sourceType: article.sourceType,
        summaryHtml: undefined,
        subtitle: article.subtitle,
        thumbnailUrl: article.thumbnailUrl,
        title: article.title,
        url: article.url
      });

      await ctx.db.insert("articleBodies", {
        articleId,
        bodyHtml: article.bodyHtml,
        bodySource: article.bodySource,
        summaryHtml: article.summaryHtml
      });

      await applyStatsDeltaInDb(
        ctx,
        statsDeltaForArticle({
          feedGroup: article.feedGroup,
          sourceType: article.sourceType
        })
      );

      inserted += 1;
    }

    return {
      inserted,
      skipped,
      updated
    };
  }
});

const getFeedGroup = (value: { feedGroup?: string; folder?: string }) =>
  value.feedGroup || value.folder || "Uncategorized";

const getSourceType = (article: { sourceType?: "feed" | "manual" }) => article.sourceType || "feed";

const shouldStopSync = ({
  existing,
  feedLastSyncedAt,
  index,
  publishedAt
}: {
  existing: any;
  feedLastSyncedAt?: number;
  index: number;
  publishedAt: number;
}) =>
  Boolean(
    existing &&
    feedLastSyncedAt &&
    index >= RECENT_RECHECK_LIMIT &&
    publishedAt < feedLastSyncedAt
  );

const shouldProcessEntry = ({
  existing,
  feedLastSyncedAt,
  index,
  publishedAt
}: {
  existing: any;
  feedLastSyncedAt?: number;
  index: number;
  publishedAt: number;
}) =>
  !existing ||
  !feedLastSyncedAt ||
  index < RECENT_RECHECK_LIMIT ||
  publishedAt >= feedLastSyncedAt;

export const runFeed = internalAction({
  args: {
    feedId: v.id("feeds")
  },
  handler: async (ctx, args) => {
    const feed = await ctx.runQuery(internal.sync.getFeed, { feedId: args.feedId });
    if (!feed || !feed.isActive) {
      return { feedId: args.feedId, ok: false, error: "Feed not found" };
    }

    await ctx.runMutation(internal.sync.markFeedRunning, { feedId: args.feedId });

    try {
      const response = await fetchText(feed.feedUrl);
      const parsed = parseFeed(response.text, response.url).feed;
      const articles = [];
      const entries = parsed.entries.slice(0, MAX_SYNC_ENTRIES);

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const publishedAt = normalizePublishedAt(entry.publishedAt);
        const existing = await ctx.runQuery(internal.sync.getSyncArticleMeta, {
          externalId: entry.externalId,
          feedId: feed._id
        });

        if (existing?.deletedAt) {
          if (shouldStopSync({
            existing,
            feedLastSyncedAt: feed.lastSyncedAt,
            index,
            publishedAt
          })) {
            break;
          }
          continue;
        }

        if (!shouldProcessEntry({
          existing,
          feedLastSyncedAt: feed.lastSyncedAt,
          index,
          publishedAt
        })) {
          if (shouldStopSync({
            existing,
            feedLastSyncedAt: feed.lastSyncedAt,
            index,
            publishedAt
          })) {
            break;
          }
          continue;
        }

        const fetchedBody = await maybeFetchArticleBody(
          entry.url,
          entry.bodyHtml || entry.summaryHtml,
          entry.markdownUrl
        );
        const normalizedArticle = normalizeArticleContent({
          author: fetchedBody.author || entry.author || "",
          bodyHtml: fetchedBody.bodyHtml || sanitizeFragment(entry.summaryHtml || ""),
          feedTitle: parsed.title || feed.title,
          publishedAt: fetchedBody.publishedAt || entry.publishedAt,
          summaryHtml: sanitizeFragment(entry.summaryHtml || fetchedBody.bodyHtml || ""),
          thumbnailUrl: fetchedBody.thumbnailUrl || entry.thumbnailUrl || "",
          title: fetchedBody.title || entry.title
        });
        const bodyHtml = normalizedArticle.bodyHtml;
        const summaryHtml = normalizedArticle.summaryHtml;
        const previewText = normalizedArticle.previewText;
        const thumbnailUrl =
          fetchedBody.thumbnailUrl ||
          entry.thumbnailUrl ||
          findFirstImageUrl(bodyHtml || summaryHtml, entry.url || parsed.siteUrl || response.url) ||
          undefined;
        const canonicalUrl = fetchedBody.canonicalUrl || canonicalizeUrl(entry.url);
        const title = fetchedBody.title || entry.title;
        const subtitle = normalizedArticle.subtitle || undefined;
        const author = fetchedBody.author || entry.author || undefined;
        const publishedValue = fetchedBody.publishedAt || entry.publishedAt;
        const publishedAtValue = normalizePublishedAt(publishedValue);

        articles.push({
          author,
          bodyHtml,
          bodySource: fetchedBody.bodySource,
          canonicalUrl,
          contentHash: hashArticleContent({
            author: author || "",
            bodyHtml,
            canonicalUrl,
            previewText,
            publishedAt: publishedAtValue,
            summaryHtml,
            subtitle,
            thumbnailUrl,
            title,
            url: entry.url
          }),
          externalId: entry.externalId,
          feedGroup: feed.feedGroup || feed.folder || "Uncategorized",
          feedIconUrl: feed.iconUrl || undefined,
          feedId: feed._id,
          feedSiteUrl: parsed.siteUrl || feed.siteUrl || undefined,
          feedTitle: parsed.title || feed.title,
          previewText,
          publishedAt: publishedAtValue,
          readTimeMinutes: Math.max(
            fetchedBody.readTimeMinutes || 0,
            normalizedArticle.readTimeMinutes || estimateReadTime(bodyHtml)
          ),
          sourceType: "feed" as const,
          summaryHtml,
          subtitle,
          thumbnailUrl,
          title,
          url: entry.url
        });
      }

      const feedStillActive = await ctx.runQuery(internal.sync.ensureFeedActive, {
        feedId: feed._id
      });
      if (!feedStillActive) {
        return { feedId: feed._id, ok: false, error: "Feed removed during sync" };
      }

      const upsertResult = articles.length > 0
        ? await ctx.runMutation(internal.sync.upsertArticles, { articles })
        : { inserted: 0, skipped: 0, updated: 0 };

      const iconUrl = parsed.siteUrl
        ? new URL("/favicon.ico", parsed.siteUrl).toString()
        : (feed.iconUrl || undefined);

      const feedStillExists = await ctx.runQuery(internal.sync.ensureFeedActive, {
        feedId: feed._id
      });
      if (!feedStillExists) {
        return { feedId: feed._id, ok: false, error: "Feed removed during sync" };
      }

      await ctx.runMutation(internal.sync.markFeedSuccess, {
        feedId: feed._id,
        iconUrl,
        lastSyncedAt: Date.now(),
        siteUrl: parsed.siteUrl || feed.siteUrl || undefined,
        title: parsed.title || feed.title
      });

      return {
        feedId: feed._id,
        inserted: upsertResult.inserted,
        ok: true,
        skipped: upsertResult.skipped,
        syncedArticles: articles.length,
        touchedTodayDigest: upsertResult.inserted + upsertResult.updated > 0
          ? articles.some((article) => article.publishedAt > 0)
          : false,
        updatedPublishedAtValues: upsertResult.inserted + upsertResult.updated > 0
          ? articles.map((article) => article.publishedAt)
          : [],
        updated: upsertResult.updated
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.sync.markFeedError, {
        feedId: feed._id,
        message
      });

      return { feedId: feed._id, error: message, ok: false };
    }
  }
});

export const runActiveFeeds = internalAction({
  args: {},
  handler: async (ctx) => {
    const feedIds = await ctx.runQuery(internal.sync.listActiveFeedIds, {});
    const results = [];
    const publishedAtValues = [];

    for (const feedId of feedIds) {
      const result = await ctx.runAction(internal.sync.runFeed, { feedId });
      results.push(result);
      if (result?.ok && Array.isArray(result.updatedPublishedAtValues)) {
        publishedAtValues.push(...result.updatedPublishedAtValues);
      }
    }

    if (publishedAtValues.length > 0) {
      await ctx.runAction(internal.digestNode.refreshTodayFromPublishedAt, {
        publishedAtValues
      });
    }

    return { processed: results.length, results };
  }
});

export const runAllNow = action({
  args: {},
  handler: async (ctx) => ctx.runAction(internal.sync.runActiveFeeds, {})
});
