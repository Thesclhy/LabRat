import { SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";

const ALLOWED_CHART_TYPES = new Set(SUPPORTED_CHART_TYPES);
const ANALYSIS_CHART_SPEC_VERSION = "labrat.chartSpec.v3";
const MAX_ANALYSIS_TRACES = 10_000;
const MAX_ANALYSIS_TRACE_POINTS = 1_000_000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return String(value ?? "").trim();
}

function validationError(code, message, details = undefined) {
  return Object.assign(new Error(message), {
    statusCode: 400,
    code,
    ...(details === undefined ? {} : { details }),
  });
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) {
    throw validationError(
      "invalid_analysis_chart_spec",
      `Analysis-result ChartSpec requires ${field}.`,
      { field },
    );
  }
  return normalized;
}

function traceId(trace, index) {
  return text(trace?.traceId || trace?.meta?.labrat?.traceId || `trace_${index + 1}`);
}

function validateAnalysisResultChartSpec(chartSpec) {
  if (chartSpec.schemaVersion !== ANALYSIS_CHART_SPEC_VERSION) {
    throw validationError(
      "invalid_analysis_chart_spec",
      `Analysis-result ChartSpecs require ${ANALYSIS_CHART_SPEC_VERSION}.`,
    );
  }
  if (chartSpec.status !== "accepted") {
    throw validationError("invalid_analysis_chart_spec", "Analysis-result ChartSpecs must be accepted.");
  }
  if (!ALLOWED_CHART_TYPES.has(chartSpec.chartType)) {
    throw validationError("invalid_chart_spec", `Unsupported chart type ${chartSpec.chartType}.`);
  }
  [
    "analysisThreadId",
    "analysisPlanRevisionId",
    "analysisRunId",
    "analysisResultId",
  ].forEach((field) => requiredText(chartSpec[field], field));
  if (
    !asArray(chartSpec.sourceSelections).length
    && !asArray(chartSpec.experimentSelections).length
  ) {
    throw validationError(
      "invalid_analysis_chart_spec",
      "Analysis-result ChartSpecs require reviewed workbook or experiment selections.",
    );
  }
  if (!isObject(chartSpec.plotly) || !Array.isArray(chartSpec.plotly.data) || !isObject(chartSpec.plotly.layout)) {
    throw validationError(
      "invalid_analysis_chart_spec",
      "Analysis-result ChartSpecs require complete Plotly data and layout.",
    );
  }
  const traces = chartSpec.plotly.data;
  if (!traces.length || traces.length > MAX_ANALYSIS_TRACES) {
    throw validationError(
      "invalid_analysis_chart_spec",
      `Analysis-result ChartSpecs require 1-${MAX_ANALYSIS_TRACES} traces.`,
    );
  }
  const ids = new Set();
  let pointCount = 0;
  traces.forEach((trace, index) => {
    const id = traceId(trace, index);
    if (!id || ids.has(id)) {
      throw validationError(
        "invalid_analysis_chart_spec",
        id ? `Duplicate analysis trace id ${id}.` : "Every Plotly trace requires a stable id.",
      );
    }
    ids.add(id);
    const x = asArray(trace?.x);
    const y = asArray(trace?.y);
    if (!x.length || x.length !== y.length) {
      throw validationError(
        "invalid_analysis_chart_spec",
        `Analysis trace ${id} requires equal non-empty x/y arrays.`,
      );
    }
    pointCount += x.length;
  });
  if (pointCount > MAX_ANALYSIS_TRACE_POINTS) {
    throw validationError(
      "invalid_analysis_chart_spec",
      `Analysis-result ChartSpec contains ${pointCount} points; maximum is ${MAX_ANALYSIS_TRACE_POINTS}.`,
    );
  }
  const catalog = asArray(chartSpec.traceCatalog);
  if (catalog.length !== traces.length) {
    throw validationError(
      "invalid_analysis_chart_spec",
      "The trace catalog must describe every Plotly trace exactly once.",
    );
  }
  catalog.forEach((item, index) => {
    if (item.traceId !== traceId(traces[index], index)) {
      throw validationError(
        "invalid_analysis_chart_spec",
        "Trace catalog order must match Plotly data order.",
        { traceIndex: index },
      );
    }
  });
  const requested = asArray(chartSpec.defaultChartView?.visibleTraceIds);
  const visible = [...new Set(requested.map(text).filter(Boolean))];
  if (!visible.length || visible.length !== requested.length) {
    throw validationError(
      "invalid_analysis_chart_spec",
      "Default visible trace ids must contain at least one unique trace id.",
    );
  }
  const unknown = visible.filter((id) => !ids.has(id));
  if (unknown.length) {
    throw validationError(
      "analysis_chart_trace_unknown",
      "Default chart view references traces outside the complete Plotly result.",
      { unknownTraceIds: unknown },
    );
  }
}

export function validateChartSpecProposal({ proposal } = {}) {
  if (!isObject(proposal)) {
    throw validationError("invalid_chart_spec", "Chart proposal must be an object.");
  }
  if (proposal.origin !== "analysis_result") {
    throw validationError(
      "invalid_analysis_chart_spec",
      "ChartSpecs can only be published from accepted analysis results.",
    );
  }
  const chartSpec = structuredClone(proposal);
  validateAnalysisResultChartSpec(chartSpec);
  return { ok: true, chartSpec };
}
