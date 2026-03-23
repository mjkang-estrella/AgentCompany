import { parseHTML } from "linkedom";

import {
  estimateReadTime,
  sanitizeFragment,
  stripHtml
} from "./html.mjs";

const LEAD_MARKERS = [
  "back to blog",
  "forwarded to you",
  "sign up to get it in your inbox",
  "printable pdf",
  "epub",
  "kindle",
  "pdf",
  "source",
  "updated "
];

const FOOTER_MARKERS = [
  "subscribe",
  "sign in",
  "already have an account",
  "privacy policy",
  "terms of service",
  "follow us",
  "follow on",
  "linkedin",
  "community members",
  "sponsorship opportunities",
  "work with us",
  "newsletter",
  "join 100,000",
  "email address",
  "the only subscription",
  "stay at the edge of ai",
  "what is included in a subscription",
  "upgrade to paid",
  "related essays"
];

const MONTH_PATTERN = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/iu;

const normalizeText = (value) => String(value || "").replace(/\s+/gu, " ").trim().toLowerCase();
const sentenceCount = (text) => (String(text || "").match(/[.!?](?:\s|$)/gu) || []).length;
const markerCount = (text, markers) =>
  markers.reduce((count, marker) => count + (text.includes(marker) ? 1 : 0), 0);

const isDateLike = (text) =>
  MONTH_PATTERN.test(text) ||
  /\b\d{4}\b/u.test(text) ||
  /\b(updated|posted|published)\b/iu.test(text);

const isUtilityText = (text) => {
  const normalized = normalizeText(text);
  return (
    !normalized ||
    normalized === "source" ||
    /^source[:\s]/u.test(normalized) ||
    /^\d+\s*(comments?|responses?)?$/iu.test(normalized) ||
    /^by\b/iu.test(normalized) ||
    isDateLike(normalized) ||
    markerCount(normalized, LEAD_MARKERS) >= 1
  );
};

const isMediaBlock = (node) => {
  if (!node?.querySelector) {
    return false;
  }

  const textLength = normalizeText(node.textContent).length;
  const mediaCount = node.querySelectorAll("img, picture, video, iframe, svg").length;
  const formCount = node.querySelectorAll("form, input, button").length;

  return mediaCount > 0 && formCount === 0 && textLength < 220;
};

const isSubtitleCandidate = (node, context, nextNode) => {
  if (!node || !nextNode) {
    return false;
  }

  const tagName = node.tagName?.toLowerCase() || "";
  if (!["h2", "h3"].includes(tagName)) {
    return false;
  }

  const text = normalizeText(node.textContent);
  const textLength = text.length;

  if (!text || textLength < 24 || textLength > 240) {
    return false;
  }

  if (isUtilityText(text) || isDuplicateTitleBlock(node, context.title)) {
    return false;
  }

  return isSubstantiveBodyBlock(nextNode);
};

const isSubstantiveBodyBlock = (node) => {
  if (!node) {
    return false;
  }

  if (isMediaBlock(node)) {
    return false;
  }

  const text = normalizeText(node.textContent);
  const textLength = text.length;
  const tagName = node.tagName?.toLowerCase() || "";

  if (textLength >= 220) {
    return true;
  }

  if (textLength >= 120 && sentenceCount(text) >= 2) {
    return true;
  }

  if (textLength >= 45 && sentenceCount(text) >= 1) {
    return true;
  }

  if (textLength >= 70 && sentenceCount(text) >= 1) {
    return true;
  }

  return ["blockquote", "ol", "pre", "table", "ul"].includes(tagName) && textLength >= 80;
};

