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

function selectivityImport() {
  return {
    importId: "import_selectivity",
    schemaVersion: "labrat.genericImport.v1",
    experiments: [
      { experimentId: "exp_1", label: "Exp1", name: "Exp1" },
      { experimentId: "exp_2", label: "Exp2", name: "Exp2" },
    ],
    fields: [
      { fieldValueId: "label_1", experimentId: "exp_1", field: "label", role: "identifier", displayName: "Label", value: "Exp1", rawValue: "Exp1", rowIndex: 2, sourceRef: "src_label_1", confidence: 0.95 },
      { fieldValueId: "label_2", experimentId: "exp_2", field: "label", role: "identifier", displayName: "Label", value: "Exp2", rawValue: "Exp2", rowIndex: 3, sourceRef: "src_label_2", confidence: 0.95 },
      { fieldValueId: "cat_1", experimentId: "exp_1", field: "catalyst_type", role: "material", displayName: "Catalyst Type", value: "Ru/TiO2", rawValue: "Ru/TiO2", rowIndex: 2, sourceRef: "src_cat_1", confidence: 0.92 },
      { fieldValueId: "cat_2", experimentId: "exp_2", field: "catalyst_type", role: "material", displayName: "Catalyst Type", value: "Ru/TiO2", rawValue: "Ru/TiO2", rowIndex: 3, sourceRef: "src_cat_2", confidence: 0.92 },
      { fieldValueId: "temp_1", experimentId: "exp_1", field: "temperature", role: "condition", displayName: "Temperature (C)", value: 250, rawValue: "250", unit: "C", rowIndex: 2, sourceRef: "src_temp_1", confidence: 0.94 },
      { fieldValueId: "temp_2", experimentId: "exp_2", field: "temperature", role: "condition", displayName: "Temperature (C)", value: 275, rawValue: "275", unit: "C", rowIndex: 3, sourceRef: "src_temp_2", confidence: 0.94 },
      { fieldValueId: "solid_1", experimentId: "exp_1", field: "selectivity_solid", role: "measurement", displayName: "Selectivity Solid (%)", value: 92.8, rawValue: "92.8", unit: "%", rowIndex: 2, sourceRef: "src_solid_1", confidence: 0.91 },
      { fieldValueId: "solid_2", experimentId: "exp_2", field: "selectivity_solid", role: "measurement", displayName: "Selectivity Solid (%)", value: 93.1, rawValue: "93.1", unit: "%", rowIndex: 3, sourceRef: "src_solid_2", confidence: 0.91 },
      { fieldValueId: "liquid_1", experimentId: "exp_1", field: "selectivity_liquid", role: "measurement", displayName: "Selectivity Liquid (%)", value: 0.1, rawValue: "0.1", unit: "%", rowIndex: 2, sourceRef: "src_liquid_1", confidence: 0.91 },
      { fieldValueId: "liquid_2", experimentId: "exp_2", field: "selectivity_liquid", role: "measurement", displayName: "Selectivity Liquid (%)", value: 0.5, rawValue: "0.5", unit: "%", rowIndex: 3, sourceRef: "src_liquid_2", confidence: 0.91 },
      { fieldValueId: "gas_1", experimentId: "exp_1", field: "selectivity_gas", role: "measurement", displayName: "Selectivity Gas (%)", value: 0.35, rawValue: "0.35", unit: "%", rowIndex: 2, sourceRef: "src_gas_1", confidence: 0.91 },
      { fieldValueId: "gas_2", experimentId: "exp_2", field: "selectivity_gas", role: "measurement", displayName: "Selectivity Gas (%)", value: 0.24, rawValue: "0.24", unit: "%", rowIndex: 3, sourceRef: "src_gas_2", confidence: 0.91 },
    ],
    sources: [],
  };
}

