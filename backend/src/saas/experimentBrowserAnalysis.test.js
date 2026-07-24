import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExperimentRecordPatches,
  validateExperimentBrowserResult,
} from "./experimentBrowserAnalysis.js";
import { experimentFieldColumnId } from "./experimentProjection.js";

function field(fieldKey, value, {
  displayName = fieldKey,
  valueType = "number",
  unit = null,
  role = "condition",
} = {}) {
  return {
    fieldKey,
    displayName,
    valueType,
    unit,
    role,
    value,
    formattedValue: String(value),
    sourceRefs: [{
      sourceType: "excel_cell",
      sourceDocumentId: "source_master",
      sheet: "Master",
      cell: "B2",
    }],
  };
}

function fixture() {
  const temperature = field("temperature", 250, {
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
      tableId: "table_supplement",
      source: {
        sourceDocumentId: "source_supplement",
        sheetName: "Exp31",
      },
      startRow: 1,
      startColumn: 1,
      rowCount: 2,
      columnCount: 2,
      values: [["Yield", "Viscosity"], [42.5, 8.2]],
      displayValues: [["Yield", "Viscosity"], ["42.5", "8.2"]],
    }],
    experiments: [{
      experimentId: identity.id,
      label: "Exp31",
      fields: [{
        ...temperature,
        columnId: experimentFieldColumnId(temperature),
      }],
      series: [],
      activeHead: head,
    }],
  };
  return { activeContext, inputs, temperature };
}

function executorResult(recordPatches, inputs) {
  const targetBySelector = new Map();
  const normalizedPatches = structuredClone(recordPatches).map((patch) => ({
    ...patch,
    upsertFields: (patch.upsertFields || []).map((value) => {
      const existing = value.columnId
        ? inputs.experiments.flatMap((experiment) => experiment.fields || [])
          .find((item) => item.columnId === value.columnId)
        : null;
      const definition = existing || value;
      const selector = [
        definition.fieldKey,
        definition.unit || "unitless",
        definition.valueType,
      ].join("|");
      let target = targetBySelector.get(selector);
      if (!target) {
        target = {
          targetFieldId: `target_field_${targetBySelector.size + 1}`,
          kind: existing ? "derived_field" : "source_field",
          fieldKey: definition.fieldKey,
          displayName: definition.displayName,
          role: definition.role,
          valueType: definition.valueType,
          unit: definition.unit || null,
          description: definition.displayName,
          existingColumnId: existing?.columnId || null,
          columnId: existing?.columnId || experimentFieldColumnId(definition),
          sourceField: null,
        };
        targetBySelector.set(selector, target);
      }
      const {
        fieldKey: _fieldKey,
        displayName: _displayName,
        role: _role,
        valueType: _valueType,
        unit: _unit,
        columnId: _columnId,
        ...output
      } = value;
      return { targetFieldId: target.targetFieldId, ...output };
    }),
  }));
  inputs.targetFields = [...targetBySelector.values()];
  return {
    ok: true,
    adapter: "test_executor",
    runtime: { version: "python-json-v1" },
    result: {
      recordPatches: normalizedPatches,
      browserView: { name: "Updated experiment fields" },
      exclusions: [],
    },
  };
}

