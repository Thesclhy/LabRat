import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYSIS_PLAN_REVISION_VERSION,
  frozenPlanHash,
  pythonSourceHash,
  validateAnalysisPlanRevision,
} from "./analysisSchemas.js";

function validPlan(overrides = {}) {
  const source = [
    "def analyze(tables, labrat):",
    "    return {'result_table': [], 'traces': [], 'lineage': {}, 'summary': {}}",
  ].join("\n");
  return {
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    requestSummary: "Normalize selectivity.",
    selection: {
      selectionId: "analysis_selection_1",
      experimentIds: ["experiment_1"],
      fieldIds: ["field_selectivity_percent_number"],
      dependencyHash: "sha256_dependency",
      selectionHash: "sha256_selection",
    },
    processingSummary: [
      "Require all three selectivity components.",
      "Normalize retained rows to 100 percent.",
    ],
    calculationManifest: {
      inputs: [{
        fieldId: "field_selectivity_percent_number",
        fieldKey: "selectivity",
        unit: "percent",
      }],
      missingValuePolicy: {
        mode: "exclude_record",
        requiredFieldIds: ["field_selectivity_percent_number"],
      },
      derivedFields: [{
        fieldKey: "selectivity_normalized",
        inputFieldIds: ["field_selectivity_percent_number"],
        expression: "selectivity / total * 100",
        outputUnit: "percent",
      }],
      invariants: [{
        type: "row_sum",
        fieldKeys: ["selectivity_normalized"],
        target: 100,
        absoluteTolerance: 0.000001,
      }],
    },
    pythonProgram: {
      runtime: "labrat-python-v1",
      entrypoint: "analyze",
      source,
      sourceHash: pythonSourceHash(source),
    },
    expectedOutput: {
      shape: "experiment_traces",
      chartType: "stacked_bar",
      xField: "experiment_label",
      yFields: ["selectivity_normalized"],
    },
    warnings: [],
    ...overrides,
  };
}

test("accepts one frozen calculation manifest and exact Python program", () => {
  const plan = validPlan();
  const result = validateAnalysisPlanRevision(plan);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.match(frozenPlanHash(plan), /^sha256_/);
  assert.equal(frozenPlanHash(plan), frozenPlanHash({
    ...plan,
    warnings: [{ code: "display_only" }],
  }));
});

test("rejects mismatched Python hashes and missing-value policy", () => {
  const plan = validPlan({
    calculationManifest: {
      inputs: [{ fieldId: "field_selectivity_percent_number", fieldKey: "selectivity", unit: "percent" }],
      derivedFields: [],
      invariants: [],
    },
    pythonProgram: {
      runtime: "labrat-python-v1",
      entrypoint: "analyze",
      source: "def analyze(tables, labrat):\n    return {}",
      sourceHash: "sha256_wrong",
    },
  });
  const result = validateAnalysisPlanRevision(plan);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((item) => item.code), [
    "analysis_missing_value_policy_required",
    "analysis_python_hash_mismatch",
  ]);
});

test("rejects embedded authoritative result arrays", () => {
  const plan = validPlan({
    expectedOutput: {
      shape: "experiment_traces",
      chartType: "scatter",
      xValues: [1, 2],
      yValues: [3, 4],
    },
    resultRows: [{ experimentId: "experiment_1", value: 3 }],
  });
  const result = validateAnalysisPlanRevision(plan);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.code === "analysis_result_payload_forbidden"), true);
});

test("rejects authoritative arrays outside expectedOutput", () => {
  const result = validateAnalysisPlanRevision(validPlan({
    resultRows: [{ experimentId: "experiment_1", value: 3 }],
  }));

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.code === "analysis_result_payload_forbidden"), true);
});

test("rejects unsupported runtime and non-analyze entrypoint", () => {
  const plan = validPlan();
  plan.pythonProgram.runtime = "python-latest";
  plan.pythonProgram.entrypoint = "main";
  const result = validateAnalysisPlanRevision(plan);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((item) => item.code), [
    "analysis_runtime_unsupported",
    "analysis_entrypoint_invalid",
  ]);
});
