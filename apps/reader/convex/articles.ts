import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";

import { hashArticleContent } from "../lib/content-hash.mjs";
import { extractPageWithDefuddle } from "../lib/page-extractor.mjs";
import { normalizeArticleContent } from "../lib/article-body-normalizer.mjs";
import { canonicalizeUrl, stripHtml } from "../lib/html.mjs";
import { extractXPostFromUrl, isXStatusUrl } from "../lib/x-extractor.mjs";
import { extractYouTubeArticleFromHtml, isYouTubeUrl } from "../lib/youtube-extractor.mjs";
import { applyStatsDeltaInDb, buildArticleQueryFields, statsDeltaForArticle } from "./readerStats";

const DEFAULT_HEADERS = {
  "user-agent": "AgentCompany Reader/1.0 (+https://agent.company)"
};
const YOUTUBE_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0"
};

const fetchText = async (url: string, options: { headers?: Record<string, string> } = {}) => {
  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      ...(options.headers || {})
    },
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

const shouldUpdateExistingExtraction = (existing: any, existingBody: any, incoming: any) => {
  const existingBodyHtml = existingBody?.bodyHtml || existing.bodyHtml || "";
  const existingSummaryHtml = existingBody?.summaryHtml || existing.summaryHtml || "";
  const existingLength = stripHtml(existingBodyHtml || existingSummaryHtml).length;
  const incomingLength = stripHtml(incoming.bodyHtml || incoming.summaryHtml).length;

  return (
    incomingLength > existingLength + 120 ||
    (incomingLength >= Math.max(120, existingLength - 40) && (
      existingBodyHtml !== incoming.bodyHtml ||
      existingSummaryHtml !== incoming.summaryHtml ||
      (existing.subtitle || "") !== (incoming.subtitle || "") ||
      (existing.thumbnailUrl || "") !== (incoming.thumbnailUrl || "") ||
      (existing.author || "") !== (incoming.author || "") ||
      (existing.canonicalUrl || "") !== (incoming.canonicalUrl || "")
    )) ||
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

export const listReextractBatch = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const pagination = await ctx.db
      .query("articles")
      .withIndex("by_published_at")
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.min(Math.max(args.limit || 25, 1), 100)
      });

    return {
      articles: pagination.page.map((article) => ({
        _id: article._id,
        author: article.author || "",
        canonicalUrl: article.canonicalUrl || "",
        feedTitle: article.feedTitle,
        publishedAt: article.publishedAt,
        readTimeMinutes: article.readTimeMinutes,
        sourceType: article.sourceType || "feed",
        subtitle: article.subtitle || "",
        thumbnailUrl: article.thumbnailUrl || "",
        title: article.title,
        url: article.url
      })),
      isDone: pagination.isDone,
      nextCursor: pagination.isDone ? null : pagination.continueCursor
    };
  }
});

export const getArticleForReextract = internalQuery({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.deletedAt) {
      return null;
    }

    const body = await getBodyDoc(ctx, args.articleId);
    return {
      article,
      body
    };
  }
});

export const applyReextractedArticle = internalMutation({
  args: {
    articleId: v.id("articles"),
    extraction: v.object({
      author: v.optional(v.string()),
      bodyHtml: v.string(),
      bodySource: v.union(v.literal("feed"), v.literal("fetched")),
      canonicalUrl: v.string(),
      contentHash: v.string(),
      previewText: v.string(),
      readTimeMinutes: v.number(),
      summaryHtml: v.string(),
      subtitle: v.optional(v.string()),
      thumbnailUrl: v.optional(v.string()),
      title: v.optional(v.string())
    })
  },
  handler: async (ctx, args) => {
    const current = await ctx.db.get(args.articleId);
    if (!current || current.deletedAt) {
      return { updated: false, reason: "missing" as const };
    }

    const currentBody = await getBodyDoc(ctx, args.articleId);
    const next = {
      author: args.extraction.author || current.author,
      bodyHtml: args.extraction.bodyHtml,
      canonicalUrl: args.extraction.canonicalUrl || current.canonicalUrl || canonicalizeUrl(current.url),
      previewText: args.extraction.previewText,
      readTimeMinutes: args.extraction.readTimeMinutes,
      summaryHtml: args.extraction.summaryHtml,
      subtitle: args.extraction.subtitle || current.subtitle,
      thumbnailUrl: args.extraction.thumbnailUrl || current.thumbnailUrl,
      title: current.title || args.extraction.title || current.title
    };

    if (!shouldUpdateExistingExtraction(current, currentBody, next)) {
      return { updated: false, reason: "unchanged" as const };
    }

    await ctx.db.patch(args.articleId, {
      author: next.author,
      bodyHtml: undefined,
      bodySource: undefined,
      canonicalUrl: next.canonicalUrl,
      contentHash: args.extraction.contentHash,
      previewText: next.previewText,
      readTimeMinutes: next.readTimeMinutes,
      summaryHtml: undefined,
      subtitle: next.subtitle,
      thumbnailUrl: next.thumbnailUrl,
      title: next.title
    });

    if (currentBody) {
      await ctx.db.patch(currentBody._id, {
        bodyHtml: args.extraction.bodyHtml,
        bodySource: args.extraction.bodySource,
        summaryHtml: args.extraction.summaryHtml
      });
    } else {
      await ctx.db.insert("articleBodies", {
        articleId: args.articleId,
        bodyHtml: args.extraction.bodyHtml,
        bodySource: args.extraction.bodySource,
        summaryHtml: args.extraction.summaryHtml
      });
    }

    return { updated: true };
  }
});

