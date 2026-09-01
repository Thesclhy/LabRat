import { ServerApiError, apiV1Request } from "./backendApiV1Client.ts";

function transport(options = {}) {
  return {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  };
}

export async function listExperimentBrowserRows(projectId, query = {}, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading Experiment Browser.");
  return apiV1Request("get", "/api/v1/projects/{projectId}/experiment-browser", {
    pathParams: { projectId },
    query: {
      ...(String(query.search || "").trim() ? { search: String(query.search).trim() } : {}),
      ...(Array.isArray(query.filters) && query.filters.length ? { filters: JSON.stringify(query.filters) } : {}),
      ...(Array.isArray(query.sort) && query.sort.length ? { sort: JSON.stringify(query.sort) } : {}),
      ...(query.starredOnly ? { starredOnly: "true" } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    },
    ...transport(options),
  });
}

export function saveExperimentAnnotation(projectId, experimentId, annotation, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before annotating an experiment.");
  if (!experimentId) throw new ServerApiError("Select an experiment before saving an annotation.");
  return apiV1Request("put", "/api/v1/projects/{projectId}/experiments/{experimentId}/annotation", {
    pathParams: { projectId, experimentId },
    body: annotation || {},
    ...transport(options),
  });
}

export function deleteExperimentAnnotation(projectId, experimentId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before removing an annotation.");
  if (!experimentId) throw new ServerApiError("Select an experiment before removing an annotation.");
  return apiV1Request("delete", "/api/v1/projects/{projectId}/experiments/{experimentId}/annotation", {
    pathParams: { projectId, experimentId },
    ...transport(options),
  });
}

export function createExperimentCustomColumn(projectId, label = "Untitled column", options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before adding a custom column.");
  return apiV1Request("post", "/api/v1/projects/{projectId}/experiment-custom-columns", {
    pathParams: { projectId },
    body: { label },
    ...transport(options),
  });
}

export function updateExperimentCustomColumn(projectId, customColumnId, changes, options = {}) {
  if (!projectId || !customColumnId) throw new ServerApiError("Select a custom column before updating it.");
  return apiV1Request("patch", "/api/v1/projects/{projectId}/experiment-custom-columns/{columnId}", {
    pathParams: { projectId, columnId: customColumnId },
    body: changes || {},
    ...transport(options),
  });
}

export function deleteExperimentCustomColumn(projectId, customColumnId, options = {}) {
  if (!projectId || !customColumnId) throw new ServerApiError("Select a custom column before deleting it.");
  return apiV1Request("delete", "/api/v1/projects/{projectId}/experiment-custom-columns/{columnId}", {
    pathParams: { projectId, columnId: customColumnId },
    ...transport(options),
  });
}

export function saveExperimentCustomValue(projectId, customColumnId, experimentId, changes, options = {}) {
  if (!projectId || !customColumnId || !experimentId) throw new ServerApiError("Select a custom cell before updating it.");
  return apiV1Request("put", "/api/v1/projects/{projectId}/experiment-custom-columns/{columnId}/experiments/{experimentId}", {
    pathParams: { projectId, columnId: customColumnId, experimentId },
    body: changes || {},
    ...transport(options),
  });
}

export async function listExperimentAnnotations(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading experiment annotations.");
  const response = await apiV1Request("get", "/api/v1/projects/{projectId}/experiment-annotations", {
    pathParams: { projectId },
    ...transport(options),
  });
  return { experimentAnnotations: response?.items || [], nextCursor: response?.nextCursor || null };
}

export async function getExperimentBrowserDetail(projectId, experimentId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading experiment detail.");
  if (!experimentId) throw new ServerApiError("Select an experiment before loading detail.");
  return apiV1Request("get", "/api/v1/projects/{projectId}/experiments/{experimentId}", {
    pathParams: { projectId, experimentId },
    ...transport(options),
  });
}

export function getProjectBrowserConfig(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before loading Browser configuration.");
  return apiV1Request("get", "/api/v1/projects/{projectId}/browser-config", {
    pathParams: { projectId },
    ...transport(options),
  });
}

export function updateProjectBrowserConfig(projectId, changes, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before updating Browser configuration.");
  return apiV1Request("patch", "/api/v1/projects/{projectId}/browser-config", {
    pathParams: { projectId },
    body: changes || {},
    ...transport(options),
  });
}

export async function listExperimentBrowserViews(projectId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before listing Browser views.");
  const response = await apiV1Request("get", "/api/v1/projects/{projectId}/browser-views", {
    pathParams: { projectId },
    ...transport(options),
  });
  return { browserViews: response?.items || [], nextCursor: response?.nextCursor || null };
}

export function createExperimentBrowserView(projectId, view, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before saving a Browser view.");
  return apiV1Request("post", "/api/v1/projects/{projectId}/browser-views", {
    pathParams: { projectId },
    body: view || {},
    ...transport(options),
  });
}

export function updateExperimentBrowserView(projectId, browserViewId, changes, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before updating a Browser view.");
  if (!browserViewId) throw new ServerApiError("Select a Browser view before updating it.");
  return apiV1Request("patch", "/api/v1/projects/{projectId}/browser-views/{viewId}", {
    pathParams: { projectId, viewId: browserViewId },
    body: changes || {},
    ...transport(options),
  });
}

export function deleteExperimentBrowserView(projectId, browserViewId, options = {}) {
  if (!projectId) throw new ServerApiError("Select a project before deleting a Browser view.");
  if (!browserViewId) throw new ServerApiError("Select a Browser view before deleting it.");
  return apiV1Request("delete", "/api/v1/projects/{projectId}/browser-views/{viewId}", {
    pathParams: { projectId, viewId: browserViewId },
    ...transport(options),
  });
}
