import { compileChartSpec, normalizeText } from "../charts/services/chartSpec.js";
import { makeId } from "./ids.js";

export const ANALYSIS_VIEW_SCHEMA_VERSION = "labrat.analysisView.v1";
export const SERIES_COMPARE_VIEW_TYPE = "series_compare";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unique(values) {
  return [...new Set(asArray(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function slug(value, fallback = "value") {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function normalizedToken(value) {
  return normalizeText(value).replace(/\bexperiment\b/g, "exp").replace(/\s+/g, "");
}

function extractExperimentAliases(request = {}, spec = {}) {
  const explicit = [
    ...asArray(spec.experimentAliases),
    ...asArray(spec.experiments),
    ...asArray(request.experimentAliases),
  ];
  const text = [request.prompt, request.message, request.goal, spec.prompt].filter(Boolean).join(" ");
  const fromText = [...text.matchAll(/\bexp(?:eriment)?\s*0*([0-9]+)\b/gi)].map((match) => `Exp${Number(match[1])}`);
  return unique([...explicit, ...fromText]);
}

function experimentIdMap(observationSeries = []) {
  const map = new Map();
  asArray(observationSeries).forEach((series) => {
    if (!series?.experimentId) return;
    [
      series.experimentId,
      series.experimentLabel,
      normalizedToken(series.experimentLabel),
      normalizedToken(series.experimentId),
    ].forEach((token) => {
      if (token && !map.has(token)) map.set(token, series.experimentId);
    });
  });
  return map;
}

function resolveExperimentIds({ request, spec, observationSeries }) {
  const byToken = experimentIdMap(observationSeries);
  const ids = unique([
    ...asArray(spec.experimentIds),
    ...asArray(request.experimentIds),
  ]);
  const missing = [];
  extractExperimentAliases(request, spec).forEach((alias) => {
    const resolved = byToken.get(alias) || byToken.get(normalizedToken(alias));
    if (resolved) ids.push(resolved);
    else missing.push(alias);
  });
  return { experimentIds: unique(ids), missing };
}

function fieldMatchesAlias(series, fieldName, alias) {
  if (!alias) return false;
  const target = normalizeText(alias);
  if (!target) return false;
  const values = fieldName === "x"
    ? [series.xField, series.xLabel, series.xKey]
    : [series.yField, series.yLabel, series.yKey];
  return values.some((value) => {
    const normalized = normalizeText(value);
    return normalized === target || normalized.includes(target) || target.includes(normalized);
  });
}

function compatibleField(series, fieldName) {
  return fieldName === "x" ? series.xField : series.yField;
}

function chooseCompatibleField({ series, fieldName, requestedField, alias, preferred = [] }) {
  const candidates = asArray(series).filter((item) => item?.[`${fieldName}Field`]);
  if (requestedField) {
    const requested = String(requestedField);
    return candidates.some((item) => compatibleField(item, fieldName) === requested)
      ? { field: requested }
      : { clarification: fieldClarification(fieldName, candidates, `No ${fieldName}-axis series matched ${requested}.`) };
  }
  if (alias) {
    const matched = unique(candidates
      .filter((item) => fieldMatchesAlias(item, fieldName, alias))
      .map((item) => compatibleField(item, fieldName)));
    if (matched.length === 1) return { field: matched[0] };
    if (matched.length > 1) return { clarification: fieldClarification(fieldName, candidates, `Multiple ${fieldName}-axis fields matched ${alias}.`) };
  }

  const counts = new Map();
  candidates.forEach((item) => {
    const field = compatibleField(item, fieldName);
    counts.set(field, (counts.get(field) || 0) + 1);
  });
  const complete = [...counts.entries()]
    .filter(([, count]) => count === candidates.length)
    .map(([field]) => field);
  if (complete.length === 1) return { field: complete[0] };
  const preferredMatch = preferred.find((field) => complete.includes(field));
  if (preferredMatch) return { field: preferredMatch };
  return { clarification: fieldClarification(fieldName, candidates, `Choose a ${fieldName}-axis field for this compare view.`) };
}

function fieldClarification(fieldName, series, message) {
  const options = new Map();
  asArray(series).forEach((item) => {
    const field = compatibleField(item, fieldName);
    if (!field || options.has(field)) return;
    options.set(field, {
      field,
      label: fieldName === "x" ? item.xLabel : item.yLabel,
      unit: fieldName === "x" ? item.xUnit : item.yUnit,
    });
  });
  return {
    code: `${fieldName}_field_clarification`,
    message,
    options: [...options.values()],
  };
}

function observationFieldsForSeries(datasetCommit, series, fieldName) {
  const datasetPayload = isObject(datasetCommit?.datasetPayload) ? datasetCommit.datasetPayload : {};
  return asArray(datasetPayload.genericImports)
    .filter((genericImport) => !series.sourceImportId || genericImport.importId === series.sourceImportId)
    .flatMap((genericImport) => asArray(genericImport.fields))
    .filter((field) => (
      field?.recordKind === "observation"
      && field.field === fieldName
      && (!series.observationSetId || field.observationSetId === series.observationSetId)
      && (
        !series.experimentId
        || asArray(field.relatedExperimentIds).includes(series.experimentId)
        || field.inferredExperimentLabel === series.experimentLabel
      )
    ));
}

function axisFieldFromSeries({ datasetCommit, series, fieldName, axis }) {
  const fieldValues = asArray(series).flatMap((item) => observationFieldsForSeries(datasetCommit, item, fieldName));
  const firstSeries = asArray(series)[0] || {};
  return {
    fieldId: `analysis_${axis}_${slug(fieldName)}`,
    field: fieldName,
    canonicalField: fieldName,
    displayName: axis === "x" ? firstSeries.xLabel : firstSeries.yLabel,
    unit: axis === "x" ? firstSeries.xUnit : firstSeries.yUnit,
    role: axis === "x" ? "condition" : "measurement",
    semanticRole: axis === "x" ? "time" : "measurement",
    valueType: "number",
    sourceIds: unique(fieldValues.map((field) => field.fieldValueId)),
    sourceRefs: unique(fieldValues.map((field) => field.sourceRef)),
    confidence: Math.min(...asArray(series).map((item) => Number(item.summary?.pointCount > 0 ? 0.9 : 0.5))) || 0.75,
  };
}

function groupByExperimentField(series) {
  return {
    fieldId: "analysis_group_by_experiment",
    field: "experiment",
    canonicalField: "experiment",
    displayName: "Experiment",
    role: "identifier",
    semanticRole: "identifier",
    valueType: "categorical",
    sourceIds: unique(asArray(series).map((item) => item.experimentId)),
    sourceRefs: [],
    confidence: 0.95,
  };
}

function clarification(code, message, options = []) {
  return { code, message, options };
}

export function resolveSeriesCompareAnalysisView({
  project = null,
  datasetCommit = null,
  observationSeries = [],
  request = {},
} = {}) {
  const spec = isObject(request.spec) ? request.spec : {};
  const viewType = request.viewType || spec.viewType || SERIES_COMPARE_VIEW_TYPE;
  if (viewType !== SERIES_COMPARE_VIEW_TYPE) {
    return { error: { code: "unsupported_analysis_view_type", message: `Unsupported analysis view type ${viewType}.` } };
  }
  if (!datasetCommit?.id) {
    return { error: { code: "dataset_commit_required", message: "A current dataset commit is required." } };
  }
  const seriesKind = spec.seriesKind || request.seriesKind || "reaction_rate_time_series";
  const activeSeries = asArray(observationSeries).filter((series) => (
    !series.isStale
    && series.datasetCommitId === datasetCommit.id
    && series.seriesKind === seriesKind
  ));
  const { experimentIds, missing } = resolveExperimentIds({ request, spec, observationSeries: activeSeries });
  if (missing.length) {
    return { clarification: clarification("experiment_not_found", "Some requested experiments do not have active observation series.", missing.map((alias) => ({ alias }))) };
  }
  if (experimentIds.length < 2) {
    return { clarification: clarification("experiments_required", "Select at least two experiments with active observation series for a compare view.") };
  }
  const selectedByExperiment = experimentIds.map((experimentId) => activeSeries.filter((series) => series.experimentId === experimentId));
  const missingSeries = selectedByExperiment
    .map((items, index) => items.length ? null : experimentIds[index])
    .filter(Boolean);
  if (missingSeries.length) {
    return { clarification: clarification("series_not_found", "Some selected experiments do not have matching observation series.", missingSeries.map((experimentId) => ({ experimentId }))) };
  }
  const selectedCandidates = selectedByExperiment.flat();
  const yChoice = chooseCompatibleField({
    series: selectedCandidates,
    fieldName: "y",
    requestedField: spec.yField || request.yField,
    alias: spec.yFieldAlias || request.yFieldAlias || request.measurement || request.prompt,
    preferred: ["adjusted_rate_m_s", "reaction_rate_mol_g_h", "rate_mol_s"],
  });
  if (yChoice.clarification) return { clarification: yChoice.clarification };
  const withY = selectedCandidates.filter((series) => series.yField === yChoice.field);
  const xChoice = chooseCompatibleField({
    series: withY,
    fieldName: "x",
    requestedField: spec.xField || request.xField,
    alias: spec.xFieldAlias || request.xFieldAlias,
    preferred: ["reaction_time_min", "mean_time_min"],
  });
  if (xChoice.clarification) return { clarification: xChoice.clarification };
  const selectedSeries = experimentIds.map((experimentId) => withY.find((series) => (
    series.experimentId === experimentId && series.xField === xChoice.field
  ))).filter(Boolean);
  if (selectedSeries.length !== experimentIds.length) {
    return { clarification: clarification("compatible_series_not_found", "The selected experiments do not share compatible x/y observation fields.") };
  }

  const sourceRefs = unique(selectedSeries.flatMap((series) => series.sourceRefs));
  const resolvedSpec = {
    seriesKind,
    experimentIds,
    xField: xChoice.field,
    yField: yChoice.field,
    groupBy: spec.groupBy || "experiment",
    seriesIds: selectedSeries.map((series) => series.id || series.seriesId),
    sourceImportIds: unique(selectedSeries.map((series) => series.sourceImportId)),
  };
  return {
    analysisView: {
      schemaVersion: ANALYSIS_VIEW_SCHEMA_VERSION,
      viewType: SERIES_COMPARE_VIEW_TYPE,
      status: "draft",
      title: request.title || spec.title || `${selectedSeries[0]?.yLabel || yChoice.field} comparison`,
      datasetCommitId: datasetCommit.id,
      spec: resolvedSpec,
      sourceRefs,
      warnings: [],
    },
    selectedSeries,
  };
}

export function chartProposalFromAnalysisView({ analysisView, datasetCommit, observationSeries = [] } = {}) {
  if (!analysisView?.id && !analysisView?.spec) {
    throw Object.assign(new Error("AnalysisView is required."), { code: "analysis_view_required", statusCode: 400 });
  }
  if (analysisView.viewType !== SERIES_COMPARE_VIEW_TYPE) {
    throw Object.assign(new Error("Only series_compare AnalysisViews can create chart proposals in this phase."), {
      code: "unsupported_analysis_view_type",
      statusCode: 400,
    });
  }
  const spec = analysisView.spec || {};
  const seriesIds = new Set(asArray(spec.seriesIds));
  const selectedSeries = asArray(observationSeries).filter((series) => (
    seriesIds.has(series.id || series.seriesId)
    && !series.isStale
    && series.datasetCommitId === datasetCommit?.id
  ));
  if (!selectedSeries.length || selectedSeries.length !== seriesIds.size) {
    throw Object.assign(new Error("AnalysisView references stale or missing observation series."), {
      code: "analysis_view_series_unresolved",
      statusCode: 409,
    });
  }
  const xField = axisFieldFromSeries({ datasetCommit, series: selectedSeries, fieldName: spec.xField, axis: "x" });
  const yField = axisFieldFromSeries({ datasetCommit, series: selectedSeries, fieldName: spec.yField, axis: "y" });
  if (!xField.sourceIds.length || !yField.sourceIds.length) {
    throw Object.assign(new Error("AnalysisView source fields could not be resolved against the dataset commit."), {
      code: "analysis_view_source_unresolved",
      statusCode: 409,
    });
  }
  const sourceImportIds = unique(selectedSeries.map((series) => series.sourceImportId));
  const sourceRefs = unique([
    ...asArray(analysisView.sourceRefs),
    ...selectedSeries.flatMap((series) => series.sourceRefs),
    ...xField.sourceRefs,
    ...yField.sourceRefs,
  ]);
  const proposalId = `chart_proposal_analysis_view_${slug(analysisView.id || makeId("analysis_view"))}_${slug(spec.yField)}_vs_${slug(spec.xField)}`;
  const proposal = compileChartSpec({
    chartType: "scatter",
    title: analysisView.title || `${yField.displayName} comparison`,
    xField,
    yFields: [yField],
    groupBy: groupByExperimentField(selectedSeries),
    sourceImportIds,
    sourceRefs,
    series: selectedSeries.map((series) => ({
      seriesId: series.id || series.seriesId,
      experimentId: series.experimentId,
      experimentLabel: series.experimentLabel,
      sourceImportId: series.sourceImportId,
      observationSetId: series.observationSetId,
      xField: series.xField,
      yField: series.yField,
      label: series.experimentLabel || series.experimentId,
    })),
    renderStyle: { traceMode: "lines+markers", showLegend: true },
    confidence: 0.9,
    warnings: asArray(analysisView.warnings),
    rationale: `Compares ${yField.displayName} vs ${xField.displayName} across ${selectedSeries.length} experiments using reviewed supplemental observation series.`,
    extra: {
      analysisViewId: analysisView.id || null,
      analysisViewType: analysisView.viewType,
      seriesScope: {
        seriesKind: spec.seriesKind,
        xField: spec.xField,
        yField: spec.yField,
        groupBy: spec.groupBy || "experiment",
      },
      compatibleExperimentIds: asArray(spec.experimentIds),
      selectedExperimentIds: asArray(spec.experimentIds),
      seriesKind: spec.seriesKind,
    },
  });
  return {
    ...proposal,
    schemaVersion: "labrat.chartSpec.v1.4",
    proposalId,
    origin: "analysis_view",
    insight: `Compare ${yField.displayName} across ${selectedSeries.map((series) => series.experimentLabel || series.experimentId).join(", ")}.`,
    status: "proposed",
  };
}
