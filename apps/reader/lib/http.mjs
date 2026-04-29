export const json = (response, statusCode, payload) => {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

export const text = (response, statusCode, body, contentType = "text/plain; charset=utf-8") => {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(body);
};
