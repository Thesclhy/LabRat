import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IMPORT_NORMALIZE_ENDPOINT,
  ImportNormalizeApiError,
  normalizeScanWithBackend,
} from "./backendImportNormalizeApi.js";

function scanResult() {
  return {
    schemaVersion: "labrat.importScan.v1",
    file: { fileId: "upload_1", name: "runs.xlsx" },
    sheets: [],
  };
}

describe("normalizeScanWithBackend", () => {
  it("posts scan approvals as JSON to the default endpoint", async () => {
    const normalizeResult = { schemaVersion: "labrat.importNormalize.v1", datasetPatch: { genericImports: [] } };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => normalizeResult,
    }));

    await expect(normalizeScanWithBackend({
      scanResult: scanResult(),
      approvedBlockIds: ["sheet_1_table_1"],
      fetch: fetchMock,
    })).resolves.toBe(normalizeResult);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_IMPORT_NORMALIZE_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      scanResult: scanResult(),
      approvedBlockIds: ["sheet_1_table_1"],
      mappingOverrides: {},
      userEdits: {},
    });
  });

  it("supports custom endpoint, signal, overrides, and edits", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));

    await normalizeScanWithBackend({
      scanResult: scanResult(),
      approvedBlockIds: ["block_1"],
      mappingOverrides: { col_1: { field: "time" } },
      userEdits: { createdAt: "2026-06-08T00:00:00.000Z" },
      endpoint: "http://127.0.0.1:8787/api/import/normalize",
      fetch: fetchMock,
      signal,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8787/api/import/normalize");
    expect(init.signal).toBe(signal);
    expect(JSON.parse(init.body).mappingOverrides.col_1.field).toBe("time");
    expect(JSON.parse(init.body).userEdits.createdAt).toBe("2026-06-08T00:00:00.000Z");
  });

  it("throws typed errors for backend failures", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "invalid_normalize_request", message: "Bad approval." } }),
    }));

    await expect(normalizeScanWithBackend({
      scanResult: scanResult(),
      approvedBlockIds: ["block_1"],
      fetch: fetchMock,
    })).rejects.toMatchObject({
      name: "ImportNormalizeApiError",
      status: 400,
      error: { code: "invalid_normalize_request", message: "Bad approval." },
    });
  });

  it("validates scan result and approved block ids before fetch", async () => {
    const fetchMock = vi.fn();

    await expect(normalizeScanWithBackend({ approvedBlockIds: ["block_1"], fetch: fetchMock }))
      .rejects.toBeInstanceOf(ImportNormalizeApiError);
    await expect(normalizeScanWithBackend({ scanResult: scanResult(), approvedBlockIds: [], fetch: fetchMock }))
      .rejects.toBeInstanceOf(ImportNormalizeApiError);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
