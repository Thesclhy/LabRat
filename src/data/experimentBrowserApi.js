import { ServerApiError, serverJson, serverRequest } from "./serverApi.js";

export async function listExperimentBrowserRows(projectId, query = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading Experiment Browser.");
  const searchParams = new URLSearchParams();
  if (String(query.search || "").trim()) searchParams.set("search", String(query.search).trim());
  if (Array.isArray(query.filters) && query.filters.length) searchParams.set("filters", JSON.stringify(query.filters));
  if (Array.isArray(query.sort) && query.sort.length) searchParams.set("sort", JSON.stringify(query.sort));
  if (query.cursor) searchParams.set("cursor", query.cursor);
  if (query.limit) searchParams.set("limit", String(query.limit));
  const suffix = searchParams.size ? `?${searchParams.toString()}` : "";
  return serverRequest(`/api/projects/${encodeURIComponent(projectId)}/experiment-browser${suffix}`, options);
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
