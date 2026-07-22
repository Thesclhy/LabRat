import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySaasStore } from "./memoryStore.js";

const LEASE_MS = 6 * 60 * 1000;

function seedThread(store, overrides = {}) {
  const thread = {
    id: overrides.id || "analysis_thread_retry_store",
    labId: "lab_retry_store",
    projectId: overrides.projectId || "project_retry_store",
    schemaVersion: "labrat.analysisThread.v1",
    status: "planning",
    originalRequest: "Compare accepted results.",
    messages: [],
    planRevisionIds: [],
    analysisRunIds: [],
    acceptedAnalysisResultIds: [],
    chartSpecIds: [],
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
    createdBy: "user_retry_store",
    updatedBy: "user_retry_store",
    ...overrides,
  };
  store.analysisThreads.set(thread.id, thread);
  return thread;
}

function claimInput(thread, overrides = {}) {
  return {
    labId: thread.labId,
    projectId: thread.projectId,
    analysisThreadId: thread.id,
    actorUserId: "user_retry_store",
    idempotencyKey: "retry_store_key_1",
    requestHash: "sha256_retry_store_request_1",
    claimedAt: "2026-07-22T12:01:00.000Z",
    leaseMs: LEASE_MS,
    ...overrides,
  };
}

test("memory retry receipts replay completed work and reject conflicting key reuse", async () => {
  const store = new MemorySaasStore();
  const thread = seedThread(store);
  const input = claimInput(thread);
  store.analysisPlanRevisions.set("analysis_plan_revision_retry_store_1", {
    id: "analysis_plan_revision_retry_store_1",
    projectId: thread.projectId,
    analysisThreadId: thread.id,
  });

  const claimed = await store.claimAnalysisThreadRetry(input);
  assert.equal(claimed.claimStatus, "claimed");
  assert.equal(claimed.receipt.status, "drafting");

  await assert.rejects(
    store.completeAnalysisThreadRetry({
      ...input,
      analysisPlanRevisionId: "analysis_plan_revision_wrong",
    }),
    (error) => error.code === "analysis_retry_receipt_conflict",
  );

  const completed = await store.completeAnalysisThreadRetry({
    ...input,
    analysisPlanRevisionId: "analysis_plan_revision_retry_store_1",
    completedAt: "2026-07-22T12:02:00.000Z",
  });
  assert.equal(completed.status, "completed");

  const replay = await store.claimAnalysisThreadRetry({
    ...input,
    claimedAt: "2026-07-22T12:03:00.000Z",
  });
  assert.equal(replay.claimStatus, "replay");
  assert.equal(replay.receipt.analysisPlanRevisionId, "analysis_plan_revision_retry_store_1");

  await assert.rejects(
    store.claimAnalysisThreadRetry({
      ...input,
      analysisThreadId: "analysis_thread_other",
      requestHash: "sha256_retry_store_request_2",
    }),
    (error) => error.code === "idempotency_key_conflict" && error.statusCode === 409,
  );
});

test("memory retry claims enforce a six-minute lease and recover abandoned drafting", async () => {
  const store = new MemorySaasStore();
  const thread = seedThread(store);
  const input = claimInput(thread);

  const first = await store.claimAnalysisThreadRetry(input);
  assert.equal(first.claimStatus, "claimed");

  const active = await store.claimAnalysisThreadRetry({
    ...input,
    claimedAt: "2026-07-22T12:06:59.999Z",
  });
  assert.equal(active.claimStatus, "in_progress");

  const recovered = await store.claimAnalysisThreadRetry({
    ...input,
    claimedAt: "2026-07-22T12:07:00.001Z",
  });
  assert.equal(recovered.claimStatus, "claimed");
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.receipt.attemptCount, 2);
});

test("memory retry release keeps the same receipt retryable", async () => {
  const store = new MemorySaasStore();
  const thread = seedThread(store);
  const input = claimInput(thread);

  await store.claimAnalysisThreadRetry(input);
  const released = await store.releaseAnalysisThreadRetry(input);
  assert.equal(released.receipt.status, "retryable");
  assert.equal(released.analysisThread.status, "planning");

  const retried = await store.claimAnalysisThreadRetry({
    ...input,
    claimedAt: "2026-07-22T12:02:00.000Z",
  });
  assert.equal(retried.claimStatus, "claimed");
  assert.equal(retried.receipt.attemptCount, 2);
});
