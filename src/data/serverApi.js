import { ServerApiError, apiV1Request } from "./backendApiV1Client.ts";

export { ServerApiError } from "./backendApiV1Client.ts";

function transport(options = {}) {
  return {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  };
}

function uiAuthResponse(response) {
  const memberships = Array.isArray(response?.memberships) ? response.memberships : [];
  const labs = Array.isArray(response?.labs)
    ? response.labs
    : memberships.map((membership) => ({
      labId: membership.labId,
      id: membership.labId,
      role: membership.role,
      status: membership.status,
    }));
  return {
    ...response,
    labs,
  };
}

function namedPage(response, key) {
  return {
    [key]: Array.isArray(response?.items) ? response.items : [],
    nextCursor: response?.nextCursor || null,
  };
}

async function projectList(path, projectId, options = {}, query = undefined) {
  return apiV1Request("get", path, {
    pathParams: { projectId },
    ...(query ? { query } : {}),
    ...transport(options),
  });
}

async function collectProjectPages(path, projectId, options = {}, query = {}) {
  const items = [];
  const seenCursors = new Set();
  let cursor = null;

  do {
    const response = await projectList(path, projectId, options, {
      ...query,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...(Array.isArray(response?.items) ? response.items : []));
    cursor = response?.nextCursor || null;
    if (cursor && seenCursors.has(cursor)) {
      throw new ServerApiError("LabRat server returned a repeated pagination cursor.", {
        code: "invalid_pagination_cursor",
      });
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return { items, nextCursor: null };
}

export async function loginToServer({ username, password, ...options } = {}) {
  return uiAuthResponse(await apiV1Request("post", "/api/v1/auth/login", {
    body: { username, password },
    ...transport(options),
  }));
}

export function logoutFromServer(options = {}) {
  return apiV1Request("post", "/api/v1/auth/logout", transport(options));
}

export async function getServerSession(options = {}) {
  return uiAuthResponse(await apiV1Request("get", "/api/v1/auth/me", transport(options)));
}

export async function listServerLabs(options = {}) {
  return namedPage(await apiV1Request("get", "/api/v1/labs", transport(options)), "labs");
}

export async function listServerProjects({ labId, ...options } = {}) {
  const response = await apiV1Request("get", "/api/v1/projects", {
    query: { ...(labId ? { labId } : {}), limit: 100 },
    ...transport(options),
  });
  return namedPage(response, "projects");
}

export function createServerProject({ labId, name, description = "", projectProfile = {}, ...options } = {}) {
  return apiV1Request("post", "/api/v1/projects", {
    body: { labId, name, description, projectProfile },
    ...transport(options),
  });
}

export function deleteServerProject(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before deleting it.");
  return apiV1Request("patch", "/api/v1/projects/{projectId}", {
    pathParams: { projectId },
    body: { status: "archived" },
    ...transport(options),
  });
}

export function getServerProjectState(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading server state.");
  return loadServerProjectState(projectId, options);
}

async function loadServerProjectState(projectId, options) {
  const requestTransport = transport(options);
  const projectResponse = await apiV1Request("get", "/api/v1/projects/{projectId}", {
    pathParams: { projectId },
    ...requestTransport,
  });
  const project = projectResponse?.project || null;
  const browserCountPromise = projectList(
    "/api/v1/projects/{projectId}/experiment-browser",
    projectId,
    options,
    { limit: 1 },
  );

  if (project?.shellOnly) {
    const browser = await browserCountPromise;
    return {
      project,
      projectProfile: {},
      publishedExperimentCount: Number(browser?.totalCount) || 0,
      fileObjects: [],
      importRuns: [],
      chartSpecs: [],
      chartStyleProfiles: [],
      reusableChartTemplates: [],
      manuscripts: [],
      workbookReviewSessions: [],
      workbookReviewRegions: [],
      regionUnderstandings: [],
      agentRuns: [],
      analysisThreads: [],
      dataPlans: [],
      dataSnapshots: [],
      experimentSnapshotHeads: [],
      browserViews: [],
      projectBrowserConfig: null,
      sourceDocuments: [],
    };
  }

  const [
    browser,
    files,
    importRuns,
    sourceDocuments,
    sessions,
    regionUnderstandings,
    dataPlans,
    dataSnapshots,
    agentRuns,
    analysisThreads,
    chartSpecs,
    chartStyleProfiles,
    reusableChartTemplates,
    manuscripts,
    browserViews,
    browserConfig,
  ] = await Promise.all([
    browserCountPromise,
    projectList("/api/v1/projects/{projectId}/files", projectId, options),
    projectList("/api/v1/projects/{projectId}/import-runs", projectId, options),
    projectList("/api/v1/projects/{projectId}/source-documents", projectId, options),
    projectList("/api/v1/projects/{projectId}/workbook-review-sessions", projectId, options),
    projectList("/api/v1/projects/{projectId}/region-understandings", projectId, options),
    projectList("/api/v1/projects/{projectId}/data-plans", projectId, options),
    projectList("/api/v1/projects/{projectId}/data-snapshots", projectId, options),
    projectList("/api/v1/projects/{projectId}/agent/runs", projectId, options, { limit: 100 }),
    projectList("/api/v1/projects/{projectId}/analysis-threads", projectId, options, { limit: 100 }),
    collectProjectPages("/api/v1/projects/{projectId}/chart-specs", projectId, options, { limit: 100 }),
    collectProjectPages("/api/v1/projects/{projectId}/chart-style-profiles", projectId, options, { limit: 100 }),
    collectProjectPages("/api/v1/projects/{projectId}/reusable-chart-templates", projectId, options, { limit: 100 }),
    collectProjectPages("/api/v1/projects/{projectId}/manuscripts", projectId, options, { limit: 100 }),
    projectList("/api/v1/projects/{projectId}/browser-views", projectId, options),
    projectList("/api/v1/projects/{projectId}/browser-config", projectId, options),
  ]);
  const sessionItems = Array.isArray(sessions?.items) ? sessions.items : [];
  const regionPages = await Promise.all(sessionItems.map((session) => (
    apiV1Request("get", "/api/v1/workbook-review-sessions/{sessionId}/regions", {
      pathParams: { sessionId: session.id },
      ...requestTransport,
    })
  )));

  return {
    project,
    projectProfile: project?.projectProfile || {},
    publishedExperimentCount: Number(browser?.totalCount) || 0,
    fileObjects: files?.items || [],
    importRuns: importRuns?.items || [],
    chartSpecs: chartSpecs?.items || [],
    chartStyleProfiles: chartStyleProfiles?.items || [],
    reusableChartTemplates: reusableChartTemplates?.items || [],
    manuscripts: manuscripts?.items || [],
    workbookReviewSessions: sessionItems,
    workbookReviewRegions: regionPages.flatMap((page) => page?.items || []),
    regionUnderstandings: regionUnderstandings?.items || [],
    agentRuns: agentRuns?.items || [],
    analysisThreads: analysisThreads?.items || [],
    dataPlans: dataPlans?.items || [],
    dataSnapshots: dataSnapshots?.items || [],
    experimentSnapshotHeads: [],
    browserViews: browserViews?.items || [],
    projectBrowserConfig: browserConfig?.projectBrowserConfig || null,
    sourceDocuments: sourceDocuments?.items || [],
  };
}

export async function patchServerProjectProfile(projectId, projectProfile, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before saving its profile.");
  const response = await apiV1Request("patch", "/api/v1/projects/{projectId}/profile", {
    pathParams: { projectId },
    body: projectProfile || {},
    ...transport(options),
  });
  return { ...response, projectProfile: response?.project?.projectProfile || projectProfile || {} };
}

export async function uploadServerProjectFile(projectId, file, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before uploading files.");
  if (!file) throw new ServerApiError("Select a file before uploading.");
  const formData = new FormData();
  formData.set("file", file);
  return apiV1Request("post", "/api/v1/projects/{projectId}/files", {
    pathParams: { projectId },
    body: formData,
    ...transport(options),
  });
}

export function createServerWorkbookReviewSession(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before creating a workbook review session.");
  if (!request.fileObjectId && !request.sourceDocumentId) {
    throw new ServerApiError("Upload a workbook or select a source document before starting review.");
  }
  return apiV1Request("post", "/api/v1/projects/{projectId}/workbook-review-sessions", {
    pathParams: { projectId },
    body: {
      ...(request.fileObjectId ? { fileObjectId: request.fileObjectId } : {}),
      ...(request.sourceDocumentId ? { sourceDocumentId: request.sourceDocumentId } : {}),
    },
    ...transport(options),
  });
}

export async function listServerWorkbookReviewSessions(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing workbook review sessions.");
  return namedPage(
    await projectList("/api/v1/projects/{projectId}/workbook-review-sessions", projectId, options),
    "workbookReviewSessions",
  );
}

export function getServerWorkbookReviewSession(sessionId, options = {}) {
  if (!sessionId) throw new ServerApiError("Select a workbook review session before loading it.");
  return apiV1Request("get", "/api/v1/workbook-review-sessions/{sessionId}", {
    pathParams: { sessionId },
    ...transport(options),
  });
}

export function deleteServerWorkbookReviewSession(sessionId, request = {}, options = {}) {
  if (!sessionId) throw new ServerApiError("Select a workbook review session before deleting it.");
  return apiV1Request("delete", "/api/v1/workbook-review-sessions/{sessionId}", {
    pathParams: { sessionId },
    body: { expectedVersion: request.expectedVersion, reason: request.reason || "" },
    ...transport(options),
  });
}

export async function listServerWorkbookReviewRegions(sessionId, options = {}) {
  if (!sessionId) throw new ServerApiError("Select a workbook review session before listing regions.");
  const response = await apiV1Request("get", "/api/v1/workbook-review-sessions/{sessionId}/regions", {
    pathParams: { sessionId },
    ...transport(options),
  });
  return { ...response, reviewRegions: response?.items || [], regions: response?.items || [] };
}

export function createServerWorkbookReviewRegion(sessionId, request = {}, options = {}) {
  if (!sessionId) throw new ServerApiError("Select a workbook review session before creating a region.");
  if (!request.sourceDocumentId || !request.sheetName || !request.range) {
    throw new ServerApiError("Select a source workbook range before creating a region.");
  }
  return apiV1Request("post", "/api/v1/workbook-review-sessions/{sessionId}/regions", {
    pathParams: { sessionId },
    body: {
      sourceDocumentId: request.sourceDocumentId,
      sheetName: request.sheetName,
      range: request.range,
      selectionMethod: request.selectionMethod || "manual",
      description: request.description || "",
      semanticType: request.semanticType || "generic_table",
      ...(request.deferInterpretation === true ? { deferInterpretation: true } : {}),
    },
    ...transport(options),
  });
}

export function interpretServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before interpreting it.");
  return apiV1Request("post", "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/interpret", {
    pathParams: { sessionId, regionId },
    body: {
      expectedRegionVersion: request.expectedRegionVersion,
      ...(request.description ? { description: request.description } : {}),
      ...(request.semanticType ? { semanticType: request.semanticType } : {}),
    },
    ...transport(options),
  });
}

export async function listServerWorkbookReviewRegionRevisions(sessionId, regionId, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before listing revisions.");
  const response = await apiV1Request("get", "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/revisions", {
    pathParams: { sessionId, regionId },
    ...transport(options),
  });
  return { ...response, revisions: response?.items || [] };
}

export function reviseServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before submitting feedback.");
  if (!String(request.feedback || "").trim()) throw new ServerApiError("Enter feedback before submitting a region revision.");
  return apiV1Request("post", "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/revisions", {
    pathParams: { sessionId, regionId },
    body: {
      feedback: request.feedback,
      ...(request.previousRevisionId ? { previousRevisionId: request.previousRevisionId } : {}),
      expectedRegionVersion: request.expectedRegionVersion,
    },
    ...transport(options),
  });
}

export function confirmServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId || !request.revisionId) {
    throw new ServerApiError("Select an exact region revision before confirming it.");
  }
  return apiV1Request("post", "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/confirm", {
    pathParams: { sessionId, regionId },
    body: { revisionId: request.revisionId, expectedRegionVersion: request.expectedRegionVersion },
    ...transport(options),
  });
}

