import { discoverFeedLinks } from "./html.mjs";
import { parseFeed } from "./feed-utils.mjs";

const DEFAULT_HEADERS = {
  "user-agent": "AgentCompany Reader/1.0 (+https://agent.company)"
};

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} (${response.status})`);
  }

  return {
    contentType: response.headers.get("content-type") || "",
    text: await response.text(),
    finalUrl: response.url
  };
};

const commonFeedPaths = ["/feed", "/feed.xml", "/rss", "/rss.xml", "/atom.xml"];

const tryFeedUrl = async (url) => {
  const result = await fetchText(url);
  const parsed = parseFeed(result.text, result.finalUrl);
  return {
    feedUrl: result.finalUrl,
    ...parsed.feed
  };
};

export const resolveFeedInput = async (inputUrl) => {
  const normalizedInput = new URL(inputUrl).toString();

  try {
    const direct = await tryFeedUrl(normalizedInput);
    return {
      faviconUrl: direct.siteUrl ? new URL("/favicon.ico", direct.siteUrl).toString() : "",
      ...direct
    };
  } catch {
    const page = await fetchText(normalizedInput);
    const { feedLinks, faviconUrl, title } = discoverFeedLinks(page.text, page.finalUrl);
    const candidates = [
      ...feedLinks.map((entry) => entry.href),
      ...commonFeedPaths.map((path) => new URL(path, page.finalUrl).toString())
    ];

    const attempted = new Set();

    for (const candidate of candidates) {
      if (attempted.has(candidate)) {
        continue;
      }

      attempted.add(candidate);

      try {
        const feed = await tryFeedUrl(candidate);
        return {
          faviconUrl,
          feedUrl: feed.feedUrl,
          siteUrl: feed.siteUrl || page.finalUrl,
          title: feed.title || title || "Untitled feed"
        };
      } catch {
        // Try the next candidate.
      }
    }
  }

  throw new Error("Could not discover an RSS or Atom feed from that URL");
};
