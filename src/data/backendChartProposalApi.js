export const DEFAULT_CHART_PROPOSAL_ENDPOINT = "/api/charts/propose";

export class ChartProposalApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ChartProposalApiError";
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

export async function proposeChartsWithBackend(options = {}) {
  const {
    genericImports,
    selectedImportIds = [],
    mappingSets = [],
    userGoal = "",
    chartConstraints = {},
    priorDecisions = [],
    endpoint = DEFAULT_CHART_PROPOSAL_ENDPOINT,
    fetch: fetchImpl = globalThis.fetch,
    signal,
  } = options;

  if (!Array.isArray(genericImports) || genericImports.length === 0) {
    throw new ChartProposalApiError("Apply or preview normalized generic import data before proposing charts.");
  }

  if (typeof fetchImpl !== "function") {
    throw new ChartProposalApiError("Chart proposal API is unavailable in this environment.");
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      genericImports,
      selectedImportIds,
      mappingSets,
      userGoal,
      chartConstraints,
      priorDecisions,
    }),
    signal,
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new ChartProposalApiError(
      body?.error?.message || `Chart proposal failed with HTTP ${response.status}.`,
      { status: response.status, error: body?.error || null, body },
    );
  }

  return body;
}
