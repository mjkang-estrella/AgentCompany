import { jsonResponse, methodNotAllowed, withErrorHandling } from "../lib/vercel-api.mjs";

const getConvexUrl = () => {
  const value =
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    "";

  if (!value) {
    throw new Error("Missing required environment variable: CONVEX_URL");
  }

  return value;
};

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    return withErrorHandling(() =>
      jsonResponse({
        convexUrl: getConvexUrl()
      })
    );
  }
};
