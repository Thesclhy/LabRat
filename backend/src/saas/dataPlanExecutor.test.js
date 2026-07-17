import assert from "node:assert/strict";
import test from "node:test";

import { executeExperimentRecordDataSnapshotPreview } from "./dataPlanExecutor.js";

function cell(address, rawValue, type = typeof rawValue) {
  const match = address.match(/^([A-Z]+)(\d+)$/);
  return {
    address,
    row: Number(match[2]) - 1,
    col: match[1].charCodeAt(0) - 65,
    rawValue,
    formattedValue: rawValue == null ? null : String(rawValue),
    type,
  };
}

function evidencePlan({ axis, identity = {}, fields, series = [], range, inclusion, identityBindings }) {
  const evidenceKey = "wu_1:fact_1";
  return {
    schemaVersion: "labrat.dataPlan.v2",
    id: "data_plan_preview_stable",
    status: "draft",
    task: "experiment_browser_publish",
    outputShape: "experiment_records",
    dependencyHash: "sha256_dependency",
    sourceEvidence: [{
      evidenceKey,
      workbookUnderstandingId: "wu_1",
      workbookUnderstandingVersion: 1,
      factId: "fact_1",
      sourceDocumentId: "source_doc_1",
      fileObjectId: "file_1",
      importRunId: "import_1",
      sourceDocumentIndexVersion: "labrat.sourceIndex.v1",
      sheetName: "Runs",
      range,
      evidenceStatus: "accepted",
      interpretationHash: "sha256_interpretation",
    }],
    dependencyHashes: [{ kind: "source_document", id: "source_doc_1", hash: "sha256_source" }],
    identityBindings,
    operations: [
      { op: "read_table_region", evidenceKey, sourceDocumentId: "source_doc_1", sheetName: "Runs", range },
      { op: "use_row_as_header", evidenceKey, rowNumber: 1 },
      { op: "bind_experiment_identity", evidenceKey, experimentAxis: axis, ...identity },
      { op: "bind_fields", evidenceKey, fields },
      ...(series.length ? [{ op: "bind_series", evidenceKey, series }] : []),
      { op: "select_data_rows", evidenceKey, ...inclusion },
      { op: "emit_experiment_records", evidenceKey },
    ],
  };
}

test("executes row-oriented records with typed scalar values, skips, and exact source refs", async () => {
  const dataPlan = evidencePlan({
    axis: "rows",
    identity: { column: "A" },
    range: "A1:E4",
    fields: [
      { column: "B", fieldKey: "temperature", displayName: "Temperature", role: "condition", valueType: "number", unit: "degC", confidence: 0.9 },
      { column: "C", fieldKey: "active", displayName: "Active", role: "condition", valueType: "boolean", unit: null, confidence: 0.8 },
      { column: "D", fieldKey: "run_date", displayName: "Run date", role: "condition", valueType: "date", unit: null, confidence: 0.85 },
      { column: "E", fieldKey: "yield", displayName: "Yield", role: "outcome", valueType: "number", unit: "percent", confidence: 0.95 },
    ],
    inclusion: { startRow: 2, endRow: 4, skippedRows: [{ rowNumber: 4, reason: "blank_identifier" }] },
    identityBindings: [
      { sourceAlias: "Exp2", action: "create", identityCandidateKey: "identity_candidate_exp2", experimentIdentityId: null },
      { sourceAlias: "Exp1", action: "create", identityCandidateKey: "identity_candidate_exp1", experimentIdentityId: null },
    ],
  });
  const rows = [
    [cell("A1", "Experiment"), cell("B1", "Temperature"), cell("C1", "Active"), cell("D1", "Run date"), cell("E1", "Yield")],
    [cell("A2", "Exp2"), cell("B2", 0, "number"), cell("C2", false, "boolean"), { ...cell("D2", 46024, "date"), formattedValue: "1/2/2026" }, cell("E2", null, "blank")],
    [cell("A3", "Exp1"), cell("B3", "not-a-number", "string"), cell("C3", true, "boolean"), cell("D3", "2026-01-01", "date"), cell("E3", 10, "number")],
    [cell("A4", null, "blank"), cell("B4", 99, "number"), cell("C4", true, "boolean"), cell("D4", "2026-01-03", "date"), cell("E4", 99, "number")],
  ];
  const readRangePreview = async () => ({ sheetName: "Runs", range: "A1:E4", rows });

  const first = await executeExperimentRecordDataSnapshotPreview({ dataPlan, readRangePreview });
  const second = await executeExperimentRecordDataSnapshotPreview({ dataPlan, readRangePreview });

  assert.equal(first.schemaVersion, "labrat.dataSnapshot.v2");
  assert.equal(first.status, "preview");
  assert.equal(first.outputShape, "experiment_records");
  assert.deepEqual(first.experimentRecords.map((record) => record.label), ["Exp2", "Exp1"]);
  assert.equal(first.experimentRecords[0].identityCandidateKey, "identity_candidate_exp2");
  assert.deepEqual(first.experimentRecords[0].fields.map((field) => field.value), [0, false, "2026-01-02", null]);
  assert.equal(first.experimentRecords[0].fields[0].sourceRefs[0].cell, "B2");
  assert.equal(first.experimentRecords[0].fields[1].sourceRefs[0].rawValue, false);
  assert.equal(first.experimentRecords[1].fields[0].value, null);
  assert.equal(first.warnings.some((warning) => warning.code === "value_type_mismatch" && warning.fieldKey === "temperature"), true);
  assert.equal(first.includedRowCount, 2);
  assert.deepEqual(first.skippedRows, [{ evidenceKey: "wu_1:fact_1", rowNumber: 4, reason: "blank_identifier" }]);
  assert.equal(first.id, second.id);
  assert.equal(first.previewHash, second.previewHash);
  assert.equal(first.dependencyHash, "sha256_dependency");
});

