export const DEFAULT_IMPORT_SCAN_ENDPOINT = "/api/import/scan";

export class ImportScanApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ImportScanApiError";
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

export async function scanWorkbookWithBackend(file, options = {}) {
  if (!file) {
    throw new ImportScanApiError("Select an Excel workbook before scanning.");
  }

  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ImportScanApiError("Backend scan API is unavailable in this environment.");
  }

  const formData = new FormData();
  formData.set("file", file);

  const response = await fetchImpl(options.endpoint || DEFAULT_IMPORT_SCAN_ENDPOINT, {
    method: "POST",
    body: formData,
    signal: options.signal,
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new ImportScanApiError(
      body?.error?.message || `Backend scan failed with HTTP ${response.status}.`,
      { status: response.status, error: body?.error || null, body },
    );
  }

  return body;
}
