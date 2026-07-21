import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";
import {
  confirmWorkbookReviewRegion,
  createWorkbookReviewRegionDraft,
  deleteWorkbookReviewRegion,
  ignoreWorkbookReviewRegion,
  reviseWorkbookReviewRegion,
} from "./workbookReviewRegions.js";

function regionInput(overrides = {}) {
  return {
    id: "workbook_review_region_1",
    labId: "lab_1",
    projectId: "project_1",
    workbookReviewSessionId: "workbook_review_session_1",
    sourceDocumentId: "source_document_1",
    sourceRegionId: "source_region_1",
    sheetName: "Runs",
    rangeRef: "A1:D3",
    selectionMethod: "detected_region",
    disposition: "active",
    reviewStatus: "interpreting",
    createdBy: "user_1",
    ...overrides,
  };
}

function revisionInput(overrides = {}) {
  return {
    id: "region_understanding_revision_1",
    labId: "lab_1",
    projectId: "project_1",
    workbookReviewSessionId: "workbook_review_session_1",
    sourceDocumentId: "source_document_1",
    regionId: "workbook_review_region_1",
    revisionNumber: 1,
    trigger: "initial",
    userFeedback: "",
    summary: ["Each row describes one experiment."],
    interpretation: { experimentAxis: "rows", confidence: 0.9 },
    sourceRefs: [{ sourceDocumentId: "source_document_1", sheet: "Runs", range: "A1:D3" }],
    sourceContentHash: "source_hash_1",
    dependencyHash: "dependency_hash_1",
    validation: { status: "ready", blockers: [] },
    provider: { provider: "anthropic", model: "test-model" },
    createdBy: "user_1",
    ...overrides,
  };
}

function sourceFixture() {
  const rows = [
    ["Experiment", "Temperature (C)", "Yield (%)"],
    ["Exp1", 250, 31.2],
    ["Exp2", 260, 35.1],
  ];
  const cells = rows.flatMap((row, rowIndex) => row.map((rawValue, colIndex) => ({
    address: `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}`,
    row: rowIndex,
    col: colIndex,
    rawValue,
    formattedValue: String(rawValue),
    type: typeof rawValue === "number" ? "number" : "string",
  })));
  return {
    session: {
      id: "workbook_review_session_1",
      labId: "lab_1",
      projectId: "project_1",
      sourceDocumentId: "source_document_1",
      workbookSummary: { workbookName: "Master.xlsx" },
      version: 1,
    },
    sourceDocument: {
      id: "source_document_1",
      fileObjectId: "file_1",
      importRunId: "import_run_1",
      metadata: {
        workbookName: "Master.xlsx",
        sheets: [{ name: "Runs", usedRange: "A1:C3", rowCount: 3, columnCount: 3 }],
      },
    },
    indexBlobs: [{
      payload: {
        sheets: [{
          name: "Runs",
          rowCount: 3,
          columnCount: 3,
          cellGrid: { range: "A1:C3", rowCount: 3, columnCount: 3, cells },
        }],
      },
    }],
  };
}

function modelProvider({ fail = false } = {}) {
  return {
    calls: [],
    async interpretWorkbookRegion(input) {
      this.calls.push(input);
      if (fail) {
        return {
          ok: false,
          warning: { code: "ai_unavailable", message: "Provider unavailable." },
        };
      }
      return {
        ok: true,
        summary: [
          "Each row represents one experiment.",
          "The table records temperature and yield.",
        ],
        interpretation: {
          semanticType: "experiment_table",
          experimentAxis: "rows",
          headerRow: 1,
          experimentIdColumn: "A",
          inclusion: { startRow: 2, endRow: 3, skippedRows: [] },
          confidence: 0.92,
          warnings: [],
        },
        metadata: {
          provider: "anthropic",
          model: "test-model",
          latencyMs: 12,
          usage: { inputTokens: 30, outputTokens: 20 },
        },
      };
    },
  };
}

test("memory store persists workbook review regions and immutable revisions", async () => {
  const store = new MemorySaasStore();

  const region = await store.createWorkbookReviewRegion(regionInput());
  const revision = await store.createRegionUnderstandingRevision(revisionInput());

  assert.equal(region.version, 1);
  assert.equal(revision.revisionNumber, 1);
  assert.deepEqual(
    await store.listRegionUnderstandingRevisions({ regionId: region.id }),
    [revision],
  );
  await assert.rejects(
    store.createRegionUnderstandingRevision(revisionInput({ id: "duplicate_revision" })),
    /revision number already exists/i,
  );
});

test("region updates increment versions without changing source ownership", async () => {
  const store = new MemorySaasStore();
  const created = await store.createWorkbookReviewRegion(regionInput());

  const updated = await store.updateWorkbookReviewRegion(created.id, {
    projectId: "other_project",
    sourceDocumentId: "other_source",
    reviewStatus: "awaiting_review",
    currentRevisionId: "region_understanding_revision_1",
  });

  assert.equal(updated.version, 2);
  assert.equal(updated.projectId, "project_1");
  assert.equal(updated.sourceDocumentId, "source_document_1");
  assert.equal(updated.reviewStatus, "awaiting_review");
});