export function ignoreServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before ignoring it.");
  return apiV1Request("post", "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/ignore", {
    pathParams: { sessionId, regionId },
    body: { expectedRegionVersion: request.expectedRegionVersion, reason: request.reason || "" },
    ...transport(options),
  });
}

export function deleteServerWorkbookReviewRegion(sessionId, regionId, request = {}, options = {}) {
  if (!sessionId || !regionId) throw new ServerApiError("Select a workbook review region before deleting it.");
  return apiV1Request("delete", "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}", {
    pathParams: { sessionId, regionId },
    body: { expectedRegionVersion: request.expectedRegionVersion, reason: request.reason || "" },
    ...transport(options),
  });
}

export async function listServerRegionUnderstandings(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing region understandings.");
  return namedPage(
    await projectList("/api/v1/projects/{projectId}/region-understandings", projectId, options),
    "regionUnderstandings",
  );
}

export function retrieveProjectEvidence(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before retrieving project evidence.");
  return apiV1Request("post", "/api/v1/projects/{projectId}/evidence/retrieve", {
    pathParams: { projectId },
    body: {
      query: request.query || "",
      includePreview: request.includePreview !== false,
      includeUnconfirmedSuggestions: request.includeUnconfirmedSuggestions === true,
    },
    ...transport(options),
  });
}

