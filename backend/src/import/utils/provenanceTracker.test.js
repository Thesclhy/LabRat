import assert from "node:assert/strict";
import { test } from "node:test";
import { cellSource, keyValueSource, rangeSource } from "./provenanceTracker.js";

const context = { fileId: "file_1", fileName: "runs.xlsx", sheetName: "Runs" };

test("cellSource attaches file, sheet, cell, range, and raw value", () => {
  assert.deepEqual(cellSource({ address: "B2", rawValue: 25 }, context), {
    fileId: "file_1",
    fileName: "runs.xlsx",
    sheet: "Runs",
    cell: "B2",
    range: "B2",
    blockId: null,
    rawValue: 25,
  });
});

test("rangeSource attaches source range", () => {
  assert.deepEqual(rangeSource("A1:C3", context), {
    fileId: "file_1",
    fileName: "runs.xlsx",
    sheet: "Runs",
    cell: null,
    range: "A1:C3",
    blockId: null,
    rawValue: null,
  });
});

test("keyValueSource records key/value cells", () => {
  assert.deepEqual(keyValueSource({ address: "A1" }, { address: "B1", rawValue: "80 C" }, { ...context, range: "A1:B1" }), {
    fileId: "file_1",
    fileName: "runs.xlsx",
    sheet: "Runs",
    keyCell: "A1",
    valueCell: "B1",
    cell: null,
    range: "A1:B1",
    blockId: null,
    rawValue: "80 C",
  });
});
