import {
  canonicalizeUrl,
  estimateReadTime,
  extractPageMetadata,
  sanitizeFragment,
  stripHtml
} from "./html.mjs";

const YOUTUBE_HOSTS = new Set([
  "youtu.be",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "www.youtube.com"
]);

const PLAYER_RESPONSE_MARKERS = [
  "var ytInitialPlayerResponse = ",
  "ytInitialPlayerResponse = ",
  "window['ytInitialPlayerResponse'] = ",
  "window[\"ytInitialPlayerResponse\"] = "
];

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/gu, (match) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[match] || match));

const firstNonEmpty = (...values) => values.find((value) => String(value || "").trim()) || "";

const normalizeText = (value) => String(value || "").replace(/\s+/gu, " ").trim();

const renderParagraphs = (text) => {
  const paragraphs = String(text || "")
    .split(/\n\s*\n/gu)
    .map((paragraph) => normalizeText(paragraph))
    .filter(Boolean);

  return sanitizeFragment(paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join(""));
};

const formatTimestamp = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

const getVideoIdFromUrl = (value) => {
  try {
    const url = new URL(String(value));
    const hostname = url.hostname.replace(/^www\./u, "");

    if (!YOUTUBE_HOSTS.has(hostname)) {
      return "";
    }

    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || "";
    }

    if (url.pathname === "/watch") {
      return url.searchParams.get("v") || "";
    }

    const [, resource, id] = url.pathname.split("/");
    if (resource === "shorts" || resource === "embed" || resource === "live") {
      return id || "";
    }

    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
};

export const isYouTubeUrl = (value) => Boolean(getVideoIdFromUrl(value));

const extractBalancedJsonObject = (source, startIndex) => {
  const openingBraceIndex = source.indexOf("{", startIndex);
  if (openingBraceIndex === -1) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let isEscaped = false;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      inString = true;
      stringQuote = character;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openingBraceIndex, index + 1);
      }
    }
  }

  return "";
};

const parsePlayerResponse = (html) => {
  for (const marker of PLAYER_RESPONSE_MARKERS) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }

    const jsonCandidate = extractBalancedJsonObject(html, markerIndex + marker.length);
    if (!jsonCandidate) {
      continue;
    }

    try {
      return JSON.parse(jsonCandidate);
    } catch {
      // Try the next marker.
    }
  }

  return null;
};

const pickBestThumbnailUrl = (...thumbnailLists) => {
  const thumbnails = thumbnailLists
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter((thumbnail) => thumbnail?.url);

  if (!thumbnails.length) {
    return "";
  }

  thumbnails.sort((left, right) => ((right.width || 0) * (right.height || 0)) - ((left.width || 0) * (left.height || 0)));
  return thumbnails[0].url || "";
};

const trackScore = (track) => {
  const languageCode = String(track?.languageCode || "").toLowerCase();
  const name = String(track?.name?.simpleText || "").toLowerCase();
  const vssId = String(track?.vssId || "").toLowerCase();

  let score = 0;
  if (languageCode === "en") score += 30;
  if (languageCode.startsWith("en-")) score += 20;
  if (name.includes("english")) score += 10;
  if (!vssId.includes(".asr")) score += 25;
  if (track?.kind !== "asr") score += 10;
  return score;
};

const pickCaptionTrack = (tracks) =>
  [...tracks]
    .filter((track) => track?.baseUrl)
    .sort((left, right) => trackScore(right) - trackScore(left))[0] || null;

const parseCaptionSegments = (xml) => {
  const segments = [];
  const matcher = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/giu;

  for (const match of xml.matchAll(matcher)) {
    const attributes = match[2] || "";
    const rawText = match[3] || "";
    const startAttributeMatch = attributes.match(/\bstart="([^"]+)"/iu);
    const trackTimeMatch = attributes.match(/\bt="([^"]+)"/iu);
    const startMatch = startAttributeMatch || trackTimeMatch;
    const startValue = startMatch?.[1] || "0";
    const startSeconds = trackTimeMatch
      ? Number(startValue) / 1000
      : Number(startValue);
    const text = normalizeText(
      rawText
        .replace(/<[^>]+>/gu, " ")
        .replace(/&nbsp;/giu, " ")
        .replace(/&#39;/giu, "'")
        .replace(/&quot;/giu, "\"")
        .replace(/&amp;/giu, "&")
        .replace(/&lt;/giu, "<")
        .replace(/&gt;/giu, ">")
    );

    if (!text) {
      continue;
    }

    segments.push({
      startSeconds: Number.isFinite(startSeconds) ? startSeconds : 0,
      text
    });
  }

  return segments;
};

