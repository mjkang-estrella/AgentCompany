const normalizePart = (value) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();

const simpleHash = (value) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const hashArticleContent = ({
  author = "",
  bodyHtml = "",
  canonicalUrl = "",
  previewText = "",
  publishedAt = 0,
  summaryHtml = "",
  thumbnailUrl = "",
  title = "",
  url = ""
}) =>
  simpleHash(
    [
      normalizePart(title),
      normalizePart(author),
      normalizePart(canonicalUrl || url),
      String(publishedAt || 0),
      normalizePart(previewText),
      normalizePart(thumbnailUrl),
      normalizePart(bodyHtml),
      normalizePart(summaryHtml)
    ].join("\n")
  );
