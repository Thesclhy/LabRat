import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFormulaGraph,
  classifyGraphCell,
  parseFormulaReferences,
  regionProvenance,
  sourceCellClasses,
} from "./formulaGraph.js";

function cell(address, rawValue, extra = {}) {
  const type = extra.formula ? "formula" : typeof rawValue === "number" ? "number" : "string";
  return { address, rawValue, formattedValue: rawValue == null ? null : String(rawValue), type, formula: null, ...extra };
}

// A compact version of the LDPE calculation sheet: inputs, an intermediate
// yield row, a terminal "Overall tots" row, and a second block where two gas
// values were typed over their formulas.
function calculationBlobs() {
  const cells = [
    cell("A11", 22.0341), cell("A10", "Reagent"),
    cell("A12", "Total C atoms"), cell("B12", 1.5711, { formula: "A11/28.05*2" }),
    cell("E14", "Yield"),
    cell("F6", 0.0082, { formula: "D3*298*F4" }), cell("G6", 0.0022, { formula: "D3*298*G4" }), cell("H6", 0.0011, { formula: "D3*298*H4" }),
    cell("F13", "C1"), cell("G13", "C2"), cell("H13", "C3"),
    cell("F14", 0.5237, { formula: "F6/B12*100" }), cell("G14", 0.1374, { formula: "G6/B12*100" }), cell("H14", 0.07, { formula: "H6/B12*100" }),
    cell("P31", "Overal+P31:AO32l tots"), cell("Q31", "C1"), cell("R31", "C2"), cell("S31", "C3"),
    cell("Q32", 0.5237, { formula: "F14" }), cell("R32", 0.1374, { formula: "G14" }), cell("S32", 0.07, { formula: "H14" }),
    cell("D3", 1), cell("F4", 2), cell("G4", 3), cell("H4", 4),
    // second block: F43 and G43 typed constants, H43 still a formula
    cell("F43", 0.1406), cell("G43", 0.0471), cell("H43", 0.0393, { formula: "D40*298*H41" }),
    cell("F51", 8.95, { formula: "F43/B49*100" }), cell("G51", 3.0, { formula: "G43/B49*100" }), cell("H51", 2.5, { formula: "H43/B49*100" }),
    cell("Q69", 8.95, { formula: "F51" }), cell("R69", 3.0, { formula: "G51" }), cell("S69", 2.5, { formula: "H51" }),
    cell("B49", 1.571, { formula: "A48/28.05*2" }), cell("A48", 22.03), cell("D40", 1), cell("H41", 4),
  ];
  return [{
    payload: {
      sheets: [
        { name: "Sheet1", cellGrid: { range: "A1:S69", cells } },
        { name: "LDPE TEMPLATE", cellGrid: { range: "A1:B2", cells: [cell("A1", "Filename"), cell("B2", 7, { formula: "Sheet1!F14*1" })] } },
      ],
    },
  }];
}

test("parseFormulaReferences reads cells, ranges, absolute refs, and sheet prefixes without matching function names", () => {
  const refs = parseFormulaReferences("=SUM(Q26:S26)+$B$12*LOG10(F6)+'LDPE TEMPLATE'!B2+Other!C3", "Sheet1");
  assert.deepEqual(refs.map((ref) => `${ref.sheetName}!${ref.address}`), [
    "Sheet1!Q26", "Sheet1!R26", "Sheet1!S26", "Sheet1!B12", "Sheet1!F6", "LDPE TEMPLATE!B2", "Other!C3",
  ]);
  assert.deepEqual(parseFormulaReferences("=\"A1\"&B2", "S"), [{ sheetName: "S", address: "B2" }]);
});

test("cells are classified as input, constant, intermediate, or terminal from the formula graph", () => {
  const graph = buildFormulaGraph(calculationBlobs());
  assert.equal(classifyGraphCell(graph, "sheet1!A11"), "input");
  assert.equal(classifyGraphCell(graph, "sheet1!A12"), "constant");
  assert.equal(classifyGraphCell(graph, "sheet1!B12"), "intermediate");
  assert.equal(classifyGraphCell(graph, "sheet1!F14"), "intermediate");
  assert.equal(classifyGraphCell(graph, "sheet1!Q32"), "terminal");
  assert.equal(classifyGraphCell(graph, "sheet1!Z99"), "blank");
  assert.equal(graph.dependents.get("sheet1!f14")?.size, undefined);
  assert.equal(graph.dependents.get("sheet1!F14").size, 2, "F14 feeds Q32 and the template sheet");
});

test("regionProvenance describes a terminal result row with shared inputs and no warnings", () => {
  const provenance = regionProvenance({ indexBlobs: calculationBlobs(), sheetName: "Sheet1", range: "P31:S32" });
  assert.equal(provenance.cellClassSummary.terminal, 3);
  assert.equal(provenance.cellClassSummary.constant, 4);
  assert.equal(provenance.numericCellCount, 3);
  assert.deepEqual(provenance.warnings, []);
  assert.match(provenance.derivation, /^Q32 = F14 where F14 = 0\.5237 \(Yield\)/);
  assert.match(provenance.derivation, /depends on B12 \(Total C atoms = 1\.5711\)/);
  assert.deepEqual(provenance.sharedInputs.map((input) => input.address), ["B12", "D3"], "nearest shared cells first, A11 dropped because it only feeds B12");
  assert.deepEqual(provenance.brokenCells, []);
});

