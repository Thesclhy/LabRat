import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";
import {
  createWorkbookReviewRegionDraft,
} from "./workbookReviewRegions.js";

function cell(address, rawValue, extra = {}) {
  const type = extra.formula ? "formula" : typeof rawValue === "number" ? "number" : "string";
  return { address, rawValue, formattedValue: rawValue == null ? null : String(rawValue), type, formula: null, ...extra };
}

// Compact LDPE calculation sheet: gas yields (row 14) feed the terminal
// "Overall tots" row (row 32); row 14 itself is intermediate.
function calculationFixture() {
  const cells = [
    cell("A11", 22.0341), cell("A12", "Total C atoms"), cell("B12", 1.5711, { formula: "A11/28.05*2" }),
    cell("F6", 0.0082), cell("G6", 0.0022), cell("H6", 0.0011),
    cell("E13", ""), cell("F13", "C1"), cell("G13", "C2"), cell("H13", "C3"),
    cell("E14", "Yield"),
    cell("F14", 0.5237, { formula: "F6/B12*100" }), cell("G14", 0.1374, { formula: "G6/B12*100" }), cell("H14", 0.07, { formula: "H6/B12*100" }),
    cell("P31", "Overall tots"), cell("Q31", "C1"), cell("R31", "C2"), cell("S31", "C3"),
    cell("Q32", 0.5237, { formula: "F14" }), cell("R32", 0.1374, { formula: "G14" }), cell("S32", 0.07, { formula: "H14" }),
  ];
  return {
    session: {
      id: "workbook_review_session_1",
      labId: "lab_1",
      projectId: "project_1",
      sourceDocumentId: "source_document_1",
      workbookSummary: { workbookName: "Calculation Exp31.xlsx" },
      version: 1,
    },
    sourceDocument: {
      id: "source_document_1",
      fileObjectId: "file_1",
      importRunId: "import_run_1",
      metadata: {
        workbookName: "Calculation Exp31.xlsx",
        sheets: [{ name: "Sheet1", usedRange: "A1:S32", rowCount: 32, columnCount: 19 }],
      },
    },
    indexBlobs: [{ payload: { sheets: [{ name: "Sheet1", rowCount: 32, columnCount: 19, cellGrid: { range: "A1:S32", rowCount: 32, columnCount: 19, cells } }] } }],
  };
}

function seriesModelProvider(seriesPatches, { headerRow = 31 } = {}) {
  return {
    calls: [],
    async interpretWorkbookRegion(input) {
      this.calls.push(input);
      return {
        ok: true,
        summary: [
          "This row holds the overall carbon distribution for Exp31.",
          "Each value is a percentage of the feed carbon.",
        ],
        interpretation: {
          semanticType: "component_distribution",
          experimentAxis: "region",
          ...(headerRow ? { headerRow } : {}),
          experimentLabel: "Exp31",
          confidence: 0.9,
          ...(seriesPatches ? { seriesPatches } : {}),
        },
        metadata: { provider: "anthropic", model: "test-model" },
      };
    },
  };
}

