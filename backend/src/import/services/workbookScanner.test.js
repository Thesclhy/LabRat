import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { createGroupedMasterTableWorkbook } from "../fixtures/workbookFixtures.js";
import { scanWorkbook } from "./workbookScanner.js";

function workbookBuffer() {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Experiment", "Time (min)", "Conversion (%)"],
    ["Exp1", 0, 0],
    ["Exp1", 10, 25],
  ]), "Runs");

  const formulaSheet = XLSX.utils.aoa_to_sheet([
    ["Merged Title", ""],
    [2, ""],
  ]);
  formulaSheet.B2 = { t: "n", f: "A2*2", v: 4, w: "4" };
  formulaSheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
  XLSX.utils.book_append_sheet(workbook, formulaSheet, "Formula");

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Empty");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("scanWorkbook returns structural workbook and sheet scan data", () => {
  const result = scanWorkbook({
    fileId: "file_1",
    filename: "scanner.xlsx",
    sizeBytes: 100,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbookBuffer(),
  });

  assert.deepEqual(result.file, {
    fileId: "file_1",
    name: "scanner.xlsx",
    type: "xlsx",
    sizeBytes: 100,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  assert.equal(result.sheets.length, 3);
  assert.deepEqual(result.warnings, []);

  const runs = result.sheets[0];
  assert.equal(runs.sheetId, "sheet_1");
  assert.equal(runs.name, "Runs");
  assert.equal(runs.usedRange, "A1:C3");
  assert.equal(runs.cellGrid.rowCount, 3);
  assert.equal(runs.cellGrid.columnCount, 3);
  assert.equal(runs.cellGrid.cells.length, 9);
  assert.equal(runs.regions[0].range, "A1:C3");
  assert.equal(runs.candidateHeaders[0].range, "A1:C1");
  assert.equal(runs.candidateHeaders[0].columns[2].unit, "%");
  assert.equal(Object.hasOwn(runs, "layout"), false);
  assert.equal(Object.hasOwn(runs, "blocks"), false);
});

test("scanWorkbook preserves formula, merged-cell, and empty-sheet scan details", () => {
  const result = scanWorkbook({
    fileId: "file_2",
    filename: "scanner.xls",
    sizeBytes: 200,
    contentType: "application/vnd.ms-excel",
    buffer: workbookBuffer(),
  });

  assert.equal(result.file.type, "xls");

  const formulaSheet = result.sheets.find((sheet) => sheet.name === "Formula");
  assert.equal(formulaSheet.usedRange, "A1:B2");
  const mergedCell = formulaSheet.cellGrid.cells.find((cell) => cell.address === "A1");
  assert.equal(mergedCell.merged, true);
  assert.equal(mergedCell.mergedRange, "A1:B1");
  const formulaCell = formulaSheet.cellGrid.cells.find((cell) => cell.address === "B2");
  assert.equal(formulaCell.type, "formula");
  assert.equal(formulaCell.formula, "A2*2");
  assert.equal(formulaCell.rawValue, 4);
  assert.equal(formulaCell.formattedValue, "4");

  const emptySheet = result.sheets.find((sheet) => sheet.name === "Empty");
  assert.equal(emptySheet.usedRange, null);
  assert.equal(emptySheet.cellGrid.cells.length, 0);
  assert.equal(emptySheet.regions.length, 0);
  assert.equal(emptySheet.warnings[0].code, "empty_sheet");
});

test("scanWorkbook preserves comments, styles, and hidden row/column hints when available", () => {
  const result = scanWorkbook(createGroupedMasterTableWorkbook());
  const sheet = result.sheets[0];
  const labelCell = sheet.cellGrid.cells.find((cell) => cell.address === "A1");

  assert.equal(sheet.cellGrid.hiddenRows.includes(4), true);
  assert.equal(sheet.cellGrid.hiddenColumns.includes(14), true);
  assert.equal(labelCell.comments[0].text, "Experiment label");
  assert.equal(Object.hasOwn(labelCell, "style"), true);
});
