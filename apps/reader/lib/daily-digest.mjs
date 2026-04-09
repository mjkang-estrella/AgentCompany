const DEFAULT_DIGEST_MODEL = "gpt-4.1-mini";
const DEFAULT_DIGEST_TIMEZONE = "America/Los_Angeles";

const getFormatter = (timezone, options) =>
  new Intl.DateTimeFormat("en-CA", {
    hour12: false,
    timeZone: timezone,
    ...options
  });

export const getDigestTimezone = () =>
  globalThis.process?.env?.READER_DIGEST_TIMEZONE || DEFAULT_DIGEST_TIMEZONE;

export const getDigestModel = () =>
  globalThis.process?.env?.READER_DIGEST_MODEL || DEFAULT_DIGEST_MODEL;

export const getOpenAiApiKey = () => globalThis.process?.env?.OPENAI_API_KEY || "";

export const getTimeZoneParts = (timezone, date = new Date()) => {
  const parts = getFormatter(timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);

  const valueFor = (type) => parts.find((part) => part.type === type)?.value || "";

  return {
    year: Number(valueFor("year")),
    month: Number(valueFor("month")),
    day: Number(valueFor("day")),
    hour: Number(valueFor("hour")),
    minute: Number(valueFor("minute")),
    second: Number(valueFor("second"))
  };
};

const getTimeZoneOffsetMinutes = (timezone, date = new Date()) => {
  const parts = getTimeZoneParts(timezone, date);
  const reconstructedUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return Math.round((reconstructedUtc - date.getTime()) / 60_000);
};

const getUtcTimestampForTimeZoneLocalTime = (timezone, year, month, day, hour = 0) => {
  const utcGuess = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  const offsetMinutes = getTimeZoneOffsetMinutes(timezone, new Date(utcGuess));
  return utcGuess - offsetMinutes * 60_000;
};

