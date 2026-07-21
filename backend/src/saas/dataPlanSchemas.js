import crypto from "node:crypto";

export const DATA_PLAN_SCHEMA_VERSION = "labrat.dataPlan.v2";
export const DATA_SNAPSHOT_SCHEMA_VERSION = "labrat.dataSnapshot.v2";
export const LEGACY_DATA_PLAN_SCHEMA_VERSION = "labrat.dataPlan.v1";
export const LEGACY_DATA_SNAPSHOT_SCHEMA_VERSION = "labrat.dataSnapshot.v1";

const EXPERIMENT_RECORD_OPERATIONS = new Set([
  "read_table_region",
  "use_row_as_header",
  "bind_experiment_identity",
  "bind_fields",
  "bind_series",
  "select_data_rows",
  "emit_experiment_records",
]);
const FIELD_ROLES = new Set(["identifier", "condition", "outcome", "series_summary", "other"]);
const VALUE_TYPES = new Set(["number", "string", "date", "boolean"]);
const FORBIDDEN_RESULT_KEYS = new Set([
  "experimentRecords",
  "resultRows",
  "points",
  "xValues",
  "yValues",
  "values",
  "results",
  "records",
  "rows",
  "data",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeIdentityAlias(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function error(code, message, details = {}) {
  return { code, message, ...details };
}

export function stableDataHash(value) {
  const canonicalize = (item) => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.keys(item).sort().flatMap((key) => (
      item[key] === undefined ? [] : [[key, canonicalize(item[key])]]
    )));
  };
  return `sha256_${crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

export function validateAcceptedEvidenceInputs(results = []) {
  const errors = [];
  const evidence = asArray(results).map((item, index) => {
    if (item.evidenceStatus !== "accepted" || item.canUseForDataPlan !== true) {
      errors.push(error("evidence_not_accepted", "Only accepted retrieval results can be used for DataPlan.", { index }));
    }
    if (!text(item.sourceDocumentId) || !text(item.sheetName) || !text(item.range)) {
      errors.push(error("missing_source_ref", "Evidence result must include sourceDocumentId, sheetName, and range.", { index }));
    }
    if (!text(item.regionId) || !text(item.regionUnderstandingRevisionId) || !text(item.sourceContentHash)) {
      errors.push(error(
        "missing_region_revision_ref",
        "Evidence result must identify an accepted region revision and its source content hash.",
        { index },
      ));
    }
    return {
      retrievalResultId: text(item.retrievalResultId || item.resultId),
      regionId: text(item.regionId),
      regionUnderstandingRevisionId: text(item.regionUnderstandingRevisionId),
      sourceDocumentId: text(item.sourceDocumentId),
      sheetName: text(item.sheetName),
      range: text(item.range),
      semanticType: text(item.semanticType),
      sourceContentHash: text(item.sourceContentHash),
      evidenceStatus: item.evidenceStatus,
      canUseForDataPlan: item.canUseForDataPlan === true,
    };
  });
  return { ok: errors.length === 0, evidence, errors };
}

export function validateDataPlanDraft(plan = {}) {
  if (plan.schemaVersion === DATA_PLAN_SCHEMA_VERSION || plan.outputShape === "experiment_records") {
    return validateExperimentRecordDataPlan(plan);
  }
  const errors = [];
  if (plan.schemaVersion !== LEGACY_DATA_PLAN_SCHEMA_VERSION) {
    errors.push(error("invalid_schema_version", "DataPlan schemaVersion must be labrat.dataPlan.v1."));
  }
  if (!["draft", "validated"].includes(text(plan.status))) {
    errors.push(error("invalid_status", "DataPlan status must be draft or validated."));
  }
  if (!text(plan.outputShape)) {
    errors.push(error("missing_output_shape", "DataPlan outputShape is required."));
  }
  const evidenceCheck = validateAcceptedEvidenceInputs(plan.sourceEvidence || []);
  errors.push(...evidenceCheck.errors);
  const operations = asArray(plan.operations);
  if (!operations.some((op) => op.op === "read_table_region")) {
    errors.push(error("missing_read_operation", "DataPlan must read a source region."));
  }
  if (!operations.some((op) => op.op === "bind_columns")) {
    errors.push(error("missing_bind_columns", "DataPlan must bind source columns."));
  }
  if (!operations.some((op) => text(op.op).startsWith("emit_"))) {
    errors.push(error("missing_emit_operation", "DataPlan must emit an output shape."));
  }
  return { ok: errors.length === 0, plan, errors };
}

function hasForbiddenResultPayload(value, key = "") {
  if (FORBIDDEN_RESULT_KEYS.has(key)) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenResultPayload(item));
  return Object.entries(value).some(([childKey, childValue]) => hasForbiddenResultPayload(childValue, childKey));
}

function validateExperimentEvidence(sourceEvidence) {
  const errors = [];
  const evidenceKeys = new Set();
  asArray(sourceEvidence).forEach((item, index) => {
    const evidenceKey = text(item?.evidenceKey);
    if (item?.evidenceStatus !== "accepted") {
      errors.push(error("evidence_not_accepted", "Experiment-record DataPlans require accepted region understanding evidence.", { index }));
    }
    if (!evidenceKey || !text(item?.regionId) || !text(item?.regionUnderstandingRevisionId)
      || !text(item?.sourceDocumentId) || !text(item?.sheetName) || !text(item?.range)) {
      errors.push(error("missing_source_ref", "Accepted evidence must identify its region, revision, source document, sheet, and range.", { index }));
    }
    if (!text(item?.sourceContentHash)) {
      errors.push(error("missing_source_content_hash", "Accepted evidence must include the bounded region source content hash.", { index }));
    }
    if (!text(item?.interpretationHash)) {
      errors.push(error("missing_interpretation_hash", "Accepted evidence must include an interpretation hash.", { index }));
    }
    if (evidenceKey && evidenceKeys.has(evidenceKey)) {
      errors.push(error("duplicate_evidence_key", "Each accepted region revision must have one evidence key.", { index, evidenceKey }));
    }
    evidenceKeys.add(evidenceKey);
  });
  if (!asArray(sourceEvidence).length) {
    errors.push(error("accepted_evidence_required", "At least one accepted region understanding revision is required."));
  }
  return { errors, evidenceKeys };
}

function validateFieldBindings(operations, errors) {
  asArray(operations).filter((item) => item?.op === "bind_fields").forEach((operationItem) => {
    asArray(operationItem.fields).forEach((field, index) => {
      if (!text(field?.column) || !text(field?.fieldKey)) {
        errors.push(error("invalid_field_binding", "Each field binding requires a source column and fieldKey.", { evidenceKey: operationItem.evidenceKey, index }));
      }
      if (!FIELD_ROLES.has(text(field?.role))) {
        errors.push(error("invalid_field_role", "Each field binding requires a supported role.", { evidenceKey: operationItem.evidenceKey, index }));
      }
      if (!VALUE_TYPES.has(text(field?.valueType))) {
        errors.push(error("invalid_field_value_type", "Each field binding requires a supported valueType.", { evidenceKey: operationItem.evidenceKey, index }));
      }
      if (asArray(field?.headerSourceRefs).some((sourceRef) => (
        sourceRef?.sourceType !== "excel_cell"
        || !text(sourceRef?.sourceDocumentId)
        || !text(sourceRef?.sheet)
        || !text(sourceRef?.cell)
      ))) {
        errors.push(error("invalid_header_source_ref", "Field header source refs must identify an Excel source document, sheet, and cell.", { evidenceKey: operationItem.evidenceKey, index }));
      }
    });
  });
}

export function validateExperimentRecordDataPlan(plan = {}) {
  const errors = [];
  if (plan.schemaVersion !== DATA_PLAN_SCHEMA_VERSION) {
    errors.push(error("invalid_schema_version", "Experiment-record DataPlan schemaVersion must be labrat.dataPlan.v2."));
  }
  if (!["draft", "validated"].includes(text(plan.status))) {
    errors.push(error("invalid_status", "Experiment-record DataPlan status must be draft or validated."));
  }
  if (plan.task !== "experiment_browser_publish" || plan.outputShape !== "experiment_records") {
    errors.push(error("invalid_experiment_record_task", "Experiment-record DataPlans must target experiment_browser_publish and experiment_records."));
  }
  const evidenceValidation = validateExperimentEvidence(plan.sourceEvidence);
  errors.push(...evidenceValidation.errors);
  if (!asArray(plan.dependencyHashes).length || asArray(plan.dependencyHashes).some((item) => !text(item?.kind) || !text(item?.id) || !text(item?.hash))) {
    errors.push(error("missing_dependency_hashes", "Experiment-record DataPlans require complete dependency hashes."));
  }
  const identityAliases = new Set();
  asArray(plan.identityBindings).forEach((binding, index) => {
    if (!text(binding?.sourceAlias) || !["create", "reuse"].includes(text(binding?.action))) {
      errors.push(error("invalid_identity_binding", "Identity bindings require a source alias and create or reuse action.", { index }));
      return;
    }
    const normalizedAlias = normalizeIdentityAlias(binding.sourceAlias);
    if (identityAliases.has(normalizedAlias)) {
      errors.push(error("duplicate_identity_binding", "One normalized source alias may have only one identity decision.", { index, sourceAlias: binding.sourceAlias }));
    }
    identityAliases.add(normalizedAlias);
    if (binding.action === "create" && !text(binding.identityCandidateKey)) {
      errors.push(error("create_identity_candidate_required", "Create identity bindings require a stable identityCandidateKey.", { index }));
    }
    if (binding.action === "reuse" && !text(binding.experimentIdentityId)) {
      errors.push(error("reuse_identity_required", "Reuse identity bindings require an experimentIdentityId.", { index }));
    }
  });
  const operations = asArray(plan.operations);
  const requiredOperations = [
    "read_table_region",
    "use_row_as_header",
    "bind_experiment_identity",
    "bind_fields",
    "select_data_rows",
    "emit_experiment_records",
  ];
  requiredOperations.forEach((opName) => {
    if (!operations.some((item) => item?.op === opName)) {
      errors.push(error("missing_operation", `Experiment-record DataPlan requires ${opName}.`, { op: opName }));
    }
  });
  operations.forEach((item, index) => {
    if (!EXPERIMENT_RECORD_OPERATIONS.has(text(item?.op))) {
      errors.push(error("unsupported_operation", `Unsupported experiment-record operation: ${text(item?.op) || "unknown"}.`, { index }));
    }
    if (!text(item?.evidenceKey) || !evidenceValidation.evidenceKeys.has(text(item.evidenceKey))) {
      errors.push(error("operation_evidence_not_found", "Every operation must target accepted source evidence.", { index }));
    }
  });
  validateFieldBindings(operations, errors);
  if (hasForbiddenResultPayload(plan)) {
    errors.push(error("forbidden_result_payload", "DataPlans may not embed extracted scientific result arrays."));
  }
  return { ok: errors.length === 0, plan, errors };
}
