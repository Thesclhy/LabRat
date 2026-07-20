import assert from "node:assert/strict";
import test from "node:test";

import { validateAnalysisResult } from "./analysisResultValidation.js";

function normalizationFixture({
  rowSum = 100,
  traceY = [50, 50],
  sourceRecordIds = ["snapshot_1:0"],
} = {}) {
  const selection = {
    selectionHash: "sha256_selection_1",
    records: [{
      experimentId: "experiment_1",
      experimentLabel: "Exp 1",
      snapshotId: "snapshot_1",
      recordIndex: 0,
      fields: [],
      series: [],
    }],
  };
  const plan = {
    programHash: "sha256_program_1",
    runtimeVersion: "labrat-python-v1",
    calculationManifest: {
      inputs: [],
      derivedFields: [
        { fieldKey: "solid", unit: "percent" },
        { fieldKey: "liquid", unit: "percent" },
        { fieldKey: "gas", unit: "percent" },
      ],
      missingValuePolicy: { mode: "exclude_record", requiredFieldIds: [] },
      invariants: [{
        type: "row_sum",
        fieldKeys: ["solid", "liquid", "gas"],
        target: 100,
        absoluteTolerance: 0.000001,
      }],
    },
    expectedOutput: {
      shape: "experiment_traces",
      chartType: "stacked_bar",
      xField: "experiment_label",
      yFields: ["solid", "liquid", "gas"],
    },
  };
  const run = {
    id: "analysis_run_1",
    inputHash: selection.selectionHash,
    programHash: plan.programHash,
    runtimeVersion: plan.runtimeVersion,
  };
  const executorResult = {
    ok: true,
    adapter: "test",
    runtime: { version: "labrat-python-v1", exitCode: 0 },
    result: {
      result_table: [{
        __result_id: "result_row_1",
        __experiment_id: "experiment_1",
        __snapshot_id: "snapshot_1",
        __record_index: 0,
        solid: 50,
        liquid: 30,
        gas: rowSum - 80,
      }],
      traces: [{
        traceId: "trace_experiment_1",
        experimentId: "experiment_1",
        x: ["Exp 1", "Exp 2"],
        y: traceY,
        xUnit: null,
        yUnit: "percent",
        sourceRecordIds,
      }],
      lineage: {
        result_row_1: { sourceRecordIds },
        trace_experiment_1: { sourceRecordIds },
      },
      summary: {
        inputRecordCount: 1,
        outputRecordCount: 1,
        excludedRecordCount: 0,
        excludedRecords: [],
        missingValuePolicy: "exclude_record",
      },
    },
  };
  return { run, plan, selection, executorResult };
}

test("accepts a finite lineage-complete result and computes canonical hashes", () => {
  const result = validateAnalysisResult(normalizationFixture());

  assert.equal(result.ok, true);
  assert.match(result.contentHash, /^sha256_/);
  assert.match(result.resultPreviewHash, /^sha256_/);
  assert.equal(result.validation.invariants[0].ok, true);
});

test("blocks a normalized result that violates row-sum invariants", () => {
  const result = validateAnalysisResult(normalizationFixture({ rowSum: 99.5 }));

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.code === "analysis_invariant_failed"), true);
});

test("blocks non-finite values, mismatched trace arrays, and missing lineage", () => {
  const nonFinite = normalizationFixture({ traceY: [50, Number.NaN] });
  nonFinite.executorResult.result.traces[0].x = ["Exp 1"];
  nonFinite.executorResult.result.traces[0].sourceRecordIds = [];
  const result = validateAnalysisResult(nonFinite);
  const codes = new Set(result.errors.map((item) => item.code));

  assert.equal(codes.has("analysis_non_finite_value"), true);
  assert.equal(codes.has("analysis_trace_length_mismatch"), true);
  assert.equal(codes.has("analysis_lineage_required"), true);
});

