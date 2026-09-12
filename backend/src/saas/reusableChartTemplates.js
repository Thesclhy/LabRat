import { stableDataHash } from "./dataPlanSchemas.js";

export const CHART_STYLE_PROFILE_SCHEMA_VERSION = "labrat.chartStyleProfile.v1";
export const CHART_STYLE_PROFILE_VERSION_SCHEMA_VERSION = "labrat.chartStyleProfileVersion.v1";
export const REUSABLE_CHART_TEMPLATE_SCHEMA_VERSION = "labrat.reusableChartTemplate.v1";
export const REUSABLE_CHART_TEMPLATE_VERSION_SCHEMA_VERSION = "labrat.reusableChartTemplateVersion.v1";
export const CHART_RECIPE_SCHEMA_VERSION = "labrat.chartRecipe.v1";

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const LEGEND_POSITIONS = new Set(["right", "bottom", "top", "left", "inside"]);
const PALETTE_ASSIGNMENTS = new Set(["selection_order", "project_mapping"]);
const PALETTE_OVERFLOW = new Set(["marker_and_dash", "block"]);
const RECIPE_OPERATIONS = new Set([
  "select_scalar",
  "select_series",
  "order_x",
  "align_x",
  "filter_missing",
  "normalize_sum",
  "aggregate",
  "ratio",
  "unit_convert",
]);
const COMPARISON_MODES = new Set(["overlay", "grouped", "stacked_components", "faceted"]);
const SLOT_SOURCE_KINDS = new Set(["snapshot", "linked_region"]);
const SERIES_ORIENTATIONS = new Set(["header_row_categories", "column_pair"]);
const SERIES_ALIGNMENT_POLICIES = new Set(["union_with_gaps", "intersection", "exact"]);
const WORKBOOK_TEMPLATE_CHART_TYPES = new Set(["grouped_bar", "bar", "scatter", "point"]);
// Processing steps that mean the accepted Python computed new values instead
// of selecting and aligning the workbook's own results. A template must
// reproduce the sheet's numbers, so these are refused.
const RECOMPUTATION_PATTERN = /\b(normali[sz]|weight|calibrat|response factor|ratio|divid|sum(?:med|ming)?\b|total(?:led|ling)?\b|averag|mean\b|integrat|smooth|interpolat|convert|percent of|fraction of|scal(?:e|ed|ing) (?:by|to)|multipl)/i;

const DEFAULT_STYLE = Object.freeze({
  typography: {
    fontFamily: "Arial",
    titleSizePt: 18,
    axisTitleSizePt: 14,
    tickSizePt: 12,
    legendSizePt: 12,
    minimumSizePt: 9,
  },
  palette: {
    colors: ["#245B78", "#D97935", "#4D8C57", "#8A5FA8", "#C34F5A", "#5B7DB1"],
    assignment: "selection_order",
    overflow: "marker_and_dash",
  },
  figure: { aspectRatio: 1.5, preferredWidthPx: 1200, preferredHeightPx: 800 },
  geometry: {
    preferredPlotAreaWidthRatio: 0.76,
    preferredPlotAreaHeightRatio: 0.72,
    minimumPlotAreaWidthRatio: 0.65,
    minimumPlotAreaHeightRatio: 0.62,
    preferredMarginsPx: { top: 60, right: 35, bottom: 75, left: 85 },
    maximumMarginsPx: { top: 100, right: 180, bottom: 150, left: 140 },
  },
  legend: { preferredPosition: "right", fallbackPositions: ["bottom", "top"], allowWrapping: true },
  axes: {},
  marks: {},
  reference: { fileObjectId: null, extractionMethod: "manual", confidence: null },
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return String(value ?? "").trim();
}

function copy(value) {
  return structuredClone(value);
}

function error(code, message, statusCode = 400, details = undefined) {
  throw Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details === undefined ? {} : { details }),
  });
}

function boundedText(value, field, { maximum = 160, required = true } = {}) {
  const normalized = text(value);
  if (required && !normalized) error("reusable_chart_template_invalid", `${field} is required.`, 400, { field });
  if (normalized.length > maximum) error("reusable_chart_template_invalid", `${field} must be ${maximum} characters or fewer.`, 400, { field });
  return normalized;
}

function finiteNumber(value, field, { minimum = null, maximum = null } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || minimum != null && number < minimum || maximum != null && number > maximum) {
    error("chart_style_profile_invalid", `${field} is outside the supported range.`, 400, { field, minimum, maximum });
  }
  return number;
}

function positiveInteger(value, field, maximum = 100) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    error("reusable_chart_template_invalid", `${field} must be an integer from 1 to ${maximum}.`, 400, { field });
  }
  return number;
}

function templateFiniteNumber(value, field, { minimum, maximum }) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    error("reusable_chart_template_invalid", `${field} is outside the supported range.`, 400, {
      field,
      minimum,
      maximum,
    });
  }
  return number;
}

function canonicalGeometryPolicy(value = {}) {
  const source = isObject(value) ? value : {};
  const facet = isObject(source.facet) ? source.facet : {};
  return {
    inheritStyleProfile: source.inheritStyleProfile !== false,
    longLabelThreshold: positiveInteger(source.longLabelThreshold ?? 12, "geometryPolicy.longLabelThreshold", 80),
    facet: {
      maxColumns: positiveInteger(facet.maxColumns ?? 3, "geometryPolicy.facet.maxColumns", 6),
      panelWidthPx: templateFiniteNumber(facet.panelWidthPx ?? 420, "geometryPolicy.facet.panelWidthPx", { minimum: 240, maximum: 2000 }),
      panelHeightPx: templateFiniteNumber(facet.panelHeightPx ?? 320, "geometryPolicy.facet.panelHeightPx", { minimum: 180, maximum: 1600 }),
      allowFigureGrowth: facet.allowFigureGrowth !== false,
      sharedAxes: facet.sharedAxes !== false,
    },
  };
}

