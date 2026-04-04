import { parse } from "node-html-parser";

import {
  canonicalizeUrl,
  estimateReadTime,
  sanitizeFragment,
  stripHtml
} from "./html.mjs";

export const NEWSLETTER_FEED_GROUP = "Newsletters";
export const NEWSLETTER_LABEL_INGESTED = "reader-ingested";
export const NEWSLETTER_LABEL_UNREAD = "unread";

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"')]+/giu;
const NEWSLETTER_LINK_HINT = /\b(view|read|open).{0,20}\b(browser|web|online)\b/iu;
const IGNORABLE_LINK_HINT = /\b(unsubscribe|manage|preferences|settings|privacy|forward|share)\b/iu;

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
  const htmlBody = normalizeHtmlFragment(
    pickFirstString(message.extracted_html, message.html)
  );
  const textBody = pickFirstString(
    message.extracted_text,
    message.text,
    message.preview
  ) || "";
  const bodyHtml = htmlBody || renderPlainTextHtml(textBody);
  const previewText = (textBody || stripHtml(bodyHtml)).slice(0, 220);

  if (!bodyHtml && !previewText) {
    return null;
  }

  const preferredUrl =
    extractPreferredUrlFromHtml(bodyHtml) ||
    extractPreferredUrlFromText(textBody);
  const resolvedUrl = preferredUrl || `agentmail://messages/${encodeURIComponent(messageId)}`;
  const title = pickFirstString(message.subject, message.preview) || `Newsletter from ${senderTitle}`;
  const feedKey = deriveFeedKey({
    fromAddress,
    senderAddress,
    title: senderTitle
  });
  const summaryHtml = createSummaryHtml(textBody || stripHtml(bodyHtml).slice(0, 420)) || bodyHtml;
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
      feedGroup: NEWSLETTER_FEED_GROUP,
      feedSiteUrl: extractOrigin(preferredUrl),
      previewText,
      publishedAt,
      readTimeMinutes: estimateReadTime(bodyHtml),
      sourceType: "feed",
      summaryHtml,
      subtitle:
        senderAddress && senderAddress !== senderTitle
          ? senderAddress
          : "",
      title,
      url: resolvedUrl
    },
    feed: {
      key: feedKey,
      siteUrl: extractOrigin(preferredUrl),
      title: senderTitle
    }
  };
};
