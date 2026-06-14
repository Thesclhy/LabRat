import { sendJson } from "../../http/json.js";
import { readRequestBody } from "../../http/body.js";
import { validateChartProposalRequest } from "../schemas/chartProposalSchemas.js";
import { createChartProposalResponse } from "../services/chartProposal.js";

function isJsonContentType(contentType) {
  return /\bapplication\/json\b/i.test(String(contentType || ""));
}

function parseJsonBody(buffer) {
  const text = buffer.toString("utf8").trim();
  if (!text) return null;
  return JSON.parse(text);
}

async function handleChartPropose(req, res) {
  if (!isJsonContentType(req.headers["content-type"])) {
    sendJson(res, 415, {
      error: {
        code: "unsupported_media_type",
        message: "Expected application/json for chart proposals.",
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

  const validation = validateChartProposalRequest(body);
  if (!validation.ok) {
    sendJson(res, 400, {
      error: {
        code: "invalid_chart_proposal_request",
        message: validation.errors.join(" "),
        details: validation.errors,
      },
    });
    return;
  }

  sendJson(res, 200, await createChartProposalResponse(validation.value));
}

export async function handleChartRoutes(req, res) {
  if (req.method === "POST" && req.url === "/api/charts/propose") {
    await handleChartPropose(req, res);
    return true;
  }

  return false;
}
