import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUnknownSheet } from "./unknownParser.js";

test("parseUnknownSheet returns candidate regions without inventing tables", () => {
  const parsed = parseUnknownSheet({
    sheetId: "sheet_1",
    regions: [{ range: "A1:B2", startRow: 1, endRow: 2 }],
    candidateHeaders: [{ row: 1, columns: [] }],
    candidateMetadata: [{ row: 2, rawKey: "Temperature" }],
  }, { fileId: "file_1", fileName: "ambiguous.xlsx", sheetName: "Sheet1" });

  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.blocks[0].type, "unknown_region");
  assert.equal(parsed.blocks[0].table, null);
  assert.equal(parsed.blocks[0].candidateHeaders.length, 1);
  assert.equal(parsed.blocks[0].candidateMetadata.length, 1);
  assert.equal(parsed.blocks[0].warnings[0].code, "unknown_layout");
  assert.equal(parsed.blocks[0].source.sheet, "Sheet1");
  assert.equal(parsed.blocks[0].source.blockId, "sheet_1_unknown_1");
});

test("parseUnknownSheet filters candidate headers and metadata by region", () => {
  const parsed = parseUnknownSheet({
    sheetId: "sheet_1",
    regions: [
      { range: "A1:B2", startRow: 1, endRow: 2 },
      { range: "A8:B9", startRow: 8, endRow: 9 },
    ],
    candidateHeaders: [
      { row: 1, range: "A1:B1" },
      { row: 8, range: "A8:B8" },
    ],
    candidateMetadata: [
      { row: 2, rawKey: "Temperature" },
      { row: 9, rawKey: "Pressure" },
    ],
  }, { fileId: "file_2", fileName: "ambiguous.xlsx", sheetName: "Sheet1" });

  assert.equal(parsed.blocks.length, 2);
  assert.equal(parsed.blocks[0].candidateHeaders[0].range, "A1:B1");
  assert.equal(parsed.blocks[0].candidateMetadata[0].rawKey, "Temperature");
  assert.equal(parsed.blocks[1].candidateHeaders[0].range, "A8:B8");
  assert.equal(parsed.blocks[1].candidateMetadata[0].rawKey, "Pressure");
  assert.equal(parsed.blocks[1].source.range, "A8:B9");
});

test("parseUnknownSheet returns warnings without blocks when no regions exist", () => {
  const parsed = parseUnknownSheet({
    sheetId: "sheet_1",
    regions: [],
    candidateHeaders: [{ row: 1 }],
    candidateMetadata: [{ row: 2, rawKey: "Temperature" }],
  });

  assert.equal(parsed.blocks.length, 0);
  assert.equal(parsed.warnings[0].code, "unknown_layout");
});
