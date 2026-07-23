import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptAnalysisPlanRevision,
  analysisPlanRevisionSummary,
  analysisRunSummary,
  createAnalysisPlanRevision,
  createAnalysisThread,
  draftAnalysisPlanRevision,
  executeAnalysisRun,
  getAnalysisPlanSelectionPage,
  getAnalysisResultPreview,
  reviseAnalysisRun,
} from "./analysisThreads.js";
import { ANALYSIS_PLAN_REVISION_VERSION, ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";
import { MemorySaasStore } from "./memoryStore.js";

function plan(range = "A1:C3") {
  return {
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    requestSummary: "Plot the selected carbon distribution.",
    sourceSelections: [{
      regionUnderstandingRevisionId: "region_revision_1",
      sourceDocumentId: "source_1",
      sheetName: "Carbon",
      range,
      label: "Exp33 carbon distribution",
      purpose: "Use carbon labels and values for the chart",
    }],
    reviewPlan: {
      processingSteps: [
        "Read carbon labels from the first row and Exp33 values from the second row.",
        "Create one bar series.",
      ],
      missingValueHandling: "Exclude only empty carbon values.",
      chart: {
        title: "Exp33 carbon distribution",
        chartType: "bar",
        xDescription: "Carbon number",
        yDescription: "Distribution",
        seriesDescription: "Exp33",
      },
      invariants: [],
    },
    displayPlan: [
      "Use the red Carbon!A1:C3 range.",
      "Plot carbon number on X and Exp33 distribution on Y.",
    ],
    warnings: [],
  };
}

async function setup() {
  const store = new MemorySaasStore();
  const project = {
    id: "project_1",
    labId: "lab_1",
    name: "Analysis project",
  };
  store.sourceDocuments.set("source_1", {
    id: "source_1",
    projectId: project.id,
    originalFilename: "Exp33.xlsx",
  });
  store.sourceIndexBlobs.set("blob_1", {
    id: "blob_1",
    sourceDocumentId: "source_1",
    payload: {
      sheets: [{
        name: "Carbon",
        cellGrid: {
          cells: [
            { row: 0, col: 0, address: "A1", rawValue: "C1", formattedValue: "C1", type: "string" },
            { row: 0, col: 1, address: "B1", rawValue: "C2", formattedValue: "C2", type: "string" },
            { row: 0, col: 2, address: "C1", rawValue: "C3", formattedValue: "C3", type: "string" },
            { row: 1, col: 0, address: "A2", rawValue: 1, formattedValue: "1", type: "number" },
            { row: 1, col: 1, address: "B2", rawValue: 2, formattedValue: "2", type: "number" },
            { row: 1, col: 2, address: "C2", rawValue: 3, formattedValue: "3", type: "number" },
          ],
        },
      }],
    },
  });
  store.workbookReviewRegions.set("region_1", {
    id: "region_1",
    projectId: project.id,
    sourceDocumentId: "source_1",
    sheetName: "Carbon",
    rangeRef: "A1:C3",
    disposition: "active",
    acceptedRevisionId: "region_revision_1",
  });
  store.regionUnderstandingRevisions.set("region_revision_1", {
    id: "region_revision_1",
    projectId: project.id,
    regionId: "region_1",
    summary: ["Carbon distribution for Exp33."],
    interpretation: { semanticType: "component_distribution" },
  });
  const thread = await createAnalysisThread({
    store,
    project,
    actorUserId: "user_1",
    originalRequest: "Draw the carbon number distribution for Exp33.",
  });
  return { store, project, thread };
}

function programProvider({ draftPlan = plan(), source = null } = {}) {
  const pythonSource = source || [
    "def analyze(inputs, labrat):",
    "    table = inputs['tables'][0]",
    "    return {'plotly': {'data': [{'traceId': 'exp33', 'type': 'bar', 'name': 'Exp33', 'x': table['displayValues'][0], 'y': table['values'][1]}], 'layout': {'title': {'text': 'Exp33 carbon distribution'}}}, 'exclusions': [], 'checks': []}",
  ].join("\n");
  return {
    draftAnalysisPlan: async (_request, options) => {
      const inspected = await options.inspectSourceRange({
        regionUnderstandingRevisionId: "region_revision_1",
        range: "A1:C2",
      });
      assert.equal(inspected.cellCount, 6);
      return { ok: true, ...draftPlan };
    },
    draftAnalysisProgram: async (request, options) => {
      assert.equal(request.inputManifest.tables.length, 1);
      assert.equal(request.initialInputPages[0].values[1][0], 1);
      const page = options.inspectRunInput({
        tableId: request.inputManifest.tables[0].tableId,
        rowOffset: 0,
        rowLimit: 2,
        columnOffset: 0,
        columnLimit: 3,
      });
      assert.equal(page.values.length, 2);
      return {
        ok: true,
        pythonProgram: {
          runtime: ANALYSIS_RUNTIME_VERSION,
          entrypoint: "analyze",
          source: pythonSource,
        },
      };
    },
  };
}

const executor = {
  async executeAcceptedRun(runPackage) {
    const table = runPackage.inputs.tables[0];
    return {
      ok: true,
      adapter: "test_executor",
      runtime: { version: ANALYSIS_RUNTIME_VERSION },
      result: {
        plotly: {
          data: [{
            traceId: "exp33",
            type: "bar",
            name: "Exp33",
            x: table.displayValues[0],
            y: table.values[1],
          }],
          layout: { title: { text: "Exp33 carbon distribution" } },
        },
        exclusions: [],
        checks: [],
      },
    };
  },
};

test("plan revisions store source selections and readable plans but never Python", async () => {
  const { store, project, thread } = await setup();
  const first = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_1",
    plan: plan(),
  });
  const secondPlan = plan("A1:C2");
  secondPlan.displayPlan = ["Use the smaller red range.", ...secondPlan.displayPlan.slice(1)];
  const second = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_1",
    plan: secondPlan,
    feedback: "Only use the first two rows.",
  });
  const summary = analysisPlanRevisionSummary(second);
  const selection = await getAnalysisPlanSelectionPage({
    store,
    planRevisionId: second.id,
  });

  assert.equal(first.revision, 1);
  assert.equal((await store.findAnalysisPlanRevisionById(first.id)).status, "superseded");
  assert.equal(second.revision, 2);
  assert.equal(Object.hasOwn(summary, "pythonProgram"), false);
  assert.equal(summary.sourceSelections[0].range, "A1:C2");
  assert.deepEqual(selection.records, []);
  assert.deepEqual(selection.sourceRectangles.map((item) => item.range), ["A1:C2"]);
});

