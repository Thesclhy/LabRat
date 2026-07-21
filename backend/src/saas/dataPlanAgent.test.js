import test from "node:test";
import assert from "node:assert/strict";
import { createDataPlanAgentTools } from "./dataPlanAgentTools.js";
import { executeDataSnapshotPreview } from "./dataPlanExecutor.js";
import { runDataPlanAgent, runExperimentRecordDataPlan } from "./dataPlanAgent.js";

const evidenceResults = [
  {
    resultId: "evidence_result_fact_exp33_rate",
    evidenceStatus: "accepted",
    canUseForDataPlan: true,
    sourceDocumentId: "source_doc_exp33",
    sheetName: "Exp33",
    range: "A1:C4",
    semanticType: "reaction_rate_time_series",
    regionId: "workbook_review_region_1",
    regionUnderstandingRevisionId: "region_understanding_revision_1",
    sourceContentHash: "sha256_region_source_1",
  },
];

const preview = {
  sheetName: "Exp33",
  range: "A1:C4",
  rows: [
    { rowNumber: 1, cells: [{ address: "A1", value: "Time" }, { address: "B1", value: "Rate" }, { address: "C1", value: "Temp" }] },
    { rowNumber: 2, cells: [{ address: "A2", value: 0 }, { address: "B2", value: 0.1 }, { address: "C2", value: 80 }] },
    { rowNumber: 3, cells: [{ address: "A3", value: 5 }, { address: "B3", value: 0.2 }, { address: "C3", value: 80 }] },
  ],
};

test("inspect_region_schema summarizes headers and numeric columns", async () => {
  const tools = createDataPlanAgentTools({
    evidenceResults,
    readRangePreview: async () => preview,
  });

  const response = await tools.inspect_region_schema({
    evidenceResultId: "evidence_result_fact_exp33_rate",
  });

  assert.equal(response.schema.evidenceResultId, "evidence_result_fact_exp33_rate");
  assert.deepEqual(response.schema.headers.map((header) => header.text), ["Time", "Rate", "Temp"]);
  assert.deepEqual(response.schema.numericColumns.map((column) => column.column), ["A", "B", "C"]);
});

test("rank_candidate_columns finds time and reaction-rate bindings", async () => {
  const tools = createDataPlanAgentTools({
    evidenceResults,
    readRangePreview: async () => preview,
  });

  const schema = (await tools.inspect_region_schema({ evidenceResultId: "evidence_result_fact_exp33_rate" })).schema;
  const time = await tools.rank_candidate_columns({ schema, targetField: "reaction_time" });
  const rate = await tools.rank_candidate_columns({ schema, targetField: "reaction_rate" });

  assert.equal(time.candidates[0].column, "A");
  assert.equal(rate.candidates[0].column, "B");
});

test("draft_data_plan and validate_data_plan produce reviewable xy_series plan", async () => {
  const tools = createDataPlanAgentTools({
    evidenceResults,
    readRangePreview: async () => preview,
  });
  const schema = (await tools.inspect_region_schema({ evidenceResultId: "evidence_result_fact_exp33_rate" })).schema;
  const draft = await tools.draft_data_plan({
    query: "draw reaction rate vs time for experiment 33",
    schema,
    bindings: {
      x: { column: "A", headerCell: "A1", headerText: "Time", semanticField: "reaction_time" },
      y: { column: "B", headerCell: "B1", headerText: "Rate", semanticField: "reaction_rate" },
    },
    outputShape: "xy_series",
    experimentAlias: "Exp33",
  });

  assert.equal(draft.dataPlan.outputShape, "xy_series");
  assert.equal(draft.dataPlan.operations.some((op) => op.op === "emit_xy_series"), true);

  const validation = await tools.validate_data_plan({ dataPlan: draft.dataPlan });
  assert.equal(validation.status, "valid");
});