function margins(value, defaults, field) {
  const source = isObject(value) ? value : {};
  return Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [
    side,
    finiteNumber(source[side] ?? defaults[side], `${field}.${side}`, { minimum: 0, maximum: 1000 }),
  ]));
}

function canonicalStyleDefinition(input = {}) {
  const source = isObject(input) ? input : {};
  const typography = isObject(source.typography) ? source.typography : {};
  const palette = isObject(source.palette) ? source.palette : {};
  const figure = isObject(source.figure) ? source.figure : {};
  const geometry = isObject(source.geometry) ? source.geometry : {};
  const legend = isObject(source.legend) ? source.legend : {};
  const colors = asArray(palette.colors ?? DEFAULT_STYLE.palette.colors).map((color) => text(color).toUpperCase());
  if (!colors.length || colors.length > 24 || colors.some((color) => !COLOR_PATTERN.test(color))) {
    error("chart_style_profile_invalid", "Chart palettes require 1-24 six-digit hexadecimal colors.", 400, { field: "palette.colors" });
  }
  if (new Set(colors).size !== colors.length) {
    error("chart_style_profile_invalid", "Chart palette colors must be unique.", 400, { field: "palette.colors" });
  }
  const assignment = text(palette.assignment || DEFAULT_STYLE.palette.assignment);
  const overflow = text(palette.overflow || DEFAULT_STYLE.palette.overflow);
  if (!PALETTE_ASSIGNMENTS.has(assignment) || !PALETTE_OVERFLOW.has(overflow)) {
    error("chart_style_profile_invalid", "Chart palette assignment or overflow behavior is unsupported.");
  }
  const preferredMarginsPx = margins(
    geometry.preferredMarginsPx,
    DEFAULT_STYLE.geometry.preferredMarginsPx,
    "geometry.preferredMarginsPx",
  );
  const maximumMarginsPx = margins(
    geometry.maximumMarginsPx,
    DEFAULT_STYLE.geometry.maximumMarginsPx,
    "geometry.maximumMarginsPx",
  );
  for (const side of Object.keys(preferredMarginsPx)) {
    if (preferredMarginsPx[side] > maximumMarginsPx[side]) {
      error("chart_style_profile_invalid", `Preferred ${side} margin cannot exceed its maximum.`, 400, { field: `geometry.preferredMarginsPx.${side}` });
    }
  }
  const preferredPlotAreaWidthRatio = finiteNumber(
    geometry.preferredPlotAreaWidthRatio ?? DEFAULT_STYLE.geometry.preferredPlotAreaWidthRatio,
    "geometry.preferredPlotAreaWidthRatio",
    { minimum: 0.1, maximum: 1 },
  );
  const preferredPlotAreaHeightRatio = finiteNumber(
    geometry.preferredPlotAreaHeightRatio ?? DEFAULT_STYLE.geometry.preferredPlotAreaHeightRatio,
    "geometry.preferredPlotAreaHeightRatio",
    { minimum: 0.1, maximum: 1 },
  );
  const minimumPlotAreaWidthRatio = finiteNumber(
    geometry.minimumPlotAreaWidthRatio ?? DEFAULT_STYLE.geometry.minimumPlotAreaWidthRatio,
    "geometry.minimumPlotAreaWidthRatio",
    { minimum: 0.1, maximum: 1 },
  );
  const minimumPlotAreaHeightRatio = finiteNumber(
    geometry.minimumPlotAreaHeightRatio ?? DEFAULT_STYLE.geometry.minimumPlotAreaHeightRatio,
    "geometry.minimumPlotAreaHeightRatio",
    { minimum: 0.1, maximum: 1 },
  );
  if (
    minimumPlotAreaWidthRatio > preferredPlotAreaWidthRatio
    || minimumPlotAreaHeightRatio > preferredPlotAreaHeightRatio
  ) {
    error("chart_style_profile_invalid", "Minimum plot-area ratios cannot exceed preferred ratios.");
  }
  const preferredPosition = text(legend.preferredPosition || DEFAULT_STYLE.legend.preferredPosition);
  const fallbackPositions = asArray(legend.fallbackPositions ?? DEFAULT_STYLE.legend.fallbackPositions).map(text);
  if (!LEGEND_POSITIONS.has(preferredPosition) || fallbackPositions.some((item) => !LEGEND_POSITIONS.has(item))) {
    error("chart_style_profile_invalid", "Legend positions are unsupported.", 400, { field: "legend" });
  }
  const fontFamily = boundedText(typography.fontFamily ?? DEFAULT_STYLE.typography.fontFamily, "typography.fontFamily", { maximum: 80 });
  const minimumSizePt = finiteNumber(typography.minimumSizePt ?? DEFAULT_STYLE.typography.minimumSizePt, "typography.minimumSizePt", { minimum: 6, maximum: 48 });
  const size = (field, fallback) => {
    const value = finiteNumber(typography[field] ?? fallback, `typography.${field}`, { minimum: 6, maximum: 96 });
    if (value < minimumSizePt) error("chart_style_profile_invalid", `${field} cannot be below minimumSizePt.`, 400, { field: `typography.${field}` });
    return value;
  };
  return {
    typography: {
      fontFamily,
      titleSizePt: size("titleSizePt", DEFAULT_STYLE.typography.titleSizePt),
      axisTitleSizePt: size("axisTitleSizePt", DEFAULT_STYLE.typography.axisTitleSizePt),
      tickSizePt: size("tickSizePt", DEFAULT_STYLE.typography.tickSizePt),
      legendSizePt: size("legendSizePt", DEFAULT_STYLE.typography.legendSizePt),
      minimumSizePt,
    },
    palette: { colors, assignment, overflow },
    figure: {
      aspectRatio: finiteNumber(figure.aspectRatio ?? DEFAULT_STYLE.figure.aspectRatio, "figure.aspectRatio", { minimum: 0.25, maximum: 4 }),
      preferredWidthPx: finiteNumber(figure.preferredWidthPx ?? DEFAULT_STYLE.figure.preferredWidthPx, "figure.preferredWidthPx", { minimum: 240, maximum: 8000 }),
      preferredHeightPx: finiteNumber(figure.preferredHeightPx ?? DEFAULT_STYLE.figure.preferredHeightPx, "figure.preferredHeightPx", { minimum: 180, maximum: 8000 }),
    },
    geometry: {
      preferredPlotAreaWidthRatio,
      preferredPlotAreaHeightRatio,
      minimumPlotAreaWidthRatio,
      minimumPlotAreaHeightRatio,
      preferredMarginsPx,
      maximumMarginsPx,
    },
    legend: {
      preferredPosition,
      fallbackPositions: [...new Set(fallbackPositions.filter((item) => item !== preferredPosition))],
      allowWrapping: legend.allowWrapping !== false,
    },
    axes: isObject(source.axes) ? copy(source.axes) : {},
    marks: isObject(source.marks) ? copy(source.marks) : {},
    reference: {
      fileObjectId: text(source.reference?.fileObjectId) || null,
      extractionMethod: text(source.reference?.extractionMethod || "manual"),
      confidence: source.reference?.confidence == null
        ? null
        : finiteNumber(source.reference.confidence, "reference.confidence", { minimum: 0, maximum: 1 }),
    },
  };
}

