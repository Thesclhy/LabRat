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

export const groupedMasterTableFixture = {
  fileId: "fixture_grouped_master",
  filename: "grouped-master-table.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  sheetName: "Sheet1",
  rows: [
    ["Label", "Date", "Catalyst", "", "Polymer", "", "Temperature (C)", "Pressure (bar)", "Reaction Time (hrs)", "RPM", "Impeller", "Selectivity (%)", "", ""],
    ["", "", "Type", "Loading (g)", "Type", "Loading (g)", "", "", "", "", "", "Solid", "Liquid", "Gas"],
    ["Exp1", "2025/3/17", "Ru/TiO2", 0.2009, "HDPE (pellets)", 22.02, 250, 50, 5, 500, "flat", 92.8, 0.1, 0.35],
    ["Exp2", "2025/3/20", "Ru/TiO2", 0.2048, "HDPE (pellets)", 22.0244, 250, 50, 5, 500, "flat", 92.0, 0.34, 0.41],
  ],
};

function workbookBufferWithSheetOptions({ name, rows, merges = [], comments = [], hiddenRows = [], hiddenColumns = [] }) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  if (merges.length) worksheet["!merges"] = merges.map((range) => XLSX.utils.decode_range(range));
  comments.forEach(({ cell, text, author = "LabRat" }) => {
    worksheet[cell] = worksheet[cell] || { t: "s", v: "" };
    worksheet[cell].c = [{ a: author, t: text }];
  });
  if (hiddenRows.length) worksheet["!rows"] = rows.map((_, index) => ({ hidden: hiddenRows.includes(index + 1) }));
  if (hiddenColumns.length) {
    const width = Math.max(...rows.map((row) => row.length));
    worksheet["!cols"] = Array.from({ length: width }, (_, index) => ({ hidden: hiddenColumns.includes(index + 1) }));
  }
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

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

export function createGroupedMasterTableWorkbook() {
  const buffer = workbookBufferWithSheetOptions({
    name: groupedMasterTableFixture.sheetName,
    rows: groupedMasterTableFixture.rows,
    merges: ["C1:D1", "E1:F1", "L1:N1"],
    comments: [{ cell: "A1", text: "Experiment label" }],
    hiddenRows: [4],
    hiddenColumns: [14],
  });
  return {
    fileId: groupedMasterTableFixture.fileId,
    filename: groupedMasterTableFixture.filename,
    sizeBytes: buffer.length,
    contentType: groupedMasterTableFixture.contentType,
    buffer,
  };
}