export const applyNormalizedStoredBody = internalMutation({
  args: {
    articleId: v.id("articles"),
    bodyHtml: v.string(),
    contentHash: v.string(),
    previewText: v.string(),
    readTimeMinutes: v.number(),
    summaryHtml: v.string(),
    subtitle: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const current = await ctx.db.get(args.articleId);
    if (!current || current.deletedAt) {
      return { updated: false, reason: "missing" as const };
    }

    const body = await getBodyDoc(ctx, args.articleId);
    const currentBodyHtml = body?.bodyHtml || current.bodyHtml || "";
    const currentSummaryHtml = body?.summaryHtml || current.summaryHtml || "";

    if (
      currentBodyHtml === args.bodyHtml &&
      currentSummaryHtml === args.summaryHtml &&
      (current.previewText || "") === args.previewText &&
      (current.readTimeMinutes || 0) === args.readTimeMinutes &&
      (current.subtitle || "") === (args.subtitle || "")
    ) {
      return { updated: false, reason: "unchanged" as const };
    }

    await ctx.db.patch(args.articleId, {
      contentHash: args.contentHash,
      previewText: args.previewText,
      readTimeMinutes: args.readTimeMinutes,
      subtitle: args.subtitle
    });

    if (body) {
      await ctx.db.patch(body._id, {
        bodyHtml: args.bodyHtml,
        summaryHtml: args.summaryHtml
      });
    } else {
      await ctx.db.insert("articleBodies", {
        articleId: args.articleId,
        bodyHtml: args.bodyHtml,
        bodySource: "feed",
        summaryHtml: args.summaryHtml
      });
    }

    return { updated: true };
  }
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
      subtitle: v.optional(v.string()),
      thumbnailUrl: v.optional(v.string()),
      title: v.string(),
      url: v.string()
    })
  },
  handler: async (ctx, args) => {
    const queryFields = buildArticleQueryFields({
      feedTitle: args.article.feedTitle,
      publishedAt: args.article.publishedAt,
      sourceType: "manual"
    });
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
        isYoutube: queryFields.isYoutube,
        previewText: args.article.previewText,
        publishedDigestDate: queryFields.publishedDigestDate,
        publishedAt: args.article.publishedAt,
        readTimeMinutes: args.article.readTimeMinutes,
        sourceType: "manual",
        summaryHtml: undefined,
        subtitle: args.article.subtitle,
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
      await applyStatsDeltaInDb(
        ctx,
        statsDeltaForArticle({
          publishedDigestDate: queryFields.publishedDigestDate,
          sourceType: "manual"
        })
      );

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
        feedSiteUrl: args.article.feedSiteUrl || existing.feedSiteUrl,
        feedTitle: args.article.feedTitle || existing.feedTitle,
        isRead: shouldRestore ? false : existing.isRead,
        isSaved: shouldRestore ? false : existing.isSaved,
        isYoutube: queryFields.isYoutube,
        previewText: args.article.previewText,
        publishedDigestDate: queryFields.publishedDigestDate,
        readAt: shouldRestore ? undefined : existing.readAt,
        readTimeMinutes: args.article.readTimeMinutes,
        savedAt: shouldRestore ? undefined : existing.savedAt,
        summaryHtml: undefined,
        subtitle: args.article.subtitle !== undefined ? args.article.subtitle : existing.subtitle,
        thumbnailUrl: args.article.thumbnailUrl || existing.thumbnailUrl,
        title: args.article.title || existing.title,
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
      await applyStatsDeltaInDb(
        ctx,
        statsDeltaForArticle({
          feedGroup: sourceType === "feed" ? existing.feedGroup || "" : "",
          publishedDigestDate: queryFields.publishedDigestDate,
          sourceType,
          isSaved: false
        })
      );
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

    if (isXStatusUrl(requestedUrl)) {
      const extracted = await extractXPostFromUrl(requestedUrl);
      const canonicalUrl = extracted.canonicalUrl || canonicalizeUrl(requestedUrl);
      const title = extracted.title || `${extracted.author || "X"} on X`;
      const bodyHtml = extracted.bodyHtml;
      const summaryHtml = extracted.summaryHtml || bodyHtml;
      const previewText = extracted.previewText || stripHtml(summaryHtml || bodyHtml).slice(0, 220);

      return ctx.runMutation(internal.articles.upsertManualArticle, {
        article: {
          author: extracted.author || undefined,
          bodyHtml,
          bodySource: "fetched",
          canonicalUrl,
          contentHash: hashArticleContent({
            author: extracted.author || "",
            bodyHtml,
            canonicalUrl,
            previewText,
            publishedAt: extracted.publishedAt,
            summaryHtml,
            subtitle: "",
            thumbnailUrl: "",
            title,
            url: canonicalUrl
          }),
          externalId: canonicalUrl,
          feedIconUrl: undefined,
          feedSiteUrl: "https://x.com",
          feedTitle: extracted.siteName || "X",
          previewText,
          publishedAt: extracted.publishedAt,
          readTimeMinutes: Math.max(extracted.readTimeMinutes || 0, 1),
          summaryHtml,
          subtitle: undefined,
          thumbnailUrl: undefined,
          title,
          url: canonicalUrl
        }
      });
    }

    const page = await fetchText(
      requestedUrl,
      isYouTubeUrl(requestedUrl) ? { headers: YOUTUBE_HEADERS } : {}
    );
    if (isYouTubeUrl(page.url)) {
      const extracted = await extractYouTubeArticleFromHtml(page.text, page.url, {
        fetchText: async (url: string) => {
          const response = await fetchText(url, { headers: YOUTUBE_HEADERS });
          return response.text;
        }
      });
      const canonicalUrl = extracted.canonicalUrl || canonicalizeUrl(page.url);
      const previewText = extracted.previewText || stripHtml(extracted.summaryHtml || extracted.bodyHtml).slice(0, 220);

      if (
        extracted.quality !== "usable" ||
        !extracted.title ||
        stripHtml(extracted.bodyHtml || extracted.summaryHtml).length < 40
      ) {
        throw new Error("Could not extract a readable transcript or description from that YouTube URL");
      }

      return ctx.runMutation(internal.articles.upsertManualArticle, {
        article: {
          author: extracted.author || undefined,
          bodyHtml: extracted.bodyHtml,
          bodySource: "fetched",
          canonicalUrl,
          contentHash: hashArticleContent({
            author: extracted.author || "",
            bodyHtml: extracted.bodyHtml,
            canonicalUrl,
            previewText,
            publishedAt: normalizePublishedAt(extracted.publishedAt),
            summaryHtml: extracted.summaryHtml,
            subtitle: extracted.subtitle || "",
            thumbnailUrl: extracted.thumbnailUrl || "",
            title: extracted.title,
            url: page.url
          }),
          externalId: canonicalUrl,
          feedIconUrl: undefined,
          feedSiteUrl: new URL(canonicalUrl).origin,
          feedTitle: extracted.siteName || "YouTube",
          previewText,
          publishedAt: normalizePublishedAt(extracted.publishedAt),
          readTimeMinutes: Math.max(extracted.readTimeMinutes || 0, 1),
          summaryHtml: extracted.summaryHtml,
          subtitle: extracted.subtitle,
          thumbnailUrl: extracted.thumbnailUrl || undefined,
          title: extracted.title,
          url: canonicalUrl
        }
      });
    }

    const extracted = await extractPageWithDefuddle(page.text, page.url);
    const canonicalUrl = extracted.canonicalUrl || canonicalizeUrl(page.url);
    const title = extracted.title || deriveSiteTitle(page.url, extracted.siteName);
    const normalizedArticle = normalizeArticleContent({
      author: extracted.author || "",
      bodyHtml: extracted.bodyHtml,
      feedTitle: deriveSiteTitle(page.url, extracted.siteName),
      publishedAt: extracted.publishedAt,
      summaryHtml: extracted.summaryHtml || extracted.bodyHtml,
      thumbnailUrl: extracted.thumbnailUrl || "",
      title
    });
    const bodyHtml = normalizedArticle.bodyHtml;
    const summaryHtml = normalizedArticle.summaryHtml;
    const subtitle = normalizedArticle.subtitle || undefined;
    const previewText = normalizedArticle.previewText || stripHtml(summaryHtml || bodyHtml).slice(0, 220);

    if (
      extracted.quality !== "usable" ||
      !title ||
      stripHtml(bodyHtml || summaryHtml).length < 40
    ) {
      throw new Error("Could not extract a readable article body from that URL");
    }

    return ctx.runMutation(internal.articles.upsertManualArticle, {
      article: {
        author: extracted.author || undefined,
        bodyHtml,
        bodySource: "fetched",
        canonicalUrl,
        contentHash: hashArticleContent({
          author: extracted.author || "",
          bodyHtml,
          canonicalUrl,
          previewText,
          publishedAt: normalizePublishedAt(extracted.publishedAt),
          summaryHtml,
          subtitle,
          thumbnailUrl: extracted.thumbnailUrl || "",
          title,
          url: page.url
        }),
        externalId: canonicalUrl,
        feedIconUrl: undefined,
        feedSiteUrl: new URL(page.url).origin,
        feedTitle: deriveSiteTitle(page.url, extracted.siteName),
        previewText,
        publishedAt: normalizePublishedAt(extracted.publishedAt),
        readTimeMinutes: Math.max(extracted.readTimeMinutes || 0, normalizedArticle.readTimeMinutes),
        summaryHtml,
        subtitle,
        thumbnailUrl: extracted.thumbnailUrl || undefined,
        title,
        url: page.url
      }
    });
  }
});

