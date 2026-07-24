import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeCell } from "../import/utils/excelAddress.js";
import {
  analysisSourceSelectionLimits,
  confirmedSourceRegionCatalog,
  inspectConfirmedSourceRange,
  inspectRunInput,
  materializeAnalysisInputs,
  resolveAnalysisSourceSelections,
} from "./analysisSourceSelections.js";
import { MemorySaasStore } from "./memoryStore.js";

function seededWorkbook({ rows = 107, columns = 83 } = {}) {
  const store = new MemorySaasStore();
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const address = encodeCell(row, col);
      cells.push({
        row,
        col,
        address,
        rawValue: row === 68 && col >= 16 && col <= 34 ? col - 15 : `${row + 1}:${col + 1}`,
        formattedValue: row === 68 && col >= 16 && col <= 34 ? String(col - 15) : `${row + 1}:${col + 1}`,
        type: row === 68 && col >= 16 && col <= 34 ? "number" : "string",
      });
    }
  }
  store.sourceDocuments.set("source_1", {
    id: "source_1",
    projectId: "project_1",
    originalFilename: "Calculation Exp33.xlsx",
  });
  store.sourceIndexBlobs.set("blob_1", {
    id: "blob_1",
    sourceDocumentId: "source_1",
    payload: {
      sheets: [{
        name: "LDPE TEMPLATE",
        cellGrid: { cells },
      }],
    },
  });
  store.workbookReviewRegions.set("region_1", {
    id: "region_1",
    projectId: "project_1",
    sourceDocumentId: "source_1",
    sheetName: "LDPE TEMPLATE",
    rangeRef: "A1:CE107",
    disposition: "active",
    acceptedRevisionId: "region_revision_1",
  });
  store.regionUnderstandingRevisions.set("region_revision_1", {
    id: "region_revision_1",
    projectId: "project_1",
    regionId: "region_1",
    summary: ["Carbon distribution and calculation workbook."],
    interpretation: { semanticType: "calculation_table" },
  });
  return store;
}

function requested(range = "Q69:AI69") {
  return [{
    regionUnderstandingRevisionId: "region_revision_1",
    sourceDocumentId: "source_1",
    sheetName: "LDPE TEMPLATE",
    range,
    label: "Exp33 carbon distribution",
  }];
}

test("catalogs an 8,881-cell confirmed region without reading it as one payload", async () => {
  const catalog = await confirmedSourceRegionCatalog({
    store: seededWorkbook(),
    projectId: "project_1",
  });

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].range, "A1:CE107");
});

test("model inspection stays paged while an exact subrange resolves inside the confirmed region", async () => {
  const store = seededWorkbook();
  const page = await inspectConfirmedSourceRange({
    store,
    projectId: "project_1",
    regionUnderstandingRevisionId: "region_revision_1",
    range: "Q69:AI69",
  });
  const selections = await resolveAnalysisSourceSelections({
    store,
    projectId: "project_1",
    sourceSelections: requested(),
  });

  assert.equal(page.cellCount, 19);
  assert.equal(page.cells[0].rawValue, 1);
  assert.equal(selections[0].range, "Q69:AI69");
  assert.equal(selections[0].sourceSelectionId, "source_selection_1");
});

test("analysis inspection allows 2,500 cells but rejects larger or unconfirmed ranges", async () => {
  const store = seededWorkbook();
  const page = await inspectConfirmedSourceRange({
    store,
    projectId: "project_1",
    regionUnderstandingRevisionId: "region_revision_1",
    range: "A1:AX50",
  });

  assert.equal(page.cellCount, 2500);
  assert.equal(analysisSourceSelectionLimits.maxInspectionCells, 2500);
  await assert.rejects(
    inspectConfirmedSourceRange({
      store,
      projectId: "project_1",
      regionUnderstandingRevisionId: "region_revision_1",
      range: "A1:AY50",
    }),
    (error) => error.code === "source_range_too_large"
      && error.details?.cellCount === 2550
      && error.details?.maxCells === 2500,
  );
  await assert.rejects(
    inspectConfirmedSourceRange({
      store,
      projectId: "project_1",
      regionUnderstandingRevisionId: "region_revision_1",
      range: "A1:CF1",
    }),
    (error) => error.code === "analysis_source_range_outside_confirmed_region",
  );
});

test("materializes selections larger than 2,500 cells by bounded source reads", async () => {
  const inputs = await materializeAnalysisInputs({
    store: seededWorkbook({ rows: 60, columns: 50 }),
    projectId: "project_1",
    sourceSelections: requested("A1:AX60"),
  });

  assert.equal(inputs.tables.length, 1);
  assert.equal(inputs.tables[0].rowCount, 60);
  assert.equal(inputs.tables[0].columnCount, 50);
  assert.equal(inputs.tables[0].values.length * inputs.tables[0].values[0].length, 3000);
  const page = inspectRunInput(inputs, {
    tableId: inputs.tables[0].tableId,
    rowOffset: 5,
    rowLimit: 3,
    columnOffset: 4,
    columnLimit: 2,
  });
  assert.equal(page.values.length, 3);
  assert.equal(page.values[0].length, 2);
  assert.equal(page.page.rowCount, 60);
  assert.equal(page.page.columnCount, 50);
});

test("one source selection becomes one Python input table across multiple workbooks", async () => {
  const store = seededWorkbook({ rows: 4, columns: 4 });
  store.sourceDocuments.set("source_2", {
    id: "source_2",
    projectId: "project_1",
    originalFilename: "Calculation Exp32.xlsx",
  });
  store.sourceIndexBlobs.set("blob_2", {
    id: "blob_2",
    sourceDocumentId: "source_2",
    payload: {
      sheets: [{
        name: "Carbon",
        cellGrid: {
          cells: [{ row: 0, col: 0, address: "A1", rawValue: 32, formattedValue: "32", type: "number" }],
        },
      }],
    },
  });
  store.workbookReviewRegions.set("region_2", {
    id: "region_2",
    projectId: "project_1",
    sourceDocumentId: "source_2",
    sheetName: "Carbon",
    rangeRef: "A1:D4",
    disposition: "active",
    acceptedRevisionId: "region_revision_2",
  });
  store.regionUnderstandingRevisions.set("region_revision_2", {
    id: "region_revision_2",
    projectId: "project_1",
    regionId: "region_2",
    interpretation: {},
  });

  const inputs = await materializeAnalysisInputs({
    store,
    projectId: "project_1",
    sourceSelections: [
      ...requested("A1:D4"),
      {
        regionUnderstandingRevisionId: "region_revision_2",
        sourceDocumentId: "source_2",
        sheetName: "Carbon",
        range: "A1",
        label: "Exp32",
      },
    ],
  });

  assert.equal(inputs.tables.length, 2);
  assert.deepEqual(inputs.tables.map((table) => table.source.workbookName), [
    "Calculation Exp33.xlsx",
    "Calculation Exp32.xlsx",
  ]);
});