test("rejects trace units that are not declared by the accepted manifest", () => {
  const fixture = normalizationFixture();
  fixture.executorResult.result.traces[0].yUnit = "seconds";
  const result = validateAnalysisResult(fixture);

  assert.equal(
    result.errors.some((item) => item.code === "analysis_trace_unit_mismatch"),
    true,
  );
});

test("uses derived-field outputUnit when validating trace units", () => {
  const fixture = normalizationFixture();
  fixture.plan.calculationManifest.inputs = [];
  fixture.plan.calculationManifest.derivedFields = [
    { fieldKey: "solid", outputUnit: "fraction" },
    { fieldKey: "liquid", outputUnit: "fraction" },
    { fieldKey: "gas", outputUnit: "fraction" },
  ];
  const result = validateAnalysisResult(fixture);

  assert.equal(
    result.errors.some((item) => item.code === "analysis_trace_unit_mismatch"),
    true,
  );
});

test("rejects input, program, and runtime hashes that differ from the accepted package", () => {
  const fixture = normalizationFixture();
  fixture.run.inputHash = "sha256_wrong_input";
  fixture.run.programHash = "sha256_wrong_program";
  fixture.run.runtimeVersion = "labrat-python-v2";
  const result = validateAnalysisResult(fixture);
  const codes = result.errors.map((item) => item.code);

  assert.equal(codes.includes("analysis_input_hash_mismatch"), true);
  assert.equal(codes.includes("analysis_program_hash_mismatch"), true);
  assert.equal(codes.includes("analysis_runtime_mismatch"), true);
});

test("requires the executor to attest the exact accepted runtime version", () => {
  const fixture = normalizationFixture();
  fixture.executorResult.runtime = {};
  const result = validateAnalysisResult(fixture);

  assert.equal(
    result.errors.some((item) => item.code === "analysis_runtime_mismatch"),
    true,
  );
});

test("rejects result rows that change accepted identity or omit declared outputs", () => {
  const fixture = normalizationFixture();
  fixture.executorResult.result.result_table[0].__experiment_id = "experiment_other";
  delete fixture.executorResult.result.result_table[0].gas;
  const result = validateAnalysisResult(fixture);
  const codes = new Set(result.errors.map((item) => item.code));

  assert.equal(codes.has("analysis_experiment_identity_mismatch"), true);
  assert.equal(codes.has("analysis_expected_field_missing"), true);
});

test("rejects non-plottable trace values", () => {
  const fixture = normalizationFixture();
  fixture.executorResult.result.traces[0].x[0] = { label: "Exp 1" };
  fixture.executorResult.result.traces[0].y[0] = "50";
  const result = validateAnalysisResult(fixture);
  const codes = new Set(result.errors.map((item) => item.code));

  assert.equal(codes.has("analysis_trace_x_value_invalid"), true);
  assert.equal(codes.has("analysis_trace_y_value_invalid"), true);
});

test("rejects input records that disappear without a declared exclusion", () => {
  const fixture = normalizationFixture();
  fixture.executorResult.result.result_table = [];
  fixture.executorResult.result.summary.outputRecordCount = 0;
  const result = validateAnalysisResult(fixture);

  assert.equal(
    result.errors.some((item) => item.code === "analysis_input_accounting_mismatch"),
    true,
  );
});

test("requires excluded records to identify an accepted input and reason", () => {
  const fixture = normalizationFixture();
  fixture.executorResult.result.result_table = [];
  fixture.executorResult.result.summary.outputRecordCount = 0;
  fixture.executorResult.result.summary.excludedRecordCount = 1;
  fixture.executorResult.result.summary.excludedRecords = [{
    sourceRecordId: "snapshot_unknown:0",
    reason: "",
  }];
  const result = validateAnalysisResult(fixture);
  const codes = new Set(result.errors.map((item) => item.code));

  assert.equal(codes.has("analysis_excluded_record_unknown"), true);
  assert.equal(codes.has("analysis_exclusion_reason_required"), true);
});