export function buildChartStyleProfileVersion({ definition, version = 1 } = {}) {
  const payload = canonicalStyleDefinition(definition);
  const normalizedVersion = positiveInteger(version, "version", 10_000);
  return {
    schemaVersion: CHART_STYLE_PROFILE_VERSION_SCHEMA_VERSION,
    version: normalizedVersion,
    status: "accepted",
    ...payload,
    contentHash: stableDataHash({ schemaVersion: CHART_STYLE_PROFILE_VERSION_SCHEMA_VERSION, ...payload }),
  };
}

export function validateChartStyleProfileVersion(value = {}) {
  if (value.schemaVersion !== CHART_STYLE_PROFILE_VERSION_SCHEMA_VERSION) {
    error("chart_style_profile_invalid", `Style versions require ${CHART_STYLE_PROFILE_VERSION_SCHEMA_VERSION}.`);
  }
  const checked = buildChartStyleProfileVersion({ definition: value, version: value.version });
  if (text(value.contentHash) && value.contentHash !== checked.contentHash) {
    error("chart_style_profile_invalid", "Style profile content hash does not match its canonical payload.");
  }
  return checked;
}

function validateTemplateDefinition(input = {}) {
  const source = isObject(input) ? input : {};
  const cardinality = isObject(source.experimentCardinality) ? source.experimentCardinality : {};
  const minimum = positiveInteger(cardinality.minimum, "experimentCardinality.minimum", 100);
  const recommendedMaximum = positiveInteger(cardinality.recommendedMaximum, "experimentCardinality.recommendedMaximum", 100);
  const hardMaximum = positiveInteger(cardinality.hardMaximum, "experimentCardinality.hardMaximum", 100);
  if (!(minimum <= recommendedMaximum && recommendedMaximum <= hardMaximum)) {
    error("reusable_chart_template_invalid", "Experiment limits must satisfy minimum <= recommendedMaximum <= hardMaximum.");
  }
  const slots = asArray(source.inputSlots);
  if (!slots.length || slots.length > 32) error("reusable_chart_template_invalid", "Templates require 1-32 input slots.");
  const slotIds = new Set();
  const inputSlots = slots.map((slot, index) => {
    const slotId = boundedText(slot?.slotId, `inputSlots[${index}].slotId`, { maximum: 80 });
    if (slotIds.has(slotId)) error("reusable_chart_template_invalid", `Duplicate input slot ${slotId}.`);
    slotIds.add(slotId);
    const dataKind = text(slot?.dataKind);
    if (!new Set(["scalar", "series"]).has(dataKind)) error("reusable_chart_template_invalid", `Input slot ${slotId} has an unsupported data kind.`);
    const sourceKind = text(slot?.sourceKind) || "snapshot";
    if (!SLOT_SOURCE_KINDS.has(sourceKind)) error("reusable_chart_template_invalid", `Input slot ${slotId} has an unsupported source kind.`);
    const preferredColumnId = text(slot?.identityContract?.preferredColumnId);
    const linkedDataKind = text(slot?.linkedDataKind);
    if (sourceKind === "snapshot" && !preferredColumnId) error("reusable_chart_template_invalid", `Input slot ${slotId} requires a preferred stable column id.`);
    if (sourceKind === "linked_region") {
      if (!linkedDataKind) error("reusable_chart_template_invalid", `Input slot ${slotId} requires the linked data kind it binds to.`);
      if (dataKind !== "series") error("reusable_chart_template_invalid", `Input slot ${slotId} binds a linked region and must be a series slot.`);
    }
    let seriesContract = null;
    if (dataKind === "series") {
      const source = isObject(slot?.seriesContract) ? slot.seriesContract : {};
      const orientation = text(source.orientation) || (sourceKind === "linked_region" ? "" : "column_pair");
      if (sourceKind === "linked_region" && !SERIES_ORIENTATIONS.has(orientation)) {
        error("reusable_chart_template_invalid", `Input slot ${slotId} requires a series orientation.`);
      }
      const alignmentPolicy = text(source.alignmentPolicy) || "union_with_gaps";
      if (!SERIES_ALIGNMENT_POLICIES.has(alignmentPolicy)) error("reusable_chart_template_invalid", `Input slot ${slotId} has an unsupported alignment policy.`);
      seriesContract = {
        ...copy(source),
        ...(orientation ? { orientation } : {}),
        alignmentPolicy,
        xMeaning: text(source.xMeaning) || null,
        xValueType: text(source.xValueType) || null,
        yNumericScale: text(source.yNumericScale) || null,
      };
    }
    return {
      slotId,
      label: boundedText(slot?.label || slotId, `inputSlots[${index}].label`, { maximum: 160 }),
      dataKind,
      required: slot?.required !== false,
      cardinality: text(slot?.cardinality || "one_per_experiment"),
      sourceKind,
      ...(sourceKind === "linked_region" ? { linkedDataKind } : {}),
      identityContract: {
        preferredColumnId,
        valueType: text(slot?.identityContract?.valueType),
        readableName: text(slot?.identityContract?.readableName),
        sourceSignature: text(slot?.identityContract?.sourceSignature),
        numericScale: text(slot?.identityContract?.numericScale),
      },
      unitContract: {
        allowedUnits: asArray(slot?.unitContract?.allowedUnits).map(text),
        conversionPolicyIds: asArray(slot?.unitContract?.conversionPolicyIds).map(text),
      },
      ...(seriesContract ? { seriesContract } : {}),
    };
  });
  const recipe = isObject(source.recipe) ? source.recipe : {};
  if (recipe.schemaVersion !== CHART_RECIPE_SCHEMA_VERSION) error("reusable_chart_template_invalid", `Recipes require ${CHART_RECIPE_SCHEMA_VERSION}.`);
  const operations = asArray(recipe.operations);
  if (!operations.length || operations.length > 64) error("reusable_chart_template_invalid", "Recipes require 1-64 operations.");
  operations.forEach((operation, index) => {
    if (!RECIPE_OPERATIONS.has(text(operation?.op))) {
      error("chart_template_recipe_unsupported", `Recipe operation ${text(operation?.op) || index + 1} is unsupported.`, 422, { index });
    }
    if (operation.inputSlotId && !slotIds.has(text(operation.inputSlotId))) {
      error("reusable_chart_template_invalid", `Recipe operation ${index + 1} references an unknown input slot.`);
    }
  });
  const encoding = isObject(source.encoding) ? copy(source.encoding) : {};
  if (!COMPARISON_MODES.has(text(encoding.comparisonMode))) {
    error("reusable_chart_template_invalid", "Template comparison mode is unsupported.");
  }
  return {
    experimentCardinality: { minimum, recommendedMaximum, hardMaximum },
    inputSlots,
    recipe: { schemaVersion: CHART_RECIPE_SCHEMA_VERSION, operations: copy(operations) },
    encoding,
    missingDataPolicy: isObject(source.missingDataPolicy) ? copy(source.missingDataPolicy) : {},
    geometryPolicy: canonicalGeometryPolicy(source.geometryPolicy),
    validation: isObject(source.validation) ? copy(source.validation) : { ok: true, errors: [] },
  };
}

