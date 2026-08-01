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
  const {
    offset: _offset,
    limit: _limit,
    traceOffset: _traceOffset,
    traceLimit: _traceLimit,
    sourceOffset: _sourceOffset,
    sourceLimit: _sourceLimit,
    idempotencyKey: _idempotencyKey,
    executionStrategy: _executionStrategy,
    ...rest
  } = options;
  return rest;
}

export function listAnalysisThreads(projectId, options = {}) {
  const id = requireId(projectId, "Select a project before listing analysis threads.");
  return serverRequest(
    `/api/projects/${id}/analysis-threads${pageQuery(options)}`,
    requestOptions(options),
  );
}

export function getProjectAnalysisCapabilities(projectId, options = {}) {
  const id = requireId(projectId, "Select a project before loading analysis capabilities.");
  return serverRequest(`/api/projects/${id}/analysis-capabilities`, requestOptions(options));
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

export function retryAnalysisThread(analysisThreadId, options = {}) {
  const id = requireId(analysisThreadId, "Select an analysis thread before retrying it.");
  const idempotencyKey = String(options.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    throw new ServerApiError("Analysis retry requires an idempotency key.");
  }
  return serverJson(`/api/analysis-threads/${id}/retry`, {}, {
    ...requestOptions(options),
    headers: {
      "idempotency-key": idempotencyKey,
      ...(options.headers || {}),
    },
  });
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
  return serverJson(`/api/analysis-plan-revisions/${id}/accept`, {}, {
    ...requestOptions(options),
    headers: {
      "idempotency-key": idempotencyKey,
      ...(options.headers || {}),
    },
  });
}

export function getAnalysisRun(analysisRunId, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before loading it.");
  return serverRequest(`/api/analysis-runs/${id}`, requestOptions(options));
}

export function executeAnalysisRun(analysisRunId, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before executing it.");
  return serverJson(`/api/analysis-runs/${id}/execute`, {
    ...(options.executionStrategy ? { executionStrategy: options.executionStrategy } : {}),
  }, requestOptions(options));
}

export function retryAnalysisRun(analysisRunId, options = {}) {
  const id = requireId(analysisRunId, "Select a failed analysis run before retrying generation.");
  const idempotencyKey = String(options.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    throw new ServerApiError("Generation retry requires an idempotency key.");
  }
  return serverJson(`/api/analysis-runs/${id}/retry`, {}, {
    ...requestOptions(options),
    headers: {
      "idempotency-key": idempotencyKey,
      ...(options.headers || {}),
    },
  });
}

export function getAnalysisResultPreview(analysisRunId, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before loading its result.");
  return serverRequest(
    `/api/analysis-runs/${id}/result-preview${pageQuery(options)}`,
    requestOptions(options),
  );
}

export function publishAcceptedExperimentData(analysisRunId, request = {}, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before publishing experiment data.");
  const analysisResultId = String(request.analysisResultId || "").trim();
  const idempotencyKey = String(options.idempotencyKey || "").trim();
  if (!analysisResultId) {
    throw new ServerApiError("Experiment publication requires the visible analysis result.");
  }
  if (!idempotencyKey) {
    throw new ServerApiError("Experiment publication requires an idempotency key.");
  }
  return serverJson(`/api/analysis-runs/${id}/accept-and-publish-experiments`, {
    analysisResultId,
    identityResolutions: Array.isArray(request.identityResolutions)
      ? request.identityResolutions
      : [],
  }, {
    ...requestOptions(options),
    headers: {
      "idempotency-key": idempotencyKey,
      ...(options.headers || {}),
    },
  });
}

export function reviseAnalysisRun(analysisRunId, request = {}, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before revising its result.");
  const feedback = String(request.feedback || "").trim();
  if (!feedback) {
    throw new ServerApiError("Describe the requested result modification.");
  }
  return serverJson(`/api/analysis-runs/${id}/revise`, { feedback }, requestOptions(options));
}

export function publishAcceptedAnalysisChart(analysisRunId, request = {}, options = {}) {
  const id = requireId(analysisRunId, "Select an analysis run before publishing its chart.");
  const analysisResultId = String(request.analysisResultId || "").trim();
  const idempotencyKey = String(options.idempotencyKey || "").trim();
  if (!analysisResultId) {
    throw new ServerApiError("Result publication requires the visible analysis result.");
  }
  if (!idempotencyKey) {
    throw new ServerApiError("Result publication requires an idempotency key.");
  }
  return serverJson(`/api/analysis-runs/${id}/accept-and-create-chart`, {
    analysisResultId,
    defaultVisibleTraceIds: Array.isArray(request.defaultVisibleTraceIds)
      ? [...new Set(request.defaultVisibleTraceIds.map(String).filter(Boolean))]
      : [],
  }, {
    ...requestOptions(options),
    headers: {
      "idempotency-key": idempotencyKey,
      ...(options.headers || {}),
    },
  });
}
