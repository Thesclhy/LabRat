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

export const reactionRateSupplementFixture = {
  fileId: "fixture_reaction_rate_exp30",
  filename: "Reaction_Rate_Exp30.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  sheetName: "Exp30",
};

function blankRows(rowCount, columnCount) {
  return Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
}

function componentDistributionRows({
  range = "P31:BA32",
  label = "Overall tots",
  headers = ["Label", "C1", "C2", "C3", "C4"],
  values = [label, 5, 12.5, 21, 9.5],
  totalColumns = 53,
} = {}) {
  const decoded = XLSX.utils.decode_range(range);
  const rows = blankRows(decoded.e.r + 1, Math.max(totalColumns, decoded.e.c + 1));
  headers.forEach((value, index) => {
    rows[decoded.s.r][decoded.s.c + index] = value;
  });
  values.forEach((value, index) => {
    rows[decoded.s.r + 1][decoded.s.c + index] = value;
  });
  return rows;
}

export const multiSheetOneValidSourceRangeFixture = {
  fileId: "fixture_calculation_exp33_one_valid",
  filename: "Calculation_Exp33_one_valid.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  range: "P31:BA32",
  invalidSheetName: "Notes",
  validSheetName: "Carbon Balance",
  expectedCells: {
    carbon_number: "Q31",
    percentage: "Q32",
  },
  expectedValues: [5, 12.5, 21, 9.5],
};

export const ambiguousSourceRangeFixture = {
  fileId: "fixture_calculation_exp33_ambiguous",
  filename: "Calculation_Exp33_ambiguous.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  range: "P31:BA32",
  validSheetNames: ["Carbon Balance A", "Carbon Balance B"],
};

export const highConfidenceAutoBoxFixture = {
  fileId: "fixture_high_confidence_auto_box",
  filename: "high-confidence-auto-box.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  sheetName: "Runs",
  expectedDraftRegions: [
    { range: "A1:F5", semanticType: "experiment_master_table", confidenceAtLeast: 0.85 },
  ],
  rows: [
    ["Experiment", "Date", "Catalyst", "Temperature (C)", "Reaction Time (min)", "Yield (%)"],
    ["Exp33", "2026-01-03", "Cat A", 240, 30, 12.1],
    ["Exp34", "2026-01-04", "Cat A", 250, 30, 13.4],
    ["Exp35", "2026-01-05", "Cat B", 250, 45, 16.9],
    ["Exp36", "2026-01-06", "Cat B", 260, 45, 18.2],
  ],
};

export const goldenExperimentBrowserFixture = {
  fileId: "fixture_golden_experiment_browser",
  filename: "golden-experiment-browser.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  sheetName: "Runs",
  range: "A1:E7",
  rows: [
    ["Experiment", "Temperature (C)", "Reaction Time (min)", "Yield (%)", "Active"],
    ["ExpA", 240, 30, 12.1, true],
    ["", 245, 30, 12.8, true],
    [],
    ["ExpB", 250, 45, 16.9, true],
    ["ExpC", 260, 45, 18.2, false],
    [],
  ],
  expectedExperimentLabels: ["ExpA", "ExpB", "ExpC"],
  expectedSkippedRows: [3],
};