test("planning model browses confirmed source ranges and returns review-only data", async () => {
  const { store, project, thread } = await setup();
  const revision = await draftAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_1",
    modelProvider: programProvider(),
  });

  assert.equal(revision.status, "awaiting_review");
  assert.equal(revision.sourceSelections[0].range, "A1:C3");
  assert.equal(Object.hasOwn(revision.plan, "pythonProgram"), false);
});

test("acceptance is idempotent and Python is generated only while executing accepted inputs", async () => {
  const { store, project, thread } = await setup();
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_1",
    plan: plan(),
  });
  const accepted = await acceptAnalysisPlanRevision({
    store,
    project,
    actorUserId: "user_1",
    planRevisionId: revision.id,
    idempotencyKey: "accept_plan_1",
  });
  const replay = await acceptAnalysisPlanRevision({
    store,
    project,
    actorUserId: "user_1",
    planRevisionId: revision.id,
    idempotencyKey: "accept_plan_1",
  });

  assert.equal(accepted.analysisRun.status, "queued");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(store.analysisRuns.size, 1);
  assert.equal(Object.hasOwn(analysisRunSummary(accepted.analysisRun).execution, "pythonProgram"), false);

  const executed = await executeAnalysisRun({
    store,
    project,
    actorUserId: "user_1",
    analysisRunId: accepted.analysisRun.id,
    modelProvider: programProvider(),
    executor,
  });
  const preview = await getAnalysisResultPreview({
    store,
    analysisRunId: executed.analysisRun.id,
  });

  assert.equal(executed.analysisRun.status, "awaiting_result_review");
  assert.equal(executed.analysisResult.status, "awaiting_review");
  assert.equal(preview.summary.pointCount, 3);
  assert.deepEqual(preview.plotly.data[0].x, ["C1", "C2", "C3"]);
  assert.deepEqual(preview.plotly.data[0].y, [1, 2, 3]);
  assert.equal(store.analysisRuns.get(executed.analysisRun.id).payload.pythonProgram.runtime, ANALYSIS_RUNTIME_VERSION);
});

test("result feedback creates a new review revision and preserves the prior run", async () => {
  const { store, project, thread } = await setup();
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_1",
    plan: plan(),
  });
  const accepted = await acceptAnalysisPlanRevision({
    store,
    project,
    actorUserId: "user_1",
    planRevisionId: revision.id,
    idempotencyKey: "accept_for_revision",
  });
  await executeAnalysisRun({
    store,
    project,
    actorUserId: "user_1",
    analysisRunId: accepted.analysisRun.id,
    modelProvider: programProvider(),
    executor,
  });
  const revisedPlan = plan("A1:C2");
  revisedPlan.requestSummary = "Plot only C1-C3 from the selected rows.";
  const revised = await reviseAnalysisRun({
    store,
    project,
    actorUserId: "user_1",
    analysisRunId: accepted.analysisRun.id,
    feedback: "Use only the exact data rows.",
    modelProvider: programProvider({ draftPlan: revisedPlan }),
  });

  assert.equal(revised.analysisPlanRevision.revision, 2);
  assert.equal(revised.analysisPlanRevision.status, "awaiting_review");
  assert.equal(revised.priorAnalysisRun.status, "awaiting_result_review");
  assert.equal(store.analysisResults.size, 1);
});

test("invalid Plotly output finalizes with reviewable diagnostics and no empty result", async () => {
  const { store, project, thread } = await setup();
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_1",
    plan: plan(),
  });
  const accepted = await acceptAnalysisPlanRevision({
    store,
    project,
    actorUserId: "user_1",
    planRevisionId: revision.id,
    idempotencyKey: "accept_invalid",
  });
  const invalidExecutor = {
    async executeAcceptedRun() {
      return {
        ok: true,
        adapter: "test_executor",
        runtime: { version: ANALYSIS_RUNTIME_VERSION },
        result: { plotly: { data: [], layout: {} }, exclusions: [], checks: [] },
      };
    },
  };
  const executed = await executeAnalysisRun({
    store,
    project,
    actorUserId: "user_1",
    analysisRunId: accepted.analysisRun.id,
    modelProvider: programProvider(),
    executor: invalidExecutor,
  });

  assert.equal(executed.analysisRun.status, "validation_failed");
  assert.equal(executed.analysisResult, null);
  assert.equal(store.analysisResults.size, 0);
  assert.equal(
    executed.analysisRun.validation.errors.some((item) => item.code === "analysis_plotly_traces_required"),
    true,
  );
});
