import { readRequestBody } from "../http/body.js";
import { sendJson } from "../http/json.js";

export function routeUrl(req) {
  return new URL(req.url, "http://127.0.0.1");
}

export function isJsonContentType(contentType) {
  return /\bapplication\/json\b/i.test(String(contentType || ""));
}

export async function readJsonBody(req) {
  if (!isJsonContentType(req.headers["content-type"])) {
    throw Object.assign(new Error("Expected application/json."), {
      statusCode: 415,
      code: "unsupported_media_type",
    });
  }
  try {
    const text = (await readRequestBody(req)).toString("utf8").trim();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (error.code === "unsupported_media_type") throw error;
    throw Object.assign(new Error("Request body must be valid JSON."), {
      statusCode: 400,
      code: "invalid_json",
    });
  }
}

export function sendError(res, statusCode, code, message, details = undefined) {
  sendJson(res, statusCode, {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

