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
import { experimentFieldColumnId } from "./experimentProjection.js";
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

test("execution errors trigger one automatic Python repair without revising the accepted plan", async () => {
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
    idempotencyKey: "accept_auto_repair",
  });
  let draftCount = 0;
  const repairingProvider = programProvider();
  const originalDraft = repairingProvider.draftAnalysisProgram;
  repairingProvider.draftAnalysisProgram = async (request, options) => {
    draftCount += 1;
    if (draftCount === 2) {
      assert.equal(request.repairContext.attempt, 1);
      assert.equal(request.repairContext.errors[0].code, "analysis_python_runner_failed");
      assert.match(request.repairContext.previousProgram.source, /def analyze/);
    }
    return originalDraft(request, options);
  };
  let executionCount = 0;
  const repairingExecutor = {
    async executeAcceptedRun(runPackage) {
      executionCount += 1;
      if (executionCount === 1) {
        return {
          ok: false,
          adapter: "test_executor",
          error: {
            code: "analysis_python_runner_failed",
            message: "expected an indented block",
          },
        };
      }
      return executor.executeAcceptedRun(runPackage);
    },
  };

  const executed = await executeAnalysisRun({
    store,
    project,
    actorUserId: "user_1",
    analysisRunId: accepted.analysisRun.id,
    modelProvider: repairingProvider,
    executor: repairingExecutor,
  });

  assert.equal(executed.analysisRun.status, "awaiting_result_review");
  assert.equal(draftCount, 2);
  assert.equal(executionCount, 2);
  assert.deepEqual(
    store.analysisRuns.get(executed.analysisRun.id).payload.programAttempts.map((item) => item.outcome),
    ["execution_failed", "result_ready"],
  );
  assert.equal(store.analysisPlanRevisions.size, 1);
});

