function boundaryFromContentType(contentType) {
  const match = String(contentType || "").match(/multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2] || "").trim() : "";
}

function parseHeaders(headerText) {
  const headers = {};
  headerText.split(/\r\n/).forEach((line) => {
    const index = line.indexOf(":");
    if (index <= 0) return;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  });
  return headers;
}

function parseContentDisposition(value) {
  const result = {};
  String(value || "").split(";").forEach((part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    const key = rawKey.trim().toLowerCase();
    if (!key) return;
    const rawValue = rest.join("=").trim();
    result[key] = rawValue.replace(/^"|"$/g, "");
  });
  return result;
}

function splitParts(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    const next = body.indexOf(delimiter, cursor + delimiter.length);
    if (next < 0) break;
    let part = body.slice(cursor + delimiter.length, next);
    if (part.slice(0, 2).toString("latin1") === "\r\n") part = part.slice(2);
    if (part.slice(0, 2).toString("latin1") === "--") break;
    if (part.slice(-2).toString("latin1") === "\r\n") part = part.slice(0, -2);
    if (part.length) parts.push(part);
    cursor = next;
  }
  return parts;
}

export function parseMultipartFormData(contentType, body) {
  const boundary = boundaryFromContentType(contentType);
  if (!boundary) {
    throw Object.assign(new Error("Expected multipart/form-data with a boundary."), {
      statusCode: 415,
      code: "unsupported_media_type",
    });
  }

  const fields = {};
  const files = [];
  splitParts(body, boundary).forEach((part) => {
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) return;
    const headers = parseHeaders(part.slice(0, headerEnd).toString("latin1"));
    const disposition = parseContentDisposition(headers["content-disposition"]);
    const content = part.slice(headerEnd + 4);
    if (!disposition.name) return;
    if (disposition.filename != null) {
      files.push({
        fieldName: disposition.name,
        filename: disposition.filename,
        contentType: headers["content-type"] || "application/octet-stream",
        buffer: content,
        sizeBytes: content.length,
      });
      return;
    }
    fields[disposition.name] = content.toString("utf8");
  });

  return { fields, files };
}