export async function listServerProjectDataPlans(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing data plans.");
  return namedPage(await projectList("/api/v1/projects/{projectId}/data-plans", projectId, options), "dataPlans");
}

export async function listServerProjectDataSnapshots(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing data snapshots.");
  return namedPage(await projectList("/api/v1/projects/{projectId}/data-snapshots", projectId, options), "dataSnapshots");
}

export async function listServerSourceDocuments(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing source documents.");
  return namedPage(await projectList("/api/v1/projects/{projectId}/source-documents", projectId, options), "sourceDocuments");
}

export async function listServerSourceDocumentRegions(sourceDocumentId, options = {}) {
  if (!sourceDocumentId) throw new ServerApiError("Select a source document before listing source regions.");
  const response = await apiV1Request("get", "/api/v1/source-documents/{sourceDocumentId}/regions", {
    pathParams: { sourceDocumentId },
    ...transport(options),
  });
  return { ...response, regions: response?.items || [] };
}

export function readServerSourceDocumentRange(sourceDocumentId, request = {}, options = {}) {
  if (!sourceDocumentId) throw new ServerApiError("Select a source document before reading a source range.");
  return apiV1Request("post", "/api/v1/source-documents/{sourceDocumentId}/range", {
    pathParams: { sourceDocumentId },
    body: { sheetName: request.sheetName || "", range: request.range || "" },
    ...transport(options),
  });
}

