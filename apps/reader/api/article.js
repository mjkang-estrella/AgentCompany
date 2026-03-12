import { getReaderService } from "../lib/runtime.mjs";
import { jsonResponse, methodNotAllowed, readJsonBody, withErrorHandling } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    if (!["GET", "PATCH"].includes(request.method)) {
      return methodNotAllowed(["GET", "PATCH"]);
    }

    return withErrorHandling(async () => {
      const url = new URL(request.url);
      const articleId = url.searchParams.get("id") || "";
      if (!articleId) {
        throw new Error("id is required");
      }

      const service = await getReaderService();
      if (request.method === "GET") {
        return jsonResponse(await service.getArticle(articleId));
      }

      const body = await readJsonBody(request);
      return jsonResponse(
        await service.updateArticle(articleId, {
          isRead: body.isRead,
          isSaved: body.isSaved
        })
      );
    });
  }
};
