import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { formulaShape } from "./formulaGraph.js";
import {
  buildRegionExtractionTemplateVersion,
  compileLayoutSignature,
  fuzzyTextMatch,
  matchTemplateVersionToDocument,
  regionExtractionTemplateSummary,
} from "./regionExtractionTemplates.js";

function cell(address, rawValue, extra = {}) {
  const type = extra.formula ? "formula" : typeof rawValue === "number" ? "number" : "string";
  return { address, rawValue, formattedValue: rawValue == null ? null : String(rawValue), type, formula: null, ...extra };
}

// A compact LDPE-style calculation sheet. Row 32 is the terminal "Overall
// tots" row over C1..C5 headers in row 31; row 14 holds intermediate yields.
function calculationCells({ label = "Exp31", headerCount = 5, overallLabel = "Overall tots", rowShift = 0, colShift = 0, typedOverallCells = [], typedUpstreamCells = [] } = {}) {
  const shift = (address) => {
    const decoded = XLSX.utils.decode_cell(address);
    return XLSX.utils.encode_cell({ r: decoded.r + rowShift, c: decoded.c + colShift });
  };
  const shiftFormula = (formula) => formula.replace(/([A-Z]{1,3})(\d+)/g, (match, col, row) => shift(`${col}${row}`));
  const cells = [
    ["A1", "Filename"], ["A2", label], ["A11", 22.03], ["A12", "Total C atoms"], ["B12", 1.57, { formula: "A11/28.05*2" }],
    ["E14", "Yield"], ["P28", "Total C (liq)"], ["P31", overallLabel],
  ].map(([address, value, extra]) => cell(shift(address), value, extra ? { formula: shiftFormula(extra.formula) } : {}));
  const columns = ["Q", "R", "S", "T", "U", "V", "W"];
  const gasColumns = ["F", "G", "H", "I", "J", "K", "L"];
  for (let index = 0; index < headerCount; index += 1) {
    const col = columns[index];
    const gas = gasColumns[index];
    cells.push(cell(shift(`${gas}6`), 0.001 * (index + 1)));
    cells.push(cell(shift(`${gas}14`), 0.1 * (index + 1), { formula: shiftFormula(`${gas}6/B12*100`) }));
    cells.push(cell(shift(`${col}31`), `C${index + 1}`));
    const overall = `${col}32`;
    if (typedOverallCells.includes(overall)) cells.push(cell(shift(overall), 0.1 * (index + 1)));
    else cells.push(cell(shift(overall), 0.1 * (index + 1), { formula: shiftFormula(`${gas}14`) }));
  }
  for (const address of typedUpstreamCells) {
    const position = cells.findIndex((item) => item.address === shift(address));
    if (position >= 0) cells[position] = cell(shift(address), 0.42);
  }
  return cells;
}

function blobs(sheetName, cells, extraSheets = []) {
  return [{ payload: { sheets: [{ name: sheetName, cellGrid: { range: "A1:W40", cells } }, ...extraSheets] } }];
}

function sourceDocument(id, workbookName) {
  return { id, fileObjectId: `file_${id}`, importRunId: `run_${id}`, metadata: { workbookName, sheets: [{ name: "Sheet1" }] } };
}

const templateRegion = {
  id: "region_template",
  sourceDocumentId: "doc_31",
  sheetName: "Sheet1",
  rangeRef: "P31:U32",
  acceptedRevisionId: "revision_template",
};

const templateRevision = {
  id: "revision_template",
  regionId: "region_template",
  interpretation: {
    semanticType: "component_distribution",
    experimentAxis: "region",
    headerRow: 31,
    experimentLabel: "Exp31",
    fields: [],
    series: [{
      seriesKey: "carbon_distribution",
      label: "Overall carbon distribution",
      orientation: "header_row_categories",
      xHeaderRange: "Q31:U31",
      yValueRange: "Q32:U32",
      xSemanticKey: "carbon_number",
      ySemanticKey: "carbon_distribution",
      xValueType: "number",
      yUnit: "% of feed carbon",
      yNumericScale: "percent_points",
    }],
    inclusion: { startRow: 32, endRow: 32 },
    provenance: { schemaVersion: "labrat.regionProvenance.v1", cellClassSummary: { terminal: 5 } },
  },
};

function templateVersion() {
  return {
    id: "template_version_1",
    ...buildRegionExtractionTemplateVersion({
      sourceDocument: sourceDocument("doc_31", "Calculation Exp31.xlsx"),
      indexBlobs: blobs("Sheet1", calculationCells(), [{ name: "LDPE TEMPLATE", cellGrid: { range: "A1:A1", cells: [cell("A1", "Filename")] } }]),
      region: templateRegion,
      revision: templateRevision,
    }),
  };
}

