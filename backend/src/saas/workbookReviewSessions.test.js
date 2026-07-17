import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWorkbookReviewRevision,
  buildWorkbookReviewSessionDraft,
  buildWorkbookUnderstandingForConfirmation,
} from "./workbookReviewSessions.js";

test("a new workbook review session seeds stable draft regions from detections", () => {
  const draft = buildWorkbookReviewSessionDraft({
    sourceDocument: {
      id: "source_doc_1",
      documentType: "excel_workbook",
      metadata: {
        workbookName: "Master.xlsx",
        sheets: [{ name: "Runs", rowCount: 5, columnCount: 10 }],
      },
      summary: { nonEmptyCellCount: 50 },
      warnings: [],
    },
    regions: [{
      id: "source_region_1",
      sourceDocumentId: "source_doc_1",
      sheetName: "Runs",
      rangeRef: "A1:J5",
      kind: "standard_table",
      label: "Experiment runs",
      confidence: 0.91,
      warnings: [],
    }],
  });

  assert.deepEqual(draft.currentUnderstanding.draftRegions, [{
    draftRegionId: "draft_source_region_1",
    clientRegionId: "draft_source_region_1",
    sourceRegionId: "source_region_1",
    sourceDocumentId: "source_doc_1",
    sheetName: "Runs",
    range: "A1:J5",
    selectionMethod: "detected_region",
    description: "Experiment runs",
    semanticType: "generic_table",
    confidence: 0.91,
    warnings: [],
    status: "draft",
  }]);
  assert.equal(draft.currentUnderstanding.facts, undefined);
});

test("revising one detected red box preserves the other seeded regions", () => {
  const sourceDocument = {
    id: "source_doc_1",
    documentType: "excel_workbook",
    metadata: {
      workbookName: "Master.xlsx",
      sheets: [
        { name: "Runs", rowCount: 5, columnCount: 10 },
        { name: "README", rowCount: 7, columnCount: 2 },
      ],
    },
    summary: { nonEmptyCellCount: 60 },
    warnings: [],
  };
  const draft = buildWorkbookReviewSessionDraft({
    sourceDocument,
    regions: [{
      id: "source_region_runs",
      sourceDocumentId: "source_doc_1",
      sheetName: "Runs",
      rangeRef: "A1:J5",
      kind: "standard_table",
      label: "Experiment runs",
    }, {
      id: "source_region_readme",
      sourceDocumentId: "source_doc_1",
      sheetName: "README",
      rangeRef: "A1:B7",
      kind: "unknown_region",
      label: "Workbook notes",
    }],
  });

  const result = applyWorkbookReviewRevision({
    workbookReviewSession: {
      id: "session_1",
      sourceDocumentId: "source_doc_1",
      version: 1,
      ...draft,
    },
    sourceDocument,
    body: {
      message: "This is the main experiment table.",
      redBoxUpdates: [{
        ...draft.currentUnderstanding.draftRegions[0],
        description: "Main experiment conditions and outcomes",
        semanticType: "experiment_table",
      }],
      revisionMode: "replace_current",
      activeDraftRegionId: "draft_source_region_runs",
    },
    actorUserId: "user_1",
  });

  assert.equal(result.sessionPatch.currentUnderstanding.draftRegions.length, 2);
  assert.deepEqual(
    result.sessionPatch.currentUnderstanding.draftRegions.map((region) => region.draftRegionId),
    ["draft_source_region_runs", "draft_source_region_readme"],
  );
});

test("a client revision id replaces the detected draft for the same source range", () => {
  const sourceDocument = {
    id: "source_doc_1",
    metadata: {
      workbookName: "Master.xlsx",
      sheets: [{ name: "Runs", rowCount: 5, columnCount: 10 }],
    },
    summary: { nonEmptyCellCount: 50 },
    warnings: [],
  };
  const draft = buildWorkbookReviewSessionDraft({
    sourceDocument,
    regions: [{
      id: "source_region_runs",
      sourceDocumentId: "source_doc_1",
      sheetName: "Runs",
      rangeRef: "A1:J5",
      kind: "standard_table",
      label: "Experiment runs",
    }],
  });

  const result = applyWorkbookReviewRevision({
    workbookReviewSession: {
      id: "session_1",
      sourceDocumentId: "source_doc_1",
      version: 1,
      ...draft,
    },
    sourceDocument,
    body: {
      message: "This is the experiment table.",
      redBoxUpdates: [{
        draftRegionId: "client_region_1",
        clientRegionId: "client_region_1",
        sourceDocumentId: "source_doc_1",
        sheetName: "Runs",
        range: "A1:J5",
        description: "This is the experiment table.",
        semanticType: "experiment_table",
      }],
    },
  });

  assert.equal(result.sessionPatch.currentUnderstanding.draftRegions.length, 1);
  assert.equal(result.sessionPatch.currentUnderstanding.draftRegions[0].draftRegionId, "client_region_1");
  assert.equal(result.sessionPatch.currentUnderstanding.draftRegions[0].semanticType, "experiment_table");
});

