import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";

import { hashArticleContent } from "../lib/content-hash.mjs";
import {
  canonicalizeUrl,
  estimateReadTime,
  extractPageMetadata,
  extractReadableContent,
  sanitizeFragment,
  stripHtml
} from "../lib/html.mjs";

const DEFAULT_HEADERS = {
  "user-agent": "AgentCompany Reader/1.0 (+https://agent.company)"
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

const deriveSiteTitle = (finalUrl: string, siteName: string) => {
  if (siteName) {
    return siteName;
  }

  try {
    const hostname = new URL(finalUrl).hostname.replace(/^www\./iu, "");
    const base = hostname.split(".").slice(-2, -1)[0] || hostname.split(".")[0] || hostname;
    return base
      .split(/[-_]+/u)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  } catch {
    return "Manual article";
  }
};

const normalizePublishedAt = (value: string) => {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.valueOf()) ? Date.now() : parsed.valueOf();
};

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

const getBodyDoc = async (ctx: { db: any }, articleId: any) =>
  ctx.db
    .query("articleBodies")
    .withIndex("by_article_id", (q: any) => q.eq("articleId", articleId))
    .unique();

const isRicherArticle = (existing: any, existingBody: any, incoming: any) => {
  const existingLength = stripHtml(
    existingBody?.bodyHtml || existingBody?.summaryHtml || existing.bodyHtml || existing.summaryHtml
  ).length;
  const incomingLength = stripHtml(incoming.bodyHtml || incoming.summaryHtml).length;

  return (
    incomingLength > existingLength + 120 ||
    (!existing.thumbnailUrl && Boolean(incoming.thumbnailUrl)) ||
    (!existing.author && Boolean(incoming.author))
  );
};

