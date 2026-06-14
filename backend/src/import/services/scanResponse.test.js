import assert from "node:assert/strict";
import { test } from "node:test";
import { shapeScanResponse } from "./scanResponse.js";

test("shapeScanResponse returns a stable scan envelope and sheet summary fields", () => {
  const response = shapeScanResponse({
    file: {
      fileId: "file_1",
      name: "scan.xlsx",
      type: "xlsx",
      sizeBytes: 120,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    sheets: [{
      sheetId: "sheet_1",
      name: "Runs",
      usedRange: "A1:B2",
      cellGrid: {
        range: "A1:B2",
        rowCount: 2,
        columnCount: 2,
        cells: [{ row: 1, col: 1, address: "A1", rawValue: "Run" }],
      },
      layout: { type: "standard_table", confidence: 1.2345, reasons: ["candidate header row detected"] },
      regions: [{ regionId: "region_1", range: "A1:B2" }],
      candidateHeaders: [],
      candidateMetadata: [],
      blocks: [{
        blockId: "sheet_1_table_1",
        type: "standard_table",
        range: "A1:B2",
        table: {
          headerRange: "A1:B1",
          dataRange: "A2:B2",
          columns: [{ columnId: "col_1", rawName: "Time", source: { sheet: "Runs", cell: "A1" } }],
          rows: [{
            rowIndex: 2,
            values: [{ columnId: "col_1", value: 10, rawValue: "10", source: { sheet: "Runs", cell: "A2" } }],
          }],
          source: { fileId: "file_1", sheet: "Runs", range: "A1:B2" },
        },
        warnings: [{ code: "low_confidence", message: "Check this block." }],
        confidence: 0.81234,
      }],
      warnings: [],
    }],
    warnings: [],
  });

  assert.equal(response.schemaVersion, "labrat.importScan.v1");
  assert.deepEqual(response.summary, { sheetCount: 1, blockCount: 1, warningCount: 1 });
  assert.equal(response.sheets[0].rowCount, 2);
  assert.equal(response.sheets[0].columnCount, 2);
  assert.equal(response.sheets[0].nonEmptyCellCount, 1);
  assert.equal(response.sheets[0].layout.confidence, 1);
  assert.equal(response.sheets[0].blocks[0].metadata.length, 0);
  assert.equal(response.sheets[0].blocks[0].title, null);
  assert.equal(response.sheets[0].blocks[0].source.range, "A1:B2");
  assert.equal(response.sheets[0].blocks[0].warnings[0].severity, "warning");
  assert.equal(response.sheets[0].blocks[0].table.columns[0].source.range, "A1");
  assert.equal(response.sheets[0].blocks[0].table.rows[0].values[0].source.range, "A2");
});

test("shapeScanResponse normalizes optional block fields without dropping provenance", () => {
  const response = shapeScanResponse({
    file: { fileId: "file_2", name: "blocks.xlsx", type: "xlsx" },
    sheets: [{
      sheetId: "sheet_1",
      name: "Blocks",
      cellGrid: { rowCount: 1, columnCount: 1, cells: [] },
      layout: { type: "unknown" },
      blocks: [{
        blockId: "sheet_1_unknown_1",
        type: "unknown_region",
        range: "A1:A1",
        title: { value: "Experiment 1", source: { fileId: "file_2", sheet: "Blocks", cell: "A1", rawValue: "Experiment 1" } },
        candidateMetadata: [{ row: 1, rawKey: "Temperature", rawValue: "80 C", source: { sheet: "Blocks", cell: "B1" } }],
      }],
    }],
  });

  const block = response.sheets[0].blocks[0];
  assert.equal(block.title.rawValue, "Experiment 1");
  assert.equal(block.title.source.rawValue, "Experiment 1");
  assert.equal(block.metadata.length, 0);
  assert.equal(block.table, null);
  assert.equal(block.candidateHeaders.length, 0);
  assert.equal(block.candidateMetadata[0].source.range, "B1");
});
