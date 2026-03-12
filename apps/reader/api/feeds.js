import { getReaderService } from "../lib/runtime.mjs";
import { jsonResponse, methodNotAllowed, readJsonBody, withErrorHandling } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return methodNotAllowed(["POST"]);
    }

    return withErrorHandling(async () => {
      const body = await readJsonBody(request);
      if (!body.inputUrl) {
        throw new Error("inputUrl is required");
      }

      const service = await getReaderService();
      const result = await service.addFeedAndSync({
        folder: body.folder || "",
        inputUrl: body.inputUrl
      });
      return jsonResponse({ feed: result.feed, sync: result.sync }, 201);
    });
  }
};
