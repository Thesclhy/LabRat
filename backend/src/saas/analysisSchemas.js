import { stableDataHash } from "./dataPlanSchemas.js";
import { SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";

export const ANALYSIS_PLAN_REVISION_VERSION = "labrat.analysisPlanRevision.v3";
export const ANALYSIS_RUNTIME_VERSION = "labrat-python-v2";
export const ANALYSIS_OUTPUT_TARGETS = Object.freeze({
  CHART: "chart",
  EXPERIMENT_BROWSER: "experiment_browser",
});
export const ANALYSIS_FIELD_ROLES = Object.freeze([
  "identifier",
  "condition",
  "outcome",
  "series_summary",
  "other",
]);
export const ANALYSIS_VALUE_TYPES = Object.freeze([
  "number",
  "string",
  "date",
  "boolean",
]);

const SUPPORTED_ANALYSIS_CHART_TYPES = new Set(SUPPORTED_CHART_TYPES);
const SUPPORTED_ANALYSIS_FIELD_ROLES = new Set(ANALYSIS_FIELD_ROLES);
const SUPPORTED_ANALYSIS_VALUE_TYPES = new Set(ANALYSIS_VALUE_TYPES);
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
    outputTarget: plan.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART,
    sourceSelections: asArray(plan.sourceSelections),
    experimentSelections: asArray(plan.experimentSelections),
    fieldTargets: asArray(plan.fieldTargets),
    reviewPlan: plan.reviewPlan || {},
    displayPlan: asArray(plan.displayPlan),
  });
}

export function validateAnalysisPlanRevision(plan = {}) {
  const errors = [];
  const outputTarget = text(plan.outputTarget) || ANALYSIS_OUTPUT_TARGETS.CHART;
  if (!Object.values(ANALYSIS_OUTPUT_TARGETS).includes(outputTarget)) {
    errors.push(error(
      "analysis_output_target_invalid",
      "Analysis outputTarget must be chart or experiment_browser.",
    ));
  }
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
  if (
    outputTarget === ANALYSIS_OUTPUT_TARGETS.CHART
    && !asArray(plan.sourceSelections).length
  ) {
    errors.push(error(
      "analysis_source_selection_required",
      "The analysis plan must select at least one confirmed workbook range.",
    ));
  }
  if (
    outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
    && !asArray(plan.sourceSelections).length
    && !asArray(plan.experimentSelections).length
  ) {
    errors.push(error(
      "analysis_input_selection_required",
      "An Experiment Browser plan must select workbook ranges or active experiment fields.",
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
  asArray(plan.experimentSelections).forEach((selection, index) => {
    if (!text(selection?.experimentSelectionId) || !text(selection?.experimentId)) {
      errors.push(error(
        "analysis_experiment_selection_invalid",
        "Every active experiment selection requires a stable selection id and experiment id.",
        { selectionIndex: index },
      ));
    }
    if (!Array.isArray(selection?.columnIds)) {
      errors.push(error(
        "analysis_experiment_selection_invalid",
        "Every active experiment selection requires a columnIds array.",
        { selectionIndex: index },
      ));
    }
  });
  const targetIds = new Set();
  const targetSelectors = new Set();
  asArray(plan.fieldTargets).forEach((target, index) => {
    const targetFieldId = text(target?.targetFieldId);
    const kind = text(target?.kind);
    const fieldKey = text(target?.fieldKey);
    const displayName = text(target?.displayName);
    const role = text(target?.role);
    const valueType = text(target?.valueType);
    const selector = `${fieldKey}|${text(target?.unit) || "unitless"}|${valueType}`;
    if (
      !targetFieldId
      || !["source_field", "derived_field"].includes(kind)
      || !fieldKey
      || !displayName
      || !SUPPORTED_ANALYSIS_FIELD_ROLES.has(role)
      || !SUPPORTED_ANALYSIS_VALUE_TYPES.has(valueType)
    ) {
      errors.push(error(
        "analysis_field_target_invalid",
        "Every field target requires a stable id, kind, key, readable name, supported role, and supported value type.",
        { targetIndex: index },
      ));
    }
    if (targetIds.has(targetFieldId)) {
      errors.push(error(
        "analysis_field_target_duplicate",
        "Every field target id must be unique within one plan revision.",
        { targetIndex: index, targetFieldId },
      ));
    }
    if (targetSelectors.has(selector)) {
      errors.push(error(
        "analysis_field_target_duplicate",
        "The same field key, unit, and value type may appear only once in one plan revision.",
        { targetIndex: index, fieldKey },
      ));
    }
    targetIds.add(targetFieldId);
    targetSelectors.add(selector);
    if (kind === "source_field" && (
      !text(target?.sourceField?.regionUnderstandingRevisionId)
      || !text(target?.sourceField?.sourceSelectionId)
      || !text(target?.sourceField?.column)
    )) {
      errors.push(error(
        "analysis_source_field_target_invalid",
        "A source field target must reference one accepted region field inside one source selection.",
        { targetIndex: index, targetFieldId },
      ));
    }
  });
  if (
    outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
    && !asArray(plan.fieldTargets).length
  ) {
    errors.push(error(
      "analysis_field_target_required",
      "An Experiment Browser plan must declare at least one reviewed scalar field target.",
    ));
  }
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
    if (outputTarget === ANALYSIS_OUTPUT_TARGETS.CHART) {
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
    } else {
      const experimentOutput = plan.reviewPlan.experimentOutput || {};
      const browserView = plan.reviewPlan.browserView || {};
      if (!text(experimentOutput.summary) || !text(browserView.summary)) {
        errors.push(error(
          "analysis_experiment_browser_plan_required",
          "An Experiment Browser review plan requires readable data-change and Browser-view summaries.",
        ));
      }
    }
    asArray(plan.reviewPlan.invariants).forEach((invariant, index) => {
      if (outputTarget !== ANALYSIS_OUTPUT_TARGETS.CHART) {
        errors.push(error(
          "analysis_invariant_unsupported",
          "Chart invariants are not valid for Experiment Browser plans.",
          { invariantIndex: index },
        ));
        return;
      }
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