test("executeDataSnapshotPreview extracts xy points with source refs", async () => {
  const dataPlan = {
    schemaVersion: "labrat.dataPlan.v1",
    id: "data_plan_draft_1",
    status: "draft",
    task: "chart_data",
    outputShape: "xy_series",
    sourceEvidence: [{
      sourceDocumentId: "source_doc_exp33",
      sheetName: "Exp33",
      range: "A1:C4",
      evidenceStatus: "accepted",
      canUseForDataPlan: true,
    }],
    operations: [
      { op: "read_table_region", sourceDocumentId: "source_doc_exp33", sheetName: "Exp33", range: "A1:C4" },
      { op: "use_row_as_header", rowNumber: 1 },
      { op: "bind_columns", bindings: { x: { column: "A", semanticField: "reaction_time" }, y: { column: "B", semanticField: "reaction_rate" } } },
      { op: "select_data_rows", startRow: 2, endRow: 3 },
      { op: "emit_xy_series", seriesId: "series_exp33", experimentAlias: "Exp33", x: "reaction_time", y: "reaction_rate" },
    ],
  };

  const snapshot = await executeDataSnapshotPreview({
    dataPlan,
    readRangePreview: async () => preview,
  });

  assert.equal(snapshot.schemaVersion, "labrat.dataSnapshot.v1");
  assert.equal(snapshot.outputShape, "xy_series");
  assert.deepEqual(snapshot.series[0].x, [0, 5]);
  assert.deepEqual(snapshot.series[0].y, [0.1, 0.2]);
  assert.equal(snapshot.series[0].points[0].sourceRefs[0].cell, "A2");
  assert.equal(snapshot.series[0].points[0].sourceRefs[1].cell, "B2");
});

test("runDataPlanAgent creates DataPlan draft and DataSnapshot preview from accepted evidence", async () => {
  const response = await runDataPlanAgent({
    query: "draw reaction rate vs time for experiment 33",
    retrievalResults: evidenceResults,
    readRangePreview: async () => preview,
  });

  assert.equal(response.resultKind, "data_plan_review");
  assert.equal(response.dataPlanDraft.outputShape, "xy_series");
  assert.equal(response.dataSnapshotPreview.series[0].experimentAlias, "Exp33");
  assert.equal(response.dataSnapshotPreview.series[0].x.length, 2);
  assert.equal(response.toolTrace.some((step) => step.tool === "validate_data_plan"), true);
});

test("runDataPlanAgent rejects unconfirmed retrieval suggestions", async () => {
  const response = await runDataPlanAgent({
    query: "draw reaction rate vs time for experiment 33",
    retrievalResults: [{
      resultId: "suggestion_1",
      evidenceStatus: "suggested_unconfirmed",
      canUseForDataPlan: false,
      sourceDocumentId: "source_doc_exp33",
      sheetName: "Exp33",
      range: "A1:C4",
    }],
    readRangePreview: async () => preview,
  });

  assert.equal(response.resultKind, "clarification");
  assert.equal(response.clarification.code, "accepted_evidence_required");
});

function acceptedRegionUnderstanding({ revisionId, regionId, sourceDocumentId, axis, label = null, idColumn = null, range = "A1:C3" }) {
  return {
    region: {
      id: regionId,
      projectId: "project_1",
      sourceDocumentId,
      sheetName: axis === "rows" ? "Runs" : "Exp33",
      rangeRef: range,
      disposition: "active",
      reviewStatus: "accepted",
      currentRevisionId: revisionId,
      acceptedRevisionId: revisionId,
    },
    revision: {
      id: revisionId,
      regionId,
      projectId: "project_1",
      sourceDocumentId,
      sourceContentHash: `source_hash_${revisionId}`,
      dependencyHash: `dependency_hash_${revisionId}`,
      validation: { status: "ready", blockers: [] },
      createdAt: "2026-07-16T09:00:00.000Z",
      interpretation: {
        semanticType: axis === "rows" ? "experiment_table" : "reaction_rate_time_series",
        experimentAxis: axis,
        headerRow: 1,
        experimentIdColumn: idColumn,
        experimentLabel: label,
        fields: axis === "rows"
          ? [
            { column: "B", headerCell: "B1", semanticKey: "reaction_temperature", displayName: "Temperature", role: "condition", valueType: "number", unit: "degC", confidence: 0.9 },
            { column: "C", headerCell: "C1", semanticKey: "yield", displayName: "Yield", role: "outcome", valueType: "number", unit: "percent", confidence: 0.9 },
          ]
          : [
            { column: "A", headerCell: "A1", semanticKey: "reaction_time", displayName: "Time", role: "condition", valueType: "number", unit: "min", confidence: 0.9 },
            { column: "B", headerCell: "B1", semanticKey: "reaction_rate", displayName: "Rate", role: "outcome", valueType: "number", unit: "mol_g_h", confidence: 0.9 },
            { column: "C", headerCell: "C1", semanticKey: "reaction_temperature", displayName: "Temperature", role: "condition", valueType: "number", unit: "degC", confidence: 0.9 },
          ],
        series: axis === "region" ? [{
          seriesKey: "reaction_rate_over_time",
          label: "Reaction rate over time",
          xColumn: "A",
          yColumn: "B",
          xSemanticKey: "reaction_time",
          ySemanticKey: "reaction_rate",
          xUnit: "min",
          yUnit: "mol_g_h",
        }] : [],
        inclusion: { startRow: 2, endRow: 3, skippedRows: [] },
        confidence: 0.9,
        excluded: false,
      },
    },
  };
}

