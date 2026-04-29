const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8"
};

export const jsonResponse = (payload, status = 200, headers = {}) =>
  new Response(JSON.stringify(payload), {
    headers: { ...jsonHeaders, ...headers },
    status
  });

export const methodNotAllowed = (allowedMethods) =>
  jsonResponse(
    { error: `Method not allowed. Use ${allowedMethods.join(", ")}.` },
    405,
    { Allow: allowedMethods.join(", ") }
  );

const errorStatus = (message) =>
  message.includes("required") ||
  message.includes("valid JSON") ||
  message.includes("discover") ||
  message.includes("valid RSS") ||
  message.includes("publishable key")
    ? 400
    : 500;

export const withErrorHandling = async (handler) => {
  try {
    return await handler();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, errorStatus(message));
  }
};
