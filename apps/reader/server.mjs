import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4173);
const rootDir = fileURLToPath(new URL(".", import.meta.url));

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const send = (response, statusCode, body, contentType) => {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(body);
};

createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(rootDir, relativePath));

  if (!filePath.startsWith(rootDir)) {
    send(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await readFile(filePath);
    send(
      response,
      200,
      file,
      contentTypes[extname(filePath)] || "application/octet-stream"
    );
  } catch (error) {
    if (relativePath !== "index.html") {
      send(response, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    send(response, 500, String(error), "text/plain; charset=utf-8");
  }
}).listen(port, () => {
  console.log(`Reader app running at http://127.0.0.1:${port}`);
});
