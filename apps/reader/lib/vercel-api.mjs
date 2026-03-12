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

export const readJsonBody = async (request) => {
  const body = await request.text();
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
};

export const toInt = (value, fallback = 0) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
};

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