export function buildReusableChartTemplateVersion({ definition, version = 1 } = {}) {
  const payload = validateTemplateDefinition(definition);
  const normalizedVersion = positiveInteger(version, "version", 10_000);
  const sourceChartSpecId = boundedText(definition?.sourceChartSpecId, "sourceChartSpecId", { maximum: 160 });
  const chartStyleProfileVersionId = text(definition?.chartStyleProfileVersionId) || null;
  const hashPayload = {
    schemaVersion: REUSABLE_CHART_TEMPLATE_VERSION_SCHEMA_VERSION,
    sourceChartSpecId,
    chartStyleProfileVersionId,
    ...payload,
  };
  return {
    schemaVersion: REUSABLE_CHART_TEMPLATE_VERSION_SCHEMA_VERSION,
    version: normalizedVersion,
    status: "accepted",
    ...hashPayload,
    contentHash: stableDataHash(hashPayload),
  };
}

export function validateReusableChartTemplateVersion(value = {}) {
  if (value.schemaVersion !== REUSABLE_CHART_TEMPLATE_VERSION_SCHEMA_VERSION) {
    error("reusable_chart_template_invalid", `Template versions require ${REUSABLE_CHART_TEMPLATE_VERSION_SCHEMA_VERSION}.`);
  }
  const checked = buildReusableChartTemplateVersion({ definition: value, version: value.version });
  if (text(value.contentHash) && value.contentHash !== checked.contentHash) {
    error("reusable_chart_template_invalid", "Template content hash does not match its canonical payload.");
  }
  return checked;
}

function acceptedAnalysisChartSpec(chartSpec) {
  const spec = isObject(chartSpec?.spec) ? chartSpec.spec : chartSpec;
  return spec?.schemaVersion === "labrat.chartSpec.v3"
    && spec?.origin === "analysis_result"
    && spec?.status === "accepted"
    ? spec
    : null;
}

function eligibilityBlocker(code, message, details = undefined) {
  return { code, message, ...(details === undefined ? {} : { details }) };
}

