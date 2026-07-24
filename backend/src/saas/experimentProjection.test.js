import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExperimentProjection,
  experimentFieldColumnId,
  getExperimentProjectionDetail,
} from "./experimentProjection.js";

function field(fieldKey, value, {
  displayName = fieldKey,
  role = "condition",
  valueType = "number",
  unit = null,
  confidence = 0.9,
  warnings = [],
} = {}) {
  return {
    fieldKey,
    displayName,
    role,
    value,
    formattedValue: value == null ? null : String(value),
    valueType,
    unit,
    confidence,
    warnings,
    sourceRefs: [{ sourceType: "excel_cell", sourceDocumentId: "source_1", sheet: "Runs", cell: "B2" }],
  };
}

function record(experimentId, label, fields, { series = [], warnings = [] } = {}) {
  return {
    experimentId,
    label,
    aliases: [label],
    fields,
    series,
    warnings,
    sourceRefs: [{ sourceType: "excel_range", sourceDocumentId: "source_1", sheet: "Runs", range: "A1:D4" }],
  };
}

function snapshot(id, experimentRecords, status = "accepted") {
  return {
    id,
    projectId: "project_1",
    dataPlanId: `plan_${id}`,
    status,
    contentHash: `hash_${id}`,
    dependencyHash: `deps_${id}`,
    acceptedAt: "2026-07-16T10:00:00.000Z",
    acceptedBy: "user_1",
    experimentRecords,
  };
}

const identities = [
  { id: "exp_1", projectId: "project_1", canonicalLabel: "Exp 1", aliases: ["Exp1"] },
  { id: "exp_2", projectId: "project_1", canonicalLabel: "Exp 2", aliases: ["Exp2"] },
  { id: "exp_3", projectId: "project_1", canonicalLabel: "Exp 3", aliases: ["Exp3"] },
];

function fixture() {
  const old = snapshot("snapshot_old", [
    record("exp_1", "Exp 1", [field("temperature", 200, { displayName: "Temperature", unit: "degC" })]),
  ]);
  const active = snapshot("snapshot_active", [
    record("exp_1", "Exp 1", [
      field("temperature", 250, { displayName: "Temperature (degC)", unit: "degC" }),
      field("yield", 31.2, { displayName: "Yield (%)", role: "outcome", unit: "percent", confidence: 0.95 }),
      field("rpm", 500, { displayName: "RPM", unit: "RPM" }),
    ], {
      series: [{
        seriesKey: "rate_over_time",
        label: "Rate over time",
        xField: "time",
        yField: "rate",
        xUnit: "min",
        yUnit: "mol_g_h",
        points: [{ x: 0, y: 0.1 }, { x: 5, y: 0.2 }],
        warnings: [],
        sourceRefs: [{ sourceType: "excel_range", sourceDocumentId: "source_1", sheet: "Rate", range: "A1:B3" }],
      }],
    }),
    record("exp_2", "Exp 2", [
      field("temperature", 300, { displayName: "Temperature", unit: "K" }),
      field("yield", null, { displayName: "Yield (%)", role: "outcome", unit: "percent", confidence: 0.6, warnings: [{ code: "missing" }] }),
    ], { warnings: [{ code: "review_value", message: "Review this value." }] }),
  ]);
  const third = snapshot("snapshot_third", [
    record("exp_3", "Exp 3", [
      field("temperature", 275, { displayName: "Temperature (degC)", unit: "degC" }),
      field("yield", 44.1, { displayName: "Yield (%)", role: "outcome", unit: "percent" }),
    ]),
  ]);
  return {
    dataSnapshots: [old, active, third, snapshot("snapshot_preview", [], "preview")],
    experimentIdentities: identities,
    experimentSnapshotHeads: [
      { id: "head_1", projectId: "project_1", experimentId: "exp_1", dataSnapshotId: active.id, recordIndex: 0 },
      { id: "head_2", projectId: "project_1", experimentId: "exp_2", dataSnapshotId: active.id, recordIndex: 1 },
      { id: "head_3", projectId: "project_1", experimentId: "exp_3", dataSnapshotId: third.id, recordIndex: 0 },
    ],
  };
}

