import { createClient } from "@supabase/supabase-js";

import { decodeHtmlEntities, estimateReadTime, sanitizeFragment, stripHtml } from "./html.mjs";
import { resolveFeedInput } from "./feed-discovery.mjs";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

const articleSelect = `
  id,
  feed_id,
  title,
  url,
  author,
  published_at,
  thumbnail_url,
  summary_html,
  body_html,
  body_source,
  read_time_minutes,
  is_read,
  is_saved,
  feed:feeds!inner(id, title, folder, site_url, icon_url)
`;

const createSupabase = ({ url, serviceRoleKey }) =>
  createClient(url, serviceRoleKey, {
    auth: { persistSession: false }
  });

const mapSummary = (row) => ({
  author: decodeHtmlEntities(row.author || ""),
  feedFolder: row.feed_folder,
  feedIconUrl: row.feed_icon_url || "",
  feedId: row.feed_id,
  feedTitle: decodeHtmlEntities(row.feed_title),
  id: row.id,
  isRead: Boolean(row.is_read),
  isSaved: Boolean(row.is_saved),
  previewText: stripHtml(row.summary_html || "").slice(0, 220),
  publishedAt: row.published_at,
  readTimeMinutes: row.read_time_minutes || 1,
  thumbnailUrl: row.thumbnail_url || "",
  title: decodeHtmlEntities(row.title),
  url: row.url
});

const mapArticle = (row) => {
  const bodyHtml = sanitizeFragment(row.body_html || row.summary_html || "");
  return {
    author: decodeHtmlEntities(row.author || ""),
    bodyHtml,
    bodySource: row.body_source || "feed",
    feedFolder: row.feed.folder,
    feedIconUrl: row.feed.icon_url || "",
    feedId: row.feed.id,
    feedSiteUrl: row.feed.site_url || "",
    feedTitle: decodeHtmlEntities(row.feed.title),
    id: row.id,
    isRead: Boolean(row.is_read),
    isSaved: Boolean(row.is_saved),
    previewText: stripHtml(row.summary_html || bodyHtml).slice(0, 220),
    publishedAt: row.published_at,
    readTimeMinutes: row.read_time_minutes || estimateReadTime(bodyHtml),
    summaryHtml: sanitizeFragment(row.summary_html || ""),
    thumbnailUrl: row.thumbnail_url || "",
    title: decodeHtmlEntities(row.title),
    url: row.url
  };
};

const assertResult = (result, fallbackMessage) => {
  if (result.error) {
    throw new Error(result.error.message || fallbackMessage);
  }

  return result.data;
};

const normalizeScope = (scope) => {
  if (scope === "today" || scope === "saved") {
    return scope;
  }

  return "all";
};

