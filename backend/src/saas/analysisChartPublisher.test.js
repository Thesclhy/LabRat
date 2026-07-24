import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAnalysisResultChartSpec,
  publishAcceptedAnalysisChart,
} from "./analysisChartPublisher.js";
import { MemorySaasStore } from "./memoryStore.js";

function fixture() {
  const project = { id: "project_1", labId: "lab_1" };
  const sourceSelection = {
    sourceSelectionId: "source_selection_1",
    regionUnderstandingRevisionId: "region_revision_1",
    sourceDocumentId: "source_1",
    workbookName: "Exp33.xlsx",
    sheetName: "Carbon",
    range: "Q69:AI69",
    label: "Exp33 carbon distribution",
  };
  const thread = {
    id: "thread_1",
    labId: "lab_1",
    projectId: "project_1",
    status: "awaiting_result_review",
    acceptedAnalysisResultIds: [],
    chartSpecIds: [],
  };
  const planRevision = {
    id: "revision_1",
    labId: "lab_1",
    projectId: "project_1",
    analysisThreadId: "thread_1",
    status: "accepted",
    requestSummary: "Plot Exp33 carbon distribution.",
    plan: {
      sourceSelections: [sourceSelection],
      reviewPlan: {
        chart: {
          title: "Carbon number distribution",
          chartType: "bar",
        },
      },
    },
  };
  const run = {
    id: "run_1",
    labId: "lab_1",
    projectId: "project_1",
    analysisThreadId: "thread_1",
    acceptedPlanRevisionId: "revision_1",
    status: "awaiting_result_review",
    resultPreviewHash: "sha256_preview_1",
  };
  const result = {
    id: "result_1",
    labId: "lab_1",
    projectId: "project_1",
    analysisThreadId: "thread_1",
    analysisRunId: "run_1",
    status: "awaiting_review",
    contentHash: "sha256_result_1",
    resultPreviewHash: "sha256_preview_1",
    result: {
      plotly: {
        data: [{
          traceId: "exp33",
          meta: { labrat: { traceId: "exp33" } },
          type: "bar",
          name: "Exp33",
          x: ["C1", "C2", "C3"],
          y: [1, 2, 3],
        }, {
          traceId: "exp32",
          meta: { labrat: { traceId: "exp32" } },
          type: "bar",
          name: "Exp32",
          x: ["C1", "C2", "C3"],
          y: [2, 3, 4],
        }],
        layout: { barmode: "group" },
      },
      summary: { pointCount: 6, seriesCount: 2, excludedCount: 0 },
    },
    sourceRefs: [],
    warnings: [],
    validation: { ok: true, errors: [] },
  };
  return { project, sourceSelection, thread, planRevision, run, result };
}

function seededStore() {
  const store = new MemorySaasStore();
  const value = fixture();
  store.sourceDocuments.set("source_1", {
    id: "source_1",
    projectId: "project_1",
    originalFilename: "Exp33.xlsx",
  });
  store.workbookReviewRegions.set("region_1", {
    id: "region_1",
    projectId: "project_1",
    sourceDocumentId: "source_1",
    sheetName: "Carbon",
    rangeRef: "A1:CE107",
    disposition: "active",
    acceptedRevisionId: "region_revision_1",
  });
  store.regionUnderstandingRevisions.set("region_revision_1", {
    id: "region_revision_1",
    projectId: "project_1",
    regionId: "region_1",
    interpretation: {},
  });
  store.analysisThreads.set(value.thread.id, structuredClone(value.thread));
  store.analysisPlanRevisions.set(value.planRevision.id, structuredClone(value.planRevision));
  store.analysisRuns.set(value.run.id, structuredClone(value.run));
  store.analysisResults.set(value.result.id, structuredClone(value.result));
  return { store, ...value };
}