export const lowConfidenceManualBoxFixture = {
  fileId: "fixture_low_confidence_manual_boxes",
  filename: "low-confidence-manual-boxes.xlsx",
  contentType: EXCEL_CONTENT_TYPE,
  sheetName: "Messy Sheet",
  manualSelections: [
    { range: "P31:BA32", expectedClarification: "region_description_required" },
    { range: "D40:H60", expectedClarification: "region_description_required" },
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

export function createGoldenExperimentBrowserWorkbook() {
  const buffer = workbookBufferFromSheets([{
    name: goldenExperimentBrowserFixture.sheetName,
    rows: goldenExperimentBrowserFixture.rows,
  }]);
  return {
    fileId: goldenExperimentBrowserFixture.fileId,
    filename: goldenExperimentBrowserFixture.filename,
    sizeBytes: buffer.length,
    contentType: goldenExperimentBrowserFixture.contentType,
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

export function createReactionRateSupplementWorkbook() {
  return createReactionRateSupplementWorkbookForExperiment({ expNumber: 30 });
}

export function createReactionRateSupplementWorkbookForExperiment({ expNumber = 30, rateScale = 1 } = {}) {
  const workbook = XLSX.utils.book_new();
  const expLabel = `Exp${Number(expNumber)}`;
  const rows = [
    [expLabel, null, null, null, null, null, null, null, null, null, null, "Data from Sweep", null, null, "Average Rate per Hour", null],
    ["Start Time (min)", "End Time (min)", "Mean Time (min)", "Rate (mol/s)", "Standard Deviation", "Reaction Time (min)", "Time Span (min)", "Adjusted Rate (M/s)", "Concentration (mol/L)", "Adjusted Std. Dev.", null, "# of Hours", "Volume Reduction", null, "# of Hours", "Average Rate (M/s)"],
    ...Array.from({ length: 62 }, (_, index) => {
      const start = Number((2.6 + index * 10).toFixed(2));
      const end = Number((start + (index === 61 ? 3.63 : 10)).toFixed(2));
      const mean = Number(((start + end) / 2).toFixed(2));
      const rate = Number(((0.00037 * rateScale) / (index + 1)).toPrecision(6));
      const adjusted = Number((rate * 2.476).toPrecision(6));
      return [
        start,
        end,
        mean,
        rate,
        Number((rate * 0.01).toPrecision(6)),
        Number((mean - 33.02).toFixed(2)),
        Number((end - start).toFixed(2)),
        adjusted,
        Number((adjusted * 355).toPrecision(6)),
        Number((rate * 0.017).toPrecision(6)),
        null,
        index + 1,
        Number((1 - index * 0.001).toFixed(3)),
        null,
        index + 1,
        Number((adjusted / (index + 1)).toPrecision(6)),
      ];
    }),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!merges"] = ["A1:J1", "L1:M1", "O1:P1"].map((range) => XLSX.utils.decode_range(range));
  worksheet.H3 = { ...worksheet.H3, f: "D3*2.476", v: worksheet.H3.v };
  XLSX.utils.book_append_sheet(workbook, worksheet, expLabel);
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return {
    fileId: expNumber === 30 ? reactionRateSupplementFixture.fileId : `fixture_reaction_rate_exp${Number(expNumber)}`,
    filename: `Reaction_Rate_${expLabel}.xlsx`,
    sizeBytes: buffer.length,
    contentType: reactionRateSupplementFixture.contentType,
    buffer,
  };
}

export function createMultiSheetOneValidSourceRangeWorkbook() {
  const buffer = workbookBufferFromSheets([
    {
      name: multiSheetOneValidSourceRangeFixture.invalidSheetName,
      rows: componentDistributionRows({
        range: multiSheetOneValidSourceRangeFixture.range,
        headers: ["note", "not", "a", "distribution"],
        values: ["", "noise", "", ""],
      }),
    },
    {
      name: multiSheetOneValidSourceRangeFixture.validSheetName,
      rows: componentDistributionRows({
        range: multiSheetOneValidSourceRangeFixture.range,
        values: ["Overall tots", ...multiSheetOneValidSourceRangeFixture.expectedValues],
      }),
    },
  ]);
  return {
    fileId: multiSheetOneValidSourceRangeFixture.fileId,
    filename: multiSheetOneValidSourceRangeFixture.filename,
    sizeBytes: buffer.length,
    contentType: multiSheetOneValidSourceRangeFixture.contentType,
    buffer,
  };
}

export function createAmbiguousSourceRangeWorkbook() {
  const buffer = workbookBufferFromSheets(ambiguousSourceRangeFixture.validSheetNames.map((name, index) => ({
    name,
    rows: componentDistributionRows({
      range: ambiguousSourceRangeFixture.range,
      values: ["Overall tots", 5 + index, 12 + index, 21 + index, 9 + index],
    }),
  })));
  return {
    fileId: ambiguousSourceRangeFixture.fileId,
    filename: ambiguousSourceRangeFixture.filename,
    sizeBytes: buffer.length,
    contentType: ambiguousSourceRangeFixture.contentType,
    buffer,
  };
}

export function createHighConfidenceAutoBoxWorkbook() {
  const buffer = workbookBufferFromSheets([{
    name: highConfidenceAutoBoxFixture.sheetName,
    rows: highConfidenceAutoBoxFixture.rows,
  }]);
  return {
    fileId: highConfidenceAutoBoxFixture.fileId,
    filename: highConfidenceAutoBoxFixture.filename,
    sizeBytes: buffer.length,
    contentType: highConfidenceAutoBoxFixture.contentType,
    buffer,
  };
}

export function createLowConfidenceManualBoxWorkbook() {
  const rows = componentDistributionRows({
    range: "P31:BA32",
    headers: ["", "C1?", "C2?", "C3?", "C4?"],
    values: ["maybe totals", 0.1, 0.2, 0.3, 0.4],
  });
  rows[0][0] = "Notes and calculations mixed together";
  rows[6][3] = "manual region candidate";
  rows[39] = rows[39] || [];
  rows[39][3] = "Fragment";
  rows[40] = rows[40] || [];
  rows[40][4] = "needs user description";
  const buffer = workbookBufferFromSheets([{
    name: lowConfidenceManualBoxFixture.sheetName,
    rows,
  }]);
  return {
    fileId: lowConfidenceManualBoxFixture.fileId,
    filename: lowConfidenceManualBoxFixture.filename,
    sizeBytes: buffer.length,
    contentType: lowConfidenceManualBoxFixture.contentType,
    buffer,
  };
}
