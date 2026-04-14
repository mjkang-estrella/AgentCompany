import { getDigestTimezone, getTimeZoneDateKey, getTimeZoneDayRange } from "../lib/daily-digest.mjs";

const STATS_NAME = "global";

export const emptyStoredStats = () => ({
  all: 0,
  feedGroups: {} as Record<string, number>,
  manual: 0,
  saved: 0
});

export const emptyStatsDelta = () => ({
  all: 0,
  dailyFeedCounts: {} as Record<string, number>,
  feedGroups: {} as Record<string, number>,
  manual: 0,
  saved: 0
});

export const getDigestDateForTimestamp = (publishedAt: number) =>
  getTimeZoneDateKey(getDigestTimezone(), new Date(publishedAt));

export const buildArticleQueryFields = ({
  feedTitle,
  publishedAt,
  sourceType
}: {
  feedTitle: string;
  publishedAt: number;
  sourceType: "feed" | "manual";
}) => ({
  isYoutube: sourceType === "manual" && feedTitle === "YouTube",
  publishedDigestDate: getDigestDateForTimestamp(publishedAt)
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

export const statsDeltaForArticle = (article: {
  feedGroup?: string;
  isSaved?: boolean;
  publishedAt?: number;
  publishedDigestDate?: string;
  sourceType?: "feed" | "manual";
}) => {
  const delta = emptyStatsDelta();
  const sourceType = article.sourceType || "feed";

  delta.all = 1;
  if (article.isSaved) {
    delta.saved = 1;
  }

  if (sourceType === "manual") {
    delta.manual = 1;
    return delta;
  }

  if (article.feedGroup) {
    delta.feedGroups[article.feedGroup] = 1;
  }
  const publishedDigestDate =
    article.publishedDigestDate ||
    (Number.isFinite(article.publishedAt) ? getDigestDateForTimestamp(article.publishedAt as number) : "");
  if (publishedDigestDate) {
    delta.dailyFeedCounts[publishedDigestDate] = 1;
  }

  return delta;
};

export const negateStatsDelta = (
  delta: ReturnType<typeof emptyStatsDelta>
) => ({
  all: -delta.all,
  dailyFeedCounts: Object.fromEntries(
    Object.entries(delta.dailyFeedCounts).map(([localDate, count]) => [localDate, -count])
  ),
  feedGroups: Object.fromEntries(
    Object.entries(delta.feedGroups).map(([feedGroup, count]) => [feedGroup, -count])
  ),
  manual: -delta.manual,
  saved: -delta.saved
});

const getStatsDocument = async (ctx: { db: any }) =>
  ctx.db
    .query("readerStats")
    .withIndex("by_name", (q: any) => q.eq("name", STATS_NAME))
    .unique();

const getDailyStatsDocument = async (ctx: { db: any }, localDate: string) =>
  ctx.db
    .query("readerDailyStats")
    .withIndex("by_local_date", (q: any) => q.eq("localDate", localDate))
    .unique();

export const replaceStatsDocument = async (
  ctx: { db: any },
  stats: ReturnType<typeof emptyStoredStats>,
  dailyFeedCounts: Record<string, number> = {}
) => {
  const existing = await getStatsDocument(ctx);

  if (existing) {
    await ctx.db.patch(existing._id, stats);
  } else {
    await ctx.db.insert("readerStats", {
      ...stats,
      name: STATS_NAME
    });
  }

  const existingDaily = await ctx.db.query("readerDailyStats").collect();
  for (const entry of existingDaily) {
    await ctx.db.delete(entry._id);
  }

  for (const [localDate, count] of Object.entries(dailyFeedCounts)) {
    const next = clampCount(count);
    if (next === 0) {
      continue;
    }

    await ctx.db.insert("readerDailyStats", {
      feedCount: next,
      localDate
    });
  }
};

export const applyStatsDeltaInDb = async (
  ctx: { db: any },
  delta: ReturnType<typeof emptyStatsDelta>
) => {
  const existing = await getStatsDocument(ctx);
  const current = existing ? {
    all: existing.all,
    feedGroups: existing.feedGroups,
    manual: existing.manual,
    saved: existing.saved
  } : emptyStoredStats();

  const next = {
    all: clampCount(current.all + delta.all),
    feedGroups: mergeFeedGroupCounts(current.feedGroups, delta.feedGroups),
    manual: clampCount(current.manual + delta.manual),
    saved: clampCount(current.saved + delta.saved)
  };

  if (existing) {
    await ctx.db.patch(existing._id, next);
  } else {
    await ctx.db.insert("readerStats", {
      ...next,
      name: STATS_NAME
    });
  }

  for (const [localDate, change] of Object.entries(delta.dailyFeedCounts)) {
    if (!localDate || change === 0) {
      continue;
    }

    const daily = await getDailyStatsDocument(ctx, localDate);
    const nextCount = clampCount((daily?.feedCount || 0) + change);

    if (daily && nextCount === 0) {
      await ctx.db.delete(daily._id);
      continue;
    }

    if (daily) {
      await ctx.db.patch(daily._id, {
        feedCount: nextCount
      });
      continue;
    }

    if (nextCount > 0) {
      await ctx.db.insert("readerDailyStats", {
        feedCount: nextCount,
        localDate
      });
    }
  }
};

export const getTodayDigestLocalDate = () => getTimeZoneDateKey(getDigestTimezone());

export const getTodayFeedCount = async (ctx: { db: any }) => {
  const localDate = getTodayDigestLocalDate();
  const materialized = await getDailyStatsDocument(ctx, localDate);

  if (materialized) {
    return {
      count: materialized.feedCount || 0,
      localDate
    };
  }

  const range = getTimeZoneDayRange(getDigestTimezone());
  const fallback = await ctx.db
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

  return {
    count: fallback.length,
    localDate
  };
};
