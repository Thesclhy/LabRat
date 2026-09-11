export class ServerApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ServerApiError";
    this.status = details.status || null;
    this.code = details.code || details.error?.code || null;
    this.error = details.error || null;
    this.details = details.details || details.error?.details || null;
    this.body = details.body || null;
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function fetchImplFrom(options) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ServerApiError("LabRat server API is unavailable in this environment.");
  }
  return fetchImpl;
}

export async function serverRequest(endpoint, options = {}) {
  const fetchImpl = fetchImplFrom(options);
  const response = await fetchImpl(endpoint, {
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
    signal: options.signal,
    credentials: "include",
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new ServerApiError(
      body?.error?.message || `LabRat server request failed with HTTP ${response.status}.`,
      { status: response.status, error: body?.error || null, body },
    );
  }

  return body;
}

export function serverJson(endpoint, body, options = {}) {
  return serverRequest(endpoint, {
    ...options,
    method: options.method || "POST",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: JSON.stringify(body || {}),
  });
}

export function loginToServer({ username, password, ...options } = {}) {
  return serverJson("/api/auth/login", { username, password }, options);
}

export function logoutFromServer(options = {}) {
  return serverJson("/api/auth/logout", {}, options);
}

export function getServerSession(options = {}) {
  return serverRequest("/api/auth/me", options);
}

export function listServerLabs(options = {}) {
  return serverRequest("/api/labs", options);
}

export function listServerProjects({ labId, ...options } = {}) {
  const query = labId ? `?labId=${encodeURIComponent(labId)}` : "";
  return serverRequest(`/api/projects${query}`, options);
}

export function createServerProject({ labId, name, description = "", projectProfile = {}, ...options } = {}) {
  return serverJson("/api/projects", { labId, name, description, projectProfile }, options);
}

export function deleteServerProject(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before deleting it.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}`, { status: "deleted" }, {
    ...options,
    method: "PATCH",
  });
}

export function getServerProjectState(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading server state.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/state`, options);
}

export function patchServerProjectProfile(projectId, projectProfile, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before saving its profile.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/profile`, projectProfile || {}, {
    ...options,
    method: "PATCH",
  });
}

export async function uploadServerProjectFile(projectId, file, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before uploading files.");
  if (!file) throw new ServerApiError("Select a file before uploading.");
  const formData = new FormData();
  formData.set("file", file);
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/files`, {
    ...options,
    method: "POST",
    body: formData,
  });
}

export function createServerWorkbookReviewSession(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before creating a workbook review session.");
  if (!request.fileObjectId && !request.sourceDocumentId) {
    throw new ServerApiError("Upload a workbook or select a source document before starting review.");
  }
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/workbook-review-sessions`, {
    fileObjectId: request.fileObjectId || null,
    sourceDocumentId: request.sourceDocumentId || null,
  }, options);
}

export function listServerWorkbookReviewSessions(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing workbook review sessions.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/workbook-review-sessions`, options);
}

export function getServerWorkbookReviewSession(sessionId, options = {}) {
  if (!sessionId) throw new ServerApiError("Select a workbook review session before loading it.");
  return serverRequest(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}`, options);
}

export function deleteServerWorkbookReviewSession(sessionId, request = {}, options = {}) {
  if (!sessionId) throw new ServerApiError("Select a workbook review session before deleting it.");
  return serverJson(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}`, {
    expectedVersion: request.expectedVersion,
    reason: request.reason || "",
  }, { ...options, method: "DELETE" });
}

export function listServerWorkbookReviewRegions(sessionId, options = {}) {
  if (!sessionId) throw new ServerApiError("Select a workbook review session before listing regions.");
  return serverRequest(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}/regions`, options);
}

export function createServerWorkbookReviewRegion(sessionId, request = {}, options = {}) {
  if (!sessionId) throw new ServerApiError("Select a workbook review session before creating a region.");
  if (!request.sourceDocumentId || !request.sheetName || !request.range) {
    throw new ServerApiError("Select a source workbook range before creating a region.");
  }
  return serverJson(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}/regions`, {
    sourceDocumentId: request.sourceDocumentId,
    sheetName: request.sheetName,
    range: request.range,
    selectionMethod: request.selectionMethod || "manual",
    description: request.description || "",
    semanticType: request.semanticType || "generic_table",
    idempotencyKey: request.idempotencyKey || null,
    ...(request.deferInterpretation === true ? { deferInterpretation: true } : {}),
  }, options);
}

