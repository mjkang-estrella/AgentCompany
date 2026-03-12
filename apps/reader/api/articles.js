import { getReaderService } from "../lib/runtime.mjs";
import { jsonResponse, methodNotAllowed, toInt, withErrorHandling } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    return withErrorHandling(async () => {
      const url = new URL(request.url);
      const service = await getReaderService();
      const articles = await service.listArticles({
        folder: url.searchParams.get("folder") || "",
        scope: url.searchParams.get("scope") || "all",
        timezoneOffsetMinutes: toInt(url.searchParams.get("tzOffsetMinutes"))
      });

      return jsonResponse({ articles });
    });
  }
};
