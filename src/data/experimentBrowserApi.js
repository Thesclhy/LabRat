import { ServerApiError, serverJson, serverRequest } from "./serverApi.js";

export async function listExperimentBrowserRows(projectId, query = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading Experiment Browser.");
  const searchParams = new URLSearchParams();
  if (String(query.search || "").trim()) searchParams.set("search", String(query.search).trim());
  if (Array.isArray(query.filters) && query.filters.length) searchParams.set("filters", JSON.stringify(query.filters));
  if (Array.isArray(query.sort) && query.sort.length) searchParams.set("sort", JSON.stringify(query.sort));
  if (query.starredOnly) searchParams.set("starredOnly", "true");
  if (query.cursor) searchParams.set("cursor", query.cursor);
  if (query.limit) searchParams.set("limit", String(query.limit));
  const suffix = searchParams.size ? `?${searchParams.toString()}` : "";
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/experiment-browser${suffix}`, options);
}

export async function saveExperimentAnnotation(projectId, experimentId, annotation, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before annotating an experiment.");
  if (!experimentId) throw new ServerApiError("Select an experiment before saving an annotation.");
  return serverJson(
    `/api/projects/${encodeURIComponent(projectId)}/experiments/${encodeURIComponent(experimentId)}/annotation`,
    annotation || {},
    { ...options, method: "PUT" },
  );
}

export async function deleteExperimentAnnotation(projectId, experimentId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before removing an annotation.");
  if (!experimentId) throw new ServerApiError("Select an experiment before removing an annotation.");
  return serverRequest(
    `/api/projects/${encodeURIComponent(projectId)}/experiments/${encodeURIComponent(experimentId)}/annotation`,
    { ...options, method: "DELETE" },
  );
}

export async function createExperimentCustomColumn(projectId, label = "Untitled column", options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before adding a custom column.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/experiment-custom-columns`, { label }, options);
}

export async function updateExperimentCustomColumn(projectId, customColumnId, changes, options = {}) {
  if (!projectId || !customColumnId) throw new ServerApiError("Select a custom column before updating it.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/experiment-custom-columns/${encodeURIComponent(customColumnId)}`, changes || {}, { ...options, method: "PATCH" });
}

export async function deleteExperimentCustomColumn(projectId, customColumnId, options = {}) {
  if (!projectId || !customColumnId) throw new ServerApiError("Select a custom column before deleting it.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/experiment-custom-columns/${encodeURIComponent(customColumnId)}`, { ...options, method: "DELETE" });
}

export async function saveExperimentCustomValue(projectId, customColumnId, experimentId, changes, options = {}) {
  if (!projectId || !customColumnId || !experimentId) throw new ServerApiError("Select a custom cell before updating it.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/experiment-custom-columns/${encodeURIComponent(customColumnId)}/experiments/${encodeURIComponent(experimentId)}`, changes || {}, { ...options, method: "PUT" });
}

export async function listExperimentAnnotations(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading experiment annotations.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/experiment-annotations`, options);
}

export async function getExperimentBrowserDetail(projectId, experimentId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading experiment detail.");
  if (!experimentId) throw new ServerApiError("Select an experiment before loading detail.");
  return serverRequest(
    `/api/projects/${encodeURIComponent(projectId)}/experiments/${encodeURIComponent(experimentId)}`,
    options,
  );
}

export async function getProjectBrowserConfig(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading Browser configuration.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/browser-config`, options);
}

export async function updateProjectBrowserConfig(projectId, changes, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before updating Browser configuration.");
  return serverJson(
    `/api/projects/${encodeURIComponent(projectId)}/browser-config`,
    changes || {},
    { ...options, method: "PATCH" },
  );
}

export async function listExperimentBrowserViews(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing Browser views.");
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/browser-views`, options);
}

export async function createExperimentBrowserView(projectId, view, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before saving a Browser view.");
  return serverJson(`/api/projects/${encodeURIComponent(projectId)}/browser-views`, view || {}, options);
}

export async function updateExperimentBrowserView(projectId, browserViewId, changes, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before updating a Browser view.");
  if (!browserViewId) throw new ServerApiError("Select a Browser view before updating it.");
  return serverJson(
    `/api/projects/${encodeURIComponent(projectId)}/browser-views/${encodeURIComponent(browserViewId)}`,
    changes || {},
    { ...options, method: "PATCH" },
  );
}

export async function deleteExperimentBrowserView(projectId, browserViewId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before deleting a Browser view.");
  if (!browserViewId) throw new ServerApiError("Select a Browser view before deleting it.");
  return serverRequest(
    `/api/projects/${encodeURIComponent(projectId)}/browser-views/${encodeURIComponent(browserViewId)}`,
    { ...options, method: "DELETE" },
  );
}
