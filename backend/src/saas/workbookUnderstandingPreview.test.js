import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkbookUnderstandingPreview } from "./workbookUnderstandingPreview.js";

function columnName(index) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function sourceFixture({ sheetName, rows, workbookName = "fixture.xlsx", cellDetails = {} }) {
  const cells = rows.flatMap((row, rowIndex) => row.map((rawValue, colIndex) => ({
    address: `${columnName(colIndex)}${rowIndex + 1}`,
    row: rowIndex,
    col: colIndex,
    rawValue,
    formattedValue: rawValue == null ? null : String(rawValue),
    type: typeof rawValue === "number" ? "number" : "string",
    ...(cellDetails[`${columnName(colIndex)}${rowIndex + 1}`] || {}),
  })));
  return {
    sourceDocument: {
      id: "source_doc_1",
      fileObjectId: "file_1",
      importRunId: "import_run_1",
      metadata: {
        workbookName,
        sheets: [{
          name: sheetName,
          rowCount: rows.length,
          columnCount: Math.max(...rows.map((row) => row.length)),
        }],
      },
    },
    indexBlobs: [{
      payload: {
        sheets: [{
          name: sheetName,
          rowCount: rows.length,
          columnCount: Math.max(...rows.map((row) => row.length)),
          cellGrid: {
            range: `A1:${columnName(Math.max(...rows.map((row) => row.length)) - 1)}${rows.length}`,
            rowCount: rows.length,
            columnCount: Math.max(...rows.map((row) => row.length)),
            cells,
          },
        }],
      },
    }],
  };
}

function draftRegion({ sheetName, range, semanticType, description = "" }) {
  return {
    draftRegionId: "draft_region_1",
    sourceDocumentId: "source_doc_1",
    sheetName,
    range,
    semanticType,
    description,
  };
}

test("proposes row-oriented experiment identity, fields, units, inclusion, and source refs from bounded cells", () => {
  const fixture = sourceFixture({
    sheetName: "Runs",
    rows: [
      ["Experiment", "Temperature (C)", "Yield (%)"],
      ["Exp1", 250, 31.2],
      ["", 275, 28.4],
      ["Exp2", 260, 35.1],
    ],
  });

  const preview = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({
      sheetName: "Runs",
      range: "A1:C4",
      semanticType: "experiment_table",
      description: "The prose deliberately does not list headers or values.",
    })],
  });

  assert.equal(preview.regions.length, 1);
  const region = preview.regions[0];
  assert.equal(region.sourceRange.range, "A1:C4");
  assert.equal(region.interpretation.experimentAxis, "rows");
  assert.equal(region.interpretation.headerRow, 1);
  assert.equal(region.interpretation.experimentIdColumn, "A");
  assert.equal(region.interpretation.experimentLabel, null);
  assert.deepEqual(region.interpretation.fields.map((field) => [field.column, field.semanticKey, field.role, field.unit]), [
    ["B", "reaction_temperature", "condition", "degC"],
    ["C", "yield", "outcome", "percent"],
  ]);
  assert.deepEqual(region.interpretation.inclusion, {
    startRow: 2,
    endRow: 4,
    skippedRows: [{ rowNumber: 3, reason: "blank_identifier" }],
  });
  assert.deepEqual(region.interpretation.fields[0].sourceRefs, [{
    sourceType: "excel_cell",
    sourceDocumentId: "source_doc_1",
    fileObjectId: "file_1",
    importRunId: "import_run_1",
    sheet: "Runs",
    cell: "B1",
  }]);
  assert.equal(region.inspection.rows.length, 4);
  assert.equal(preview.blockers.length, 0);
});

test("flattens a merged parent header into every leaf field with exact header refs", () => {
  const fixture = sourceFixture({
    sheetName: "Runs",
    rows: [
      ["Experiment", "Selectivity (%)", "", ""],
      ["", "Solid", "Liquid", "Gas"],
      ["Exp1", 92.8, 0.1, 0.35],
      ["Exp2", 92, 0.34, 0.41],
    ],
    cellDetails: {
      B1: { merged: true, mergedRange: "B1:D1" },
    },
  });

  const preview = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({
      sheetName: "Runs",
      range: "A1:D4",
      semanticType: "experiment_table",
      description: "Grouped selectivity experiment table.",
    })],
  });

  const interpretation = preview.regions[0].interpretation;
  assert.equal(interpretation.headerRow, 2);
  assert.equal(interpretation.experimentIdColumn, "A");
  assert.deepEqual(
    interpretation.fields.map((field) => [
      field.column,
      field.semanticKey,
      field.displayName,
      field.unit,
      field.sourceRefs.map((sourceRef) => sourceRef.cell),
    ]),
    [
      ["B", "selectivity_solid", "Selectivity - Solid (%)", "percent", ["B1", "B2"]],
      ["C", "selectivity_liquid", "Selectivity - Liquid (%)", "percent", ["B1", "C2"]],
      ["D", "selectivity_gas", "Selectivity - Gas (%)", "percent", ["B1", "D2"]],
    ],
  );
  assert.deepEqual(interpretation.inclusion, {
    startRow: 3,
    endRow: 4,
    skippedRows: [],
  });
  assert.equal(preview.blockers.length, 0);
});

