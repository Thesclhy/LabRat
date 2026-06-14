import { sendJson } from "../../http/json.js";
import { readRequestBody } from "../../http/body.js";
import { parseMultipartFormData } from "../../http/multipart.js";
import { runImportScan } from "../services/importPipeline.js";
import { validateNormalizeRequest } from "../schemas/normalizationSchemas.js";
import { normalizeApprovedScan } from "../services/normalizer.js";
import { validateSemanticMappingRequest } from "../schemas/semanticMappingSchemas.js";
import { createSemanticMappingResponse } from "../services/semanticMapping.js";

const EXCEL_FILE_PATTERN = /\.(xlsx|xls)$/i;

function isJsonContentType(contentType) {
  return /\bapplication\/json\b/i.test(String(contentType || ""));
}

function parseJsonBody(buffer) {
  const text = buffer.toString("utf8").trim();
  if (!text) return null;
  return JSON.parse(text);
}

async function handleImportScan(req, res) {
  const body = await readRequestBody(req);
  const form = parseMultipartFormData(req.headers["content-type"], body);
  const file = form.files.find((candidate) => candidate.fieldName === "file");
  if (!file || !file.filename) {
    sendJson(res, 400, {
      error: {
        code: "missing_file",
        message: "Upload an Excel workbook in multipart field \"file\".",
      },
    });
    return;
  }

  if (!EXCEL_FILE_PATTERN.test(file.filename)) {
    sendJson(res, 415, {
      error: {
        code: "unsupported_file_type",
        message: "Only .xlsx and .xls files are supported for Phase 1 import scans.",
      },
    });
    return;
  }

  sendJson(res, 200, runImportScan({ ...file, fileId: `upload_${Date.now().toString(36)}` }));
}

async function handleImportNormalize(req, res) {
  if (!isJsonContentType(req.headers["content-type"])) {
    sendJson(res, 415, {
      error: {
        code: "unsupported_media_type",
        message: "Expected application/json for import normalization.",
      },
    });
    return;
  }

  let body;
  try {
    body = parseJsonBody(await readRequestBody(req));
  } catch {
    sendJson(res, 400, {
      error: {
        code: "invalid_json",
        message: "Request body must be valid JSON.",
      },
    });
    return;
  }

  const validation = validateNormalizeRequest(body);
  if (!validation.ok) {
    sendJson(res, 400, {
      error: {
        code: "invalid_normalize_request",
        message: validation.errors.join(" "),
        details: validation.errors,
      },
    });
    return;
  }

  sendJson(res, 200, normalizeApprovedScan(validation.value));
}

async function handleImportSemanticMap(req, res) {
  if (!isJsonContentType(req.headers["content-type"])) {
    sendJson(res, 415, {
      error: {
        code: "unsupported_media_type",
        message: "Expected application/json for semantic mapping proposals.",
      },
    });
    return;
  }

  let body;
  try {
    body = parseJsonBody(await readRequestBody(req));
  } catch {
    sendJson(res, 400, {
      error: {
        code: "invalid_json",
        message: "Request body must be valid JSON.",
      },
    });
    return;
  }

  const validation = validateSemanticMappingRequest(body);
  if (!validation.ok) {
    sendJson(res, 400, {
      error: {
        code: "invalid_semantic_mapping_request",
        message: validation.errors.join(" "),
        details: validation.errors,
      },
    });
    return;
  }

  sendJson(res, 200, await createSemanticMappingResponse(validation.value));
}

export async function handleImportRoutes(req, res) {
  if (req.method === "POST" && req.url === "/api/import/scan") {
    await handleImportScan(req, res);
    return true;
  }

  if (req.method === "POST" && req.url === "/api/import/normalize") {
    await handleImportNormalize(req, res);
    return true;
  }

  if (req.method === "POST" && req.url === "/api/import/semantic-map") {
    await handleImportSemanticMap(req, res);
    return true;
  }

  return false;
}
