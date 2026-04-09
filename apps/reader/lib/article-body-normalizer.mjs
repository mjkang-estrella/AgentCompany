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
const PREFACE_MARKERS = [
  "biggest takeaways",
  "key takeaways",
  "takeaways",
  "key points",
  "what you'll learn",
  "what you will learn",
  "in this conversation",
  "in this episode",
  "highlights",
  "tl;dr",
  "quick take"
];
const LEAD_PROMO_MARKERS = [
  "read in app",
  "listen on",
  "brought to you by",
  "where to find",
  "referenced",
  "upcoming meetups",
  "new podcast episodes",
  "community sponsor",
  "thanks to",
  "podcast",
  "youtube",
  "spotify",
  "apple podcasts"
];
const EXPLICIT_BODY_ANCHORS = [
  "top threads",
  "biggest takeaways",
  "key takeaways",
  "main takeaways"
];

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

const isLeadPromoMarkerText = (text) =>
  LEAD_PROMO_MARKERS.some((marker) => text.includes(marker));

const isLeadPromoBlock = (node) => {
  if (!node) {
    return false;
  }

  const text = normalizeText(node.textContent);
  const tagName = node.tagName?.toLowerCase() || "";
  const links = node.querySelectorAll?.("a").length || 0;
  const textLength = text.length;

  if (!text) {
    return tagName === "hr";
  }

  if (isLeadPromoMarkerText(text)) {
    return true;
  }

  if (tagName === "hr") {
    return true;
  }

  if ((tagName === "figure" || tagName === "a") && links <= 1 && textLength < 160) {
    return true;
  }

  if ((tagName === "ul" || tagName === "ol") && links >= 3 && textLength < 1800) {
    return true;
  }

  return /^read in app$/iu.test(text) || /^paid$/iu.test(text);
};

const isLeadBioPrefaceBlock = (node, upcomingNodes = []) => {
  if (!node) {
    return false;
  }

  const text = normalizeText(node.textContent);
  const textLength = text.length;
  const tagName = node.tagName?.toLowerCase() || "";
  if (!["p", "div"].includes(tagName) || textLength < 160 || textLength > 900) {
    return false;
  }

  if (!/\b(is |worked|previously|before that|co-founder|founder|head of|led|spent his career|spent her career)\b/iu.test(text)) {
    return false;
  }

  return upcomingNodes.some((candidate) => {
    const candidateText = normalizeText(candidate?.textContent);
    return (
      isLeadPromoBlock(candidate) ||
      candidateText.includes("in our in-depth discussion") ||
      candidateText.includes("what you'll learn") ||
      candidateText.includes("my biggest takeaways")
    );
  });
};

const isLeadPromoAnchor = (node) => {
  if (!node) {
    return false;
  }

  const text = normalizeText(node.textContent);
  const textLength = text.length;
  const tagName = node.tagName?.toLowerCase() || "";
  const links = node.querySelectorAll?.("a").length || 0;

  if (!text) {
    return false;
  }

  if (hasPrefaceMarker(text) && textLength < 280) {
    return true;
  }

  if (isLeadPromoMarkerText(text)) {
    return false;
  }

  if (["h1", "h2", "h3"].includes(tagName) && textLength >= 18) {
    return true;
  }

  if (isSubstantiveBodyBlock(node) && links <= 2) {
    return true;
  }

  return false;
};

const isExplicitLeadBodyAnchor = (node) => {
  if (!node) {
    return false;
  }

  const tagName = node.tagName?.toLowerCase() || "";
  if (!["h1", "h2", "h3", "h4"].includes(tagName)) {
    return false;
  }

  const text = normalizeText(node.textContent);
  return EXPLICIT_BODY_ANCHORS.some((marker) => text.includes(marker));
};

const isLeadPreambleBlock = (node, context, nextNode, upcomingNodes = []) =>
  isLeadPromoBlock(node) ||
  isLeadBioPrefaceBlock(node, upcomingNodes) ||
  isLeadMetadataBlock(node, context, { removedLeadCount: 0, seenLeadMedia: false }, nextNode);

const hasPrefaceMarker = (text) =>
  PREFACE_MARKERS.some((marker) => text.includes(marker));

const listItemCount = (node) => node?.querySelectorAll?.("li").length || 0;

const isLeadPrefaceStart = (node, nextNode) => {
  if (!node || !nextNode) {
    return false;
  }

  if (isMediaBlock(node) || !isSubstantiveBodyBlock(nextNode)) {
    return false;
  }

  const text = normalizeText(node.textContent);
  const rawText = String(node.textContent || "").replace(/\s+/gu, " ").trim();
  const textLength = text.length;
  const tagName = node.tagName?.toLowerCase() || "";
  const lists = listItemCount(node);
  const links = node.querySelectorAll?.("a").length || 0;
  const sentences = sentenceCount(text);

  if (!text || textLength > 700 || links > 6) {
    return false;
  }

  if (hasPrefaceMarker(text)) {
    return true;
  }

  if ((tagName === "ul" || tagName === "ol") && lists >= 2) {
    return true;
  }

  if (rawText.endsWith(":") && textLength < 220) {
    return true;
  }

  if (lists >= 2 && textLength < 420) {
    return true;
  }

  return sentences <= 2 && textLength < 180 && /:\s*$/u.test(rawText);
};

