import { describe, expect, it } from "vitest";
import { initialWorkbookDraftRegions, reconcileWorkbookDraftRegions } from "./workbookReviewState.js";

const existingRegions = [{
  draftRegionId: "draft_1",
  clientRegionId: "draft_1",
  sourceDocumentId: "source_doc_1",
  sheetName: "Sheet1",
  range: "A1:B2",
  status: "draft",
}, {
  draftRegionId: "draft_2",
  clientRegionId: "draft_2",
  sourceDocumentId: "source_doc_1",
  sheetName: "Sheet1",
  range: "D1:E2",
  status: "draft",
}];

describe("reconcileWorkbookDraftRegions", () => {
  it("uses the complete draft-region set returned by the updated understanding", () => {
    const result = reconcileWorkbookDraftRegions(existingRegions, {
      changedRegions: [{ ...existingRegions[1], range: "D1:F4" }],
    }, {
      currentUnderstanding: {
        draftRegions: [existingRegions[0], { ...existingRegions[1], range: "D1:F4" }],
      },
    });

    expect(result).toHaveLength(2);
    expect(result.map((region) => region.range)).toEqual(["A1:B2", "D1:F4"]);
  });

  it("merges changed regions into local drafts when the session omits the full set", () => {
    const result = reconcileWorkbookDraftRegions(existingRegions, {
      changedRegions: [{ ...existingRegions[1], range: "D1:F4" }],
    });

    expect(result).toHaveLength(2);
    expect(result.map((region) => region.range)).toEqual(["A1:B2", "D1:F4"]);
  });

  it("preserves local drafts for a language-only revision", () => {
    expect(reconcileWorkbookDraftRegions(existingRegions, { changedRegions: [] })).toEqual(existingRegions);
  });

  it("removes a region only when the server explicitly marks it removed", () => {
    const result = reconcileWorkbookDraftRegions(existingRegions, {
      changedRegions: [{ ...existingRegions[0], status: "removed" }],
    });

    expect(result).toEqual([existingRegions[1]]);
  });
});

describe("initialWorkbookDraftRegions", () => {
  it("turns detected source regions into selectable draft red boxes", () => {
    const result = initialWorkbookDraftRegions({
      sourceDocument: { id: "source_doc_1" },
      regions: [{
        id: "source_region_1",
        sheetName: "Runs",
        rangeRef: "A1:J5",
        kind: "standard_table",
        label: "Experiment runs",
        confidence: 0.91,
      }, {
        id: "source_region_2",
        sheet_name: "README",
        range_ref: "A1:B4",
        kind: "notes",
      }],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      clientRegionId: "draft_source_doc_1_Runs_A1_J5",
      draftRegionId: "draft_source_doc_1_Runs_A1_J5",
      sourceDocumentId: "source_doc_1",
      sheetName: "Runs",
      range: "A1:J5",
      semanticType: "standard_table",
      description: "Experiment runs",
      selectionMethod: "detected_region",
      status: "draft",
    });
  });

  it("prefers the current understanding draft regions over detected suggestions", () => {
    expect(initialWorkbookDraftRegions({
      regions: [{ sourceDocumentId: "source_doc_1", sheetName: "Runs", range: "A1:J5" }],
    }, {
      currentUnderstanding: { draftRegions: existingRegions },
    })).toEqual(existingRegions);
  });
});
