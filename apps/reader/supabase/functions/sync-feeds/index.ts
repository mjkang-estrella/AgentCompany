import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { XMLParser } from "npm:fast-xml-parser@5.5.3";
import he from "npm:he@1.2.0";
import { marked } from "npm:marked@16.4.1";
import { parse as parseHtml } from "npm:node-html-parser@7.1.0";
import sanitizeHtml from "npm:sanitize-html@2.17.1";

const parser = new XMLParser({
  attributeNamePrefix: "",
  cdataPropName: "cdata",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  stopNodes: ["*.description", "*.summary", "*.content", "*.content:encoded"],
  textNodeName: "text",
  trimValues: true,
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
);

const defaultHeaders = {
  "user-agent": "AgentCompany Reader Sync/1.0 (+https://agent.company)",
};

const decodeHtmlFragment = (value: unknown) => {
  if (value == null || value === "") {
    return "";
  }

  return he.decode(String(value));
};

const sanitizeFragment = (html: string) =>
  sanitizeHtml(decodeHtmlFragment(html || ""), {
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title"],
      td: ["colspan", "rowspan", "align"],
      th: ["colspan", "rowspan", "align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedTags: [
      "a",
      "b",
      "blockquote",
      "br",
      "code",
      "em",
      "figcaption",
      "figure",
      "h1",
      "h2",
      "h3",
      "h4",
      "hr",
      "img",
      "li",
      "ol",
      "p",
      "pre",
      "sub",
      "sup",
      "strong",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "ul",
    ],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  });

const decodeHtmlEntities = (value: unknown) => {
  if (value == null || value === "") {
    return "";
  }

  return parseHtml(`<span>${String(value)}</span>`).textContent.trim();
};

const renderMarkdownFragment = (markdown: string) => {
  if (!markdown) {
    return "";
  }

  return sanitizeFragment(marked.parse(markdown, {
    async: false,
    breaks: false,
    gfm: true,
  }));
};

const stripHtml = (html: string) =>
  sanitizeHtml(decodeHtmlFragment(html || ""), {
    allowedAttributes: {},
    allowedTags: [],
  }).replace(/\s+/gu, " ").trim();

const estimateReadTime = (html: string) => {
  const words = stripHtml(html).split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
};

const toArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const getText = (value: unknown): string => {
  if (value == null) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return decodeHtmlEntities(String(value).trim());
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = getText(item);
      if (text) {
        return text;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return decodeHtmlEntities(record.text.trim());
    }

    if (typeof record.cdata === "string") {
      return decodeHtmlEntities(record.cdata.trim());
    }

    for (const nested of Object.values(record)) {
      const text = getText(nested);
      if (text) {
        return text;
      }
    }
  }

  return "";
};

const getHtml = (value: unknown): string => {
  if (!value) {
    return "";
  }

  const stripCdata = (html: string) =>
    html.replace(/^<!\[CDATA\[/u, "").replace(/\]\]>$/u, "").trim();

  if (typeof value === "string") {
    return decodeHtmlFragment(stripCdata(value));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return decodeHtmlFragment(stripCdata(String(record.cdata || record.text || "")));
  }

  return "";
};

const findFirstImageUrl = (html: string, baseUrl: string) => {
  if (!html) {
    return "";
  }

  const match = decodeHtmlFragment(String(html)).match(/<img\b[^>]*\bsrc=["']([^"']+)["']/iu);
  return resolveUrl(match?.[1] || "", baseUrl);
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

const getExtensionUrl = (
  entry: Record<string, unknown>,
  suffixes: string[],
  baseUrl: string,
) => {
  for (const [key, value] of Object.entries(entry || {})) {
    const normalizedKey = key.toLowerCase();
    if (!suffixes.some((suffix) => normalizedKey === suffix || normalizedKey.endsWith(`:${suffix}`))) {
      continue;
    }

    const resolved = resolveUrl(getText(value), baseUrl);
    if (resolved) {
      return resolved;
    }
  }

  return "";
};

const getImageUrl = (value: unknown, baseUrl: string) => {
  for (const item of toArray(value as Record<string, unknown>)) {
    if (!item) {
      continue;
    }

    if (typeof item === "string") {
      const resolved = resolveUrl(item, baseUrl);
      if (resolved) {
        return resolved;
      }
      continue;
    }

    if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      const medium = String(record.medium || "").toLowerCase();
      const type = String(record.type || "").toLowerCase();
      const url = resolveUrl(String(record.url || record.href || record.src || ""), baseUrl);

      if (url && (medium === "image" || type.startsWith("image/") || (!medium && !type))) {
        return url;
      }
    }
  }

  return "";
};

