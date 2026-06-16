export class ServerApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ServerApiError";
    this.status = details.status || null;
    this.code = details.code || details.error?.code || null;
    this.error = details.error || null;
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

export function createServerImportRun(projectId, fileObjectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before creating an import run.");
  if (!fileObjectId) throw new ServerApiError("Upload a file before creating an import run.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/import-runs`, { fileObjectId }, options);
}

export function previewServerImportRunNormalization(importRunId, request = {}, options = {}) {
  if (!importRunId) throw new ServerApiError("Create an import run before normalizing.");
  return serverJson(`/api/import-runs/${encodeURIComponent(importRunId)}/normalize-preview`, {
    approvedBlockIds: request.approvedBlockIds || [],
    approvedStructures: request.approvedStructures || {},
    fieldRoleOverrides: request.fieldRoleOverrides || {},
    mappingOverrides: request.mappingOverrides || {},
    templateId: request.templateId || null,
  }, options);
}

export function previewServerImportRefresh(importRunId, request = {}, options = {}) {
  if (!importRunId) throw new ServerApiError("Create a normalized import preview before refreshing.");
  return serverJson(`/api/import-runs/${encodeURIComponent(importRunId)}/refresh-preview`, {
    replaceImportId: request.replaceImportId || "",
    expectedParentDatasetCommitId: request.expectedParentDatasetCommitId || "",
  }, options);
}

export function previewServerImportRelationship(importRunId, request = {}, options = {}) {
  if (!importRunId) throw new ServerApiError("Create a normalized import preview before resolving relationships.");
  return serverJson(`/api/import-runs/${encodeURIComponent(importRunId)}/relationship-preview`, request, options);
}

export function applyServerImportRun(importRunId, request = {}, options = {}) {
  if (!importRunId) throw new ServerApiError("Create a normalized import preview before applying.");
  return serverJson(`/api/import-runs/${encodeURIComponent(importRunId)}/apply`, {
    applyMode: request.applyMode || "append",
    reviewNote: request.reviewNote || "",
    ...(request.replaceImportId ? { replaceImportId: request.replaceImportId } : {}),
    ...(request.expectedParentDatasetCommitId ? { expectedParentDatasetCommitId: request.expectedParentDatasetCommitId } : {}),
    ...(request.relationshipDecision ? { relationshipDecision: request.relationshipDecision } : {}),
    ...(request.targetExperimentIds ? { targetExperimentIds: request.targetExperimentIds } : {}),
  }, options);
}

export function createServerMappingSet(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before saving mapping proposals.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/mapping-sets`, request, options);
}

export function patchServerMappingSet(mappingSetId, request = {}, options = {}) {
  if (!mappingSetId) throw new ServerApiError("Select a mapping set before updating decisions.");
  return serverJson(`/api/mapping-sets/${encodeURIComponent(mappingSetId)}`, request, {
    ...options,
    method: "PATCH",
  });
}

export function proposeServerProjectCharts(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before proposing charts.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/charts/propose`, {
    selectedImportIds: request.selectedImportIds || [],
    selectedExperimentIds: request.selectedExperimentIds || [],
    userGoal: request.userGoal || "",
    chartConstraints: request.chartConstraints || {},
  }, options);
}

export function interpretServerProjectChart(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before drafting charts.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/charts/interpret`, {
    prompt: request.prompt,
    selectedImportIds: request.selectedImportIds || [],
    selectedExperimentIds: request.selectedExperimentIds || [],
    chartConstraints: request.chartConstraints || {},
    persistAsProposal: request.persistAsProposal !== false,
  }, options);
}

export function resolveServerProjectDataQuery(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before resolving project data.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/data/resolve-query`, {
    prompt: request.prompt || "",
    selectedImportIds: request.selectedImportIds || [],
    selectedExperimentIds: request.selectedExperimentIds || [],
    maxResults: request.maxResults || 50,
  }, options);
}

export function patchServerChartProposalSet(chartProposalSetId, request = {}, options = {}) {
  if (!chartProposalSetId) throw new ServerApiError("Select a chart proposal set before updating decisions.");
  return serverJson(`/api/chart-proposal-sets/${encodeURIComponent(chartProposalSetId)}`, request, {
    ...options,
    method: "PATCH",
  });
}

export function createServerChartSpecFromProposal(projectId, request = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before creating chart specs.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/chart-specs/from-proposal`, request, options);
}

export function listServerChartSpecs(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing chart specs.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/chart-specs`, options);
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
