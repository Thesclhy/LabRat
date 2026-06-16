import { describe, expect, it, vi } from "vitest";
import {
  ChartInterpretApiError,
  DEFAULT_CHART_INTERPRET_ENDPOINT,
  interpretChartWithBackend,
} from "./backendChartInterpretApi.js";

function genericImports() {
  return [{ importId: "import_1", fields: [] }];
}

describe("interpretChartWithBackend", () => {
  it("posts prompt, generic imports, and mappings to the default endpoint", async () => {
    const result = { schemaVersion: "labrat.chartInterpretResponse.v1", chartSpecDraft: null };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => result }));

    await expect(interpretChartWithBackend({
      prompt: "plot gas selectivity vs temperature",
      genericImports: genericImports(),
      selectedImportIds: ["import_1"],
      selectedExperimentIds: ["exp_1"],
      mappingSets: [{ mappingSetId: "mapping_set_1" }],
      chartConstraints: { maxPoints: 100 },
      priorDecisions: [{ proposalId: "chart_1", status: "accepted" }],
      fetch: fetchMock,
    })).resolves.toBe(result);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_CHART_INTERPRET_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      prompt: "plot gas selectivity vs temperature",
      genericImports: genericImports(),
      selectedImportIds: ["import_1"],
      selectedExperimentIds: ["exp_1"],
      mappingSets: [{ mappingSetId: "mapping_set_1" }],
      chartConstraints: { maxPoints: 100 },
      priorDecisions: [{ proposalId: "chart_1", status: "accepted" }],
    });
  });

  it("throws typed errors for invalid input and backend failures", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "invalid_chart_interpret_request", message: "Bad prompt." } }),
    }));

    await expect(interpretChartWithBackend({ prompt: "", genericImports: genericImports(), fetch: fetchMock }))
      .rejects.toBeInstanceOf(ChartInterpretApiError);
    await expect(interpretChartWithBackend({ prompt: "plot x", genericImports: [], fetch: fetchMock }))
      .rejects.toBeInstanceOf(ChartInterpretApiError);
    await expect(interpretChartWithBackend({ prompt: "plot x", genericImports: genericImports(), fetch: fetchMock }))
      .rejects.toMatchObject({
        name: "ChartInterpretApiError",
        status: 400,
        error: { code: "invalid_chart_interpret_request", message: "Bad prompt." },
      });
  });
});

