import test from "node:test";
import assert from "node:assert/strict";
import { createChartProposalResponse } from "./chartProposal.js";

function genericImport() {
  return {
    importId: "import_1",
    schemaVersion: "labrat.genericImport.v1",
    experiments: [
      { experimentId: "exp_1", name: "Exp1", metadata: [] },
      { experimentId: "exp_2", name: "Exp1", metadata: [] },
    ],
    measurements: [
      { measurementId: "m_time_1", experimentId: "exp_1", rowIndex: 2, field: "time", displayName: "Time", value: 0, rawValue: "0", unit: "min", sourceRef: "src_time_1", confidence: 0.9 },
      { measurementId: "m_conv_1", experimentId: "exp_1", rowIndex: 2, field: "conversion", displayName: "Conversion", value: 0, rawValue: "0", unit: "%", sourceRef: "src_conv_1", confidence: 0.86 },
      { measurementId: "m_time_2", experimentId: "exp_2", rowIndex: 3, field: "time", displayName: "Time", value: 10, rawValue: "10", unit: "min", sourceRef: "src_time_2", confidence: 0.9 },
      { measurementId: "m_conv_2", experimentId: "exp_2", rowIndex: 3, field: "conversion", displayName: "Conversion", value: 25, rawValue: "25", unit: "%", sourceRef: "src_conv_2", confidence: 0.86 },
    ],
    sources: [],
  };
}

test("createChartProposalResponse proposes paired scatter charts", async () => {
  const response = await createChartProposalResponse({
    genericImports: [genericImport()],
    env: {},
    createdAt: "2026-06-10T00:00:00.000Z",
  });

  assert.equal(response.schemaVersion, "labrat.chartProposalResponse.v1");
  assert.equal(response.proposalSet.schemaVersion, "labrat.chartProposalSet.v1");
  assert.equal(response.proposalSet.sourceImportIds[0], "import_1");
  assert.equal(response.proposalSet.proposals.length, 1);
  const proposal = response.proposalSet.proposals[0];
  assert.equal(proposal.chartType, "scatter");
  assert.equal(proposal.x.field, "time");
  assert.equal(proposal.y.field, "conversion");
  assert.equal(proposal.requiresReview, true);
  assert.equal(response.proposalSet.warnings.some((warning) => warning.code === "ai_unavailable"), true);
});

test("createChartProposalResponse reports when no candidates are available", async () => {
  const response = await createChartProposalResponse({
    genericImports: [{ importId: "import_empty", experiments: [], measurements: [], sources: [] }],
    env: {},
  });

  assert.equal(response.proposalSet.proposals.length, 0);
  assert.equal(response.proposalSet.warnings.some((warning) => warning.code === "no_chart_candidates"), true);
});
