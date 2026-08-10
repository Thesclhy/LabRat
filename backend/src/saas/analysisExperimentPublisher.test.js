import assert from "node:assert/strict";
import test from "node:test";

import { publishAcceptedExperimentAnalysis } from "./analysisExperimentPublisher.js";
import { MemorySaasStore } from "./memoryStore.js";

function setup() {
  const store = new MemorySaasStore();
  const project = { id: "project_1", labId: "lab_1", name: "Browser analysis" };
  const thread = {
    id: "thread_1",
    projectId: project.id,
    labId: project.labId,
    outputTarget: "experiment_browser",
    status: "awaiting_result_review",
    acceptedAnalysisResultIds: [],
    dataSnapshotIds: [],
    browserViewIds: [],
  };
  const revision = {
    id: "revision_1",
    projectId: project.id,
    analysisThreadId: thread.id,
    outputTarget: "experiment_browser",
    status: "accepted",
    plan: {
      sourceSelections: [],
      experimentSelections: [{
        experimentId: "experiment_31",
        baseHeadRef: {
          experimentId: "experiment_31",
          headId: "head_31",
          dataSnapshotId: "snapshot_base",
          recordIndex: 0,
        },
      }],
    },
  };
  const run = {
    id: "run_1",
    projectId: project.id,
    analysisThreadId: thread.id,
    acceptedPlanRevisionId: revision.id,
    outputTarget: "experiment_browser",
    status: "awaiting_result_review",
  };
  const result = {
    id: "result_1",
    projectId: project.id,
    analysisThreadId: thread.id,
    analysisRunId: run.id,
    analysisPlanRevisionId: revision.id,
    outputTarget: "experiment_browser",
    status: "awaiting_review",
    validation: { ok: true, errors: [] },
    sourceRefs: [],
    warnings: [],
    result: {
      recordPatches: [{
        patchId: "record_patch_1",
        label: "Exp31",
        values: [{
          columnId: "column_product_yield",
          displayName: "Product yield",
          valueType: "number",
          unit: "percent",
          value: 42.5,
          formattedValue: "42.5",
          confidence: 1,
          warnings: [],
          sourceRefs: [{
            sourceType: "excel_cell",
            sourceDocumentId: "source_supplement",
            sheet: "Exp31",
            cell: "A2",
          }],
        }],
        upsertSeries: [],
        warnings: [],
        baseSnapshotRef: {
          experimentId: "experiment_31",
          headId: "head_31",
          dataSnapshotId: "snapshot_base",
          recordIndex: 0,
        },
      }],
      identityCandidates: [{
        candidateId: "experiment_candidate_1",
        sourceAlias: "Exp31",
        normalizedAlias: "exp31",
        suggestedAction: "reuse",
        suggestedExperimentId: "experiment_31",
        status: "reuse",
        matches: [{ id: "experiment_31", label: "Exp31" }],
      }],
      browserView: {
        name: "Supplemental fields",
        makeDefault: true,
        visibleColumnIds: ["experiment", "column_product_yield"],
        columnOrder: ["experiment", "column_product_yield"],
        filters: [],
        sort: [],
      },
      baseHeadRefs: [{
        experimentId: "experiment_31",
        headId: "head_31",
        dataSnapshotId: "snapshot_base",
        recordIndex: 0,
      }],
      summary: { experimentCount: 1, newFieldCount: 1, changedFieldCount: 0 },
    },
  };
  store.analysisThreads.set(thread.id, thread);
  store.analysisPlanRevisions.set(revision.id, revision);
  store.analysisRuns.set(run.id, run);
  store.analysisResults.set(result.id, result);
  store.experimentIdentities.set("experiment_31", {
    id: "experiment_31",
    projectId: project.id,
    canonicalLabel: "Exp31",
    aliases: ["Experiment 31"],
  });
  store.dataSnapshots.set("snapshot_base", {
    id: "snapshot_base",
    projectId: project.id,
    status: "accepted",
    experimentRecords: [{
      experimentId: "experiment_31",
      label: "Exp31",
      aliases: ["Exp31"],
      fields: [{
        fieldKey: "temperature",
        displayName: "Temperature",
        role: "condition",
        valueType: "number",
        unit: "degC",
        value: 250,
        formattedValue: "250",
        sourceRefs: [],
      }],
      series: [],
      warnings: [],
      sourceRefs: [],
    }],
  });
  store.experimentSnapshotHeads.set("head_31", {
    id: "head_31",
    projectId: project.id,
    experimentId: "experiment_31",
    dataSnapshotId: "snapshot_base",
    recordIndex: 0,
  });
  return { store, project, result };
}

test("publishes one immutable v4 snapshot, advances heads, and replays idempotently", async () => {
  const { store, project, result } = setup();
  const first = await publishAcceptedExperimentAnalysis({
    store,
    project,
    actorUserId: "user_1",
    analysisRunId: "run_1",
    analysisResultId: result.id,
    identityResolutions: [],
    idempotencyKey: "publish_browser_result_1",
  });
  const replay = await publishAcceptedExperimentAnalysis({
    store,
    project,
    actorUserId: "user_1",
    analysisRunId: "run_1",
    analysisResultId: result.id,
    identityResolutions: [],
    idempotencyKey: "publish_browser_result_1",
  });

  assert.equal(first.dataSnapshot.schemaVersion, "labrat.dataSnapshot.v4");
  assert.equal(first.dataSnapshot.dataPlanId, null);
  assert.equal(first.dataSnapshot.experimentRecords[0].fields.length, 2);
  assert.equal(first.dataSnapshot.experimentRecords[0].fields[0].fieldKey, "temperature");
  assert.equal(first.dataSnapshot.experimentRecords[0].fields[1].columnId, "column_product_yield");
  assert.equal(first.dataSnapshot.experimentRecords[0].fields[1].displayName, "Product yield");
  assert.equal(Object.hasOwn(first.dataSnapshot.experimentRecords[0].fields[1], "fieldKey"), false);
  assert.equal(first.experimentSnapshotHeads[0].dataSnapshotId, first.dataSnapshot.id);
  assert.equal(
    first.browserView.payload.columns.some((column) => (
      column.columnId === "column_product_yield" && column.hidden === false
    )),
    true,
  );
  assert.equal(first.browserView.isDefault, false);
  assert.deepEqual(first.browserView.payload.selectedExperimentIds, []);
  assert.equal(first.analysisThread.status, "completed");
  assert.equal(first.analysisResult.status, "accepted");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(store.dataSnapshots.size, 2);
});

test("rejects publication when an accepted base snapshot head changed", async () => {
  const { store, project, result } = setup();
  store.dataSnapshots.set("snapshot_concurrent", {
    ...structuredClone(store.dataSnapshots.get("snapshot_base")),
    id: "snapshot_concurrent",
  });
  store.experimentSnapshotHeads.set("head_31", {
    ...store.experimentSnapshotHeads.get("head_31"),
    dataSnapshotId: "snapshot_concurrent",
  });

  await assert.rejects(
    publishAcceptedExperimentAnalysis({
      store,
      project,
      actorUserId: "user_1",
      analysisRunId: "run_1",
      analysisResultId: result.id,
      identityResolutions: [],
      idempotencyKey: "publish_stale_browser_result",
    }),
    (error) => error.code === "analysis_result_stale",
  );
  assert.equal(store.analysisResults.get(result.id).status, "awaiting_review");
});
