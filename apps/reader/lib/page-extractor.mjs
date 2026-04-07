import { parseHTML } from "linkedom";

import {
  canonicalizeUrl,
  estimateReadTime,
  extractPageMetadata,
  extractReadableContent,
  sanitizeFragment,
  stripHtml
} from "./html.mjs";

let defuddlePromise;
const CHROME_MARKERS = [
  "subscribe",
  "sign in",
  "log in",
  "login",
  "privacy policy",
  "terms of service",
  "community members",
  "follow us",
  "follow on",
  "already have an account",
  "do not sell or share my personal information",
  "sponsorship opportunities",
  "work with us",
  "newsletter",
  "return home"
];
const REJECT_MARKERS = [
  "404",
  "not found",
  "return home",
  "page not found"
];

class LinkedomDOMParser {
  parseFromString(html) {
    return parseHTML(String(html || "")).document;
  }
}

const createComputedStyle = () => ({
  display: "block",
  float: "none",
  fontSize: "16px",
  fontWeight: "400",
  height: "auto",
  lineHeight: "normal",
  opacity: "1",
  overflow: "visible",
  position: "static",
  visibility: "visible",
  width: "auto",
  getPropertyValue() {
    return "";
  }
});

const ensureDomGlobals = () => {
  if (typeof globalThis.window === "undefined") {
    globalThis.window = globalThis;
  }

  if (!globalThis.DOMParser) {
    globalThis.DOMParser = LinkedomDOMParser;
  }

  if (!globalThis.window.DOMParser) {
    globalThis.window.DOMParser = LinkedomDOMParser;
  }

  if (typeof globalThis.document === "undefined") {
    globalThis.document = parseHTML("<!doctype html><html><head></head><body></body></html>").document;
  }

  if (!globalThis.getComputedStyle) {
    globalThis.getComputedStyle = () => createComputedStyle();
  }

  if (!globalThis.window.getComputedStyle) {
    globalThis.window.getComputedStyle = globalThis.getComputedStyle;
  }

  if (!globalThis.matchMedia) {
    globalThis.matchMedia = () => ({
      addEventListener() {},
      addListener() {},
      dispatchEvent() {
        return false;
      },
      matches: false,
      media: "",
      onchange: null,
      removeEventListener() {},
      removeListener() {}
    });
  }

  if (!globalThis.window.matchMedia) {
    globalThis.window.matchMedia = globalThis.matchMedia;
  }
};

const loadDefuddle = async () => {
  ensureDomGlobals();

  if (!defuddlePromise) {
    defuddlePromise = import("defuddle").then((module) => module.default || module);
  }

  return defuddlePromise;
};

const setDocumentUrl = (document, url) => {
  for (const key of ["URL", "documentURI", "baseURI"]) {
    try {
      Object.defineProperty(document, key, {
        configurable: true,
        value: url
      });
    } catch {
      // Ignore read-only properties.
    }
  }

  for (const [key, value] of Object.entries({
    defaultView: globalThis.window,
    location: new URL(url),
    styleSheets: []
  })) {
    try {
      Object.defineProperty(document, key, {
        configurable: true,
        value
      });
    } catch {
      // Ignore read-only properties.
    }
  }
};

const firstNonEmpty = (...values) => values.find((value) => String(value || "").trim()) || "";
const normalizeText = (value) => String(value || "").replace(/\s+/gu, " ").trim().toLowerCase();

const chooseArticleTitle = ({
  defuddledTitle = "",
  metadataTitle = "",
  siteName = ""
}) => {
  const defuddled = String(defuddledTitle || "").trim();
  const metadata = String(metadataTitle || "").trim();
  const site = String(siteName || "").trim();

  if (!defuddled) {
    return metadata;
  }

  if (!metadata) {
    return defuddled;
  }

  const normalizedDefuddled = normalizeText(defuddled);
  const normalizedMetadata = normalizeText(metadata);
  const normalizedSite = normalizeText(site);

  if (
    normalizedSite &&
    normalizedDefuddled === normalizedSite &&
    normalizedMetadata !== normalizedSite
  ) {
    return metadata;
  }

  if (
    normalizedMetadata &&
    normalizedDefuddled.includes(normalizedMetadata) &&
    normalizedDefuddled !== normalizedMetadata
  ) {
    return metadata;
  }

  return defuddled;
};

