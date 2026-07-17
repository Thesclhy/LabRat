import { describe, expect, it, vi } from "vitest";
import {
  CHART_INTENT_KINDS,
  classifyChartIntentResponse,
  interpretProjectChartIntent,
  normalizeChartIntentResult,
} from "./chartIntentClient.js";

function jsonResponse(body, init = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status || 200,
    json: async () => body,
  };
}

describe("chartIntentClient", () => {
  it("classifies gateway responses into frontend review kinds", () => {
    expect(classifyChartIntentResponse({ clarification: { message: "Which experiment?" } }))
      .toBe(CHART_INTENT_KINDS.CLARIFICATION);
    expect(classifyChartIntentResponse({ sourceExtractProposal: { id: "source_extract_1" } }))
      .toBe(CHART_INTENT_KINDS.SOURCE_EXTRACT_PROPOSAL);
    expect(classifyChartIntentResponse({ sourceExtractPreview: { rows: [] } }))
      .toBe(CHART_INTENT_KINDS.SOURCE_EXTRACT_PREVIEW);
    expect(classifyChartIntentResponse({ dataPlanReview: { id: "data_plan_1" } }))
      .toBe(CHART_INTENT_KINDS.DATA_PLAN_REVIEW);
    expect(classifyChartIntentResponse({ chartProposalSet: { id: "chart_set_1" } }))
      .toBe(CHART_INTENT_KINDS.CHART_PROPOSAL_SET);
    expect(classifyChartIntentResponse({ chartSpecVisualPatch: { operations: [] } }))
      .toBe(CHART_INTENT_KINDS.CHART_SPEC_VISUAL_PATCH);
  });

  it("normalizes response objects without hiding the raw backend response", () => {
    const response = {
      schemaVersion: "labrat.chartInterpretResponse.v1",
      chartProposalSet: { id: "chart_set_1" },
      warnings: [{ code: "low_confidence" }],
    };

    expect(normalizeChartIntentResult(response, { entrypoint: "chart_review" })).toEqual({
      kind: CHART_INTENT_KINDS.CHART_PROPOSAL_SET,
      entrypoint: "chart_review",
      response,
      clarification: null,
      chartProposalSet: { id: "chart_set_1" },
      sourceExtractProposal: null,
      sourceExtractPreview: null,
      dataPlanReview: null,
      chartSpecVisualPatch: null,
      chartSpecDraft: null,
      warnings: [{ code: "low_confidence" }],
    });
  });

  it("calls the project-scoped chart intent gateway with entrypoint context", async () => {
    const fetch = vi.fn(async () => jsonResponse({
      schemaVersion: "labrat.chartInterpretResponse.v1",
      sourceExtractProposal: { id: "source_extract_1" },
    }));

    const result = await interpretProjectChartIntent("project_1", {
      prompt: "draw carbon distribution from P31 to BA32",
      entrypoint: "agent_drawer",
      context: { actionId: "agent_action_1" },
    }, { fetch });

    expect(result.kind).toBe(CHART_INTENT_KINDS.SOURCE_EXTRACT_PROPOSAL);
    expect(fetch).toHaveBeenCalledWith(
      "/api/projects/project_1/charts/interpret",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      prompt: "draw carbon distribution from P31 to BA32",
      persistAsProposal: true,
      entrypoint: "agent_drawer",
      context: { actionId: "agent_action_1" },
    });
  });
});
