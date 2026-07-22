import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnalysisRunPackage,
  createAnalysisExecutor,
} from "./analysisExecutor.js";
import { pythonSourceHash } from "./analysisSchemas.js";

function acceptedFixture() {
  const source = [
    "def analyze(tables, labrat):",
    "    return {'result_table': [], 'traces': [], 'lineage': {}, 'summary': {}}",
  ].join("\n");
  const selection = {
    schemaVersion: "labrat.analysisSelection.v1",
    selectionId: "selection_1",
    selectionHash: "sha256_selection_1",
    dependencyHash: "sha256_dependency_1",
    fieldCatalog: [{
      fieldId: "analysis_field:yield:percent:number",
      fieldKey: "yield",
      unit: "percent",
      valueType: "number",
    }],
    records: [{
      experimentId: "experiment_1",
      experimentLabel: "Exp 1",
      snapshotId: "snapshot_1",
      headId: "head_1",
      recordIndex: 0,
      fields: [{
        fieldId: "analysis_field:yield:percent:number",
        fieldKey: "yield",
        unit: "percent",
        valueType: "number",
        value: 42,
        sourceRefs: [{
          sourceType: "excel_cell",
          sourceDocumentId: "source_1",
          sheet: "Runs",
          cell: "B2",
        }],
      }],
      series: [],
    }],
  };
  const revision = {
    id: "plan_revision_1",
    status: "accepted",
    selection,
    selectionHash: selection.selectionHash,
    dependencyHash: selection.dependencyHash,
    programHash: pythonSourceHash(source),
    runtimeVersion: "labrat-python-v1",
    calculationManifest: {
      inputs: [{
        fieldId: "analysis_field:yield:percent:number",
        fieldKey: "yield",
        unit: "percent",
      }],
      missingValuePolicy: {
        mode: "exclude_record",
        requiredFieldIds: ["analysis_field:yield:percent:number"],
      },
      derivedFields: [],
      invariants: [],
    },
    expectedOutput: {
      shape: "experiment_traces",
      chartType: "bar",
      xField: "experiment_label",
      yFields: ["yield"],
    },
    pythonProgram: {
      runtime: "labrat-python-v1",
      entrypoint: "analyze",
      source,
      sourceHash: pythonSourceHash(source),
    },
  };
  const run = {
    id: "analysis_run_1",
    projectId: "project_1",
    analysisThreadId: "analysis_thread_1",
    acceptedPlanRevisionId: revision.id,
    status: "queued",
    inputHash: selection.selectionHash,
    programHash: revision.programHash,
    runtimeVersion: revision.runtimeVersion,
  };
  return { run, revision, selection };
}

test("builds a canonical package with values and lineage from the frozen selection", () => {
  const fixture = acceptedFixture();
  const runPackage = buildAnalysisRunPackage({
    run: fixture.run,
    planRevision: fixture.revision,
    selection: fixture.selection,
  });

  assert.equal(runPackage.inputHash, fixture.selection.selectionHash);
  assert.equal(runPackage.program.sourceHash, fixture.revision.programHash);
  assert.deepEqual(runPackage.tables.records[0], {
    __source_record_id: "snapshot_1:0",
    __experiment_id: "experiment_1",
    __experiment_label: "Exp 1",
    __snapshot_id: "snapshot_1",
    __record_index: 0,
    yield: 42,
  });
  assert.equal(
    runPackage.lineage.records["snapshot_1:0"].fields["analysis_field:yield:percent:number"][0].cell,
    "B2",
  );
});

test("disabled and production-local executors never start a runner", async () => {
  let calls = 0;
  const localRunner = async () => {
    calls += 1;
    return { ok: true, result: {} };
  };
  const runPackage = buildAnalysisRunPackage({
    run: acceptedFixture().run,
    planRevision: acceptedFixture().revision,
    selection: acceptedFixture().selection,
  });
  const disabled = createAnalysisExecutor({ mode: "disabled", localRunner });
  const productionLocal = createAnalysisExecutor({
    mode: "local",
    nodeEnv: "production",
    localRunner,
  });

  assert.equal((await disabled.executeAcceptedRun(runPackage)).error.code, "analysis_executor_disabled");
  assert.equal(
    (await productionLocal.executeAcceptedRun(runPackage)).error.code,
    "analysis_local_executor_forbidden",
  );
  assert.equal(calls, 0);
});

test("public executor config never presents the local adapter as production safe", () => {
  assert.deepEqual(
    createAnalysisExecutor({ mode: "local", nodeEnv: "test" }).publicConfig(),
    {
      mode: "local",
      configured: true,
      adapter: "local_non_production",
      productionSafe: false,
    },
  );
  assert.deepEqual(
    createAnalysisExecutor({ mode: "worker", workerEndpoint: "https://worker.example" }).publicConfig(),
    {
      mode: "worker",
      configured: true,
      adapter: "worker",
      productionSafe: true,
    },
  );
});

test("local non-production executor enforces policy before invoking its runner", async () => {
  let calls = 0;
  const executor = createAnalysisExecutor({
    mode: "local",
    nodeEnv: "test",
    localRunner: async () => {
      calls += 1;
      return {
        ok: true,
        result: { result_table: [], traces: [], lineage: {}, summary: {} },
      };
    },
  });
  const fixture = acceptedFixture();
  const validPackage = buildAnalysisRunPackage({
    run: fixture.run,
    planRevision: fixture.revision,
    selection: fixture.selection,
  });
  const invalidPackage = {
    ...validPackage,
    programHash: pythonSourceHash(
      "import requests\ndef analyze(tables, labrat):\n    return {}",
    ),
    program: {
      ...validPackage.program,
      source: "import requests\ndef analyze(tables, labrat):\n    return {}",
      sourceHash: pythonSourceHash(
        "import requests\ndef analyze(tables, labrat):\n    return {}",
      ),
    },
  };

  const invalid = await executor.executeAcceptedRun(invalidPackage);
  const valid = await executor.executeAcceptedRun(validPackage);

  assert.equal(invalid.error.code, "analysis_python_policy_failed");
  assert.equal(valid.ok, true);
  assert.equal(valid.adapter, "local_non_production");
  assert.equal(calls, 1);
});
