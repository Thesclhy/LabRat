export const DEFAULT_CHART_INTERPRET_ENDPOINT = "/api/charts/interpret";

export class ChartInterpretApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ChartInterpretApiError";
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

export async function interpretChartWithBackend(options = {}) {
  const {
    prompt,
    genericImports,
    selectedImportIds = [],
    selectedExperimentIds = [],
    mappingSets = [],
    chartConstraints = {},
    priorDecisions = [],
    endpoint = DEFAULT_CHART_INTERPRET_ENDPOINT,
    fetch: fetchImpl = globalThis.fetch,
    signal,
  } = options;

  if (!String(prompt || "").trim()) {
    throw new ChartInterpretApiError("Describe the chart you want LabRat to draft.");
  }

  if (!Array.isArray(genericImports) || genericImports.length === 0) {
    throw new ChartInterpretApiError("Apply or preview normalized generic import data before drafting a chart.");
  }

  if (typeof fetchImpl !== "function") {
    throw new ChartInterpretApiError("Chart interpretation API is unavailable in this environment.");
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      genericImports,
      selectedImportIds,
      selectedExperimentIds,
      mappingSets,
      chartConstraints,
      priorDecisions,
    }),
    signal,
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new ChartInterpretApiError(
      body?.error?.message || `Chart interpretation failed with HTTP ${response.status}.`,
      { status: response.status, error: body?.error || null, body },
    );
  }

  return body;
}