const groupTranscriptSegments = (segments) => {
  const groups = [];
  let current = null;

  for (const segment of segments) {
    if (!current) {
      current = {
        startSeconds: segment.startSeconds,
        textParts: [segment.text]
      };
      continue;
    }

    const currentTextLength = current.textParts.join(" ").length;
    const shouldFlush =
      current.textParts.length >= 4 ||
      currentTextLength >= 260 ||
      segment.startSeconds - current.startSeconds >= 45;

    if (shouldFlush) {
      groups.push({
        startSeconds: current.startSeconds,
        text: normalizeText(current.textParts.join(" "))
      });
      current = {
        startSeconds: segment.startSeconds,
        textParts: [segment.text]
      };
      continue;
    }

    current.textParts.push(segment.text);
  }

  if (current) {
    groups.push({
      startSeconds: current.startSeconds,
      text: normalizeText(current.textParts.join(" "))
    });
  }

  return groups.filter((group) => group.text);
};

const buildTranscriptBodyHtml = ({ description, transcriptGroups, watchUrl }) => {
  const descriptionHtml = renderParagraphs(description);
  const transcriptHtml = transcriptGroups
    .map((group) => `<p><strong>${escapeHtml(formatTimestamp(group.startSeconds))}</strong> ${escapeHtml(group.text)}</p>`)
    .join("");

  return sanitizeFragment(`
    <p><a href="${escapeHtml(watchUrl)}">Watch on YouTube</a></p>
    ${descriptionHtml ? `<h2>Description</h2>${descriptionHtml}` : ""}
    <h2>Transcript</h2>
    ${transcriptHtml}
  `);
};

const buildDescriptionFallbackHtml = ({ description, watchUrl }) => {
  const descriptionHtml = renderParagraphs(description);

  return sanitizeFragment(`
    <p>Transcript unavailable for this video. Reader saved the video description instead.</p>
    <p><a href="${escapeHtml(watchUrl)}">Watch on YouTube</a></p>
    ${descriptionHtml || "<p>No YouTube description was available.</p>"}
  `);
};

const buildSummaryHtml = ({ description, transcriptGroups }) => {
  if (normalizeText(description)) {
    return renderParagraphs(description);
  }

  if (!transcriptGroups.length) {
    return "";
  }

  return sanitizeFragment(`<p>${escapeHtml(transcriptGroups[0].text)}</p>`);
};

export const extractYouTubeArticleFromHtml = async (html, pageUrl, options = {}) => {
  const fetchText = options.fetchText;
  const videoId = getVideoIdFromUrl(pageUrl);
  const playerResponse = parsePlayerResponse(html) || {};
  const videoDetails = playerResponse.videoDetails || {};
  const microformat = playerResponse.microformat?.playerMicroformatRenderer || {};
  const metadata = extractPageMetadata(html, pageUrl);
  const watchUrl = canonicalizeUrl(
    firstNonEmpty(microformat.urlCanonical, videoId ? `https://www.youtube.com/watch?v=${videoId}` : pageUrl)
  );
  const description = firstNonEmpty(
    videoDetails.shortDescription,
    microformat.description?.simpleText,
    metadata.description
  );
  const title = firstNonEmpty(videoDetails.title, microformat.title?.simpleText, metadata.title);
  const author = firstNonEmpty(videoDetails.author, microformat.ownerChannelName, metadata.author);
  const publishedAt = firstNonEmpty(microformat.publishDate, microformat.uploadDate, metadata.publishedAt);
  const thumbnailUrl = firstNonEmpty(
    pickBestThumbnailUrl(videoDetails.thumbnail?.thumbnails, microformat.thumbnail?.thumbnails),
    metadata.thumbnailUrl
  );
  const captionTrack = pickCaptionTrack(
    playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks || []
  );

  let transcriptGroups = [];

  if (captionTrack?.baseUrl && fetchText) {
    try {
      const transcriptXml = await fetchText(captionTrack.baseUrl);
      transcriptGroups = groupTranscriptSegments(parseCaptionSegments(transcriptXml));
    } catch {
      transcriptGroups = [];
    }
  }

  const hasTranscript = transcriptGroups.length > 0;
  const bodyHtml = hasTranscript
    ? buildTranscriptBodyHtml({
        description,
        transcriptGroups,
        watchUrl
      })
    : buildDescriptionFallbackHtml({
        description,
        watchUrl
      });
  const summaryHtml = buildSummaryHtml({
    description,
    transcriptGroups
  }) || sanitizeFragment("<p>Open the original video on YouTube.</p>");
  const previewText = stripHtml(summaryHtml || bodyHtml).slice(0, 220);
  const primaryContentText = hasTranscript
    ? transcriptGroups.map((group) => group.text).join(" ")
    : normalizeText(description);

  return {
    author,
    bodyHtml,
    canonicalUrl: watchUrl,
    previewText,
    publishedAt,
    quality: primaryContentText.length >= 40 ? "usable" : "weak",
    readTimeMinutes: estimateReadTime(bodyHtml || summaryHtml),
    siteName: "YouTube",
    subtitle: hasTranscript ? "" : "Transcript unavailable. Showing the video description instead.",
    summaryHtml,
    thumbnailUrl,
    title,
    transcriptAvailable: hasTranscript
  };
};
