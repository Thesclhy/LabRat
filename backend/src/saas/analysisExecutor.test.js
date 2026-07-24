import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAnalysisRunPackage,
  createAnalysisExecutor,
} from "./analysisExecutor.js";
import { ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";

const source = [
  "def analyze(inputs, labrat):",
  "    table = inputs['tables'][0]",
  "    return {'plotly': {'data': [{'type': 'bar', 'x': ['C1'], 'y': [table['values'][0][0]]}], 'layout': {}}, 'exclusions': [], 'checks': []}",
].join("\n");

function runPackage() {
  return buildAnalysisRunPackage({
    run: {
      id: "run_1",
      projectId: "project_1",
      analysisThreadId: "thread_1",
      acceptedPlanRevisionId: "revision_1",
      status: "queued",
    },
    planRevision: {
      id: "revision_1",
      schemaVersion: "labrat.analysisPlanRevision.v2",
      status: "accepted",
      plan: {
        reviewPlan: {
          processingSteps: ["Read selected data."],
          chart: {
            title: "Carbon",
            chartType: "bar",
            xDescription: "Carbon number",
            yDescription: "Amount",
          },
        },
      },
    },
    inputs: {
      schemaVersion: "labrat.analysisInputs.v2",
      tables: [{
        tableId: "table_1",
        sourceSelectionId: "selection_1",
        source: {
          sourceDocumentId: "source_1",
          sheetName: "Carbon",
          range: "A1",
        },
        startRow: 1,
        startColumn: 1,
        rowCount: 1,
        columnCount: 1,
        values: [[42]],
        displayValues: [["42"]],
        formulas: [[null]],
      }],
    },
    pythonProgram: {
      runtime: ANALYSIS_RUNTIME_VERSION,
      entrypoint: "analyze",
      source,
    },
  });
}

test("builds one canonical package from materialized multi-table input and post-accept Python", () => {
  const value = runPackage();

  assert.equal(value.schemaVersion, "labrat.analysisRunPackage.v2");
  assert.equal(value.outputTarget, "chart");
  assert.equal(value.inputs.tables[0].values[0][0], 42);
  assert.equal(value.reviewPlan.chart.title, "Carbon");
  assert.equal(value.program.entrypoint, "analyze");
  assert.match(value.inputHash, /^sha256_/);
  assert.match(value.programHash, /^sha256_/);
});

test("disabled and production-local executors never invoke a runner", async () => {
  let calls = 0;
  const localRunner = async () => {
    calls += 1;
    return { ok: true };
  };

  const disabled = createAnalysisExecutor({ mode: "disabled", localRunner });
  assert.equal((await disabled.executeAcceptedRun(runPackage())).error.code, "analysis_executor_disabled");

  const production = createAnalysisExecutor({
    mode: "local",
    nodeEnv: "production",
    localRunner,
  });
  assert.equal(
    (await production.executeAcceptedRun(runPackage())).error.code,
    "analysis_local_executor_forbidden",
  );
  assert.equal(calls, 0);
});

test("development local executor receives the exact accepted package", async () => {
  let received = null;
  const executor = createAnalysisExecutor({
    mode: "local",
    nodeEnv: "development",
    localRunner: async (value) => {
      received = value;
      return {
        ok: true,
        result: {
          plotly: { data: [{ type: "bar", x: ["C1"], y: [42] }], layout: {} },
          exclusions: [],
          checks: [],
        },
      };
    },
  });
  const packageValue = runPackage();
  const result = await executor.executeAcceptedRun(packageValue);

  assert.equal(result.ok, true);
  assert.equal(result.adapter, "local_non_production");
  assert.deepEqual(received.inputs, packageValue.inputs);
});

test("executor reports policy diagnostics before invoking the local runner", async () => {
  let calls = 0;
  const value = runPackage();
  value.program.source = [
    "import os",
    "def analyze(inputs, labrat):",
    "    return {}",
  ].join("\n");
  const { pythonSourceHash } = await import("./analysisSchemas.js");
  value.program.sourceHash = pythonSourceHash(value.program.source);
  value.programHash = value.program.sourceHash;
  const executor = createAnalysisExecutor({
    mode: "local",
    nodeEnv: "development",
    localRunner: async () => {
      calls += 1;
      return { ok: true };
    },
  });

  const result = await executor.executeAcceptedRun(value);

  assert.equal(result.error.code, "analysis_python_policy_failed");
  assert.equal(result.error.errors[0].module, "os");
  assert.equal(calls, 0);
});