test("regionProvenance warns when a selected region is mostly intermediate cells", () => {
  const provenance = regionProvenance({ indexBlobs: calculationBlobs(), sheetName: "Sheet1", range: "E13:H14" });
  assert.equal(provenance.cellClassSummary.intermediate, 3);
  assert.deepEqual(provenance.warnings.map((warning) => warning.code), ["region_mostly_intermediate_cells"]);
});

test("regionProvenance warns when typed inputs feed formulas instead of holding results", () => {
  const provenance = regionProvenance({ indexBlobs: calculationBlobs(), sheetName: "Sheet1", range: "F4:H4" });
  assert.deepEqual(provenance.warnings.map((warning) => warning.code), ["region_mostly_input_cells"]);
});

test("regionProvenance flags typed constants inside an upstream formula run as a broken chain", () => {
  const provenance = regionProvenance({ indexBlobs: calculationBlobs(), sheetName: "Sheet1", range: "Q69:S69" });
  assert.deepEqual(provenance.warnings.map((warning) => warning.code), ["formula_chain_broken"]);
  assert.deepEqual(provenance.brokenCells.map((item) => item.address).sort(), ["F43", "G43"]);
  assert.match(provenance.brokenCells[0].expectedFrom, /Sheet1 row 43, 2 steps upstream/);
});

test("regionProvenance does not flag ordinary experiment tables without formulas", () => {
  const blobs = [{
    payload: {
      sheets: [{
        name: "Runs",
        cellGrid: { range: "A1:C3", cells: [cell("A1", "Experiment"), cell("B1", "Temperature"), cell("C1", "Yield"), cell("A2", "Exp1"), cell("B2", 250), cell("C2", 31.2), cell("A3", "Exp2"), cell("B3", 260), cell("C3", 35.1)] },
      }],
    },
  }];
  const provenance = regionProvenance({ indexBlobs: blobs, sheetName: "Runs", range: "A1:C3" });
  assert.deepEqual(provenance.warnings, []);
  assert.equal(provenance.cellClassSummary.constant, 9);
  assert.equal(provenance.derivation, "");
});

test("sourceCellClasses returns per-cell classes for a bounded range and validates input", () => {
  const result = sourceCellClasses({ sourceDocument: { id: "source_1" }, indexBlobs: calculationBlobs(), sheetName: "sheet1", range: "Q31:R32" });
  assert.equal(result.sheetName, "Sheet1");
  assert.equal(result.range, "Q31:R32");
  assert.deepEqual(result.cells.map((item) => [item.address, item.cellClass, item.dependentCount]), [
    ["Q31", "constant", 0], ["R31", "constant", 0], ["Q32", "terminal", 0], ["R32", "terminal", 0],
  ]);
  assert.equal(result.cells[2].formula, "F14");
  assert.equal(result.provenance.schemaVersion, "labrat.regionProvenance.v1");
  assert.throws(() => sourceCellClasses({ sourceDocument: { id: "s" }, indexBlobs: calculationBlobs(), sheetName: "Nope", range: "A1:B2" }), /was not found/);
  assert.throws(() => sourceCellClasses({ sourceDocument: { id: "s" }, indexBlobs: calculationBlobs(), sheetName: "Sheet1", range: "bad" }), /valid Excel range/);
  assert.throws(() => sourceCellClasses({ sourceDocument: { id: "s" }, indexBlobs: calculationBlobs(), sheetName: "Sheet1", range: "A1:Z100", maxCells: 10 }), /maximum is 10/);
});

test("oversized workbooks skip the graph with an explicit warning", () => {
  const provenance = regionProvenance({ graph: buildFormulaGraph(calculationBlobs(), { maxCells: 5 }), sheetName: "Sheet1", range: "Q32:S32" });
  assert.equal(provenance.graphTruncated, true);
  assert.deepEqual(provenance.warnings.map((warning) => warning.code), ["formula_graph_skipped"]);
});

test("regionProvenance flags a region whose formulas evaluate to Excel errors instead of treating error codes as numbers", () => {
  const blobs = [{
    payload: {
      sheets: [{
        name: "LDPE TEMPLATE",
        cellGrid: {
          range: "A1:H14",
          cells: [
            cell("A12", "Total C atoms"), { address: "B12", rawValue: 0, formattedValue: "0", type: "formula", formula: "A11/28.05*2" },
            cell("E14", "Yield"),
            ...["F", "G", "H"].map((col) => ({ address: `${col}14`, rawValue: null, formattedValue: "#DIV/0!", type: "error", formula: `${col}6/B12*100` })),
            ...["F", "G", "H"].map((col) => cell(`${col}13`, `C${col.charCodeAt(0) - 69}`)),
          ],
        },
      }],
    },
  }];
  const provenance = regionProvenance({ indexBlobs: blobs, sheetName: "LDPE TEMPLATE", range: "E13:H14" });
  assert.deepEqual(provenance.warnings.map((warning) => warning.code), ["region_formula_errors"]);
  assert.match(provenance.warnings[0].message, /#DIV\/0!/);
  assert.equal(provenance.numericCellCount, 0, "error cells are not numeric results");
});
