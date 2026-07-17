import { plotLayout } from "./chartLayout.js";

const SERIES_COLORS = [
  "#0072B2",
  "#D55E00",
  "#009E73",
  "#CC79A7",
  "#E69F00",
  "#56B4E9",
  "#6A3D9A",
  "#666666",
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").trim().replace(/,/g, "").replace(/\s*%\s*$/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function fieldKey(axis, fallback = "") {
  return String(axis?.fieldId || axis?.field || fallback || "").trim();
}

function yAxesFor(spec) {
  return asArray(spec?.yFields).length ? asArray(spec.yFields) : [spec?.y].filter(Boolean);
}

function renderChartType(chartType) {
  if (chartType === "point") return "scatter";
  return chartType || "scatter";
}

function isBarChart(chartType) {
  return ["bar", "grouped_bar", "stacked_bar", "distribution_bar"].includes(chartType);
}

function selectedExperimentIds(chartView = {}) {
  return new Set(asArray(chartView.selectedExperimentIds).map(String).filter(Boolean));
}

function excludedExperimentIds(chartView = {}) {
  return new Set(asArray(chartView.excludedExperimentIds).map(String).filter(Boolean));
}

function includesExperiment(experimentId, chartView = {}) {
  const id = String(experimentId || "");
  const selected = selectedExperimentIds(chartView);
  const excluded = excludedExperimentIds(chartView);
  if (selected.size && !selected.has(id)) return false;
  return !excluded.has(id);
}

function renderStyleFor(spec) {
  const source = isObject(spec?.renderStyle) ? spec.renderStyle : {};
  const excelLike = source.preset === "excel_like";
  return {
    traceMode: source.traceMode || (excelLike ? "lines+markers" : "markers"),
    showLegend: source.showLegend,
    legendPosition: source.legendPosition || "top",
    grid: {
      x: source.grid?.x ?? excelLike,
      y: source.grid?.y ?? true,
      color: source.grid?.color || (excelLike ? "#d9d9d9" : "#e5e7eb"),
    },
    seriesStyles: asArray(source.seriesStyles),
    traces: asArray(source.traces),
  };
}

function styleColor(value) {
  if (!isObject(value)) return null;
  return [value.color, value.line?.color, value.marker?.color]
    .map((candidate) => typeof candidate === "string" ? candidate.trim() : "")
    .find(Boolean) || null;
}

function seriesColor(style, series, index) {
  const targets = new Set([
    series?.seriesId,
    series?.experimentId,
    series?.experimentLabel,
    series?.label,
  ].map((value) => String(value || "")).filter(Boolean));
  const perSeries = style.seriesStyles.find((item) => [
    item?.seriesId,
    item?.experimentId,
    item?.target,
    item?.id,
    item?.label,
    item?.experimentLabel,
  ].some((value) => targets.has(String(value || ""))));
  return styleColor(perSeries) || styleColor(style.traces[index]) || SERIES_COLORS[index % SERIES_COLORS.length];
}

function traceStyle(style, index, series = null) {
  const source = style.traces[index] || style.traces.find((item) => item?.target === "primary") || {};
  const color = seriesColor(style, series, index);
  return {
    name: source.name || null,
    line: { ...(isObject(source.line) ? source.line : {}), color },
    marker: { size: 6, symbol: "circle", ...(isObject(source.marker) ? source.marker : {}), color },
  };
}

function axisOption(spec, axis) {
  return isObject(spec?.axisOptions?.[axis]) ? spec.axisOptions[axis] : {};
}

function axisLayout({ title, option, showgrid, gridcolor, defaultShowgrid }) {
  return {
    title: option.title || title,
    zeroline: false,
    showgrid: showgrid ?? defaultShowgrid,
    gridcolor,
    linecolor: "#111",
    mirror: true,
    ticks: "outside",
    ...(option.scale === "log10" ? { type: "log" } : {}),
    ...(Array.isArray(option.range) && option.range.length === 2 ? { range: option.range } : {}),
    ...(option.tickFormat ? { tickformat: option.tickFormat } : {}),
  };
}

function pointsFromRows(rows, xField, yField) {
  return asArray(rows).flatMap((row) => {
    const values = isObject(row?.values) ? row.values : {};
    const x = numericValue(values[xField] ?? row?.label);
    const y = numericValue(values[yField]);
    return x == null || y == null ? [] : [{ x, y }];
  });
}

export function chartSpecToProposal(chartSpecOrProposal) {
  const value = chartSpecOrProposal || {};
  const baseSpec = isObject(value.spec) ? value.spec : value;
  const draftSpec = isObject(value.chartSpecDraft) ? value.chartSpecDraft : {};
  const spec = { ...draftSpec, ...baseSpec };
  return {
    ...spec,
    chartType: value.chartType || spec.chartType || "scatter",
    title: value.title || spec.title || "Chart",
    layout: value.layout || spec.layout || {},
    warnings: asArray(value.warnings).length ? asArray(value.warnings) : asArray(spec.warnings),
    sourceRefs: asArray(value.sourceRefs).length ? asArray(value.sourceRefs) : asArray(spec.sourceRefs),
  };
}

