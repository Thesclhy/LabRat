import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IMPORT_SCAN_ENDPOINT,
  ImportScanApiError,
  scanWorkbookWithBackend,
} from "./backendImportScanApi.js";

function excelFile() {
  return new File(["workbook"], "runs.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("scanWorkbookWithBackend", () => {
  it("uploads a workbook to the backend scan endpoint", async () => {
    const scanResult = { schemaVersion: "labrat.importScan.v1", sheets: [] };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => scanResult,
    }));
    const file = excelFile();

    await expect(scanWorkbookWithBackend(file, { fetch: fetchMock })).resolves.toBe(scanResult);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_IMPORT_SCAN_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get("file")).toBe(file);
    expect(init).not.toHaveProperty("headers");
  });

  it("supports a custom endpoint and abort signal", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));

    await scanWorkbookWithBackend(excelFile(), {
      endpoint: "http://127.0.0.1:8787/api/import/scan",
      fetch: fetchMock,
      signal,
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/import/scan");
    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
  });

  it("throws typed errors for backend failures", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 415,
      json: async () => ({ error: { code: "unsupported_file_type", message: "Only Excel files are supported." } }),
    }));

    await expect(scanWorkbookWithBackend(excelFile(), { fetch: fetchMock }))
      .rejects.toMatchObject({
        name: "ImportScanApiError",
        status: 415,
        error: { code: "unsupported_file_type" },
        message: "Only Excel files are supported.",
      });
  });

  it("validates that a file was provided before calling fetch", async () => {
    const fetchMock = vi.fn();

    await expect(scanWorkbookWithBackend(null, { fetch: fetchMock }))
      .rejects.toBeInstanceOf(ImportScanApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not mutate local LabRat project or dataset storage keys", async () => {
    localStorage.setItem("labrat_dataset", "existing-dataset");
    localStorage.setItem("labrat_staged", "existing-staged");
    localStorage.setItem("labrat_blocks", "existing-blocks");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ schemaVersion: "labrat.importScan.v1", sheets: [] }),
    }));

    await scanWorkbookWithBackend(excelFile(), { fetch: fetchMock });

    expect(localStorage.getItem("labrat_dataset")).toBe("existing-dataset");
    expect(localStorage.getItem("labrat_staged")).toBe("existing-staged");
    expect(localStorage.getItem("labrat_blocks")).toBe("existing-blocks");
  });
});
