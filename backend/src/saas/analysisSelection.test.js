import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisFieldId,
  compressSourceRefsToRectangles,
  resolveAnalysisSelection,
  resolveExperimentScope,
} from "./analysisSelection.js";

function field(fieldKey, value, {
  displayName = fieldKey,
  unit = null,
  valueType = "number",
  role = "outcome",
  cell = "B2",
} = {}) {
  return {
    fieldKey,
    displayName,
    unit,
    valueType,
    role,
    value,
    formattedValue: value == null ? "" : String(value),
    sourceRefs: [{
      sourceType: "excel_cell",
      sourceDocumentId: "source_1",
      sheet: "Runs",
      cell,
    }],
    warnings: [],
  };
}

function fixture() {
  const historical = {
    id: "snapshot_old",
    projectId: "project_1",
    status: "accepted",
    contentHash: "hash_old",
    dependencyHash: "deps_old",
    experimentRecords: [{
      experimentId: "experiment_1",
      label: "Exp 1 old",
      fields: [field("yield", 10, { unit: "percent" })],
      series: [],
      sourceRefs: [],
    }],
  };
  const active = {
    id: "snapshot_active",
    projectId: "project_1",
    status: "accepted",
    contentHash: "hash_active",
    dependencyHash: "deps_active",
    experimentRecords: [{
      experimentId: "experiment_1",
      label: "Exp 1",
      fields: [
        field("yield", 42, { displayName: "Yield", unit: "percent", cell: "B2" }),
        field("temperature", 250, { displayName: "Temperature", unit: "degC", role: "condition", cell: "C2" }),
      ],
      series: [{
        seriesKey: "rate_over_time",
        label: "Rate over time",
        xField: "time",
        yField: "rate",
        xUnit: "min",
        yUnit: "mol_g_h",
        points: [
          {
            x: 0,
            y: 0.1,
            sourceRefs: [
              { sourceType: "excel_cell", sourceDocumentId: "source_1", sheet: "Rate", cell: "A2" },
              { sourceType: "excel_cell", sourceDocumentId: "source_1", sheet: "Rate", cell: "B2" },
            ],
          },
        ],
        sourceRefs: [{ sourceType: "excel_range", sourceDocumentId: "source_1", sheet: "Rate", range: "A1:B2" }],
        warnings: [],
      }],
      sourceRefs: [{ sourceType: "excel_range", sourceDocumentId: "source_1", sheet: "Runs", range: "A1:C2" }],
      warnings: [],
    }],
  };
  const otherUnit = {
    id: "snapshot_other",
    projectId: "project_1",
    status: "accepted",
    contentHash: "hash_other",
    dependencyHash: "deps_other",
    experimentRecords: [{
      experimentId: "experiment_2",
      label: "Exp 2",
      fields: [
        field("yield", 0.45, { displayName: "Yield", unit: "fraction", cell: "B3" }),
        field("temperature", null, { displayName: "Temperature", unit: "degC", role: "condition", cell: "C3" }),
      ],
      series: [],
      sourceRefs: [],
      warnings: [],
    }],
  };
  return {
    projectId: "project_1",
    dataSnapshots: [historical, active, otherUnit, {
      id: "snapshot_preview",
      projectId: "project_1",
      status: "preview",
      experimentRecords: [],
    }],
    experimentIdentities: [
      { id: "experiment_1", projectId: "project_1", canonicalLabel: "Exp 1", aliases: ["Exp1"] },
      { id: "experiment_2", projectId: "project_1", canonicalLabel: "Exp 2", aliases: ["Exp2"] },
    ],
    experimentSnapshotHeads: [
      { id: "head_1", projectId: "project_1", experimentId: "experiment_1", dataSnapshotId: "snapshot_active", recordIndex: 0 },
      { id: "head_2", projectId: "project_1", experimentId: "experiment_2", dataSnapshotId: "snapshot_other", recordIndex: 0 },
    ],
  };
}

test("resolves only accepted active snapshot heads", () => {
  const yieldPercent = analysisFieldId({ fieldKey: "yield", unit: "percent", valueType: "number" });
  const selection = resolveAnalysisSelection({
    ...fixture(),
    selectionRequest: {
      experimentIds: ["experiment_1"],
      fieldIds: [yieldPercent],
      includeSeries: false,
    },
  });

  assert.deepEqual(selection.experimentIds, ["experiment_1"]);
  assert.equal(selection.records[0].snapshotId, "snapshot_active");
  assert.equal(selection.records[0].fields[0].value, 42);
  assert.equal(JSON.stringify(selection).includes("Exp 1 old"), false);
  assert.match(selection.selectionId, /^analysis_selection_/);
  assert.match(selection.dependencyHash, /^sha256_/);
  assert.match(selection.selectionHash, /^sha256_/);
});

test("keeps incompatible units as separate field catalog entries", () => {
  const selection = resolveAnalysisSelection({
    ...fixture(),
    selectionRequest: { experimentIds: [], fieldIds: [], includeSeries: false },
  });
  const yieldFields = selection.fieldCatalog.filter((item) => item.fieldKey === "yield");

  assert.deepEqual(yieldFields.map((item) => item.unit).sort(), ["fraction", "percent"]);
  assert.equal(new Set(yieldFields.map((item) => item.fieldId)).size, 2);
  assert.deepEqual(yieldFields.map((item) => item.coverage.available).sort(), [1, 1]);
});

test("reports ambiguous aliases instead of silently choosing an experiment", () => {
  const scope = resolveExperimentScope({
    experimentIdentities: [
      { id: "experiment_1", canonicalLabel: "Exp 1", aliases: ["shared"] },
      { id: "experiment_2", canonicalLabel: "Exp 2", aliases: ["shared"] },
    ],
    requestedAliases: ["shared"],
  });

  assert.equal(scope.ok, false);
  assert.equal(scope.errors[0].code, "analysis_experiment_alias_ambiguous");
  assert.deepEqual(scope.experimentIds, []);
});

test("non-contiguous source cells remain separate rectangles", () => {
  const rectangles = compressSourceRefsToRectangles([
    { sourceType: "excel_cell", sourceDocumentId: "source_1", sheet: "Runs", cell: "A2" },
    { sourceType: "excel_cell", sourceDocumentId: "source_1", sheet: "Runs", cell: "A3" },
    { sourceType: "excel_cell", sourceDocumentId: "source_1", sheet: "Runs", cell: "C2" },
  ]);

  assert.deepEqual(rectangles.map((item) => item.range), ["A2:A3", "C2"]);
  assert.equal(rectangles.every((item) => item.sourceDocumentId === "source_1"), true);
});

test("rejects oversized source rectangles before expanding cells", () => {
  assert.throws(
    () => compressSourceRefsToRectangles([{
      sourceType: "excel_range",
      sourceDocumentId: "source_1",
      sheet: "Runs",
      range: "A1:XFD1048576",
    }]),
    (error) => error.code === "analysis_source_rectangle_limit_exceeded",
  );
});

test("selection coverage and bounded series points remain explicit", () => {
  const temperature = analysisFieldId({ fieldKey: "temperature", unit: "degC", valueType: "number" });
  const selection = resolveAnalysisSelection({
    ...fixture(),
    selectionRequest: {
      experimentIds: [],
      fieldIds: [temperature],
      includeSeries: true,
    },
  });

  assert.deepEqual(selection.coverage.fields[temperature], {
    available: 1,
    missing: 1,
    totalExperiments: 2,
  });
  assert.equal(selection.records[0].series[0].points[0].sourceRefs.length, 2);
});