test("merges replacement and new fields while preserving untouched experiment data", () => {
  const { activeContext, inputs, temperature } = fixture();
  const checked = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: executorResult([{
      label: "Exp31",
      upsertFields: [{
        fieldKey: "temperature",
        displayName: "Temperature",
        valueType: "number",
        role: "condition",
        unit: "degC",
        value: 260,
        sources: [{
          experimentId: "experiment_31",
          columnId: experimentFieldColumnId(temperature),
        }],
      }, {
        fieldKey: "product_yield",
        displayName: "Product yield",
        valueType: "number",
        role: "outcome",
        unit: "percent",
        value: 42.5,
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 0 }],
      }],
      upsertSeries: [],
    }], inputs),
  });

  assert.equal(checked.ok, true);
  assert.equal(checked.result.summary.changedFieldCount, 1);
  assert.equal(checked.result.summary.newFieldCount, 1);
  assert.equal(checked.result.summary.changedSeriesCount, 0);
  assert.equal(checked.result.summary.newSeriesCount, 0);
  assert.equal(checked.result.previewRecords[0].fields.length, 2);
  assert.equal(
    checked.result.previewRecords[0].fields.find((item) => item.fieldKey === "temperature").value,
    260,
  );
  assert.equal(
    checked.result.previewRecords[0].fields.find((item) => item.fieldKey === "product_yield")
      .sourceRefs[0].cell,
    "A2",
  );
  assert.equal(
    checked.result.previewRecords[0].fields.find((item) => item.fieldKey === "product_yield")
      .sourceRefs[0].rawValue,
    42.5,
  );

  const applied = applyExperimentRecordPatches({
    projectId: "project_1",
    result: checked.result,
    activeContext,
    identityResolutions: [],
    identityFactory: () => {
      throw new Error("Existing Exp31 should be reused.");
    },
  });
  assert.equal(applied.experimentRecords[0].experimentId, "experiment_31");
  assert.equal(applied.experimentRecords[0].fields.length, 2);
  assert.equal(applied.experimentRecords[0].baseSnapshotRef.dataSnapshotId, "snapshot_1");
});

test("uses accepted Impeller metadata while Python returns only a string value", () => {
  const { activeContext, inputs } = fixture();
  inputs.tables[0].values = [["Experiment", "Impeller"], ["Exp31", "flat"]];
  inputs.tables[0].displayValues = [["Experiment", "Impeller"], ["Exp31", "flat"]];
  inputs.targetFields = [{
    targetFieldId: "target_field_1",
    kind: "source_field",
    fieldKey: "impeller",
    displayName: "Impeller",
    role: "condition",
    valueType: "string",
    unit: null,
    description: "Impeller used in each experiment.",
    existingColumnId: null,
    columnId: "field:impeller:unitless:string",
    sourceField: {
      regionUnderstandingRevisionId: "region_revision_1",
      sourceSelectionId: "source_selection_1",
      column: "B",
      headerSourceRefs: [{
        sourceType: "excel_cell",
        sourceDocumentId: "source_supplement",
        sheet: "Exp31",
        cell: "B1",
      }],
    },
  }];
  const checked = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: {
      ok: true,
      adapter: "test_executor",
      result: {
        recordPatches: [{
          label: "Exp31",
          upsertFields: [{
            targetFieldId: "target_field_1",
            value: "flat",
            formattedValue: "flat",
            confidence: 1,
            warnings: [],
            sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 1 }],
          }],
          upsertSeries: [],
        }],
        browserView: {
          visibleColumnIds: ["field:temperature:degC:number"],
        },
        exclusions: [],
      },
    },
  });

  assert.equal(checked.ok, true);
  const impeller = checked.result.previewRecords[0].fields
    .find((item) => item.fieldKey === "impeller");
  assert.equal(impeller.value, "flat");
  assert.equal(impeller.role, "condition");
  assert.equal(impeller.valueType, "string");
  assert.equal(impeller.headerSourceRefs[0].cell, "B1");
  assert.deepEqual(checked.result.browserView.visibleColumnIds, [
    "experiment",
    "field:impeller:unitless:string",
    "field:temperature:degC:number",
  ]);
});

test("rejects Python field metadata and forged source pointers", () => {
  const { activeContext, inputs } = fixture();
  const target = {
    targetFieldId: "target_field_1",
    kind: "derived_field",
    fieldKey: "product_yield",
    displayName: "Product yield",
    role: "outcome",
    valueType: "number",
    unit: "percent",
    description: "Product yield",
    existingColumnId: null,
    columnId: experimentFieldColumnId({
      fieldKey: "product_yield",
      valueType: "number",
      unit: "percent",
    }),
    sourceField: null,
  };
  inputs.targetFields = [target];
  const checked = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: {
      ok: true,
      result: { recordPatches: [{
      label: "Exp31",
      upsertFields: [{
        targetFieldId: target.targetFieldId,
        fieldKey: "forged_metadata",
        value: 42.5,
        sources: [{ tableId: "table_supplement", rowOffset: 99, columnOffset: 0 }],
      }],
      upsertSeries: [],
      }],
      browserView: {},
      exclusions: [] },
    },
  });

  assert.equal(checked.ok, false);
  assert.equal(
    checked.errors.some((item) => item.code === "experiment_patch_field_metadata_forbidden"),
    true,
  );
  assert.equal(
    checked.errors.some((item) => item.code === "experiment_patch_source_cell_invalid"),
    true,
  );
});

