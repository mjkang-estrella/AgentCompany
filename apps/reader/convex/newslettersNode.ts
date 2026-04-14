"use node";

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

import { hashArticleContent } from "../lib/content-hash.mjs";
import {
  NEWSLETTER_LABEL_INGESTED,
  NEWSLETTER_LABEL_PARSED_V2,
  NEWSLETTER_LABEL_UNREAD,
  buildNewsletterImport,
  buildNewsletterInboxCreateArgs,
  getAgentMailApiKey,
  getNewsletterInboxEmail
} from "../lib/newsletters.mjs";
import { buildArticleQueryFields } from "./readerStats";

const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";
const MAX_NEWSLETTER_MESSAGES = 25;

const buildAgentMailUrl = (pathname, searchParams) => {
  const url = new URL(`${AGENTMAIL_API_BASE}${pathname}`);

  if (searchParams) {
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.append(key, value);
    }
  }

  return url.toString();
};

const agentmailFetch = async ({
  body,
  method = "GET",
  pathname,
  searchParams
}) => {
  const apiKey = getAgentMailApiKey();
  if (!apiKey) {
    throw new Error("Missing required environment variable: AGENTMAIL_API_KEY");
  }

  const response = await fetch(buildAgentMailUrl(pathname, searchParams), {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    method
  });

  const payloadText = await response.text();
  let payload;

  try {
    payload = payloadText ? JSON.parse(payloadText) : {};
  } catch {
    payload = { error: payloadText };
  }

  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : payloadText.slice(0, 300);
    const error = new Error(
      `AgentMail request failed (${response.status}): ${message || response.statusText}`
    );
    error.status = response.status;
    throw error;
  }

  return payload;
};

const ensureInbox = async ({ createIfMissing, inboxEmail }) => {
  try {
    return await agentmailFetch({
      pathname: `/inboxes/${encodeURIComponent(inboxEmail)}`
    });
  } catch (error) {
    if (error?.status !== 404 || !createIfMissing) {
      throw error;
    }

    return agentmailFetch({
      body: buildNewsletterInboxCreateArgs(inboxEmail),
      method: "POST",
      pathname: "/inboxes"
    });
  }
};

const listCandidateMessages = async (inboxEmail) => {
  const searchParams = new URLSearchParams();
  searchParams.append("limit", String(MAX_NEWSLETTER_MESSAGES));

  const payload = await agentmailFetch({
    pathname: `/inboxes/${encodeURIComponent(inboxEmail)}/messages`,
    searchParams
  });

  return Array.isArray(payload.messages) ? payload.messages : [];
};

const getMessage = async (inboxEmail, messageId) =>
  agentmailFetch({
    pathname: `/inboxes/${encodeURIComponent(inboxEmail)}/messages/${encodeURIComponent(messageId)}`
  });

const markMessageIngested = async (inboxEmail, messageId) =>
  agentmailFetch({
    body: {
      add_labels: [NEWSLETTER_LABEL_INGESTED, NEWSLETTER_LABEL_PARSED_V2],
      remove_labels: [NEWSLETTER_LABEL_UNREAD]
    },
    method: "PATCH",
    pathname: `/inboxes/${encodeURIComponent(inboxEmail)}/messages/${encodeURIComponent(messageId)}`
  });