const normalizeSummaryHtml = (bodyHtml, description) => {
  if (description) {
    return sanitizeFragment(`<p>${description}</p>`);
  }

  return sanitizeFragment(bodyHtml || "");
};

const findFirstImageUrl = (html, baseUrl) => {
  if (!html) {
    return "";
  }

  const match = String(html).match(/<img\b[^>]*\bsrc=["']([^"']+)["']/iu);
  if (!match?.[1]) {
    return "";
  }

  try {
    return new URL(match[1], baseUrl).toString();
  } catch {
    return "";
  }
};

const scoreChromeText = (text) =>
  CHROME_MARKERS.reduce((count, marker) => count + (text.includes(marker) ? 1 : 0), 0);

const isRejectText = (text) => REJECT_MARKERS.some((marker) => text.includes(marker));

const nodeTextLength = (node) => normalizeText(node?.textContent || "").length;

const isCompactChromeBlock = (node) => {
  if (!node) {
    return false;
  }

  const text = normalizeText(node.textContent);
  const linkCount = node.querySelectorAll?.("a").length || 0;
  const inputCount = node.querySelectorAll?.("input, button, form").length || 0;
  const markerScore = scoreChromeText(text);
  const textLength = text.length;

  return (
    markerScore >= 2 &&
    (
      inputCount > 0 ||
      linkCount >= 3 ||
      textLength < 600
    )
  );
};

const isLikelyFooterBlock = (node) => {
  if (!node) {
    return false;
  }

  const text = normalizeText(node.textContent);
  const linkCount = node.querySelectorAll?.("a").length || 0;
  const imageCount = node.querySelectorAll?.("img").length || 0;
  const markerScore = scoreChromeText(text);

  return (
    markerScore >= 2 &&
    (linkCount >= 4 || imageCount >= 2 || text.length < 1200)
  );
};

const trimChromeBlocks = (html) => {
  if (!html) {
    return {
      bodyHtml: "",
      removedBottom: 0,
      removedTop: 0
    };
  }

  const document = parseHTML(`<div>${html}</div>`).document;
  const root = document.body.firstElementChild;
  if (!root) {
    return {
      bodyHtml: sanitizeFragment(html),
      removedBottom: 0,
      removedTop: 0
    };
  }

  let removedTop = 0;
  let removedBottom = 0;

  while (root.firstElementChild && removedTop < 3 && isCompactChromeBlock(root.firstElementChild)) {
    root.firstElementChild.remove();
    removedTop += 1;
  }

  while (root.lastElementChild && removedBottom < 5 && isLikelyFooterBlock(root.lastElementChild)) {
    root.lastElementChild.remove();
    removedBottom += 1;
  }

  return {
    bodyHtml: sanitizeFragment(root.innerHTML),
    removedBottom,
    removedTop
  };
};

const assessExtractionQuality = ({
  bodyHtml,
  metadata,
  siteName,
  title
}) => {
  const text = normalizeText(stripHtml(bodyHtml));
  const titleText = normalizeText(title);
  const siteText = normalizeText(siteName || metadata.siteName || "");
  const markerScore = scoreChromeText(text);
  const textLength = text.length;

  if (!textLength || isRejectText(text) || isRejectText(titleText)) {
    return {
      quality: "reject",
      rejectionReason: "not-an-article"
    };
  }

  if (
    siteText &&
    titleText &&
    titleText === siteText &&
    markerScore >= 2
  ) {
    if (textLength >= 4000) {
      return {
        quality: "usable",
        rejectionReason: ""
      };
    }

    return {
      quality: "reject",
      rejectionReason: "site-chrome-dominated"
    };
  }

  if (markerScore >= 4 && textLength < 1800) {
    return {
      quality: "reject",
      rejectionReason: "marketing-chrome-dominated"
    };
  }

  if (markerScore <= 2 && textLength >= 160) {
    return {
      quality: "usable",
      rejectionReason: ""
    };
  }

  if (markerScore >= 3 || textLength < 220) {
    return {
      quality: "weak",
      rejectionReason: "thin-or-chrome-heavy"
    };
  }

  return {
    quality: "usable",
    rejectionReason: ""
  };
};

