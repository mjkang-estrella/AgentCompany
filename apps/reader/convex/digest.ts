import { v } from "convex/values";

import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";

import {
  formatDigestDateLabel,
  getDigestTimezone,
  getTimeZoneDateKey,
  getTimeZoneDayRange,
  groupDigestInputs
} from "../lib/daily-digest.mjs";
import { stripHtml } from "../lib/html.mjs";
import { emptyStoredStats, getTodayFeedCount } from "./readerStats";

const DIGEST_TIMEZONE = getDigestTimezone();

const buildCounts = async (ctx: any) => {
  const stats = await ctx.db
    .query("readerStats")
    .withIndex("by_name", (q: any) => q.eq("name", "global"))
    .unique();
  const today = await getTodayFeedCount(ctx);

  const counts = {
    ...(stats ? {
      all: stats.all,
      feedGroups: { ...stats.feedGroups },
      manual: stats.manual,
      saved: stats.saved
    } : emptyStoredStats()),
    today: today.count
  };

  const feeds = await ctx.db.query("feeds").collect();
  for (const feed of feeds) {
    const feedGroup = (feed.feedGroup || feed.folder || "").trim();
    if (feedGroup && !(feedGroup in counts.feedGroups)) {
      counts.feedGroups[feedGroup] = 0;
    }
  }

  return counts;
};

const mapDigest = (digest: any, liveArticles: Map<string, any>) => ({
  articleCount: digest.articleCount || 0,
  error: digest.error || "",
  generatedAt: digest.generatedAt ? new Date(digest.generatedAt).toISOString() : "",
  intro: digest.intro || "",
  localDate: digest.localDate,
  sections: (digest.sections || []).map((section: any) => ({
    articles: (section.articles || []).map((article: any) => {
      const live = liveArticles.get(String(article.id));

      return {
        author: live?.author || article.author || "",
        feedGroup: live?.feedGroup || section.feedGroup || "",
        feedIconUrl: live?.feedIconUrl || section.feedIconUrl || "",
        feedId: live?.feedId || null,
        feedTitle: live?.feedTitle || section.feedTitle,
        id: article.id,
        isRead: Boolean(live?.isRead),
        isSaved: Boolean(live?.isSaved),
        previewText: live?.previewText || article.previewText || "",
        publishedAt: live?.publishedAt
          ? new Date(live.publishedAt).toISOString()
          : article.publishedAt,
        readTimeMinutes: live?.readTimeMinutes || 1,
        sourceType: live?.sourceType || "feed",
        subtitle: live?.subtitle || article.subtitle || "",
        thumbnailUrl: live?.thumbnailUrl || "",
        title: live?.title || article.title,
        url: live?.url || article.url
      };
    }),
    feedGroup: section.feedGroup || "",
    feedIconUrl: section.feedIconUrl || "",
    feedTitle: section.feedTitle,
    summary: section.summary
  })),
  status: digest.status,
  timezone: digest.timezone
});

const buildDigestPayload = async (
  ctx: any,
  {
    includeCounts,
    localDate,
    timezone
  }: {
    includeCounts: boolean;
    localDate: string;
    timezone: string;
  }
) => {
  const digest = await ctx.db
    .query("dailyDigests")
    .withIndex("by_date_and_timezone", (q: any) =>
      q.eq("localDate", localDate).eq("timezone", timezone)
    )
    .unique();
  const liveArticles = new Map(
    (await Promise.all((digest?.articleIds || []).map((articleId: any) => ctx.db.get(articleId))))
      .filter(Boolean)
      .map((article: any) => [String(article._id), article])
  );

  const todayLocalDate = getTimeZoneDateKey(timezone);

  return {
    counts: includeCounts ? await buildCounts(ctx) : undefined,
    digest: digest ? mapDigest(digest, liveArticles) : null,
    isToday: localDate === todayLocalDate,
    localDate,
    localDateLabel: formatDigestDateLabel(localDate),
    status: digest?.status || "missing",
    timezone,
    todayLocalDate
  };
};

