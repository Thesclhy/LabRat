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

for (const phase of ["awaiting_plan_review", "awaiting_result_review"]) {
  test(`rejects old Browser result after a new revision in ${phase}`, async () => {
    const { store, project, result } = setup();
    const prior = store.analysisPlanRevisions.get("revision_1");
    prior.revision = 1;
    store.analysisPlanRevisions.set("revision_2", { ...prior, id: "revision_2", revision: 2, status: phase === "awaiting_plan_review" ? "awaiting_review" : "accepted" });
    store.analysisThreads.get("thread_1").status = phase;
    await assert.rejects(publishAcceptedExperimentAnalysis({ store, project, actorUserId: "user_1", analysisRunId: "run_1", analysisResultId: result.id, idempotencyKey: "old_result" }), error => error.statusCode === 409);
    assert.equal(store.dataSnapshots.size, 1);
    assert.equal(store.analysisResults.get(result.id).status, "awaiting_review");
  });
}

test("latest run wins by server creation order and exact result associations are checked", async () => {
  const { store, project, result } = setup();
  const original = store.analysisRuns.get("run_1");
  store.analysisRuns.set("run_0", { ...original, id: "run_0" });
  store.analysisThreads.get("thread_1").analysisRunIds = ["run_1", "run_0"];
  const args = { store, project, actorUserId: "user_1", analysisRunId: "run_1", analysisResultId: result.id, idempotencyKey: "latest_run" };
  await assert.rejects(publishAcceptedExperimentAnalysis(args), { code: "analysis_result_stale" });
  await assert.rejects(publishAcceptedExperimentAnalysis({ ...args, analysisRunId: "run_0" }), { code: "experiment_analysis_result_not_publishable" });
  store.analysisResults.set("result_2", { ...result, id: "result_2", analysisRunId: "run_0" });
  const accepted = await publishAcceptedExperimentAnalysis({ ...args, analysisRunId: "run_0", analysisResultId: "result_2" });
  assert.equal(accepted.analysisResult.id, "result_2");
  store.analysisPlanRevisions.set("revision_2", { ...store.analysisPlanRevisions.get("revision_1"), id: "revision_2", revision: 2 });
  assert.equal((await publishAcceptedExperimentAnalysis({ ...args, analysisRunId: "run_0", analysisResultId: "result_2" })).idempotentReplay, true);
});

test("publication transaction rechecks current revision after the initial publisher check", async () => {
  const { store, project, result } = setup();
  const publish = store.publishExperimentAnalysis.bind(store);
  store.publishExperimentAnalysis = async input => {
    store.analysisPlanRevisions.set("revision_2", { ...store.analysisPlanRevisions.get("revision_1"), id: "revision_2", revision: 2 });
    return publish(input);
  };
  await assert.rejects(publishAcceptedExperimentAnalysis({ store, project, actorUserId: "user_1", analysisRunId: "run_1", analysisResultId: result.id, idempotencyKey: "concurrent_revision" }), { code: "analysis_result_stale" });
  assert.equal(store.dataSnapshots.size, 1);
  assert.equal(store.analysisResults.get(result.id).status, "awaiting_review");
});

test("publishes ordinary text and blank columns with sources without rewriting the prior snapshot", async () => {
  const { store, project, result } = setup();
  const prior = structuredClone(store.dataSnapshots.get("snapshot_base"));
  result.result.recordPatches[0].values.push({ columnId: "column_comments", displayName: "Comments", valueType: "string", unit: null, value: "Recovered source note", formattedValue: "Recovered source note", confidence: 1, warnings: [], sourceRefs: [{ sourceType: "excel_cell", sourceDocumentId: "source_master", sheet: "Runs", cell: "Y3" }] }, { columnId: "column_optional", displayName: "Optional note", valueType: "string", unit: null, value: null, missingReason: "source_blank", confidence: 1, warnings: [], sourceRefs: [{ sourceType: "excel_cell", sourceDocumentId: "source_master", sheet: "Runs", cell: "Z3" }] });
  store.analysisResults.set(result.id, result);
  const published = await publishAcceptedExperimentAnalysis({ store, project, actorUserId: "user_1", analysisRunId: "run_1", analysisResultId: result.id, idempotencyKey: "text_recovery" });
  const fields = published.dataSnapshot.experimentRecords[0].fields;
  assert.equal(fields.find(field => field.displayName === "Comments").value, "Recovered source note");
  assert.equal(fields.find(field => field.displayName === "Comments").sourceRefs[0].cell, "Y3");
  assert.equal(fields.find(field => field.displayName === "Optional note").value, null);
  assert.deepEqual(store.dataSnapshots.get("snapshot_base"), prior);
});
