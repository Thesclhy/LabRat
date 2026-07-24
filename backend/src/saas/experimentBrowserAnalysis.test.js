import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExperimentRecordPatches,
  materializeExperimentInputs,
  validateExperimentBrowserResult,
} from "./experimentBrowserAnalysis.js";
import { MemorySaasStore } from "./memoryStore.js";

function legacyField(fieldKey, value, {
  displayName = fieldKey,
  valueType = "number",
  unit = null,
} = {}) {
  return {
    fieldKey,
    displayName,
    valueType,
    unit,
    role: "condition",
    value,
    formattedValue: String(value),
    sourceRefs: [{
      sourceType: "excel_cell",
      sourceDocumentId: "source_master",
      fileName: "Master.xlsx",
      sheet: "Master",
      cell: "B2",
    }],
  };
}

function fixture() {
  const temperature = legacyField("temperature", 250, {
    displayName: "Temperature",
    unit: "degC",
  });
  const identity = {
    id: "experiment_31",
    projectId: "project_1",
    canonicalLabel: "Exp31",
    aliases: ["Experiment 31"],
  };
  const head = {
    id: "head_31",
    projectId: "project_1",
    experimentId: identity.id,
    dataSnapshotId: "snapshot_1",
    recordIndex: 0,
  };
  const record = {
    experimentId: identity.id,
    label: "Exp31",
    aliases: ["Exp31"],
    fields: [temperature],
    series: [],
    sourceRefs: [],
  };
  const entry = { identity, head, record };
  const activeContext = {
    entries: [entry],
    experimentIdentities: [identity],
    experimentSnapshotHeads: [head],
    entryByExperimentId: new Map([[identity.id, entry]]),
    identityById: new Map([[identity.id, identity]]),
  };
  const inputs = {
    tables: [{
      tableId: "table_master",
      source: {
        sourceDocumentId: "source_master",
        workbookName: "Master.xlsx",
        sheetName: "Master",
      },
      startRow: 1,
      startColumn: 1,
      rowCount: 3,
      columnCount: 3,
      columns: [{
        columnIndex: 0,
        excelColumn: "A",
        sourceHeader: "Experiment",
        valueType: "string",
        unit: null,
      }, {
        columnIndex: 1,
        excelColumn: "B",
        sourceHeader: "Impeller",
        valueType: "string",
        unit: null,
      }, {
        columnIndex: 2,
        excelColumn: "C",
        sourceHeader: null,
        valueType: "number",
        unit: "percent",
      }],
      values: [
        ["Experiment", "Impeller", "Yield"],
        ["Exp31", "flat", 42.5],
        ["Exp32", "helix", "-"],
      ],
      displayValues: [
        ["Experiment", "Impeller", "Yield"],
        ["Exp31", "flat", "42.5"],
        ["Exp32", "helix", "-"],
      ],
      formulas: [[], [], []],
    }],
    experiments: [{
      experimentId: identity.id,
      label: "Exp31",
      fields: [{
        columnIndex: 0,
        displayName: "Temperature",
        valueType: "number",
        unit: "degC",
        value: 250,
        formattedValue: "250",
        sourceRefs: structuredClone(temperature.sourceRefs),
      }],
      series: [],
      activeHead: head,
    }],
  };
  return { activeContext, inputs };
}

function checkedResult({
  columns,
  recordPatches,
  inputs,
  activeContext,
  columnIdFactory = (index) => `generated_${index}`,
  extra = {},
}) {
  return validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    columnIdFactory,
    executorResult: {
      ok: true,
      adapter: "test_executor",
      runtime: { version: "labrat-python-v2" },
      result: {
        columns,
        recordPatches,
        exclusions: [],
        ...extra,
      },
    },
  });
}

function scalar(columnIndex, value, rowOffset, columnOffset, extra = {}) {
  return {
    columnIndex,
    value,
    formattedValue: value == null ? null : String(value),
    confidence: 1,
    warnings: [],
    sources: [{ tableId: "table_master", rowOffset, columnOffset }],
    ...extra,
  };
}

