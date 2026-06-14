import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SEMANTIC_MAPPING_ENDPOINT,
  SemanticMappingApiError,
  proposeSemanticMappingsWithBackend,
} from "./backendSemanticMappingApi.js";

function genericImports() {
  return [{ importId: "import_1", measurements: [] }];
}

describe("proposeSemanticMappingsWithBackend", () => {
  it("posts generic imports as JSON to the default endpoint", async () => {
    const mappingResult = { schemaVersion: "labrat.semanticMappingResponse.v1", mappingSet: { mappings: [] } };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => mappingResult }));

    await expect(proposeSemanticMappingsWithBackend({
      genericImports: genericImports(),
      selectedImportIds: ["import_1"],
      scanSummary: { sheetCount: 1 },
      userGoal: "Find conversion.",
      priorDecisions: [{ mappingId: "mapping_1", status: "accepted" }],
      fetch: fetchMock,
    })).resolves.toBe(mappingResult);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_SEMANTIC_MAPPING_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      genericImports: genericImports(),
      selectedImportIds: ["import_1"],
      scanSummary: { sheetCount: 1 },
      userGoal: "Find conversion.",
      priorDecisions: [{ mappingId: "mapping_1", status: "accepted" }],
    });
  });

  it("supports custom endpoint and signal", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));

    await proposeSemanticMappingsWithBackend({
      genericImports: genericImports(),
      endpoint: "/custom",
      fetch: fetchMock,
      signal,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/custom");
    expect(init.signal).toBe(signal);
  });

  it("throws typed errors for backend failures and invalid inputs", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "invalid_semantic_mapping_request", message: "Bad imports." } }),
    }));

    await expect(proposeSemanticMappingsWithBackend({ genericImports: genericImports(), fetch: fetchMock }))
      .rejects.toMatchObject({
        name: "SemanticMappingApiError",
        status: 400,
        error: { code: "invalid_semantic_mapping_request", message: "Bad imports." },
      });
    await expect(proposeSemanticMappingsWithBackend({ genericImports: [], fetch: fetchMock }))
      .rejects.toBeInstanceOf(SemanticMappingApiError);
  });
});