const experimentSourceDocuments = [
  { id: "source_doc_rows", projectId: "project_1", fileObjectId: "file_rows", importRunId: "import_rows", indexVersion: "labrat.sourceIndex.v1", updatedAt: "2026-07-16T10:00:00.000Z" },
  { id: "source_doc_region", projectId: "project_1", fileObjectId: "file_region", importRunId: "import_region", indexVersion: "labrat.sourceIndex.v1", updatedAt: "2026-07-16T11:00:00.000Z" },
];

const experimentRangeRows = {
  source_doc_rows: {
    sheetName: "Runs",
    range: "A1:C3",
    rows: [
      [{ address: "A1", row: 0, col: 0, rawValue: "Experiment" }, { address: "B1", row: 0, col: 1, rawValue: "Temperature" }, { address: "C1", row: 0, col: 2, rawValue: "Yield" }],
      [{ address: "A2", row: 1, col: 0, rawValue: "Exp1" }, { address: "B2", row: 1, col: 1, rawValue: 250 }, { address: "C2", row: 1, col: 2, rawValue: 31.2 }],
      [{ address: "A3", row: 2, col: 0, rawValue: "Exp2" }, { address: "B3", row: 2, col: 1, rawValue: 275 }, { address: "C3", row: 2, col: 2, rawValue: 28.4 }],
    ],
  },
  source_doc_region: {
    sheetName: "Exp33",
    range: "A1:C3",
    rows: [
      [{ address: "A1", row: 0, col: 0, rawValue: "Time" }, { address: "B1", row: 0, col: 1, rawValue: "Rate" }, { address: "C1", row: 0, col: 2, rawValue: "Temperature" }],
      [{ address: "A2", row: 1, col: 0, rawValue: 0 }, { address: "B2", row: 1, col: 1, rawValue: 0.1 }, { address: "C2", row: 1, col: 2, rawValue: 80 }],
      [{ address: "A3", row: 2, col: 0, rawValue: 5 }, { address: "B3", row: 2, col: 1, rawValue: 0.2 }, { address: "C3", row: 2, col: 2, rawValue: 80 }],
    ],
  },
};