export function interpretServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before interpreting it.");
  return serverJson(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}/regions/${encodeURIComponent(regionId)}/interpret`, {
    expectedRegionVersion: request.expectedRegionVersion,
    ...(request.description ? { description: request.description } : {}),
    ...(request.semanticType ? { semanticType: request.semanticType } : {}),
    idempotencyKey: request.idempotencyKey || null,
  }, options);
}

export function listServerWorkbookReviewRegionRevisions(sessionId, regionId, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before listing revisions.");
  return serverRequest(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}/regions/${encodeURIComponent(regionId)}/revisions`, options);
}

export function reviseServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before submitting feedback.");
  if (!String(request.feedback || "").trim()) throw new ServerApiError("Enter feedback before submitting a region revision.");
  return serverJson(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}/regions/${encodeURIComponent(regionId)}/revisions`, {
    feedback: request.feedback,
    previousRevisionId: request.previousRevisionId || null,
    expectedRegionVersion: request.expectedRegionVersion,
    idempotencyKey: request.idempotencyKey || null,
  }, options);
}

export function confirmServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId || !request.revisionId) {
    throw new ServerApiError("Select an exact region revision before confirming it.");
  }
  return serverJson(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}/regions/${encodeURIComponent(regionId)}/confirm`, {
    revisionId: request.revisionId,
    expectedRegionVersion: request.expectedRegionVersion,
    idempotencyKey: request.idempotencyKey || null,
  }, options);
}

export function ignoreServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before ignoring it.");
  return serverJson(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}/regions/${encodeURIComponent(regionId)}/ignore`, {
    expectedRegionVersion: request.expectedRegionVersion,
    reason: request.reason || "",
  }, options);
}

export function deleteServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before deleting it.");
  return serverJson(`/api/workbook-review-sessions/${encodeURIComponent(sessionId)}/regions/${encodeURIComponent(regionId)}`, {
    expectedRegionVersion: request.expectedRegionVersion,
    reason: request.reason || "",
  }, { ...options, method: "DELETE" });
}

export function listServerRegionUnderstandings(projectId, { status = "accepted", ...options } = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing region understandings.");
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/region-understandings${query}`, options);
}

export function retrieveProjectEvidence(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before retrieving project evidence.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/evidence/retrieve`, {
    query: request.query || "",
    mode: request.mode || "tool_agent",
    includePreview: request.includePreview !== false,
    includeUnconfirmedSuggestions: request.includeUnconfirmedSuggestions === true,
    maxResults: request.maxResults || 5,
  }, options);
}

export function listServerProjectDataPlans(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing data plans.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/data-plans`, options);
}

export function listServerProjectDataSnapshots(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing data snapshots.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/data-snapshots`, options);
}

export function listServerSourceDocuments(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing source documents.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/source-documents`, options);
}

export function listServerSourceDocumentRegions(sourceDocumentId, options = {}) {
  if (!sourceDocumentId) throw new ServerApiError("Select a source document before listing source regions.");
  return serverRequest(`/api/source-documents/${encodeURIComponent(sourceDocumentId)}/regions`, options);
}

export function readServerSourceDocumentRange(sourceDocumentId, request = {}, options = {}) {
  if (!sourceDocumentId) throw new ServerApiError("Select a source document before reading a source range.");
  return serverJson(`/api/source-documents/${encodeURIComponent(sourceDocumentId)}/range`, {
    sheetName: request.sheetName || "",
    range: request.range || "",
  }, options);
}

export function readServerSourceDocumentCellClasses(sourceDocumentId, request = {}, options = {}) {
  if (!sourceDocumentId) throw new ServerApiError("Select a source document before reading cell classes.");
  const params = new URLSearchParams({
    sheetName: request.sheetName || "",
    range: request.range || "",
  });
  return serverRequest(`/api/source-documents/${encodeURIComponent(sourceDocumentId)}/cell-classes?${params.toString()}`, options);
}

