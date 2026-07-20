import { ServerApiError, serverJson, serverRequest } from "./serverApi.js";

function requireId(value, message) {
  const id = String(value || "").trim();
  if (!id) throw new ServerApiError(message);
  return encodeURIComponent(id);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function pageQuery(options = {}) {
  const offset = boundedInteger(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = boundedInteger(options.limit, 50, 1, 100);
  return `?offset=${offset}&limit=${limit}`;
}

function requestOptions(options = {}) {
  const { offset: _offset, limit: _limit, idempotencyKey: _idempotencyKey, ...rest } = options;
  return rest;
}

export function listAnalysisThreads(projectId, options = {}) {
  const id = requireId(projectId, "Select a project before listing analysis threads.");
  return serverRequest(
    `/api/projects/${id}/analysis-threads${pageQuery(options)}`,
    requestOptions(options),
  );
}

export function getAnalysisThread(analysisThreadId, options = {}) {
  const id = requireId(analysisThreadId, "Select an analysis thread before loading it.");
  return serverRequest(`/api/analysis-threads/${id}`, requestOptions(options));
}

export function createAnalysisPlanRevision(analysisThreadId, request = {}, options = {}) {
  const id = requireId(analysisThreadId, "Select an analysis thread before revising its plan.");
  const feedback = String(request.feedback || "").trim();
  if (!feedback && !request.plan) {
    throw new ServerApiError("Describe the requested plan modification.");
  }
  return serverJson(`/api/analysis-threads/${id}/plan-revisions`, {
    ...(feedback ? { feedback } : {}),
    ...(request.plan ? { plan: request.plan } : {}),
    ...(request.selectionRequest ? { selectionRequest: request.selectionRequest } : {}),
  }, requestOptions(options));
}

export function getAnalysisPlanSelection(planRevisionId, options = {}) {
  const id = requireId(planRevisionId, "Select an analysis plan revision before loading its source data.");
  return serverRequest(
    `/api/analysis-plan-revisions/${id}/selection${pageQuery(options)}`,
    requestOptions(options),
  );
}

export function acceptAnalysisPlanRevision(planRevisionId, request = {}, options = {}) {
  const id = requireId(planRevisionId, "Select an analysis plan revision before accepting it.");
  const idempotencyKey = String(options.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    throw new ServerApiError("Plan acceptance requires an idempotency key.");
  }
  return serverJson(`/api/analysis-plan-revisions/${id}/accept`, {
    planHash: request.planHash || "",
    selectionHash: request.selectionHash || "",
    dependencyHash: request.dependencyHash || "",
  }, {
    ...requestOptions(options),
    headers: {
      "idempotency-key": idempotencyKey,
      ...(options.headers || {}),
    },
  });
}
