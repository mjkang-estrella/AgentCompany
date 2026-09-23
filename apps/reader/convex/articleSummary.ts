import { v } from "convex/values";

import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

import {
  SUMMARY_MIN_BODY_CHARS,
  buildSummarySourceHash
} from "../lib/article-summary.mjs";
import { getOpenAiApiKey } from "../lib/daily-digest.mjs";
import { stripHtml } from "../lib/html.mjs";
import { articleBodyHtml, getArticleBodyDocument } from "./articleContent";

type DbContext = { db: any };

export const summaryStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("ready"),
  v.literal("failed")
);

export const getArticleSummaryDocument = async (
  ctx: DbContext,
  articleId: Id<"articles">
): Promise<Doc<"articleSummaries"> | null> =>
  ctx.db
    .query("articleSummaries")
    .withIndex("by_article_id", (q: any) => q.eq("articleId", articleId))
    .unique();

export const deleteArticleSummaryDocument = async (
  ctx: DbContext,
  articleId: Id<"articles">
) => {
  const existing = await getArticleSummaryDocument(ctx, articleId);
  if (existing) {
    await ctx.db.delete(existing._id);
  }
};

const describeSource = (article: Doc<"articles">, body: Doc<"articleBodies"> | null) => {
  const bodyHtml = articleBodyHtml(article, body);
  const bodyText = stripHtml(bodyHtml);

  return {
    bodyText,
    sourceHash: buildSummarySourceHash({ bodyHtml, title: article.title }),
    usable: bodyText.length >= SUMMARY_MIN_BODY_CHARS
  };
};

const isFresh = (summary: Doc<"articleSummaries"> | null, sourceHash: string) =>
  Boolean(summary && summary.status === "ready" && summary.sourceHash === sourceHash);

export const summaryIsCurrent = isFresh;

const mapSummary = (summary: Doc<"articleSummaries">, sourceHash: string) => ({
  error: summary.error || "",
  generatedAt: summary.generatedAt ? new Date(summary.generatedAt).toISOString() : "",
  gist: summary.gist,
  isStale: summary.sourceHash !== sourceHash,
  keyPoints: summary.keyPoints,
  model: summary.model,
  status: summary.status,
  takeaway: summary.takeaway
});

export const get = query({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.deletedAt) {
      throw new Error("Article not found");
    }

    const body = await getArticleBodyDocument(ctx, args.articleId);
    const source = describeSource(article, body);
    const summary = await getArticleSummaryDocument(ctx, args.articleId);

    return {
      articleId: args.articleId,
      bodyUsable: source.usable,
      ...(summary
        ? mapSummary(summary, source.sourceHash)
        : {
          error: "",
          generatedAt: "",
          gist: "",
          isStale: false,
          keyPoints: [] as string[],
          model: "",
          status: "missing" as const,
          takeaway: ""
        })
    };
  }
});

export const getState = internalQuery({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.deletedAt) {
      return null;
    }

    const body = await getArticleBodyDocument(ctx, args.articleId);
    const source = describeSource(article, body);
    const summary = await getArticleSummaryDocument(ctx, args.articleId);

    return {
      isFresh: isFresh(summary, source.sourceHash),
      sourceHash: source.sourceHash,
      status: summary?.status || "missing",
      usable: source.usable
    };
  }
});

export const getInputs = internalQuery({
  args: {
    articleId: v.id("articles")
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.deletedAt) {
      return null;
    }

    const body = await getArticleBodyDocument(ctx, args.articleId);
    const source = describeSource(article, body);
    const summary = await getArticleSummaryDocument(ctx, args.articleId);

    return {
      article: {
        author: article.author || "",
        feedTitle: article.feedTitle,
        subtitle: article.subtitle || "",
        title: article.title
      },
      bodyText: source.bodyText,
      isFresh: isFresh(summary, source.sourceHash),
      sourceHash: source.sourceHash,
      status: summary?.status || "missing",
      usable: source.usable
    };
  }
});

export const upsertStatus = internalMutation({
  args: {
    articleId: v.id("articles"),
    error: v.optional(v.string()),
    sourceHash: v.optional(v.string()),
    status: summaryStatusValidator
  },
  handler: async (ctx, args) => {
    const existing = await getArticleSummaryDocument(ctx, args.articleId);

    if (existing) {
      await ctx.db.patch(existing._id, {
        error: args.error,
        status: args.status
      });
      return existing._id;
    }

    return ctx.db.insert("articleSummaries", {
      articleId: args.articleId,
      error: args.error,
      gist: "",
      keyPoints: [],
      model: "",
      sourceHash: args.sourceHash || "",
      status: args.status,
      takeaway: ""
    });
  }
});

export const save = internalMutation({
  args: {
    articleId: v.id("articles"),
    gist: v.string(),
    keyPoints: v.array(v.string()),
    model: v.string(),
    sourceHash: v.string(),
    takeaway: v.string()
  },
  handler: async (ctx, args) => {
    const existing = await getArticleSummaryDocument(ctx, args.articleId);
    const payload = {
      articleId: args.articleId,
      error: undefined,
      generatedAt: Date.now(),
      gist: args.gist,
      keyPoints: args.keyPoints,
      model: args.model,
      sourceHash: args.sourceHash,
      status: "ready" as const,
      takeaway: args.takeaway
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return ctx.db.insert("articleSummaries", payload);
  }
});

export const ensure = action({
  args: {
    articleId: v.id("articles"),
    force: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const state = await ctx.runQuery(internal.articleSummary.getState, {
      articleId: args.articleId
    });

    if (!state) {
      throw new Error("Article not found");
    }

    if (!state.usable) {
      return { articleId: args.articleId, status: "unavailable" as const };
    }

    if (!getOpenAiApiKey()) {
      return {
        articleId: args.articleId,
        reason: "missing-openai-api-key",
        status: "unavailable" as const
      };
    }

    if (!args.force) {
      if (state.isFresh) {
        return { articleId: args.articleId, status: "ready" as const };
      }

      if (state.status === "pending" || state.status === "running") {
        return { articleId: args.articleId, status: state.status };
      }
    }

    await ctx.runMutation(internal.articleSummary.upsertStatus, {
      articleId: args.articleId,
      sourceHash: state.sourceHash,
      status: "pending"
    });
    await ctx.scheduler.runAfter(0, internal.articleSummaryNode.generateForArticle, {
      articleId: args.articleId,
      force: Boolean(args.force)
    });

    return { articleId: args.articleId, status: "pending" as const };
  }
});
