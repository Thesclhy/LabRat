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

function analysisResultProposal(overrides = {}) {
  const base = {
    schemaVersion: "labrat.chartSpec.v2",
    origin: "analysis_result",
    status: "accepted",
    chartType: "scatter",
    title: "Reaction rate over time",
    analysisThreadId: "analysis_thread_1",
    analysisPlanRevisionId: "analysis_plan_revision_1",
    analysisRunId: "analysis_run_1",
    analysisResultId: "analysis_result_1",
    planHash: "sha256_plan_1",
    selectionHash: "sha256_selection_1",
    dependencyHash: "sha256_dependency_1",
    inputHash: "sha256_selection_1",
    programHash: "sha256_program_1",
    resultHash: "sha256_result_1",
    resultPreviewHash: "sha256_preview_1",
    runtimeVersion: "labrat-python-v1",
    inputSnapshotRefs: [{
      experimentId: "experiment_1",
      headId: "head_1",
      snapshotId: "snapshot_1",
      recordIndex: 0,
      sourceRecordId: "snapshot_1:0",
      contentHash: "sha256_snapshot_1",
      dependencyHash: "sha256_snapshot_dependency_1",
    }],
    traceCatalog: [{
      traceId: "trace_1",
      experimentId: "experiment_1",
      experimentLabel: "Exp 1",
      xField: "reaction_time",
      yField: "reaction_rate",
      xUnit: "min",
      yUnit: "mmol/g/min",
      x: [0, 10],
      y: [1, 2],
      sourceRecordIds: ["snapshot_1:0"],
    }],
    defaultChartView: { visibleTraceIds: ["trace_1"] },
    x: { field: "reaction_time", label: "Reaction time", unit: "min" },
    y: { field: "reaction_rate", label: "Reaction rate", unit: "mmol/g/min" },
  };
  return { ...base, ...overrides };
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

test("validateChartSpecProposal accepts complete analysis-result trace catalogs", () => {
  const result = validateChartSpecProposal({
    proposal: analysisResultProposal(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.chartSpec.schemaVersion, "labrat.chartSpec.v2");
  assert.equal(result.chartSpec.origin, "analysis_result");
  assert.equal(result.chartSpec.traceCatalog.length, 1);
});

test("validateChartSpecProposal rejects incomplete analysis lineage and default views", () => {
  assert.throws(() => validateChartSpecProposal({
    proposal: analysisResultProposal({
      traceCatalog: [{
        ...analysisResultProposal().traceCatalog[0],
        sourceRecordIds: [],
      }],
    }),
  }), (error) => error.code === "analysis_chart_lineage_required");

  assert.throws(() => validateChartSpecProposal({
    proposal: analysisResultProposal({
      defaultChartView: { visibleTraceIds: ["trace_unknown"] },
    }),
  }), (error) => error.code === "analysis_chart_trace_unknown");
});
