import assert from "node:assert/strict";
import { test } from "node:test";

import { validateChartSpecProposal } from "./chartSpecValidation.js";

function chartSpec() {
  return {
    schemaVersion: "labrat.chartSpec.v3",
    origin: "analysis_result",
    status: "accepted",
    chartType: "bar",
    title: "Carbon number distribution",
    analysisThreadId: "thread_1",
    analysisPlanRevisionId: "revision_1",
    analysisRunId: "run_1",
    analysisResultId: "result_1",
    sourceSelections: [{
      sourceSelectionId: "selection_1",
      regionUnderstandingRevisionId: "region_revision_1",
      sourceDocumentId: "source_1",
      sheetName: "Carbon",
      range: "Q69:AI69",
    }],
    sourceRefs: [],
    plotly: {
      data: [{
        traceId: "exp33",
        meta: { labrat: { traceId: "exp33" } },
        type: "bar",
        name: "Exp33",
        x: ["C1", "C2"],
        y: [1, 2],
      }],
      layout: { title: "Carbon number distribution" },
    },
    traceCatalog: [{
      traceId: "exp33",
      name: "Exp33",
      type: "bar",
      pointCount: 2,
    }],
    defaultChartView: { visibleTraceIds: ["exp33"] },
  };
}

test("accepts a complete Plotly-backed v3 analysis ChartSpec", () => {
  const result = validateChartSpecProposal({ proposal: chartSpec() });

  assert.equal(result.ok, true);
  assert.deepEqual(result.chartSpec.plotly.data[0].x, ["C1", "C2"]);
});

test("rejects missing source selections and incomplete trace catalogs", () => {
  const proposal = chartSpec();
  proposal.sourceSelections = [];
  proposal.traceCatalog = [];

  assert.throws(
    () => validateChartSpecProposal({ proposal }),
    (error) => error.code === "invalid_analysis_chart_spec",
  );
});

test("rejects empty, duplicate, and unknown default curve selections", () => {
  const empty = chartSpec();
  empty.defaultChartView.visibleTraceIds = [];
  assert.throws(
    () => validateChartSpecProposal({ proposal: empty }),
    /at least one unique trace id/i,
  );

  const unknown = chartSpec();
  unknown.defaultChartView.visibleTraceIds = ["other"];
  assert.throws(
    () => validateChartSpecProposal({ proposal: unknown }),
    (error) => error.code === "analysis_chart_trace_unknown",
  );
});
