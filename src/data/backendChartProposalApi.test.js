import { describe, expect, it, vi } from "vitest";
import {
  ChartProposalApiError,
  DEFAULT_CHART_PROPOSAL_ENDPOINT,
  proposeChartsWithBackend,
} from "./backendChartProposalApi.js";

function genericImports() {
  return [{ importId: "import_1", measurements: [] }];
}

describe("proposeChartsWithBackend", () => {
  it("posts generic imports and mapping sets as JSON to the default endpoint", async () => {
    const chartResult = { schemaVersion: "labrat.chartProposalResponse.v1", proposalSet: { proposals: [] } };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => chartResult }));

    await expect(proposeChartsWithBackend({
      genericImports: genericImports(),
      selectedImportIds: ["import_1"],
      mappingSets: [{ mappingSetId: "mapping_set_1" }],
      userGoal: "Show conversion over time.",
      chartConstraints: { maxProposals: 3 },
      priorDecisions: [{ proposalId: "chart_1", status: "rejected" }],
      fetch: fetchMock,
    })).resolves.toBe(chartResult);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_CHART_PROPOSAL_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      genericImports: genericImports(),
      selectedImportIds: ["import_1"],
      mappingSets: [{ mappingSetId: "mapping_set_1" }],
      userGoal: "Show conversion over time.",
      chartConstraints: { maxProposals: 3 },
      priorDecisions: [{ proposalId: "chart_1", status: "rejected" }],
    });
  });

  it("supports custom endpoint and signal", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));

    await proposeChartsWithBackend({
      genericImports: genericImports(),
      endpoint: "/custom-charts",
      fetch: fetchMock,
      signal,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/custom-charts");
    expect(init.signal).toBe(signal);
  });

  it("throws typed errors for backend failures and invalid inputs", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "invalid_chart_proposal_request", message: "Bad imports." } }),
    }));

    await expect(proposeChartsWithBackend({ genericImports: genericImports(), fetch: fetchMock }))
      .rejects.toMatchObject({
        name: "ChartProposalApiError",
        status: 400,
        error: { code: "invalid_chart_proposal_request", message: "Bad imports." },
      });
    await expect(proposeChartsWithBackend({ genericImports: [], fetch: fetchMock }))
      .rejects.toBeInstanceOf(ChartProposalApiError);
  });
});