test("formulaShape makes the same calculation identical at any position", () => {
  assert.equal(formulaShape("F14", "Q32"), "R[-18]C[-11]");
  assert.equal(formulaShape("F51", "Q69"), "R[-18]C[-11]");
  assert.equal(formulaShape("=I14+Q29", "T32"), "=R[-18]C[-11]+R[-3]C[-3]");
  assert.equal(formulaShape("=Q29", "Q32"), "=R[-3]C");
  assert.equal(formulaShape("SUM(Q26:CA26)/$B$12*100", "P29"), "SUM(R[-3]C[1]:R[-3]C[63])/R12C2*100");
  assert.equal(formulaShape("'LDPE TEMPLATE'!B2*2", "A1"), "'LDPE TEMPLATE'!R[1]C[1]*2");
});

test("fuzzyTextMatch tolerates the corrupted labels seen in real calculation sheets", () => {
  assert.equal(fuzzyTextMatch("Overall tots", "Overall tots"), 1);
  assert.ok(fuzzyTextMatch("Overall tots", "Overal+P31:AO32l tots") > 0, "contains-style corruption still matches");
  assert.equal(fuzzyTextMatch("Total C (liq)", "Total C atoms"), 0);
  assert.equal(fuzzyTextMatch("Yield", "Yeld"), 0.7, "one-character typos match");
  assert.equal(fuzzyTextMatch("Yield", "Yeild"), 0, "transpositions count as two edits and stay conservative");
});

test("compileLayoutSignature records header runs, relative formula shapes, anchors, label rule, and relative semantics", () => {
  const { signature, semantics } = compileLayoutSignature({
    sourceDocument: sourceDocument("doc_31", "Calculation Exp31.xlsx"),
    indexBlobs: blobs("Sheet1", calculationCells(), [{ name: "LDPE TEMPLATE", cellGrid: { range: "A1:A1", cells: [] } }]),
    region: templateRegion,
    revision: templateRevision,
  });
  assert.equal(signature.sheetName, "Sheet1");
  assert.deepEqual(signature.companionSheetNames, ["LDPE TEMPLATE"]);
  assert.equal(signature.anchorRange, "P31:U32");
  assert.deepEqual(signature.rangeShape, { rows: 2, cols: 6 });
  assert.deepEqual(signature.headerRuns, [{ relRow: 0, relCol: 1, count: 5, prefix: "c", startNumber: 1 }]);
  assert.deepEqual(signature.textAnchors.map((anchor) => anchor.text), ["Overall tots"]);
  assert.deepEqual(signature.borderAnchors.map((anchor) => [anchor.text, anchor.relRow, anchor.relCol]), [["Total C (liq)", -3, 0]]);
  const formulaExpectations = signature.cellExpectations.filter((item) => item.kind === "formula");
  assert.equal(formulaExpectations.length, 5);
  assert.ok(formulaExpectations.every((item) => item.formulaShape === "R[-18]C[-11]"));
  assert.deepEqual(signature.experimentLabelRule, { kind: "cell", address: "A2", exampleLabel: "Exp31", filenamePattern: signature.experimentLabelRule.filenamePattern });
  assert.equal(semantics.semanticType, "component_distribution");
  assert.equal(semantics.headerRowOffset, 0);
  assert.deepEqual(semantics.series[0].xHeader, { relRow: 0, relRowEnd: 0, relCol: 1, relColEnd: 5 });
  assert.deepEqual(semantics.series[0].yValues, { relRow: 1, relRowEnd: 1, relCol: 1, relColEnd: 5 });
  assert.equal("provenance" in semantics, false);
});

test("template versions require a confirmed region and hash their content", () => {
  assert.throws(() => buildRegionExtractionTemplateVersion({
    sourceDocument: sourceDocument("doc_31", "Calculation Exp31.xlsx"),
    indexBlobs: blobs("Sheet1", calculationCells()),
    region: { ...templateRegion, acceptedRevisionId: null },
    revision: templateRevision,
  }), /Confirm the region/);
  const version = templateVersion();
  assert.equal(version.sourceRegionId, "region_template");
  assert.equal(version.sourceRevisionId, "revision_template");
  assert.equal(version.sourceWorkbookName, "Calculation Exp31.xlsx");
  assert.match(version.contentHash, /^[0-9a-f]{64}$/);
  const summary = regionExtractionTemplateSummary({ id: "t", schemaVersion: "s", name: "Carbon distribution", description: "", status: "active", currentVersionId: "v", updatedAt: "now" }, version);
  assert.equal(summary.anchorRange, "P31:U32");
  assert.equal(summary.seriesCount, 1);
});

test("an identical layout in another workbook matches exactly with its own experiment label", () => {
  const report = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_32", "Calculation Exp32.xlsx"),
    indexBlobs: blobs("Sheet1", calculationCells({ label: "Exp32" })),
  });
  assert.equal(report.status, "exact");
  assert.equal(report.matchedRange, "P31:U32");
  assert.deepEqual(report.offset, { rows: 0, cols: 0 });
  assert.equal(report.experimentLabel, "Exp32");
  assert.equal(report.labelSource, "cell");
  assert.equal(report.eligibleForBatchConfirm, true);
  assert.deepEqual(report.formulaMismatches, []);
  assert.deepEqual(report.alternatives, []);
});