function useExperimentSelection(value) {
  const baseHeadRef = {
    experimentId: "experiment_1",
    headId: "head_1",
    dataSnapshotId: "snapshot_1",
    recordIndex: 0,
  };
  value.store.experimentIdentities.set("experiment_1", {
    id: "experiment_1",
    projectId: value.project.id,
    canonicalLabel: "Exp1",
    aliases: ["Exp1"],
  });
  value.store.dataSnapshots.set("snapshot_1", {
    id: "snapshot_1",
    labId: value.project.labId,
    projectId: value.project.id,
    schemaVersion: "labrat.dataSnapshot.v4",
    status: "accepted",
    experimentRecords: [{
      experimentId: "experiment_1",
      label: "Exp1",
      fields: [{
        columnId: "column_impeller",
        displayName: "Impeller",
        valueType: "string",
        unit: null,
        value: "flat",
        formattedValue: "flat",
        sourceRefs: [],
      }],
      series: [],
    }],
  });
  value.store.experimentSnapshotHeads.set("head_1", {
    id: "head_1",
    projectId: value.project.id,
    experimentId: "experiment_1",
    dataSnapshotId: "snapshot_1",
    recordIndex: 0,
  });
  value.planRevision.plan.sourceSelections = [];
  value.planRevision.plan.experimentSelections = [{
    experimentSelectionId: "experiment_selection_1",
    experimentId: "experiment_1",
    columnIndexes: [0],
    fieldLabels: ["Impeller"],
    includeSeries: false,
    purpose: "Count the selected Impeller values.",
    baseHeadRef,
  }];
  value.store.analysisPlanRevisions.set(
    value.planRevision.id,
    structuredClone(value.planRevision),
  );
  return baseHeadRef;
}

test("builds a v3 ChartSpec with authoritative Plotly and a flat trace catalog", () => {
  const value = fixture();
  const spec = buildAnalysisResultChartSpec({
    ...value,
    defaultVisibleTraceIds: ["exp33"],
    actorUserId: "user_1",
    createdAt: "2026-07-23T00:00:00.000Z",
  });

  assert.equal(spec.schemaVersion, "labrat.chartSpec.v3");
  assert.deepEqual(spec.plotly.data[0].x, ["C1", "C2", "C3"]);
  assert.deepEqual(spec.traceCatalog.map((item) => item.traceId), ["exp33", "exp32"]);
  assert.deepEqual(spec.defaultChartView.visibleTraceIds, ["exp33"]);
});

test("publishes a validated result atomically and replays the idempotency key", async () => {
  const value = seededStore();
  const request = {
    store: value.store,
    project: value.project,
    actorUserId: "user_1",
    runId: value.run.id,
    analysisResultId: value.result.id,
    defaultVisibleTraceIds: ["exp33", "exp32"],
    idempotencyKey: "publish_result_1",
  };

  const first = await publishAcceptedAnalysisChart(request);
  const replay = await publishAcceptedAnalysisChart(request);

  assert.equal(first.chartSpec.spec.schemaVersion, "labrat.chartSpec.v3");
  assert.equal(first.analysisRun.status, "completed");
  assert.equal(first.analysisResult.status, "accepted");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(value.store.chartSpecs.size, 1);
});

test("publishes a chart from reviewed experiment selections and protects frozen heads", async () => {
  const value = seededStore();
  useExperimentSelection(value);
  const request = {
    store: value.store,
    project: value.project,
    actorUserId: "user_1",
    runId: value.run.id,
    analysisResultId: value.result.id,
    defaultVisibleTraceIds: ["exp33", "exp32"],
    idempotencyKey: "publish_experiment_chart",
  };

  const published = await publishAcceptedAnalysisChart(request);
  assert.deepEqual(published.chartSpec.spec.sourceSelections, []);
  assert.equal(published.chartSpec.spec.experimentSelections[0].fieldLabels[0], "Impeller");

  const stale = seededStore();
  useExperimentSelection(stale);
  stale.store.experimentSnapshotHeads.set("head_1", {
    id: "head_2",
    projectId: stale.project.id,
    experimentId: "experiment_1",
    dataSnapshotId: "snapshot_1",
    recordIndex: 0,
  });
  await assert.rejects(
    () => publishAcceptedAnalysisChart({
      ...request,
      store: stale.store,
      idempotencyKey: "publish_stale_experiment_chart",
    }),
    (error) => error.code === "analysis_result_stale",
  );
});

test("rejects unknown or empty visible curve selections before publication", async () => {
  const value = seededStore();

  await assert.rejects(
    () => publishAcceptedAnalysisChart({
      store: value.store,
      project: value.project,
      actorUserId: "user_1",
      runId: value.run.id,
      analysisResultId: value.result.id,
      defaultVisibleTraceIds: ["unknown"],
      idempotencyKey: "bad_trace",
    }),
    (error) => error.code === "analysis_chart_trace_unknown",
  );
  assert.equal(value.store.chartSpecs.size, 0);
});
