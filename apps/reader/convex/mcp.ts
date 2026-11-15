import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { readTool } from "../lib/mcp-data.mjs";

// JSON stays behind an internal boundary; readTool strictly validates each schema.
export const read = internalQuery({
  args: { name: v.string(), argumentsJson: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => JSON.stringify(await readTool(ctx.db, args.name, JSON.parse(args.argumentsJson)))
});
