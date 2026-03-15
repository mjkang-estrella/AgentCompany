import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";

import { parseFeed } from "../lib/feed-utils.mjs";
import {
  estimateReadTime,
  extractReadableContent,
  renderMarkdownFragment,
  sanitizeFragment,
  stripHtml
} from "../lib/html.mjs";

const DEFAULT_HEADERS = {
  "user-agent": "AgentCompany Reader/1.0 (+https://agent.company)"
};

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

const maybeFetchArticleBody = async (url: string, existingHtml: string, markdownUrl = "") => {
  if (stripHtml(existingHtml).length >= 400 || (!url && !markdownUrl)) {
    return {
      bodyHtml: sanitizeFragment(existingHtml),
      bodySource: "feed" as const
    };
  }

  if (markdownUrl) {
    try {
      const markdown = await fetchText(markdownUrl);
      const rendered = renderMarkdownFragment(markdown.text);
      if (stripHtml(rendered).length > stripHtml(existingHtml).length) {
        return {
          bodyHtml: rendered,
          bodySource: "fetched" as const
        };
      }
    } catch {
      // Fall through to page extraction.
    }
  }

  if (url) {
    try {
      const page = await fetchText(url);
      const extracted = extractReadableContent(page.text);
      if (stripHtml(extracted).length > stripHtml(existingHtml).length) {
        return {
          bodyHtml: extracted,
          bodySource: "fetched" as const
        };
      }
    } catch {
      // Fall through to feed body.
    }
  }

  return {
    bodyHtml: sanitizeFragment(existingHtml),
    bodySource: "feed" as const
  };
};

export const getFeed = internalQuery({
  args: {
    feedId: v.id("feeds")
  },
  handler: async (ctx, args) => ctx.db.get(args.feedId)
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
    await ctx.db.patch(args.feedId, {
      iconUrl: args.iconUrl,
      lastSyncError: undefined,
      lastSyncedAt: args.lastSyncedAt,
      siteUrl: args.siteUrl,
      syncStatus: "idle",
      title: args.title
    });
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
        externalId: v.string(),
        feedFolder: v.string(),
        feedIconUrl: v.optional(v.string()),
        feedId: v.id("feeds"),
        feedSiteUrl: v.optional(v.string()),
        feedTitle: v.string(),
        previewText: v.string(),
        publishedAt: v.number(),
        readTimeMinutes: v.number(),
        summaryHtml: v.string(),
        thumbnailUrl: v.optional(v.string()),
        title: v.string(),
        url: v.string()
      })
    )
  },
  handler: async (ctx, args) => {
    for (const article of args.articles) {
      const existing = await ctx.db
        .query("articles")
        .withIndex("by_feed_and_external_id", (q) =>
          q.eq("feedId", article.feedId).eq("externalId", article.externalId)
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          author: article.author,
          bodyHtml: article.bodyHtml,
          bodySource: article.bodySource,
          feedFolder: article.feedFolder,
          feedIconUrl: article.feedIconUrl,
          feedSiteUrl: article.feedSiteUrl,
          feedTitle: article.feedTitle,
          previewText: article.previewText,
          publishedAt: article.publishedAt,
          readTimeMinutes: article.readTimeMinutes,
          summaryHtml: article.summaryHtml,
          thumbnailUrl: article.thumbnailUrl,
          title: article.title,
          url: article.url
        });
        continue;
      }

      await ctx.db.insert("articles", {
        ...article,
        isRead: false,
        isSaved: false
      });
    }
  }
});

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

      for (const entry of parsed.entries.slice(0, 50)) {
        const fetchedBody = await maybeFetchArticleBody(
          entry.url,
          entry.bodyHtml || entry.summaryHtml,
          entry.markdownUrl
        );
        const bodyHtml = fetchedBody.bodyHtml || sanitizeFragment(entry.summaryHtml || "");
        const summaryHtml = sanitizeFragment(entry.summaryHtml || bodyHtml);

        articles.push({
          author: entry.author || undefined,
          bodyHtml,
          bodySource: fetchedBody.bodySource,
          externalId: entry.externalId,
          feedFolder: feed.folder,
          feedIconUrl: feed.iconUrl || undefined,
          feedId: feed._id,
          feedSiteUrl: parsed.siteUrl || feed.siteUrl || undefined,
          feedTitle: parsed.title || feed.title,
          previewText: stripHtml(summaryHtml || bodyHtml).slice(0, 220),
          publishedAt: normalizePublishedAt(entry.publishedAt),
          readTimeMinutes: estimateReadTime(bodyHtml),
          summaryHtml,
          thumbnailUrl:
            entry.thumbnailUrl ||
            findFirstImageUrl(bodyHtml || summaryHtml, entry.url || parsed.siteUrl || response.url) ||
            undefined,
          title: entry.title,
          url: entry.url
        });
      }

      if (articles.length > 0) {
        await ctx.runMutation(internal.sync.upsertArticles, { articles });
      }

      const iconUrl = parsed.siteUrl
        ? new URL("/favicon.ico", parsed.siteUrl).toString()
        : (feed.iconUrl || undefined);

      await ctx.runMutation(internal.sync.markFeedSuccess, {
        feedId: feed._id,
        iconUrl,
        lastSyncedAt: Date.now(),
        siteUrl: parsed.siteUrl || feed.siteUrl || undefined,
        title: parsed.title || feed.title
      });

      return { feedId: feed._id, ok: true, syncedArticles: articles.length };
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

    for (const feedId of feedIds) {
      results.push(await ctx.runAction(internal.sync.runFeed, { feedId }));
    }

    return { processed: results.length, results };
  }
});

export const runAllNow = action({
  args: {},
  handler: async (ctx) => ctx.runAction(internal.sync.runActiveFeeds, {})
});
