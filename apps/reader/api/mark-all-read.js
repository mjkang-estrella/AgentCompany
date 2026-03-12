import { getReaderService } from "../lib/runtime.mjs";
import { jsonResponse, methodNotAllowed, readJsonBody, toInt, withErrorHandling } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return methodNotAllowed(["POST"]);
    }

    return withErrorHandling(async () => {
      const body = await readJsonBody(request);
      const service = await getReaderService();
      const result = await service.markAllRead({
        folder: body.folder || "",
        scope: body.scope || "all",
        timezoneOffsetMinutes: toInt(String(body.tzOffsetMinutes ?? 0))
      });

      return jsonResponse(result);
    });
  }
};