test("natural-language ignored phrasing excludes a documentation red box", () => {
  const sourceDocument = {
    id: "source_doc_1",
    metadata: {
      workbookName: "Master.xlsx",
      sheets: [{ name: "README", rowCount: 7, columnCount: 2 }],
    },
    summary: { nonEmptyCellCount: 10 },
    warnings: [],
  };
  const draft = buildWorkbookReviewSessionDraft({
    sourceDocument,
    regions: [{
      id: "source_region_readme",
      sourceDocumentId: "source_doc_1",
      sheetName: "README",
      rangeRef: "A1:B7",
      kind: "unknown_region",
      label: "Workbook instructions",
    }],
  });

  const result = applyWorkbookReviewRevision({
    workbookReviewSession: {
      id: "session_1",
      sourceDocumentId: "source_doc_1",
      version: 1,
      ...draft,
    },
    sourceDocument,
    body: {
      message: "This README range is documentation and should be ignored.",
      redBoxUpdates: [{
        ...draft.currentUnderstanding.draftRegions[0],
        description: "This README range is documentation and should be ignored.",
        semanticType: "",
      }],
      revisionMode: "replace_current",
      activeDraftRegionId: "draft_source_region_readme",
    },
    actorUserId: "user_1",
  });

  const region = result.sessionPatch.currentUnderstanding.draftRegions[0];
  assert.equal(region.semanticType, "ignored_region");
  assert.equal(region.status, "ignored");
  assert.deepEqual(result.sessionPatch.currentUnderstanding.validation.blockers, []);
});

test("confirmation requires a validated structured interpretation for every experiment-bearing fact", () => {
  assert.throws(() => buildWorkbookUnderstandingForConfirmation({
    workbookReviewSession: {
      id: "session_1",
      labId: "lab_1",
      projectId: "project_1",
      sourceDocumentId: "source_doc_1",
      status: "needs_user_review",
      version: 1,
      currentUnderstanding: {
        id: "draft_1",
        facts: [{
          factId: "fact_1",
          draftRegionId: "draft_region_1",
          semanticType: "experiment_table",
        }],
      },
    },
    body: { workbookUnderstandingId: "draft_1" },
  }), (error) => error.code === "workbook_interpretation_required" && error.statusCode === 409);
});

test("low-confidence structured interpretation requires an explicit recorded acknowledgement", () => {
  const workbookReviewSession = {
    id: "session_1",
    labId: "lab_1",
    projectId: "project_1",
    sourceDocumentId: "source_doc_1",
    status: "needs_user_review",
    version: 1,
    currentUnderstanding: {
      id: "draft_1",
      validation: { status: "ready", blockers: [] },
      facts: [{
        factId: "fact_1",
        draftRegionId: "draft_region_1",
        semanticType: "experiment_table",
        interpretation: {
          experimentAxis: "rows",
          experimentIdColumn: "A",
          confidence: 0.5,
        },
      }],
    },
  };

  assert.throws(() => buildWorkbookUnderstandingForConfirmation({
    workbookReviewSession,
    body: { workbookUnderstandingId: "draft_1" },
  }), (error) => error.code === "low_confidence_confirmation_required" && error.statusCode === 409);

  const confirmation = buildWorkbookUnderstandingForConfirmation({
    workbookReviewSession,
    body: {
      workbookUnderstandingId: "draft_1",
      decisionSummary: { acceptedByUser: true, acknowledgedLowConfidence: true },
    },
    actorUserId: "user_1",
  });
  assert.equal(confirmation.understandingInput.decisionSummary.acknowledgedLowConfidence, true);
});
