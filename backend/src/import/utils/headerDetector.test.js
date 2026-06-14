import assert from "node:assert/strict";
import { test } from "node:test";
import { detectHeaderRows } from "./headerDetector.js";

function cell(row, col, rawValue, type = "string") {
  const letter = String.fromCharCode(64 + col);
  return { row, col, address: `${letter}${row}`, rawValue, type };
}

test("detectHeaderRows finds a text header above numeric data", () => {
  const headers = detectHeaderRows([
    cell(1, 1, "Experiment"),
    cell(1, 2, "Time (min)"),
    cell(1, 3, "Conversion (%)"),
    cell(2, 1, "Exp1"),
    cell(2, 2, 0, "number"),
    cell(2, 3, 0, "number"),
    cell(3, 1, "Exp1"),
    cell(3, 2, 10, "number"),
    cell(3, 3, 25, "number"),
  ]);
  assert.equal(headers[0].row, 1);
  assert.equal(headers[0].range, "A1:C1");
  assert.equal(headers[0].columns[1].rawName, "Time (min)");
  assert.ok(headers[0].confidence > 0.7);
});

test("detectHeaderRows ignores sparse title rows without enough column labels", () => {
  const headers = detectHeaderRows([
    cell(1, 1, "Experiment 1"),
    cell(3, 1, "Time"),
    cell(3, 2, "Conversion"),
    cell(4, 1, 0, "number"),
    cell(4, 2, 25, "number"),
  ]);
  assert.equal(headers[0].row, 3);
});

test("detectHeaderRows attaches source references and parsed units", () => {
  const headers = detectHeaderRows([
    cell(2, 1, "Time (min)"),
    cell(2, 2, "Pressure / bar"),
    cell(2, 3, "Conversion (%)"),
    cell(3, 1, 0, "number"),
    cell(3, 2, 2, "number"),
    cell(3, 3, 10, "number"),
  ], {
    sourceContext: { fileId: "file_1", fileName: "headers.xlsx", sheetName: "Runs" },
  });

  assert.equal(headers.length, 1);
  assert.equal(headers[0].columns[0].label, "Time");
  assert.equal(headers[0].columns[0].unit, "min");
  assert.equal(headers[0].columns[1].unit, "bar");
  assert.equal(headers[0].columns[2].unit, "%");
  assert.equal(headers[0].columns[2].source.fileId, "file_1");
  assert.equal(headers[0].columns[2].source.fileName, "headers.xlsx");
  assert.equal(headers[0].columns[2].source.sheet, "Runs");
  assert.equal(headers[0].columns[2].source.cell, "C2");
});

test("detectHeaderRows honors minTextCells", () => {
  const cells = [
    cell(1, 1, "Time"),
    cell(1, 2, "Conversion"),
    cell(2, 1, 0, "number"),
    cell(2, 2, 25, "number"),
  ];

  assert.equal(detectHeaderRows(cells).length, 1);
  assert.equal(detectHeaderRows(cells, { minTextCells: 3 }).length, 0);
});
