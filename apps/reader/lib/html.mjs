import { marked } from "marked";
import he from "he";
import sanitizeHtml from "sanitize-html";
import { parse } from "node-html-parser";

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