function reusableScalarChartType(value) {
  const chartType = text(value);
  if (["bar", "grouped_bar", "stacked_bar", "distribution_bar"].includes(chartType)) return "bar";
  if (chartType === "point") return "scatter";
  return chartType || "scatter";
}

function normalizeKind(value) {
  return text(value).toLowerCase();
}

function linkedSeriesSignature(series) {
  return stableDataHash({
    orientation: text(series?.orientation) || "column_pair",
    xSemanticKey: text(series?.xSemanticKey) || null,
    yUnit: text(series?.yUnit) || null,
    yNumericScale: text(series?.yNumericScale) || null,
  });
}

function traceCount(spec) {
  const catalog = asArray(spec?.traceCatalog);
  if (catalog.length) return catalog.length;
  return asArray(spec?.plotly?.data).length;
}

/**
 * Workbook-backed charts are template-eligible only when every source
 * selection is a confirmed region linked to an experiment under one data
 * kind, every region exposes one series with the same shape and unit, and the
 * accepted plan did nothing beyond selecting and aligning those series.
 */
export async function inspectLinkedSeriesTemplateEligibility({ store, projectId, chartSpec } = {}) {
  const spec = acceptedAnalysisChartSpec(chartSpec);
  const blockers = [];
  const selections = asArray(spec?.sourceSelections);
  if (!spec || chartSpec?.projectId !== projectId || !selections.length) {
    return {
      status: "ineligible",
      blockers: [eligibilityBlocker("reusable_chart_template_linked_regions_required", "Workbook templates require an accepted chart built from confirmed workbook regions.")],
      context: null,
    };
  }
  if (asArray(spec.experimentSelections).length) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_mixed_inputs_unsupported",
      "A template cannot mix workbook regions and Experiment Browser inputs.",
    ));
  }
  const canResolve = typeof store?.findRegionUnderstandingRevisionById === "function"
    && typeof store?.findWorkbookReviewRegionById === "function";
  const experiments = [];
  const unlinked = [];
  const multiSeries = [];
  for (const [selectionIndex, selection] of selections.entries()) {
    const revision = canResolve ? await store.findRegionUnderstandingRevisionById(text(selection?.regionUnderstandingRevisionId)) : null;
    const region = revision?.regionId && canResolve ? await store.findWorkbookReviewRegionById(revision.regionId) : null;
    if (!revision || !region || region.projectId !== projectId || region.disposition !== "active" || region.acceptedRevisionId !== revision.id) {
      blockers.push(eligibilityBlocker(
        "reusable_chart_template_lineage_unavailable",
        "The chart no longer resolves to confirmed workbook regions.",
        { selectionIndex, regionUnderstandingRevisionId: selection?.regionUnderstandingRevisionId || null },
      ));
      continue;
    }
    if (!region.linkedExperimentId || !text(region.dataKind)) {
      unlinked.push({ selectionIndex, regionId: region.id });
      continue;
    }
    const series = asArray(revision.interpretation?.series);
    if (series.length !== 1) {
      multiSeries.push({ selectionIndex, regionId: region.id, seriesCount: series.length });
      continue;
    }
    experiments.push({
      selectionIndex,
      experimentId: region.linkedExperimentId,
      regionId: region.id,
      regionUnderstandingRevisionId: revision.id,
      dataKind: text(region.dataKind),
      series: series[0],
    });
  }
  if (unlinked.length) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_linked_regions_required",
      "Every workbook region in the chart must be linked to an experiment with a data kind. Apply an extraction template or link the regions first.",
      { regions: unlinked },
    ));
  }
  if (multiSeries.length) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_series_contract_mismatch",
      "Each linked region must define exactly one series for a workbook template.",
      { regions: multiSeries },
    ));
  }
  const dataKinds = [...new Set(experiments.map((item) => normalizeKind(item.dataKind)))];
  if (dataKinds.length > 1) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_series_contract_mismatch",
      `The chart mixes data kinds (${[...new Set(experiments.map((item) => item.dataKind))].join(", ")}); a template binds one data kind.`,
    ));
  }
  const signatures = [...new Set(experiments.map((item) => linkedSeriesSignature(item.series)))];
  if (experiments.length && signatures.length > 1) {
    const units = [...new Set(experiments.map((item) => text(item.series?.yUnit) || "no unit"))];
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_series_contract_mismatch",
      `The linked series do not share one orientation, unit, and numeric scale (${units.join(", ")}).`,
      { units },
    ));
  }
  const experimentIds = new Set(experiments.map((item) => item.experimentId));
  if (experiments.length && experimentIds.size !== experiments.length) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_series_contract_mismatch",
      "Each experiment may appear once in a template source chart.",
    ));
  }
  const chartType = text(spec.chartType || chartSpec?.chartType);
  if (!WORKBOOK_TEMPLATE_CHART_TYPES.has(chartType)) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_encoding_unsupported",
      `Workbook series templates support grouped bars, bars, and points; this chart is ${chartType || "unknown"}.`,
      { chartType: chartType || null },
    ));
  }
  const planRevision = typeof store?.findAnalysisPlanRevisionById === "function" && text(spec.analysisPlanRevisionId)
    ? await store.findAnalysisPlanRevisionById(text(spec.analysisPlanRevisionId))
    : null;
  const steps = asArray(planRevision?.plan?.reviewPlan?.processingSteps || planRevision?.reviewPlan?.processingSteps).map(text);
  const recomputation = steps.filter((step) => RECOMPUTATION_PATTERN.test(step));
  if (recomputation.length) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_workbook_recomputation",
      `The accepted plan computed new values ("${recomputation[0].slice(0, 120)}"). A template must reproduce the workbook's own numbers; build the chart from a results row instead.`,
      { steps: recomputation.slice(0, 5) },
    ));
  }
  const traces = traceCount(spec);
  if (experiments.length === selections.length && traces && traces !== experiments.length) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_workbook_recomputation",
      `The accepted chart has ${traces} traces for ${experiments.length} experiments; a workbook series template draws exactly one trace per experiment.`,
      { traceCount: traces, experimentCount: experiments.length },
    ));
  }
  const status = blockers.length ? "ineligible" : "eligible";
  return {
    status,
    blockers,
    context: status === "eligible" ? {
      dataKind: experiments[0].dataKind,
      series: experiments[0].series,
      chartType,
      experiments: experiments.map(({ series: _series, ...item }) => item),
    } : null,
  };
}

