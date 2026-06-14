export const DEFAULT_IMPORT_NORMALIZE_ENDPOINT = "/api/import/normalize";

export class ImportNormalizeApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ImportNormalizeApiError";
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

export async function normalizeScanWithBackend(options = {}) {
  const {
    scanResult,
    approvedBlockIds,
    mappingOverrides = {},
    userEdits = {},
    endpoint = DEFAULT_IMPORT_NORMALIZE_ENDPOINT,
    fetch: fetchImpl = globalThis.fetch,
    signal,
  } = options;

  if (!scanResult) {
    throw new ImportNormalizeApiError("Scan a workbook before normalizing approved blocks.");
  }

  if (!Array.isArray(approvedBlockIds) || approvedBlockIds.length === 0) {
    throw new ImportNormalizeApiError("Approve at least one scan block before normalizing.");
  }

  if (typeof fetchImpl !== "function") {
    throw new ImportNormalizeApiError("Backend normalize API is unavailable in this environment.");
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scanResult,
      approvedBlockIds,
      mappingOverrides,
      userEdits,
    }),
    signal,
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new ImportNormalizeApiError(
      body?.error?.message || `Backend normalize failed with HTTP ${response.status}.`,
      { status: response.status, error: body?.error || null, body },
    );
  }

  return body;
}
