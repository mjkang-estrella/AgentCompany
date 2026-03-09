import type { MarketReportCitation } from "@/types/workspace";

const EXA_SEARCH_URL = "https://api.exa.ai/search";

interface ExaResult {
  title?: string;
  url?: string;
  publishedDate?: string | null;
  text?: string | null;
  highlights?: string[] | null;
  summary?: string | null;
}

export interface ExaSearchHit {
  title: string;
  url: string;
  domain: string;
  published_date: string | null;
  excerpt: string;
}

export function hasExaKey(): boolean {
  return Boolean(process.env.EXA_API_KEY);
}

export async function searchExa(query: string, numResults = 5): Promise<ExaSearchHit[]> {
  if (!process.env.EXA_API_KEY) {
    throw new Error("EXA_API_KEY is not configured.");
  }

  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.EXA_API_KEY,
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults,
      contents: {
        text: {
          maxCharacters: 2400,
        },
        highlights: {
          numSentences: 3,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Exa search failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as { results?: ExaResult[] };
  const results = Array.isArray(payload.results) ? payload.results : [];

  return results
    .map((item) => normalizeHit(item))
    .filter((item): item is ExaSearchHit => Boolean(item));
}

export function dedupeCitations(hits: ExaSearchHit[]): MarketReportCitation[] {
  const seen = new Set<string>();

  return hits
    .filter((hit) => {
      if (seen.has(hit.url)) {
        return false;
      }
      seen.add(hit.url);
      return true;
    })
    .map((hit) => ({
      title: hit.title,
      url: hit.url,
      domain: hit.domain,
      published_date: hit.published_date,
    }));
}

function normalizeHit(item: ExaResult): ExaSearchHit | null {
  const url = item.url?.trim();
  if (!url) {
    return null;
  }

  const title = item.title?.trim() || url;
  const domain = safeDomain(url);
  const excerpt = buildExcerpt(item);

  return {
    title,
    url,
    domain,
    published_date: item.publishedDate ?? null,
    excerpt,
  };
}

function buildExcerpt(item: ExaResult): string {
  const highlightText = Array.isArray(item.highlights) ? item.highlights.filter(Boolean).join(" ") : "";
  const summary = item.summary?.trim() || "";
  const text = item.text?.trim() || "";
  const candidate = highlightText || summary || text;
  return candidate.slice(0, 900).trim();
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
