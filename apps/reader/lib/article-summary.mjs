import { hashArticleContent } from "./content-hash.mjs";

const DEFAULT_SUMMARY_MODEL = "gpt-4.1-mini";
export const SUMMARY_BODY_CHAR_LIMIT = 40_000;
export const SUMMARY_MAX_KEY_POINTS = 6;
export const SUMMARY_MIN_BODY_CHARS = 40;
const TRUNCATION_MARKER = "\n\n[Article text truncated for length.]";

const normalizeWhitespace = (value) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();

export const getSummaryModel = () =>
  globalThis.process?.env?.READER_SUMMARY_MODEL ||
  globalThis.process?.env?.READER_DIGEST_MODEL ||
  DEFAULT_SUMMARY_MODEL;

export const buildSummarySourceHash = ({ bodyHtml = "", title = "" }) =>
  hashArticleContent({ bodyHtml, title });

export const buildSummarySource = ({
  author = "",
  bodyText = "",
  feedTitle = "",
  subtitle = "",
  title = ""
}) => {
  const text = normalizeWhitespace(bodyText);
  const truncated = text.length > SUMMARY_BODY_CHAR_LIMIT;

  return {
    author: normalizeWhitespace(author),
    bodyText: truncated
      ? `${text.slice(0, SUMMARY_BODY_CHAR_LIMIT)}${TRUNCATION_MARKER}`
      : text,
    feedTitle: normalizeWhitespace(feedTitle),
    subtitle: normalizeWhitespace(subtitle),
    title: normalizeWhitespace(title),
    truncated
  };
};

export const buildSummaryPrompt = (source) =>
  [
    "You are helping a reader decide whether and how to read an article in a private RSS reader.",
    "Write a scan-first summary so they can grasp the whole piece before reading it in full.",
    "Return strict JSON with this shape only:",
    '{"gist":"string","keyPoints":["string"],"takeaway":"string"}',
    "Rules:",
    "- gist: 1-2 sentences stating the core claim or news itself, not what the article is about.",
    `- keyPoints: 3-${SUMMARY_MAX_KEY_POINTS} short points that follow the article's own order, so the list reads like a map of the argument. Each point is one sentence with concrete details (names, numbers, examples) from the text.`,
    "- takeaway: one sentence on why this matters or what the reader should do with it. Leave it an empty string if the article is purely informational and no takeaway is warranted.",
    "- Start with the substance, never with framing like 'The article discusses' or 'The author argues'.",
    "- Mention the author or publication only when it is essential context.",
    "- Do not mention that this is AI-generated.",
    "- Do not use markdown, bullets, numbering, or code fences inside strings.",
    "- Use only the provided text. If the text is truncated, summarize what is present without guessing the rest.",
    "",
    JSON.stringify({
      author: source.author || undefined,
      feedTitle: source.feedTitle || undefined,
      subtitle: source.subtitle || undefined,
      text: source.bodyText,
      title: source.title,
      truncated: source.truncated || undefined
    })
  ].join("\n");

const stripCodeFence = (value) =>
  String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();

const stripListPrefix = (value) =>
  normalizeWhitespace(value).replace(/^(?:[-*•]|\d+[.)])\s+/u, "");

export const parseSummaryOutput = (rawText) => {
  const parsed = JSON.parse(stripCodeFence(rawText));
  const gist = normalizeWhitespace(parsed?.gist);
  if (!gist) {
    throw new Error("Summary response did not include a gist");
  }

  const rawPoints = Array.isArray(parsed?.keyPoints)
    ? parsed.keyPoints
    : typeof parsed?.keyPoints === "string"
      ? [parsed.keyPoints]
      : [];
  const keyPoints = rawPoints
    .map(stripListPrefix)
    .filter(Boolean)
    .slice(0, SUMMARY_MAX_KEY_POINTS);

  return {
    gist,
    keyPoints,
    takeaway: normalizeWhitespace(parsed?.takeaway)
  };
};
