import * as XLSX from "xlsx";

const EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function workbookBufferFromSheets(sheets) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  });
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export const cleanStandardTableFixture = {
  fileId: "fixture_clean_standard",
  filename: "clean-standard-table.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  sheetName: "Clean Standard",
  rows: [
    ["Experiment", "Temperature (C)", "Time (min)", "Conversion (%)", "Yield (%)"],
    ["ExpA", 80, 0, 0, 0],
    ["ExpA", 80, 10, 24.5, 18.1],
    ["ExpA", 80, 20, 41.2, 30.4],
  ],
};

export const repeatedBlockTableFixture = {
  fileId: "fixture_repeated_block",
  filename: "repeated-block-table.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  sheetName: "Repeated Blocks",
  rows: [
    ["Experiment A"],
    ["Temperature: 80 C"],
    ["Time (min)", "Conversion (%)", "Yield (%)", "Selectivity (%)"],
    [0, 0, 0, 0],
    [10, 24.5, 18.1, 73.9],
    [],
    [],
    ["Experiment B"],
    ["Temperature: 90 C"],
    ["Time (min)", "Conversion (%)", "Yield (%)", "Selectivity (%)"],
    [0, 0, 0, 0],
    [10, 36.2, 27.8, 76.8],
  ],
};

export const ambiguousSparseSheetFixture = {
  fileId: "fixture_ambiguous_sparse",
  filename: "ambiguous-sparse-sheet.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  sheetName: "Ambiguous Sparse",
  rows: [
    ["Temperature"],
    [80],
    [],
    ["good run maybe"],
  ],
};

export function createCleanStandardTableWorkbook() {
  const buffer = workbookBufferFromSheets([{
    name: cleanStandardTableFixture.sheetName,
    rows: cleanStandardTableFixture.rows,
  }]);
  return {
    fileId: cleanStandardTableFixture.fileId,
    filename: cleanStandardTableFixture.filename,
    sizeBytes: buffer.length,
    contentType: cleanStandardTableFixture.contentType,
    buffer,
  };
}

export function createRepeatedBlockTableWorkbook() {
  const buffer = workbookBufferFromSheets([{
    name: repeatedBlockTableFixture.sheetName,
    rows: repeatedBlockTableFixture.rows,
  }]);
  return {
    fileId: repeatedBlockTableFixture.fileId,
    filename: repeatedBlockTableFixture.filename,
    sizeBytes: buffer.length,
    contentType: repeatedBlockTableFixture.contentType,
    buffer,
  };
}

export function createAmbiguousSparseSheetWorkbook() {
  const buffer = workbookBufferFromSheets([{
    name: ambiguousSparseSheetFixture.sheetName,
    rows: ambiguousSparseSheetFixture.rows,
  }]);
  return {
    fileId: ambiguousSparseSheetFixture.fileId,
    filename: ambiguousSparseSheetFixture.filename,
    sizeBytes: buffer.length,
    contentType: ambiguousSparseSheetFixture.contentType,
    buffer,
  };
}
