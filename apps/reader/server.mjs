import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { getSupabaseAdminKey, loadEnvFiles, requireEnv } from "./lib/env.mjs";
import { json, readJsonBody, text } from "./lib/http.mjs";
import { createReaderService } from "./lib/reader-service.mjs";

const appDir = fileURLToPath(new URL(".", import.meta.url));
await loadEnvFiles(appDir);

const port = Number(process.env.PORT || 4173);
const staticRoot = appDir;
const routes = {
  article: new URLPattern({ pathname: "/api/articles/:id" }),
  feedSync: new URLPattern({ pathname: "/api/feeds/:id/sync" })
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

let readerService = null;

const getReaderService = () => {
  if (!readerService) {
    const env = requireEnv("SUPABASE_URL");
    readerService = createReaderService({
      serviceRoleKey: getSupabaseAdminKey(),
      url: env.SUPABASE_URL
    });
  }

  return readerService;
};

const serveStatic = async (response, pathname) => {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(staticRoot, relativePath));

  if (!filePath.startsWith(staticRoot)) {
    text(response, 403, "Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    text(
      response,
      200,
      body,
      contentTypes[extname(filePath)] || "application/octet-stream"
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      text(response, 404, "Not found");
      return;
    }

    throw error;
  }
};

const toInt = (value, fallback = 0) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
};

const sendError = (response, statusCode, error) => {
  json(response, statusCode, {
    error: error instanceof Error ? error.message : String(error)
  });
};

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${port}`}`);

  try {
    if (!url.pathname.startsWith("/api/")) {
      await serveStatic(response, url.pathname);
      return;
    }

    const service = getReaderService();

    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      const payload = await service.bootstrap({
        folder: url.searchParams.get("folder") || "",
        scope: url.searchParams.get("scope") || "all",
        selectedArticleId: url.searchParams.get("selectedArticleId") || "",
        timezoneOffsetMinutes: toInt(url.searchParams.get("tzOffsetMinutes"))
      });
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/articles") {
      const payload = await service.listArticles({
        folder: url.searchParams.get("folder") || "",
        scope: url.searchParams.get("scope") || "all",
        timezoneOffsetMinutes: toInt(url.searchParams.get("tzOffsetMinutes"))
      });
      json(response, 200, { articles: payload });
      return;
    }

    const articleMatch = routes.article.exec(url);
    if (articleMatch && request.method === "GET") {
      const article = await service.getArticle(articleMatch.pathname.groups.id);
      json(response, 200, article);
      return;
    }

    if (articleMatch && request.method === "PATCH") {
      const body = await readJsonBody(request);
      const article = await service.updateArticle(articleMatch.pathname.groups.id, {
        isRead: body.isRead,
        isSaved: body.isSaved
      });
      json(response, 200, article);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/articles/mark-all-read") {
      const body = await readJsonBody(request);
      const result = await service.markAllRead({
        folder: body.folder || "",
        scope: body.scope || "all",
        timezoneOffsetMinutes: toInt(String(body.tzOffsetMinutes ?? 0))
      });
      json(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/feeds") {
      const body = await readJsonBody(request);
      if (!body.inputUrl) {
        sendError(response, 400, new Error("inputUrl is required"));
        return;
      }

      const feed = await service.addFeed({
        folder: body.folder || "",
        inputUrl: body.inputUrl
      });

      let syncError = "";
      try {
        await service.triggerSync(feed.id);
      } catch (error) {
        syncError = error.message;
      }

      json(response, 201, { feed, syncError });
      return;
    }

    const feedSyncMatch = routes.feedSync.exec(url);
    if (feedSyncMatch && request.method === "POST") {
      const result = await service.triggerSync(feedSyncMatch.pathname.groups.id);
      json(response, 200, result);
      return;
    }

    sendError(response, 404, new Error("Route not found"));
  } catch (error) {
    const statusCode =
      error.message?.includes("required") ||
      error.message?.includes("valid JSON") ||
      error.message?.includes("discover") ||
      error.message?.includes("valid RSS")
        ? 400
        : 500;
    sendError(response, statusCode, error);
  }
}).listen(port, () => {
  console.log(`Reader app running at http://127.0.0.1:${port}`);
});
