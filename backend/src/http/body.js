const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

export function readRequestBody(req, options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_MAX_BODY_BYTES;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413, code: "body_too_large" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
