import { createClient } from "@supabase/supabase-js";

import { decodeHtmlEntities, estimateReadTime, sanitizeFragment, stripHtml } from "./html.mjs";
import { resolveFeedInput } from "./feed-discovery.mjs";
import { isToday } from "./time.mjs";

const summarySelect = `
  id,
  feed_id,
  title,
  url,
  author,
  published_at,
  summary_html,
  read_time_minutes,
  is_read,
  is_saved,
  feed:feeds!inner(id, title, folder, site_url, icon_url)
`;

const articleSelect = `
  id,
  feed_id,
  title,
  url,
  author,
  published_at,
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
  feedFolder: row.feed.folder,
  feedIconUrl: row.feed.icon_url || "",
  feedId: row.feed.id,
  feedTitle: decodeHtmlEntities(row.feed.title),
  id: row.id,
  isRead: Boolean(row.is_read),
  isSaved: Boolean(row.is_saved),
  previewText: stripHtml(row.summary_html).slice(0, 220),
  publishedAt: row.published_at,
  readTimeMinutes: row.read_time_minutes || 1,
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

const filterSummaries = (rows, { folder, scope, timezoneOffsetMinutes, now = new Date() }) => {
  return rows.filter((row) => {
    if (folder && row.feedFolder !== folder) {
      return false;
    }

    if (scope === "saved" && !row.isSaved) {
      return false;
    }

    if (scope === "today" && !isToday(row.publishedAt, timezoneOffsetMinutes, now)) {
      return false;
    }

    return true;
  });
};

const buildCounts = (rows, timezoneOffsetMinutes, now = new Date()) => {
  const folders = {};

  for (const row of rows) {
    folders[row.feedFolder] = (folders[row.feedFolder] || 0) + 1;
  }

  return {
    all: rows.length,
    saved: rows.filter((row) => row.isSaved).length,
    today: rows.filter((row) => isToday(row.publishedAt, timezoneOffsetMinutes, now)).length,
    folders
  };
};

export const createReaderService = ({ url, serviceRoleKey }) => {
  const supabase = createSupabase({ url, serviceRoleKey });

  const fetchSummaries = async () => {
    const result = await supabase
      .from("articles")
      .select(summarySelect)
      .order("published_at", { ascending: false });

    return assertResult(result, "Could not fetch article list").map(mapSummary);
  };

  return {
    async bootstrap({ folder = "", scope = "all", selectedArticleId = "", timezoneOffsetMinutes = 0 }) {
      const normalizedScope = normalizeScope(scope);
      const summaries = await fetchSummaries();
      const counts = buildCounts(summaries, timezoneOffsetMinutes);
      const articles = filterSummaries(summaries, {
        folder,
        scope: normalizedScope,
        timezoneOffsetMinutes
      });
      const selectedId = articles.some((article) => article.id === selectedArticleId)
        ? selectedArticleId
        : (articles[0]?.id || "");
      const selectedArticle = selectedId ? await this.getArticle(selectedId) : null;

      return {
        articles,
        counts,
        selectedArticle,
        selectedArticleId: selectedId
      };
    },

    async listArticles({ folder = "", scope = "all", timezoneOffsetMinutes = 0 }) {
      const summaries = await fetchSummaries();
      return filterSummaries(summaries, {
        folder,
        scope: normalizeScope(scope),
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
      const rows = await this.listArticles({ folder, scope, timezoneOffsetMinutes });
      const unreadIds = rows.filter((row) => !row.isRead).map((row) => row.id);

      if (unreadIds.length === 0) {
        return { updated: 0 };
      }

      const result = await supabase
        .from("articles")
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .in("id", unreadIds);

      assertResult(result, "Could not mark articles as read");
      return { updated: unreadIds.length };
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

    async triggerSync(feedId) {
      const result = await supabase.functions.invoke("sync-feeds", {
        body: { feedId }
      });

      if (result.error) {
        throw new Error(result.error.message || "Could not trigger feed sync");
      }

      return result.data || { ok: true };
    }
  };
};
