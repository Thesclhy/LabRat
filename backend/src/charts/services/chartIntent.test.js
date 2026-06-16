import test from "node:test";
import assert from "node:assert/strict";
import { createReactionRateSupplementWorkbook } from "../../import/fixtures/workbookFixtures.js";
import { runImportScan } from "../../import/services/importPipeline.js";
import { normalizeApprovedScan } from "../../import/services/normalizer.js";
import { annotateSupplementDatasetPatch } from "../../saas/importRelationshipResolver.js";
import { createChartInterpretResponse } from "./chartIntent.js";

function masterTableImport() {
  return {
    importId: "import_master",
    schemaVersion: "labrat.genericImport.v1",
    experiments: [
      { experimentId: "exp_1", label: "Exp1", name: "Exp1" },
      { experimentId: "exp_2", label: "Exp2", name: "Exp2" },
    ],
    fields: [
      { fieldValueId: "label_1", experimentId: "exp_1", field: "label", role: "identifier", displayName: "Label", value: "Exp1", rawValue: "Exp1", rowIndex: 3, sourceRef: "src_label_1", confidence: 0.95 },
      { fieldValueId: "label_2", experimentId: "exp_2", field: "label", role: "identifier", displayName: "Label", value: "Exp2", rawValue: "Exp2", rowIndex: 4, sourceRef: "src_label_2", confidence: 0.95 },
      { fieldValueId: "cat_1", experimentId: "exp_1", field: "catalyst_type", role: "material", displayName: "Catalyst Type", value: "Ru/TiO2", rawValue: "Ru/TiO2", rowIndex: 3, sourceRef: "src_cat_1", confidence: 0.92 },
      { fieldValueId: "cat_2", experimentId: "exp_2", field: "catalyst_type", role: "material", displayName: "Catalyst Type", value: "Ru/TiO2", rawValue: "Ru/TiO2", rowIndex: 4, sourceRef: "src_cat_2", confidence: 0.92 },
      { fieldValueId: "temp_1", experimentId: "exp_1", field: "temperature", role: "condition", displayName: "Temperature (C)", value: 250, rawValue: "250", unit: "C", rowIndex: 3, sourceRef: "src_temp_1", confidence: 0.94 },
      { fieldValueId: "temp_2", experimentId: "exp_2", field: "temperature", role: "condition", displayName: "Temperature (C)", value: 275, rawValue: "275", unit: "C", rowIndex: 4, sourceRef: "src_temp_2", confidence: 0.94 },
      { fieldValueId: "solid_1", experimentId: "exp_1", field: "selectivity_solid", role: "measurement", displayName: "Selectivity Solid (%)", value: 92.8, rawValue: "92.8", unit: "%", rowIndex: 3, sourceRef: "src_solid_1", confidence: 0.91 },
      { fieldValueId: "solid_2", experimentId: "exp_2", field: "selectivity_solid", role: "measurement", displayName: "Selectivity Solid (%)", value: 93.1, rawValue: "93.1", unit: "%", rowIndex: 4, sourceRef: "src_solid_2", confidence: 0.91 },
      { fieldValueId: "liquid_1", experimentId: "exp_1", field: "selectivity_liquid", role: "measurement", displayName: "Selectivity Liquid (%)", value: 0.1, rawValue: "0.1", unit: "%", rowIndex: 3, sourceRef: "src_liquid_1", confidence: 0.91 },
      { fieldValueId: "liquid_2", experimentId: "exp_2", field: "selectivity_liquid", role: "measurement", displayName: "Selectivity Liquid (%)", value: 0.5, rawValue: "0.5", unit: "%", rowIndex: 4, sourceRef: "src_liquid_2", confidence: 0.91 },
      { fieldValueId: "gas_1", experimentId: "exp_1", field: "selectivity_gas", role: "measurement", displayName: "Selectivity Gas (%)", value: 0.35, rawValue: "0.35", unit: "%", rowIndex: 3, sourceRef: "src_gas_1", confidence: 0.91 },
      { fieldValueId: "gas_2", experimentId: "exp_2", field: "selectivity_gas", role: "measurement", displayName: "Selectivity Gas (%)", value: 0.24, rawValue: "0.24", unit: "%", rowIndex: 4, sourceRef: "src_gas_2", confidence: 0.91 },
      { fieldValueId: "carbon_1", experimentId: "exp_1", field: "carbon_balance", role: "measurement", displayName: "Carbon Balance (%)", value: 96.4, rawValue: "96.4", unit: "%", rowIndex: 3, sourceRef: "src_carbon_1", confidence: 0.9 },
      { fieldValueId: "carbon_2", experimentId: "exp_2", field: "carbon_balance", role: "measurement", displayName: "Carbon Balance (%)", value: 94.8, rawValue: "94.8", unit: "%", rowIndex: 4, sourceRef: "src_carbon_2", confidence: 0.9 },
      { fieldValueId: "c7_1", experimentId: "exp_1", field: "C7", role: "measurement", displayName: "C7", value: 9.4, rawValue: "9.4", unit: "%", rowIndex: 3, sourceRef: "src_c7_1", confidence: 0.9 },
      { fieldValueId: "c7_2", experimentId: "exp_2", field: "C7", role: "measurement", displayName: "C7", value: 1.1, rawValue: "1.1", unit: "%", rowIndex: 4, sourceRef: "src_c7_2", confidence: 0.9 },
      { fieldValueId: "c10_1", experimentId: "exp_1", field: "C10", role: "measurement", displayName: "C10", value: 20, rawValue: "20", unit: "%", rowIndex: 3, sourceRef: "src_c10_1", confidence: 0.9 },
      { fieldValueId: "c10_2", experimentId: "exp_2", field: "C10", role: "measurement", displayName: "C10", value: 3, rawValue: "3", unit: "%", rowIndex: 4, sourceRef: "src_c10_2", confidence: 0.9 },
    ],
    sources: [
      { sourceRef: "src_temp_1", sheet: "Sheet1", cell: "G3" },
      { sourceRef: "src_temp_2", sheet: "Sheet1", cell: "G4" },
      { sourceRef: "src_gas_1", sheet: "Sheet1", cell: "N3" },
      { sourceRef: "src_gas_2", sheet: "Sheet1", cell: "N4" },
      { sourceRef: "src_carbon_1", sheet: "Sheet1", cell: "O3" },
      { sourceRef: "src_carbon_2", sheet: "Sheet1", cell: "O4" },
    ],
  };
}

