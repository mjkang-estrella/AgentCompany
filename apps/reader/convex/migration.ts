import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const importFeeds = action({
  args: {
    feeds: v.array(
      v.object({
        feedUrl: v.string(),
        folder: v.string(),
        iconUrl: v.optional(v.string()),
        isActive: v.boolean(),
        siteUrl: v.optional(v.string()),
        title: v.string()
      })
    )
  },
  handler: async (ctx, args) => {
    const imported = [];

    for (const feed of args.feeds) {
      const saved = await ctx.runMutation(internal.feeds.upsertResolvedFeed, feed);
      if (!saved) {
        continue;
      }

      imported.push(saved._id);
      await ctx.scheduler.runAfter(0, internal.sync.runFeed, { feedId: saved._id });
    }

    return {
      imported: imported.length,
      queued: imported.length
    };
  }
});
