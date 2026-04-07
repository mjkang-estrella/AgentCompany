import { parse } from "node-html-parser";

import {
  canonicalizeUrl,
  estimateReadTime,
  extractReadableContent,
  sanitizeFragment,
  stripHtml
} from "./html.mjs";
import { normalizeArticleContent } from "./article-body-normalizer.mjs";

export const NEWSLETTER_FEED_GROUP = "Newsletters";
export const NEWSLETTER_LABEL_INGESTED = "reader-ingested";
export const NEWSLETTER_LABEL_PARSED_V2 = "reader-parsed-v6";
export const NEWSLETTER_LABEL_UNREAD = "unread";

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"')]+/giu;
const NEWSLETTER_LINK_HINT = /\b(view|read|open).{0,20}\b(browser|web|online)\b/iu;
const IGNORABLE_LINK_HINT = /\b(unsubscribe|manage|preferences|settings|privacy|forward|share)\b/iu;
const LEAD_ANCHOR_MARKERS = [
  "biggest takeaways",
  "key takeaways",
  "top threads"
];

const trimToNull = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const pickFirstString = (...values) => {
  for (const value of values) {
    const normalized = trimToNull(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);

const getMessageHeader = (headers, targetName) => {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return null;
  }

  const target = targetName.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== target) {
      continue;
    }

    if (Array.isArray(value)) {
      return pickFirstString(...value);
    }

    return trimToNull(String(value));
  }

  return null;
};

