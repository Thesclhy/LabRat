import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_PLAN_SCHEMA_VERSION,
  DATA_SNAPSHOT_SCHEMA_VERSION,
  LEGACY_DATA_PLAN_SCHEMA_VERSION,
  LEGACY_DATA_SNAPSHOT_SCHEMA_VERSION,
  stableDataHash,
  validateAcceptedEvidenceInputs,
  validateDataPlanDraft,
  validateExperimentRecordDataPlan,
} from "./dataPlanSchemas.js";

test("validateAcceptedEvidenceInputs accepts confirmed retrieval results", () => {
  const evidence = validateAcceptedEvidenceInputs([
    {
      resultId: "evidence_result_fact_exp33_rate",
      evidenceStatus: "accepted",
      canUseForDataPlan: true,
      sourceDocumentId: "source_doc_1",
      sheetName: "Exp33",
      range: "A1:P61",
      regionId: "region_exp33_rate",
      regionUnderstandingRevisionId: "region_revision_exp33_rate",
      sourceContentHash: "sha256_source_region",
    },
  ]);

  assert.equal(evidence.ok, true);
  assert.equal(evidence.evidence[0].sourceDocumentId, "source_doc_1");
});

test("validateAcceptedEvidenceInputs rejects unconfirmed suggestions", () => {
  const evidence = validateAcceptedEvidenceInputs([
    {
      resultId: "suggestion_1",
      evidenceStatus: "suggested_unconfirmed",
      canUseForDataPlan: false,
      sourceDocumentId: "source_doc_1",
      sheetName: "Exp33",
      range: "A1:P61",
    },
  ]);

  assert.equal(evidence.ok, false);
  assert.equal(evidence.errors[0].code, "evidence_not_accepted");
});

test("validateDataPlanDraft accepts bounded table-column extraction", () => {
  const plan = validateDataPlanDraft({
    schemaVersion: LEGACY_DATA_PLAN_SCHEMA_VERSION,
    status: "draft",
    task: "chart_data",
    outputShape: "xy_series",
    sourceEvidence: [{
      regionId: "region_exp33_rate",
      regionUnderstandingRevisionId: "region_revision_exp33_rate",
      sourceDocumentId: "source_doc_1",
      sheetName: "Exp33",
      range: "A1:P61",
      sourceContentHash: "sha256_source_region",
      evidenceStatus: "accepted",
      canUseForDataPlan: true,
    }],
    operations: [
      { op: "read_table_region", sourceDocumentId: "source_doc_1", sheetName: "Exp33", range: "A1:P61" },
      { op: "use_row_as_header", rowNumber: 1 },
      { op: "bind_columns", bindings: { x: { column: "A", semanticField: "reaction_time" }, y: { column: "B", semanticField: "reaction_rate" } } },
      { op: "select_data_rows", startRow: 2, endRow: 61 },
      { op: "emit_xy_series", seriesId: "series_exp33", experimentAlias: "Exp33", x: "reaction_time", y: "reaction_rate" },
    ],
  });

  assert.equal(plan.ok, true);
});

test("schema versions are stable", () => {
  assert.equal(DATA_PLAN_SCHEMA_VERSION, "labrat.dataPlan.v2");
  assert.equal(DATA_SNAPSHOT_SCHEMA_VERSION, "labrat.dataSnapshot.v2");
  assert.equal(LEGACY_DATA_PLAN_SCHEMA_VERSION, "labrat.dataPlan.v1");
  assert.equal(LEGACY_DATA_SNAPSHOT_SCHEMA_VERSION, "labrat.dataSnapshot.v1");
});

