export const json = (response, statusCode, payload) => {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

export const text = (response, statusCode, body, contentType = "text/plain; charset=utf-8") => {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(body);
};

export const noContent = (response) => {
  response.writeHead(204);
  response.end();
};

export const readJsonBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
};