test("61 experiment values share one backend-assigned random column id", () => {
  const { activeContext, inputs } = fixture();
  for (let row = 3; row <= 61; row += 1) {
    inputs.tables[0].values.push([`Exp${row}`, "flat", row]);
    inputs.tables[0].displayValues.push([`Exp${row}`, "flat", String(row)]);
    inputs.tables[0].formulas.push([]);
  }
  inputs.tables[0].rowCount = inputs.tables[0].values.length;
  const recordPatches = Array.from({ length: 61 }, (_, index) => ({
    label: `Exp${index + 1}`,
    values: [scalar(0, "flat", index + 1, 1)],
    upsertSeries: [],
    removeSeries: [],
    warnings: [],
  }));
  let allocationCount = 0;
  const checked = checkedResult({
    columns: [{ displayName: "Impeller", valueType: "string", unit: null }],
    recordPatches,
    inputs,
    activeContext,
    columnIdFactory: () => {
      allocationCount += 1;
      return "column_random_impeller";
    },
  });

  assert.equal(checked.ok, true);
  assert.equal(allocationCount, 1);
  assert.equal(checked.result.previewRecords.length, 61);
  assert.deepEqual(
    [...new Set(checked.result.recordPatches.map((patch) => patch.values[0].columnId))],
    ["column_random_impeller"],
  );
  assert.equal(checked.result.columns[0].columnId, "column_random_impeller");
  assert.equal(checked.result.previewRecords[0].fields.at(-1).value, "flat");
  assert.equal(Object.hasOwn(checked.result.previewRecords[0].fields.at(-1), "semanticKey"), false);
  assert.equal(Object.hasOwn(checked.result.previewRecords[0].fields.at(-1), "role"), false);
});