export function createServerAgentRun(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before asking LabRat to run a project workflow.");
  return apiV1Request("post", "/api/v1/projects/{projectId}/agent/runs", {
    pathParams: { projectId },
    body: {
      message: request.message || "",
      conversation: request.conversation || [],
      selectedContext: request.selectedContext || {},
    },
    ...transport(options),
  });
}

export function getServerAgentRun(agentRunId, options = {}) {
  if (!agentRunId) throw new ServerApiError("Select an AgentRun before loading it.");
  return apiV1Request("get", "/api/v1/agent-runs/{agentRunId}", {
    pathParams: { agentRunId },
    ...transport(options),
  });
}

export function cancelServerAgentRun(agentRunId, options = {}) {
  if (!agentRunId) throw new ServerApiError("Select an AgentRun before cancelling it.");
  return apiV1Request("post", "/api/v1/agent-runs/{agentRunId}/cancel", {
    pathParams: { agentRunId },
    ...transport(options),
  });
}

export async function listServerChartSpecs(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing chart specs.");
  return namedPage(
    await projectList("/api/v1/projects/{projectId}/chart-specs", projectId, options, { limit: 100 }),
    "chartSpecs",
  );
}

export function getServerChartSpec(chartSpecId, options = {}) {
  if (!chartSpecId) throw new ServerApiError("Select a ChartSpec before loading it.");
  return apiV1Request("get", "/api/v1/chart-specs/{chartSpecId}", {
    pathParams: { chartSpecId },
    ...transport(options),
  });
}

