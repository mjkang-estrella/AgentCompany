// Stateless JSON-response variant of MCP Streamable HTTP. No sessions or SSE.
const string = { type: "string", minLength: 1, maxLength: 500 };
const limit = { type: "integer", minimum: 1, maximum: 50 };
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
export const tools = [
  { name: "get_digest", description: "Read a cached daily digest; defaults to today in Reader's digest timezone. Never generates a digest.", inputSchema: schema({ date: { ...string, pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }) },
  { name: "list_articles", description: "Newest articles first. Filters apply to each bounded page; an empty page may still have nextCursor. Keep filters unchanged when continuing. since inclusive, until exclusive (UTC ISO timestamps).", inputSchema: schema({ feed: string, feedGroup: string, source: { type: "string", enum: ["newsletter", "feed", "manual"] }, since: string, until: string, saved: { type: "boolean" }, limit, cursor: { ...string, maxLength: 8192 } }) },
  { name: "get_article", description: "Read metadata and cached AI summary. Optional plain-text body is paginated in characters.", inputSchema: schema({ id: string, includeBody: { type: "boolean" }, bodyOffset: { type: "integer", minimum: 0, maximum: 10000000 }, bodyLimit: { type: "integer", minimum: 1, maximum: 12000 } }, ["id"]) },
  { name: "search_articles", description: "Full-text title search, ranked by relevance. Deleted articles are excluded.", inputSchema: schema({ query: { ...string, maxLength: 200 }, limit }, ["query"]) },
  { name: "list_feeds", description: "List RSS and newsletter feeds, including inactive feeds, with pagination.", inputSchema: schema({ limit, cursor: { ...string, maxLength: 8192 } }) }
].map(tool => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));

export function validateArguments(name, args) {
  const tool = tools.find(tool => tool.name === name);
  if (!tool || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid tool or arguments");
  const { properties, required } = tool.inputSchema;
  if (required.some(key => !(key in args))) throw new Error("Missing required argument");
  for (const [key, value] of Object.entries(args)) {
    const rule = properties[key];
    if (!rule || (rule.type === "integer" ? !Number.isInteger(value) : typeof value !== rule.type)) throw new Error(`Invalid argument: ${key}`);
    if (typeof value === "string" && (!value.trim() || value.length > rule.maxLength || (rule.pattern && !new RegExp(rule.pattern).test(value)))) throw new Error(`Invalid argument: ${key}`);
    if (rule.enum && !rule.enum.includes(value)) throw new Error(`Invalid argument: ${key}`);
    if (typeof value === "number" && (value < rule.minimum || value > rule.maximum)) throw new Error(`Invalid argument: ${key}`);
  }
  if (args.date && (Number.isNaN(Date.parse(args.date)) || new Date(args.date).toISOString().slice(0, 10) !== args.date)) throw new Error("Invalid date");
  for (const key of ["since", "until"]) if (args[key] && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(args[key]) || !Number.isFinite(Date.parse(args[key])))) throw new Error(`Invalid UTC timestamp: ${key}`);
  if (args.since && args.until && Date.parse(args.since) >= Date.parse(args.until)) throw new Error("since must precede until");
  return args;
}

// Native Web Crypto verification compares fixed-length MACs in constant time,
// avoiding secret-dependent string comparison or a JavaScript comparison loop.
export async function tokenMatches(expected, supplied) {
  if (!expected || !supplied) return false;
  const encode = value => new TextEncoder().encode(value);
  const key = await crypto.subtle.importKey("raw", encode("reader-mcp-token-comparison"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, encode(expected));
  return crypto.subtle.verify("HMAC", key, signature, encode(supplied));
}
const versions = ["2025-11-25", "2025-06-18", "2025-03-26"];
export async function handleMcp(request, { token, callTool }) {
  const supplied = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!await tokenMatches(token, supplied)) return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== "https://reader.mj-kang.com" && origin !== new URL(request.url).origin) return new Response("Forbidden origin", { status: 403 });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const version = request.headers.get("mcp-protocol-version");
  if (version && !versions.includes(version)) return new Response("Unsupported protocol version", { status: 400 });
  if (!request.headers.get("content-type")?.includes("application/json")) return new Response("Expected application/json", { status: 415 });
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) return new Response("Accept must include application/json and text/event-stream", { status: 406 });
  const json = value => Response.json(value);
  const error = (id, code, message) => json({ jsonrpc: "2.0", id, error: { code, message } });
  let message;
  try {
    const body = await request.text();
    if (body.length > 32768) return new Response("Request too large", { status: 413 });
    message = JSON.parse(body);
  } catch { return error(null, -32700, "Parse error"); }
  if (!message || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" || ("id" in message && typeof message.id !== "string" && !(typeof message.id === "number" && Number.isFinite(message.id)))) return error(null, -32600, "Invalid Request");
  if (!("id" in message)) return new Response(null, { status: 202 });
  const { id, method, params = {} } = message;
  if (!params || typeof params !== "object" || Array.isArray(params)) return error(id, -32602, "Invalid params");
  let result;
  if (method === "initialize") {
    if (typeof params.protocolVersion !== "string" || !params.clientInfo || !params.capabilities) return error(id, -32602, "Invalid initialization params");
    result = { protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "reader", version: "1.0.0" } };
  } else if (method === "ping") result = {};
  else if (method === "tools/list") result = { tools };
  else if (method === "tools/call") {
    let args;
    try { args = validateArguments(params.name, params.arguments ?? {}); }
    catch (e) { return error(id, -32602, e.message); }
    try { result = { content: [{ type: "text", text: JSON.stringify(await callTool(params.name, args)) }], isError: false }; }
    catch { result = { content: [{ type: "text", text: "Reader lookup failed. Check the article ID/cursor and retry." }], isError: true }; }
  } else return error(id, -32601, "Method not found");
  return json({ jsonrpc: "2.0", id, result });
}