test("Experiment Browser analysis materializes active fields and returns a patch preview", async () => {
  const { store, project } = await setup();
  const temperature = {
    fieldKey: "temperature",
    displayName: "Temperature",
    role: "condition",
    valueType: "number",
    unit: "degC",
    value: 250,
    formattedValue: "250",
    sourceRefs: [{
      sourceType: "excel_cell",
      sourceDocumentId: "source_1",
      sheet: "Carbon",
      cell: "A2",
    }],
  };
  const columnId = experimentFieldColumnId(temperature);
  store.experimentIdentities.set("experiment_31", {
    id: "experiment_31",
    projectId: project.id,
    canonicalLabel: "Exp31",
    aliases: ["Experiment 31"],
  });
  store.dataSnapshots.set("snapshot_31", {
    id: "snapshot_31",
    projectId: project.id,
    status: "accepted",
    experimentRecords: [{
      experimentId: "experiment_31",
      label: "Exp31",
      aliases: ["Exp31"],
      fields: [temperature],
      series: [],
      warnings: [],
      sourceRefs: [],
    }],
  });
  store.experimentSnapshotHeads.set("head_31", {
    id: "head_31",
    projectId: project.id,
    experimentId: "experiment_31",
    dataSnapshotId: "snapshot_31",
    recordIndex: 0,
  });
  const thread = await createAnalysisThread({
    store,
    project,
    actorUserId: "user_1",
    originalRequest: "Add normalized temperature to Experiment Browser.",
    outputTarget: "experiment_browser",
  });
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId: "user_1",
    plan: {
      schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
      outputTarget: "experiment_browser",
      status: "awaiting_review",
      requestSummary: "Add normalized temperature for Exp31.",
      sourceSelections: [],
      experimentSelections: [{
        experimentId: "experiment_31",
        columnIds: [columnId],
        includeSeries: false,
        purpose: "Use the accepted temperature value.",
      }],
      fieldTargets: [{
        kind: "derived_field",
        regionUnderstandingRevisionId: "",
        column: "",
        fieldKey: "normalized_temperature",
        displayName: "Normalized temperature",
        role: "condition",
        valueType: "number",
        unit: "degC",
        description: "A normalized copy of the accepted temperature.",
      }],
      reviewPlan: {
        processingSteps: ["Copy the accepted temperature into a new normalized field."],
        missingValueHandling: "Exclude Exp31 if temperature is missing.",
        experimentOutput: { summary: "Add normalized temperature while preserving all existing fields." },
        browserView: { summary: "Show Exp31, Temperature, and Normalized temperature." },
        invariants: [],
      },
      displayPlan: [
        "Use Exp31's accepted Temperature field.",
        "Add Normalized temperature and preserve every existing field.",
      ],
      warnings: [],
    },
  });
  const accepted = await acceptAnalysisPlanRevision({
    store,
    project,
    actorUserId: "user_1",
    planRevisionId: revision.id,
    idempotencyKey: "accept_browser_plan",
  });
  let browserProgramDraftCount = 0;
  const modelProvider = {
    async draftExperimentBrowserProgram(request, options) {
      browserProgramDraftCount += 1;
      assert.equal(request.inputManifest.experiments[0].experimentId, "experiment_31");
      assert.equal(request.inputManifest.targetFields[0].targetFieldId, "target_field_1");
      const input = options.inspectExperimentInput({
        experimentId: "experiment_31",
        fieldOffset: 0,
        fieldLimit: 10,
      });
      assert.equal(input.fields[0].value, 250);
      if (browserProgramDraftCount === 2) {
        assert.equal(request.repairContext.errors.length, 1);
        assert.equal(
          request.repairContext.errors[0].code,
          "experiment_patch_numeric_value_invalid",
        );
        assert.equal(request.repairContext.errors[0].count, 3);
        assert.match(request.repairContext.errors[0].repairGuidance, /value None/i);
        assert.deepEqual(request.repairContext.errors[0].examples, [
          "Exp31 / Normalized temperature",
        ]);
      }
      return {
        ok: true,
        pythonProgram: {
          runtime: ANALYSIS_RUNTIME_VERSION,
          entrypoint: "analyze",
          source: [
            "def analyze(inputs, labrat):",
            "    return {'recordPatches': [], 'browserView': {}, 'exclusions': []}",
          ].join("\n"),
        },
      };
    },
  };
  let browserExecutionCount = 0;
  const browserExecutor = {
    async executeAcceptedRun() {
      browserExecutionCount += 1;
      if (browserExecutionCount === 1) {
        return {
          ok: true,
          adapter: "test_executor",
          runtime: { version: ANALYSIS_RUNTIME_VERSION },
          result: {
            recordPatches: [{
              label: "Exp31",
              upsertFields: [1, 2, 3].map(() => ({
                targetFieldId: "target_field_1",
                value: "-",
                formattedValue: "-",
                confidence: 1,
                warnings: [],
                sources: [{ experimentId: "experiment_31", columnId }],
              })),
              upsertSeries: [],
              removeFields: [],
              removeSeries: [],
              warnings: [],
            }],
            browserView: { name: "Invalid first attempt" },
            exclusions: [],
          },
        };
      }
      return {
        ok: true,
        adapter: "test_executor",
        runtime: { version: ANALYSIS_RUNTIME_VERSION },
        result: {
          recordPatches: [{
            label: "Exp31",
            upsertFields: [{
              targetFieldId: "target_field_1",
              value: 250,
              formattedValue: "250",
              confidence: 1,
              warnings: [],
              sources: [{ experimentId: "experiment_31", columnId }],
            }],
            upsertSeries: [],
            removeFields: [],
            removeSeries: [],
            warnings: [],
          }],
          browserView: { name: "Normalized temperature" },
          exclusions: [],
        },
      };
    },
  };
  const executed = await executeAnalysisRun({
    store,
    project,
    actorUserId: "user_1",
    analysisRunId: accepted.analysisRun.id,
    modelProvider,
    executor: browserExecutor,
  });
  assert.equal(
    executed.analysisRun.status,
    "awaiting_result_review",
    JSON.stringify(executed.analysisRun.validation || executed.analysisRun.payload),
  );
  const preview = await getAnalysisResultPreview({
    store,
    analysisRunId: executed.analysisRun.id,
    offset: 0,
    limit: 100,
  });

  assert.equal(executed.analysisResult.outputTarget, "experiment_browser");
  assert.equal(preview.outputTarget, "experiment_browser");
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.changeSummary.newFieldCount, 1);
  assert.equal(preview.changeSummary.preservedFieldCount, 1);
  assert.equal(preview.identityCandidates[0].suggestedExperimentId, "experiment_31");
  assert.equal(browserProgramDraftCount, 2);
  assert.equal(browserExecutionCount, 2);
});
