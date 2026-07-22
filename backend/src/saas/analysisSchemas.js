import { stableDataHash } from "./dataPlanSchemas.js";
import { SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";

export const ANALYSIS_PLAN_REVISION_VERSION = "labrat.analysisPlanRevision.v1";
export const ANALYSIS_RUNTIME_VERSION = "labrat-python-v1";
const SUPPORTED_ANALYSIS_CHART_TYPES = new Set(SUPPORTED_CHART_TYPES);

const FORBIDDEN_RESULT_KEYS = new Set([
  "data",
  "resultRows",
  "results",
  "rows",
  "traces",
  "values",
  "xValues",
  "yValues",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function error(code, message, details = {}) {
  return { code, message, ...details };
}

function containsResultPayload(value, key = "") {
  if (FORBIDDEN_RESULT_KEYS.has(key) && Array.isArray(value)) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsResultPayload(item));
  return Object.entries(value).some(([childKey, childValue]) => containsResultPayload(childValue, childKey));
}

export function pythonSourceHash(source) {
  return stableDataHash({ source: String(source || "") });
}

export function frozenPlanHash(plan = {}) {
  return stableDataHash({
    selection: plan.selection || {},
    processingSummary: asArray(plan.processingSummary),
    calculationManifest: plan.calculationManifest || {},
    pythonProgram: plan.pythonProgram || {},
    expectedOutput: plan.expectedOutput || {},
  });
}

export function validateAnalysisPlanRevision(plan = {}) {
  const errors = [];
  if (plan.schemaVersion !== ANALYSIS_PLAN_REVISION_VERSION) {
    errors.push(error(
      "analysis_plan_schema_invalid",
      `AnalysisPlanRevision schemaVersion must be ${ANALYSIS_PLAN_REVISION_VERSION}.`,
    ));
  }
  if (!["draft", "awaiting_review"].includes(text(plan.status))) {
    errors.push(error("analysis_plan_status_invalid", "AnalysisPlanRevision status must be draft or awaiting_review."));
  }
  if (!text(plan.requestSummary)) {
    errors.push(error("analysis_request_summary_required", "A reviewable request summary is required."));
  }
  if (!text(plan.selection?.selectionId)
    || !text(plan.selection?.dependencyHash)
    || !text(plan.selection?.selectionHash)
    || !asArray(plan.selection?.experimentIds).length
    || !asArray(plan.selection?.fieldIds).length) {
    errors.push(error(
      "analysis_selection_required",
      "Analysis plans require a resolved selection id, hashes, experiments, and fields.",
    ));
  }
  if (!asArray(plan.processingSummary).length) {
    errors.push(error("analysis_processing_summary_required", "A visible processing summary is required."));
  }

  const manifest = plan.calculationManifest || {};
  if (!asArray(manifest.inputs).length) {
    errors.push(error("analysis_manifest_inputs_required", "The calculation manifest requires at least one input."));
  }
  if (!manifest.missingValuePolicy || !text(manifest.missingValuePolicy.mode)) {
    errors.push(error(
      "analysis_missing_value_policy_required",
      "The calculation manifest requires an explicit missing-value policy.",
    ));
  }

  const program = plan.pythonProgram || {};
  if (program.runtime !== ANALYSIS_RUNTIME_VERSION) {
    errors.push(error(
      "analysis_runtime_unsupported",
      `Python runtime must be ${ANALYSIS_RUNTIME_VERSION}.`,
    ));
  }
  if (program.entrypoint !== "analyze") {
    errors.push(error("analysis_entrypoint_invalid", "Python entrypoint must be analyze."));
  }
  if (!text(program.source) || !/\bdef\s+analyze\s*\(/.test(program.source)) {
    errors.push(error("analysis_python_source_invalid", "Python source must define analyze(tables, labrat)."));
  }
  if (text(program.sourceHash) !== pythonSourceHash(program.source)) {
    errors.push(error("analysis_python_hash_mismatch", "Python sourceHash does not match the exact source."));
  }

  if (!text(plan.expectedOutput?.shape) || !text(plan.expectedOutput?.chartType)) {
    errors.push(error(
      "analysis_expected_output_required",
      "Expected output shape and chart type are required.",
    ));
  } else if (text(plan.expectedOutput.shape) !== "experiment_traces") {
    errors.push(error(
      "analysis_output_shape_unsupported",
      "Analysis expectedOutput.shape must be experiment_traces.",
    ));
  }
  if (
    text(plan.expectedOutput?.chartType)
    && !SUPPORTED_ANALYSIS_CHART_TYPES.has(text(plan.expectedOutput.chartType))
  ) {
    errors.push(error(
      "analysis_chart_type_unsupported",
      `Analysis chart type must be one of ${[...SUPPORTED_ANALYSIS_CHART_TYPES].join(", ")}.`,
    ));
  }
  if (
    !text(plan.expectedOutput?.xField)
    || !asArray(plan.expectedOutput?.yFields).map(text).filter(Boolean).length
  ) {
    errors.push(error(
      "analysis_output_encoding_required",
      "Analysis expectedOutput requires one xField and at least one yField.",
    ));
  }
  if (containsResultPayload(plan)) {
    errors.push(error(
      "analysis_result_payload_forbidden",
      "Analysis plans may not embed authoritative result arrays.",
    ));
  }

  return {
    ok: errors.length === 0,
    plan,
    planHash: frozenPlanHash(plan),
    errors,
  };
}