const pickAtomLink = (value: unknown, baseUrl: string) => {
  const links = toArray(value as Record<string, unknown>);
  const preferred = links.find((link) => !link.rel || link.rel === "alternate") ||
    links[0];

  if (!preferred) {
    return "";
  }

  return resolveUrl(String(preferred.href || getText(preferred)), baseUrl);
};

const normalizeEntry = (
  entry: Record<string, unknown>,
  format: "rss" | "atom",
  baseUrl: string,
) => {
  const summaryHtml = format === "atom"
    ? getHtml(entry.summary)
    : getHtml(entry.description);
  const feedBody = format === "atom"
    ? getHtml(entry.content) || summaryHtml
    : getHtml(entry["content:encoded"]) || summaryHtml;
  const url = format === "atom"
    ? pickAtomLink(entry.link, baseUrl)
    : resolveUrl(getText(entry.link), baseUrl);
  const externalId =
    getText(format === "atom" ? entry.id : entry.guid) ||
    url ||
    `${getText(entry.title)}:${getText(entry.pubDate || entry.published || entry.updated)}`;

  return {
    author: getText(entry.author || entry["dc:creator"] || (entry.author as Record<string, unknown>)?.name),
    bodyHtml: feedBody,
    externalId,
    markdownUrl: getExtensionUrl(entry, ["markdown"], baseUrl),
    publishedAt: getText(entry.pubDate || entry.published || entry.updated),
    summaryHtml,
    thumbnailUrl:
      getImageUrl(entry["media:content"], baseUrl) ||
      getImageUrl(entry["media:thumbnail"], baseUrl) ||
      getImageUrl(entry.enclosure, baseUrl) ||
      findFirstImageUrl(feedBody || summaryHtml, baseUrl),
    title: getText(entry.title) || url || "Untitled article",
    url,
  };
};

const parseFeed = (xml: string, sourceUrl: string) => {
  const parsed = parser.parse(xml);

  if (parsed?.rss?.channel) {
    const channel = parsed.rss.channel as Record<string, unknown>;
    return {
      entries: toArray(channel.item as Record<string, unknown>[]).map((entry) =>
        normalizeEntry(entry, "rss", sourceUrl)
      ),
      siteUrl: resolveUrl(getText(channel.link), sourceUrl),
      title: getText(channel.title) || "Untitled feed",
    };
  }

  if (parsed?.feed) {
    const feed = parsed.feed as Record<string, unknown>;
    return {
      entries: toArray(feed.entry as Record<string, unknown>[]).map((entry) =>
        normalizeEntry(entry, "atom", sourceUrl)
      ),
      siteUrl: pickAtomLink(feed.link, sourceUrl),
      title: getText(feed.title) || "Untitled feed",
    };
  }

  throw new Error("Feed response was not valid RSS or Atom");
};

const extractReadableContent = (html: string) => {
  const root = parseHtml(html);
  for (const selector of ["script", "style", "noscript", "template", "iframe"]) {
    root.querySelectorAll(selector).forEach((node) => node.remove());
  }

  const selectors = [
    "article",
    "main",
    "[role='main']",
    ".post-content",
    ".entry-content",
    ".article-content",
    ".story-body",
    ".content",
    ".post",
    ".article",
  ];

  const candidates = [
    ...selectors.map((selector) => root.querySelector(selector)).filter(Boolean),
    ...root.querySelectorAll("article, main, section, div"),
  ];

  if (candidates.length === 0) {
    return "";
  }

  candidates.sort((left, right) => {
    const leftScore = left.textContent.trim().length + left.querySelectorAll("p").length * 200;
    const rightScore = right.textContent.trim().length + right.querySelectorAll("p").length * 200;
    return rightScore - leftScore;
  });

  return sanitizeFragment(candidates[0].innerHTML || "");
};

