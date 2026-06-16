import assert from "node:assert/strict";
import { test } from "node:test";
import { detectHeaderRows } from "../utils/headerDetector.js";
import { parseStandardTable } from "./standardTableParser.js";

function cell(row, col, rawValue, type = "string") {
  const letter = String.fromCharCode(64 + col);
  return { row, col, address: `${letter}${row}`, rawValue, type, formattedValue: String(rawValue), formula: null };
}

test("parseStandardTable extracts columns, rows, and value provenance", () => {
  const cells = [
    cell(1, 1, "Experiment"),
    cell(1, 2, "Time (min)"),
    cell(1, 3, "Conversion (%)"),
    cell(2, 1, "Exp1"),
    cell(2, 2, 0, "number"),
    cell(2, 3, 0, "number"),
    cell(3, 1, "Exp1"),
    cell(3, 2, 10, "number"),
    cell(3, 3, 25, "number"),
  ];
  const sourceContext = { fileId: "file_1", fileName: "standard.xlsx", sheetName: "Runs" };
  const candidateHeaders = detectHeaderRows(cells, { sourceContext });
  const parsed = parseStandardTable({
    sheetId: "sheet_1",
    cellGrid: { rowCount: 3, cells },
    candidateHeaders,
  }, sourceContext);

  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.blocks[0].range, "A1:C3");
  assert.equal(parsed.blocks[0].table.columns[1].unit, "min");
  assert.equal(parsed.blocks[0].table.rows.length, 2);
  assert.equal(parsed.blocks[0].table.rows[1].values[2].value, 25);
  assert.equal(parsed.blocks[0].table.rows[1].values[2].source.cell, "C3");
  assert.equal(parsed.blocks[0].table.rows[1].values[2].source.fileName, "standard.xlsx");
});

test("parseStandardTable returns warning when no header exists", () => {
  const parsed = parseStandardTable({ sheetId: "sheet_1", cellGrid: { rowCount: 0, cells: [] }, candidateHeaders: [] });
  assert.equal(parsed.blocks.length, 0);
  assert.equal(parsed.warnings[0].code, "no_header_row");
});

test("parseStandardTable skips blank rows and keeps partial row cells explicit", () => {
  const sourceContext = { fileId: "file_2", fileName: "partial.xlsx", sheetName: "Runs" };
  const cells = [
    cell(1, 1, "Experiment"),
    cell(1, 2, "Time (min)"),
    cell(1, 3, "Conversion (%)"),
    cell(2, 1, "Exp1"),
    cell(2, 2, 0, "number"),
    cell(2, 3, 0, "number"),
    cell(4, 1, "Exp1"),
    cell(4, 3, 25, "number"),
  ];
  const candidateHeaders = detectHeaderRows(cells, { sourceContext });
  const parsed = parseStandardTable({
    sheetId: "sheet_1",
    cellGrid: { rowCount: 4, cells },
    candidateHeaders,
  }, sourceContext);

  const table = parsed.blocks[0].table;
  assert.equal(table.dataRange, "A2:C4");
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[1].rowIndex, 4);
  assert.equal(table.rows[1].values[1].value, null);
  assert.equal(table.rows[1].values[1].rawValue, "");
  assert.equal(table.rows[1].values[1].source, null);
  assert.equal(table.rows[1].values[2].source.cell, "C4");
});

test("parseStandardTable returns a block warning for header-only tables", () => {
  const sourceContext = { fileId: "file_3", fileName: "empty-table.xlsx", sheetName: "Runs" };
  const header = {
    row: 1,
    range: "A1:B1",
    confidence: 0.8,
    columns: [
      { col: 1, rawName: "Time", label: "Time", unit: null, source: { sheet: "Runs", cell: "A1", range: "A1" } },
      { col: 2, rawName: "Conversion", label: "Conversion", unit: null, source: { sheet: "Runs", cell: "B1", range: "B1" } },
    ],
  };
  const parsed = parseStandardTable({
    sheetId: "sheet_1",
    cellGrid: { rowCount: 1, cells: [cell(1, 1, "Time"), cell(1, 2, "Conversion")] },
    candidateHeaders: [header],
  }, sourceContext);

  const block = parsed.blocks[0];
  assert.equal(block.range, "A1:B1");
  assert.equal(block.table.dataRange, null);
  assert.equal(block.table.rows.length, 0);
  assert.equal(block.table.source.fileName, "empty-table.xlsx");
  assert.equal(block.warnings[0].code, "no_data_rows");
});

test("parseStandardTable flattens grouped multi-row headers and classifies field roles", () => {
  const sourceContext = { fileId: "file_4", fileName: "grouped.xlsx", sheetName: "Sheet1" };
  const cells = [
    cell(1, 1, "Label"),
    cell(1, 2, "Date"),
    { ...cell(1, 3, "Catalyst"), merged: true, mergedRange: "C1:D1" },
    { ...cell(1, 5, "Polymer"), merged: true, mergedRange: "E1:F1" },
    cell(1, 7, "Temperature (C)"),
    cell(1, 8, "Pressure (bar)"),
    cell(1, 9, "Reaction Time (hrs)"),
    cell(1, 10, "RPM"),
    cell(1, 11, "Impeller"),
    { ...cell(1, 12, "Selectivity (%)"), merged: true, mergedRange: "L1:N1" },
    cell(2, 3, "Type"),
    cell(2, 4, "Loading (g)"),
    cell(2, 5, "Type"),
    cell(2, 6, "Loading (g)"),
    cell(2, 12, "Solid"),
    cell(2, 13, "Liquid"),
    cell(2, 14, "Gas"),
    cell(3, 1, "Exp1"),
    cell(3, 2, "2025/3/17"),
    cell(3, 3, "Ru/TiO2"),
    cell(3, 4, 0.2009, "number"),
    cell(3, 5, "HDPE"),
    cell(3, 6, 22.02, "number"),
    cell(3, 7, 250, "number"),
    cell(3, 8, 50, "number"),
    cell(3, 9, 5, "number"),
    cell(3, 10, 500, "number"),
    cell(3, 11, "flat"),
    cell(3, 12, 92.8, "number"),
    cell(3, 13, 0.1, "number"),
    cell(3, 14, 0.35, "number"),
  ];
  const candidateHeaders = detectHeaderRows(cells, { sourceContext });
  const parsed = parseStandardTable({
    sheetId: "sheet_1",
    regions: [{ regionId: "region_1" }],
    cellGrid: { rowCount: 3, cells },
    candidateHeaders,
  }, sourceContext);

  const columns = parsed.blocks[0].table.columns;
  assert.deepEqual(columns.map((column) => column.rawName), [
    "Label",
    "Date",
    "Catalyst Type",
    "Catalyst Loading (g)",
    "Polymer Type",
    "Polymer Loading (g)",
    "Temperature (C)",
    "Pressure (bar)",
    "Reaction Time (hrs)",
    "RPM",
    "Impeller",
    "Selectivity Solid (%)",
    "Selectivity Liquid (%)",
    "Selectivity Gas (%)",
  ]);
  assert.equal(columns[0].role, "identifier");
  assert.equal(columns[2].role, "material");
  assert.equal(columns[6].role, "condition");
  assert.equal(columns[11].role, "measurement");
  assert.equal(columns[11].unit, "%");
  assert.deepEqual(parsed.structureProposals[0].headerRows, [1, 2]);
  assert.deepEqual(parsed.structureProposals[0].labelColumns, ["col_1"]);
});
