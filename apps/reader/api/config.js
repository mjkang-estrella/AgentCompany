import { jsonResponse, methodNotAllowed, withErrorHandling } from "../lib/vercel-api.mjs";
import { buildPublicConfig } from "../lib/public-config.mjs";

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    return withErrorHandling(() =>
      jsonResponse(buildPublicConfig())
    );
  }
};
