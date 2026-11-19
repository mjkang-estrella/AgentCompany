import { marked } from "marked";
import he from "he";
import sanitizeHtml from "sanitize-html";
import { parse } from "node-html-parser";
import {
  articleImageKey,
  articleImageSources,
  articleImageSourceUrl,
  articleImageUrl,
  firstArticleImage
} from "./article-thumbnail.mjs";

const SANITIZE_OPTIONS = {
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
    "ul"
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title"],
    td: ["colspan", "rowspan", "align"],
    th: ["colspan", "rowspan", "align"]
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer",
      target: "_blank"
    })
  }
};

export const decodeHtmlFragment = (value) => {
  if (value == null || value === "") {
    return "";
  }

  return he.decode(String(value));
};

export const sanitizeFragment = (html) => {
  if (!html) {
    return "";
  }

  return sanitizeHtml(decodeHtmlFragment(html), SANITIZE_OPTIONS);
};

export const renderMarkdownFragment = (markdown) => {
  if (!markdown) {
    return "";
  }

  return sanitizeFragment(marked.parse(String(markdown), {
    async: false,
    breaks: false,
    gfm: true
  }));
};

export const decodeHtmlEntities = (value) => {
  if (value == null || value === "") {
    return "";
  }

  return parse(`<span>${String(value)}</span>`).textContent.trim();
};

export const stripHtml = (html) => {
  if (!html) {
    return "";
  }

  return decodeHtmlEntities(sanitizeHtml(decodeHtmlFragment(html), {
    allowedTags: [],
    allowedAttributes: {}
  }).replace(/\s+/gu, " ").trim());
};

export const estimateReadTime = (html) => {
  const words = stripHtml(html).split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
};

export const canonicalizeUrl = (value) => {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(String(value));
    url.hash = "";

    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/u, "");
    }

    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(value).trim();
  }
};

const PREFERRED_CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".post-content",
  ".entry-content",
  ".article-content",
  ".story-body",
  ".content",
  ".post",
  ".article"
];

const FALLBACK_CONTENT_SELECTORS = "article, main, section, div, td, font, center";

const scoreNode = (node) => {
  const textLength = node.textContent.replace(/\s+/gu, " ").trim().length;
  const paragraphCount = node.querySelectorAll("p").length;
  const lineBreakCount = node.querySelectorAll("br").length;
  const imageCount = node.querySelectorAll("img").length;
  const linkTextLength = node
    .querySelectorAll("a")
    .reduce((total, link) => total + link.textContent.replace(/\s+/gu, " ").trim().length, 0);

  return (
    textLength +
    paragraphCount * 200 +
    lineBreakCount * 12 -
    imageCount * 40 -
    linkTextLength * 0.25
  );
};

export const discoverFeedLinks = (html, pageUrl) => {
  const root = parse(html);
  const links = root.querySelectorAll("link[rel]");
  const candidates = [];

  for (const link of links) {
    const rel = (link.getAttribute("rel") || "").toLowerCase();
    const type = (link.getAttribute("type") || "").toLowerCase();
    const href = link.getAttribute("href");

    if (!href || !rel.includes("alternate")) {
      continue;
    }

    if (
      type.includes("rss") ||
      type.includes("atom") ||
      type.includes("xml")
    ) {
      candidates.push({
        href: new URL(href, pageUrl).toString(),
        title: link.getAttribute("title") || ""
      });
    }
  }

  const favicon =
    root.querySelector("link[rel='icon']")?.getAttribute("href") ||
    root.querySelector("link[rel='shortcut icon']")?.getAttribute("href");

  return {
    feedLinks: candidates,
    title:
      root.querySelector("meta[property='og:site_name']")?.getAttribute("content") ||
      root.querySelector("title")?.textContent?.trim() ||
      "",
    faviconUrl: favicon ? new URL(favicon, pageUrl).toString() : ""
  };
};

const metaContent = (root, selector) => root.querySelector(selector)?.getAttribute("content")?.trim() || "";

const firstNonEmpty = (...values) => values.find((value) => value && value.trim()) || "";

const resolveMaybeUrl = (value, pageUrl) => {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return "";
  }
};

export const extractArticleImage = (html, pageUrl) =>
  firstArticleImage(parse(html || ""), pageUrl);

const collectRejectedImageKeys = (root, pageUrl) => {
  const rejected = new Set();
  for (const link of root.querySelectorAll("link[rel]")) {
    if (/\bicon\b/iu.test(link.getAttribute("rel") || "")) {
      rejected.add(articleImageKey(link.getAttribute("href"), pageUrl));
    }
  }
  for (const image of root.querySelectorAll("img")) {
    for (const source of articleImageSources(image)) {
      if (!articleImageSourceUrl(image, source, pageUrl)) {
        rejected.add(articleImageKey(source, pageUrl));
      }
    }
  }
  return rejected;
};

/**
 * @param {{ thumbnailUrl?: string, candidates?: string[], bodyHtml?: string,
 *   summaryHtml?: string, pageUrl: string, feedIconUrl?: string }} article
 */