export async function deriveLinkedSeriesTemplateDefinition({ store, projectId, chartSpec, chartStyleProfileVersionId = null } = {}) {
  const eligibility = await inspectLinkedSeriesTemplateEligibility({ store, projectId, chartSpec });
  if (eligibility.status !== "eligible") {
    const first = eligibility.blockers[0];
    error("reusable_chart_template_not_eligible", first?.message || "This workbook chart cannot be saved as a template.", 422, { blockers: eligibility.blockers });
  }
  const { dataKind, series, chartType } = eligibility.context;
  const orientation = text(series?.orientation) || "column_pair";
  const label = text(series?.label || series?.seriesKey) || dataKind;
  const yUnit = text(series?.yUnit) || null;
  const encodingChartType = ["bar", "grouped_bar"].includes(chartType) ? "bar" : "scatter";
  const inputSlots = [{
    slotId: "series",
    label,
    dataKind: "series",
    required: true,
    cardinality: "one_per_experiment",
    sourceKind: "linked_region",
    linkedDataKind: dataKind,
    identityContract: {
      preferredColumnId: "",
      valueType: "series",
      readableName: label,
      sourceSignature: linkedSeriesSignature(series),
      numericScale: text(series?.yNumericScale),
    },
    unitContract: { allowedUnits: yUnit ? [yUnit] : [], conversionPolicyIds: [] },
    seriesContract: {
      orientation,
      xMeaning: text(series?.xSemanticKey) || null,
      xValueType: text(series?.xValueType) || (orientation === "header_row_categories" ? "string" : "number"),
      yNumericScale: text(series?.yNumericScale) || null,
      alignmentPolicy: "union_with_gaps",
    },
  }];
  return {
    sourceChartSpecId: chartSpec.id,
    chartStyleProfileVersionId: chartStyleProfileVersionId || null,
    experimentCardinality: { minimum: 1, recommendedMaximum: 8, hardMaximum: 24 },
    inputSlots,
    recipe: {
      schemaVersion: CHART_RECIPE_SCHEMA_VERSION,
      operations: [
        { op: "select_series", inputSlotId: "series", outputRole: "trace" },
        { op: "align_x", inputRole: "trace", outputRole: "trace", policy: "union_with_gaps", order: "source" },
        { op: "filter_missing", inputRole: "trace", outputRole: "trace", policy: "preserve_gap" },
      ],
    },
    encoding: {
      chartType: encodingChartType,
      comparisonMode: encodingChartType === "bar" ? "grouped" : "overlay",
      xRole: "category",
      yRole: "value",
      colorBy: "experiment",
      sourceChartType: chartType,
    },
    missingDataPolicy: {
      missingScalar: "block",
      missingPoint: "preserve_gap",
      missingCategory: "union_with_gaps",
      missingSeries: "exclude_experiment",
    },
    geometryPolicy: { inheritStyleProfile: true },
    validation: { ok: true, errors: [], eligibility: "linked_series_comparison_v1" },
  };
}

