import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptAnalysisPlanRevision,
  createAnalysisPlanRevision,
  createAnalysisThread,
  draftAnalysisPlanRevision,
  executeAnalysisRun,
  analysisResultSummary,
  analysisRunSummary,
  getAnalysisResultPreview,
  getAnalysisPlanSelectionPage,
} from "./analysisThreads.js";
import { analysisFieldId, resolveAnalysisSelection } from "./analysisSelection.js";
import {
  ANALYSIS_PLAN_REVISION_VERSION,
  pythonSourceHash,
} from "./analysisSchemas.js";
import {
  createAnalysisToolRegistry,
  createStoreBackedAnalysisHandlers,
} from "./analysisToolRegistry.js";
import { MemorySaasStore } from "./memoryStore.js";

function seedAcceptedAnalysisData(store, projectId = "project_analysis_1") {
  const experimentId = "experiment_analysis_1";
  const snapshotId = "data_snapshot_analysis_1";
  const fieldId = analysisFieldId({
    fieldKey: "yield",
    unit: "percent",
    valueType: "number",
  });
  store.experimentIdentities.set(experimentId, {
    id: experimentId,
    labId: "lab_analysis",
    projectId,
    canonicalLabel: "Exp 1",
    aliases: ["Exp1"],
  });
  store.dataSnapshots.set(snapshotId, {
    id: snapshotId,
    labId: "lab_analysis",
    projectId,
    status: "accepted",
    contentHash: "sha256_snapshot_analysis_1",
    dependencyHash: "sha256_source_analysis_1",
    experimentRecords: [{
      experimentId,
      label: "Exp 1",
      fields: [{
        fieldKey: "yield",
        displayName: "Yield",
        unit: "percent",
        valueType: "number",
        role: "outcome",
        value: 42,
        sourceRefs: [{
          sourceType: "excel_cell",
          sourceDocumentId: "source_document_analysis_1",
          sheet: "Runs",
          cell: "B2",
        }],
        warnings: [],
      }],
      series: [],
      sourceRefs: [],
      warnings: [],
    }],
  });
  store.experimentSnapshotHeads.set("head_analysis_1", {
    id: "head_analysis_1",
    labId: "lab_analysis",
    projectId,
    experimentId,
    dataSnapshotId: snapshotId,
    recordIndex: 0,
  });
  const selectionRequest = {
    experimentIds: [experimentId],
    fieldIds: [fieldId],
    includeSeries: false,
  };
  const selection = resolveAnalysisSelection({
    projectId,
    dataSnapshots: [...store.dataSnapshots.values()],
    experimentIdentities: [...store.experimentIdentities.values()],
    experimentSnapshotHeads: [...store.experimentSnapshotHeads.values()],
    selectionRequest,
  });
  return { experimentId, fieldId, selection, selectionRequest };
}

function planForSelection(selection, requestSummary = "Compare accepted yield values.") {
  const source = [
    "def analyze(tables, labrat):",
    "    return {'result_table': [], 'traces': [], 'lineage': {}, 'summary': {}}",
  ].join("\n");
  return {
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    requestSummary,
    selection: {
      selectionId: selection.selectionId,
      experimentIds: selection.experimentIds,
      fieldIds: selection.fieldIds,
      dependencyHash: selection.dependencyHash,
      selectionHash: selection.selectionHash,
    },
    processingSummary: ["Use the accepted yield value for each selected experiment."],
    calculationManifest: {
      inputs: [{
        fieldId: selection.fieldIds[0],
        fieldKey: "yield",
        unit: "percent",
      }],
      missingValuePolicy: {
        mode: "exclude_record",
        requiredFieldIds: selection.fieldIds,
      },
      derivedFields: [],
      invariants: [],
    },
    pythonProgram: {
      runtime: "labrat-python-v1",
      entrypoint: "analyze",
      source,
      sourceHash: pythonSourceHash(source),
    },
    expectedOutput: {
      shape: "experiment_traces",
      chartType: "bar",
      xField: "experiment_label",
      yFields: ["yield"],
    },
    warnings: [],
  };
}

async function setup() {
  const store = new MemorySaasStore();
  const project = {
    id: "project_analysis_1",
    labId: "lab_analysis",
    name: "Analysis persistence",
  };
  const seeded = seedAcceptedAnalysisData(store, project.id);
  const thread = await createAnalysisThread({
    store,
    project,
    actorUserId: "user_editor",
    originalRequest: "Compare yield across experiments.",
  });
  return { store, project, thread, ...seeded };
}

