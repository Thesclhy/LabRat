import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { runImportScan } from "./importPipeline.js";

function workbookBuffer(rows, sheetName = "Runs") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("runImportScan orchestrates scan, classification, and parser selection", () => {
  const result = runImportScan({
    fileId: "file_1",
    filename: "standard.xlsx",
    sizeBytes: 100,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbookBuffer([
      ["Experiment", "Time (min)", "Conversion (%)"],
      ["Exp1", 0, 0],
      ["Exp1", 10, 25],
    ]),
  });

  assert.equal(result.file.name, "standard.xlsx");
  assert.equal(result.schemaVersion, "labrat.importScan.v1");
  assert.deepEqual(result.summary, { sheetCount: 1, blockCount: 1, warningCount: 0 });
  assert.equal(result.sheets[0].layout.type, "standard_table");
  assert.equal(result.sheets[0].rowCount, 3);
  assert.equal(result.sheets[0].columnCount, 3);
  assert.equal(result.sheets[0].blocks.length, 1);
  assert.equal(result.sheets[0].blocks[0].metadata.length, 0);
  assert.equal(result.sheets[0].blocks[0].title, null);
  assert.equal(result.sheets[0].blocks[0].table.rows.length, 2);
});