export const getByCanonicalUrl = internalQuery({
  args: {
    canonicalUrl: v.string()
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("articles")
      .withIndex("by_canonical_url", (q) => q.eq("canonicalUrl", args.canonicalUrl))
      .unique()
});

export const upsertManualArticle = internalMutation({
  args: {
    article: v.object({
      author: v.optional(v.string()),
      bodyHtml: v.string(),
      bodySource: v.union(v.literal("feed"), v.literal("fetched")),
      canonicalUrl: v.string(),
      contentHash: v.string(),
      externalId: v.string(),
      feedIconUrl: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("articles")
      .withIndex("by_canonical_url", (q) => q.eq("canonicalUrl", args.article.canonicalUrl))
      .unique();

    if (!existing) {
      const articleId = await ctx.db.insert("articles", {
        author: args.article.author,
        bodyHtml: undefined,
        bodySource: undefined,
        canonicalUrl: args.article.canonicalUrl,
        contentHash: args.article.contentHash,
        deletedAt: undefined,
        externalId: args.article.externalId,
        feedGroup: undefined,
        feedId: undefined,
        feedFolder: undefined,
        feedIconUrl: undefined,
        feedSiteUrl: args.article.feedSiteUrl,
        feedTitle: args.article.feedTitle,
        isRead: false,
        isSaved: false,
        previewText: args.article.previewText,
        publishedAt: args.article.publishedAt,
        readTimeMinutes: args.article.readTimeMinutes,
        sourceType: "manual",
        summaryHtml: undefined,
        thumbnailUrl: args.article.thumbnailUrl,
        title: args.article.title,
        url: args.article.url
      });

      await ctx.db.insert("articleBodies", {
        articleId,
        bodyHtml: args.article.bodyHtml,
        bodySource: args.article.bodySource,
        summaryHtml: args.article.summaryHtml
      });
      await applyStatsDeltaInDb(ctx, {
        all: 1,
        feedGroups: {},
        manual: 1,
        saved: 0
      });

      return {
        articleId,
        created: true,
        deduped: false
      };
    }

    const existingBody = await getBodyDoc(ctx, existing._id);
    const shouldRestore = Boolean(existing.deletedAt);
    const shouldUpdateBody = shouldRestore || isRicherArticle(existing, existingBody, args.article);

    if (shouldRestore || shouldUpdateBody) {
      await ctx.db.patch(existing._id, {
        author: args.article.author || existing.author,
        bodyHtml: undefined,
        bodySource: undefined,
        canonicalUrl: args.article.canonicalUrl,
        contentHash: args.article.contentHash,
        deletedAt: undefined,
        isRead: shouldRestore ? false : existing.isRead,
        isSaved: shouldRestore ? false : existing.isSaved,
        previewText: args.article.previewText,
        readAt: shouldRestore ? undefined : existing.readAt,
        readTimeMinutes: args.article.readTimeMinutes,
        savedAt: shouldRestore ? undefined : existing.savedAt,
        summaryHtml: undefined,
        thumbnailUrl: args.article.thumbnailUrl || existing.thumbnailUrl,
        title: existing.title || args.article.title,
        url: args.article.url
      });

      if (existingBody) {
        await ctx.db.patch(existingBody._id, {
          bodyHtml: args.article.bodyHtml,
          bodySource: args.article.bodySource,
          summaryHtml: args.article.summaryHtml
        });
      } else {
        await ctx.db.insert("articleBodies", {
          articleId: existing._id,
          bodyHtml: args.article.bodyHtml,
          bodySource: args.article.bodySource,
          summaryHtml: args.article.summaryHtml
        });
      }
    }

    if (shouldRestore) {
      const sourceType = existing.sourceType || "manual";
      await applyStatsDeltaInDb(ctx, {
        all: 1,
        feedGroups: sourceType === "feed" && existing.feedGroup
          ? { [existing.feedGroup]: 1 }
          : {},
        manual: sourceType === "manual" ? 1 : 0,
        saved: 0
      });
    }

    return {
      articleId: existing._id,
      created: false,
      deduped: true
    };
  }
});

export const addFromUrl = action({
  args: {
    url: v.string()
  },
  handler: async (ctx, args) => {
    const requestedUrl = args.url.trim();
    if (!requestedUrl) {
      throw new Error("URL is required");
    }

    if (!canonicalizeUrl(requestedUrl)) {
      throw new Error("Please enter a valid article URL");
    }

    const page = await fetchText(requestedUrl);
    const canonicalUrl = canonicalizeUrl(page.url);
    const metadata = extractPageMetadata(page.text, page.url);
    const extractedBody = extractReadableContent(page.text);
    const fallbackSummary = metadata.description ? `<p>${metadata.description}</p>` : "";
    const bodyHtml = sanitizeFragment(extractedBody || fallbackSummary);
    const summaryHtml = sanitizeFragment(fallbackSummary || bodyHtml);
    const title = metadata.title || deriveSiteTitle(page.url, metadata.siteName);
    const previewText = stripHtml(summaryHtml || bodyHtml).slice(0, 220);

    if (!title || stripHtml(bodyHtml || summaryHtml).length < 40) {
      throw new Error("Could not extract a readable article body from that URL");
    }

    return ctx.runMutation(internal.articles.upsertManualArticle, {
      article: {
        author: metadata.author || undefined,
        bodyHtml,
        bodySource: "fetched",
        canonicalUrl,
        contentHash: hashArticleContent({
          author: metadata.author || "",
          bodyHtml,
          canonicalUrl,
          previewText,
          publishedAt: normalizePublishedAt(metadata.publishedAt),
          summaryHtml,
          thumbnailUrl: metadata.thumbnailUrl || "",
          title,
          url: page.url
        }),
        externalId: canonicalUrl,
        feedIconUrl: undefined,
        feedSiteUrl: new URL(page.url).origin,
        feedTitle: deriveSiteTitle(page.url, metadata.siteName),
        previewText,
        publishedAt: normalizePublishedAt(metadata.publishedAt),
        readTimeMinutes: estimateReadTime(bodyHtml),
        summaryHtml,
        thumbnailUrl: metadata.thumbnailUrl || undefined,
        title,
        url: page.url
      }
    });
  }
});