test("plan feedback creates an immutable later revision", async () => {
  const { store, project, thread, selection, selectionRequest } = await setup();
  const first = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_editor",
    plan: planForSelection(selection),
    selectionRequest,
  });
  const second = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_editor",
    feedback: "Use a bar chart.",
    plan: planForSelection(selection, "Compare accepted yield values with a bar chart."),
    selectionRequest,
  });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal((await store.findAnalysisPlanRevisionById(first.id)).status, "superseded");
  assert.equal((await store.findAnalysisPlanRevisionById(second.id)).status, "awaiting_review");
  first.plan.requestSummary = "mutated outside the store";
  assert.equal(
    (await store.findAnalysisPlanRevisionById(first.id)).plan.requestSummary,
    "Compare accepted yield values.",
  );
  const storedThread = await store.findAnalysisThreadById(thread.id);
  assert.deepEqual(storedThread.planRevisionIds, [first.id, second.id]);
});

test("selection reads are bounded and retain exact review rectangles", async () => {
  const { store, project, thread, selection, selectionRequest } = await setup();
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_editor",
    plan: planForSelection(selection),
    selectionRequest,
  });
  const page = await getAnalysisPlanSelectionPage({
    store,
    planRevisionId: revision.id,
    offset: 0,
    limit: 1_000,
  });

  assert.equal(page.page.limit, 200);
  assert.equal(page.page.totalCount, 1);
  assert.equal(page.records[0].fields[0].value, 42);
  assert.deepEqual(page.sourceRectangles.map((item) => item.range), ["B2"]);
});

test("model-drafted plans receive backend-owned selection and Python hashes", async () => {
  const { store, project, thread, fieldId } = await setup();
  const source = [
    "def analyze(tables, labrat):",
    "    return {'result_table': [], 'traces': [], 'lineage': {}, 'summary': {}}",
  ].join("\n");
  const modelProvider = {
    async draftAnalysisPlan(input) {
      assert.equal(input.fields[0].fieldId, fieldId);
      assert.deepEqual(input.experiments, [{
        experimentId: "experiment_analysis_1",
        label: "Exp 1",
        aliases: ["Exp1"],
      }]);
      return {
        ok: true,
        selectionRequest: {
          experimentIds: [],
          fieldIds: [fieldId],
          includeSeries: false,
        },
        plan: {
          requestSummary: "Compare accepted yield values.",
          processingSummary: ["Use the accepted yield value for each experiment."],
          calculationManifest: {
            inputs: [{ fieldId, fieldKey: "yield", unit: "percent" }],
            missingValuePolicy: {
              mode: "exclude_record",
              requiredFieldIds: [fieldId],
            },
            derivedFields: [],
            invariants: [],
          },
          pythonProgram: {
            runtime: "labrat-python-v1",
            entrypoint: "analyze",
            source,
            sourceHash: "model_must_not_choose_this_hash",
          },
          expectedOutput: {
            shape: "experiment_traces",
            chartType: "bar",
            xField: "experiment_label",
            yFields: ["yield"],
          },
        },
      };
    },
  };
  const analysisToolRegistry = createAnalysisToolRegistry({
    handlers: createStoreBackedAnalysisHandlers({ store }),
  });
  const calledTools = [];
  const registry = {
    call(name, args, authContext) {
      calledTools.push(name);
      return analysisToolRegistry.call(name, args, authContext);
    },
  };
  const revision = await draftAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_editor",
    modelProvider,
    analysisToolRegistry: registry,
  });

  assert.equal(calledTools.includes("validate_analysis_plan"), true);
  assert.equal(revision.selectionHash, revision.selection.selectionHash);
  assert.equal(revision.dependencyHash, revision.selection.dependencyHash);
  assert.equal(revision.pythonProgram.sourceHash, pythonSourceHash(source));
  assert.deepEqual(revision.sourceRectangles.map((item) => item.range), ["B2"]);
});

test("plan acceptance is idempotent and creates one queued run without a chart", async () => {
  const { store, project, thread, selection, selectionRequest } = await setup();
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_editor",
    plan: planForSelection(selection),
    selectionRequest,
  });
  const input = {
    store,
    project,
    actorUserId: "user_editor",
    planRevisionId: revision.id,
    idempotencyKey: "accept_analysis_plan_1",
    planHash: revision.planHash,
    selectionHash: revision.selectionHash,
    dependencyHash: revision.dependencyHash,
  };
  const accepted = await acceptAnalysisPlanRevision(input);
  const replay = await acceptAnalysisPlanRevision(input);

  assert.equal(accepted.analysisPlanRevision.status, "accepted");
  assert.equal(accepted.analysisRun.status, "queued");
  assert.equal(replay.analysisRun.id, accepted.analysisRun.id);
  assert.equal(replay.idempotentReplay, true);
  assert.equal((await store.listAnalysisRuns({ projectId: project.id })).length, 1);
  assert.equal((await store.listChartSpecs({ projectId: project.id })).length, 0);
  assert.equal((await store.findAnalysisThreadById(thread.id)).status, "executing");
});

