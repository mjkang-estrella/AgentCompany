import { XMLParser } from "fast-xml-parser";
import { decodeHtmlEntities, decodeHtmlFragment } from "./html.mjs";

const parser = new XMLParser({
  attributeNamePrefix: "",
  cdataPropName: "cdata",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  textNodeName: "text",
  trimValues: true,
  stopNodes: ["*.description", "*.summary", "*.content", "*.content:encoded"]
});

const toArray = (value) => {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const getText = (value) => {
  if (value == null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
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
    if (typeof value.text === "string") {
      return decodeHtmlEntities(value.text.trim());
    }

    if (typeof value.cdata === "string") {
      return decodeHtmlEntities(value.cdata.trim());
    }

    for (const nestedValue of Object.values(value)) {
      const text = getText(nestedValue);
      if (text) {
        return text;
      }
    }
  }

  return "";
};

const getHtml = (value) => {
  if (!value) {
    return "";
  }

  const stripCdata = (html) =>
    html.replace(/^<!\[CDATA\[/u, "").replace(/\]\]>$/u, "").trim();

  if (typeof value === "string") {
    return decodeHtmlFragment(stripCdata(value));
  }

  if (typeof value === "object") {
    return decodeHtmlFragment(stripCdata(String(value.cdata || value.text || "")));
  }

  return "";
};

const resolveUrl = (value, baseUrl) => {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
};

const getExtensionUrl = (entry, suffixes, baseUrl) => {
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

const pickAtomLink = (value, baseUrl) => {
  const links = toArray(value);
  const preferred =
    links.find((link) => !link.rel || link.rel === "alternate") ||
    links[0];

  if (!preferred) {
    return "";
  }

  return resolveUrl(preferred.href || getText(preferred), baseUrl);
};

const normalizeEntry = (entry, format, baseUrl) => {
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
    author:
      getText(entry.author?.name || entry.author || entry["dc:creator"]) || "",
    bodyHtml: feedBody,
    externalId,
    markdownUrl: getExtensionUrl(entry, ["markdown"], baseUrl),
    publishedAt:
      getText(entry.pubDate || entry.published || entry.updated) ||
      new Date().toISOString(),
    summaryHtml,
    title: getText(entry.title) || url || "Untitled article",
    url
  };
};

export const parseFeed = (xml, sourceUrl) => {
  const parsed = parser.parse(xml);

  if (parsed?.rss?.channel) {
    const channel = parsed.rss.channel;
    return {
      format: "rss",
      feed: {
        title: getText(channel.title) || "Untitled feed",
        siteUrl: resolveUrl(getText(channel.link), sourceUrl),
        entries: toArray(channel.item).map((entry) => normalizeEntry(entry, "rss", sourceUrl))
      }
    };
  }

  if (parsed?.feed) {
    const feed = parsed.feed;
    return {
      format: "atom",
      feed: {
        title: getText(feed.title) || "Untitled feed",
        siteUrl: pickAtomLink(feed.link, sourceUrl),
        entries: toArray(feed.entry).map((entry) => normalizeEntry(entry, "atom", sourceUrl))
      }
    };
  }

  throw new Error("URL did not return a valid RSS or Atom feed");
};