const isLeadPrefaceContinuation = (node) => {
  if (!node) {
    return false;
  }

  if (isMediaBlock(node)) {
    return false;
  }

  const text = normalizeText(node.textContent);
  const textLength = text.length;
  const tagName = node.tagName?.toLowerCase() || "";
  const lists = listItemCount(node);
  const links = node.querySelectorAll?.("a").length || 0;

  if (!text) {
    return true;
  }

  if ((tagName === "ul" || tagName === "ol") && lists >= 1) {
    return true;
  }

  if (hasPrefaceMarker(text) && textLength < 360) {
    return true;
  }

  return textLength < 240 && links <= 3 && !isSubstantiveBodyBlock(node);
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

  if (footerScore >= 1 && textLength < 320) {
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
  let preservedLeadSummaryHtml = "";
  let seenLeadMedia = false;
  let subtitle = "";

  while (root.firstChild?.nodeType === 3 && !normalizeText(root.firstChild.textContent)) {
    root.firstChild.remove();
  }

  const promoLeadNodes = Array.from(root.children).slice(0, 120);
  const promoIndexes = promoLeadNodes
    .map((node, index) => {
      const upcomingNodes = promoLeadNodes.slice(index + 1, index + 5);
      return (
        isLeadPromoBlock(node) ||
        isLeadBioPrefaceBlock(node, upcomingNodes)
      ) ? index : -1;
    })
    .filter((index) => index >= 0);

  if (promoIndexes.length >= 2) {
    let explicitAnchorIndex = -1;
    for (let index = 0; index < promoLeadNodes.length; index += 1) {
      if (isExplicitLeadBodyAnchor(promoLeadNodes[index])) {
        explicitAnchorIndex = index;
        break;
      }
    }

    if (explicitAnchorIndex > 0) {
      for (let index = 0; index < explicitAnchorIndex; index += 1) {
        const node = promoLeadNodes[index];
        if (node.parentNode === root) {
          node.remove();
          removedLeadCount += 1;
        }
      }
    } else {
    const lastPromoIndex = promoIndexes[promoIndexes.length - 1];
    let anchorIndex = -1;

    for (let index = lastPromoIndex + 1; index < promoLeadNodes.length; index += 1) {
      if (isLeadPromoAnchor(promoLeadNodes[index])) {
        anchorIndex = index;
        break;
      }
    }

    if (anchorIndex > 0) {
      for (let index = 0; index < anchorIndex; index += 1) {
        const node = promoLeadNodes[index];
        if (node.parentNode === root) {
          node.remove();
          removedLeadCount += 1;
        }
      }
    }
    }
  }

  const candidateNodes = Array.from(root.children);
  let prefaceStartIndex = candidateNodes.findIndex((node) => !isMediaBlock(node));
  if (removedLeadCount === 0 && prefaceStartIndex >= 0) {
    const firstPrefaceNode = candidateNodes[prefaceStartIndex];
    const nextNode = candidateNodes[prefaceStartIndex + 1] || null;

    if (isLeadPrefaceStart(firstPrefaceNode, nextNode)) {
      const prefaceNodes = [firstPrefaceNode];
      for (let index = prefaceStartIndex + 1; index < candidateNodes.length; index += 1) {
        const node = candidateNodes[index];
        const next = candidateNodes[index + 1] || null;

        if (isLeadPrefaceContinuation(node) && (!next || !isSubstantiveBodyBlock(node) || isSubstantiveBodyBlock(next))) {
          prefaceNodes.push(node);
          continue;
        }

        break;
      }

      const nextAfterPreface = candidateNodes[prefaceStartIndex + prefaceNodes.length] || null;
      if (nextAfterPreface && isSubstantiveBodyBlock(nextAfterPreface)) {
        preservedLeadSummaryHtml = sanitizeFragment(prefaceNodes.map((node) => node.outerHTML).join(""));
        for (const node of prefaceNodes) {
          node.remove();
          removedLeadCount += 1;
        }
      }
    }
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

  const anchoredNodes = Array.from(root.children).slice(0, 120);
  const explicitAnchorIndex = anchoredNodes.findIndex((node) => isExplicitLeadBodyAnchor(node));
  if (explicitAnchorIndex > 0) {
    const nodesBeforeAnchor = anchoredNodes.slice(0, explicitAnchorIndex);
    const preambleCount = nodesBeforeAnchor.filter((node, index) =>
      isLeadPreambleBlock(
        node,
        context,
        nodesBeforeAnchor[index + 1] || anchoredNodes[explicitAnchorIndex] || null,
        anchoredNodes.slice(index + 1, index + 5)
      )
    ).length;

    if (preambleCount >= 2) {
      for (const node of nodesBeforeAnchor) {
        if (node.parentNode === root) {
          node.remove();
          removedLeadCount += 1;
        }
      }
    }
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
    preservedLeadSummaryHtml,
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
  const normalizedSummary = normalizedBody.preservedLeadSummaryHtml
    ? normalizedBody.preservedLeadSummaryHtml
    : (
      !sanitizedSummary ||
      sanitizedSummary === sanitizeFragment(bodyHtml || "") ||
      stripHtml(sanitizedSummary).length > 300
        ? normalizedBody.bodyHtml
        : sanitizedSummary
    );

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