export const getTimeZoneDateKey = (timezone, date = new Date()) => {
  const parts = getTimeZoneParts(timezone, date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};

export const getTimeZoneHour = (timezone, date = new Date()) =>
  getTimeZoneParts(timezone, date).hour;

export const getTimeZoneDayRange = (timezone, date = new Date()) => {
  const parts = getTimeZoneParts(timezone, date);
  const start = getUtcTimestampForTimeZoneLocalTime(
    timezone,
    parts.year,
    parts.month,
    parts.day,
    0
  );
  const end = getUtcTimestampForTimeZoneLocalTime(
    timezone,
    parts.year,
    parts.month,
    parts.day + 1,
    0
  );

  return { start, end };
};

export const formatDigestDateLabel = (localDate) => {
  if (!localDate) {
    return "";
  }

  const [year, month, day] = String(localDate).split("-").map(Number);
  if (!year || !month || !day) {
    return localDate;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

export const shiftLocalDate = (localDate, dayOffset) => {
  const [year, month, day] = String(localDate).split("-").map(Number);
  if (!year || !month || !day || !Number.isFinite(dayOffset)) {
    return localDate;
  }

  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + dayOffset);

  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
};

export const groupDigestInputs = (articles) => {
  const groups = [];
  const byFeed = new Map();

  for (const article of articles) {
    const feedKey = article.feedId || `${article.feedTitle}::${article.feedGroup || ""}`;

    let group = byFeed.get(feedKey);
    if (!group) {
      group = {
        articles: [],
        feedGroup: article.feedGroup || "",
        feedIconUrl: article.feedIconUrl || "",
        feedKey,
        feedTitle: article.feedTitle
      };
      byFeed.set(feedKey, group);
      groups.push(group);
    }

    group.articles.push({
      author: article.author || "",
      bodyExcerpt: article.bodyExcerpt || "",
      id: article.id,
      previewText: article.previewText || "",
      publishedAt: article.publishedAt,
      subtitle: article.subtitle || "",
      title: article.title,
      url: article.url
    });
  }

  return groups;
};

export const buildDigestPrompt = ({ localDate, sections }) => {
  const payload = {
    localDate,
    sections: sections.map((section) => ({
      articles: section.articles.map((article) => ({
        author: article.author,
        bodyExcerpt: article.bodyExcerpt,
        previewText: article.previewText,
        publishedAt: article.publishedAt,
        subtitle: article.subtitle,
        title: article.title
      })),
      feedTitle: section.feedTitle,
      key: section.feedKey
    }))
  };

  return [
    "You are writing a detailed daily digest for a private RSS reader.",
    "Return strict JSON with this shape only:",
    '{"intro":"string","sections":[{"key":"string","summary":"string"}]}',
    "Rules:",
    "- Keep the intro to 2-3 sentences and make it informative, not terse.",
    "- Write one full paragraph per feed section.",
    "- Each section summary should capture the key argument, the important supporting details, and any notable implications or stakes from the included articles.",
    "- Prefer 4-7 sentences for each section when the source material supports it.",
    "- If a feed has only one article, still write a full paragraph that fully summarizes that article instead of a short blurb.",
    "- Use the body excerpts as the primary evidence source whenever they are present.",
    "- Mention concrete details from the excerpts instead of paraphrasing at a high level only.",
    "- Start each section summary with the substance of the argument or news itself, not with framing like 'X discusses', 'Y provides', or 'Feed Z published'.",
    "- Mention the author or publication only when it is necessary context, not as the opening subject of the paragraph.",
    "- Do not mention that this is AI-generated.",
    "- Do not use markdown, bullets, or code fences.",
    "- Use only the provided article metadata and previews.",
    "",
    JSON.stringify(payload)
  ].join("\n");
};

const stripCodeFence = (value) =>
  String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();

const fallbackSectionSummary = (section) => {
  const count = section.articles.length;
  const articles = section.articles.slice(0, 3);
  const titles = articles.map((article) => article.title).filter(Boolean);
  const preview = articles
    .map((article) => article.previewText)
    .filter(Boolean)
    .join(" ")
    .trim();
  if (titles.length === 0) {
    return preview || `There ${count === 1 ? "was" : "were"} ${count} new article${count === 1 ? "" : "s"} in this section today.`;
  }

  if (titles.length === 1) {
    return preview || titles[0];
  }

  if (titles.length === 2) {
    return preview || `${titles[0]} and ${titles[1]}.`;
  }

  return preview || `${titles[0]}, ${titles[1]}, and ${titles[2]}.`;
};

const fallbackIntro = (sections) => {
  const articleCount = sections.reduce((sum, section) => sum + section.articles.length, 0);
  return `Today's digest covers ${sections.length} feed${sections.length === 1 ? "" : "s"} and ${articleCount} article${articleCount === 1 ? "" : "s"}.`;
};

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const stripLeadingAttribution = (summary, section) => {
  const text = String(summary || "").trim();
  if (!text) {
    return "";
  }

  const author = String(section.articles?.[0]?.author || "").trim();
  const feedTitle = String(section.feedTitle || "").trim();
  const candidates = [
    author && feedTitle ? `${author} from ${feedTitle}` : "",
    feedTitle,
    author
  ].filter(Boolean);

  for (const candidate of candidates) {
    const pattern = new RegExp(
      `^${escapeRegExp(candidate)}\\s+(provides|discusses|explains|argues|examines|explores|covers|outlines|shares|details)\\s+`,
      "iu"
    );
    if (pattern.test(text)) {
      const stripped = text.replace(pattern, "");
      return stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
  }

  return text;
};

export const mergeDigestOutput = ({ rawText, sections }) => {
  const parsed = JSON.parse(stripCodeFence(rawText));
  const summaries = new Map(
    Array.isArray(parsed.sections)
      ? parsed.sections
        .filter((section) => section && typeof section.key === "string")
        .map((section) => [section.key, String(section.summary || "").trim()])
      : []
  );

  return {
    intro: String(parsed.intro || "").trim() || fallbackIntro(sections),
    sections: sections.map((section) => ({
      ...section,
      summary: stripLeadingAttribution(
        summaries.get(section.feedKey) || fallbackSectionSummary(section),
        section
      )
    }))
  };
};