function reactionRateObservationImport() {
  const scanResult = runImportScan(createReactionRateSupplementWorkbook());
  const block = scanResult.sheets[0].blocks[0];
  const normalized = normalizeApprovedScan({ scanResult, approvedBlockIds: [block.blockId] });
  return annotateSupplementDatasetPatch(normalized.datasetPatch, {
    supplementType: "reaction_rate_time_series",
    targetExperimentIds: ["exp_30"],
  }).genericImports[0];
}

function masterImportWithConflictingColumnF() {
  const fields = Array.from({ length: 70 }, (_, index) => ({
    fieldValueId: `master_f_${index + 1}`,
    experimentId: `master_exp_${index + 1}`,
    field: "conflicting_master_column_f",
    role: "condition",
    displayName: "Master Column F Condition",
    value: index,
    rawValue: String(index),
    rowIndex: index + 3,
    sourceRef: `master_src_f_${index + 1}`,
    confidence: 0.99,
  }));
  return {
    importId: "master_conflict",
    schemaVersion: "labrat.genericImport.v1",
    experiments: fields.map((field, index) => ({
      experimentId: field.experimentId,
      label: `Master${index + 1}`,
      name: `Master${index + 1}`,
    })),
    fields,
    sources: fields.map((field, index) => ({
      sourceRef: field.sourceRef,
      sheet: "Master",
      cell: `F${index + 3}`,
      range: `F${index + 3}`,
    })),
  };
}

test("createChartInterpretResponse resolves gas selectivity vs temperature", async () => {
  const response = await createChartInterpretResponse({
    prompt: "plot gas selectivity vs temperature, grouped by catalyst",
    genericImports: [masterTableImport()],
    env: {},
  });

  assert.equal(response.schemaVersion, "labrat.chartInterpretResponse.v1");
  assert.equal(response.chartSpecDraft.schemaVersion, "labrat.chartSpec.v1.3");
  assert.equal(response.chartSpecDraft.chartType, "scatter");
  assert.equal(response.chartSpecDraft.x.label, "Temperature (C)");
  assert.equal(response.chartSpecDraft.y.label, "Selectivity Gas (%)");
  assert.equal(response.chartSpecDraft.groupBy.label, "Catalyst Type");
  assert.deepEqual(response.chartSpecDraft.x.sourceIds, ["temp_1", "temp_2"]);
  assert.deepEqual(response.chartSpecDraft.y.sourceIds, ["gas_1", "gas_2"]);
  assert.equal(response.chartSpecDraft.sourceRefs.includes("src_temp_1"), true);
  assert.equal(response.chartSpecDraft.sourceRefs.includes("src_gas_2"), true);
  assert.equal(response.clarification, null);
});