export function experimentOptionsForChartSpec(chartSpecOrProposal) {
  const spec = chartSpecToProposal(chartSpecOrProposal);
  const options = new Map();
  asArray(spec.series).forEach((series) => {
    const id = String(series?.experimentId || "").trim();
    if (!id || options.has(id)) return;
    options.set(id, {
      id,
      label: series.experimentLabel || series.label || id,
      detail: "",
    });
  });
  asArray(spec.sourceSnapshot?.series).forEach((series) => {
    const id = String(series?.experimentId || "").trim();
    if (!id || options.has(id)) return;
    options.set(id, {
      id,
      label: series.experimentLabel || series.experimentAlias || id,
      detail: "",
    });
  });
  return [...options.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

function sourceSnapshotTraces(spec, chartView, style) {
  const chartType = renderChartType(spec.chartType);
  const xField = fieldKey(spec.x, spec.seriesScope?.xField || "carbon_number");
  const yFields = yAxesFor(spec);
  const snapshotSeries = asArray(spec.sourceSnapshot?.series).filter(isObject);
  if (snapshotSeries.length) {
    const yField = fieldKey(spec.y, spec.seriesScope?.yField || "percentage");
    return snapshotSeries.flatMap((snapshot, index) => {
      const experimentId = String(snapshot.experimentId || "");
      if (!includesExperiment(experimentId, chartView)) return [];
      const points = pointsFromRows(snapshot.rows, xField, yField);
      if (!points.length) return [];
      const series = asArray(spec.series).find((candidate) => (
        candidate?.seriesId === snapshot.seriesId
        || candidate?.experimentId === snapshot.experimentId
      )) || snapshot;
      const styleForTrace = traceStyle(style, index, series);
      return [{
        type: isBarChart(chartType) ? "bar" : "scatter",
        ...(isBarChart(chartType) ? {} : { mode: style.traceMode }),
        name: styleForTrace.name || snapshot.experimentLabel || snapshot.experimentAlias || series.experimentLabel || experimentId || `Series ${index + 1}`,
        x: points.map((point) => point.x),
        y: points.map((point) => point.y),
        line: styleForTrace.line,
        marker: styleForTrace.marker,
      }];
    });
  }

  return yFields.flatMap((axis, index) => {
    const yField = fieldKey(axis, index === 0 ? "percentage" : "");
    const points = pointsFromRows(spec.sourceSnapshot?.rows, xField, yField);
    if (!points.length) return [];
    const styleForTrace = traceStyle(style, index, { label: axis?.label || yField });
    return [{
      type: isBarChart(chartType) ? "bar" : "scatter",
      ...(isBarChart(chartType) ? {} : { mode: style.traceMode }),
      name: styleForTrace.name || axis?.label || spec.title || "Source extract",
      x: points.map((point) => point.x),
      y: points.map((point) => point.y),
      line: styleForTrace.line,
      marker: styleForTrace.marker,
    }];
  });
}

export function makeSourceChartPreview(chartSpecOrProposal, options = {}) {
  const spec = chartSpecToProposal(chartSpecOrProposal);
  const chartType = renderChartType(spec.chartType);
  const style = renderStyleFor(spec);
  const chartView = isObject(options.chartView) ? options.chartView : {};
  const traces = sourceSnapshotTraces(spec, chartView, style);
  const xTitle = [spec.x?.label, spec.x?.unit ? `(${spec.x.unit})` : ""].filter(Boolean).join(" ") || "Value";
  const yTitle = yAxesFor(spec).length > 1
    ? "Value"
    : [spec.y?.label, spec.y?.unit ? `(${spec.y.unit})` : ""].filter(Boolean).join(" ") || "Value";
  return {
    traces,
    layout: plotLayout({
      title: { text: spec.title || "Chart", font: { size: 14 } },
      margin: { l: 48, r: 20, t: 44, b: 44 },
      height: Number(options.height) || Number(spec.layout?.height) || 220,
      ...(Number(options.width) ? { width: Number(options.width) } : {}),
      ...(chartType === "stacked_bar" ? { barmode: "stack" } : {}),
      ...(chartType === "grouped_bar" || chartType === "distribution_bar" ? { barmode: "group" } : {}),
      xaxis: axisLayout({
        title: xTitle,
        option: axisOption(spec, "x"),
        showgrid: style.grid.x,
        gridcolor: style.grid.color,
        defaultShowgrid: false,
      }),
      yaxis: axisLayout({
        title: yTitle,
        option: axisOption(spec, "y"),
        showgrid: style.grid.y,
        gridcolor: style.grid.color,
        defaultShowgrid: true,
      }),
      showlegend: style.showLegend == null ? traces.length > 1 : Boolean(style.showLegend),
      legend: style.legendPosition === "right"
        ? { orientation: "v", y: 1, x: 1.02, xanchor: "left", yanchor: "top" }
        : { orientation: "h", y: 1.08, x: 0.5, xanchor: "center", yanchor: "bottom" },
      ...(isObject(spec.layout) ? spec.layout : {}),
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
