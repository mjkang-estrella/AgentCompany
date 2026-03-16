import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";

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

const isRicherArticle = (existing: any, incoming: any) => {
  const existingLength = stripHtml(existing.bodyHtml || existing.summaryHtml).length;
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
        ...args.article,
        deletedAt: undefined,
        feedGroup: undefined,
        feedId: undefined,
        feedFolder: undefined,
        isRead: false,
        isSaved: false,
        sourceType: "manual"
      });

      return {
        articleId,
        created: true,
        deduped: false
      };
    }

    const shouldRestore = Boolean(existing.deletedAt);

    if (shouldRestore || isRicherArticle(existing, args.article)) {
      await ctx.db.patch(existing._id, {
        author: args.article.author || existing.author,
        bodyHtml: args.article.bodyHtml,
        bodySource: args.article.bodySource,
        canonicalUrl: args.article.canonicalUrl,
        deletedAt: undefined,
        isRead: shouldRestore ? false : existing.isRead,
        isSaved: shouldRestore ? false : existing.isSaved,
        previewText: args.article.previewText,
        readAt: shouldRestore ? undefined : existing.readAt,
        readTimeMinutes: args.article.readTimeMinutes,
        savedAt: shouldRestore ? undefined : existing.savedAt,
        summaryHtml: args.article.summaryHtml,
        thumbnailUrl: args.article.thumbnailUrl || existing.thumbnailUrl,
        title: existing.title || args.article.title,
        url: args.article.url
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

    if (!title || stripHtml(bodyHtml || summaryHtml).length < 40) {
      throw new Error("Could not extract a readable article body from that URL");
    }

    return ctx.runMutation(internal.articles.upsertManualArticle, {
      article: {
        author: metadata.author || undefined,
        bodyHtml,
        bodySource: "fetched",
        canonicalUrl,
        externalId: canonicalUrl,
        feedIconUrl: undefined,
        feedSiteUrl: new URL(page.url).origin,
        feedTitle: deriveSiteTitle(page.url, metadata.siteName),
        previewText: stripHtml(summaryHtml || bodyHtml).slice(0, 220),
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
