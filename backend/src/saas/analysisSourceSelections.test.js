import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeCell } from "../import/utils/excelAddress.js";
import {
  analysisSourceSelectionLimits,
  confirmedSourceRegionCatalog,
  inspectConfirmedSourceRange,
  inspectRunInput,
  materializeAnalysisInputs,
  resolveAnalysisFieldTargets,
  resolveAnalysisSourceSelections,
  sourceFieldCandidatesForRequest,
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

test("resolves Impeller and explicit column K from accepted region semantics", async () => {
  const store = seededWorkbook({ rows: 63, columns: 25 });
  const revision = store.regionUnderstandingRevisions.get("region_revision_1");
  revision.interpretation = {
    semanticType: "experiment_table",
    fields: [{
      column: "A",
      semanticKey: "experiment_id",
      displayName: "Experiment",
      role: "identifier",
      valueType: "string",
      unit: null,
      sourceRefs: [{ sourceType: "excel_cell", sourceDocumentId: "source_1", sheet: "LDPE TEMPLATE", cell: "A1" }],
    }, {
      column: "K",
      semanticKey: "impeller",
      displayName: "Impeller",
      role: "condition",
      valueType: "string",
      unit: null,
      sourceRefs: [{ sourceType: "excel_cell", sourceDocumentId: "source_1", sheet: "LDPE TEMPLATE", cell: "K1" }],
    }],
  };
  const confirmedRegions = await confirmedSourceRegionCatalog({
    store,
    projectId: "project_1",
  });
  assert.deepEqual(
    sourceFieldCandidatesForRequest({
      originalRequest: "Add column K, Impeller, to Experiment Browser.",
      confirmedRegions,
    }).map((item) => [item.column, item.semanticKey, item.matchReason]),
    [["K", "impeller", "explicit_column"]],
  );
  const sourceSelections = await resolveAnalysisSourceSelections({
    store,
    projectId: "project_1",
    sourceSelections: requested("A1:K63"),
  });
  const targets = await resolveAnalysisFieldTargets({
    store,
    projectId: "project_1",
    sourceSelections,
    fieldTargets: [{
      kind: "source_field",
      regionUnderstandingRevisionId: "region_revision_1",
      column: "K",
      fieldKey: "",
      displayName: "",
      role: "",
      valueType: "",
      unit: "",
      description: "Add Impeller to Experiment Browser.",
    }],
  });

  assert.equal(targets[0].targetFieldId, "target_field_1");
  assert.equal(targets[0].fieldKey, "impeller");
  assert.equal(targets[0].displayName, "Impeller");
  assert.equal(targets[0].role, "condition");
  assert.equal(targets[0].valueType, "string");
  assert.equal(targets[0].sourceField.columnOffset, 10);
  assert.equal(targets[0].sourceField.headerSourceRefs[0].cell, "K1");
  assert.equal(targets[0].columnId, "field:impeller:unitless:string");
});

test("deterministically binds a source field target to the unique selected column", async () => {
  const store = seededWorkbook({ rows: 63, columns: 25 });
  store.regionUnderstandingRevisions.get("region_revision_1").interpretation = {
    semanticType: "experiment_table",
    fields: [{
      column: "K",
      semanticKey: "impeller_type",
      displayName: "Impeller",
      role: "condition",
      valueType: "string",
      unit: null,
    }],
  };
  const sourceSelections = await resolveAnalysisSourceSelections({
    store,
    projectId: "project_1",
    sourceSelections: requested("A1:K63"),
  });
  const targets = await resolveAnalysisFieldTargets({
    store,
    projectId: "project_1",
    sourceSelections,
    fieldTargets: [{
      kind: "source_field",
      regionUnderstandingRevisionId: "model_revision_alias",
      column: "Column K",
      fieldKey: "impeller",
      displayName: "Impeller type",
    }],
  });

  assert.equal(targets[0].fieldKey, "impeller_type");
  assert.equal(
    targets[0].sourceField.regionUnderstandingRevisionId,
    "region_revision_1",
  );
  assert.equal(targets[0].sourceField.column, "K");
});

test("does not bind a source field outside the accepted selection", async () => {
  const store = seededWorkbook({ rows: 63, columns: 25 });
  store.regionUnderstandingRevisions.get("region_revision_1").interpretation = {
    semanticType: "experiment_table",
    fields: [{
      column: "K",
      semanticKey: "impeller_type",
      displayName: "Impeller",
      role: "condition",
      valueType: "string",
      unit: null,
    }],
  };
  const sourceSelections = await resolveAnalysisSourceSelections({
    store,
    projectId: "project_1",
    sourceSelections: requested("A1:J63"),
  });

  await assert.rejects(
    resolveAnalysisFieldTargets({
      store,
      projectId: "project_1",
      sourceSelections,
      fieldTargets: [{
        kind: "source_field",
        regionUnderstandingRevisionId: "region_revision_1",
        column: "K",
        fieldKey: "impeller_type",
      }],
    }),
    (error) => error.code === "analysis_source_field_target_invalid"
      && error.details?.matchCount === 0,
  );
});

test("rejects ambiguous source field targets across selected regions", async () => {
  const store = seededWorkbook({ rows: 63, columns: 25 });
  store.regionUnderstandingRevisions.get("region_revision_1").interpretation = {
    semanticType: "experiment_table",
    fields: [{
      column: "K",
      semanticKey: "impeller_type",
      displayName: "Impeller",
      role: "condition",
      valueType: "string",
      unit: null,
    }],
  };
  store.sourceDocuments.set("source_2", {
    id: "source_2",
    projectId: "project_1",
    originalFilename: "Second master.xlsx",
  });
  store.workbookReviewRegions.set("region_2", {
    id: "region_2",
    projectId: "project_1",
    sourceDocumentId: "source_2",
    sheetName: "Sheet1",
    rangeRef: "A1:K63",
    disposition: "active",
    acceptedRevisionId: "region_revision_2",
  });
  store.regionUnderstandingRevisions.set("region_revision_2", {
    id: "region_revision_2",
    projectId: "project_1",
    regionId: "region_2",
    interpretation: {
      semanticType: "experiment_table",
      fields: [{
        column: "K",
        semanticKey: "impeller_type",
        displayName: "Impeller",
        role: "condition",
        valueType: "string",
        unit: null,
      }],
    },
  });
  const sourceSelections = await resolveAnalysisSourceSelections({
    store,
    projectId: "project_1",
    sourceSelections: [
      ...requested("A1:K63"),
      {
        regionUnderstandingRevisionId: "region_revision_2",
        sourceDocumentId: "source_2",
        sheetName: "Sheet1",
        range: "A1:K63",
        label: "Second master",
      },
    ],
  });

  await assert.rejects(
    resolveAnalysisFieldTargets({
      store,
      projectId: "project_1",
      sourceSelections,
      fieldTargets: [{
        kind: "source_field",
        regionUnderstandingRevisionId: "model_revision_alias",
        column: "K",
        fieldKey: "impeller_type",
      }],
    }),
    (error) => error.code === "analysis_source_field_target_invalid"
      && error.details?.matchCount === 2,
  );
});

test("rejects identity columns as Experiment Browser scientific field targets", async () => {
  const store = seededWorkbook({ rows: 10, columns: 3 });
  store.regionUnderstandingRevisions.get("region_revision_1").interpretation = {
    semanticType: "experiment_table",
    fields: [{
      column: "A",
      semanticKey: "experiment_id",
      displayName: "Experiment",
      role: "identifier",
      valueType: "string",
      unit: null,
    }],
  };
  const sourceSelections = await resolveAnalysisSourceSelections({
    store,
    projectId: "project_1",
    sourceSelections: requested("A1:C10"),
  });

  await assert.rejects(
    resolveAnalysisFieldTargets({
      store,
      projectId: "project_1",
      sourceSelections,
      fieldTargets: [{
        kind: "source_field",
        regionUnderstandingRevisionId: "region_revision_1",
        column: "A",
      }],
    }),
    (error) => error.code === "analysis_identity_field_target_invalid",
  );
});
