import type { Doc, Id } from "./_generated/dataModel";

type DbContext = {
  db: any;
};

type ArticleBodyInput = {
  articleId: Id<"articles">;
  bodyHtml: string;
  bodySource: "feed" | "fetched";
  summaryHtml: string;
};

export const getArticleBodyDocument = async (
  ctx: DbContext,
  articleId: Id<"articles">
): Promise<Doc<"articleBodies"> | null> =>
  ctx.db
    .query("articleBodies")
    .withIndex("by_article_id", (q: any) => q.eq("articleId", articleId))
    .unique();

export const upsertArticleBodyDocument = async (
  ctx: DbContext,
  body: ArticleBodyInput
) => {
  const existing = await getArticleBodyDocument(ctx, body.articleId);

  if (existing) {
    await ctx.db.patch(existing._id, {
      bodyHtml: body.bodyHtml,
      bodySource: body.bodySource,
      summaryHtml: body.summaryHtml
    });
    return existing._id;
  }

  return ctx.db.insert("articleBodies", body);
};

export const deleteArticleBodyDocument = async (
  ctx: DbContext,
  articleId: Id<"articles">
) => {
  const existing = await getArticleBodyDocument(ctx, articleId);
  if (existing) {
    await ctx.db.delete(existing._id);
  }
};

export const clearLegacyArticleBodyFields = {
  bodyHtml: undefined,
  bodySource: undefined,
  summaryHtml: undefined
} as const;

export const articleBodyHtml = (
  article: Doc<"articles">,
  body: Doc<"articleBodies"> | null
) => body?.bodyHtml || article.bodyHtml || "";

export const articleSummaryHtml = (
  article: Doc<"articles">,
  body: Doc<"articleBodies"> | null
) => body?.summaryHtml || article.summaryHtml || "";

export const articleBodySource = (
  article: Doc<"articles">,
  body: Doc<"articleBodies"> | null
) => body?.bodySource || article.bodySource || "feed";
