import test from "node:test";
import assert from "node:assert/strict";
import {
  CHART_PROPOSAL_RESPONSE_VERSION,
  shapeChartProposalResponse,
  validateChartProposalRequest,
} from "./chartProposalSchemas.js";

test("validateChartProposalRequest accepts generic imports and mapping sets", () => {
  const result = validateChartProposalRequest({
    genericImports: [{ importId: "import_1" }],
    mappingSet: { mappingSetId: "mapping_set_1" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.genericImports[0].importId, "import_1");
  assert.equal(result.value.mappingSets[0].mappingSetId, "mapping_set_1");
});

test("validateChartProposalRequest rejects missing generic imports", () => {
  const result = validateChartProposalRequest({ genericImports: [] });

  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("At least one generic import is required."), true);
});

test("shapeChartProposalResponse returns a stable response envelope", () => {
  const response = shapeChartProposalResponse({
    proposalSet: {
      proposalSetId: "chart_set_1",
      sourceImportIds: ["import_1"],
      proposals: [{ proposalId: "chart_1" }],
      warnings: [],
    },
  });

  assert.equal(response.schemaVersion, CHART_PROPOSAL_RESPONSE_VERSION);
  assert.equal(response.proposalSet.schemaVersion, "labrat.chartProposalSet.v1");
  assert.equal(response.summary.proposalCount, 1);
});
