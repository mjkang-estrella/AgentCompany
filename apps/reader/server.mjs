import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { getConvexUrl, loadEnvFiles } from "./lib/env.mjs";
import { json, text } from "./lib/http.mjs";

const appDir = fileURLToPath(new URL(".", import.meta.url));

const port = Number(process.env.PORT || 4173);
const staticRoot = appDir;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
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
      if (!relativePath.includes(".")) {
        const body = await readFile(join(staticRoot, "index.html"));
        text(response, 200, body, "text/html; charset=utf-8");
        return;
      }

      text(response, 404, "Not found");
      return;
    }

    throw error;
  }
};

const sendError = (response, statusCode, error) => {
  json(response, statusCode, {
    error: error instanceof Error ? error.message : String(error)
  });
};

const getNewsletterInboxEmail = () =>
  process.env.READER_NEWSLETTER_INBOX_EMAIL || "news@mj-kang.com";

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${port}`}`);

  try {
    await loadEnvFiles(appDir);

    if (!url.pathname.startsWith("/api/")) {
      await serveStatic(response, url.pathname);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      json(response, 200, {
        convexUrl: getConvexUrl(),
        newsletterInboxEmail: getNewsletterInboxEmail()
      });
      return;
    }

    sendError(response, 404, new Error("Route not found"));
  } catch (error) {
    const statusCode = error.message?.includes("required") ? 400 : 500;
    sendError(response, statusCode, error);
  }
}).listen(port, () => {
  console.log(`Reader app running at http://127.0.0.1:${port}`);
});