export function createServerAgentRun(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before asking LabRat to run a project workflow.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/agent/runs`, {
    message: request.message || "",
    conversation: request.conversation || [],
    selectedContext: request.selectedContext || {},
    modeHint: request.modeHint || "auto",
  }, options);
}

export function getServerAgentRun(agentRunId, options = {}) {
  if (!agentRunId) throw new ServerApiError("Select an AgentRun before loading it.");
  return serverRequest(`/api/agent-runs/${encodeURIComponent(agentRunId)}`, options);
}

export function cancelServerAgentRun(agentRunId, options = {}) {
  if (!agentRunId) throw new ServerApiError("Select an AgentRun before cancelling it.");
  return serverJson(`/api/agent-runs/${encodeURIComponent(agentRunId)}/cancel`, {}, options);
}

export function listServerChartSpecs(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing chart specs.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/chart-specs`, options);
}

export function getServerChartSpec(chartSpecId, options = {}) {
  if (!chartSpecId) throw new ServerApiError("Select a ChartSpec before loading it.");
  return serverRequest(`/api/chart-specs/${encodeURIComponent(chartSpecId)}`, options);
}

export function getServerChartTemplateEligibility(chartSpecId, options = {}) {
  if (!chartSpecId) throw new ServerApiError("Select a ChartSpec before checking template eligibility.");
  return serverRequest(`/api/chart-specs/${encodeURIComponent(chartSpecId)}/template-eligibility`, options);
}

export function getServerReusableChartTemplate(templateId, options = {}) {
  if (!templateId) throw new ServerApiError("Select a reusable chart template before loading it.");
  return serverRequest(`/api/reusable-chart-templates/${encodeURIComponent(templateId)}`, options);
}

export function createServerReusableChartTemplate(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before saving a chart template.");
  const name = String(request.name || "").trim();
  const sourceChartSpecId = String(request.sourceChartSpecId || "").trim();
  if (!name) throw new ServerApiError("Name the chart template before saving it.");
  if (!sourceChartSpecId) throw new ServerApiError("Create the chart before saving it as a template.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/reusable-chart-templates`, {
    name,
    description: String(request.description || "").trim(),
    sourceChartSpecId,
    ...(request.chartStyleProfileVersionId
      ? { chartStyleProfileVersionId: request.chartStyleProfileVersionId }
      : {}),
  }, options);
}

export function applyServerReusableChartTemplate(templateVersionId, request = {}, options = {}) {
  if (!templateVersionId) throw new ServerApiError("Select a chart template version before applying it.");
  const experimentIds = Array.isArray(request.experimentIds)
    ? request.experimentIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!experimentIds.length) throw new ServerApiError("Select at least one experiment for the chart.");
  const idempotencyKey = String(request.idempotencyKey || "").trim();
  if (!idempotencyKey) throw new ServerApiError("A chart-template application key is required.");
  return serverJson(
    `/api/reusable-chart-template-versions/${encodeURIComponent(templateVersionId)}/applications`,
    {
      experimentIds,
      bindings: Array.isArray(request.bindings) ? request.bindings : [],
    },
    {
      ...options,
      headers: { ...(options.headers || {}), "Idempotency-Key": idempotencyKey },
    },
  );
}

export function listServerRegionExtractionTemplates(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing extraction templates.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/region-extraction-templates`, options);
}

export function getServerRegionExtractionTemplate(templateId, options = {}) {
  if (!templateId) throw new ServerApiError("Select an extraction template before loading it.");
  return serverRequest(`/api/region-extraction-templates/${encodeURIComponent(templateId)}`, options);
}

export function createServerRegionExtractionTemplate(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before saving an extraction template.");
  const name = String(request.name || "").trim();
  const regionId = String(request.regionId || "").trim();
  if (!name) throw new ServerApiError("Name the extraction template before saving it.");
  if (!regionId) throw new ServerApiError("Confirm a region before saving it as an extraction template.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/region-extraction-templates`, {
    name,
    description: String(request.description || "").trim(),
    regionId,
  }, options);
}

