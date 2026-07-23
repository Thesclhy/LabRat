import { plotLayout } from "./chartLayout.js";
import { normalizeChartView } from "./chartView.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function traceId(trace, index) {
  return String(
    trace?.traceId
      || trace?.meta?.labrat?.traceId
      || `trace_${index + 1}`,
  ).trim();
}

export function chartSpecModel(chartSpec) {
  const value = isObject(chartSpec) ? chartSpec : {};
  const spec = isObject(value.spec) ? value.spec : value;
  return {
    ...spec,
    chartType: value.chartType || spec.chartType || "scatter",
    title: value.title || spec.title || "Chart",
    layout: value.layout || spec.layout || {},
    warnings: asArray(value.warnings).length ? asArray(value.warnings) : asArray(spec.warnings),
    sourceRefs: asArray(value.sourceRefs).length ? asArray(value.sourceRefs) : asArray(spec.sourceRefs),
  };
}

export function makeChartSpecPreview(chartSpec, options = {}) {
  const spec = chartSpecModel(chartSpec);
  const chartView = normalizeChartView(chartSpec, options.chartView);
  const visible = new Set(chartView.visibleTraceIds.map(String));
  const plotly = isObject(spec.plotly) ? spec.plotly : {};
  const traces = asArray(plotly.data).flatMap((trace, index) => (
    visible.has(traceId(trace, index)) ? [structuredClone(trace)] : []
  ));
  const sourceLayout = isObject(plotly.layout) ? structuredClone(plotly.layout) : {};
  return {
    traces,
    layout: plotLayout({
      ...sourceLayout,
      ...(Number(options.height) ? { height: Number(options.height) } : {}),
      ...(Number(options.width) ? { width: Number(options.width) } : {}),
      ...(isObject(options.layout) ? options.layout : {}),
    }),
    config: {
      displayModeBar: false,
      staticPlot: true,
      responsive: true,
      ...(options.config || {}),
    },
  };
}