const normalizeLimit = (value) => {
  const parsed = Number.parseInt(String(value || DEFAULT_PAGE_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PAGE_LIMIT;
  }

  return Math.min(parsed, MAX_PAGE_LIMIT);
};

const normalizeCursor = ({ beforeId = "", beforePublishedAt = "" } = {}) => ({
  beforeId: beforeId || null,
  beforePublishedAt: beforePublishedAt || null
});

const buildNextCursor = (article) =>
  article
    ? {
        beforeId: article.id,
        beforePublishedAt: article.publishedAt
      }
    : null;

const buildPageResult = (rows, limit) => {
  const summaries = rows.map(mapSummary);
  const hasMore = summaries.length > limit;
  const articles = hasMore ? summaries.slice(0, limit) : summaries;

  return {
    articles,
    hasMore,
    nextCursor: hasMore ? buildNextCursor(articles.at(-1)) : null
  };
};

const emptyCounts = () => ({
  all: 0,
  folders: {},
  saved: 0,
  today: 0
});

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const createReaderService = ({ url, serviceRoleKey }) => {
  const supabase = createSupabase({ url, serviceRoleKey });

  const getCounts = async (timezoneOffsetMinutes) => {
    const [countResult, feedFoldersResult] = await Promise.all([
      supabase.rpc("reader_sidebar_counts", {
        p_tz_offset_minutes: timezoneOffsetMinutes
      }),
      supabase
        .from("feeds")
        .select("folder")
        .order("folder", { ascending: true })
    ]);

    const data = assertResult(countResult, "Could not fetch article counts");
    const feedFolders = assertResult(feedFoldersResult, "Could not fetch feed folders");
    const folders = { ...(data?.folders || {}) };

    for (const row of feedFolders || []) {
      if (!row.folder || row.folder in folders) {
        continue;
      }

      folders[row.folder] = 0;
    }

    return {
      ...emptyCounts(),
      ...(data || {}),
      folders
    };
  };

  const getArticlePage = async ({
    beforeId = "",
    beforePublishedAt = "",
    folder = "",
    limit = DEFAULT_PAGE_LIMIT,
    scope = "all",
    timezoneOffsetMinutes = 0
  }) => {
    const normalizedLimit = normalizeLimit(limit);
    const cursor = normalizeCursor({ beforeId, beforePublishedAt });
    const result = await supabase.rpc("reader_article_page", {
      p_before_id: cursor.beforeId,
      p_before_published_at: cursor.beforePublishedAt,
      p_folder: folder,
      p_limit: normalizedLimit + 1,
      p_scope: normalizeScope(scope),
      p_tz_offset_minutes: timezoneOffsetMinutes
    });

    const rows = assertResult(result, "Could not fetch article list");
    return buildPageResult(rows || [], normalizedLimit);
  };

  return {
    async bootstrap({
      folder = "",
      limit = DEFAULT_PAGE_LIMIT,
      scope = "all",
      selectedArticleId = "",
      timezoneOffsetMinutes = 0
    }) {
      const [counts, page] = await Promise.all([
        getCounts(timezoneOffsetMinutes),
        getArticlePage({ folder, limit, scope, timezoneOffsetMinutes })
      ]);

      const selectedId = page.articles.some((article) => article.id === selectedArticleId)
        ? selectedArticleId
        : (page.articles[0]?.id || "");

      return {
        articles: page.articles,
        counts,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        selectedArticleId: selectedId
      };
    },

    async listArticles({
      beforeId = "",
      beforePublishedAt = "",
      folder = "",
      limit = DEFAULT_PAGE_LIMIT,
      scope = "all",
      timezoneOffsetMinutes = 0
    }) {
      return getArticlePage({
        beforeId,
        beforePublishedAt,
        folder,
        limit,
        scope,
        timezoneOffsetMinutes
      });
    },

    async getArticle(articleId) {
      const result = await supabase
        .from("articles")
        .select(articleSelect)
        .eq("id", articleId)
        .single();

      return mapArticle(assertResult(result, "Could not fetch article"));
    },

    async updateArticle(articleId, { isRead, isSaved }) {
      const update = {};

      if (typeof isRead === "boolean") {
        update.is_read = isRead;
        update.read_at = isRead ? new Date().toISOString() : null;
      }

      if (typeof isSaved === "boolean") {
        update.is_saved = isSaved;
      }

      const result = await supabase
        .from("articles")
        .update(update)
        .eq("id", articleId)
        .select(articleSelect)
        .single();

      return mapArticle(assertResult(result, "Could not update article"));
    },

    async markAllRead({ folder = "", scope = "all", timezoneOffsetMinutes = 0 }) {
      const result = await supabase.rpc("reader_mark_all_read", {
        p_folder: folder,
        p_scope: normalizeScope(scope),
        p_tz_offset_minutes: timezoneOffsetMinutes
      });

      return {
        updated: Number(assertResult(result, "Could not mark articles as read") || 0)
      };
    },

    async addFeed({ folder, inputUrl }) {
      const resolved = await resolveFeedInput(inputUrl);
      const payload = {
        feed_url: resolved.feedUrl,
        folder: folder.trim() || "Uncategorized",
        icon_url: resolved.faviconUrl || null,
        site_url: resolved.siteUrl || null,
        title: decodeHtmlEntities(resolved.title || "Untitled feed")
      };

      const result = await supabase
        .from("feeds")
        .insert(payload)
        .select("*")
        .single();

      return assertResult(result, "Could not create feed");
    },

    async deleteFeed(feedId) {
      const result = await supabase
        .from("feeds")
        .delete()
        .eq("id", feedId);

      assertResult(result, "Could not delete feed");
    },

    async updateFeedSyncError(feedId, message) {
      const result = await supabase
        .from("feeds")
        .update({
          last_sync_error: message,
          last_synced_at: null
        })
        .eq("id", feedId);

      assertResult(result, "Could not update feed sync status");
    },

    async addFeedAndSync({ folder, inputUrl }) {
      const feed = await this.addFeed({ folder, inputUrl });

      try {
        const sync = await this.triggerSync(feed.id);
        return { feed, sync, syncError: null };
      } catch (error) {
        try {
          await this.updateFeedSyncError(
            feed.id,
            error instanceof Error ? error.message : String(error)
          );
        } catch {
          // Preserve the original sync failure.
        }

        return {
          feed,
          sync: null,
          syncError: error instanceof Error ? error.message : String(error)
        };
      }
    },

    async triggerSync(feedId, options = {}) {
      const retries = Number.isFinite(options.retries) ? options.retries : 3;
      let lastError = null;

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const result = await supabase.functions.invoke("sync-feeds", {
          body: { feedId }
        });

        if (result.error) {
          lastError = new Error(result.error.message || "Could not trigger feed sync");
        } else {
          const payload = result.data || {};
          const matchingResult = Array.isArray(payload.results)
            ? payload.results.find((entry) => entry.feedId === feedId) || payload.results[0]
            : null;

          if ((payload.processed || 0) < 1 || !matchingResult) {
            lastError = new Error("Initial feed sync did not start. Please try again.");
          } else if (matchingResult.ok === false) {
            lastError = new Error(matchingResult.error || "Initial feed sync failed.");
          } else {
            return payload;
          }
        }

        if (attempt < retries) {
          await sleep(400 * (attempt + 1));
        }
      }

      throw lastError || new Error("Could not trigger feed sync");
    }
  };
};