export const parseMailbox = (value) => {
  const raw = trimToNull(value);

  if (!raw) {
    return { address: null, name: null };
  }

  const angleMatch = raw.match(/^(?:"?([^"]+)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>$/u);
  if (angleMatch) {
    return {
      address: trimToNull(angleMatch[2]),
      name: trimToNull(angleMatch[1] ?? null)
    };
  }

  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
  if (!emailMatch) {
    return { address: null, name: raw };
  }

  const address = trimToNull(emailMatch[0]);
  const name = trimToNull(
    raw
      .replace(emailMatch[0], "")
      .replace(/[<>"]/gu, "")
      .replace(/\s+/gu, " ")
  );

  return { address, name };
};

const deriveSenderTitle = ({ fromAddress, fromName, senderAddress }) => {
  const preferred = pickFirstString(fromName, senderAddress, fromAddress);
  if (!preferred) {
    return "Newsletter";
  }

  if (!preferred.includes("@")) {
    return preferred;
  }

  const localPart = preferred.split("@")[0] || preferred;
  return localPart
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const deriveNewsletterFeedGroup = ({ fromAddress, fromName, senderAddress }) => {
  const senderTitle = deriveSenderTitle({ fromAddress, fromName, senderAddress });
  const normalizedTitle = trimToNull(senderTitle);

  if (normalizedTitle && normalizedTitle !== "Newsletter") {
    return normalizedTitle;
  }

  return pickFirstString(fromName, senderAddress, fromAddress, NEWSLETTER_FEED_GROUP) || NEWSLETTER_FEED_GROUP;
};

const deriveFeedKey = ({ fromAddress, senderAddress, title }) =>
  (pickFirstString(senderAddress, fromAddress, title) || "newsletter")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "newsletter";

const normalizeHtmlFragment = (html) => {
  const source = trimToNull(html);
  if (!source) {
    return "";
  }

  const root = parse(source);
  const body = root.querySelector("body");
  const fragment = body ? body.innerHTML : source;

  return sanitizeFragment(fragment);
};

const isTrackingOrSpacerImage = (image) => {
  const src = String(image?.getAttribute?.("src") || "");
  const width = Number(image?.getAttribute?.("width") || "0");
  const height = Number(image?.getAttribute?.("height") || "0");
  const style = String(image?.getAttribute?.("style") || "").toLowerCase();

  return (
    /\/open\?/iu.test(src) ||
    /\b(pixel|tracking)\b/iu.test(src) ||
    (width > 0 && width <= 2) ||
    (height > 0 && height <= 2) ||
    style.includes("display:none") ||
    style.includes("visibility:hidden")
  );
};

const stripEmailChrome = (html) => {
  const fragment = trimToNull(html);
  if (!fragment) {
    return "";
  }

  const root = parse(fragment);
  for (const selector of ["script", "style", "noscript", "meta", "link", "title", "head"]) {
    root.querySelectorAll(selector).forEach((node) => node.remove());
  }

  for (const image of root.querySelectorAll("img")) {
    if (isTrackingOrSpacerImage(image)) {
      image.remove();
    }
  }

  for (const node of root.querySelectorAll("table, tbody, thead, tfoot, tr, td")) {
    const text = stripHtml(node.innerHTML || "");
    const nestedTableCount = node.querySelectorAll("table").length;
    const hasMedia = node.querySelectorAll("img, picture, video").length > 0;

    if (!text && !hasMedia) {
      node.remove();
      continue;
    }

    if (["table", "tbody", "thead", "tfoot", "tr"].includes(node.tagName?.toLowerCase() || "")) {
      node.replaceWith(node.innerHTML);
      continue;
    }

    if (node.tagName?.toLowerCase() === "td" && nestedTableCount === 0) {
      const wrapperTag = text.length > 180 ? "div" : "p";
      node.replaceWith(`<${wrapperTag}>${node.innerHTML}</${wrapperTag}>`);
    }
  }

  return root.toString();
};

const unwrapEmailLayout = (html) => {
  const fragment = trimToNull(html);
  if (!fragment) {
    return "";
  }

  const root = parse(fragment);

  for (let iteration = 0; iteration < 400; iteration += 1) {
    const node = root.querySelector("table, tbody, thead, tfoot, tr, td");
    if (!node) {
      break;
    }

    const tagName = node.tagName?.toLowerCase() || "";
    const text = stripHtml(node.innerHTML || "");
    const hasMedia = node.querySelectorAll("img, picture, video").length > 0;

    if (!text && !hasMedia) {
      node.remove();
      continue;
    }

    if (tagName === "td") {
      const wrapperTag = text.length > 180 || hasMedia ? "div" : "p";
      node.replaceWith(`<${wrapperTag}>${node.innerHTML}</${wrapperTag}>`);
      continue;
    }

    node.replaceWith(node.innerHTML);
  }

  root.querySelectorAll("img").forEach((image) => {
    if (isTrackingOrSpacerImage(image)) {
      image.remove();
    }
  });

  for (const node of Array.from(root.querySelectorAll("p, div")).reverse()) {
    const text = stripHtml(node.innerHTML || "");

    if (
      !text ||
      /\b(unsubscribe|manage preferences|privacy policy|terms of service|forward this email)\b/iu.test(text) ||
      /^©\s*\d{4}\b/iu.test(text) ||
      (/substack inc/iu.test(text) && text.length < 180)
    ) {
      node.remove();
      continue;
    }

    break;
  }

  return sanitizeFragment(root.toString());
};

const restoreLeadAnchorHeading = (rawHtml, normalizedHtml) => {
  const body = trimToNull(normalizedHtml);
  if (!body) {
    return "";
  }

  const bodyText = stripHtml(body).toLowerCase();
  if (LEAD_ANCHOR_MARKERS.some((marker) => bodyText.includes(marker))) {
    return body;
  }

  const source = trimToNull(rawHtml);
  if (!source) {
    return body;
  }

  const root = parse(source);
  const candidates = Array.from(root.querySelectorAll("h1, h2, h3, h4, p")).slice(0, 80);
  const anchorNode = candidates.find((node) => {
    const text = stripHtml(node.innerHTML || "").toLowerCase();
    return LEAD_ANCHOR_MARKERS.some((marker) => text.includes(marker));
  });

  if (!anchorNode) {
    return body;
  }
  const bodyStartsWithStructuredContent = /^<(ol|ul|blockquote)\b/iu.test(body);
  if (!bodyStartsWithStructuredContent) {
    return body;
  }

  const anchorText = stripHtml(anchorNode.innerHTML || "").trim();
  if (!anchorText) {
    return body;
  }

  return `<h4>${escapeHtml(anchorText)}</h4>${body}`;
};

const enforceLeadAnchorHeading = (rawHtml, normalizedHtml) => {
  const body = trimToNull(normalizedHtml);
  if (!body || !/^<(ol|ul|blockquote)\b/iu.test(body)) {
    return body || "";
  }

  const text = stripHtml(body).toLowerCase();
  if (LEAD_ANCHOR_MARKERS.some((marker) => text.includes(marker))) {
    return body;
  }

  const source = trimToNull(rawHtml);
  if (!source) {
    return body;
  }

  const idx = LEAD_ANCHOR_MARKERS
    .map((marker) => ({
      marker,
      index: source.toLowerCase().indexOf(marker)
    }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index)[0];

  if (!idx) {
    return body;
  }

  const anchorText = idx.marker
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return `<h4>${escapeHtml(anchorText)}:</h4>${body}`;
};

const normalizeNewsletterHtml = ({
  author = "",
  feedTitle = "",
  html = "",
  title = ""
}) => {
  const stripped = stripEmailChrome(html);
  const readable = extractReadableContent(stripped || html) || normalizeHtmlFragment(html);
  const normalized = normalizeArticleContent({
    author,
    bodyHtml: readable,
    feedTitle,
    publishedAt: "",
    summaryHtml: readable,
    thumbnailUrl: "",
    title
  });
  const unwrappedBody = unwrapEmailLayout(normalized.bodyHtml);
  const anchoredBody = restoreLeadAnchorHeading(html, unwrappedBody || normalized.bodyHtml);
  const finalized = normalizeArticleContent({
    author,
    bodyHtml: anchoredBody || unwrappedBody || normalized.bodyHtml,
    feedTitle,
    publishedAt: "",
    summaryHtml: normalized.summaryHtml || anchoredBody || unwrappedBody || normalized.bodyHtml,
    thumbnailUrl: "",
    title
  });

  return {
    bodyHtml: enforceLeadAnchorHeading(html, finalized.bodyHtml),
    previewText: finalized.previewText || stripHtml(finalized.bodyHtml).slice(0, 220),
    readTimeMinutes: Math.max(finalized.readTimeMinutes || 0, 1),
    summaryHtml: finalized.summaryHtml || finalized.bodyHtml,
    subtitle: finalized.subtitle || ""
  };
};

const renderPlainTextHtml = (text) => {
  const normalized = trimToNull(text);
  if (!normalized) {
    return "";
  }

  const paragraphs = normalized
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.replace(/\n+/gu, " ").trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "";
  }

  return sanitizeFragment(
    paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
  );
};

const extractOrigin = (value) => {
  const normalized = canonicalizeUrl(value || "");
  if (!/^https?:\/\//iu.test(normalized)) {
    return "";
  }

  try {
    return new URL(normalized).origin;
  } catch {
    return "";
  }
};

const scoreNewsletterLink = ({ href, text }) => {
  if (!/^https?:\/\//iu.test(href)) {
    return -1;
  }

  let score = 0;
  const normalizedHref = href.toLowerCase();
  const normalizedText = String(text || "").trim();

  if (NEWSLETTER_LINK_HINT.test(normalizedText)) {
    score += 1000;
  }
  if (IGNORABLE_LINK_HINT.test(normalizedText) || IGNORABLE_LINK_HINT.test(normalizedHref)) {
    score -= 400;
  }
  if (/\/amp\//iu.test(normalizedHref)) {
    score -= 30;
  }

  score += Math.min(normalizedText.length, 80);
  return score;
};

const extractPreferredUrlFromHtml = (html) => {
  const fragment = trimToNull(html);
  if (!fragment) {
    return "";
  }

  const root = parse(fragment);
  let best = { score: -Infinity, url: "" };

  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = canonicalizeUrl(anchor.getAttribute("href") || "");
    const score = scoreNewsletterLink({
      href,
      text: anchor.textContent
    });

    if (score > best.score) {
      best = { score, url: href };
    }
  }

  return best.score > -1 ? best.url : "";
};

const extractPreferredUrlFromText = (text) => {
  const normalized = trimToNull(text);
  if (!normalized) {
    return "";
  }

  let match;
  while ((match = HTTP_URL_PATTERN.exec(normalized))) {
    const url = canonicalizeUrl(match[0]);
    if (!IGNORABLE_LINK_HINT.test(url)) {
      return url;
    }
  }

  return "";
};

const normalizeTimestamp = (value) => {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.valueOf()) ? Date.now() : parsed.valueOf();
};

