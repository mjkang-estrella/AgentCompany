"use node";

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

import {
  buildDigestPrompt,
  getDigestModel,
  getDigestTimezone,
  getOpenAiApiKey,
  getTimeZoneDateKey,
  getTimeZoneDateKeysForTimestamps,
  getTimeZoneDayRange,
  getTimeZoneHour,
  mergeDigestOutput
} from "../lib/daily-digest.mjs";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DIGEST_GENERATION_HOUR = 7;

const summarizeDigest = async ({ localDate, sections }) => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("Missing required environment variable: OPENAI_API_KEY");
  }

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: "You write concise daily digests for a private RSS reader and always return valid JSON."
        },
        {
          role: "user",
          content: buildDigestPrompt({ localDate, sections })
        }
      ],
      model: getDigestModel(),
      response_format: { type: "json_object" },
      temperature: 0.3
    }),
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    throw new Error(`OpenAI digest request failed (${response.status})`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "";
  if (!content) {
    throw new Error("OpenAI digest response was empty");
  }

  return mergeDigestOutput({
    rawText: content,
    sections
  });
};

const toPersistedSections = (sections) =>
  sections.map((section) => ({
    articles: section.articles.map((article) => ({
      author: article.author || "",
      id: article.id,
      previewText: article.previewText || "",
      publishedAt: article.publishedAt,
      subtitle: article.subtitle || "",
      title: article.title,
      url: article.url
    })),
    feedGroup: section.feedGroup || "",
    feedIconUrl: section.feedIconUrl || "",
    feedKey: section.feedKey,
    feedTitle: section.feedTitle,
    summary: section.summary
  }));

export const generateForDate = internalAction({
  args: {
    localDate: v.string(),
    timezone: v.string()
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.digest.upsertDigestStatus, {
      localDate: args.localDate,
      status: "running",
      timezone: args.timezone
    });

    try {
      const inputs = await ctx.runQuery(internal.digest.collectDigestInputs, {
        localDate: args.localDate,
        timezone: args.timezone
      });

      if (inputs.articleCount === 0) {
        await ctx.runMutation(internal.digest.saveGeneratedDigest, {
          articleCount: 0,
          articleIds: [],
          intro: "No new feed articles arrived for this morning’s digest.",
          localDate: args.localDate,
          sections: [],
          timezone: args.timezone
        });

        return {
          articleCount: 0,
          localDate: args.localDate,
          status: "ready"
        };
      }

      const summary = await summarizeDigest({
        localDate: args.localDate,
        sections: inputs.sections
      });

      await ctx.runMutation(internal.digest.saveGeneratedDigest, {
        articleCount: inputs.articleCount,
        articleIds: inputs.articleIds,
        intro: summary.intro,
        localDate: args.localDate,
        sections: toPersistedSections(summary.sections),
        timezone: args.timezone
      });

      return {
        articleCount: inputs.articleCount,
        localDate: args.localDate,
        status: "ready"
      };
    } catch (error) {
      await ctx.runMutation(internal.digest.upsertDigestStatus, {
        error: error instanceof Error ? error.message : String(error),
        localDate: args.localDate,
        status: "failed",
        timezone: args.timezone
      });
      throw error;
    }
  }
});

export const ensureScheduledDigest = internalAction({
  args: {},
  handler: async (ctx) => {
    const timezone = getDigestTimezone();
    if (getTimeZoneHour(timezone) !== DIGEST_GENERATION_HOUR) {
      return { skipped: true, reason: "outside-window" };
    }

    const localDate = getTimeZoneDateKey(timezone);
    const existing = await ctx.runQuery(internal.digest.getByDate, {
      localDate,
      timezone
    });

    if (existing && ["pending", "running", "ready"].includes(existing.status)) {
      return { localDate, skipped: true, status: existing.status };
    }

    await ctx.runMutation(internal.digest.upsertDigestStatus, {
      localDate,
      status: "pending",
      timezone
    });
    await ctx.runAction(internal.digestNode.generateForDate, {
      localDate,
      timezone
    });

    return { localDate, skipped: false, status: "ready" };
  }
});

export const refreshDigestsFromPublishedAt = internalAction({
  args: {
    publishedAtValues: v.array(v.number())
  },
  handler: async (ctx, args) => {
    if (!getOpenAiApiKey()) {
      return { refreshed: false, reason: "missing-openai-api-key" };
    }

    const timezone = getDigestTimezone();
    const localDates = getTimeZoneDateKeysForTimestamps(timezone, args.publishedAtValues);

    if (localDates.length === 0) {
      return { refreshed: false, reason: "no-article-dates" };
    }

    const results = [];

    for (const localDate of localDates) {
      const existing = await ctx.runQuery(internal.digest.getByDate, {
        localDate,
        timezone
      });

      if (existing && ["pending", "running"].includes(existing.status)) {
        results.push({ localDate, refreshed: false, reason: "already-running" });
        continue;
      }

      await ctx.runAction(internal.digestNode.generateForDate, {
        localDate,
        timezone
      });

      results.push({ localDate, refreshed: true });
    }

    return {
      localDates,
      refreshed: results.some((result) => result.refreshed),
      results
    };
  }
});
