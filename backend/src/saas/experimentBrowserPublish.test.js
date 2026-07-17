import assert from "node:assert/strict";
import { test } from "node:test";

import { MemorySaasStore } from "./memoryStore.js";
import {
  loadExperimentDataPlanReview,
  publishExperimentBrowserData,
} from "./experimentBrowserPublish.js";

function workbookCells(rows) {
  const columns = ["A", "B", "C"];
  return rows.flatMap((row, rowIndex) => row.map((rawValue, colIndex) => ({
    address: `${columns[colIndex]}${rowIndex + 1}`,
    row: rowIndex,
    col: colIndex,
    rawValue,
    formattedValue: rawValue == null ? null : String(rawValue),
    type: typeof rawValue === "number" ? "number" : "string",
  })));
}

function understandingFact({ sourceDocumentId, factId, range, endRow }) {
  return {
    factId,
    sourceDocumentId,
    sheetName: "Runs",
    range,
    semanticType: "experiment_table",
    interpretation: {
      experimentAxis: "rows",
      headerRow: 1,
      experimentIdColumn: "A",
      experimentLabel: null,
      fields: [
        {
          column: "B",
          headerCell: "B1",
          semanticKey: "reaction_temperature",
          displayName: "Temperature",
          role: "condition",
          valueType: "number",
          unit: "degC",
          confidence: 0.95,
        },
        {
          column: "C",
          headerCell: "C1",
          semanticKey: "yield",
          displayName: "Yield",
          role: "outcome",
          valueType: "number",
          unit: "percent",
          confidence: 0.9,
        },
      ],
      series: [],
      inclusion: { startRow: 2, endRow, skippedRows: [] },
      confidence: 0.94,
      excluded: false,
    },
  };
}

async function seedProject({
  rows = [
    ["Experiment", "Temperature", "Yield"],
    ["Exp1", 250, 31.2],
    ["Exp2", 275, 28.4],
  ],
  understandingId = "workbook_understanding_publish_1",
  factId = "fact_publish_1",
  range = "A1:C3",
} = {}) {
  const store = new MemorySaasStore();
  const project = await store.createProject({
    labId: "lab_publish",
    name: "Publish test",
    createdBy: "user_editor",
  });
  const sourceDocument = await store.replaceSourceDocumentIndex({
    id: "source_document_publish_1",
    labId: project.labId,
    projectId: project.id,
    fileObjectId: "file_publish_1",
    importRunId: "import_publish_1",
    indexVersion: "labrat.sourceIndex.v1",
    metadata: { checksumSha256: "workbook_checksum_1" },
    indexBlobs: [{
      id: "source_index_publish_1",
      checksumSha256: "index_checksum_1",
      payload: {
        sheets: [{
          name: "Runs",
          cellGrid: { cells: workbookCells(rows) },
        }],
      },
    }],
    createdBy: "user_editor",
  });
  const understanding = await store.createWorkbookUnderstanding({
    id: understandingId,
    labId: project.labId,
    projectId: project.id,
    sourceDocumentId: sourceDocument.id,
    workbookReviewSessionId: "workbook_review_session_publish_1",
    status: "accepted",
    version: 1,
    facts: [understandingFact({
      sourceDocumentId: sourceDocument.id,
      factId,
      range,
      endRow: rows.length,
    })],
    createdBy: "user_editor",
  });
  return { store, project, sourceDocument, understanding };
}

async function draftReview({ store, project, understandingIds, identityDecisions }) {
  return loadExperimentDataPlanReview({
    store,
    project,
    workbookUnderstandingIds: understandingIds,
    identityDecisions,
  });
}

async function publishReview({ store, project, review, identityDecisions, idempotencyKey }) {
  return publishExperimentBrowserData({
    store,
    project,
    actorUserId: "user_editor",
    dataPlan: review.dataPlan,
    identityDecisions,
    expectedPreviewHash: review.snapshotPreview.previewHash,
    expectedDependencyHash: review.dataPlan.dependencyHash,
    idempotencyKey,
  });
}