export const selectArticleThumbnail = ({
  thumbnailUrl = "",
  candidates = [],
  bodyHtml = "",
  summaryHtml = "",
  pageUrl,
  feedIconUrl = ""
}) => {
  const body = parse(bodyHtml);
  const summary = parse(summaryHtml);
  const rejected = collectRejectedImageKeys(body, pageUrl);
  for (const key of collectRejectedImageKeys(summary, pageUrl)) rejected.add(key);
  if (feedIconUrl) rejected.add(articleImageKey(feedIconUrl, pageUrl));

  for (const candidate of [thumbnailUrl, ...candidates]) {
    const url = articleImageUrl(candidate, pageUrl);
    if (url && !rejected.has(articleImageKey(url))) return url;
  }
  return firstArticleImage(body, pageUrl, rejected) || firstArticleImage(summary, pageUrl, rejected);
};

const socialImages = (root, namespace) => {
  const images = [];
  for (const meta of root.querySelectorAll("meta")) {
    const key = meta.getAttribute("property") || meta.getAttribute("name") || "";
    const content = meta.getAttribute("content") || "";
    if (key === namespace || key === `${namespace}:url` || key === `${namespace}:src`) {
      images.push({ url: content });
    } else if (key.startsWith(`${namespace}:`) && images.length) {
      const image = images.at(-1);
      const attribute = key.slice(namespace.length + 1);
      if (["alt", "width", "height"].includes(attribute)) image[attribute] = content;
    }
  }
  return images;
};

const pageThumbnail = (root, pageUrl, bodyHtml = "") => {
  const rejected = collectRejectedImageKeys(root, pageUrl);
  const candidates = [...socialImages(root, "og:image"), ...socialImages(root, "twitter:image")];
  for (const candidate of candidates) {
    if (!articleImageUrl(candidate.url, pageUrl, candidate)) {
      rejected.add(articleImageKey(candidate.url, pageUrl));
    }
  }
  for (const candidate of candidates) {
    const url = articleImageUrl(candidate.url, pageUrl, candidate);
    if (url && !rejected.has(articleImageKey(url))) return url;
  }

  return firstArticleImage(root, pageUrl, rejected, "article img, main img, [role='main'] img") ||
    firstArticleImage(parse(bodyHtml), pageUrl, rejected);
};

export const extractPageThumbnail = (html, pageUrl, bodyHtml) =>
  pageThumbnail(parse(html), pageUrl, bodyHtml);

export const extractPageMetadata = (html, pageUrl, { includeThumbnail = true } = {}) => {
  const root = parse(html);
  const title = firstNonEmpty(
    metaContent(root, "meta[property='og:title']"),
    metaContent(root, "meta[name='twitter:title']"),
    root.querySelector("h1")?.textContent?.trim() || "",
    root.querySelector("title")?.textContent?.trim() || ""
  );

  const siteName = firstNonEmpty(
    metaContent(root, "meta[property='og:site_name']"),
    metaContent(root, "meta[name='application-name']"),
    root.querySelector("title")?.textContent?.trim() || ""
  );

  const author = firstNonEmpty(
    metaContent(root, "meta[name='author']"),
    metaContent(root, "meta[property='article:author']"),
    root.querySelector("[rel='author']")?.textContent?.trim() || ""
  );

  const publishedAt = firstNonEmpty(
    metaContent(root, "meta[property='article:published_time']"),
    metaContent(root, "meta[name='pubdate']"),
    metaContent(root, "meta[name='publish_date']"),
    root.querySelector("time[datetime]")?.getAttribute("datetime")?.trim() || ""
  );

  return {
    author,
    canonicalUrl: firstNonEmpty(
      resolveMaybeUrl(root.querySelector("link[rel='canonical']")?.getAttribute("href") || "", pageUrl),
      resolveMaybeUrl(metaContent(root, "meta[property='og:url']"), pageUrl),
      canonicalizeUrl(pageUrl)
    ),
    description: firstNonEmpty(
      metaContent(root, "meta[name='description']"),
      metaContent(root, "meta[property='og:description']"),
      metaContent(root, "meta[name='twitter:description']")
    ),
    publishedAt,
    siteName,
    thumbnailUrl: includeThumbnail ? pageThumbnail(root, pageUrl) : "",
    title
  };
};

export const extractReadableContent = (html) => {
  const root = parse(html);
  for (const selector of ["script", "style", "noscript", "template", "iframe"]) {
    root.querySelectorAll(selector).forEach((node) => node.remove());
  }

  const preferred = PREFERRED_CONTENT_SELECTORS
    .map((selector) => root.querySelector(selector))
    .filter(Boolean);

  const fallback = root.querySelectorAll(FALLBACK_CONTENT_SELECTORS);
  const candidates = [...preferred, ...fallback].filter(Boolean);

  if (candidates.length === 0) {
    return "";
  }

  const bestNode = candidates.sort((left, right) => scoreNode(right) - scoreNode(left))[0];
  return sanitizeFragment(bestNode.innerHTML || "");
};
