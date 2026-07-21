import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";

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