export const syncInbox = internalAction({
  args: {
    createIfMissing: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const inboxEmail = getNewsletterInboxEmail();
    const startedAt = Date.now();

    await ctx.runMutation(internal.newsletters.upsertSyncState, {
      inboxEmail,
      lastError: undefined,
      lastImportedCount: 0,
      lastProcessedCount: 0,
      status: "running"
    });

    try {
      await ensureInbox({
        createIfMissing: args.createIfMissing ?? true,
        inboxEmail
      });

      const recentMessages = await listCandidateMessages(inboxEmail);
      const syncMessages = recentMessages.filter((message: any) => {
        const labels = Array.isArray(message?.labels) ? message.labels : [];
        return labels.includes(NEWSLETTER_LABEL_UNREAD) || !labels.includes(NEWSLETTER_LABEL_PARSED_V2);
      });

      if (syncMessages.length === 0) {
        await ctx.runMutation(internal.newsletters.upsertSyncState, {
          inboxEmail,
          lastError: undefined,
          lastImportedCount: 0,
          lastProcessedCount: 0,
          lastSyncedAt: startedAt,
          status: "idle"
        });

        return {
          imported: 0,
          inboxEmail,
          processed: 0,
          status: "idle"
        };
      }

      const feedIds = new Map();
      const articles = [];
      const ingestedMessageIds = [];
      let latestMessageTimestamp = 0;
      let processed = 0;

      for (const unreadMessage of syncMessages) {
        const messageId = unreadMessage?.message_id;
        if (!messageId) {
          continue;
        }

        const message = await getMessage(inboxEmail, messageId);
        const normalized = buildNewsletterImport(message);
        processed += 1;

        if (!normalized) {
          try {
            await markMessageIngested(inboxEmail, messageId);
          } catch {
            // Best effort: dedupe still protects us on the next run.
          }
          continue;
        }

        let feedId = feedIds.get(normalized.feed.key);
        if (!feedId) {
          feedId = await ctx.runMutation(internal.newsletters.ensureNewsletterFeed, normalized.feed);
          feedIds.set(normalized.feed.key, feedId);
        }
        const queryFields = buildArticleQueryFields({
          feedTitle: normalized.feed.title,
          publishedAt: normalized.article.publishedAt,
          sourceType: "feed"
        });

        articles.push({
          ...normalized.article,
          contentHash: hashArticleContent({
            author: normalized.article.author || "",
            bodyHtml: normalized.article.bodyHtml,
            canonicalUrl: normalized.article.canonicalUrl,
            previewText: normalized.article.previewText,
            publishedAt: normalized.article.publishedAt,
            summaryHtml: normalized.article.summaryHtml,
            subtitle: normalized.article.subtitle || "",
            thumbnailUrl: normalized.article.thumbnailUrl || "",
            title: normalized.article.title,
            url: normalized.article.url
          }),
          feedId,
          feedIconUrl: undefined,
          feedTitle: normalized.feed.title,
          isYoutube: queryFields.isYoutube,
          publishedDigestDate: queryFields.publishedDigestDate,
          thumbnailUrl: undefined
        });
        ingestedMessageIds.push(messageId);

        latestMessageTimestamp = Math.max(latestMessageTimestamp, normalized.article.publishedAt);
      }

      const result = articles.length > 0
        ? await ctx.runMutation(internal.sync.upsertArticles, { articles })
        : { inserted: 0, skipped: 0, updated: 0 };

      for (const messageId of ingestedMessageIds) {
        try {
          await markMessageIngested(inboxEmail, messageId);
        } catch {
          // Best effort: dedupe still protects us on the next run.
        }
      }

      await ctx.runMutation(internal.newsletters.upsertSyncState, {
        inboxEmail,
        lastError: undefined,
        lastImportedCount: result.inserted + result.updated,
        lastMessageAt: latestMessageTimestamp || undefined,
        lastProcessedCount: processed,
        lastSyncedAt: Date.now(),
        status: "idle"
      });

      if (articles.length > 0 && result.inserted + result.updated > 0) {
        await ctx.runAction(internal.digestNode.refreshDigestsFromPublishedAt, {
          publishedAtValues: articles.map((article) => article.publishedAt)
        });
      }

      return {
        imported: result.inserted + result.updated,
        inboxEmail,
        processed,
        skipped: result.skipped,
        status: "idle"
      };
    } catch (error) {
      await ctx.runMutation(internal.newsletters.upsertSyncState, {
        inboxEmail,
        lastError: error instanceof Error ? error.message : String(error),
        lastProcessedCount: 0,
        lastSyncedAt: Date.now(),
        status: "error"
      });
      throw error;
    }
  }
});