const fetchText = async (url: string) => {
  const response = await fetch(url, {
    headers: defaultHeaders,
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} (${response.status})`);
  }

  return {
    text: await response.text(),
    url: response.url,
  };
};

const normalizePublishedAt = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
};

const maybeFetchArticleBody = async (
  url: string,
  existingHtml: string,
  markdownUrl = "",
) => {
  if (stripHtml(existingHtml).length >= 400 || (!url && !markdownUrl)) {
    return {
      bodyHtml: sanitizeFragment(existingHtml),
      bodySource: "feed" as const,
    };
  }

  if (markdownUrl) {
    try {
      const markdown = await fetchText(markdownUrl);
      const rendered = renderMarkdownFragment(markdown.text);
      if (stripHtml(rendered).length > stripHtml(existingHtml).length) {
        return {
          bodyHtml: rendered,
          bodySource: "fetched" as const,
        };
      }
    } catch {
      // Fall back to HTML extraction.
    }
  }

  try {
    const page = await fetchText(url);
    const extracted = extractReadableContent(page.text);
    if (stripHtml(extracted).length > stripHtml(existingHtml).length) {
      return {
        bodyHtml: extracted,
        bodySource: "fetched" as const,
      };
    }
  } catch {
    // Fall back to feed-provided content.
  }

  return {
    bodyHtml: sanitizeFragment(existingHtml),
    bodySource: "feed" as const,
  };
};

const syncFeed = async (feed: Record<string, string>) => {
  try {
    const response = await fetchText(feed.feed_url);
    const parsed = parseFeed(response.text, response.url);
    const faviconUrl = parsed.siteUrl
      ? new URL("/favicon.ico", parsed.siteUrl).toString()
      : feed.icon_url || null;

    const payload = [];
    for (const entry of parsed.entries.slice(0, 50)) {
      const fetchedBody = await maybeFetchArticleBody(
        entry.url,
        entry.bodyHtml || entry.summaryHtml,
        entry.markdownUrl,
      );
      const bodyHtml = fetchedBody.bodyHtml || sanitizeFragment(entry.summaryHtml);
      const summaryHtml = sanitizeFragment(entry.summaryHtml || bodyHtml);

      payload.push({
        author: entry.author || null,
        body_html: bodyHtml,
        body_source: fetchedBody.bodySource,
        external_id: entry.externalId,
        feed_id: feed.id,
        published_at: normalizePublishedAt(entry.publishedAt),
        read_time_minutes: estimateReadTime(bodyHtml),
        summary_html: summaryHtml,
        thumbnail_url: entry.thumbnailUrl || findFirstImageUrl(bodyHtml || summaryHtml, entry.url || parsed.siteUrl || response.url) || null,
        title: entry.title,
        url: entry.url,
      });
    }

    if (payload.length > 0) {
      const upsert = await supabase.from("articles").upsert(payload, {
        onConflict: "feed_id,external_id",
      });

      if (upsert.error) {
        throw upsert.error;
      }
    }

    const update = await supabase
      .from("feeds")
      .update({
        icon_url: faviconUrl,
        last_sync_error: null,
        last_synced_at: new Date().toISOString(),
        site_url: parsed.siteUrl || feed.site_url,
        title: parsed.title || feed.title,
      })
      .eq("id", feed.id);

    if (update.error) {
      throw update.error;
    }

    return { feedId: feed.id, ok: true, syncedArticles: payload.length };
  } catch (error) {
    await supabase
      .from("feeds")
      .update({
        last_sync_error: error instanceof Error ? error.message : String(error),
      })
      .eq("id", feed.id);

    return {
      feedId: feed.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const query = supabase.from("feeds").select("*").eq("is_active", true);

    if (body.feedId) {
      query.eq("id", body.feedId);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const feeds = data || [];
    const results = [];
    for (const feed of feeds) {
      results.push(await syncFeed(feed as Record<string, string>));
    }

    return Response.json({ processed: results.length, results });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