test("publishes accepted plans, immutable snapshots, identities, heads, and audit atomically", async () => {
  const { store, project, understanding } = await seedProject();
  const decisions = [
    { sourceAlias: "Exp1", action: "create" },
    { sourceAlias: "Exp2", action: "create" },
  ];
  const review = await draftReview({
    store,
    project,
    understandingIds: [understanding.id],
    identityDecisions: decisions,
  });
  const result = await publishReview({
    store,
    project,
    review,
    identityDecisions: decisions,
    idempotencyKey: "publish_success_1",
  });

  assert.equal(result.idempotentReplay, false);
  assert.equal(result.dataPlan.status, "accepted");
  assert.equal(result.dataSnapshot.status, "accepted");
  assert.equal(result.dataSnapshot.experimentRecordCount, 2);
  assert.equal(result.experimentIdentities.length, 2);
  assert.equal(result.experimentSnapshotHeads.length, 2);
  assert.equal((await store.listDataPlans({ projectId: project.id })).length, 1);
  assert.equal((await store.listDataSnapshots({ projectId: project.id })).length, 1);
  assert.equal((await store.listExperimentIdentities({ projectId: project.id })).length, 2);
  assert.equal((await store.listExperimentSnapshotHeads({ projectId: project.id })).length, 2);
  const storedSnapshot = (await store.listDataSnapshots({ projectId: project.id }))[0];
  assert.equal(storedSnapshot.experimentRecords.every((record) => record.experimentId && record.identityCandidateKey == null), true);
  assert.match(storedSnapshot.contentHash, /^sha256_/);
  assert.equal((await store.listAuditEvents({ projectId: project.id })).some((event) => event.action === "data_snapshot.publish"), true);
  assert.equal("datasetCommits" in store, false);
  assert.equal(store.chartProposalSets.size, 0);
  assert.equal(store.chartSpecs.size, 0);
  assert.equal(store.manuscripts.size, 0);
});

test("returns exact idempotent retries and rejects reuse of a key for another request", async () => {
  const { store, project, understanding } = await seedProject();
  const decisions = [
    { sourceAlias: "Exp1", action: "create" },
    { sourceAlias: "Exp2", action: "create" },
  ];
  const review = await draftReview({ store, project, understandingIds: [understanding.id], identityDecisions: decisions });
  const first = await publishReview({ store, project, review, identityDecisions: decisions, idempotencyKey: "publish_retry_1" });
  const retry = await publishReview({ store, project, review, identityDecisions: decisions, idempotencyKey: "publish_retry_1" });

  assert.equal(retry.idempotentReplay, true);
  assert.equal(retry.dataPlan.id, first.dataPlan.id);
  assert.equal(retry.dataSnapshot.id, first.dataSnapshot.id);
  assert.equal((await store.listDataPlans({ projectId: project.id })).length, 1);
  assert.equal((await store.listDataSnapshots({ projectId: project.id })).length, 1);

  await assert.rejects(
    publishExperimentBrowserData({
      store,
      project,
      actorUserId: "user_editor",
      dataPlan: review.dataPlan,
      identityDecisions: decisions,
      expectedPreviewHash: "sha256_different_request",
      expectedDependencyHash: review.dataPlan.dependencyHash,
      idempotencyKey: "publish_retry_1",
    }),
    (error) => error.code === "idempotency_key_conflict" && error.statusCode === 409,
  );
});

test("rejects stale source dependencies before any durable write", async () => {
  const { store, project, sourceDocument, understanding } = await seedProject();
  const decisions = [
    { sourceAlias: "Exp1", action: "create" },
    { sourceAlias: "Exp2", action: "create" },
  ];
  const review = await draftReview({ store, project, understandingIds: [understanding.id], identityDecisions: decisions });
  await store.replaceSourceDocumentIndex({
    id: sourceDocument.id,
    labId: project.labId,
    projectId: project.id,
    fileObjectId: sourceDocument.fileObjectId,
    importRunId: sourceDocument.importRunId,
    indexVersion: "labrat.sourceIndex.v2",
    metadata: { checksumSha256: "workbook_checksum_changed" },
    indexBlobs: [{
      checksumSha256: "index_checksum_changed",
      payload: {
        sheets: [{
          name: "Runs",
          cellGrid: { cells: workbookCells([
            ["Experiment", "Temperature", "Yield"],
            ["Exp1", 251, 32.2],
            ["Exp2", 276, 29.4],
          ]) },
        }],
      },
    }],
    updatedBy: "user_editor",
  });

  await assert.rejects(
    publishReview({ store, project, review, identityDecisions: decisions, idempotencyKey: "publish_stale_1" }),
    (error) => (
      error.code === "preview_stale"
      && error.statusCode === 409
      && Boolean(error.details?.currentReview?.snapshotPreview?.previewHash)
    ),
  );
  assert.equal((await store.listDataPlans({ projectId: project.id })).length, 0);
  assert.equal((await store.listDataSnapshots({ projectId: project.id })).length, 0);
  assert.equal((await store.listExperimentSnapshotHeads({ projectId: project.id })).length, 0);
});

