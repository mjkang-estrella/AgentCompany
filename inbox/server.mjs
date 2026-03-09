import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const indexPath = path.join(__dirname, "index.html");
const PORT = Number.parseInt(process.env.PORT || "3210", 10);
const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function html(res, status, content) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(content);
}

async function readAgentMailApiKeyFromFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const match = content.match(/^AGENTMAIL_API_KEY=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

async function getAgentMailApiKey() {
  if (process.env.AGENTMAIL_API_KEY) {
    return process.env.AGENTMAIL_API_KEY;
  }

  const candidates = [
    path.join(__dirname, ".env"),
    path.join(repoRoot, ".env"),
  ];

  for (const filePath of candidates) {
    const apiKey = await readAgentMailApiKeyFromFile(filePath);
    if (apiKey) {
      return apiKey;
    }
  }

  throw new Error("AGENTMAIL_API_KEY is not configured");
}

function buildAgentMailUrl(pathname, searchParams) {
  const url = new URL(`${AGENTMAIL_API_BASE}${pathname}`);

  if (searchParams) {
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.append(key, value);
    }
  }

  return url.toString();
}

async function agentmailFetch(pathname, searchParams) {
  const response = await fetch(buildAgentMailUrl(pathname, searchParams), {
    headers: {
      Authorization: `Bearer ${await getAgentMailApiKey()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = await response.text();
  let parsed;

  try {
    parsed = JSON.parse(payload);
  } catch {
    parsed = { error: payload };
  }

  if (!response.ok) {
    const errorText = typeof parsed.error === "string" ? parsed.error : payload.slice(0, 300);
    throw new Error(`AgentMail request failed (${response.status}): ${errorText}`);
  }

  return parsed;
}

async function handleApi(req, res, url) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname === "/api/agentmail/inboxes") {
    const payload = await agentmailFetch("/inboxes", url.searchParams);
    json(res, 200, payload);
    return;
  }

  const messageDetailMatch = url.pathname.match(
    /^\/api\/agentmail\/inboxes\/([^/]+)\/messages\/([^/]+)$/
  );

  if (messageDetailMatch) {
    const inboxId = decodeURIComponent(messageDetailMatch[1]);
    const messageId = decodeURIComponent(messageDetailMatch[2]);
    const payload = await agentmailFetch(
      `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
      url.searchParams
    );
    json(res, 200, payload);
    return;
  }

  const messageListMatch = url.pathname.match(
    /^\/api\/agentmail\/inboxes\/([^/]+)\/messages$/
  );

  if (messageListMatch) {
    const inboxId = decodeURIComponent(messageListMatch[1]);
    const payload = await agentmailFetch(
      `/inboxes/${encodeURIComponent(inboxId)}/messages`,
      url.searchParams
    );
    json(res, 200, payload);
    return;
  }

  json(res, 404, { error: "Not found" });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      html(res, 200, await readFile(indexPath, "utf8"));
      return;
    }

    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname.startsWith("/api/agentmail/")) {
      await handleApi(req, res, url);
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("[inbox server]", error);
    json(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Inbox server running at http://localhost:${PORT}`);
});
