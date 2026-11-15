import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { handleMcp } from "../lib/mcp.mjs";

const http = httpRouter();
const mcp = httpAction(async (ctx, request) => handleMcp(request, {
  token: process.env.READER_MCP_TOKEN,
  callTool: async (name: string, args: Record<string, unknown>) => JSON.parse(
    await ctx.runQuery(internal.mcp.read, { name, argumentsJson: JSON.stringify(args) })
  )
}));
for (const method of ["POST", "GET", "DELETE", "PUT", "PATCH", "OPTIONS"] as const) {
  http.route({ path: "/mcp", method, handler: mcp });
}
export default http;