test("validates a memory publish package before committing any staged records", async () => {
  const store = new MemorySaasStore();
  await assert.rejects(
    store.publishExperimentSnapshot({
      labId: "lab_1",
      projectId: "project_1",
      actorUserId: "user_1",
      idempotencyKey: "publish_invalid_package",
      requestHash: "sha256_request",
      dataPlan: { id: "data_plan_1", projectId: "project_1" },
      dataSnapshot: { id: "data_snapshot_1", projectId: "project_1", experimentRecords: [] },
      experimentIdentities: [],
      experimentSnapshotHeads: [{
        id: "experiment_snapshot_head_invalid",
        projectId: "project_1",
        experimentId: "experiment_missing",
        dataSnapshotId: "data_snapshot_1",
        recordIndex: 2,
      }],
      auditEvents: [],
      response: {},
    }),
    (error) => error.code === "invalid_publish_package",
  );
  assert.equal((await store.listDataPlans({ projectId: "project_1" })).length, 0);
  assert.equal((await store.listDataSnapshots({ projectId: "project_1" })).length, 0);
  assert.equal((await store.listExperimentSnapshotHeads({ projectId: "project_1" })).length, 0);
});

test("a later partial snapshot advances only affected experiment heads", async () => {
  const { store, project, sourceDocument, understanding } = await seedProject();
  const firstDecisions = [
    { sourceAlias: "Exp1", action: "create" },
    { sourceAlias: "Exp2", action: "create" },
  ];
  const firstReview = await draftReview({ store, project, understandingIds: [understanding.id], identityDecisions: firstDecisions });
  const first = await publishReview({ store, project, review: firstReview, identityDecisions: firstDecisions, idempotencyKey: "publish_heads_1" });
  const identityByLabel = new Map(first.experimentIdentities.map((identity) => [identity.canonicalLabel, identity]));
  const firstHeadByExperiment = new Map(first.experimentSnapshotHeads.map((head) => [head.experimentId, head]));

  await store.replaceSourceDocumentIndex({
    id: sourceDocument.id,
    labId: project.labId,
    projectId: project.id,
    fileObjectId: sourceDocument.fileObjectId,
    importRunId: sourceDocument.importRunId,
    indexVersion: "labrat.sourceIndex.v2",
    metadata: { checksumSha256: "workbook_checksum_partial" },
    indexBlobs: [{
      checksumSha256: "index_checksum_partial",
      payload: {
        sheets: [{
          name: "Runs",
          cellGrid: { cells: workbookCells([
            ["Experiment", "Temperature", "Yield"],
            ["Exp1", 260, 35.1],
          ]) },
        }],
      },
    }],
    updatedBy: "user_editor",
  });
  const partialUnderstanding = await store.createWorkbookUnderstanding({
    id: "workbook_understanding_publish_partial",
    labId: project.labId,
    projectId: project.id,
    sourceDocumentId: sourceDocument.id,
    workbookReviewSessionId: "workbook_review_session_publish_partial",
    status: "accepted",
    version: 1,
    facts: [understandingFact({
      sourceDocumentId: sourceDocument.id,
      factId: "fact_publish_partial",
      range: "A1:C2",
      endRow: 2,
    })],
    createdBy: "user_editor",
  });
  const secondDecisions = [{
    sourceAlias: "Exp1",
    action: "reuse",
    experimentIdentityId: identityByLabel.get("Exp1").id,
  }];
  const secondReview = await draftReview({
    store,
    project,
    understandingIds: [partialUnderstanding.id],
    identityDecisions: secondDecisions,
  });
  const second = await publishReview({
    store,
    project,
    review: secondReview,
    identityDecisions: secondDecisions,
    idempotencyKey: "publish_heads_2",
  });
  const currentHeads = new Map((await store.listExperimentSnapshotHeads({ projectId: project.id })).map((head) => [head.experimentId, head]));

  assert.notEqual(currentHeads.get(identityByLabel.get("Exp1").id).dataSnapshotId, firstHeadByExperiment.get(identityByLabel.get("Exp1").id).dataSnapshotId);
  assert.equal(currentHeads.get(identityByLabel.get("Exp1").id).dataSnapshotId, second.dataSnapshot.id);
  assert.equal(currentHeads.get(identityByLabel.get("Exp2").id).dataSnapshotId, firstHeadByExperiment.get(identityByLabel.get("Exp2").id).dataSnapshotId);
});

test("BrowserView storage supports owner-scoped create, update, list, and delete", async () => {
  const store = new MemorySaasStore();
  const created = await store.createBrowserView({
    labId: "lab_1",
    projectId: "project_1",
    ownerUserId: "user_1",
    name: "My comparison",
    payload: { columns: [{ columnId: "yield", order: 1, width: 120, hidden: false }] },
    isDefault: true,
  });
  const updated = await store.updateBrowserView(created.id, {
    name: "Updated comparison",
    payload: { columns: [], filters: [{ field: "yield", op: "gt", value: 20 }] },
  });

  assert.equal(updated.name, "Updated comparison");
  assert.equal((await store.listBrowserViews({ projectId: "project_1", ownerUserId: "user_1" })).length, 1);
  assert.equal((await store.findBrowserViewById(created.id)).payload.filters.length, 1);
  assert.equal(await store.deleteBrowserView(created.id), true);
  assert.equal(await store.findBrowserViewById(created.id), null);
});
