import test from "node:test";
import assert from "node:assert/strict";
import { validateChartSpecProposal } from "./chartSpecValidation.js";

function datasetCommit() {
  return {
    id: "commit_1",
    datasetPayload: {
      genericImports: [{
        importId: "import_1",
        sources: [
          { sourceRef: "src_label_1" },
          { sourceRef: "src_temp_1" },
          { sourceRef: "src_solid_1" },
          { sourceRef: "src_liquid_1" },
          { sourceRef: "src_gas_1" },
          { sourceRef: "src_c7_1" },
          { sourceRef: "src_c8_1" },
        ],
        fields: [
          { fieldValueId: "label_1", sourceRef: "src_label_1" },
          { fieldValueId: "temp_1", sourceRef: "src_temp_1" },
          { fieldValueId: "solid_1", sourceRef: "src_solid_1" },
          { fieldValueId: "liquid_1", sourceRef: "src_liquid_1" },
          { fieldValueId: "gas_1", sourceRef: "src_gas_1" },
          { fieldValueId: "c7_1", sourceRef: "src_c7_1" },
          { fieldValueId: "c8_1", sourceRef: "src_c8_1" },
        ],
      }],
    },
  };
}

test("validateChartSpecProposal accepts point ChartSpec v1.3", () => {
  const result = validateChartSpecProposal({
    datasetCommit: datasetCommit(),
    proposal: {
      chartType: "point",
      title: "Gas Selectivity vs Temperature",
      x: { label: "Temperature", sourceIds: ["temp_1"], sourceRefs: ["src_temp_1"] },
      y: { label: "Gas Selectivity", sourceIds: ["gas_1"], sourceRefs: ["src_gas_1"] },
      axisOptions: { y: { scale: "log10", title: "Gas Selectivity" } },
      renderStyle: { preset: "excel_like", traceMode: "lines+markers", showLegend: false },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.chartSpec.schemaVersion, "labrat.chartSpec.v1.3");
  assert.equal(result.chartSpec.chartType, "point");
  assert.equal(result.chartSpec.axisOptions.y.scale, "log10");
  assert.equal(result.chartSpec.renderStyle.preset, "excel_like");
});

test("validateChartSpecProposal accepts distribution charts with transform inputs", () => {
  const result = validateChartSpecProposal({
    datasetCommit: datasetCommit(),
    proposal: {
      chartType: "distribution_bar",
      x: { label: "Carbon number", field: "carbon_number" },
      yFields: [
        { label: "C7", sourceIds: ["c7_1"], sourceRefs: ["src_c7_1"] },
        { label: "C8", sourceIds: ["c8_1"], sourceRefs: ["src_c8_1"] },
      ],
      transforms: [
        { type: "pivot_longer", inputFieldIds: ["c7_1", "c8_1"] },
        { type: "normalize_sum_to_percent", inputFieldIds: ["c7_1", "c8_1"] },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.chartSpec.chartType, "distribution_bar");
  assert.equal(result.chartSpec.transforms.some((transform) => transform.type === "normalize_sum_to_percent"), true);
});

test("validateChartSpecProposal rejects unresolved transform inputs", () => {
  assert.throws(() => validateChartSpecProposal({
    datasetCommit: datasetCommit(),
    proposal: {
      chartType: "stacked_bar",
      x: { label: "Label", sourceIds: ["label_1"], sourceRefs: ["src_label_1"] },
      yFields: [
        { label: "Solid", sourceIds: ["solid_1"], sourceRefs: ["src_solid_1"] },
        { label: "Gas", sourceIds: ["gas_1"], sourceRefs: ["src_gas_1"] },
      ],
      transforms: [{ type: "normalize_sum_to_percent", inputFieldIds: ["solid_1", "missing"] }],
    },
  }), (error) => error.code === "chart_source_unresolved");
});

test("validateChartSpecProposal rejects grouped and stacked bars with fewer than two yFields", () => {
  assert.throws(() => validateChartSpecProposal({
    datasetCommit: datasetCommit(),
    proposal: {
      chartType: "grouped_bar",
      x: { label: "Label", sourceIds: ["label_1"], sourceRefs: ["src_label_1"] },
      yFields: [{ label: "Gas", sourceIds: ["gas_1"], sourceRefs: ["src_gas_1"] }],
    },
  }), (error) => error.code === "invalid_chart_spec");
});

test("validateChartSpecProposal rejects unresolved yField sources", () => {
  assert.throws(() => validateChartSpecProposal({
    datasetCommit: datasetCommit(),
    proposal: {
      chartType: "stacked_bar",
      x: { label: "Label", sourceIds: ["label_1"], sourceRefs: ["src_label_1"] },
      yFields: [
        { label: "Gas", sourceIds: ["gas_1"], sourceRefs: ["src_gas_1"] },
        { label: "Missing", sourceIds: ["missing_y"], sourceRefs: ["src_gas_1"] },
      ],
    },
  }), (error) => error.code === "chart_source_unresolved");
});