test("runExperimentRecordDataPlan compiles accepted row and region interpretations into a stable transient preview", async () => {
  const acceptedRegionUnderstandings = [
    acceptedRegionUnderstanding({ revisionId: "revision_rows", regionId: "region_rows", sourceDocumentId: "source_doc_rows", axis: "rows", idColumn: "A" }),
    acceptedRegionUnderstanding({ revisionId: "revision_region", regionId: "region_region", sourceDocumentId: "source_doc_region", axis: "region", label: "Exp33" }),
  ];
  const request = {
    acceptedRegionUnderstandings,
    sourceDocuments: experimentSourceDocuments,
    sourceIndexBlobsByDocumentId: {
      source_doc_rows: [{ checksumSha256: "rows_checksum" }],
      source_doc_region: [{ checksumSha256: "region_checksum" }],
    },
    identityDecisions: [
      { sourceAlias: "Exp1", action: "create" },
      { sourceAlias: "Exp2", action: "create" },
      { sourceAlias: "Exp33", action: "create" },
    ],
    readRangePreview: async ({ sourceDocumentId }) => experimentRangeRows[sourceDocumentId],
  };

  const first = await runExperimentRecordDataPlan(request);
  const second = await runExperimentRecordDataPlan(request);
  const reorderedDecisions = await runExperimentRecordDataPlan({
    ...request,
    identityDecisions: [...request.identityDecisions].reverse(),
  });
  const reorderedUnderstandings = await runExperimentRecordDataPlan({
    ...request,
    acceptedRegionUnderstandings: [...request.acceptedRegionUnderstandings].reverse(),
  });

  assert.equal(first.resultKind, "data_plan_review");
  assert.equal(first.dataPlan.schemaVersion, "labrat.dataPlan.v2");
  assert.equal(first.dataPlan.outputShape, "experiment_records");
  assert.equal(first.dataPlan.operations.some((item) => item.op === "emit_experiment_records"), true);
  assert.equal(JSON.stringify(first.dataPlan).includes("experimentRecords"), false);
  assert.deepEqual(first.snapshotPreview.experimentRecords.map((record) => record.label), ["Exp33", "Exp1", "Exp2"]);
  assert.equal(first.snapshotPreview.experimentRecords[0].series[0].points.length, 2);
  assert.equal(first.identityCandidates.every((candidate) => candidate.decision?.action === "create"), true);
  assert.deepEqual(first.reviewSummary.blockers, []);
  assert.equal(first.reviewSummary.includedRowCount, 4);
  assert.equal(first.dataPlan.id, second.dataPlan.id);
  assert.equal(first.snapshotPreview.previewHash, second.snapshotPreview.previewHash);
  assert.equal(first.snapshotPreview.dependencyHash, second.snapshotPreview.dependencyHash);
  assert.equal(first.dataPlan.id, reorderedDecisions.dataPlan.id);
  assert.equal(first.snapshotPreview.previewHash, reorderedDecisions.snapshotPreview.previewHash);
  assert.equal(first.dataPlan.id, reorderedUnderstandings.dataPlan.id);
  assert.equal(first.snapshotPreview.previewHash, reorderedUnderstandings.snapshotPreview.previewHash);
  assert.deepEqual(first.snapshotPreview.experimentRecords.map((record) => record.label), reorderedUnderstandings.snapshotPreview.experimentRecords.map((record) => record.label));
});

test("runExperimentRecordDataPlan returns explicit identity blockers without choosing create or reuse", async () => {
  const response = await runExperimentRecordDataPlan({
    acceptedRegionUnderstandings: [acceptedRegionUnderstanding({ revisionId: "revision_rows", regionId: "region_rows", sourceDocumentId: "source_doc_rows", axis: "rows", idColumn: "A" })],
    sourceDocuments: experimentSourceDocuments,
    sourceIndexBlobsByDocumentId: { source_doc_rows: [{ checksumSha256: "rows_checksum" }] },
    identityDecisions: [],
    readRangePreview: async ({ sourceDocumentId }) => experimentRangeRows[sourceDocumentId],
  });

  assert.equal(response.resultKind, "data_plan_review");
  assert.deepEqual(response.identityCandidates.map((candidate) => candidate.sourceAlias), ["Exp1", "Exp2"]);
  assert.equal(response.identityCandidates.every((candidate) => candidate.decision === null), true);
  assert.deepEqual(response.reviewSummary.blockers.map((item) => item.code), [
    "identity_decision_required",
    "identity_decision_required",
  ]);
});