function carbonDistributionImport() {
  return {
    importId: "import_carbon_distribution",
    schemaVersion: "labrat.genericImport.v1",
    experiments: [
      { experimentId: "exp_1", label: "Exp1", name: "Exp1" },
      { experimentId: "exp_2", label: "Exp2", name: "Exp2" },
    ],
    fields: [
      { fieldValueId: "label_1", experimentId: "exp_1", field: "label", role: "identifier", displayName: "Label", value: "Exp1", rawValue: "Exp1", rowIndex: 2, sourceRef: "src_label_1", confidence: 0.95 },
      { fieldValueId: "label_2", experimentId: "exp_2", field: "label", role: "identifier", displayName: "Label", value: "Exp2", rawValue: "Exp2", rowIndex: 3, sourceRef: "src_label_2", confidence: 0.95 },
      { fieldValueId: "c7_1", experimentId: "exp_1", field: "C7", role: "measurement", displayName: "C7", value: 9.4, rawValue: "9.4", unit: "%", rowIndex: 2, sourceRef: "src_c7_1", confidence: 0.9 },
      { fieldValueId: "c7_2", experimentId: "exp_2", field: "C7", role: "measurement", displayName: "C7", value: 1.1, rawValue: "1.1", unit: "%", rowIndex: 3, sourceRef: "src_c7_2", confidence: 0.9 },
      { fieldValueId: "c8_1", experimentId: "exp_1", field: "C8", role: "measurement", displayName: "C8", value: 20, rawValue: "20", unit: "%", rowIndex: 2, sourceRef: "src_c8_1", confidence: 0.9 },
      { fieldValueId: "c8_2", experimentId: "exp_2", field: "C8", role: "measurement", displayName: "C8", value: 3, rawValue: "3", unit: "%", rowIndex: 3, sourceRef: "src_c8_2", confidence: 0.9 },
      { fieldValueId: "c10_1", experimentId: "exp_1", field: "C10", role: "measurement", displayName: "C10", value: 18, rawValue: "18", unit: "%", rowIndex: 2, sourceRef: "src_c10_1", confidence: 0.9 },
      { fieldValueId: "c10_2", experimentId: "exp_2", field: "C10", role: "measurement", displayName: "C10", value: 5, rawValue: "5", unit: "%", rowIndex: 3, sourceRef: "src_c10_2", confidence: 0.9 },
    ],
    sources: [],
  };
}