export async function inspectReusableChartTemplateEligibility({ store, projectId, chartSpec } = {}) {
  const spec = acceptedAnalysisChartSpec(chartSpec);
  if (!spec || chartSpec?.projectId !== projectId) {
    return {
      status: "ineligible",
      blockers: [eligibilityBlocker(
        "reusable_chart_template_not_eligible",
        "Templates require an accepted analysis-result ChartSpec in this project.",
      )],
    };
  }
  if (asArray(spec.sourceSelections).length && !asArray(spec.experimentSelections).length) {
    const linked = await inspectLinkedSeriesTemplateEligibility({ store, projectId, chartSpec });
    return { status: linked.status, blockers: linked.blockers, ...(linked.status === "eligible" ? { eligibility: "linked_series_comparison_v1" } : {}) };
  }
  const blockers = [];
  const selections = asArray(spec.experimentSelections);
  if (asArray(spec.sourceSelections).length) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_workbook_inputs_unsupported",
      "This chart mixes workbook ranges with Experiment Browser inputs. Build it from one source to save it as a reusable template.",
      { sourceSelectionCount: asArray(spec.sourceSelections).length },
    ));
  }
  if (!selections.length) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_browser_inputs_required",
      "Reusable templates require accepted Experiment Browser inputs.",
    ));
  }
  selections.forEach((selection, selectionIndex) => {
    const columnCount = asArray(selection?.columnIndexes).length;
    if (columnCount < 1 || columnCount > 12) {
      blockers.push(eligibilityBlocker(
        "reusable_chart_template_scalar_shape_unsupported",
        "Reusable scalar templates require 1-12 accepted scalar columns per experiment and no series input.",
        { selectionIndex, columnCount, includeSeries: selection?.includeSeries === true },
      ));
    }
  });
  const fieldSets = [];
  const selectionsWithSeriesData = [];
  for (let selectionIndex = 0; selectionIndex < selections.length; selectionIndex += 1) {
    const selection = selections[selectionIndex];
    const snapshot = await store.findDataSnapshotById(selection?.baseHeadRef?.dataSnapshotId);
    const record = snapshot?.experimentRecords?.[Number(selection?.baseHeadRef?.recordIndex)];
    const fields = asArray(selection?.columnIndexes).map((columnIndex) => record?.fields?.[Number(columnIndex)]);
    if (!snapshot || snapshot.projectId !== projectId || snapshot.status !== "accepted" || fields.some((field) => !field)) {
      blockers.push(eligibilityBlocker(
        "reusable_chart_template_lineage_unavailable",
        "The chart no longer resolves to accepted scalar Experiment Browser lineage.",
        { selectionIndex, experimentId: selection?.experimentId || null },
      ));
      fieldSets.push(null);
    } else {
      fieldSets.push(fields);
      if (selection?.includeSeries === true && asArray(record?.series).length) {
        selectionsWithSeriesData.push(selectionIndex);
      }
    }
  }
  if (selectionsWithSeriesData.length) {
    blockers.push(eligibilityBlocker(
      "reusable_chart_template_series_input_unsupported",
      "Reusable scalar templates cannot include actual series inputs.",
      { selectionIndexes: selectionsWithSeriesData },
    ));
  }
  const resolvedSets = fieldSets.filter(Boolean);
  if (resolvedSets.length) {
    const slotCount = resolvedSets[0].length;
    if (resolvedSets.some((fields) => fields.length !== slotCount)) {
      blockers.push(eligibilityBlocker(
        "reusable_chart_template_slot_count_mismatch",
        "Selected experiments must expose the same number of scalar inputs.",
      ));
    } else {
      const slotUnits = [];
      for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
        const fields = resolvedSets.map((fields) => fields[slotIndex]);
        const first = fields[0] || {};
        const displayName = text(first.displayName || first.fieldKey) || `Selected field ${slotIndex + 1}`;
        const storedTypes = [...new Set(fields.map((field) => text(field?.valueType) || "unknown"))];
        if (storedTypes.some((valueType) => valueType !== "number")) {
          blockers.push(eligibilityBlocker(
            "reusable_chart_template_field_type_incompatible",
            `${displayName} is stored as ${storedTypes.join(", ")}; reusable scalar templates require accepted Number fields.`,
            { slotIndex, displayName, storedTypes },
          ));
        }
        const identities = new Set(fields.map((field) => text(field?.columnId)));
        const units = new Set(fields.map((field) => text(field?.unit)));
        const scales = new Set(fields.map((field) => text(field?.numericScale)));
        if ([...identities].some((value) => !value) || identities.size > 1 || units.size > 1 || scales.size > 1) {
          blockers.push(eligibilityBlocker(
            "reusable_chart_template_field_contract_mismatch",
            `${displayName} does not have one stable field identity, unit, and numeric scale across the selected experiments.`,
            { slotIndex, displayName },
          ));
        }
        slotUnits.push(text(first.unit));
      }
      if (new Set(slotUnits).size > 1) {
        blockers.push(eligibilityBlocker(
          "reusable_chart_template_shared_axis_unit_mismatch",
          "Multiple scalar components must use one compatible shared-axis unit.",
          { units: [...new Set(slotUnits)] },
        ));
      }
    }
  }
  return blockers.length ? { status: "ineligible", blockers } : { status: "eligible", blockers: [] };
}

