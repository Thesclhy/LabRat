import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkbookReviewSessionDraft,
  workbookReviewSessionSummary,
} from "./workbookReviewSessions.js";

test("workbook review session draft exposes transient detected candidates without aggregate understanding state", () => {
  const sourceDocument = {
    id: "source_document_1",
    documentType: "excel_workbook",
    metadata: {
      workbookName: "Master.xlsx",
      sheets: [{ name: "Runs", usedRange: "A1:D3" }],
    },
    summary: { nonEmptyCellCount: 12 },
    warnings: [],
  };
  const draft = buildWorkbookReviewSessionDraft({
    sourceDocument,
    regions: [{
      id: "source_region_1",
      sourceDocumentId: sourceDocument.id,
      sheetName: "Runs",
      range: "A1:D3",
      kind: "experiment table",
      confidence: 0.88,
    }],
  });

  assert.equal(draft.workbookSummary.workbookName, "Master.xlsx");
  assert.equal(draft.candidateRegions.length, 1);
  assert.deepEqual(draft.candidateRegions[0], {
    sourceRegionId: "source_region_1",
    sourceDocumentId: "source_document_1",
    sheetName: "Runs",
    range: "A1:D3",
    selectionMethod: "detected_region",
    description: "",
    semanticType: "experiment_table",
    confidence: 0.88,
    warnings: [],
  });
  assert.equal("currentUnderstanding" in draft, false);
  assert.equal("regions" in draft, false);
});

test("workbook review session summary omits aggregate understanding and embedded regions", () => {
  const summary = workbookReviewSessionSummary({
    id: "session_1",
    labId: "lab_1",
    projectId: "project_1",
    sourceDocumentId: "source_document_1",
    status: "needs_user_review",
    version: 1,
    workbookSummary: { workbookName: "Master.xlsx" },
    messages: [],
    warnings: [],
  });

  assert.equal(summary.id, "session_1");
  assert.equal("currentUnderstanding" in summary, false);
  assert.equal("regions" in summary, false);
});