test("a corrupted header label still matches exactly through the header run and border anchor", () => {
  const report = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_33", "Calculation Exp33.xlsx"),
    indexBlobs: blobs("Sheet1", calculationCells({ label: "Exp33", overallLabel: "Overal+P31:AO32l tots" })),
  });
  assert.equal(report.status, "exact");
  assert.equal(report.experimentLabel, "Exp33");
});

test("a block moved by inserted rows is reported as shifted with its offset", () => {
  const report = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_34", "Calculation Exp34.xlsx"),
    indexBlobs: blobs("Sheet1", calculationCells({ label: "Exp34", rowShift: 2 })),
  });
  assert.equal(report.status, "shifted");
  assert.equal(report.matchedRange, "P33:U34");
  assert.deepEqual(report.offset, { rows: 2, cols: 0 });
  assert.equal(report.experimentLabel, "Exp34", "the filename supplies the label when the label cell moved");
  assert.equal(report.labelSource, "filename");
  assert.equal(report.eligibleForBatchConfirm, true);
});

test("a shorter header run is a header mismatch", () => {
  const report = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_35", "Calculation Exp35.xlsx"),
    indexBlobs: blobs("Sheet1", calculationCells({ label: "Exp35", headerCount: 4 })),
  });
  assert.equal(report.status, "header_mismatch");
  assert.deepEqual(report.headerRuns, [{ expectedCount: 5, foundCount: 4, ok: false }]);
  assert.equal(report.eligibleForBatchConfirm, false);
});

test("typed numbers where the template expects formulas are a formula mismatch", () => {
  const report = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_36", "Calculation Exp36.xlsx"),
    indexBlobs: blobs("Sheet1", calculationCells({ label: "Exp36", typedOverallCells: ["R32", "S32"] })),
  });
  assert.equal(report.status, "formula_mismatch");
  assert.deepEqual(report.formulaMismatches.map((item) => [item.address, item.found]), [["R32", "typed_number"], ["S32", "typed_number"]]);
});

test("a typed constant upstream of an otherwise matching block is a formula mismatch with broken cells", () => {
  const report = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_37", "Calculation Exp37.xlsx"),
    indexBlobs: blobs("Sheet1", calculationCells({ label: "Exp37", typedUpstreamCells: ["G14", "H14"] })),
  });
  assert.equal(report.status, "formula_mismatch");
  assert.deepEqual(report.formulaMismatches, []);
  assert.deepEqual(report.brokenCells.map((item) => item.address).sort(), ["G14", "H14"]);
});

test("a matching block without any experiment label is label_missing", () => {
  const report = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_38", "sweep run.xlsx"),
    indexBlobs: blobs("Sheet1", calculationCells({ label: "" }).filter((item) => item.address !== "A2")),
  });
  assert.equal(report.status, "label_missing");
  assert.equal(report.matchedRange, "P31:U32");
  assert.equal(report.experimentLabel, null);
});

test("two structurally identical blocks report exact for the original position with the other as an alternative", () => {
  const first = calculationCells({ label: "Exp39" });
  const second = calculationCells({ label: "Exp39", rowShift: 37 }).filter((item) => !["A38", "A39"].includes(item.address));
  const report = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_39", "Calculation Exp39.xlsx"),
    indexBlobs: blobs("Sheet1", [...first, ...second]),
  });
  assert.equal(report.status, "exact");
  assert.equal(report.matchedRange, "P31:U32");
  assert.deepEqual(report.alternatives.map((item) => item.matchedRange), ["P68:U69"]);
});

test("only shifted candidates in two places is ambiguous", () => {
  const first = calculationCells({ label: "Exp40", rowShift: 2 });
  const second = calculationCells({ label: "Exp40", rowShift: 40 }).filter((item) => !["A41", "A42"].includes(item.address));
  const report = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_40", "Calculation Exp40.xlsx"),
    indexBlobs: blobs("Sheet1", [...first, ...second]),
  });
  assert.equal(report.status, "ambiguous");
  assert.deepEqual(report.alternatives.map((item) => item.matchedRange).sort(), ["P33:U34", "P71:U72"]);
  assert.equal(report.eligibleForBatchConfirm, false);
});

test("a layout on a differently named sheet is still found, and an unrelated workbook is no_match", () => {
  const renamed = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_41", "Calculation Exp41.xlsx"),
    indexBlobs: blobs("Results", calculationCells({ label: "Exp41" })),
  });
  assert.equal(renamed.status, "exact");
  assert.equal(renamed.sheetName, "Results");

  const unrelated = matchTemplateVersionToDocument({
    templateVersion: templateVersion(),
    sourceDocument: sourceDocument("doc_42", "MasterTable.xlsx"),
    indexBlobs: blobs("Sheet1", [cell("A1", "Experiment"), cell("B1", "Temperature"), cell("A2", "Exp1"), cell("B2", 250)]),
  });
  assert.equal(unrelated.status, "no_match");
  assert.equal(unrelated.matchedRange, null);
});