export const getByDate = internalQuery({
  args: {
    localDate: v.string(),
    timezone: v.string()
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("dailyDigests")
      .withIndex("by_date_and_timezone", (q) =>
        q.eq("localDate", args.localDate).eq("timezone", args.timezone)
      )
      .unique()
});

export const collectDigestInputs = internalQuery({
  args: {
    localDate: v.string(),
    timezone: v.string()
  },
  handler: async (ctx, args) => {
    const range = getTimeZoneDayRange(args.timezone, new Date(`${args.localDate}T12:00:00.000Z`));
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_published_at")
      .order("desc")
      .filter((q: any) =>
        q.and(
          q.eq(q.field("deletedAt"), undefined),
          q.eq(q.field("sourceType"), "feed"),
          q.gte(q.field("publishedAt"), range.start),
          q.lt(q.field("publishedAt"), range.end)
        )
      )
      .collect();

    const grouped = groupDigestInputs(
      await Promise.all(
        articles.map(async (article: any) => {
          const body = await ctx.db
            .query("articleBodies")
            .withIndex("by_article_id", (q: any) => q.eq("articleId", article._id))
            .unique();

          const sourceHtml =
            body?.summaryHtml ||
            body?.bodyHtml ||
            article.summaryHtml ||
            article.bodyHtml ||
            "";
          const bodyExcerpt = stripHtml(sourceHtml).slice(0, 1400);

          return {
            author: article.author || "",
            bodyExcerpt,
            feedGroup: article.feedGroup || article.folder || "",
            feedIconUrl: article.feedIconUrl || "",
            feedId: article.feedId || "",
            feedTitle: article.feedTitle,
            id: article._id,
            previewText: article.previewText || "",
            publishedAt: new Date(article.publishedAt).toISOString(),
            subtitle: article.subtitle || "",
            title: article.title,
            url: article.url
          };
        })
      )
    );

    return {
      articleCount: articles.length,
      articleIds: articles.map((article: any) => article._id),
      sections: grouped
    };
  }
});

export const upsertDigestStatus = internalMutation({
  args: {
    error: v.optional(v.string()),
    localDate: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("ready"),
      v.literal("failed")
    ),
    timezone: v.string()
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyDigests")
      .withIndex("by_date_and_timezone", (q) =>
        q.eq("localDate", args.localDate).eq("timezone", args.timezone)
      )
      .unique();

    const patch = {
      error: args.error,
      status: args.status
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return ctx.db.insert("dailyDigests", {
      articleCount: 0,
      articleIds: [],
      error: args.error,
      intro: "",
      localDate: args.localDate,
      sections: [],
      status: args.status,
      timezone: args.timezone
    });
  }
});

export const saveGeneratedDigest = internalMutation({
  args: {
    articleCount: v.number(),
    articleIds: v.array(v.id("articles")),
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
    timezone: v.string()
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyDigests")
      .withIndex("by_date_and_timezone", (q) =>
        q.eq("localDate", args.localDate).eq("timezone", args.timezone)
      )
      .unique();

    const payload = {
      articleCount: args.articleCount,
      articleIds: args.articleIds,
      error: undefined,
      generatedAt: Date.now(),
      intro: args.intro,
      localDate: args.localDate,
      sections: args.sections,
      status: "ready" as const,
      timezone: args.timezone
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return ctx.db.insert("dailyDigests", payload);
  }
});

export const getToday = query({
  args: {
    includeCounts: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const timezone = DIGEST_TIMEZONE;
    const localDate = getTimeZoneDateKey(timezone);
    return buildDigestPayload(ctx, {
      includeCounts: args.includeCounts !== false,
      localDate,
      timezone
    });
  }
});

export const getForDate = query({
  args: {
    includeCounts: v.optional(v.boolean()),
    localDate: v.string()
  },
  handler: async (ctx, args) => {
    const timezone = DIGEST_TIMEZONE;
    return buildDigestPayload(ctx, {
      includeCounts: args.includeCounts !== false,
      localDate: args.localDate,
      timezone
    });
  }
});

export const ensureToday = action({
  args: {
    force: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const timezone = DIGEST_TIMEZONE;
    const localDate = getTimeZoneDateKey(timezone);
    const existing = await ctx.runQuery(internal.digest.getByDate, {
      localDate,
      timezone
    });

    if (!args.force && existing && ["pending", "running", "ready"].includes(existing.status)) {
      return {
        localDate,
        status: existing.status,
        timezone
      };
    }

    await ctx.runMutation(internal.digest.upsertDigestStatus, {
      localDate,
      status: "pending",
      timezone
    });
    await ctx.scheduler.runAfter(0, internal.digestNode.generateForDate, {
      localDate,
      timezone
    });

    return {
      localDate,
      status: "pending",
      timezone
    };
  }
});
