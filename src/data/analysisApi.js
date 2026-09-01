import { ServerApiError, apiV1Request } from "./backendApiV1Client.ts";

function requireId(value, message) {
  const id = String(value || "").trim();
  if (!id) throw new ServerApiError(message);
  return id;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function encodeOffsetCursor(value) {
  const offset = boundedInteger(value, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!offset) return undefined;
  return btoa(JSON.stringify({ offset }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function transport(options = {}) {
  return {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  };
}

function pageQuery(options = {}) {
  const cursor = options.cursor || encodeOffsetCursor(options.offset);
  return {
    ...(cursor ? { cursor } : {}),
    limit: boundedInteger(options.limit, 50, 1, 100),
  };
}

function idempotencyHeaders(options, message) {
  const idempotencyKey = String(options.idempotencyKey || "").trim();
  if (!idempotencyKey) throw new ServerApiError(message);
  return { "idempotency-key": idempotencyKey, ...(options.headers || {}) };
}

export async function listAnalysisThreads(projectId, options = {}) {
  const id = requireId(projectId, "Select a project before listing analysis threads.");
  const response = await apiV1Request("get", "/api/v1/projects/{projectId}/analysis-threads", {
    pathParams: { projectId: id },
    query: pageQuery(options),
    ...transport(options),
  });
  return { analysisThreads: response?.items || [], nextCursor: response?.nextCursor || null };
}

export function getProjectAnalysisCapabilities(projectId, options = {}) {
  const id = requireId(projectId, "Select a project before loading analysis capabilities.");
  return apiV1Request("get", "/api/v1/projects/{projectId}/analysis-capabilities", {
    pathParams: { projectId: id },
    ...transport(options),
  });
}

export function getAnalysisThread(analysisThreadId, options = {}) {
  const id = requireId(analysisThreadId, "Select an analysis thread before loading it.");
  return apiV1Request("get", "/api/v1/analysis-threads/{threadId}", {
    pathParams: { threadId: id },
    ...transport(options),
  });
}

export function createAnalysisPlanRevision(analysisThreadId, request = {}, options = {}) {
  const id = requireId(analysisThreadId, "Select an analysis thread before revising its plan.");
  const feedback = String(request.feedback || "").trim();
  if (!feedback && !request.plan) throw new ServerApiError("Describe the requested plan modification.");
  return apiV1Request("post", "/api/v1/analysis-threads/{threadId}/plan-revisions", {
    pathParams: { threadId: id },
    body: {
      ...(feedback ? { feedback } : {}),
      ...(request.plan ? { plan: request.plan } : {}),
    },
    ...transport(options),
  });
}

export function retryAnalysisThread(analysisThreadId, options = {}) {
  const id = requireId(analysisThreadId, "Select an analysis thread before retrying it.");
  return apiV1Request("post", "/api/v1/analysis-threads/{threadId}/retry", {
    pathParams: { threadId: id },
    ...transport(options),
    headers: idempotencyHeaders(options, "Analysis retry requires an idempotency key."),
  });
}

export function getAnalysisPlanSelection(planRevisionId, options = {}) {
  const id = requireId(planRevisionId, "Select an analysis plan revision before loading its source data.");
  return apiV1Request("get", "/api/v1/analysis-plan-revisions/{revisionId}/selection", {
    pathParams: { revisionId: id },
    query: pageQuery(options),
    ...transport(options),
  });
}

export function acceptAnalysisPlanRevision(planRevisionId, _request = {}, options = {}) {
  const id = requireId(planRevisionId, "Select an analysis plan revision before accepting it.");
  return apiV1Request("post", "/api/v1/analysis-plan-revisions/{revisionId}/accept", {
    pathParams: { revisionId: id },
    ...transport(options),
    headers: idempotencyHeaders(options, "Plan acceptance requires an idempotency key."),
  });
}

export function getAnalysisRun(analysisRunId, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before loading it.");
  return apiV1Request("get", "/api/v1/analysis-runs/{runId}", {
    pathParams: { runId: id },
    ...transport(options),
  });
}

export function executeAnalysisRun(analysisRunId, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before executing it.");
  return apiV1Request("post", "/api/v1/analysis-runs/{runId}/execute", {
    pathParams: { runId: id },
    ...(options.executionStrategy ? { body: { executionStrategy: options.executionStrategy } } : {}),
    ...transport(options),
  });
}

export function retryAnalysisRun(analysisRunId, options = {}) {
  const id = requireId(analysisRunId, "Select a failed analysis run before retrying generation.");
  return apiV1Request("post", "/api/v1/analysis-runs/{runId}/retry", {
    pathParams: { runId: id },
    ...transport(options),
    headers: idempotencyHeaders(options, "Generation retry requires an idempotency key."),
  });
}

export function getAnalysisResultPreview(analysisRunId, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before loading its result.");
  const traceCursor = options.traceCursor || encodeOffsetCursor(options.traceOffset);
  const sourceCursor = options.sourceCursor || encodeOffsetCursor(options.sourceOffset);
  return apiV1Request("get", "/api/v1/analysis-runs/{runId}/result-preview", {
    pathParams: { runId: id },
    query: {
      ...pageQuery(options),
      ...(traceCursor ? { traceCursor } : {}),
      ...(sourceCursor ? { sourceCursor } : {}),
    },
    ...transport(options),
  });
}

export function publishAcceptedExperimentData(analysisRunId, request = {}, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before publishing experiment data.");
  const analysisResultId = String(request.analysisResultId || "").trim();
  if (!analysisResultId) throw new ServerApiError("Experiment publication requires the visible analysis result.");
  return apiV1Request("post", "/api/v1/analysis-runs/{runId}/accept-and-publish-experiments", {
    pathParams: { runId: id },
    body: {
      analysisResultId,
      identityResolutions: Array.isArray(request.identityResolutions) ? request.identityResolutions : [],
    },
    ...transport(options),
    headers: idempotencyHeaders(options, "Experiment publication requires an idempotency key."),
  });
}

export function reviseAnalysisRun(analysisRunId, request = {}, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before revising its result.");
  const feedback = String(request.feedback || "").trim();
  if (!feedback) throw new ServerApiError("Describe the requested result modification.");
  return apiV1Request("post", "/api/v1/analysis-runs/{runId}/revise", {
    pathParams: { runId: id },
    body: { feedback },
    ...transport(options),
  });
}

export function publishAcceptedAnalysisChart(analysisRunId, request = {}, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before publishing its chart.");
  const analysisResultId = String(request.analysisResultId || "").trim();
  if (!analysisResultId) throw new ServerApiError("Result publication requires the visible analysis result.");
  return apiV1Request("post", "/api/v1/analysis-runs/{runId}/accept-and-create-chart", {
    pathParams: { runId: id },
    body: {
      analysisResultId,
      defaultVisibleTraceIds: Array.isArray(request.defaultVisibleTraceIds)
        ? [...new Set(request.defaultVisibleTraceIds.map(String).filter(Boolean))]
        : [],
    },
    ...transport(options),
    headers: idempotencyHeaders(options, "Result publication requires an idempotency key."),
  });
}