export const reextractExistingArticles = action({
  args: {
    articleIds: v.optional(v.array(v.id("articles"))),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    if (args.articleIds && args.articleIds.length > 0) {
      let scanned = 0;
      let updated = 0;
      let failed = 0;
      const errors = [];

      for (const articleId of args.articleIds) {
        scanned += 1;

        try {
          const current = await ctx.runQuery(internal.articles.getArticleForReextract, {
            articleId
          });
          if (!current) {
            failed += 1;
            if (errors.length < 10) {
              errors.push(`Missing article ${articleId}`);
            }
            continue;
          }

          const page = await fetchText(current.article.url);
          const extracted = await extractPageWithDefuddle(page.text, page.url);
          const normalizedArticle = normalizeArticleContent({
            author: extracted.author || current.article.author || "",
            bodyHtml: extracted.bodyHtml,
            publishedAt: new Date(current.article.publishedAt).toISOString(),
            summaryHtml: extracted.summaryHtml || extracted.bodyHtml,
            thumbnailUrl: extracted.thumbnailUrl || current.article.thumbnailUrl || "",
            title: extracted.title || current.article.title
          });
          const bodyHtml = normalizedArticle.bodyHtml;
          const summaryHtml = normalizedArticle.summaryHtml;
          const subtitle = normalizedArticle.subtitle || undefined;
          const previewText = normalizedArticle.previewText || stripHtml(summaryHtml || bodyHtml).slice(0, 220);

          if (
            extracted.quality !== "usable" ||
            stripHtml(bodyHtml || summaryHtml).length < 40
          ) {
            failed += 1;
            if (errors.length < 10) {
              errors.push(`Too little content for ${current.article.url}`);
            }
            continue;
          }

          const result = await ctx.runMutation(internal.articles.applyReextractedArticle, {
            articleId,
            extraction: {
              author: extracted.author || undefined,
              bodyHtml,
              bodySource: "fetched",
              canonicalUrl: extracted.canonicalUrl || canonicalizeUrl(page.url),
              contentHash: hashArticleContent({
                author: extracted.author || current.article.author || "",
                bodyHtml,
                canonicalUrl: extracted.canonicalUrl || canonicalizeUrl(page.url),
                previewText,
                publishedAt: current.article.publishedAt,
                summaryHtml,
                subtitle,
                thumbnailUrl: extracted.thumbnailUrl || current.article.thumbnailUrl || "",
                title: extracted.title || current.article.title,
                url: page.url
              }),
              previewText,
              readTimeMinutes: Math.max(
                extracted.readTimeMinutes || 0,
                normalizedArticle.readTimeMinutes || current.article.readTimeMinutes || 1
              ),
              summaryHtml,
              subtitle,
              thumbnailUrl: extracted.thumbnailUrl || undefined,
              title: extracted.title || current.article.title
            }
          });

          if (result.updated) {
            updated += 1;
          }
        } catch (error) {
          failed += 1;
          if (errors.length < 10) {
            errors.push(`${articleId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      return {
        failed,
        scanned,
        updated,
        errors
      };
    }

    const perPage = Math.min(Math.max(args.limit || 25, 1), 100);
    let cursor = null;
    let scanned = 0;
    let updated = 0;
    let failed = 0;
    const errors = [];

    while (true) {
      const batch = await ctx.runQuery(internal.articles.listReextractBatch, {
        cursor: cursor || undefined,
        limit: perPage
      });

      for (const summary of batch.articles) {
        scanned += 1;

        try {
          const page = await fetchText(summary.url);
          const extracted = await extractPageWithDefuddle(page.text, page.url);
          const normalizedArticle = normalizeArticleContent({
            author: extracted.author || summary.author || "",
            bodyHtml: extracted.bodyHtml,
            publishedAt: summary.publishedAt,
            summaryHtml: extracted.summaryHtml || extracted.bodyHtml,
            thumbnailUrl: extracted.thumbnailUrl || summary.thumbnailUrl || "",
            title: extracted.title || summary.title
          });
          const bodyHtml = normalizedArticle.bodyHtml;
          const summaryHtml = normalizedArticle.summaryHtml;
          const subtitle = normalizedArticle.subtitle || undefined;
          const previewText = normalizedArticle.previewText || stripHtml(summaryHtml || bodyHtml).slice(0, 220);

          if (
            extracted.quality !== "usable" ||
            stripHtml(bodyHtml || summaryHtml).length < 40
          ) {
            failed += 1;
            if (errors.length < 10) {
              errors.push(`Too little content for ${summary.url}`);
            }
            continue;
          }

          const result = await ctx.runMutation(internal.articles.applyReextractedArticle, {
            articleId: summary._id,
            extraction: {
              author: extracted.author || undefined,
              bodyHtml,
              bodySource: "fetched",
              canonicalUrl: extracted.canonicalUrl || canonicalizeUrl(page.url),
              contentHash: hashArticleContent({
                author: extracted.author || summary.author || "",
                bodyHtml,
                canonicalUrl: extracted.canonicalUrl || canonicalizeUrl(page.url),
                previewText,
                publishedAt: summary.publishedAt,
                summaryHtml,
                subtitle,
                thumbnailUrl: extracted.thumbnailUrl || summary.thumbnailUrl || "",
                title: summary.title,
                url: page.url
              }),
              previewText,
              readTimeMinutes: Math.max(
                extracted.readTimeMinutes || 0,
                normalizedArticle.readTimeMinutes || summary.readTimeMinutes || 1
              ),
              summaryHtml,
              subtitle,
              thumbnailUrl: extracted.thumbnailUrl || undefined,
              title: extracted.title || summary.title
            }
          });

          if (result.updated) {
            updated += 1;
          }
        } catch (error) {
          failed += 1;
          if (errors.length < 10) {
            errors.push(`${summary.url}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      if (batch.isDone || !batch.nextCursor) {
        break;
      }

      cursor = batch.nextCursor;
    }

    return {
      failed,
      scanned,
      updated,
      errors
    };
  }
});

export const normalizeStoredBodies = action({
  args: {
    articleIds: v.optional(v.array(v.id("articles"))),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    if (args.articleIds && args.articleIds.length > 0) {
      let scanned = 0;
      let skipped = 0;
      let updated = 0;

      for (const articleId of args.articleIds) {
        scanned += 1;

        const current = await ctx.runQuery(internal.articles.getArticleForReextract, {
          articleId
        });
        if (!current) {
          skipped += 1;
          continue;
        }

        const currentBodyHtml = current.body?.bodyHtml || current.article.bodyHtml || "";
        const currentSummaryHtml = current.body?.summaryHtml || current.article.summaryHtml || "";
        if (!currentBodyHtml && !currentSummaryHtml) {
          skipped += 1;
          continue;
        }

        const normalizedArticle = normalizeArticleContent({
          author: current.article.author || "",
          bodyHtml: currentBodyHtml,
          feedTitle: current.article.feedTitle || "",
          publishedAt: new Date(current.article.publishedAt).toISOString(),
          summaryHtml: currentSummaryHtml,
          thumbnailUrl: current.article.thumbnailUrl || "",
          title: current.article.title
        });

        const result = await ctx.runMutation(internal.articles.applyNormalizedStoredBody, {
          articleId: current.article._id,
          bodyHtml: normalizedArticle.bodyHtml,
          contentHash: hashArticleContent({
            author: current.article.author || "",
            bodyHtml: normalizedArticle.bodyHtml,
            canonicalUrl: current.article.canonicalUrl || canonicalizeUrl(current.article.url),
            previewText: normalizedArticle.previewText,
            publishedAt: current.article.publishedAt,
            summaryHtml: normalizedArticle.summaryHtml,
            subtitle: normalizedArticle.subtitle || current.article.subtitle || "",
            thumbnailUrl: current.article.thumbnailUrl || "",
            title: current.article.title,
            url: current.article.url
          }),
          previewText: normalizedArticle.previewText,
          readTimeMinutes: normalizedArticle.readTimeMinutes || current.article.readTimeMinutes || 1,
          summaryHtml: normalizedArticle.summaryHtml,
          subtitle: normalizedArticle.subtitle || undefined
        });

        if (result.updated) {
          updated += 1;
        } else {
          skipped += 1;
        }
      }

      return {
        scanned,
        skipped,
        updated
      };
    }

    const perPage = Math.min(Math.max(args.limit || 25, 1), 100);
    let cursor = null;
    let scanned = 0;
    let updated = 0;
    let skipped = 0;

    while (true) {
      const batch = await ctx.runQuery(internal.articles.listReextractBatch, {
        cursor: cursor || undefined,
        limit: perPage
      });

      for (const summary of batch.articles) {
        scanned += 1;

        const current = await ctx.runQuery(internal.articles.getArticleForReextract, {
          articleId: summary._id
        });
        if (!current) {
          skipped += 1;
          continue;
        }

        const currentBodyHtml = current.body?.bodyHtml || current.article.bodyHtml || "";
        const currentSummaryHtml = current.body?.summaryHtml || current.article.summaryHtml || "";
        if (!currentBodyHtml && !currentSummaryHtml) {
          skipped += 1;
          continue;
        }

        const normalizedArticle = normalizeArticleContent({
          author: current.article.author || "",
          bodyHtml: currentBodyHtml,
          feedTitle: current.article.feedTitle || "",
          publishedAt: new Date(current.article.publishedAt).toISOString(),
          summaryHtml: currentSummaryHtml,
          thumbnailUrl: current.article.thumbnailUrl || "",
          title: current.article.title
        });

        const result = await ctx.runMutation(internal.articles.applyNormalizedStoredBody, {
          articleId: current.article._id,
          bodyHtml: normalizedArticle.bodyHtml,
          contentHash: hashArticleContent({
            author: current.article.author || "",
            bodyHtml: normalizedArticle.bodyHtml,
            canonicalUrl: current.article.canonicalUrl || canonicalizeUrl(current.article.url),
            previewText: normalizedArticle.previewText,
            publishedAt: current.article.publishedAt,
            summaryHtml: normalizedArticle.summaryHtml,
            subtitle: normalizedArticle.subtitle || current.article.subtitle || "",
            thumbnailUrl: current.article.thumbnailUrl || "",
            title: current.article.title,
            url: current.article.url
          }),
          previewText: normalizedArticle.previewText,
          readTimeMinutes: normalizedArticle.readTimeMinutes || current.article.readTimeMinutes || 1,
          summaryHtml: normalizedArticle.summaryHtml,
          subtitle: normalizedArticle.subtitle || undefined
        });

        if (result.updated) {
          updated += 1;
        } else {
          skipped += 1;
        }
      }

      if (batch.isDone || !batch.nextCursor) {
        break;
      }

      cursor = batch.nextCursor;
    }

    return {
      scanned,
      skipped,
      updated
    };
  }
});
