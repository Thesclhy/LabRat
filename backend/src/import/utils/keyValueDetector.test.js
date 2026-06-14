import assert from "node:assert/strict";
import { test } from "node:test";
import { detectKeyValuePairs } from "./keyValueDetector.js";

function cell(row, col, rawValue, type = "string") {
  const letter = String.fromCharCode(64 + col);
  return { row, col, address: `${letter}${row}`, rawValue, type };
}

test("detectKeyValuePairs parses single-cell colon metadata with units", () => {
  const [pair] = detectKeyValuePairs([
    cell(1, 1, "Temperature: 80 C"),
  ]);
  assert.equal(pair.rawKey, "Temperature");
  assert.equal(pair.rawValue, "80 C");
  assert.equal(pair.parsedValue, 80);
  assert.equal(pair.unit, "C");
  assert.equal(pair.source.keyCell, "A1");
  assert.equal(pair.source.valueCell, "A1");
  assert.equal(pair.source.range, "A1");
  assert.equal(pair.source.rawValue, "Temperature: 80 C");
});

test("detectKeyValuePairs parses single-cell equals metadata with source context", () => {
  const [pair] = detectKeyValuePairs([
    cell(1, 1, "Pressure = 2 bar"),
  ], { fileId: "file_1", fileName: "metadata.xlsx", sheetName: "Meta" });

  assert.equal(pair.rawKey, "Pressure");
  assert.equal(pair.parsedValue, 2);
  assert.equal(pair.unit, "bar");
  assert.equal(pair.row, 1);
  assert.equal(pair.source.fileId, "file_1");
  assert.equal(pair.source.fileName, "metadata.xlsx");
  assert.equal(pair.source.sheet, "Meta");
  assert.equal(pair.source.range, "A1");
});

test("detectKeyValuePairs parses adjacent key/value cells", () => {
  const pairs = detectKeyValuePairs([
    cell(2, 1, "Pressure"),
    cell(2, 2, "2 bar"),
    cell(3, 1, "Catalyst"),
    cell(3, 2, "Ru/TiO2"),
  ]);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].rawKey, "Pressure");
  assert.equal(pairs[0].parsedValue, 2);
  assert.equal(pairs[0].unit, "bar");
  assert.equal(pairs[0].source.range, "A2:B2");
  assert.equal(pairs[0].source.rawValue, "2 bar");
  assert.equal(pairs[1].rawKey, "Catalyst");
  assert.equal(pairs[1].rawValue, "Ru/TiO2");
  assert.equal(pairs[1].parsedValue, null);
});

test("detectKeyValuePairs trims adjacent key delimiters", () => {
  const [pair] = detectKeyValuePairs([
    cell(4, 1, "Catalyst:"),
    cell(4, 2, "Ru/TiO2"),
  ]);

  assert.equal(pair.rawKey, "Catalyst");
  assert.equal(pair.rawValue, "Ru/TiO2");
  assert.equal(pair.source.range, "A4:B4");
});

test("detectKeyValuePairs ignores table-like rows with too many cells", () => {
  const pairs = detectKeyValuePairs([
    cell(1, 1, "Experiment"),
    cell(1, 2, "Time"),
    cell(1, 3, "Conversion"),
    cell(1, 4, "Selectivity"),
  ]);
  assert.equal(pairs.length, 0);
});

test("detectKeyValuePairs rejects numeric keys, empty values, and pipe keys", () => {
  const pairs = detectKeyValuePairs([
    cell(1, 1, 80, "number"),
    cell(1, 2, "C"),
    cell(2, 1, "Pressure"),
    cell(2, 2, ""),
    cell(3, 1, "A|B"),
    cell(3, 2, "value"),
  ]);

  assert.equal(pairs.length, 0);
});