function rankingImport() {
  return {
    importId: "import_rank",
    schemaVersion: "labrat.genericImport.v1",
    experiments: [
      { experimentId: "exp_1", label: "Exp1", name: "Exp1" },
      { experimentId: "exp_2", label: "Exp2", name: "Exp2" },
      { experimentId: "exp_3", label: "Exp3", name: "Exp3" },
    ],
    fields: [
      { fieldValueId: "label_1", experimentId: "exp_1", field: "label", role: "identifier", displayName: "Label", value: "Exp1", rawValue: "Exp1", rowIndex: 2, sourceRef: "src_label_1", confidence: 0.95 },
      { fieldValueId: "label_2", experimentId: "exp_2", field: "label", role: "identifier", displayName: "Label", value: "Exp2", rawValue: "Exp2", rowIndex: 3, sourceRef: "src_label_2", confidence: 0.95 },
      { fieldValueId: "label_3", experimentId: "exp_3", field: "label", role: "identifier", displayName: "Label", value: "Exp3", rawValue: "Exp3", rowIndex: 4, sourceRef: "src_label_3", confidence: 0.95 },
      { fieldValueId: "cat_1", experimentId: "exp_1", field: "catalyst_type", role: "material", displayName: "Catalyst Type", value: "Ru/TiO2", rawValue: "Ru/TiO2", rowIndex: 2, sourceRef: "src_cat_1", confidence: 0.92 },
      { fieldValueId: "cat_2", experimentId: "exp_2", field: "catalyst_type", role: "material", displayName: "Catalyst Type", value: "Pt/C", rawValue: "Pt/C", rowIndex: 3, sourceRef: "src_cat_2", confidence: 0.92 },
      { fieldValueId: "cat_3", experimentId: "exp_3", field: "catalyst_type", role: "material", displayName: "Catalyst Type", value: "Ru/TiO2", rawValue: "Ru/TiO2", rowIndex: 4, sourceRef: "src_cat_3", confidence: 0.92 },
      { fieldValueId: "temp_1", experimentId: "exp_1", field: "temperature", role: "condition", displayName: "Temperature (C)", value: 240, rawValue: "240", unit: "C", rowIndex: 2, sourceRef: "src_temp_1", confidence: 0.94 },
      { fieldValueId: "temp_2", experimentId: "exp_2", field: "temperature", role: "condition", displayName: "Temperature (C)", value: 260, rawValue: "260", unit: "C", rowIndex: 3, sourceRef: "src_temp_2", confidence: 0.94 },
      { fieldValueId: "temp_3", experimentId: "exp_3", field: "temperature", role: "condition", displayName: "Temperature (C)", value: 280, rawValue: "280", unit: "C", rowIndex: 4, sourceRef: "src_temp_3", confidence: 0.94 },
      { fieldValueId: "pressure_1", experimentId: "exp_1", field: "pressure", role: "condition", displayName: "Pressure (bar)", value: 60, rawValue: "60", unit: "bar", rowIndex: 2, sourceRef: "src_pressure_1", confidence: 0.94 },
      { fieldValueId: "pressure_2", experimentId: "exp_2", field: "pressure", role: "condition", displayName: "Pressure (bar)", value: 60, rawValue: "60", unit: "bar", rowIndex: 3, sourceRef: "src_pressure_2", confidence: 0.94 },
      { fieldValueId: "pressure_3", experimentId: "exp_3", field: "pressure", role: "condition", displayName: "Pressure (bar)", value: 60, rawValue: "60", unit: "bar", rowIndex: 4, sourceRef: "src_pressure_3", confidence: 0.94 },
      { fieldValueId: "gas_1", experimentId: "exp_1", field: "selectivity_gas", role: "measurement", displayName: "Selectivity Gas (%)", value: 0.2, rawValue: "0.2", unit: "%", rowIndex: 2, sourceRef: "src_gas_1", confidence: 0.91 },
      { fieldValueId: "gas_2", experimentId: "exp_2", field: "selectivity_gas", role: "measurement", displayName: "Selectivity Gas (%)", value: 0.8, rawValue: "0.8", unit: "%", rowIndex: 3, sourceRef: "src_gas_2", confidence: 0.91 },
      { fieldValueId: "gas_3", experimentId: "exp_3", field: "selectivity_gas", role: "measurement", displayName: "Selectivity Gas (%)", value: 1.6, rawValue: "1.6", unit: "%", rowIndex: 4, sourceRef: "src_gas_3", confidence: 0.91 },
    ],
    sources: [],
  };
}

function lowPairImport() {
  const base = rankingImport();
  return {
    ...base,
    fields: base.fields.filter((field) => field.fieldValueId !== "gas_2" && field.fieldValueId !== "gas_3"),
  };
}

function aiFetch(text) {
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      return { content: [{ text }] };
    },
  });
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
  assert.equal(proposal.origin, "deterministic_recipe");
  assert.equal(typeof proposal.score, "number");
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

test("createChartProposalResponse proposes grouped and stacked selectivity family charts", async () => {
  const response = await createChartProposalResponse({
    genericImports: [selectivityImport()],
    env: {},
  });

  const grouped = response.proposalSet.proposals.find((proposal) => proposal.chartType === "grouped_bar");
  const stacked = response.proposalSet.proposals.find((proposal) => proposal.chartType === "stacked_bar");
  assert.ok(grouped);
  assert.ok(stacked);
  assert.deepEqual(grouped.yFields.map((field) => field.measurementComponent), ["solid", "liquid", "gas"]);
  assert.equal(grouped.x.label, "Label");
  assert.equal(stacked.yFields.length, 3);
  const normalized = response.proposalSet.proposals.find((proposal) => (
    proposal.chartType === "stacked_bar"
    && proposal.transforms?.some((transform) => transform.type === "normalize_sum_to_percent")
  ));
  assert.ok(normalized);
});

test("createChartProposalResponse proposes C-number distribution charts", async () => {
  const response = await createChartProposalResponse({
    genericImports: [carbonDistributionImport()],
    env: {},
  });

  const distribution = response.proposalSet.proposals.find((proposal) => proposal.chartType === "distribution_bar");
  const normalized = response.proposalSet.proposals.find((proposal) => (
    proposal.chartType === "distribution_bar"
    && proposal.transforms?.some((transform) => transform.type === "normalize_sum_to_percent")
  ));
  assert.ok(distribution);
  assert.ok(normalized);
  assert.deepEqual(distribution.yFields.map((field) => field.measurementComponent), ["C7", "C8", "C10"]);
  assert.equal(distribution.transforms.some((transform) => transform.type === "pivot_longer"), true);
});

