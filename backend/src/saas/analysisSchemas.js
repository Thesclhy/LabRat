import { stableDataHash } from "./dataPlanSchemas.js";
import { SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";

export const ANALYSIS_PLAN_REVISION_VERSION = "labrat.analysisPlanRevision.v4";
export const ANALYSIS_RUNTIME_VERSION = "labrat-python-v2";
export const ANALYSIS_OUTPUT_TARGETS = Object.freeze({
  CHART: "chart",
  EXPERIMENT_BROWSER: "experiment_browser",
});
export const ANALYSIS_INPUT_MODES = Object.freeze({
  EXPERIMENT_BROWSER: "experiment_browser",
  WORKBOOK: "workbook",
});
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
    outputTarget: plan.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART,
    inputMode: plan.inputMode || null,
    sourceSelections: asArray(plan.sourceSelections),
    experimentSelections: asArray(plan.experimentSelections),
    reviewPlan: plan.reviewPlan || {},
    displayPlan: asArray(plan.displayPlan),
  });
}

export function validateAnalysisPlanRevision(plan = {}) {
  const errors = [];
  const outputTarget = text(plan.outputTarget) || ANALYSIS_OUTPUT_TARGETS.CHART;
  const sourceSelections = asArray(plan.sourceSelections);
  const experimentSelections = asArray(plan.experimentSelections);
  const declaredInputMode = text(plan.inputMode);
  const inputMode = declaredInputMode || (
    sourceSelections.length && !experimentSelections.length
      ? ANALYSIS_INPUT_MODES.WORKBOOK
      : experimentSelections.length && !sourceSelections.length
        ? ANALYSIS_INPUT_MODES.EXPERIMENT_BROWSER
        : ""
  );
  if (
    Object.prototype.hasOwnProperty.call(plan, "fieldTargets")
    || Object.prototype.hasOwnProperty.call(plan, "targetFields")
  ) {
    errors.push(error(
      "analysis_plan_field_targets_forbidden",
      "Analysis plans select source data only and cannot define scalar field targets.",
    ));
  }
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
  if (!sourceSelections.length && !experimentSelections.length) {
    errors.push(error(
      "analysis_input_selection_required",
      "An analysis plan must select workbook ranges or active experiment fields.",
    ));
  }
  if (outputTarget === ANALYSIS_OUTPUT_TARGETS.CHART) {
    if (!Object.values(ANALYSIS_INPUT_MODES).includes(inputMode)) {
      errors.push(error(
        "analysis_input_mode_invalid",
        "Chart plans require Experiment Browser or Workbook input mode.",
      ));
    } else if (inputMode === ANALYSIS_INPUT_MODES.EXPERIMENT_BROWSER) {
      if (sourceSelections.length) {
        errors.push(error(
          "analysis_browser_mode_workbook_selection_forbidden",
          "Experiment Browser chart mode cannot include direct workbook ranges.",
        ));
      }
      if (!experimentSelections.length) {
        errors.push(error(
          "analysis_browser_mode_experiment_selection_required",
          "Experiment Browser chart mode requires accepted experiment fields.",
        ));
      }
    } else if (inputMode === ANALYSIS_INPUT_MODES.WORKBOOK) {
      if (experimentSelections.length) {
        errors.push(error(
          "analysis_workbook_mode_experiment_selection_forbidden",
          "Workbook chart mode cannot include Experiment Browser selections.",
        ));
      }
      if (!sourceSelections.length) {
        errors.push(error(
          "analysis_workbook_mode_source_selection_required",
          "Workbook chart mode requires at least one confirmed workbook range.",
        ));
      }
    }
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
    if (!Array.isArray(selection?.columnIndexes)) {
      errors.push(error(
        "analysis_experiment_selection_invalid",
        "Every active experiment selection requires a columnIndexes array.",
        { selectionIndex: index },
      ));
    }
    if (!asArray(selection?.columnIndexes).length && selection?.includeSeries !== true) {
      errors.push(error(
        "analysis_experiment_selection_invalid",
        "An experiment selection must choose at least one column index or include series.",
        { selectionIndex: index },
      ));
    }
    asArray(selection?.columnIndexes).forEach((columnIndex) => {
      if (!Number.isInteger(Number(columnIndex)) || Number(columnIndex) < 0) {
        errors.push(error(
          "analysis_experiment_selection_invalid",
          "Every selected experiment column index must be a non-negative integer.",
          { selectionIndex: index, columnIndex },
        ));
      }
    });
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
