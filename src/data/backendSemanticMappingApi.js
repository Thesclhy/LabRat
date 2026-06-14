export const DEFAULT_SEMANTIC_MAPPING_ENDPOINT = "/api/import/semantic-map";

export class SemanticMappingApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SemanticMappingApiError";
    this.status = details.status || null;
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

export async function proposeSemanticMappingsWithBackend(options = {}) {
  const {
    genericImports,
    selectedImportIds = [],
    scanSummary = null,
    userGoal = "",
    priorDecisions = [],
    endpoint = DEFAULT_SEMANTIC_MAPPING_ENDPOINT,
    fetch: fetchImpl = globalThis.fetch,
    signal,
  } = options;

  if (!Array.isArray(genericImports) || genericImports.length === 0) {
    throw new SemanticMappingApiError("Apply or preview normalized generic import data before proposing mappings.");
  }

  if (typeof fetchImpl !== "function") {
    throw new SemanticMappingApiError("Semantic mapping API is unavailable in this environment.");
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      genericImports,
      selectedImportIds,
      scanSummary,
      userGoal,
      priorDecisions,
    }),
    signal,
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new SemanticMappingApiError(
      body?.error?.message || `Semantic mapping failed with HTTP ${response.status}.`,
      { status: response.status, error: body?.error || null, body },
    );
  }

  return body;
}