test("createChartInterpretResponse creates normalized selectivity transforms", async () => {
  const response = await createChartInterpretResponse({
    prompt: "stack gas liquid solid selectivity by experiment normalized to 100%",
    genericImports: [masterTableImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft.chartType, "stacked_bar");
  assert.equal(response.chartSpecDraft.schemaVersion, "labrat.chartSpec.v1.3");
  assert.equal(response.chartSpecDraft.transforms.some((transform) => transform.type === "normalize_sum_to_percent"), true);
});

test("createChartInterpretResponse creates C-number distribution drafts", async () => {
  const response = await createChartInterpretResponse({
    prompt: "plot normalized C-number distribution for experiments",
    genericImports: [masterTableImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft.chartType, "distribution_bar");
  assert.deepEqual(response.chartSpecDraft.yFields.map((field) => field.measurementComponent), ["C7", "C10"]);
  assert.equal(response.chartSpecDraft.transforms.some((transform) => transform.type === "pivot_longer"), true);
  assert.equal(response.chartSpecDraft.transforms.some((transform) => transform.type === "normalize_sum_to_percent"), true);
  assert.equal(response.clarification, null);
});

test("createChartInterpretResponse resolves point plot prompts", async () => {
  const response = await createChartInterpretResponse({
    prompt: "make a point plot of gas selectivity against temperature",
    genericImports: [masterTableImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft.schemaVersion, "labrat.chartSpec.v1.3");
  assert.equal(response.chartSpecDraft.chartType, "point");
  assert.equal(response.chartSpecDraft.x.label, "Temperature (C)");
  assert.equal(response.chartSpecDraft.y.label, "Selectivity Gas (%)");
});

test("createChartInterpretResponse creates multi-y selectivity drafts", async () => {
  const response = await createChartInterpretResponse({
    prompt: "plot gas liquid solid selectivity as grouped bars",
    genericImports: [masterTableImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft.chartType, "grouped_bar");
  assert.deepEqual(response.chartSpecDraft.yFields.map((field) => field.label), [
    "Selectivity Solid (%)",
    "Selectivity Liquid (%)",
    "Selectivity Gas (%)",
  ]);
});

test("createChartInterpretResponse creates stacked selectivity drafts", async () => {
  const response = await createChartInterpretResponse({
    prompt: "stack gas liquid solid selectivity by experiment",
    genericImports: [masterTableImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft.chartType, "stacked_bar");
  assert.equal(response.chartSpecDraft.x.label, "Label");
  assert.deepEqual(response.chartSpecDraft.yFields.map((field) => field.measurementComponent), ["solid", "liquid", "gas"]);
});

test("createChartInterpretResponse resolves named measurement bar charts by experiment", async () => {
  const response = await createChartInterpretResponse({
    prompt: "plot Carbon Balance (%) as a bar chart by experiment",
    genericImports: [masterTableImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft.schemaVersion, "labrat.chartSpec.v1.3");
  assert.equal(response.chartSpecDraft.chartType, "bar");
  assert.equal(response.chartSpecDraft.x.label, "Label");
  assert.equal(response.chartSpecDraft.y.label, "Carbon Balance (%)");
  assert.deepEqual(response.chartSpecDraft.y.sourceIds, ["carbon_1", "carbon_2"]);
  assert.equal(response.clarification, null);
});

test("createChartInterpretResponse resolves named measurements when numeric values include percent strings", async () => {
  const source = masterTableImport();
  const genericImport = {
    ...source,
    fields: source.fields.map((field) => (
      field.field === "carbon_balance"
        ? { ...field, value: `${field.value}%`, rawValue: `${field.rawValue}%` }
        : field
    )),
  };

  const response = await createChartInterpretResponse({
    prompt: "plot Carbon Balance (%) as a bar chart by experiment",
    genericImports: [genericImport],
    env: {},
  });

  assert.equal(response.chartSpecDraft.schemaVersion, "labrat.chartSpec.v1.3");
  assert.equal(response.chartSpecDraft.chartType, "bar");
  assert.equal(response.chartSpecDraft.y.label, "Carbon Balance (%)");
  assert.equal(response.clarification, null);
});

test("createChartInterpretResponse resolves reaction-rate observation set charts", async () => {
  const response = await createChartInterpretResponse({
    prompt: "plot adjusted rate vs reaction time for Exp30",
    genericImports: [reactionRateObservationImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft.schemaVersion, "labrat.chartSpec.v1.3");
  assert.equal(response.chartSpecDraft.chartType, "scatter");
  assert.equal(response.chartSpecDraft.x.label, "Reaction Time (min)");
  assert.equal(response.chartSpecDraft.y.label, "Adjusted Rate (M/s)");
  assert.equal(response.chartSpecDraft.x.sourceIds.length, 62);
  assert.equal(response.chartSpecDraft.y.sourceIds.length, 62);
  assert.equal(response.chartSpecDraft.dataCoverage.pairedRows, 62);
  assert.equal(response.clarification, null);
});

test("createChartInterpretResponse resolves natural axis, column, log-scale, and Excel-like style prompts", async () => {
  const response = await createChartInterpretResponse({
    prompt: "consider the graph made in this excel, the x-axis is reaction time(column F), the y-axis is Adjusted Rate(column H), and the y-axis of the graph should be log base 10 scale. replicate the aesthetics of the graph made in this excel file",
    genericImports: [reactionRateObservationImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft.schemaVersion, "labrat.chartSpec.v1.3");
  assert.equal(response.chartSpecDraft.chartType, "scatter");
  assert.equal(response.chartSpecDraft.x.label, "Reaction Time (min)");
  assert.equal(response.chartSpecDraft.y.label, "Adjusted Rate (M/s)");
  assert.equal(response.chartSpecDraft.axisOptions.y.scale, "log10");
  assert.equal(response.chartSpecDraft.renderStyle.preset, "excel_like");
  assert.equal(response.chartSpecDraft.renderStyle.traceMode, "lines+markers");
  assert.equal(response.chartSpecDraft.transforms.some((transform) => transform.type === "normalize_sum_to_percent"), false);
  assert.equal(response.clarification, null);
});

test("createChartInterpretResponse resolves hollow marker scatter prompts without connecting lines", async () => {
  const response = await createChartInterpretResponse({
    prompt: "plot adjusted rate vs reaction time for Exp30 with hollow markers, no connecting lines, and log base 10 y-axis",
    genericImports: [reactionRateObservationImport()],
    env: {},
  });

  assert.equal(response.clarification, null);
  assert.equal(response.chartSpecDraft.x.label, "Reaction Time (min)");
  assert.equal(response.chartSpecDraft.y.label, "Adjusted Rate (M/s)");
  assert.equal(response.chartSpecDraft.axisOptions.y.scale, "log10");
  assert.equal(response.chartSpecDraft.renderStyle.traceMode, "markers");
  assert.equal(response.chartSpecDraft.renderStyle.traces[0].marker.symbol, "circle-open");
});

test("createChartInterpretResponse lets markers-only override Excel-like line defaults", async () => {
  const response = await createChartInterpretResponse({
    prompt: "replicate the excel graph aesthetics but use open circles only with no line connection: adjusted rate vs reaction time",
    genericImports: [reactionRateObservationImport()],
    env: {},
  });

  assert.equal(response.clarification, null);
  assert.equal(response.chartSpecDraft.renderStyle.preset, "excel_like");
  assert.equal(response.chartSpecDraft.renderStyle.traceMode, "markers");
  assert.equal(response.chartSpecDraft.renderStyle.traces[0].marker.symbol, "circle-open");
});

test("createChartInterpretResponse does not let other imports' column hints override matching aliases", async () => {
  const response = await createChartInterpretResponse({
    prompt: "consider the graph made in this excel, the x-axis is reaction time(column F), the y-axis is Adjusted Rate(column H), and the y-axis of the graph should be log base 10 scale. replicate the aesthetics of the graph made in this excel file",
    genericImports: [masterImportWithConflictingColumnF(), reactionRateObservationImport()],
    env: {},
  });

  assert.equal(response.clarification, null);
  assert.equal(response.chartSpecDraft.x.label, "Reaction Time (min)");
  assert.equal(response.chartSpecDraft.y.label, "Adjusted Rate (M/s)");
  assert.equal(response.chartSpecDraft.axisOptions.y.scale, "log10");
});

test("createChartInterpretResponse returns clarification when field alias and column hint conflict", async () => {
  const response = await createChartInterpretResponse({
    prompt: "x-axis is reaction time column H, y-axis is adjusted rate column H",
    genericImports: [reactionRateObservationImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft, null);
  assert.match(response.clarification.message, /column hint point to different fields/i);
  assert.equal(response.clarification.options.some((option) => option.label === "Reaction Time (min)"), true);
  assert.equal(response.clarification.options.some((option) => option.label === "Adjusted Rate (M/s)"), true);
});

test("createChartInterpretResponse compiles AI ChartIntent v2 through backend validation", async () => {
  const response = await createChartInterpretResponse({
    prompt: "copy the workbook chart",
    genericImports: [reactionRateObservationImport()],
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [{ text: JSON.stringify({
          intentVersion: "labrat.chartIntent.v2",
          chartType: "scatter",
          data: {
            x: { fieldAlias: "reaction time", columnHint: "F" },
            y: { fieldAlias: "adjusted rate", columnHint: "H" },
          },
          encoding: {
            traceMode: "lines+markers",
            axes: {
              y: { scale: "log10" },
            },
          },
          style: {
            preset: "excel_like",
            showLegend: false,
          },
          rationale: "User asked to copy the workbook chart.",
        }) }],
      }),
    }),
  });

  assert.equal(response.chartSpecDraft.x.label, "Reaction Time (min)");
  assert.equal(response.chartSpecDraft.y.label, "Adjusted Rate (M/s)");
  assert.equal(response.chartSpecDraft.axisOptions.y.scale, "log10");
  assert.equal(response.chartSpecDraft.renderStyle.preset, "excel_like");
  assert.equal(response.clarification, null);
});

test("createChartInterpretResponse normalizes AI open-circle marker intents", async () => {
  const response = await createChartInterpretResponse({
    prompt: "plot hollow marker scatter",
    genericImports: [reactionRateObservationImport()],
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [{ text: JSON.stringify({
          intentVersion: "labrat.chartIntent.v2",
          chartType: "scatter",
          data: {
            x: { fieldAlias: "reaction time" },
            y: { fieldAlias: "adjusted rate" },
          },
          encoding: { traceMode: "markers" },
          style: {
            traces: [{ target: "primary", marker: { symbol: "open circle" } }],
          },
        }) }],
      }),
    }),
  });

  assert.equal(response.chartSpecDraft.renderStyle.traceMode, "markers");
  assert.equal(response.chartSpecDraft.renderStyle.traces[0].marker.symbol, "circle-open");
  assert.equal(response.clarification, null);
});

test("createChartInterpretResponse recognizes proportional selectivity rescaling to 100 percent", async () => {
  const response = await createChartInterpretResponse({
    prompt: "make a stacked bar chart of solid liquid gas selectivity and rescale them proportionally so each experiment sums to 100 percent",
    genericImports: [masterTableImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft.chartType, "stacked_bar");
  assert.deepEqual(response.chartSpecDraft.yFields.map((field) => field.measurementComponent), ["solid", "liquid", "gas"]);
  assert.equal(response.chartSpecDraft.transforms.some((transform) => transform.type === "normalize_sum_to_percent"), true);
});

test("createChartInterpretResponse returns clarification for nonexistent fields", async () => {
  const response = await createChartInterpretResponse({
    prompt: "plot unicorn sparkle vs moon phase",
    genericImports: [masterTableImport()],
    env: {},
  });

  assert.equal(response.chartSpecDraft, null);
  assert.match(response.clarification.message, /Which measurement/);
  assert.equal(response.clarification.options.some((option) => option.label === "Selectivity Gas (%)"), true);
});

test("createChartInterpretResponse ignores invalid AI fields and falls back safely", async () => {
  const response = await createChartInterpretResponse({
    prompt: "plot gas selectivity vs temperature",
    genericImports: [masterTableImport()],
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [{ text: JSON.stringify({ xFieldAlias: "moon phase", yFieldAlias: "made up output", chartType: "scatter" }) }],
      }),
    }),
  });

  assert.equal(response.chartSpecDraft.x.label, "Temperature (C)");
  assert.equal(response.chartSpecDraft.y.label, "Selectivity Gas (%)");
});
