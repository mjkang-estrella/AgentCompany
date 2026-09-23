"use node";

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

import {
  buildSummaryPrompt,
  buildSummarySource,
  getSummaryModel,
  parseSummaryOutput
} from "../lib/article-summary.mjs";
import { getOpenAiApiKey } from "../lib/daily-digest.mjs";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const SUMMARY_BATCH_LIMIT = 40;
const SUMMARY_CONCURRENCY = 3;

type SummaryInputs = {
  article: {
    author: string;
    feedTitle: string;
    subtitle: string;
    title: string;
  };
  bodyText: string;
};

const summarizeArticle = async (inputs: SummaryInputs) => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("Missing required environment variable: OPENAI_API_KEY");
  }

  const model = getSummaryModel();
  const source = buildSummarySource({
    author: inputs.article.author,
    bodyText: inputs.bodyText,
    feedTitle: inputs.article.feedTitle,
    subtitle: inputs.article.subtitle,
    title: inputs.article.title
  });

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
          content: "You write scan-first summaries of single articles for a private RSS reader and always return valid JSON."
        },
        {
          role: "user",
          content: buildSummaryPrompt(source)
        }
      ],
      model,
      response_format: { type: "json_object" },
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    throw new Error(`OpenAI summary request failed (${response.status})`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "";
  if (!content) {
    throw new Error("OpenAI summary response was empty");
  }

  return {
    model,
    ...parseSummaryOutput(content)
  };
};

const generateOne = async (
  ctx: any,
  articleId: Id<"articles">,
  force: boolean
) => {
  const inputs = await ctx.runQuery(internal.articleSummary.getInputs, { articleId });

  if (!inputs) {
    return { articleId, status: "missing" as const };
  }

  if (!inputs.usable) {
    return { articleId, status: "unavailable" as const };
  }

  if (!force && inputs.isFresh) {
    return { articleId, status: "ready" as const, skipped: true };
  }

  if (!force && inputs.status === "running") {
    return { articleId, status: "running" as const, skipped: true };
  }

  await ctx.runMutation(internal.articleSummary.upsertStatus, {
    articleId,
    sourceHash: inputs.sourceHash,
    status: "running"
  });

  try {
    const summary = await summarizeArticle(inputs);

    await ctx.runMutation(internal.articleSummary.save, {
      articleId,
      gist: summary.gist,
      keyPoints: summary.keyPoints,
      model: summary.model,
      sourceHash: inputs.sourceHash,
      takeaway: summary.takeaway
    });

    return { articleId, status: "ready" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(internal.articleSummary.upsertStatus, {
      articleId,
      error: message,
      sourceHash: inputs.sourceHash,
      status: "failed"
    });

    return { articleId, error: message, status: "failed" as const };
  }
};

export const generateForArticle = internalAction({
  args: {
    articleId: v.id("articles"),
    force: v.optional(v.boolean())
  },
  handler: async (ctx, args) => generateOne(ctx, args.articleId, Boolean(args.force))
});

export const generateForArticles = internalAction({
  args: {
    articleIds: v.array(v.id("articles")),
    force: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    if (!getOpenAiApiKey()) {
      return { processed: 0, reason: "missing-openai-api-key", skipped: true };
    }

    const uniqueIds = [...new Set(args.articleIds.map(String))] as Id<"articles">[];
    const batch = uniqueIds.slice(0, SUMMARY_BATCH_LIMIT);
    const remainder = uniqueIds.slice(SUMMARY_BATCH_LIMIT);
    const results: Awaited<ReturnType<typeof generateOne>>[] = [];

    for (let index = 0; index < batch.length; index += SUMMARY_CONCURRENCY) {
      const chunk = batch.slice(index, index + SUMMARY_CONCURRENCY);
      results.push(
        ...(await Promise.all(chunk.map((articleId) => generateOne(ctx, articleId, Boolean(args.force)))))
      );
    }

    if (remainder.length > 0) {
      await ctx.scheduler.runAfter(0, internal.articleSummaryNode.generateForArticles, {
        articleIds: remainder,
        force: args.force
      });
    }

    return {
      failed: results.filter((result) => result.status === "failed").length,
      processed: results.length,
      ready: results.filter((result) => result.status === "ready" && !("skipped" in result && result.skipped)).length,
      rescheduled: remainder.length,
      skipped: false
    };
  }
});