export function getServerChartTemplateEligibility(chartSpecId, options = {}) {
  if (!chartSpecId) throw new ServerApiError("Select a ChartSpec before checking template eligibility.");
  return apiV1Request("get", "/api/v1/chart-specs/{chartSpecId}/template-eligibility", {
    pathParams: { chartSpecId },
    ...transport(options),
  });
}

export function getServerReusableChartTemplate(templateId, options = {}) {
  if (!templateId) throw new ServerApiError("Select a reusable chart template before loading it.");
  return apiV1Request("get", "/api/v1/reusable-chart-templates/{reusableChartTemplateId}", {
    pathParams: { reusableChartTemplateId: templateId },
    ...transport(options),
  });
}

export function createServerReusableChartTemplate(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before saving a chart template.");
  const name = String(request.name || "").trim();
  const sourceChartSpecId = String(request.sourceChartSpecId || "").trim();
  if (!name) throw new ServerApiError("Name the chart template before saving it.");
  if (!sourceChartSpecId) throw new ServerApiError("Create the chart before saving it as a template.");
  return apiV1Request("post", "/api/v1/projects/{projectId}/reusable-chart-templates", {
    pathParams: { projectId },
    body: {
      name,
      description: String(request.description || "").trim(),
      sourceChartSpecId,
      ...(request.chartStyleProfileVersionId
        ? { chartStyleProfileVersionId: request.chartStyleProfileVersionId }
        : {}),
    },
    ...transport(options),
  });
}

export function applyServerReusableChartTemplate(templateVersionId, request = {}, options = {}) {
  if (!templateVersionId) throw new ServerApiError("Select a chart template version before applying it.");
  const experimentIds = Array.isArray(request.experimentIds)
    ? request.experimentIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!experimentIds.length) throw new ServerApiError("Select at least one experiment for the chart.");
  const idempotencyKey = String(request.idempotencyKey || "").trim();
  if (!idempotencyKey) throw new ServerApiError("A chart-template application key is required.");
  return apiV1Request(
    "post",
    "/api/v1/reusable-chart-template-versions/{templateVersionId}/applications",
    {
      pathParams: { templateVersionId },
      body: {
        experimentIds,
        bindings: Array.isArray(request.bindings) ? request.bindings : [],
      },
      ...transport(options),
      headers: { ...(options.headers || {}), "Idempotency-Key": idempotencyKey },
    },
  );
}

export function createServerManuscript(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before creating a manuscript.");
  return apiV1Request("post", "/api/v1/projects/{projectId}/manuscripts", {
    pathParams: { projectId },
    body: request,
    ...transport(options),
  });
}

export function patchServerManuscript(manuscriptId, request = {}, options = {}) {
  if (!manuscriptId) throw new ServerApiError("Select a manuscript before saving changes.");
  return apiV1Request("patch", "/api/v1/manuscripts/{manuscriptId}", {
    pathParams: { manuscriptId },
    body: request,
    ...transport(options),
  });
}
