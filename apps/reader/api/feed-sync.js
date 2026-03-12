import { getReaderService } from "../lib/runtime.mjs";
import { jsonResponse, methodNotAllowed, withErrorHandling } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return methodNotAllowed(["POST"]);
    }

    return withErrorHandling(async () => {
      const url = new URL(request.url);
      const feedId = url.searchParams.get("id") || "";
      if (!feedId) {
        throw new Error("id is required");
      }

      const service = await getReaderService();
      return jsonResponse(await service.triggerSync(feedId));
    });
  }
};