test("accepted region listing excludes ignored, deleted, and unconfirmed regions", async () => {
  const store = new MemorySaasStore();
  const accepted = await store.createWorkbookReviewRegion(regionInput({
    id: "region_accepted",
    currentRevisionId: "revision_accepted",
    acceptedRevisionId: "revision_accepted",
    reviewStatus: "accepted",
  }));
  await store.createRegionUnderstandingRevision(revisionInput({
    id: "revision_accepted",
    regionId: accepted.id,
  }));
  await store.createWorkbookReviewRegion(regionInput({
    id: "region_unconfirmed",
    sourceRegionId: "source_region_2",
    rangeRef: "F1:H3",
    reviewStatus: "awaiting_review",
  }));
  await store.createWorkbookReviewRegion(regionInput({
    id: "region_ignored",
    sourceRegionId: "source_region_3",
    rangeRef: "J1:L3",
    disposition: "ignored",
    reviewStatus: "accepted",
    acceptedRevisionId: "revision_ignored",
  }));
  await store.createWorkbookReviewRegion(regionInput({
    id: "region_deleted",
    sourceRegionId: "source_region_4",
    rangeRef: "N1:P3",
    disposition: "deleted",
    reviewStatus: "accepted",
    acceptedRevisionId: "revision_deleted",
  }));

  const results = await store.listAcceptedRegionUnderstandings({ projectId: "project_1" });

  assert.equal(results.length, 1);
  assert.equal(results[0].region.id, accepted.id);
  assert.equal(results[0].revision.id, "revision_accepted");
});

test("creating a review region sends only bounded selected evidence to the model", async () => {
  const store = new MemorySaasStore();
  const fixture = sourceFixture();
  const provider = modelProvider();

  const result = await createWorkbookReviewRegionDraft({
    store,
    ...fixture,
    modelProvider: provider,
    actorUserId: "user_1",
    input: {
      sourceRegionId: "source_region_1",
      sheetName: "Runs",
      range: "A1:C3",
      selectionMethod: "detected_region",
    },
  });

  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].region.inspection.cellCount, 9);
  assert.equal(provider.calls[0].region.inspection.cells.length, 9);
  assert.equal("completeWorkbook" in provider.calls[0], false);
  assert.equal(result.region.reviewStatus, "awaiting_review");
  assert.equal(result.region.currentRevisionId, result.revision.id);
  assert.equal(result.revision.summary.length, 2);
  assert.equal(result.revision.interpretation.semanticType, "experiment_table");
  assert.equal(result.revision.interpretation.experimentIdColumn, "A");
});

test("provider failure preserves a retryable region without a revision", async () => {
  const store = new MemorySaasStore();
  const fixture = sourceFixture();

  const result = await createWorkbookReviewRegionDraft({
    store,
    ...fixture,
    modelProvider: modelProvider({ fail: true }),
    actorUserId: "user_1",
    input: { sheetName: "Runs", range: "A1:C3", selectionMethod: "manual" },
  });

  assert.equal(result.region.reviewStatus, "interpretation_failed");
  assert.equal(result.region.currentRevisionId, null);
  assert.equal(result.revision, null);
  assert.equal(result.warning.code, "ai_unavailable");
});

test("confirming and revising a region advances only exact accepted revisions", async () => {
  const store = new MemorySaasStore();
  const fixture = sourceFixture();
  const created = await createWorkbookReviewRegionDraft({
    store,
    ...fixture,
    modelProvider: modelProvider(),
    actorUserId: "user_1",
    input: { sheetName: "Runs", range: "A1:C3", selectionMethod: "manual" },
  });
  const confirmed = await confirmWorkbookReviewRegion({
    store,
    region: created.region,
    revisionId: created.revision.id,
    expectedRegionVersion: created.region.version,
    actorUserId: "user_1",
  });
  const revised = await reviseWorkbookReviewRegion({
    store,
    region: confirmed.region,
    ...fixture,
    modelProvider: modelProvider(),
    actorUserId: "user_1",
    input: {
      feedback: "Clarify that yield is an outcome.",
      previousRevisionId: created.revision.id,
      expectedRegionVersion: confirmed.region.version,
    },
  });

  assert.equal(confirmed.region.acceptedRevisionId, created.revision.id);
  assert.notEqual(revised.revision.id, created.revision.id);
  assert.equal(revised.region.currentRevisionId, revised.revision.id);
  assert.equal(revised.region.acceptedRevisionId, created.revision.id);
  await assert.rejects(
    confirmWorkbookReviewRegion({
      store,
      region: revised.region,
      revisionId: created.revision.id,
      expectedRegionVersion: revised.region.version,
      actorUserId: "user_1",
    }),
    (error) => error.code === "region_revision_not_current",
  );
});

test("ignore and delete are version-checked dispositions without revision deletion", async () => {
  const store = new MemorySaasStore();
  const fixture = sourceFixture();
  const created = await createWorkbookReviewRegionDraft({
    store,
    ...fixture,
    modelProvider: modelProvider(),
    actorUserId: "user_1",
    input: { sheetName: "Runs", range: "A1:C3", selectionMethod: "manual" },
  });
  const ignored = await ignoreWorkbookReviewRegion({
    store,
    region: created.region,
    expectedRegionVersion: created.region.version,
    reason: "Reference notes only.",
    actorUserId: "user_1",
  });
  const deleted = await deleteWorkbookReviewRegion({
    store,
    region: ignored.region,
    expectedRegionVersion: ignored.region.version,
    reason: "Selected by mistake.",
    actorUserId: "user_1",
  });

  assert.equal(ignored.region.disposition, "ignored");
  assert.equal(deleted.region.disposition, "deleted");
  assert.equal((await store.listRegionUnderstandingRevisions({ regionId: created.region.id })).length, 1);
  await assert.rejects(
    deleteWorkbookReviewRegion({
      store,
      region: deleted.region,
      expectedRegionVersion: created.region.version,
      reason: "stale",
      actorUserId: "user_1",
    }),
    (error) => error.code === "stale_workbook_review_region",
  );
});