test("direct string output needs no enum and Browser view is derived by the backend", () => {
  const { activeContext, inputs } = fixture();
  const checked = checkedResult({
    columns: [{ displayName: "Impeller", valueType: "string", unit: null }],
    recordPatches: [{
      label: "Exp31",
      values: [scalar(0, "flat", 1, 1)],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs,
    activeContext,
  });

  assert.equal(checked.ok, true);
  const added = checked.result.previewRecords[0].fields.find(
    (field) => field.columnId === "generated_0",
  );
  assert.equal(added.displayName, "Impeller");
  assert.equal(added.valueType, "string");
  assert.equal(added.value, "flat");
  assert.equal(added.sourceRefs[0].cell, "B2");
  assert.deepEqual(checked.result.browserView.visibleColumnIds, [
    "experiment",
    "generated_0",
  ]);
});

test("duplicate output names remain independent and are source-disambiguated in Browser labels", () => {
  const { activeContext, inputs } = fixture();
  inputs.tables[0].columns[2].sourceHeader = "Impeller";
  inputs.tables[0].columns[2].valueType = "string";
  inputs.tables[0].columns[2].unit = null;
  inputs.tables[0].values[1][2] = "gas-in";
  inputs.tables[0].displayValues[1][2] = "gas-in";
  const checked = checkedResult({
    columns: [
      { displayName: "Impeller", valueType: "string", unit: null },
      { displayName: "Impeller", valueType: "string", unit: null },
    ],
    recordPatches: [{
      label: "Exp31",
      values: [
        scalar(0, "flat", 1, 1),
        scalar(1, "gas-in", 1, 2),
      ],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs,
    activeContext,
    columnIdFactory: (index) => `column_${index + 1}`,
  });

  assert.equal(checked.ok, true);
  assert.deepEqual(checked.result.columns.map((column) => column.columnId), [
    "column_1",
    "column_2",
  ]);
  const duplicateColumns = checked.result.projection.columns.filter(
    (column) => column.displayName === "Impeller",
  );
  assert.equal(duplicateColumns.length, 2);
  duplicateColumns.forEach((column) => assert.match(column.label, /Master\.xlsx/));

  const next = checkedResult({
    columns: [{ displayName: "Impeller", valueType: "string", unit: null }],
    recordPatches: [{
      label: "Exp31",
      values: [scalar(0, "flat", 1, 1)],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs,
    activeContext,
    columnIdFactory: () => "column_from_second_result",
  });
  assert.notEqual(next.result.columns[0].columnId, checked.result.columns[0].columnId);
});

test("blank display names fall back to source headers and safe ordered names", () => {
  const { activeContext, inputs } = fixture();
  const checked = checkedResult({
    columns: [
      { displayName: "", valueType: "string", unit: null },
      { displayName: "", valueType: "number", unit: "percent" },
    ],
    recordPatches: [{
      label: "Exp31",
      values: [
        scalar(0, "flat", 1, 1),
        scalar(1, 42.5, 1, 2),
      ],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs,
    activeContext,
  });

  assert.equal(checked.ok, true);
  assert.deepEqual(checked.result.columns.map((column) => column.displayName), [
    "Impeller",
    "Column 2",
  ]);
});

test("validates nulls, finite values, types, and exact source evidence", () => {
  const { activeContext, inputs } = fixture();
  const valid = checkedResult({
    columns: [
      { displayName: "Yield", valueType: "number", unit: "percent" },
      { displayName: "Impeller", valueType: "string", unit: null },
    ],
    recordPatches: [{
      label: "Exp32",
      values: [
        scalar(0, null, 2, 2, { missingReason: "source_placeholder" }),
        scalar(1, "helix", 2, 1),
      ],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs,
    activeContext,
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.result.summary.missingValueCount, 1);
  assert.equal(valid.result.previewRecords[0].fields[0].sourceRefs[0].rawValue, "-");

  const invalid = checkedResult({
    columns: [
      { displayName: "Yield", valueType: "number", unit: "percent" },
      { displayName: "Flag", valueType: "boolean", unit: null },
    ],
    recordPatches: [{
      label: "Exp31",
      values: [
        scalar(0, Number.POSITIVE_INFINITY, 1, 2),
        scalar(1, "true", 1, 1),
      ],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs,
    activeContext,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.some((item) => item.code === "experiment_patch_numeric_value_invalid"), true);
  assert.equal(invalid.errors.some((item) => item.code === "experiment_patch_boolean_value_invalid"), true);

  const missingType = checkedResult({
    columns: [{ displayName: "Unknown", unit: null }],
    recordPatches: [{
      label: "Exp31",
      values: [scalar(0, "flat", 1, 1)],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs,
    activeContext,
  });
  assert.equal(missingType.ok, false);
  assert.equal(
    missingType.errors.some((item) => item.code === "experiment_output_column_type_invalid"),
    true,
  );
});

test("rejects invalid column indexes, legacy metadata, and forged source cells", () => {
  const { activeContext, inputs } = fixture();
  const checked = checkedResult({
    columns: [{
      displayName: "Yield",
      valueType: "number",
      unit: "percent",
      semanticKey: "yield",
    }],
    recordPatches: [{
      label: "Exp31",
      values: [{
        ...scalar(4, 42.5, 99, 0),
        role: "outcome",
      }],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs,
    activeContext,
  });

  assert.equal(checked.ok, false);
  assert.equal(checked.errors.some((item) => item.code === "experiment_output_column_metadata_forbidden"), true);
  assert.equal(checked.errors.some((item) => item.code === "experiment_patch_column_index_invalid"), true);
  assert.equal(checked.errors.some((item) => item.code === "experiment_patch_field_metadata_forbidden"), true);
  assert.equal(checked.errors.some((item) => item.code === "experiment_patch_source_cell_invalid"), true);

  const legacy = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: {
      ok: true,
      result: {
        columns: [{ displayName: "Yield", valueType: "number", unit: "percent" }],
        recordPatches: [{
          label: "Exp31",
          upsertFields: [],
          upsertSeries: [],
        }],
        exclusions: [],
      },
    },
  });
  assert.equal(
    legacy.errors.some((item) => item.code === "experiment_patch_legacy_field_contract_forbidden"),
    true,
  );
});

test("existing experiment inputs expose ordered indexes and accept index-based sources", async () => {
  const { activeContext, inputs } = fixture();
  const store = new MemorySaasStore();
  store.experimentIdentities.set("experiment_31", activeContext.experimentIdentities[0]);
  store.dataSnapshots.set("snapshot_1", {
    id: "snapshot_1",
    projectId: "project_1",
    status: "accepted",
    experimentRecords: [activeContext.entries[0].record],
  });
  store.experimentSnapshotHeads.set("head_31", activeContext.experimentSnapshotHeads[0]);
  const materialized = await materializeExperimentInputs({
    store,
    projectId: "project_1",
    experimentSelections: [{
      experimentId: "experiment_31",
      columnIndexes: [0],
      includeSeries: false,
    }],
  });

  assert.equal(materialized.experiments[0].fields[0].columnIndex, 0);
  assert.equal(Object.hasOwn(materialized.experiments[0].fields[0], "columnId"), false);
  const checked = checkedResult({
    columns: [{ displayName: "Temperature copy", valueType: "number", unit: "degC" }],
    recordPatches: [{
      label: "Exp31",
      values: [{
        columnIndex: 0,
        value: 250,
        formattedValue: "250",
        confidence: 1,
        warnings: [],
        sources: [{ experimentId: "experiment_31", columnIndex: 0 }],
      }],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs: {
      tables: [],
      experiments: materialized.experiments,
    },
    activeContext,
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.result.previewRecords[0].fields.at(-1).sourceRefs[0].cell, "B2");
});

test("validated random ids survive patch application unchanged", () => {
  const { activeContext, inputs } = fixture();
  const checked = checkedResult({
    columns: [{ displayName: "Impeller", valueType: "string", unit: null }],
    recordPatches: [{
      label: "Exp31",
      values: [scalar(0, "flat", 1, 1)],
      upsertSeries: [],
      removeSeries: [],
      warnings: [],
    }],
    inputs,
    activeContext,
    columnIdFactory: () => "column_persisted",
  });
  const applied = applyExperimentRecordPatches({
    projectId: "project_1",
    result: checked.result,
    activeContext,
    identityResolutions: [],
    identityFactory: () => {
      throw new Error("Existing Exp31 should be reused.");
    },
  });

  assert.equal(applied.experimentRecords[0].fields.at(-1).columnId, "column_persisted");
  assert.equal(applied.experimentRecords[0].baseSnapshotRef.dataSnapshotId, "snapshot_1");
});