const createSummaryHtml = (text) => {
  const normalized = trimToNull(text);
  if (!normalized) {
    return "";
  }

  const excerpts = normalized
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.replace(/\n+/gu, " ").trim())
    .filter(Boolean)
    .slice(0, 2);

  return excerpts.length > 0
    ? sanitizeFragment(excerpts.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join(""))
    : "";
};

export const getNewsletterInboxEmail = () =>
  trimToNull(process.env.READER_NEWSLETTER_INBOX_EMAIL) || "news@mj-kang.com";

export const getAgentMailApiKey = () =>
  trimToNull(process.env.AGENTMAIL_API_KEY) || "";

export const hasAgentMailApiKey = () => Boolean(getAgentMailApiKey());

export const buildNewsletterInboxCreateArgs = (emailAddress) => {
  const normalized = trimToNull(emailAddress);
  if (!normalized || !normalized.includes("@")) {
    throw new Error("Newsletter inbox email must be a valid email address");
  }

  const [username, domain] = normalized.split("@");
  if (!username || !domain) {
    throw new Error("Newsletter inbox email must be a valid email address");
  }

  return {
    display_name: "Reader Newsletters",
    domain,
    username
  };
};

export const buildNewsletterImport = (message) => {
  if (!message || typeof message !== "object") {
    throw new Error("Newsletter message payload must be an object");
  }

  const messageId = trimToNull(message.message_id);
  if (!messageId) {
    throw new Error("Newsletter message payload is missing message_id");
  }

  const { address: fromAddress, name: fromName } = parseMailbox(message.from);
  const { address: senderHeaderAddress } = parseMailbox(
    getMessageHeader(message.headers, "sender")
  );
  const senderAddress = pickFirstString(senderHeaderAddress, fromAddress);
  const senderTitle = deriveSenderTitle({
    fromAddress,
    fromName,
    senderAddress
  });
  const senderFeedGroup = deriveNewsletterFeedGroup({
    fromAddress,
    fromName,
    senderAddress
  });
  const title = pickFirstString(message.subject, message.preview) || `Newsletter from ${senderTitle}`;
  const rawHtmlBody = pickFirstString(message.extracted_html, message.html) || "";
  const textBody = pickFirstString(
    message.extracted_text,
    message.text,
    message.preview
  ) || "";
  const normalizedHtml = rawHtmlBody
    ? normalizeNewsletterHtml({
      author: pickFirstString(fromName, senderAddress, fromAddress) || "",
      feedTitle: senderTitle,
      html: rawHtmlBody,
      title
    })
    : null;
  const bodyHtml = normalizedHtml?.bodyHtml || renderPlainTextHtml(textBody);
  const previewText = normalizedHtml?.previewText || (textBody || stripHtml(bodyHtml)).slice(0, 220);

  if (!bodyHtml && !previewText) {
    return null;
  }

  const preferredUrl =
    extractPreferredUrlFromHtml(rawHtmlBody || bodyHtml) ||
    extractPreferredUrlFromText(textBody);
  const resolvedUrl = preferredUrl || `agentmail://messages/${encodeURIComponent(messageId)}`;
  const feedKey = deriveFeedKey({
    fromAddress,
    senderAddress,
    title: senderTitle
  });
  const summaryHtml = normalizedHtml?.summaryHtml || createSummaryHtml(textBody || stripHtml(bodyHtml).slice(0, 420)) || bodyHtml;
  const publishedAt = normalizeTimestamp(
    pickFirstString(message.timestamp, message.created_at, message.updated_at)
  );

  return {
    article: {
      author: pickFirstString(fromName, senderAddress, fromAddress) || "",
      bodyHtml,
      bodySource: "feed",
      canonicalUrl: resolvedUrl,
      externalId: messageId,
      feedGroup: senderFeedGroup,
      feedSiteUrl: extractOrigin(preferredUrl),
      previewText,
      publishedAt,
      readTimeMinutes: normalizedHtml?.readTimeMinutes || estimateReadTime(bodyHtml),
      sourceType: "feed",
      summaryHtml,
      subtitle:
        normalizedHtml?.subtitle || (senderAddress && senderAddress !== senderTitle
          ? senderAddress
          : ""),
      title,
      url: resolvedUrl
    },
    feed: {
      feedGroup: senderFeedGroup,
      key: feedKey,
      siteUrl: extractOrigin(preferredUrl),
      title: senderTitle
    }
  };
};
