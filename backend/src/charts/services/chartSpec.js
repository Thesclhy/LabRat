import { slug } from "../../import/services/genericImportContext.js";
import { normalizeChartTransforms } from "./chartTransforms.js";

export const CHART_SPEC_VERSION = "labrat.chartSpec.v1.2";
export const SUPPORTED_CHART_TYPES = ["scatter", "point", "bar", "grouped_bar", "stacked_bar", "distribution_bar"];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value)))];
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
  if (/\breaction time\b|\btime\b|\bhours?\b|\bhrs?\b/.test(text)) aliases.push("time", "reaction time");
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

export function normalizeChartSpecShape(spec = {}) {
  const yFields = asArray(spec.yFields).length ? asArray(spec.yFields) : [spec.y].filter(Boolean);
  const normalized = {
    ...spec,
    schemaVersion: CHART_SPEC_VERSION,
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
