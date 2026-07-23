import { stableDataHash } from "./dataPlanSchemas.js";
import { SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";

export const ANALYSIS_PLAN_REVISION_VERSION = "labrat.analysisPlanRevision.v2";
export const ANALYSIS_RUNTIME_VERSION = "labrat-python-v2";

const SUPPORTED_ANALYSIS_CHART_TYPES = new Set(SUPPORTED_CHART_TYPES);
const FORBIDDEN_PLAN_KEYS = new Set([
  "pythonProgram",
  "program",
  "result",
  "resultTable",
  "resultRows",
  "traces",
  "plotly",
  "values",
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

function containsForbiddenPayload(value, key = "") {
  if (FORBIDDEN_PLAN_KEYS.has(key)) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenPayload(item));
  return Object.entries(value).some(([childKey, childValue]) => (
    containsForbiddenPayload(childValue, childKey)
  ));
}

export function pythonSourceHash(source) {
  return stableDataHash({ source: String(source || "") });
}

export function frozenPlanHash(plan = {}) {
  return stableDataHash({
    sourceSelections: asArray(plan.sourceSelections),
    reviewPlan: plan.reviewPlan || {},
    displayPlan: asArray(plan.displayPlan),
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
    errors.push(error(
      "analysis_plan_status_invalid",
      "AnalysisPlanRevision status must be draft or awaiting_review.",
    ));
  }
  if (!text(plan.requestSummary)) {
    errors.push(error(
      "analysis_request_summary_required",
      "A reviewable request summary is required.",
    ));
  }
  if (!asArray(plan.sourceSelections).length) {
    errors.push(error(
      "analysis_source_selection_required",
      "The analysis plan must select at least one confirmed workbook range.",
    ));
  }
  asArray(plan.sourceSelections).forEach((selection, index) => {
    if (
      !text(selection?.sourceSelectionId)
      || !text(selection?.regionUnderstandingRevisionId)
      || !text(selection?.sourceDocumentId)
      || !text(selection?.sheetName)
      || !text(selection?.range)
    ) {
      errors.push(error(
        "analysis_source_selection_invalid",
        "Every source selection requires its confirmed revision, workbook, sheet, range, and stable id.",
        { selectionIndex: index },
      ));
    }
  });
  if (!plan.reviewPlan || typeof plan.reviewPlan !== "object" || Array.isArray(plan.reviewPlan)) {
    errors.push(error(
      "analysis_review_plan_required",
      "A structured reviewPlan is required.",
    ));
  } else {
    if (!asArray(plan.reviewPlan.processingSteps).map(text).filter(Boolean).length) {
      errors.push(error(
        "analysis_processing_steps_required",
        "The review plan requires at least one processing step.",
      ));
    }
    const chart = plan.reviewPlan.chart || {};
    if (
      !text(chart.title)
      || !text(chart.chartType)
      || !text(chart.xDescription)
      || !text(chart.yDescription)
    ) {
      errors.push(error(
        "analysis_chart_plan_required",
        "The review plan requires a title, chart type, and readable X/Y descriptions.",
      ));
    } else if (!SUPPORTED_ANALYSIS_CHART_TYPES.has(text(chart.chartType))) {
      errors.push(error(
        "analysis_chart_type_unsupported",
        `Analysis chart type must be one of ${[...SUPPORTED_ANALYSIS_CHART_TYPES].join(", ")}.`,
      ));
    }
    asArray(plan.reviewPlan.invariants).forEach((invariant, index) => {
      if (!["trace_y_sum", "x_group_y_sum"].includes(invariant?.type)) {
        errors.push(error(
          "analysis_invariant_unsupported",
          "Only trace_y_sum and x_group_y_sum invariants are supported by this analysis workflow.",
          { invariantIndex: index },
        ));
        return;
      }
      if (
        !Number.isFinite(Number(invariant.target))
        || !Number.isFinite(Number(invariant.absoluteTolerance))
      ) {
        errors.push(error(
          "analysis_invariant_invalid",
          "An analysis sum invariant requires finite target and absoluteTolerance values.",
          { invariantIndex: index },
        ));
      }
      if (
        invariant?.type === "x_group_y_sum"
        && (
          !Array.isArray(invariant.traceNames)
          || !invariant.traceNames.map(text).filter(Boolean).length
        )
      ) {
        errors.push(error(
          "analysis_invariant_invalid",
          "An x_group_y_sum invariant requires at least one readable trace name.",
          { invariantIndex: index },
        ));
      }
    });
  }
  if (!asArray(plan.displayPlan).map(text).filter(Boolean).length) {
    errors.push(error(
      "analysis_display_plan_required",
      "The user-visible analysis plan requires at least one readable step.",
    ));
  }
  if (containsForbiddenPayload(plan)) {
    errors.push(error(
      "analysis_plan_execution_payload_forbidden",
      "Plan revisions may not contain Python, input values, traces, or result payloads.",
    ));
  }
  return {
    ok: errors.length === 0,
    plan,
    planHash: frozenPlanHash(plan),
    errors,
  };
}