const chooseBodyHtml = (defuddledHtml, fallbackHtml) => {
  const sanitizedDefuddled = sanitizeFragment(defuddledHtml || "");
  const sanitizedFallback = sanitizeFragment(fallbackHtml || "");
  const defuddledLength = stripHtml(sanitizedDefuddled).length;
  const fallbackLength = stripHtml(sanitizedFallback).length;
  const defuddledLinkLength = stripHtml(
    (String(sanitizedDefuddled).match(/<a\b[^>]*>[\s\S]*?<\/a>/giu) || []).join(" ")
  ).length;

  if (
    sanitizedFallback &&
    /<table[\s>]/iu.test(sanitizedDefuddled) &&
    !/<table[\s>]/iu.test(sanitizedFallback)
  ) {
    return sanitizedFallback;
  }

  if (sanitizedFallback && defuddledLinkLength > defuddledLength * 0.18) {
    return sanitizedFallback;
  }

  if (defuddledLength >= 80) {
    return sanitizedDefuddled;
  }

  if (fallbackLength > defuddledLength) {
    return sanitizedFallback;
  }

  return sanitizedDefuddled || sanitizedFallback;
};

export const extractPageWithDefuddle = async (html, url) => {
  const metadata = extractPageMetadata(html, url);
  const fallbackHtml = extractReadableContent(html);
  const document = parseHTML(html || "").document;
  setDocumentUrl(document, url);

  let defuddled = null;

  try {
    const Defuddle = await loadDefuddle();
    const extractor = new Defuddle(document, { url });
    defuddled = typeof extractor.parseAsync === "function"
      ? await extractor.parseAsync()
      : extractor.parse();
  } catch {
    defuddled = null;
  }

  const chosenBodyHtml = chooseBodyHtml(defuddled?.content || "", fallbackHtml);
  const trimmed = trimChromeBlocks(chosenBodyHtml);
  const bodyHtml = trimmed.bodyHtml;
  const summaryHtml = normalizeSummaryHtml(
    bodyHtml,
    firstNonEmpty(defuddled?.description, metadata.description)
  );
  const thumbnailUrl = firstNonEmpty(
    defuddled?.image,
    metadata.thumbnailUrl,
    findFirstImageUrl(bodyHtml || summaryHtml, url)
  );
  const canonicalUrl = canonicalizeUrl(
    firstNonEmpty(metadata.canonicalUrl, defuddled?.url, url)
  );
  const resolvedSiteName = firstNonEmpty(defuddled?.site, metadata.siteName);
  const title = chooseArticleTitle({
    defuddledTitle: defuddled?.title,
    metadataTitle: metadata.title,
    siteName: resolvedSiteName
  });
  const quality = assessExtractionQuality({
    bodyHtml,
    metadata,
    siteName: resolvedSiteName,
    title
  });

  return {
    author: firstNonEmpty(defuddled?.author, metadata.author),
    bodyHtml,
    canonicalUrl,
    previewText: stripHtml(summaryHtml || bodyHtml).slice(0, 220),
    publishedAt: firstNonEmpty(defuddled?.published, metadata.publishedAt),
    quality: quality.quality,
    readTimeMinutes: estimateReadTime(bodyHtml),
    rejectionReason: quality.rejectionReason || "",
    siteName: resolvedSiteName,
    summaryHtml,
    thumbnailUrl: thumbnailUrl || "",
    title
  };
};