test("rejects scalar outputs that are not declared by the accepted plan", () => {
  const { activeContext, inputs } = fixture();
  inputs.targetFields = [{
    targetFieldId: "target_field_1",
    kind: "derived_field",
    fieldKey: "product_yield",
    displayName: "Product yield",
    role: "outcome",
    valueType: "number",
    unit: "percent",
    columnId: "field:product_yield:percent:number",
  }];
  const checked = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: {
      ok: true,
      result: { recordPatches: [{
      label: "Exp31",
      upsertFields: [{
        targetFieldId: "target_field_unknown",
        value: 42.5,
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 0 }],
      }],
      upsertSeries: [],
      }],
      browserView: {},
      exclusions: [] },
    },
  });

  assert.equal(checked.ok, false);
  assert.equal(
    checked.errors.some((item) => item.code === "experiment_patch_field_target_invalid"),
    true,
  );
});

test("accepts source-backed null values for every scalar type and excludes them from coverage", () => {
  const { activeContext, inputs } = fixture();
  inputs.tables[0].values[1][0] = "-";
  inputs.tables[0].displayValues[1][0] = "-";
  const checked = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: executorResult([{
      label: "Exp5",
      upsertFields: ["number", "string", "date", "boolean"].map((valueType) => ({
        fieldKey: `missing_${valueType}`,
        displayName: `Missing ${valueType}`,
        valueType,
        role: "outcome",
        unit: null,
        value: null,
        formattedValue: null,
        missingReason: "source_placeholder",
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 0 }],
      })),
      upsertSeries: [],
    }], inputs),
  });

  assert.equal(checked.ok, true);
  assert.equal(checked.result.summary.experimentCount, 1);
  assert.equal(checked.result.summary.missingValueCount, 4);
  assert.equal(checked.result.summary.missingExperimentCount, 1);
  assert.equal(checked.result.projection.columns[1].coverageCount, 0);
  checked.result.previewRecords[0].fields.forEach((item) => {
    assert.equal(item.value, null);
    assert.equal(item.formattedValue, null);
    assert.equal(item.missingReason, "source_placeholder");
    assert.equal(item.sourceRefs[0].rawValue, "-");
    assert.equal(item.sourceRefs[0].formattedValue, "-");
  });
});