test("projects one bounded row per active accepted snapshot head with stable unit-aware columns", () => {
  const projection = buildExperimentProjection({ projectId: "project_1", ...fixture(), limit: 20 });

  assert.equal(projection.totalCount, 3);
  assert.equal(projection.rows.length, 3);
  assert.equal(projection.rows.find((row) => row.experimentId === "exp_1").cells[experimentFieldColumnId({ fieldKey: "temperature", unit: "degC", valueType: "number" })].value, 250);
  assert.equal(JSON.stringify(projection.rows).includes("\"points\""), false);
  assert.deepEqual(projection.rows.find((row) => row.experimentId === "exp_1").seriesInventory[0].pointCount, 2);
  assert.equal(projection.rows.find((row) => row.experimentId === "exp_3").cells[experimentFieldColumnId({ fieldKey: "temperature", unit: "K", valueType: "number" })], null);

  const temperatureColumns = projection.columns.filter((column) => column.fieldKey === "temperature");
  assert.deepEqual(temperatureColumns.map((column) => column.unit).sort(), ["K", "degC"]);
  assert.equal(temperatureColumns.find((column) => column.unit === "degC").label, "Temperature (degC)");
  assert.equal(projection.columns.find((column) => column.fieldKey === "yield").label, "Yield (%)");
  assert.equal(projection.columns.find((column) => column.fieldKey === "rpm").label, "RPM");
  assert.equal(new Set(projection.columns.map((column) => column.id)).size, projection.columns.length);
  assert.equal(projection.columns[0].id, "experiment");
  assert.equal(projection.columns[0].pinned, true);
});

test("recommends deterministic high-coverage outcome and condition fields while penalizing warnings", () => {
  const first = buildExperimentProjection({ projectId: "project_1", ...fixture(), limit: 20 });
  const second = buildExperimentProjection({ projectId: "project_1", ...fixture(), limit: 20 });

  assert.deepEqual(first.columns, second.columns);
  const yieldColumn = first.columns.find((column) => column.fieldKey === "yield");
  const kelvinColumn = first.columns.find((column) => column.unit === "K");
  assert.equal(yieldColumn.recommended, true);
  assert.equal(yieldColumn.coverageCount, 2);
  assert.equal(yieldColumn.warningCount, 1);
  assert.equal(yieldColumn.recommendationScore > kelvinColumn.recommendationScore, true);
});

test("applies search, typed field filters, stable sorting, and opaque cursor pagination", () => {
  const temperatureC = experimentFieldColumnId({ fieldKey: "temperature", unit: "degC", valueType: "number" });
  const first = buildExperimentProjection({
    projectId: "project_1",
    ...fixture(),
    search: "Exp",
    filters: [{ columnId: temperatureC, operator: "gte", value: 250 }],
    sort: [{ columnId: temperatureC, direction: "desc" }],
    limit: 1,
  });
  assert.deepEqual(first.rows.map((row) => row.label), ["Exp 3"]);
  assert.equal(typeof first.nextCursor, "string");

  const second = buildExperimentProjection({
    projectId: "project_1",
    ...fixture(),
    search: "Exp",
    filters: [{ columnId: temperatureC, operator: "gte", value: 250 }],
    sort: [{ columnId: temperatureC, direction: "desc" }],
    cursor: first.nextCursor,
    limit: 1,
  });
  assert.deepEqual(second.rows.map((row) => row.label), ["Exp 1"]);
  assert.equal(second.nextCursor, null);
  assert.equal(second.totalCount, 2);
});

test("returns full active experiment detail lazily and rejects inactive or cross-project ids", () => {
  const detail = getExperimentProjectionDetail({ projectId: "project_1", experimentId: "exp_1", ...fixture() });
  assert.equal(detail.experiment.id, "exp_1");
  assert.equal(detail.record.fields.find((item) => item.fieldKey === "temperature").value, 250);
  assert.equal(detail.record.series[0].points.length, 2);
  assert.equal(detail.dataSnapshot.id, "snapshot_active");
  assert.equal(detail.record.sourceRefs[0].range, "A1:D4");

  assert.equal(getExperimentProjectionDetail({ projectId: "project_1", experimentId: "exp_missing", ...fixture() }), null);
  assert.equal(getExperimentProjectionDetail({ projectId: "project_other", experimentId: "exp_1", ...fixture() }), null);
});
