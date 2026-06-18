import { slug } from "../../import/services/genericImportContext.js";
import { normalizeChartTransforms } from "./chartTransforms.js";

export const CHART_SPEC_VERSION = "labrat.chartSpec.v1.3";
export const CHART_SPEC_V14_VERSION = "labrat.chartSpec.v1.4";
export const SUPPORTED_CHART_TYPES = ["scatter", "point", "bar", "grouped_bar", "stacked_bar", "distribution_bar"];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value)))];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeText(value) {
  return String(value || "").toLowerCase()
    .replace(/[%]/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeChartType(value) {
  const normalized = slug(value || "scatter", "scatter");
  if (normalized === "distribution" || normalized === "distribution_bar" || normalized === "component_distribution") return "distribution_bar";
  if (normalized === "grouped" || normalized === "grouped_bar" || normalized === "group_bar") return "grouped_bar";
  if (normalized === "stacked" || normalized === "stacked_bar" || normalized === "stack_bar") return "stacked_bar";
  if (normalized === "point" || normalized === "dot" || normalized === "point_plot") return "point";
  if (normalized === "bar" || normalized === "column") return "bar";
  return "scatter";
}

export function selectivityComponent(field) {
  const text = normalizeText([
    field?.displayName,
    field?.field,
    field?.canonicalField,
  ].filter(Boolean).join(" "));
  if (!/\bselectivity\b/.test(text)) return null;
  if (/\bgas\b/.test(text)) return "gas";
  if (/\bliquid\b/.test(text)) return "liquid";
  if (/\bsolid\b/.test(text)) return "solid";
  return null;
}

export function carbonNumberComponent(field) {
  const values = [
    field?.displayName,
    field?.field,
    field?.canonicalField,
  ].filter(Boolean).map(String);
  for (const value of values) {
    const compact = value.trim();
    const exact = compact.match(/^c\s*[-_ ]?(\d{1,3})$/i);
    if (exact) return `C${Number(exact[1])}`;
    const labeled = compact.match(/\b(?:carbon|c)[-_ ]*(?:number|no|num)?[-_ ]*(\d{1,3})\b/i);
    if (labeled) return `C${Number(labeled[1])}`;
  }
  return null;
}

export function componentOrder(field) {
  const component = field?.measurementComponent || selectivityComponent(field) || carbonNumberComponent(field);
  const carbon = String(component || "").match(/^C(\d+)$/i);
  if (carbon) return Number(carbon[1]);
  const selectivityOrder = { solid: 1, liquid: 2, gas: 3 };
  return selectivityOrder[component] || null;
}

export function measurementFamily(field) {
  if (selectivityComponent(field)) return "selectivity";
  if (carbonNumberComponent(field)) return "carbon_number_distribution";
  return null;
}

export function chartAliasesForField(field) {
  const component = selectivityComponent(field);
  const text = normalizeText([
    field?.displayName,
    field?.field,
    field?.canonicalField,
  ].filter(Boolean).join(" "));
  const aliases = [
    field?.fieldId,
    field?.field,
    field?.displayName,
    field?.canonicalField,
    field?.semanticRole,
    field?.role,
  ];

  if (component) {
    aliases.push(
      `${component} selectivity`,
      `selectivity ${component}`,
      `${component} sel`,
    );
  }
  const carbonComponent = carbonNumberComponent(field);
  if (carbonComponent) {
    const n = carbonComponent.replace(/^C/i, "");
    aliases.push(
      carbonComponent,
      `carbon ${n}`,
      `carbon number ${n}`,
      "carbon number",
      "c number",
      "c-number",
      "carbon distribution",
      "c-number distribution",
      "liquid carbon distribution",
      "hydrocarbon distribution",
    );
  }
  if (/\bcatalyst\b/.test(text)) aliases.push("catalyst", "catalyst type", "catalyst material");
  if (/\bpolymer\b/.test(text)) aliases.push("polymer", "polymer type", "polymer material");
  if (/\btemperature\b|\btemp\b/.test(text)) aliases.push("temperature", "temp");
  if (/\bpressure\b/.test(text)) aliases.push("pressure");
  if (/\brpm\b|\bspeed\b/.test(text)) aliases.push("rpm", "speed");
  if (/\breaction time\b/.test(text)) aliases.push("reaction time", "time");
  else if (/\bmean time\b/.test(text)) aliases.push("mean time", "time");
  else if (/\bstart time\b/.test(text)) aliases.push("start time", "time");
  else if (/\bend time\b/.test(text)) aliases.push("end time", "time");
  else if (/\btime\b|\bhours?\b|\bhrs?\b/.test(text)) aliases.push("time");
  if (/\badjusted rate\b/.test(text)) aliases.push("adjusted rate");
  if (/\baverage rate\b/.test(text)) aliases.push("average rate", "average rate per hour");
  if (/\brate\b/.test(text) && !/\badjusted\b|\baverage\b/.test(text)) aliases.push("rate", "reaction rate");
  if (/\bexperiment\b|\bexp\b|\blabel\b|\brun\b/.test(text)) aliases.push("experiment", "experiment id", "label", "run");

  return unique(aliases).map(normalizeText).filter(Boolean);
}

export function chartAxis(field) {
  if (!field) return null;
  const sourceIds = unique(asArray(field.sourceIds));
  return {
    fieldId: field.fieldId,
    field: field.canonicalField || field.field,
    label: field.displayName || field.field,
    unit: field.unit || null,
    role: field.role,
    semanticRole: field.semanticRole || null,
    valueType: field.valueType || null,
    sourceIds,
    measurementIds: sourceIds,
    sourceRefs: unique(asArray(field.sourceRefs)),
    mappingIds: unique(asArray(field.mappingIds)),
    measurementFamily: field.measurementFamily || measurementFamily(field),
    measurementComponent: field.measurementComponent || selectivityComponent(field) || carbonNumberComponent(field),
    componentOrder: field.componentOrder ?? componentOrder(field),
  };
}

function axisSourceRefs(axis) {
  return unique(asArray(axis?.sourceRefs));
}

function normalizeAxisScale(value) {
  const text = normalizeText(value);
  if (["log", "log10", "log 10", "log base 10", "base 10 log"].includes(text)) return "log10";
  return "linear";
}

function normalizeAxisOption(axis = {}) {
  const source = isObject(axis) ? axis : {};
  const range = asArray(source.range).map(Number).filter(Number.isFinite);
  return {
    scale: normalizeAxisScale(source.scale),
    title: source.title == null ? null : String(source.title),
    range: range.length === 2 ? range : null,
    tickFormat: source.tickFormat == null ? null : String(source.tickFormat),
  };
}

export function normalizeAxisOptions(axisOptions = {}) {
  const source = isObject(axisOptions) ? axisOptions : {};
  return {
    x: normalizeAxisOption(source.x),
    y: normalizeAxisOption(source.y),
  };
}

function normalizeTraceMode(value) {
  const text = normalizeText(value).replace(/\s+/g, "+");
  if (text === "lines" || text === "line") return "lines";
  if (text === "markers" || text === "marker" || text === "points") return "markers";
  if (text === "lines+markers" || text === "line+markers" || text === "lines+points") return "lines+markers";
  return null;
}

function normalizeLegendPosition(value) {
  const text = normalizeText(value);
  if (["right", "left", "top", "bottom"].includes(text)) return text;
  return "top";
}

function normalizeGrid(value) {
  if (typeof value === "boolean") return { x: value, y: value, color: null };
  const source = isObject(value) ? value : {};
  return {
    x: source.x !== false,
    y: source.y !== false,
    color: source.color == null ? null : String(source.color),
  };
}

function normalizeMarkerSymbol(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if ([
    "open circle",
    "open circles",
    "circle open",
    "circle opens",
    "hollow circle",
    "hollow circles",
    "empty circle",
    "empty circles",
    "unfilled circle",
    "unfilled circles",
    "open marker",
    "open markers",
    "hollow marker",
    "hollow markers",
    "open point",
    "open points",
    "hollow point",
    "hollow points",
  ].includes(text)) return "circle-open";
  if (["filled circle", "filled circles", "solid circle", "solid circles"].includes(text)) return "circle";
  return String(value);
}

function normalizeTraceStyle(trace = {}) {
  const source = isObject(trace) ? trace : {};
  return {
    target: source.target || "primary",
    name: source.name == null ? null : String(source.name),
    line: isObject(source.line) ? {
      color: source.line.color == null ? null : String(source.line.color),
      width: Number.isFinite(Number(source.line.width)) ? Number(source.line.width) : null,
      dash: source.line.dash == null ? null : String(source.line.dash),
    } : {},
    marker: isObject(source.marker) ? {
      color: source.marker.color == null ? null : String(source.marker.color),
      size: Number.isFinite(Number(source.marker.size)) ? Number(source.marker.size) : null,
      symbol: normalizeMarkerSymbol(source.marker.symbol),
    } : {},
  };
}

export function normalizeRenderStyle(renderStyle = {}) {
  const source = isObject(renderStyle) ? renderStyle : {};
  const presetText = normalizeText(source.preset);
  const preset = presetText === "excel like" || presetText === "excel_like" ? "excel_like" : "default";
  const traceMode = normalizeTraceMode(source.traceMode) || (preset === "excel_like" ? "lines+markers" : null);
  return {
    preset,
    traceMode,
    showLegend: source.showLegend == null ? null : Boolean(source.showLegend),
    legendPosition: normalizeLegendPosition(source.legendPosition),
    grid: normalizeGrid(source.grid ?? (preset === "excel_like" ? { x: true, y: true, color: "#d9d9d9" } : {})),
    traces: asArray(source.traces).map(normalizeTraceStyle),
  };
}

export function normalizeChartSpecShape(spec = {}) {
  const yFields = asArray(spec.yFields).length ? asArray(spec.yFields) : [spec.y].filter(Boolean);
  const normalized = {
    ...spec,
    schemaVersion: spec.schemaVersion === CHART_SPEC_V14_VERSION ? CHART_SPEC_V14_VERSION : CHART_SPEC_VERSION,
    status: spec.status || "proposed",
    chartType: normalizeChartType(spec.chartType),
    title: spec.title || "Untitled chart",
    x: spec.x || null,
    y: spec.y || yFields[0] || null,
    yFields,
    groupBy: spec.groupBy || null,
    filters: asArray(spec.filters),
    sourceImportIds: unique(asArray(spec.sourceImportIds)),
    sourceRefs: unique([
      ...asArray(spec.sourceRefs),
      ...axisSourceRefs(spec.x),
      ...yFields.flatMap(axisSourceRefs),
      ...axisSourceRefs(spec.groupBy),
    ]),
    warnings: asArray(spec.warnings),
    transforms: normalizeChartTransforms(spec.transforms),
    series: asArray(spec.series),
    seriesScope: isObject(spec.seriesScope) ? {
      seriesKind: spec.seriesScope.seriesKind || null,
      xField: spec.seriesScope.xField || null,
      yField: spec.seriesScope.yField || null,
      groupBy: spec.seriesScope.groupBy || null,
    } : null,
    compatibleExperimentIds: unique(asArray(spec.compatibleExperimentIds)),
    axisOptions: normalizeAxisOptions(spec.axisOptions),
    renderStyle: normalizeRenderStyle(spec.renderStyle),
    calculationWarnings: asArray(spec.calculationWarnings),
    confidence: spec.confidence ?? null,
    rationale: spec.rationale || spec.reason || "",
    requiresReview: spec.requiresReview !== false,
  };
  return normalized;
}

export function compileChartSpec({
  chartType = "scatter",
  title = "",
  xField = null,
  yFields = [],
  groupBy = null,
  filters = [],
  sourceImportIds = [],
  sourceRefs = [],
  transforms = [],
  series = [],
  axisOptions = {},
  renderStyle = {},
  calculationWarnings = [],
  confidence = null,
  warnings = [],
  rationale = "",
  prompt = "",
  status = "proposed",
  extra = {},
} = {}) {
  const axes = asArray(yFields).filter(Boolean).map(chartAxis);
  const spec = {
    ...extra,
    schemaVersion: CHART_SPEC_VERSION,
    status,
    chartType: normalizeChartType(chartType),
    title,
    x: chartAxis(xField),
    y: axes[0] || null,
    yFields: axes,
    groupBy: chartAxis(groupBy),
    filters: asArray(filters),
    transforms: normalizeChartTransforms(transforms),
    series: asArray(series),
    axisOptions,
    renderStyle,
    calculationWarnings: asArray(calculationWarnings),
    sourceImportIds,
    sourceRefs,
    confidence,
    warnings,
    rationale,
    prompt,
    requiresReview: true,
  };
  return normalizeChartSpecShape(spec);
}