test("executes one region-oriented record with a typed XY series and constant scalar field", async () => {
  const dataPlan = evidencePlan({
    axis: "region",
    identity: { experimentLabel: "Exp33" },
    range: "A1:C4",
    fields: [
      { column: "A", fieldKey: "reaction_time", displayName: "Time", role: "condition", valueType: "number", unit: "min", confidence: 0.9 },
      { column: "B", fieldKey: "reaction_rate", displayName: "Rate", role: "outcome", valueType: "number", unit: "mol_g_h", confidence: 0.9 },
      { column: "C", fieldKey: "temperature", displayName: "Temperature", role: "condition", valueType: "number", unit: "degC", confidence: 0.9 },
    ],
    series: [{
      seriesKey: "reaction_rate_over_time",
      label: "Reaction rate over time",
      xColumn: "A",
      yColumn: "B",
      xField: "reaction_time",
      yField: "reaction_rate",
      xUnit: "min",
      yUnit: "mol_g_h",
    }],
    inclusion: { startRow: 2, endRow: 4, skippedRows: [{ rowNumber: 4, reason: "blank_data_row" }] },
    identityBindings: [{ sourceAlias: "Exp33", action: "create", identityCandidateKey: "identity_candidate_exp33", experimentIdentityId: null }],
  });
  const rows = [
    [cell("A1", "Time"), cell("B1", "Rate"), cell("C1", "Temperature")],
    [cell("A2", 0), cell("B2", 0.1), cell("C2", 80)],
    [cell("A3", 5), cell("B3", 0.2), cell("C3", 80)],
    [cell("A4", null), cell("B4", null), cell("C4", null)],
  ];

  const snapshot = await executeExperimentRecordDataSnapshotPreview({
    dataPlan,
    readRangePreview: async () => ({ sheetName: "Runs", range: "A1:C4", rows }),
  });

  assert.equal(snapshot.experimentRecords.length, 1);
  const record = snapshot.experimentRecords[0];
  assert.equal(record.label, "Exp33");
  assert.deepEqual(record.fields.map((field) => [field.fieldKey, field.value]), [["temperature", 80]]);
  assert.deepEqual(record.series[0].points.map((point) => [point.x, point.y]), [[0, 0.1], [5, 0.2]]);
  assert.equal(record.series[0].points[0].sourceRefs[0].cell, "A2");
  assert.equal(record.series[0].points[0].sourceRefs[1].cell, "B2");
});

test("chunks production source reads at 500 cells and rejects oversized aggregate plans", async () => {
  const boundedPlan = evidencePlan({
    axis: "region",
    identity: { experimentLabel: "Exp33" },
    range: "A1:J60",
    fields: [{ column: "C", fieldKey: "temperature", displayName: "Temperature", role: "condition", valueType: "number", unit: "degC", confidence: 0.9 }],
    inclusion: { startRow: 2, endRow: 60, skippedRows: [] },
    identityBindings: [{ sourceAlias: "Exp33", action: "create", identityCandidateKey: "identity_candidate_exp33", experimentIdentityId: null }],
  });
  const requestedRanges = [];
  await executeExperimentRecordDataSnapshotPreview({
    dataPlan: boundedPlan,
    readRangePreview: async (request) => {
      requestedRanges.push(request.range);
      return { sheetName: "Runs", range: request.range, rows: [] };
    },
  });
  assert.deepEqual(requestedRanges, ["A1:J50", "A51:J60"]);

  const oversizedPlan = evidencePlan({
    axis: "region",
    identity: { experimentLabel: "Exp33" },
    range: "A1:J5001",
    fields: [{ column: "C", fieldKey: "temperature", displayName: "Temperature", role: "condition", valueType: "number", unit: "degC", confidence: 0.9 }],
    inclusion: { startRow: 2, endRow: 5001, skippedRows: [] },
    identityBindings: [{ sourceAlias: "Exp33", action: "create", identityCandidateKey: "identity_candidate_exp33", experimentIdentityId: null }],
  });
  await assert.rejects(
    executeExperimentRecordDataSnapshotPreview({ dataPlan: oversizedPlan, readRangePreview: async () => ({ rows: [] }) }),
    { code: "source_plan_too_large" },
  );
});