test("plan acceptance rejects mismatched review hashes and stale active heads", async () => {
  const { store, project, thread, selection, selectionRequest } = await setup();
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_editor",
    plan: planForSelection(selection),
    selectionRequest,
  });

  await assert.rejects(
    acceptAnalysisPlanRevision({
      store,
      project,
      actorUserId: "user_editor",
      planRevisionId: revision.id,
      idempotencyKey: "accept_analysis_bad_hash",
      planHash: "sha256_wrong",
      selectionHash: revision.selectionHash,
      dependencyHash: revision.dependencyHash,
    }),
    (error) => error.code === "analysis_plan_revision_mismatch" && error.statusCode === 409,
  );

  store.experimentSnapshotHeads.set("head_analysis_1", {
    ...store.experimentSnapshotHeads.get("head_analysis_1"),
    dataSnapshotId: "data_snapshot_analysis_2",
  });
  await assert.rejects(
    acceptAnalysisPlanRevision({
      store,
      project,
      actorUserId: "user_editor",
      planRevisionId: revision.id,
      idempotencyKey: "accept_analysis_stale",
      planHash: revision.planHash,
      selectionHash: revision.selectionHash,
      dependencyHash: revision.dependencyHash,
    }),
    (error) => error.code === "analysis_plan_stale" && error.statusCode === 409,
  );
  assert.equal((await store.listAnalysisRuns({ projectId: project.id })).length, 0);
});

test("analysis plan store transaction rejects a cross-project run package without partial writes", async () => {
  const { store, project, thread, selection, selectionRequest } = await setup();
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_editor",
    plan: planForSelection(selection),
    selectionRequest,
  });
  await assert.rejects(
    store.acceptAnalysisPlan({
      projectId: project.id,
      analysisThreadId: thread.id,
      planRevisionId: revision.id,
      actorUserId: "user_editor",
      idempotencyKey: "invalid_cross_project_run",
      requestHash: "sha256_invalid_cross_project_run",
      analysisRun: {
        id: "analysis_run_wrong_project",
        projectId: "project_other",
        analysisThreadId: thread.id,
        acceptedPlanRevisionId: revision.id,
        idempotencyKey: "invalid_cross_project_run",
        requestHash: "sha256_invalid_cross_project_run",
        createdAt: "2026-07-20T00:00:00.000Z",
      },
      auditEvents: [],
    }),
    (error) => error.code === "analysis_plan_revision_mismatch",
  );

  assert.equal((await store.findAnalysisPlanRevisionById(revision.id)).status, "awaiting_review");
  assert.equal(await store.findAnalysisRunById("analysis_run_wrong_project"), null);
});

