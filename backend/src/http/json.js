export function sendJson(res, statusCode, payload) {
  if (res.destroyed || res.writableEnded) return false;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
  return true;
}
