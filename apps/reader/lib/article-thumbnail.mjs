const NON_ARTICLE_IMAGE = /(?:^|[^a-z0-9])(?:favicons?|apple[-_]touch|android[-_]chrome|safari[-_]pinned[-_]tab|logos?|logomarks?|icons?|wordmarks?|sprites?|avatars?|sponsor(?:ed|s|ship)?|ads?|adverts?|advertisements?|promo(?:tional|tions?)?|tracking|pixels?|spacer)(?:$|[^a-z0-9])/iu;
const DEFAULT_SOCIAL_IMAGE = /^(?:og|opengraph|open[-_]graph|social|share|twitter)(?:[-_]?image|[-_]?card|[-_]default)(?:[-_]\d+x\d+)?\.[a-z0-9]+$/iu;
const IMAGE_CONTEXT = /(?:^|[^a-z0-9])(?:bylines?|metadata|author[-_]?(?:bio|photo|info)|related[-_]?(?:posts|articles)|recommended[-_]?(?:posts|articles))(?:$|[^a-z0-9])/iu;
const normalizeLabel = (value = "") => value.replace(/([a-z])([A-Z])/gu, "$1 $2");

const pixels = (value) => {
  const match = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/iu);
  return match ? Number(match[1]) : null;
};

const isUnsuitableSize = (width, height) => {
  const w = pixels(width);
  const h = pixels(height);
  return (w !== null && w < 120) || (h !== null && h < 80) ||
    (w !== null && h !== null && w > h * 6);
};

const isNonArticlePath = (path) =>
  NON_ARTICLE_IMAGE.test(normalizeLabel(path)) ||
  /\.ico$/iu.test(path) ||
  DEFAULT_SOCIAL_IMAGE.test(path.split("/").at(-1)) ||
  /(?:^|[/_-])(?:default|site[-_]?wide)[-_](?:og|social|share|twitter|thumbnail)(?:[-_.]|$)/iu.test(path);

const wrapsBrandAsset = (url) => {
  let source = url.searchParams.get("image") || url.searchParams.get("img") || "";
  // WordPress social cards carry their source image in a signed JSON payload.
  if (url.pathname === "/_si/" && url.searchParams.has("t")) {
    try {
      const payload = url.searchParams.get("t").split(".")[0].replace(/-/gu, "+").replace(/_/gu, "/");
      source = JSON.parse(atob(payload)).img || "";
    } catch {
      // An unrecognized payload provides no additional image signals.
    }
  }
  try {
    return Boolean(source) && isNonArticlePath(decodeURIComponent(new URL(source, url).pathname));
  } catch {
    return false;
  }
};

export const articleImageUrl = (value, baseUrl, { alt = "", width, height } = {}) => {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const url = new URL(value, baseUrl);
    const path = decodeURIComponent(url.pathname);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      isNonArticlePath(path) ||
      NON_ARTICLE_IMAGE.test(normalizeLabel(alt)) ||
      wrapsBrandAsset(url)
    ) {
      return "";
    }

    const params = url.searchParams;
    const resize = (params.get("resize") || params.get("size") || "").match(/^(\d+)[x,](\d+)$/iu);
    const fileSize = path.match(/[-_](\d+)x(\d+)\.[a-z0-9]+$/iu);
    if (
      isUnsuitableSize(width, height) ||
      isUnsuitableSize(params.get("width") || params.get("w"), params.get("height") || params.get("h")) ||
      (resize && isUnsuitableSize(resize[1], resize[2])) ||
      (fileSize && isUnsuitableSize(fileSize[1], fileSize[2]))
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
};

// The same image can appear in social metadata and in markup with extra quality signals.
export const articleImageKey = (value, baseUrl) => {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
};

const imageAttributes = (image) => ({
  alt: image.getAttribute("alt") || image.getAttribute("title") || "",
  width: image.naturalWidth || image.getAttribute("width"),
  height: image.naturalHeight || image.getAttribute("height")
});

const isNonArticleContext = (image) => {
  for (let node = image; node?.getAttribute; node = node.parentNode) {
    const tag = node.tagName?.toLowerCase();
    const labels = normalizeLabel(
      [node.getAttribute("id"), node.getAttribute("class"), node.getAttribute("aria-label")].join(" ")
    );
    if (
      ["aside", "footer", "nav", "noscript", "template"].includes(tag) ||
      node.hasAttribute("hidden") ||
      NON_ARTICLE_IMAGE.test(labels) ||
      IMAGE_CONTEXT.test(labels) ||
      /(?:^|\s)(?:sponsored|author)(?:\s|$)/iu.test(node.getAttribute("rel") || "") ||
      (tag === "figure" && /^\s*(?:advertisement|sponsored by|paid promotion)\b/iu.test(
        node.querySelector("figcaption")?.textContent || ""
      )) ||
      (tag === "table" && /^\s*(?:by\s|in\s)/iu.test(node.textContent) && node.textContent.length <= 140)
    ) {
      return true;
    }
  }
  return false;
};

export const articleImageSources = (image) =>
  ["src", "data-src", "data-original"].map((name) => image.getAttribute(name)).filter(Boolean);

export const articleImageSourceUrl = (image, source, baseUrl) =>
  isNonArticleContext(image) ? "" : articleImageUrl(source, baseUrl, imageAttributes(image));

const articleImageFromElement = (image, baseUrl, rejected) =>
  articleImageSources(image)
    .map((source) => articleImageSourceUrl(image, source, baseUrl))
    .find((url) => url && !rejected?.has(articleImageKey(url))) || "";

export const firstArticleImage = (root, baseUrl, rejected, selector = "img") => {
  for (const image of root.querySelectorAll(selector)) {
    const url = articleImageFromElement(image, baseUrl, rejected);
    if (url) return url;
  }
  return "";
};