test("interpretation receives cell classes and provenance, and stores a header-row series with provenance", async () => {
  const store = new MemorySaasStore();
  const fixture = calculationFixture();
  const modelProvider = seriesModelProvider([{
    seriesKey: "carbon_distribution",
    label: "Overall carbon distribution",
    orientation: "header_row_categories",
    xHeaderRange: "Q31:S31",
    yValueRange: "Q32:S32",
    xMeaning: "carbon_number",
    xValueType: "number",
    yUnit: "% of feed carbon",
    yNumericScale: "percent_points",
  }]);

  const { region, revision } = await createWorkbookReviewRegionDraft({
    store,
    session: fixture.session,
    sourceDocument: fixture.sourceDocument,
    indexBlobs: fixture.indexBlobs,
    modelProvider,
    actorUserId: "user_1",
    input: { sourceDocumentId: "source_document_1", sheetName: "Sheet1", range: "P31:S32", semanticType: "component_distribution" },
  });

  const modelInput = modelProvider.calls[0];
  assert.equal(modelInput.region.provenance.cellClassSummary.terminal, 3);
  assert.match(modelInput.region.provenance.derivation, /^Q32 = F14 where F14 = 0\.5237 \(Yield\)/);
  const q32 = modelInput.region.inspection.cells.find((item) => item.address === "Q32");
  assert.equal(q32.cellClass, "terminal");
  assert.equal(modelInput.region.inspection.cells.find((item) => item.address === "Q31").cellClass, "constant");

  assert.equal(region.reviewStatus, "awaiting_review");
  assert.deepEqual(region.warnings, []);
  const provenance = revision.interpretation.provenance;
  assert.equal(provenance.schemaVersion, "labrat.regionProvenance.v1");
  assert.deepEqual(provenance.cellClassSummary, { terminal: 3, intermediate: 0, input: 0, constant: 4, blank: 1 });
  assert.deepEqual(provenance.sharedInputs.map((input) => input.address), ["B12"]);
  const series = revision.interpretation.series.find((item) => item.seriesKey === "carbon_distribution");
  assert.deepEqual(series, {
    seriesKey: "carbon_distribution",
    label: "Overall carbon distribution",
    orientation: "header_row_categories",
    xHeaderRange: "Q31:S31",
    yValueRange: "Q32:S32",
    xSemanticKey: "carbon_number",
    ySemanticKey: "carbon_distribution",
    xValueType: "number",
    xUnit: null,
    yUnit: "% of feed carbon",
    yNumericScale: "percent_points",
    pointCount: 3,
    confidence: 0.98,
    sourceRefs: [
      { sourceType: "excel_range", sourceDocumentId: "source_document_1", fileObjectId: "file_1", importRunId: "import_run_1", sheet: "Sheet1", range: "Q31:S31" },
      { sourceType: "excel_range", sourceDocumentId: "source_document_1", fileObjectId: "file_1", importRunId: "import_run_1", sheet: "Sheet1", range: "Q32:S32" },
    ],
  });
  assert.ok(revision.sourceRefs.some((ref) => ref.range === "Q32:S32"), "series ranges become revision source refs");
});

test("selecting an intermediate yield row records a provenance warning on the region and revision", async () => {
  const store = new MemorySaasStore();
  const fixture = calculationFixture();
  const { region, revision } = await createWorkbookReviewRegionDraft({
    store,
    session: fixture.session,
    sourceDocument: fixture.sourceDocument,
    indexBlobs: fixture.indexBlobs,
    modelProvider: seriesModelProvider(null, { headerRow: 13 }),
    actorUserId: "user_1",
    input: { sourceDocumentId: "source_document_1", sheetName: "Sheet1", range: "E13:H14" },
  });
  assert.deepEqual(region.warnings.map((warning) => warning.code), ["region_mostly_intermediate_cells"]);
  assert.deepEqual(revision.warnings.map((warning) => warning.code), ["region_mostly_intermediate_cells"]);
  assert.equal(revision.interpretation.provenance.cellClassSummary.intermediate, 3);
});

test("series patches outside the selected range or with mismatched shapes fail the interpretation", async () => {
  const store = new MemorySaasStore();
  const fixture = calculationFixture();
  const outside = await createWorkbookReviewRegionDraft({
    store,
    session: fixture.session,
    sourceDocument: fixture.sourceDocument,
    indexBlobs: fixture.indexBlobs,
    modelProvider: seriesModelProvider([{ seriesKey: "s", label: "S", orientation: "header_row_categories", xHeaderRange: "Q31:S31", yValueRange: "F14:H14" }]),
    actorUserId: "user_1",
    input: { sourceDocumentId: "source_document_1", sheetName: "Sheet1", range: "P31:S32" },
  });
  assert.equal(outside.region.reviewStatus, "interpretation_failed");
  assert.equal(outside.warning.code, "interpretation_range_outside_region");

  const mismatched = await createWorkbookReviewRegionDraft({
    store,
    session: fixture.session,
    sourceDocument: fixture.sourceDocument,
    indexBlobs: fixture.indexBlobs,
    modelProvider: seriesModelProvider([{ seriesKey: "s", label: "S", orientation: "header_row_categories", xHeaderRange: "Q31:S31", yValueRange: "Q32:R32" }]),
    actorUserId: "user_1",
    input: { sourceDocumentId: "source_document_1", sheetName: "Sheet1", range: "P31:S32" },
  });
  assert.equal(mismatched.region.reviewStatus, "interpretation_failed");
  assert.equal(mismatched.warning.code, "invalid_series_patch");
});