test("createChartProposalResponse does not reintroduce rejected proposal ids as proposed", async () => {
  const baseline = await createChartProposalResponse({
    genericImports: [genericImport()],
    env: {},
  });
  const proposalId = baseline.proposalSet.proposals[0].proposalId;

  const response = await createChartProposalResponse({
    genericImports: [genericImport()],
    priorDecisions: [{ proposalId, status: "rejected" }],
    env: {},
  });

  assert.equal(response.proposalSet.proposals.some((proposal) => proposal.proposalId === proposalId && proposal.status === "proposed"), false);
});

test("createChartProposalResponse ranks useful condition sweeps above label bars", async () => {
  const response = await createChartProposalResponse({
    genericImports: [rankingImport()],
    userGoal: "Find gas selectivity trends with temperature",
    projectProfile: { researchGoal: "Optimize gas selectivity across reaction conditions." },
    env: {},
  });

  const first = response.proposalSet.proposals[0];
  assert.equal(first.chartType, "scatter");
  assert.match(first.x.field, /temperature/);
  assert.match(first.y.field, /selectivity_gas/);
  assert.equal(first.score >= 0.7, true);
  const pressure = response.proposalSet.proposals.find((proposal) => /pressure/.test(proposal.x.field));
  assert.equal(pressure.warnings.some((warning) => warning.code === "x_mostly_constant"), true);
  assert.equal(first.score > pressure.score, true);
});

test("createChartProposalResponse warns and lowers score for low paired counts", async () => {
  const response = await createChartProposalResponse({
    genericImports: [lowPairImport()],
    env: {},
  });

  const proposal = response.proposalSet.proposals.find((item) => /selectivity_gas/.test(item.y.field));
  assert.ok(proposal);
  assert.equal(proposal.warnings.some((warning) => warning.code === "low_pair_count"), true);
  assert.equal(proposal.score < 0.8, true);
});

test("createChartProposalResponse compiles AI chart intents into validated proposals", async () => {
  const response = await createChartProposalResponse({
    genericImports: [rankingImport()],
    userGoal: "Recommend useful gas selectivity charts.",
    env: { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL: "test-model" },
    fetchImpl: aiFetch(JSON.stringify({
      intents: [{
        chartType: "scatter",
        xAlias: "temperature",
        yAlias: "gas selectivity",
        groupByAlias: "catalyst",
        title: "Gas Selectivity vs Temperature by Catalyst",
        rationale: "Temperature and catalyst are likely drivers of gas selectivity.",
      }],
    })),
  });

  const aiProposal = response.proposalSet.proposals.find((proposal) => proposal.origin === "ai_intent");
  assert.ok(aiProposal);
  assert.equal(aiProposal.chartType, "scatter");
  assert.match(aiProposal.x.field, /temperature/);
  assert.match(aiProposal.y.field, /selectivity_gas/);
  assert.equal(aiProposal.groupBy.field, "catalyst_type");
  assert.equal(aiProposal.aiIntent.yFieldAlias, "gas selectivity");
  assert.equal(response.proposalSet.ai.used, true);
});

test("createChartProposalResponse rejects unresolved AI intents without hallucinating fields", async () => {
  const response = await createChartProposalResponse({
    genericImports: [rankingImport()],
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: aiFetch(JSON.stringify({
      intents: [{
        chartType: "scatter",
        xAlias: "moon phase",
        yAlias: "imaginary yield",
        title: "Fake chart",
        rationale: "This should not resolve.",
      }],
    })),
  });

  assert.equal(response.proposalSet.proposals.some((proposal) => /moon|imaginary/i.test(`${proposal.title} ${proposal.x?.field} ${proposal.y?.field}`)), false);
  assert.equal(response.proposalSet.warnings.some((warning) => warning.code === "ai_chart_intent_unresolved"), true);
});