function experimentRecordPlan(overrides = {}) {
  return {
    schemaVersion: "labrat.dataPlan.v2",
    status: "draft",
    task: "experiment_browser_publish",
    outputShape: "experiment_records",
    sourceEvidence: [{
      evidenceKey: "region_1:revision_1",
      regionId: "region_1",
      regionUnderstandingRevisionId: "revision_1",
      sourceDocumentId: "source_doc_1",
      sourceDocumentIndexVersion: "labrat.sourceIndex.v1",
      sheetName: "Runs",
      range: "A1:C3",
      evidenceStatus: "accepted",
      sourceContentHash: "sha256_source_region",
      interpretationHash: "sha256_interpretation",
    }],
    dependencyHashes: [
      { kind: "region_understanding_revision", id: "revision_1", hash: "sha256_understanding" },
      { kind: "source_document", id: "source_doc_1", hash: "sha256_source" },
    ],
    identityBindings: [{
      sourceAlias: "Exp1",
      action: "create",
      identityCandidateKey: "identity_candidate_exp1",
      experimentIdentityId: null,
    }],
    operations: [
      { op: "read_table_region", evidenceKey: "region_1:revision_1", sourceDocumentId: "source_doc_1", sheetName: "Runs", range: "A1:C3" },
      { op: "use_row_as_header", evidenceKey: "region_1:revision_1", rowNumber: 1 },
      { op: "bind_experiment_identity", evidenceKey: "region_1:revision_1", experimentAxis: "rows", column: "A" },
      { op: "bind_fields", evidenceKey: "region_1:revision_1", fields: [{ column: "B", fieldKey: "temperature", role: "condition", valueType: "number", unit: "degC" }] },
      { op: "select_data_rows", evidenceKey: "region_1:revision_1", startRow: 2, endRow: 3, skippedRows: [] },
      { op: "emit_experiment_records", evidenceKey: "region_1:revision_1" },
    ],
    ...overrides,
  };
}

test("validateExperimentRecordDataPlan accepts accepted typed evidence without result arrays", () => {
  const validation = validateExperimentRecordDataPlan(experimentRecordPlan());

  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
});

test("validateExperimentRecordDataPlan rejects missing dependencies, invalid identity reuse, and embedded results", () => {
  const validation = validateExperimentRecordDataPlan(experimentRecordPlan({
    dependencyHashes: [],
    identityBindings: [{ sourceAlias: "Exp1", action: "reuse", experimentIdentityId: null }],
    experimentRecords: [{ label: "invented", fields: [{ value: 99 }] }],
  }));

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.errors.map((item) => item.code), [
    "missing_dependency_hashes",
    "reuse_identity_required",
    "forbidden_result_payload",
  ]);
});

test("validateExperimentRecordDataPlan rejects duplicate decisions for one normalized source alias", () => {
  const validation = validateExperimentRecordDataPlan(experimentRecordPlan({
    identityBindings: [
      { sourceAlias: "Exp 01", action: "create", identityCandidateKey: "identity_candidate_exp1" },
      { sourceAlias: "exp-01", action: "reuse", experimentIdentityId: "experiment_identity_1" },
    ],
  }));

  assert.equal(validation.ok, false);
  assert.equal(validation.errors.some((item) => item.code === "duplicate_identity_binding"), true);
});

test("stableDataHash canonicalizes object key order without reordering arrays", () => {
  assert.equal(
    stableDataHash({ b: 2, a: { d: 4, c: 3 }, items: [{ z: 1, y: 2 }] }),
    stableDataHash({ items: [{ y: 2, z: 1 }], a: { c: 3, d: 4 }, b: 2 }),
  );
  assert.notEqual(stableDataHash({ items: [1, 2] }), stableDataHash({ items: [2, 1] }));
});

test("validateExperimentRecordDataPlan rejects generically named scientific result payloads", () => {
  for (const property of ["values", "results", "records", "rows", "data"]) {
    const validation = validateExperimentRecordDataPlan(experimentRecordPlan({ [property]: [{ scientificValue: 99 }] }));
    assert.equal(validation.errors.some((item) => item.code === "forbidden_result_payload"), true, property);
  }
});
