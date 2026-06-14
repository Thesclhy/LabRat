import assert from "node:assert/strict";
import { test } from "node:test";
import { runImportScan } from "../services/importPipeline.js";
import {
  ambiguousSparseSheetFixture,
  cleanStandardTableFixture,
  createAmbiguousSparseSheetWorkbook,
  createCleanStandardTableWorkbook,
  createRepeatedBlockTableWorkbook,
  repeatedBlockTableFixture,
} from "./workbookFixtures.js";

test("clean standard table fixture scans as one standard table block", () => {
  const result = runImportScan(createCleanStandardTableWorkbook());
  const sheet = result.sheets[0];
  const block = sheet.blocks[0];

  assert.equal(result.file.name, cleanStandardTableFixture.filename);
  assert.equal(result.summary.sheetCount, 1);
  assert.equal(result.summary.blockCount, 1);
  assert.equal(sheet.name, cleanStandardTableFixture.sheetName);
  assert.equal(sheet.usedRange, "A1:E4");
  assert.equal(sheet.layout.type, "standard_table");
  assert.equal(sheet.layout.confidence >= 0.85, true);
  assert.equal(sheet.candidateHeaders.length, 1);
  assert.equal(sheet.candidateHeaders[0].range, "A1:E1");
  assert.equal(sheet.candidateHeaders[0].columns[1].unit, "C");
  assert.equal(sheet.candidateHeaders[0].columns[2].unit, "min");
  assert.equal(sheet.candidateHeaders[0].columns[3].unit, "%");
  assert.equal(block.type, "standard_table");
  assert.equal(block.range, "A1:E4");
  assert.equal(block.table.columns.length, 5);
  assert.equal(block.table.rows.length, 3);
  assert.equal(block.table.rows[2].values[3].value, 41.2);
  assert.equal(block.table.rows[2].values[3].source.sheet, cleanStandardTableFixture.sheetName);
  assert.equal(block.table.rows[2].values[3].source.cell, "D4");
  assert.deepEqual(sheet.warnings, []);
});

test("repeated block table fixture scans as two experiment blocks", () => {
  const result = runImportScan(createRepeatedBlockTableWorkbook());
  const sheet = result.sheets[0];

  assert.equal(result.file.name, repeatedBlockTableFixture.filename);
  assert.equal(result.summary.sheetCount, 1);
  assert.equal(result.summary.blockCount, 2);
  assert.equal(sheet.name, repeatedBlockTableFixture.sheetName);
  assert.equal(sheet.usedRange, "A1:D12");
  assert.equal(sheet.layout.type, "block_table");
  assert.equal(sheet.regions.length, 2);
  assert.equal(sheet.candidateHeaders.length, 2);
  assert.equal(sheet.candidateMetadata.length, 2);

  assert.equal(sheet.blocks[0].type, "experiment_block");
  assert.equal(sheet.blocks[0].range, "A1:D5");
  assert.equal(sheet.blocks[0].title.value, "Experiment A");
  assert.equal(sheet.blocks[0].metadata[0].rawKey, "Temperature");
  assert.equal(sheet.blocks[0].metadata[0].parsedValue, 80);
  assert.equal(sheet.blocks[0].metadata[0].unit, "C");
  assert.equal(sheet.blocks[0].table.rows.length, 2);
  assert.equal(sheet.blocks[0].table.rows[1].values[1].value, 24.5);
  assert.equal(sheet.blocks[0].table.rows[1].values[1].source.blockId, "sheet_1_block_1");

  assert.equal(sheet.blocks[1].range, "A8:D12");
  assert.equal(sheet.blocks[1].title.value, "Experiment B");
  assert.equal(sheet.blocks[1].metadata[0].parsedValue, 90);
  assert.equal(sheet.blocks[1].table.rows[1].values[1].value, 36.2);
  assert.equal(sheet.blocks[1].table.rows[1].values[1].source.cell, "B12");
  assert.deepEqual(sheet.warnings, []);
});

test("ambiguous sparse sheet fixture scans as unknown without invented table rows", () => {
  const result = runImportScan(createAmbiguousSparseSheetWorkbook());
  const sheet = result.sheets[0];
  const block = sheet.blocks[0];

  assert.equal(result.file.name, ambiguousSparseSheetFixture.filename);
  assert.equal(result.summary.sheetCount, 1);
  assert.equal(result.summary.blockCount, 1);
  assert.equal(sheet.name, ambiguousSparseSheetFixture.sheetName);
  assert.equal(sheet.usedRange, "A1:A4");
  assert.equal(sheet.layout.type, "unknown");
  assert.equal(sheet.candidateHeaders.length, 0);
  assert.equal(sheet.candidateMetadata.length, 0);
  assert.equal(block.type, "unknown_region");
  assert.equal(block.range, "A1:A4");
  assert.equal(block.table, null);
  assert.equal(block.candidateHeaders.length, 0);
  assert.equal(block.candidateMetadata.length, 0);
  assert.equal(sheet.warnings[0].code, "unknown_layout");
  assert.equal(block.warnings[0].code, "unknown_layout");
});