export function createServerRegionExtractionTemplateVersion(templateId, request = {}, options = {}) {
  if (!templateId) throw new ServerApiError("Select an extraction template before adding a version.");
  const regionId = String(request.regionId || "").trim();
  if (!regionId) throw new ServerApiError("Confirm a region before updating the extraction template.");
  return serverJson(`/api/region-extraction-templates/${encodeURIComponent(templateId)}/versions`, { regionId }, options);
}

export function archiveServerRegionExtractionTemplate(templateId, options = {}) {
  if (!templateId) throw new ServerApiError("Select an extraction template before archiving it.");
  return serverJson(`/api/region-extraction-templates/${encodeURIComponent(templateId)}/archive`, {}, options);
}

export function matchServerRegionExtractionTemplate(templateVersionId, request = {}, options = {}) {
  if (!templateVersionId) throw new ServerApiError("Select an extraction template version before matching workbooks.");
  const sourceDocumentIds = Array.isArray(request.sourceDocumentIds)
    ? request.sourceDocumentIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!sourceDocumentIds.length) throw new ServerApiError("Select at least one uploaded workbook to match.");
  return serverJson(`/api/region-extraction-template-versions/${encodeURIComponent(templateVersionId)}/matches`, { sourceDocumentIds }, options);
}

export function applyServerRegionExtractionTemplate(templateVersionId, request = {}, options = {}) {
  if (!templateVersionId) throw new ServerApiError("Select an extraction template version before applying it.");
  const sourceDocumentIds = Array.isArray(request.sourceDocumentIds)
    ? request.sourceDocumentIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!sourceDocumentIds.length) throw new ServerApiError("Select at least one matched workbook to apply the template to.");
  const idempotencyKey = String(request.idempotencyKey || "").trim();
  if (!idempotencyKey) throw new ServerApiError("A template application key is required.");
  return serverJson(`/api/region-extraction-template-versions/${encodeURIComponent(templateVersionId)}/apply`, {
    sourceDocumentIds,
    ...(Array.isArray(request.onlyStatuses) ? { onlyStatuses: request.onlyStatuses } : {}),
  }, {
    ...options,
    headers: { ...(options.headers || {}), "Idempotency-Key": idempotencyKey },
  });
}

export function confirmServerWorkbookReviewRegionsBatch(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before confirming regions.");
  const items = Array.isArray(request.items) ? request.items.filter((item) => item && item.regionId) : [];
  if (!items.length) throw new ServerApiError("Select at least one region to confirm.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/workbook-review-regions/confirm-batch`, {
    items: items.map((item) => ({
      regionId: item.regionId,
      revisionId: item.revisionId || null,
      expectedRegionVersion: item.expectedRegionVersion,
      ...(item.linkedExperimentId !== undefined ? { linkedExperimentId: item.linkedExperimentId } : {}),
    })),
  }, options);
}

export function listServerLinkedDataKinds(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing linked workbook data.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/linked-data-kinds`, options);
}

export function createServerLinkedDataComparison(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before comparing linked data.");
  const dataKind = String(request.dataKind || "").trim();
  const experimentIds = Array.isArray(request.experimentIds)
    ? request.experimentIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!dataKind) throw new ServerApiError("Choose a data kind to compare.");
  if (!experimentIds.length) throw new ServerApiError("Choose at least one experiment to compare.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/linked-data-comparisons`, {
    dataKind,
    experimentIds,
    ...(request.chartType ? { chartType: request.chartType } : {}),
    ...(request.dryRun ? { dryRun: true } : {}),
  }, options);
}

export function createServerManuscript(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before creating a manuscript.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/manuscripts`, request, options);
}

export function patchServerManuscript(manuscriptId, request = {}, options = {}) {
  if (!manuscriptId) throw new ServerApiError("Select a manuscript before saving changes.");
  return serverJson(`/api/manuscripts/${encodeURIComponent(manuscriptId)}`, request, {
    ...options,
    method: "PATCH",
  });
}
