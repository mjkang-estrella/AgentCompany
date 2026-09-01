import { parse } from "node-html-parser";

import {
  canonicalizeUrl,
  estimateReadTime,
  sanitizeFragment,
  stripHtml
} from "./html.mjs";

const X_HOSTNAMES = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "m.twitter.com"
]);
const TCO_HOSTNAMES = new Set(["t.co", "www.t.co"]);
const LONG_FORM_MIN_READABLE_CHARS = 600;

const OEMBED_URL = "https://publish.twitter.com/oembed";

export const isXStatusUrl = (value) => {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(String(value));
    if (!X_HOSTNAMES.has(url.hostname.toLowerCase())) {
      return false;
    }

    return /\/(?:i\/web\/)?status\/\d+/iu.test(url.pathname) ||
      /\/[^/]+\/status\/\d+/iu.test(url.pathname);
  } catch {
    return false;
  }
};

export const isPotentialXContentUrl = (value) => {
  if (isXStatusUrl(value)) {
    return true;
  }

  try {
    return TCO_HOSTNAMES.has(new URL(String(value)).hostname.toLowerCase());
  } catch {
    return false;
  }
};

const isUrlShapedTitle = (value) => {
  const title = String(value || "").trim();
  if (!title) {
    return false;
  }

  try {
    const url = new URL(title);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return /^www\./iu.test(title);
  }
};

const titleCandidateFromSummary = (summaryHtml, bodyHtml) => {
  const summary = stripHtml(summaryHtml).replace(/\s+/gu, " ").trim();
  const body = stripHtml(bodyHtml).replace(/\s+/gu, " ").trim();
  const wordCount = summary.split(/\s+/u).filter(Boolean).length;

  if (
    summary.length < 8 ||
    summary.length > 120 ||
    wordCount > 18 ||
    isUrlShapedTitle(summary) ||
    body.toLowerCase().startsWith(summary.toLowerCase())
  ) {
    return "";
  }

  return summary.replace(/[.!?]+$/u, "");
};

export const recoverXArticleTitle = ({
  bodyHtml = "",
  summaryHtml = "",
  title = ""
} = {}) => {
  const currentTitle = String(title || "").replace(/\s+/gu, " ").trim();
  if (currentTitle && !isUrlShapedTitle(currentTitle) && !/^x(?:\.com)?$/iu.test(currentTitle)) {
    return currentTitle;
  }

  return titleCandidateFromSummary(summaryHtml, bodyHtml) || currentTitle || "X post";
};

export const recoverXArticleAuthor = ({ author = "", canonicalUrl = "" } = {}) => {
  const currentAuthor = String(author || "").replace(/\s+/gu, " ").trim();
  if (currentAuthor && !/^x(?: \(formerly twitter\))?$/iu.test(currentAuthor)) {
    return currentAuthor;
  }

  try {
    const url = new URL(String(canonicalUrl || ""));
    const [handle] = url.pathname.split("/").filter(Boolean);
    if (handle && !["i", "web", "status"].includes(handle.toLowerCase())) {
      return `@${handle}`;
    }
  } catch {
    // Keep the source attribution when the canonical URL is unavailable.
  }

  return currentAuthor || "X";
};

export const isLikelyLongFormXArticle = ({ bodyHtml = "", readTimeMinutes = 0 } = {}) => {
  const readableLength = stripHtml(bodyHtml).length;
  const headingCount = (String(bodyHtml).match(/<h[1-4]\b/giu) || []).length;
  return readableLength >= LONG_FORM_MIN_READABLE_CHARS && (headingCount > 0 || readTimeMinutes >= 3);
};

const parsePublishedAt = (value) => {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.valueOf()) ? Date.now() : parsed.valueOf();
};

const buildPreview = (bodyHtml) => stripHtml(bodyHtml).slice(0, 220);

const titleFromBody = (author, bodyHtml) => {
  const text = stripHtml(bodyHtml);
  if (!text) {
    return `${author} on X`;
  }

  const line = text.slice(0, 80).trim();
  return line.length < text.length ? `${line}…` : line;
};

export const extractXPostFromOEmbedPayload = (payload, sourceUrl) => {
  const root = parse(payload.html || "");
  const blockquote = root.querySelector("blockquote");
  const paragraphs = Array.from(blockquote?.querySelectorAll("p") || []);
  const bodyHtml = paragraphs.length > 0
    ? sanitizeFragment(paragraphs.map((paragraph) => `<p>${paragraph.innerHTML}</p>`).join(""))
    : sanitizeFragment(blockquote?.innerHTML || "");

  if (!stripHtml(bodyHtml)) {
    throw new Error("Could not extract readable content from that X post");
  }

  const footerLinks = Array.from(blockquote?.querySelectorAll("a") || []);
  const publishedAtText = footerLinks.at(-1)?.textContent?.trim() || "";
  const canonicalUrl = canonicalizeUrl(payload.url || sourceUrl);
  const author = payload.author_name || "X";

  return {
    author,
    bodyHtml,
    bodySource: "fetched",
    canonicalUrl,
    previewText: buildPreview(bodyHtml),
    publishedAt: parsePublishedAt(publishedAtText),
    quality: "usable",
    readTimeMinutes: Math.max(estimateReadTime(bodyHtml), 1),
    siteName: "X",
    summaryHtml: bodyHtml,
    thumbnailUrl: "",
    title: titleFromBody(author, bodyHtml)
  };
};

export const extractXPostFromUrl = async (url) => {
  const endpoint = `${OEMBED_URL}?omit_script=1&url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "user-agent": "AgentCompany Reader/1.0 (+https://agent.company)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`X oEmbed request failed (${response.status})`);
  }

  const payload = await response.json();
  return extractXPostFromOEmbedPayload(payload, url);
};