test("distinguishes blank, placeholder, zero, and invalid scalar values", () => {
  const { activeContext, inputs } = fixture();
  inputs.tables[0].values = [
    ["Blank", "Placeholder", "Zero", "NA"],
    [null, "--", 0, "N/A"],
  ];
  inputs.tables[0].displayValues = [
    ["Blank", "Placeholder", "Zero", "NA"],
    ["", "--", "0", "N/A"],
  ];
  inputs.tables[0].columnCount = 4;

  const valid = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: executorResult([{
      label: "Exp5",
      upsertFields: [{
        fieldKey: "blank_value",
        displayName: "Blank value",
        valueType: "number",
        role: "outcome",
        value: null,
        formattedValue: null,
        missingReason: "source_blank",
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 0 }],
      }, {
        fieldKey: "placeholder_value",
        displayName: "Placeholder value",
        valueType: "number",
        role: "outcome",
        value: null,
        formattedValue: null,
        missingReason: "source_placeholder",
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 1 }],
      }, {
        fieldKey: "real_zero",
        displayName: "Real zero",
        valueType: "number",
        role: "outcome",
        value: 0,
        formattedValue: "0",
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 2 }],
      }, {
        fieldKey: "na_value",
        displayName: "NA value",
        valueType: "number",
        role: "outcome",
        value: null,
        formattedValue: null,
        missingReason: "source_placeholder",
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 3 }],
      }],
      upsertSeries: [],
    }], inputs),
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.result.summary.missingValueCount, 3);
  assert.equal(
    valid.result.previewRecords[0].fields.find((item) => item.fieldKey === "real_zero").value,
    0,
  );

  const invalid = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: executorResult([{
      label: "Exp6",
      upsertFields: [{
        fieldKey: "missing_reason",
        displayName: "Missing reason",
        valueType: "number",
        role: "outcome",
        value: null,
        formattedValue: null,
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 0 }],
      }, {
        fieldKey: "wrong_reason",
        displayName: "Wrong reason",
        valueType: "number",
        role: "outcome",
        value: null,
        formattedValue: null,
        missingReason: "source_placeholder",
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 2 }],
      }, {
        fieldKey: "dash_string",
        displayName: "Dash string",
        valueType: "number",
        role: "outcome",
        value: "-",
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 1 }],
      }, {
        fieldKey: "not_finite",
        displayName: "Not finite",
        valueType: "number",
        role: "outcome",
        value: Number.POSITIVE_INFINITY,
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 2 }],
      }, {
        fieldKey: "reason_on_value",
        displayName: "Reason on value",
        valueType: "number",
        role: "outcome",
        value: 1,
        missingReason: "source_blank",
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 2 }],
      }],
      upsertSeries: [],
    }], inputs),
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.some((item) => item.code === "experiment_patch_missing_reason_required"), true);
  assert.equal(invalid.errors.some((item) => item.code === "experiment_patch_missing_source_mismatch"), true);
  assert.equal(invalid.errors.filter((item) => item.code === "experiment_patch_numeric_value_invalid").length, 2);
  assert.equal(invalid.errors.some((item) => item.code === "experiment_patch_missing_reason_unexpected"), true);
});

test("preserves an existing non-null value when a patch tries to replace it with null", () => {
  const { activeContext, inputs, temperature } = fixture();
  const checked = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: executorResult([{
      label: "Exp31",
      upsertFields: [{
        columnId: experimentFieldColumnId(temperature),
        value: null,
        formattedValue: null,
        missingReason: "calculation_unavailable",
        sources: [{
          experimentId: "experiment_31",
          columnId: experimentFieldColumnId(temperature),
        }],
      }],
      upsertSeries: [],
    }], inputs),
  });

  assert.equal(checked.ok, false);
  assert.equal(
    checked.errors.some((item) => item.code === "experiment_patch_missing_cannot_replace_value"),
    true,
  );
  assert.equal(checked.result.previewRecords[0].fields[0].value, 250);
});

test("allows a finite number to replace an existing null field", () => {
  const { activeContext, inputs, temperature } = fixture();
  const prior = activeContext.entries[0].record.fields[0];
  prior.value = null;
  prior.formattedValue = null;
  prior.missingReason = "source_placeholder";
  prior.sourceRefs[0].rawValue = "-";
  prior.sourceRefs[0].formattedValue = "-";
  inputs.experiments[0].fields[0] = {
    ...structuredClone(prior),
    columnId: experimentFieldColumnId(temperature),
  };

  const checked = validateExperimentBrowserResult({
    projectId: "project_1",
    activeContext,
    inputs,
    executorResult: executorResult([{
      label: "Exp31",
      upsertFields: [{
        columnId: experimentFieldColumnId(temperature),
        value: 42.5,
        formattedValue: "42.5",
        sources: [{ tableId: "table_supplement", rowOffset: 1, columnOffset: 0 }],
      }],
      upsertSeries: [],
    }], inputs),
  });

  assert.equal(checked.ok, true);
  assert.equal(checked.result.previewRecords[0].fields[0].value, 42.5);
  assert.equal("missingReason" in checked.result.previewRecords[0].fields[0], false);
});
