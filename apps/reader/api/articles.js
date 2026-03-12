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
      const payload = await service.listArticles({
        beforeId: url.searchParams.get("beforeId") || "",
        beforePublishedAt: url.searchParams.get("beforePublishedAt") || "",
        folder: url.searchParams.get("folder") || "",
        limit: toInt(url.searchParams.get("limit")),
        scope: url.searchParams.get("scope") || "all",
        timezoneOffsetMinutes: toInt(url.searchParams.get("tzOffsetMinutes"))
      });

      return jsonResponse(payload);
    });
  }
};