const isDuplicateTitleBlock = (node, title) => {
  const normalizedTitle = normalizeText(title);
  const text = normalizeText(node?.textContent);
  if (!normalizedTitle || !text) {
    return false;
  }

  if (!["h1", "h2", "h3"].includes(node.tagName?.toLowerCase() || "")) {
    return false;
  }

  return text === normalizedTitle || text.replace(/[“”"'`]/gu, "") === normalizedTitle.replace(/[“”"'`]/gu, "");
};

const isLeadMetadataBlock = (node, context, state, nextNode) => {
  if (!node) {
    return false;
  }

  const text = normalizeText(node.textContent);
  if (!text) {
    return true;
  }

  const textLength = text.length;
  const links = node.querySelectorAll?.("a").length || 0;
  const controls = node.querySelectorAll?.("button, input, form").length || 0;
  const leadScore = markerCount(text, LEAD_MARKERS);

  if (isDuplicateTitleBlock(node, context.title)) {
    return true;
  }

  if (
    ["figure", "figcaption"].includes(node.tagName?.toLowerCase() || "") &&
    textLength < 120 &&
    /\b(illustration|photo|image|credit)\b/iu.test(text)
  ) {
    return true;
  }

  if (text === "source" || /^source[:\s]/u.test(text)) {
    return true;
  }

  if (/^\d+\s*(comments?|responses?)?$/iu.test(text)) {
    return true;
  }

  if (leadScore >= 1 && textLength < 260) {
    return true;
  }

  if (controls > 0 && textLength < 400) {
    return true;
  }

  if (
    /^by\b/iu.test(text) &&
    textLength < 240
  ) {
    return true;
  }

  if (
    context.author &&
    text.includes(normalizeText(context.author)) &&
    isDateLike(text) &&
    textLength < 280
  ) {
    return true;
  }

  if (isDateLike(text) && textLength < 90) {
    return true;
  }

  if (
    state.removedLeadCount > 0 &&
    ["h2", "h3"].includes(node.tagName?.toLowerCase() || "") &&
    textLength < 80 &&
    nextNode &&
    isSubstantiveBodyBlock(nextNode)
  ) {
    return true;
  }

  if (
    state.removedLeadCount > 0 &&
    textLength < 220 &&
    sentenceCount(text) <= 2 &&
    links <= 1 &&
    nextNode &&
    isUtilityText(nextNode.textContent)
  ) {
    return true;
  }

  return links >= 3 && textLength < 220;
};

const isFooterChromeBlock = (node, context) => {
  if (!node) {
    return false;
  }

  const text = normalizeText(node.textContent);
  if (!text) {
    return true;
  }

  const textLength = text.length;
  const links = node.querySelectorAll?.("a").length || 0;
  const controls = node.querySelectorAll?.("button, input, form").length || 0;
  const footerScore = markerCount(text, FOOTER_MARKERS);

  if (footerScore >= 2) {
    return true;
  }

  if (
    text === "subscribe" ||
    text === "email address" ||
    text === "community members"
  ) {
    return true;
  }

  if (controls > 0 && footerScore >= 1) {
    return true;
  }

  if (links >= 4 && footerScore >= 1) {
    return true;
  }

  if (
    context.author &&
    text.includes(normalizeText(context.author)) &&
    textLength < 320 &&
    /\b(newsletter|read more|subscribe|follow|staff writer|editorial lead)\b/iu.test(text)
  ) {
    return true;
  }

  if (
    /\b(newsletter|read more|subscribe|follow)\b/iu.test(text) &&
    textLength < 220
  ) {
    return true;
  }

  return false;
};

const normalizeBodyHtml = (bodyHtml, context = {}) => {
  const sanitizedBody = sanitizeFragment(bodyHtml || "");
  if (!sanitizedBody) {
    return {
      bodyHtml: "",
      removedBottomCount: 0,
      removedLeadCount: 0
    };
  }

  const document = parseHTML(
    `<!doctype html><html><body><div data-normalize-root>${sanitizedBody}</div></body></html>`
  ).document;
  const root = document.querySelector("[data-normalize-root]");
  if (!root) {
    return {
      bodyHtml: sanitizedBody,
      removedBottomCount: 0,
      removedLeadCount: 0
    };
  }

  let removedLeadCount = 0;
  let removedBottomCount = 0;
  let seenLeadMedia = false;
  let subtitle = "";

  while (root.firstChild?.nodeType === 3 && !normalizeText(root.firstChild.textContent)) {
    root.firstChild.remove();
  }

  const leadNodes = Array.from(root.children).slice(0, 10);
  for (let index = 0; index < leadNodes.length; index += 1) {
    const node = leadNodes[index];
    const nextNode = leadNodes[index + 1] || null;

    if (isMediaBlock(node) && !seenLeadMedia) {
      seenLeadMedia = true;
      continue;
    }

    if (isLeadMetadataBlock(node, context, { removedLeadCount, seenLeadMedia }, nextNode)) {
      node.remove();
      removedLeadCount += 1;
      continue;
    }

    if (isSubstantiveBodyBlock(node)) {
      break;
    }

    if (seenLeadMedia && normalizeText(node.textContent).length < 160) {
      node.remove();
      removedLeadCount += 1;
      continue;
    }

    break;
  }

  for (const node of Array.from(root.children).reverse().slice(0, 8)) {
    if (isFooterChromeBlock(node, context)) {
      node.remove();
      removedBottomCount += 1;
      continue;
    }

    break;
  }

  while (removedBottomCount > 0 && root.lastElementChild) {
    const node = root.lastElementChild;
    const text = normalizeText(node.textContent);
    const textLength = text.length;
    const links = node.querySelectorAll?.("a").length || 0;
    const media = node.querySelectorAll?.("img, picture, video, svg").length || 0;
    const tagName = node.tagName?.toLowerCase() || "";

    if (
      !text ||
      (["a", "h2", "h3"].includes(tagName) && textLength < 220) ||
      ((links > 0 || media > 0) && textLength < 260)
    ) {
      node.remove();
      removedBottomCount += 1;
      continue;
    }

    break;
  }

  while (root.lastChild?.nodeType === 3) {
    const text = normalizeText(root.lastChild.textContent);
    if (!text || markerCount(text, FOOTER_MARKERS) >= 1 || text.length < 140) {
      root.lastChild.remove();
      removedBottomCount += 1;
      continue;
    }
    break;
  }

  while (root.firstChild?.nodeType === 3 && !normalizeText(root.firstChild.textContent)) {
    root.firstChild.remove();
  }

  const contentNodes = Array.from(root.children);
  let firstContentNode = contentNodes.find((node) => !isMediaBlock(node)) || null;
  if (!firstContentNode && contentNodes.length > 1 && isMediaBlock(contentNodes[0])) {
    firstContentNode = contentNodes[1];
  }

  if (firstContentNode) {
    const nextNode = firstContentNode.nextElementSibling;
    if (isSubtitleCandidate(firstContentNode, context, nextNode)) {
      subtitle = String(firstContentNode.textContent || "").replace(/\s+/gu, " ").trim();
      firstContentNode.remove();
    }
  }

  return {
    bodyHtml: sanitizeFragment(root.innerHTML),
    removedBottomCount,
    removedLeadCount,
    subtitle
  };
};

export const normalizeArticleContent = ({
  author = "",
  bodyHtml = "",
  feedTitle = "",
  publishedAt = "",
  summaryHtml = "",
  thumbnailUrl = "",
  title = ""
}) => {
  const normalizedBody = normalizeBodyHtml(bodyHtml, {
    author,
    feedTitle,
    publishedAt,
    thumbnailUrl,
    title
  });
  const sanitizedSummary = sanitizeFragment(summaryHtml || "");
  const normalizedSummary =
    !sanitizedSummary ||
    sanitizedSummary === sanitizeFragment(bodyHtml || "") ||
    stripHtml(sanitizedSummary).length > 300
      ? normalizedBody.bodyHtml
      : sanitizedSummary;

  return {
    bodyHtml: normalizedBody.bodyHtml,
    previewText: stripHtml(normalizedSummary || normalizedBody.bodyHtml).slice(0, 220),
    readTimeMinutes: estimateReadTime(normalizedBody.bodyHtml),
    removedBottomCount: normalizedBody.removedBottomCount,
    removedLeadCount: normalizedBody.removedLeadCount,
    subtitle: normalizedBody.subtitle,
    summaryHtml: normalizedSummary
  };
};
