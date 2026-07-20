import test from "node:test";
import assert from "node:assert/strict";

import { stableDataHash } from "./dataPlanSchemas.js";
import { MemorySaasStore } from "./memoryStore.js";
import { publishAcceptedAnalysisChart } from "./analysisChartPublisher.js";

function publicationFixture({ traceCount = 60 } = {}) {
  const store = new MemorySaasStore();
  const project = {
    id: "project_analysis_publish",
    labId: "lab_analysis_publish",
  };
  const actorUserId = "user_analysis_editor";
  const analysisThreadId = "analysis_thread_publish";
  const planRevisionId = "analysis_plan_publish";
  const runId = "analysis_run_publish";
  const resultId = "analysis_result_publish";
  const records = Array.from({ length: traceCount }, (_, index) => {
    const number = index + 1;
    const experimentId = `experiment_${number}`;
    const snapshotId = `snapshot_${number}`;
    const headId = `head_${number}`;
    store.dataSnapshots.set(snapshotId, {
      id: snapshotId,
      labId: project.labId,
      projectId: project.id,
      status: "accepted",
      contentHash: `sha256_snapshot_${number}`,
      dependencyHash: `sha256_dependency_${number}`,
    });
    store.experimentSnapshotHeads.set(headId, {
      id: headId,
      labId: project.labId,
      projectId: project.id,
      experimentId,
      dataSnapshotId: snapshotId,
      recordIndex: 0,
    });
    return {
      experimentId,
      experimentLabel: `Exp ${number}`,
      snapshotId,
      headId,
      recordIndex: 0,
      fields: [],
      series: [],
    };
  });
  const selectionHash = "sha256_selection_publish";
  const dependencyHash = "sha256_dependency_publish";
  const planHash = "sha256_plan_publish";
  const programHash = "sha256_program_publish";
  const traces = records.map((record, index) => ({
    traceId: `trace_exp_${index + 1}`,
    experimentId: record.experimentId,
    experimentLabel: record.experimentLabel,
    xField: "reaction_time",
    yField: "reaction_rate",
    xUnit: "min",
    yUnit: "mmol/g/min",
    x: [0, 10],
    y: [index + 1, index + 2],
    sourceRecordIds: [`${record.snapshotId}:0`],
  }));
  const resultPayload = {
    resultTable: [],
    traces,
    lineage: Object.fromEntries(traces.map((trace) => [
      trace.traceId,
      { sourceRecordIds: trace.sourceRecordIds },
    ])),
    summary: {
      inputRecordCount: traceCount,
      outputRecordCount: 0,
      excludedRecordCount: traceCount,
      excludedRecords: records.map((record) => ({
        sourceRecordId: `${record.snapshotId}:0`,
        reason: "Trace-only output.",
      })),
      missingValuePolicy: "exclude_record",
    },
  };
  const resultHash = stableDataHash(resultPayload);
  const resultPreviewHash = stableDataHash({
    resultTable: resultPayload.resultTable,
    traces: resultPayload.traces,
    summary: resultPayload.summary,
  });
  store.analysisThreads.set(analysisThreadId, {
    id: analysisThreadId,
    labId: project.labId,
    projectId: project.id,
    status: "awaiting_result_review",
    planRevisionIds: [planRevisionId],
    analysisRunIds: [runId],
    acceptedAnalysisResultIds: [],
    chartSpecIds: [],
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
  store.analysisPlanRevisions.set(planRevisionId, {
    id: planRevisionId,
    labId: project.labId,
    projectId: project.id,
    analysisThreadId,
    revision: 1,
    status: "accepted",
    requestSummary: "Compare reaction rate over time across all experiments.",
    planHash,
    selectionHash,
    dependencyHash,
    programHash,
    runtimeVersion: "labrat-python-v1",
    selection: {
      selectionHash,
      dependencyHash,
      records,
    },
    expectedOutput: {
      shape: "experiment_traces",
      chartType: "scatter",
      xField: "reaction_time",
      yFields: ["reaction_rate"],
    },
  });
  store.analysisRuns.set(runId, {
    id: runId,
    labId: project.labId,
    projectId: project.id,
    analysisThreadId,
    acceptedPlanRevisionId: planRevisionId,
    status: "awaiting_result_review",
    inputHash: selectionHash,
    programHash,
    runtimeVersion: "labrat-python-v1",
    resultPreviewHash,
    validation: { ok: true, errors: [] },
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
  store.analysisResults.set(resultId, {
    id: resultId,
    labId: project.labId,
    projectId: project.id,
    analysisThreadId,
    analysisRunId: runId,
    schemaVersion: "labrat.analysisResult.v1",
    status: "awaiting_review",
    contentHash: resultHash,
    resultPreviewHash,
    result: resultPayload,
    sourceRefs: [],
    warnings: [],
    validation: { ok: true, errors: [] },
    acceptedAt: null,
    acceptedBy: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
  return {
    store,
    project,
    actorUserId,
    runId,
    resultId,
    resultHash,
    records,
    traces,
  };
}

test("publishes an accepted result and complete trace catalog atomically", async () => {
  const fixture = publicationFixture();
  const request = {
    store: fixture.store,
    project: fixture.project,
    actorUserId: fixture.actorUserId,
    runId: fixture.runId,
    resultHash: fixture.resultHash,
    defaultVisibleTraceIds: ["trace_exp_1"],
    idempotencyKey: "publish_analysis_chart_1",
  };

  const published = await publishAcceptedAnalysisChart(request);
  const replay = await publishAcceptedAnalysisChart(request);

  assert.equal(published.analysisResult.status, "accepted");
  assert.equal(published.analysisRun.status, "completed");
  assert.equal(published.analysisThread.status, "completed");
  assert.equal(published.chartSpec.spec.origin, "analysis_result");
  assert.equal(published.chartSpec.spec.traceCatalog.length, 60);
  assert.deepEqual(
    published.chartSpec.spec.defaultChartView.visibleTraceIds,
    ["trace_exp_1"],
  );
  assert.equal(published.chartSpec.spec.inputSnapshotRefs.length, 60);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.chartSpec.id, published.chartSpec.id);
  assert.equal((await fixture.store.listChartSpecs({
    projectId: fixture.project.id,
  })).length, 1);
  await assert.rejects(
    publishAcceptedAnalysisChart({
      ...request,
      idempotencyKey: "publish_same_result_again",
    }),
    (error) => error.code === "analysis_result_state_conflict",
  );
});

test("rejects changed active snapshot heads without partial publication writes", async () => {
  const fixture = publicationFixture({ traceCount: 2 });
  fixture.store.experimentSnapshotHeads.set("head_1", {
    ...fixture.store.experimentSnapshotHeads.get("head_1"),
    dataSnapshotId: "snapshot_replaced",
  });

  await assert.rejects(
    publishAcceptedAnalysisChart({
      store: fixture.store,
      project: fixture.project,
      actorUserId: fixture.actorUserId,
      runId: fixture.runId,
      resultHash: fixture.resultHash,
      defaultVisibleTraceIds: ["trace_exp_1"],
      idempotencyKey: "publish_stale_analysis_chart",
    }),
    (error) => error.code === "analysis_result_stale" && error.statusCode === 409,
  );

  assert.equal(
    (await fixture.store.findAnalysisResultById(fixture.resultId)).status,
    "awaiting_review",
  );
  assert.equal((await fixture.store.listChartSpecs({
    projectId: fixture.project.id,
  })).length, 0);
  assert.equal(await fixture.store.findAnalysisPublication({
    projectId: fixture.project.id,
    idempotencyKey: "publish_stale_analysis_chart",
  }), null);
});

test("rejects result-hash and trace-selection mismatches before publication", async () => {
  const fixture = publicationFixture({ traceCount: 2 });

  await assert.rejects(
    publishAcceptedAnalysisChart({
      store: fixture.store,
      project: fixture.project,
      actorUserId: fixture.actorUserId,
      runId: fixture.runId,
      resultHash: "sha256_wrong_result",
      defaultVisibleTraceIds: ["trace_exp_1"],
      idempotencyKey: "publish_wrong_result_hash",
    }),
    (error) => error.code === "analysis_result_hash_mismatch",
  );
  await assert.rejects(
    publishAcceptedAnalysisChart({
      store: fixture.store,
      project: fixture.project,
      actorUserId: fixture.actorUserId,
      runId: fixture.runId,
      resultHash: fixture.resultHash,
      defaultVisibleTraceIds: ["trace_unknown"],
      idempotencyKey: "publish_unknown_trace",
    }),
    (error) => error.code === "analysis_chart_trace_unknown",
  );

  assert.equal((await fixture.store.listChartSpecs({
    projectId: fixture.project.id,
  })).length, 0);
});