test("keeps a 600-cell detected master table reviewable through a bounded inspection window", () => {
  const rows = Array.from({ length: 25 }, (_, rowIndex) => (
    Array.from({ length: 24 }, (_, columnIndex) => {
      if (rowIndex === 0) return columnIndex === 0 ? "Experiment" : `Field ${columnIndex + 1}`;
      return columnIndex === 0 ? `Exp${rowIndex}` : rowIndex * 100 + columnIndex;
    })
  ));
  const fixture = sourceFixture({ sheetName: "Master", rows });

  const preview = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({
      sheetName: "Master",
      range: "A1:X25",
      semanticType: "experiment_table",
      description: "master table",
    })],
  });

  const region = preview.regions[0];
  assert.equal(region.sourceRange.range, "A1:X25");
  assert.equal(region.sourceRange.inspectionRange, "A1:X20");
  assert.equal(region.inspection.cellCount, 480);
  assert.equal(region.interpretation.experimentAxis, "rows");
  assert.equal(region.warnings.some((warning) => warning.code === "interpretation_inspection_truncated"), true);
});

test("proposes a region-oriented experiment and XY series from bounded source cells", () => {
  const fixture = sourceFixture({
    sheetName: "Exp33",
    workbookName: "Reaction_Rate_Exp33.xlsx",
    rows: [
      ["Reaction Time (min)", "Reaction Rate (mol/g/h)"],
      [0, 0.1],
      [5, 0.2],
      [10, 0.24],
    ],
  });

  const preview = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({
      sheetName: "Exp33",
      range: "A1:B4",
      semanticType: "reaction_rate_time_series",
      description: "reaction-rate series",
    })],
  });

  const interpretation = preview.regions[0].interpretation;
  assert.equal(interpretation.experimentAxis, "region");
  assert.equal(interpretation.experimentLabel, "Exp33");
  assert.equal(interpretation.experimentIdColumn, null);
  assert.deepEqual(interpretation.series.map((series) => ({
    ...series,
    sourceRefs: series.sourceRefs.map((sourceRef) => sourceRef.cell),
  })), [{
    seriesKey: "reaction_rate_over_time",
    label: "Reaction rate over time",
    xColumn: "A",
    yColumn: "B",
    xSemanticKey: "reaction_time",
    ySemanticKey: "reaction_rate",
    xUnit: "min",
    yUnit: "mol_g_h",
    confidence: 0.94,
    sourceRefs: ["A1", "B1"],
  }]);
  assert.equal(preview.blockers.length, 0);
});

test("preserves validated user corrections when regenerating a preview", () => {
  const fixture = sourceFixture({
    sheetName: "Runs",
    rows: [
      ["Note", "Run", "Observed value (mg/h)"],
      ["batch a", "R-1", 2.1],
      ["batch b", "R-2", 2.4],
      ["exclude", "R-3", 9.9],
    ],
  });

  const preview = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({ sheetName: "Runs", range: "A1:C4", semanticType: "generic_table" })],
    interpretationPatches: [{
      draftRegionId: "draft_region_1",
      experimentAxis: "rows",
      headerRow: 1,
      experimentIdColumn: "B",
      fields: [{
        column: "C",
        semanticKey: "production_rate",
        displayName: "Production rate",
        role: "outcome",
        valueType: "number",
        unit: "mmol_g_h",
      }],
      inclusion: {
        startRow: 2,
        endRow: 4,
        skippedRows: [{ rowNumber: 4, reason: "user_excluded" }],
      },
    }],
  });

  const interpretation = preview.regions[0].interpretation;
  assert.equal(interpretation.experimentAxis, "rows");
  assert.equal(interpretation.experimentIdColumn, "B");
  assert.deepEqual(interpretation.fields.map((field) => ({
    column: field.column,
    semanticKey: field.semanticKey,
    role: field.role,
    unit: field.unit,
  })), [{
    column: "C",
    semanticKey: "production_rate",
    role: "outcome",
    unit: "mmol_g_h",
  }]);
  assert.deepEqual(interpretation.inclusion.skippedRows, [{ rowNumber: 4, reason: "user_excluded" }]);
  assert.equal(interpretation.decisionSource, "user_patch");
});

