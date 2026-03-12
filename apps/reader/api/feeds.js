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
      const feed = await service.addFeed({
        folder: body.folder || "",
        inputUrl: body.inputUrl
      });

      let syncError = "";
      try {
        await service.triggerSync(feed.id);
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
      }

      return jsonResponse({ feed, syncError }, 201);
    });
  }
};