test("runExperimentRecordDataPlan exposes canonical labels for reusable experiment identities", async () => {
  const response = await runExperimentRecordDataPlan({
    acceptedRegionUnderstandings: [acceptedRegionUnderstanding({ revisionId: "revision_rows", regionId: "region_rows", sourceDocumentId: "source_doc_rows", axis: "rows", idColumn: "A" })],
    sourceDocuments: experimentSourceDocuments,
    sourceIndexBlobsByDocumentId: { source_doc_rows: [{ checksumSha256: "rows_checksum" }] },
    existingExperimentIdentities: [{
      id: "experiment_identity_1",
      canonicalLabel: "Experiment One",
      aliases: ["Exp1"],
    }],
    identityDecisions: [],
    readRangePreview: async ({ sourceDocumentId }) => experimentRangeRows[sourceDocumentId],
  });

  assert.deepEqual(response.identityCandidates[0].matches, [{
    id: "experiment_identity_1",
    label: "Experiment One",
  }]);
});

test("runExperimentRecordDataPlan rejects missing or structurally incomplete accepted understanding", async () => {
  const unaccepted = await runExperimentRecordDataPlan({
    acceptedRegionUnderstandings: [{
      ...acceptedRegionUnderstanding({ revisionId: "revision_rows", regionId: "region_rows", sourceDocumentId: "source_doc_rows", axis: "rows", idColumn: "A" }),
      region: {
        ...acceptedRegionUnderstanding({ revisionId: "revision_rows", regionId: "region_rows", sourceDocumentId: "source_doc_rows", axis: "rows", idColumn: "A" }).region,
        acceptedRevisionId: null,
        reviewStatus: "awaiting_review",
      },
    }],
    sourceDocuments: experimentSourceDocuments,
    readRangePreview: async ({ sourceDocumentId }) => experimentRangeRows[sourceDocumentId],
  });
  assert.equal(unaccepted.resultKind, "clarification");
  assert.equal(unaccepted.clarification.code, "accepted_region_understanding_required");

  const incompleteUnderstanding = acceptedRegionUnderstanding({ revisionId: "revision_rows", regionId: "region_rows", sourceDocumentId: "source_doc_rows", axis: "rows", idColumn: null });
  const incomplete = await runExperimentRecordDataPlan({
    acceptedRegionUnderstandings: [incompleteUnderstanding],
    sourceDocuments: experimentSourceDocuments,
    readRangePreview: async ({ sourceDocumentId }) => experimentRangeRows[sourceDocumentId],
  });
  assert.equal(incomplete.resultKind, "clarification");
  assert.equal(incomplete.clarification.code, "region_understanding_incomplete");
});

test("runExperimentRecordDataPlan blocks blank and normalized-duplicate source aliases", async () => {
  const understanding = acceptedRegionUnderstanding({ revisionId: "revision_rows", regionId: "region_rows", sourceDocumentId: "source_doc_rows", axis: "rows", idColumn: "A" });
  const duplicateRows = structuredClone(experimentRangeRows.source_doc_rows);
  duplicateRows.rows[0][0].rawValue = "Experiment";
  duplicateRows.rows[1][0].rawValue = "Exp1";
  duplicateRows.rows[2][0].rawValue = "EXP-1";
  const duplicate = await runExperimentRecordDataPlan({
    acceptedRegionUnderstandings: [understanding],
    sourceDocuments: experimentSourceDocuments,
    sourceIndexBlobsByDocumentId: { source_doc_rows: [{ checksumSha256: "rows_checksum" }] },
    identityDecisions: [{ sourceAlias: "Exp1", action: "create" }],
    readRangePreview: async () => duplicateRows,
  });
  assert.equal(duplicate.identityCandidates[0].occurrenceCount, 2);
  assert.equal(duplicate.reviewSummary.blockers.some((item) => item.code === "duplicate_alias_requires_unique_source_identity"), true);

  const blankRows = structuredClone(experimentRangeRows.source_doc_rows);
  blankRows.rows[1][0].rawValue = null;
  const blank = await runExperimentRecordDataPlan({
    acceptedRegionUnderstandings: [understanding],
    sourceDocuments: experimentSourceDocuments,
    sourceIndexBlobsByDocumentId: { source_doc_rows: [{ checksumSha256: "rows_checksum" }] },
    identityDecisions: [{ sourceAlias: "Exp2", action: "create" }],
    readRangePreview: async () => blankRows,
  });
  assert.equal(blank.snapshotPreview.experimentRecords[0].label, "");
  assert.equal(blank.reviewSummary.blockers.some((item) => item.code === "experiment_alias_required"), true);
});