test("reports blockers when experiment axis or identity binding cannot be resolved", () => {
  const fixture = sourceFixture({
    sheetName: "Mystery",
    rows: [["Temperature"], [80], [90]],
  });

  const preview = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({ sheetName: "Mystery", range: "A1:A3", semanticType: "unknown_region" })],
  });

  assert.equal(preview.regions[0].interpretation.experimentAxis, null);
  assert.deepEqual(preview.blockers.map((blocker) => blocker.code), ["experiment_axis_required"]);
});

test("converts a scoped conversational correction into the same typed interpretation patch", () => {
  const fixture = sourceFixture({
    sheetName: "Runs",
    rows: [
      ["Workbook note", "", ""],
      ["Batch", "Run", "Observed rate (mg/h)"],
      ["a", "R-1", 2.1],
      ["b", "R-2", 2.4],
    ],
  });

  const preview = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({ sheetName: "Runs", range: "A1:C4", semanticType: "generic_table" })],
    message: "Each row is an experiment. Header row 2. Experiment id column B. Column C is an outcome with unit mmol_g_h. Skip row 4.",
    messageTargetDraftRegionIds: ["draft_region_1"],
  });

  const interpretation = preview.regions[0].interpretation;
  assert.equal(interpretation.experimentAxis, "rows");
  assert.equal(interpretation.headerRow, 2);
  assert.equal(interpretation.experimentIdColumn, "B");
  assert.deepEqual(
    interpretation.fields.filter((field) => field.column === "C").map((field) => [field.role, field.unit]),
    [["outcome", "mmol_g_h"]],
  );
  assert.deepEqual(interpretation.inclusion.skippedRows, [{ rowNumber: 4, reason: "user_excluded" }]);
  assert.equal(interpretation.decisionSource, "user_message");
});

test("regenerates field proposals and source refs when the user corrects the header row", () => {
  const fixture = sourceFixture({
    sheetName: "Runs",
    rows: [
      ["Experiment summary", "Temperature", "Result"],
      ["ID", "Temp K", "Y (%)"],
      ["Exp1", 523, 31.2],
      ["Exp2", 533, 35.1],
    ],
  });

  const automatic = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({ sheetName: "Runs", range: "A1:C4", semanticType: "experiment_table" })],
  });
  assert.equal(automatic.regions[0].interpretation.headerRow, 1);

  const preview = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({ sheetName: "Runs", range: "A1:C4", semanticType: "experiment_table" })],
    interpretationPatches: [{
      draftRegionId: "draft_region_1",
      experimentAxis: "rows",
      headerRow: 2,
      experimentIdColumn: "A",
    }],
  });

  const interpretation = preview.regions[0].interpretation;
  assert.equal(interpretation.headerRow, 2);
  assert.deepEqual(interpretation.fields.map((field) => [field.headerCell, field.displayName, field.unit]), [
    ["B2", "Temp K", null],
    ["C2", "Y (%)", "percent"],
  ]);
  assert.equal(interpretation.inclusion.startRow, 3);
});

test("re-reads a bounded source window when the corrected header is outside the initial inspection", () => {
  const rows = Array.from({ length: 40 }, (_, index) => {
    if (index === 29) return ["Experiment", "Temperature (C)", "Yield (%)"];
    if (index >= 30) return [`Exp${index - 29}`, 220 + index, 20 + index / 10];
    return [index === 0 ? "Workbook notes" : "", "", ""];
  });
  const fixture = sourceFixture({ sheetName: "Runs", rows });

  const preview = buildWorkbookUnderstandingPreview({
    ...fixture,
    draftRegions: [draftRegion({ sheetName: "Runs", range: "A1:C40", semanticType: "experiment_table" })],
    interpretationPatches: [{
      draftRegionId: "draft_region_1",
      experimentAxis: "rows",
      headerRow: 30,
      experimentIdColumn: "A",
    }],
  });

  const region = preview.regions[0];
  assert.equal(region.sourceRange.inspectionRange, "A30:C40");
  assert.equal(region.interpretation.headerRow, 30);
  assert.deepEqual(region.interpretation.fields.map((field) => [field.headerCell, field.displayName]), [
    ["B30", "Temperature (C)"],
    ["C30", "Yield (%)"],
  ]);
  assert.equal(region.interpretation.inclusion.startRow, 31);
});