export async function deriveReusableChartTemplateDefinition({ store, projectId, chartSpec, chartStyleProfileVersionId = null } = {}) {
  const spec = acceptedAnalysisChartSpec(chartSpec);
  if (!spec || chartSpec?.projectId !== projectId) {
    error("reusable_chart_template_not_eligible", "Templates require an accepted analysis-result ChartSpec in this project.", 422);
  }
  if (asArray(spec.sourceSelections).length && !asArray(spec.experimentSelections).length) {
    return deriveLinkedSeriesTemplateDefinition({ store, projectId, chartSpec, chartStyleProfileVersionId });
  }
  const selections = asArray(spec.experimentSelections);
  if (asArray(spec.sourceSelections).length || !selections.length) {
    error("reusable_chart_template_not_eligible", "V1 fast templates require accepted Experiment Browser inputs without direct workbook ranges.", 422);
  }
  if (selections.some((selection) => (
    !asArray(selection?.columnIndexes).length
    || asArray(selection?.columnIndexes).length > 12
  ))) {
    error("reusable_chart_template_not_eligible", "Reusable scalar templates require 1-12 accepted scalar columns per experiment and no series input.", 422);
  }
  const fieldSets = [];
  for (const selection of selections) {
    const snapshot = await store.findDataSnapshotById(selection?.baseHeadRef?.dataSnapshotId);
    const record = snapshot?.experimentRecords?.[Number(selection?.baseHeadRef?.recordIndex)];
    const fields = asArray(selection.columnIndexes).map((columnIndex) => record?.fields?.[Number(columnIndex)]);
    if (!snapshot || snapshot.projectId !== projectId || snapshot.status !== "accepted" || fields.some((field) => !field)) {
      error("reusable_chart_template_not_eligible", "The source chart no longer resolves to accepted scalar input lineage.", 422);
    }
    if (selection?.includeSeries === true && asArray(record?.series).length) {
      error("reusable_chart_template_not_eligible", "Reusable scalar templates cannot include actual series inputs.", 422);
    }
    fieldSets.push(fields);
  }
  const slotCount = fieldSets[0].length;
  if (fieldSets.some((fields) => fields.length !== slotCount)) {
    error("reusable_chart_template_not_eligible", "Selected experiments must expose the same number of scalar inputs.", 422);
  }
  const slots = fieldSets[0].map((first, slotIndex) => {
    const fields = fieldSets.map((fieldSet) => fieldSet[slotIndex]);
    const columnId = text(first?.columnId);
    const displayName = text(first?.displayName || first?.fieldKey);
    const valueType = text(first?.valueType);
    const unit = text(first?.unit);
    const numericScale = text(first?.numericScale);
    const incompatibleTypes = fields.filter((field) => text(field?.valueType) !== "number");
    if (incompatibleTypes.length) {
      const typeSummary = [...new Set(incompatibleTypes.map((field) => text(field?.valueType) || "unknown"))].join(", ");
      error(
        "reusable_chart_template_field_type_incompatible",
        `${displayName || `Selected field ${slotIndex + 1}`} is stored as ${typeSummary}; reusable scalar templates require accepted Number fields.`,
        422,
        { slotIndex, displayName: displayName || null, storedTypes: typeSummary.split(", ") },
      );
    }
    if (!columnId || valueType !== "number" || fields.some((field) => (
      text(field?.columnId) !== columnId
      || text(field?.valueType) !== valueType
      || text(field?.unit) !== unit
      || text(field?.numericScale) !== numericScale
    ))) {
      error("reusable_chart_template_not_eligible", "Selected experiments must share stable numeric column identities and units in the same order.", 422);
    }
    return { columnId, displayName, valueType, unit, numericScale };
  });
  if (new Set(slots.map((slot) => slot.unit)).size > 1) {
    error("reusable_chart_template_not_eligible", "Multiple scalar components must use one compatible shared-axis unit.", 422);
  }
  const sourceChartType = text(spec.chartType || chartSpec?.chartType || "scatter");
  const chartType = reusableScalarChartType(sourceChartType);
  const comparisonMode = chartType === "bar" && (
    text(spec.plotly?.layout?.barmode) === "stack" || sourceChartType === "stacked_bar"
  )
    ? "stacked_components"
    : chartType === "bar" ? "grouped" : "overlay";
  const inputSlots = slots.map((slot, index) => {
    const slotId = slots.length === 1 ? "value" : `value_${index + 1}`;
    return {
      slotId,
      label: slot.displayName || `Selected value ${index + 1}`,
      dataKind: "scalar",
      required: true,
      cardinality: "one_per_experiment",
      identityContract: {
        preferredColumnId: slot.columnId,
        valueType: slot.valueType,
        numericScale: slot.numericScale,
        readableName: slot.displayName,
        sourceSignature: stableDataHash(slot),
      },
      unitContract: { allowedUnits: slot.unit ? [slot.unit] : [], conversionPolicyIds: [] },
    };
  });
  return {
    sourceChartSpecId: chartSpec.id,
    chartStyleProfileVersionId: chartStyleProfileVersionId || null,
    experimentCardinality: { minimum: 1, recommendedMaximum: 6, hardMaximum: 12 },
    inputSlots,
    recipe: {
      schemaVersion: CHART_RECIPE_SCHEMA_VERSION,
      operations: inputSlots.map((slot, index) => ({
        op: "select_scalar",
        inputSlotId: slot.slotId,
        outputRole: inputSlots.length === 1 ? "y" : `component_${index + 1}`,
      })),
    },
    encoding: {
      chartType,
      comparisonMode,
      xRole: "experiment",
      yRole: "value",
      colorBy: inputSlots.length > 1 ? "component" : "experiment",
      ...(inputSlots.length > 1 ? { componentSlotIds: inputSlots.map((slot) => slot.slotId) } : {}),
    },
    missingDataPolicy: {
      missingScalar: "block",
      missingPoint: "block",
      missingCategory: "strict",
    },
    geometryPolicy: { inheritStyleProfile: true },
    validation: {
      ok: true,
      errors: [],
      eligibility: inputSlots.length === 1
        ? "direct_scalar_comparison_v1"
        : "direct_multi_scalar_comparison_v1",
    },
  };
}

export function chartStyleProfileSummary(profile, currentVersion = null) {
  return {
    id: profile.id,
    schemaVersion: profile.schemaVersion,
    name: profile.name,
    description: profile.description || "",
    status: profile.status,
    currentVersionId: profile.currentVersionId,
    currentVersion: currentVersion?.version || null,
    updatedAt: profile.updatedAt,
  };
}

export function reusableChartTemplateSummary(template, currentVersion = null) {
  return {
    id: template.id,
    schemaVersion: template.schemaVersion,
    name: template.name,
    description: template.description || "",
    status: template.status,
    currentVersionId: template.currentVersionId,
    currentVersion: currentVersion?.version || null,
    chartType: currentVersion?.encoding?.chartType || null,
    experimentCardinality: currentVersion?.experimentCardinality || null,
    sourceKind: asArray(currentVersion?.inputSlots).some((slot) => slot?.sourceKind === "linked_region") ? "linked_region" : "snapshot",
    linkedDataKind: asArray(currentVersion?.inputSlots).find((slot) => slot?.sourceKind === "linked_region")?.linkedDataKind || null,
    updatedAt: template.updatedAt,
  };
}

export function reusableChartName(value, field = "name") {
  return boundedText(value, field, { maximum: 120 });
}

export function reusableChartDescription(value) {
  return boundedText(value, "description", { maximum: 1000, required: false });
}
