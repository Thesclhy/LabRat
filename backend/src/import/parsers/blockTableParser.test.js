import assert from "node:assert/strict";
import { test } from "node:test";
import { detectRegions } from "../utils/regionDetector.js";
import { parseBlockTable } from "./blockTableParser.js";

function cell(row, col, rawValue, type = "string") {
  const letter = String.fromCharCode(64 + col);
  return { row, col, address: `${letter}${row}`, rawValue, type, formattedValue: String(rawValue), formula: null };
}

test("parseBlockTable extracts repeated experiment blocks", () => {
  const cells = [
    cell(1, 1, "Experiment 1"),
    cell(2, 1, "Temperature: 80 C"),
    cell(3, 1, "Time (min)"),
    cell(3, 2, "Conversion (%)"),
    cell(4, 1, 0, "number"),
    cell(4, 2, 0, "number"),
    cell(5, 1, 10, "number"),
    cell(5, 2, 25, "number"),
    cell(9, 1, "Experiment 2"),
    cell(10, 1, "Temperature: 90 C"),
    cell(11, 1, "Time (min)"),
    cell(11, 2, "Conversion (%)"),
    cell(12, 1, 0, "number"),
    cell(12, 2, 0, "number"),
    cell(13, 1, 10, "number"),
    cell(13, 2, 34, "number"),
  ];
  const parsed = parseBlockTable({
    sheetId: "sheet_1",
    cellGrid: { cells },
    regions: detectRegions({ cells }),
  }, { fileId: "file_1", fileName: "blocks.xlsx", sheetName: "Blocks" });

  assert.equal(parsed.blocks.length, 2);
  assert.equal(parsed.blocks[0].title.value, "Experiment 1");
  assert.equal(parsed.blocks[0].title.source.fileName, "blocks.xlsx");
  assert.equal(parsed.blocks[0].title.source.sheet, "Blocks");
  assert.equal(parsed.blocks[0].title.source.blockId, "sheet_1_block_1");
  assert.equal(parsed.blocks[0].title.source.cell, "A1");
  assert.equal(parsed.blocks[0].metadata[0].rawKey, "Temperature");
  assert.equal(parsed.blocks[0].metadata[0].parsedValue, 80);
  assert.equal(parsed.blocks[0].source.range, "A1:B5");
  assert.equal(parsed.blocks[0].table.rows.length, 2);
  assert.equal(parsed.blocks[1].title.value, "Experiment 2");
  assert.equal(parsed.blocks[1].table.rows[1].values[1].value, 34);
  assert.equal(parsed.blocks[1].table.rows[1].values[1].source.blockId, "sheet_1_block_2");
});

test("parseBlockTable returns unknown block warning when a region has no header", () => {
  const cells = [cell(1, 1, "lonely note")];
  const parsed = parseBlockTable({
    sheetId: "sheet_1",
    cellGrid: { cells },
    regions: detectRegions({ cells }),
  });
  assert.equal(parsed.blocks[0].type, "unknown_block");
  assert.equal(parsed.blocks[0].source.range, "A1");
  assert.equal(parsed.blocks[0].warnings[0].code, "block_header_not_found");
  assert.equal(parsed.warnings[0].range, "A1");
});

test("parseBlockTable returns parser warning when no regions are available", () => {
  const parsed = parseBlockTable({
    sheetId: "sheet_1",
    cellGrid: { cells: [] },
    regions: [],
  });

  assert.equal(parsed.blocks.length, 0);
  assert.equal(parsed.warnings[0].code, "no_regions");
});

test("parseBlockTable keeps title and metadata empty for table-only blocks", () => {
  const cells = [
    cell(1, 1, "Time (min)"),
    cell(1, 2, "Conversion (%)"),
    cell(2, 1, 0, "number"),
    cell(2, 2, 0, "number"),
    cell(3, 1, 10, "number"),
    cell(3, 2, 25, "number"),
  ];
  const parsed = parseBlockTable({
    sheetId: "sheet_1",
    cellGrid: { cells },
    regions: detectRegions({ cells }),
  }, { fileId: "file_2", fileName: "table-only.xlsx", sheetName: "Blocks" });

  assert.equal(parsed.blocks[0].type, "experiment_block");
  assert.equal(parsed.blocks[0].title, null);
  assert.equal(parsed.blocks[0].metadata.length, 0);
  assert.equal(parsed.blocks[0].table.source.blockId, "sheet_1_block_1");
});