test("analysis result publication storage is atomic, copied, and idempotent", async () => {
  const { store, project, thread } = await setup();
  const analysisResult = {
    id: "analysis_result_publish_1",
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: thread.id,
    analysisRunId: "analysis_run_publish_1",
    status: "accepted",
    contentHash: "sha256_result_publish_1",
    result: { summary: { rowCount: 1 } },
    sourceRefs: [],
    warnings: [],
    validation: { ok: true },
    createdAt: "2026-07-20T00:00:00.000Z",
    createdBy: "user_editor",
  };
  const chartSpec = {
    id: "chart_spec_analysis_publish_1",
    labId: project.labId,
    projectId: project.id,
    analysisResultId: analysisResult.id,
    title: "Accepted yield",
    chartType: "bar",
    spec: { origin: "analysis_result" },
    layout: {},
    warnings: [],
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    createdBy: "user_editor",
    updatedBy: "user_editor",
  };
  const input = {
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: thread.id,
    actorUserId: "user_editor",
    idempotencyKey: "analysis_publication_1",
    requestHash: "sha256_publication_request_1",
    analysisResult,
    chartSpec,
    response: {
      analysisResultId: analysisResult.id,
      chartSpecId: chartSpec.id,
    },
    auditEvents: [],
  };
  await assert.rejects(
    store.publishAnalysisResult(input),
    (error) => error.code === "invalid_analysis_publication_package",
  );
  assert.equal(await store.findAnalysisResultById(analysisResult.id), null);
  store.analysisRuns.set(analysisResult.analysisRunId, {
    id: analysisResult.analysisRunId,
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: thread.id,
    acceptedPlanRevisionId: "analysis_plan_revision_publish_1",
    status: "awaiting_result_review",
  });
  const published = await store.publishAnalysisResult(input);
  analysisResult.result.summary.rowCount = 99;
  const replay = await store.publishAnalysisResult(input);

  assert.equal(published.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal((await store.findAnalysisResultById(analysisResult.id)).result.summary.rowCount, 1);
  assert.equal((await store.listChartSpecs({ projectId: project.id })).length, 1);
  const storedThread = await store.findAnalysisThreadById(thread.id);
  assert.deepEqual(storedThread.acceptedAnalysisResultIds, [analysisResult.id]);
  assert.deepEqual(storedThread.chartSpecIds, [chartSpec.id]);
  await assert.rejects(
    store.publishAnalysisResult({
      ...input,
      requestHash: "sha256_different_request",
    }),
    (error) => error.code === "idempotency_key_conflict",
  );
});

test("memory analysis runs and results are append-only like Postgres rows", async () => {
  const store = new MemorySaasStore();
  const run = {
    id: "analysis_run_append_only",
    projectId: "project_1",
    analysisThreadId: "analysis_thread_1",
    idempotencyKey: "append_only_run",
  };
  const result = {
    id: "analysis_result_append_only",
    projectId: "project_1",
    analysisThreadId: "analysis_thread_1",
    analysisRunId: run.id,
    result: { summary: { rowCount: 1 } },
  };
  const createdRun = await store.createAnalysisRun(run);
  const createdResult = await store.createAnalysisResult(result);
  createdRun.status = "mutated";
  createdResult.result.summary.rowCount = 99;

  await assert.rejects(
    store.createAnalysisRun(run),
    (error) => error.code === "analysis_run_exists",
  );
  await assert.rejects(
    store.createAnalysisResult(result),
    (error) => error.code === "analysis_result_exists",
  );
  assert.notEqual((await store.findAnalysisRunById(run.id)).status, "mutated");
  assert.equal((await store.findAnalysisResultById(result.id)).result.summary.rowCount, 1);
});

test("analysis result summaries and previews keep evidence reads bounded", async () => {
  const store = new MemorySaasStore();
  const run = {
    id: "analysis_run_bounded_preview",
    projectId: "project_bounded_preview",
    analysisThreadId: "analysis_thread_bounded_preview",
    acceptedPlanRevisionId: "analysis_plan_bounded_preview",
    status: "awaiting_result_review",
  };
  const result = {
    id: "analysis_result_bounded_preview",
    projectId: run.projectId,
    analysisThreadId: run.analysisThreadId,
    analysisRunId: run.id,
    status: "awaiting_review",
    contentHash: "sha256_bounded_result",
    resultPreviewHash: "sha256_bounded_preview",
    result: {
      resultTable: [
        { __result_id: "row_1", value: 1 },
        { __result_id: "row_2", value: 2 },
      ],
      traces: [
        { traceId: "trace_1", x: [1], y: [1] },
        { traceId: "trace_2", x: [2], y: [2] },
      ],
      lineage: {
        row_1: { sourceRecordIds: ["snapshot_1:0"] },
        row_2: { sourceRecordIds: ["snapshot_2:0"] },
        trace_1: { sourceRecordIds: ["snapshot_1:0"] },
        trace_2: { sourceRecordIds: ["snapshot_2:0"] },
      },
      summary: {},
    },
    sourceRefs: [
      { sourceDocumentId: "source_1", cell: "A1" },
      { sourceDocumentId: "source_1", cell: "A2" },
      { sourceDocumentId: "source_1", cell: "A3" },
    ],
    warnings: [],
    validation: { ok: true },
  };
  store.analysisRuns.set(run.id, run);
  store.analysisResults.set(result.id, result);

  const summary = analysisResultSummary(result);
  const runSummary = analysisRunSummary({
    ...run,
    payload: { claimToken: "internal_claim_token", adapter: "test" },
  });
  const preview = await getAnalysisResultPreview({
    store,
    analysisRunId: run.id,
    limit: 1,
    traceLimit: 1,
    sourceLimit: 1,
  });

  assert.equal(summary.sourceRefCount, 3);
  assert.equal(Object.hasOwn(summary, "sourceRefs"), false);
  assert.deepEqual(runSummary.execution, { adapter: "test" });
  assert.deepEqual(Object.keys(preview.lineage).sort(), ["row_1", "trace_1"]);
  assert.equal(preview.sourceRefs.length, 1);
  assert.deepEqual(preview.sourcePage, { offset: 0, limit: 1, totalCount: 3 });
});

test("analysis run claim atomically rejects changed active snapshot heads", async () => {
  const { store, project, thread, selection } = await setup();
  const run = {
    id: "analysis_run_stale_claim",
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: thread.id,
    status: "queued",
    payload: {},
  };
  store.analysisRuns.set(run.id, run);
  await store.updateAnalysisThread(thread.id, { status: "executing" });
  const head = store.experimentSnapshotHeads.get("head_analysis_1");
  store.experimentSnapshotHeads.set(head.id, {
    ...head,
    dataSnapshotId: "data_snapshot_changed",
  });

  const claimed = await store.claimAnalysisRun({
    projectId: project.id,
    analysisRunId: run.id,
    actorUserId: "user_editor",
    expectedHeadRefs: selection.records.map((record) => ({
      headId: record.headId,
      experimentId: record.experimentId,
      dataSnapshotId: record.snapshotId,
      recordIndex: record.recordIndex,
    })),
    staleValidation: {
      ok: false,
      errors: [{ code: "analysis_run_stale", message: "Active heads changed." }],
    },
  });

  assert.equal(claimed.status, "validation_failed");
  assert.equal((await store.findAnalysisThreadById(thread.id)).status, "execution_failed");
});

test("analysis run claim recovers an expired running lease but not an active one", async () => {
  const { store, project, thread, selection } = await setup();
  const expectedHeadRefs = selection.records.map((record) => ({
    headId: record.headId,
    experimentId: record.experimentId,
    dataSnapshotId: record.snapshotId,
    recordIndex: record.recordIndex,
  }));
  const run = {
    id: "analysis_run_expired_lease",
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: thread.id,
    status: "running",
    payload: {
      startedAt: "2026-07-20T00:00:00.000Z",
      claimToken: "analysis_claim_expired",
    },
  };
  store.analysisRuns.set(run.id, run);
  const recovered = await store.claimAnalysisRun({
    projectId: project.id,
    analysisRunId: run.id,
    actorUserId: "user_editor",
    expectedHeadRefs,
    startedAt: "2026-07-20T00:10:00.000Z",
    staleAfterMs: 60_000,
  });

  assert.equal(recovered.status, "running");
  assert.equal(recovered.payload.recoveryCount, 1);
  assert.notEqual(recovered.payload.claimToken, "analysis_claim_expired");
  await assert.rejects(
    store.finalizeAnalysisRun({
      projectId: project.id,
      analysisRunId: run.id,
      actorUserId: "user_editor",
      claimToken: "analysis_claim_expired",
      status: "failed",
    }),
    (error) => error.code === "analysis_run_state_conflict",
  );
  await assert.rejects(
    store.claimAnalysisRun({
      projectId: project.id,
      analysisRunId: run.id,
      actorUserId: "user_editor",
      expectedHeadRefs,
      startedAt: "2026-07-20T00:10:30.000Z",
      staleAfterMs: 60_000,
    }),
    (error) => error.code === "analysis_run_state_conflict",
  );
});

test("invalid executor output finalizes without persisting a result or chart", async () => {
  const { store, project, thread, selection, selectionRequest } = await setup();
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_editor",
    plan: planForSelection(selection),
    selectionRequest,
  });
  const accepted = await acceptAnalysisPlanRevision({
    store,
    project,
    actorUserId: "user_editor",
    planRevisionId: revision.id,
    idempotencyKey: "invalid_executor_result",
    planHash: revision.planHash,
    selectionHash: revision.selectionHash,
    dependencyHash: revision.dependencyHash,
  });
  const executed = await executeAnalysisRun({
    store,
    project,
    actorUserId: "user_editor",
    analysisRunId: accepted.analysisRun.id,
    executor: {
      async executeAcceptedRun(runPackage) {
        return {
          ok: true,
          adapter: "invalid_test",
          runtime: { version: runPackage.runtimeVersion },
          result: {
            result_table: [],
            traces: [],
            lineage: {},
            summary: {
              inputRecordCount: 1,
              outputRecordCount: 0,
              excludedRecordCount: 0,
              excludedRecords: [],
              missingValuePolicy: "exclude_record",
            },
          },
        };
      },
    },
  });

  assert.equal(executed.analysisRun.status, "validation_failed");
  assert.equal(executed.analysisResult, null);
  assert.equal((await store.listAnalysisResults({ projectId: project.id })).length, 0);
  assert.equal((await store.listChartSpecs({ projectId: project.id })).length, 0);
});
