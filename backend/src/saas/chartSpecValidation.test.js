import test from "node:test";
import assert from "node:assert/strict";
import { validateChartSpecProposal } from "./chartSpecValidation.js";

function sourceRowsProposal(overrides = {}) {
  return {
    origin: "source_extract",
    chartType: "bar",
    title: "Carbon number distribution",
    x: { field: "carbon_number", label: "Carbon number" },
    y: { field: "percentage", label: "Percentage" },
    sourceSnapshot: {
      fields: [
        { fieldId: "carbon_number", label: "Carbon number" },
        { fieldId: "percentage", label: "Percentage" },
      ],
      rows: [{
        rowId: "row_1",
        values: { carbon_number: 1, percentage: 12.5 },
        sourceRefs: [{ sourceDocumentId: "source_1", sheetName: "Sheet1", cell: "B2" }],
      }],
    },
    ...overrides,
  };
}

test("validateChartSpecProposal accepts immutable source row snapshots", () => {
  const result = validateChartSpecProposal({ proposal: sourceRowsProposal() });

  assert.equal(result.ok, true);
  assert.equal(result.chartSpec.origin, "source_extract");
  assert.equal(result.chartSpec.sourceSnapshot.rows.length, 1);
  assert.equal(result.chartSpec.datasetCommitId, undefined);
});

test("validateChartSpecProposal accepts source-backed cross-experiment series", () => {
  const result = validateChartSpecProposal({
    proposal: sourceRowsProposal({
      chartType: "distribution_bar",
      seriesScope: { seriesKind: "component_distribution", xField: "carbon_number", yField: "percentage" },
      compatibleExperimentIds: ["experiment_1"],
      series: [{
        seriesId: "series_1",
        experimentId: "experiment_1",
        xField: "carbon_number",
        yField: "percentage",
      }],
      sourceSnapshot: {
        fields: [],
        series: [{
          seriesId: "series_1",
          experimentId: "experiment_1",
          rows: [{ values: { carbon_number: 1, percentage: 12.5 } }],
        }],
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.chartSpec.series.length, 1);
});

test("validateChartSpecProposal rejects proposals without source evidence", () => {
  assert.throws(() => validateChartSpecProposal({
    proposal: {
      chartType: "scatter",
      x: { field: "temperature" },
      y: { field: "conversion" },
    },
  }), (error) => error.code === "source_snapshot_required");
});

test("validateChartSpecProposal rejects empty source snapshots", () => {
  assert.throws(() => validateChartSpecProposal({
    proposal: sourceRowsProposal({ sourceSnapshot: { rows: [], series: [] } }),
  }), (error) => error.code === "invalid_chart_spec");
});

test("validateChartSpecProposal rejects unsupported source chart types", () => {
  assert.throws(() => validateChartSpecProposal({
    proposal: sourceRowsProposal({ chartType: "radar" }),
  }), (error) => error.code === "invalid_chart_spec");
});

test("validateChartSpecProposal rejects source series without snapshot rows", () => {
  assert.throws(() => validateChartSpecProposal({
    proposal: sourceRowsProposal({
      seriesScope: { seriesKind: "component_distribution" },
      compatibleExperimentIds: ["experiment_1"],
      series: [{
        seriesId: "series_1",
        experimentId: "experiment_1",
        xField: "carbon_number",
        yField: "percentage",
      }],
      sourceSnapshot: {
        series: [{ seriesId: "series_1", experimentId: "experiment_1", rows: [] }],
      },
    }),
  }), (error) => error.code === "chart_source_unresolved");
});
