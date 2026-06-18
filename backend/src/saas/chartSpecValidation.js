import { normalizeChartSpecShape, SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";
import { transformInputIds } from "../charts/services/chartTransforms.js";

const ALLOWED_CHART_TYPES = new Set(SUPPORTED_CHART_TYPES);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validationError(code, message, details = undefined) {
  return Object.assign(new Error(message), {
    statusCode: 400,
    code,
    ...(details ? { details } : {}),
  });
}

function sourceIdsForAxis(axis) {
  if (!isObject(axis)) return [];
  return [
    ...asArray(axis.sourceIds),
    ...asArray(axis.measurementIds),
    ...asArray(axis.metadataIds),
    ...asArray(axis.fieldValueIds),
  ].map(String).filter(Boolean);
}

function sourceRefsForAxis(axis) {
  if (!isObject(axis)) return [];
  return asArray(axis.sourceRefs).map(String).filter(Boolean);
}

function collectDatasetReferences(datasetPayload = {}) {
  const valueIds = new Set();
  const sourceRefs = new Set();

  asArray(datasetPayload.genericImports).forEach((genericImport) => {
    asArray(genericImport.sources).forEach((source) => {
      if (source?.sourceRef) sourceRefs.add(String(source.sourceRef));
    });
    asArray(genericImport.experiments).forEach((experiment) => {
      if (experiment?.experimentId) valueIds.add(String(experiment.experimentId));
      if (experiment?.sourceRef) sourceRefs.add(String(experiment.sourceRef));
      asArray(experiment?.metadata).forEach((metadata) => {
        if (metadata?.metadataId) valueIds.add(String(metadata.metadataId));
        if (metadata?.fieldValueId) valueIds.add(String(metadata.fieldValueId));
        if (metadata?.sourceRef) sourceRefs.add(String(metadata.sourceRef));
      });
    });
    asArray(genericImport.fields).forEach((field) => {
      if (field?.fieldValueId) valueIds.add(String(field.fieldValueId));
      if (field?.measurementId) valueIds.add(String(field.measurementId));
      if (field?.metadataId) valueIds.add(String(field.metadataId));
      if (field?.sourceRef) sourceRefs.add(String(field.sourceRef));
    });
    asArray(genericImport.measurements).forEach((measurement) => {
      if (measurement?.measurementId) valueIds.add(String(measurement.measurementId));
      if (measurement?.fieldValueId) valueIds.add(String(measurement.fieldValueId));
      if (measurement?.sourceRef) sourceRefs.add(String(measurement.sourceRef));
    });
  });

  return { valueIds, sourceRefs };
}

function observationFieldsForSeries(datasetPayload = {}, series = {}, fieldName = "") {
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

function validateSeriesScope(chartSpec, datasetPayload) {
  if (!isObject(chartSpec.seriesScope)) return;
  const series = asArray(chartSpec.series).filter(isObject);
  if (!series.length) {
    throw validationError("invalid_chart_spec", "Series-backed chart specs require series definitions.", {
      seriesScope: chartSpec.seriesScope,
    });
  }
  const compatible = new Set(asArray(chartSpec.compatibleExperimentIds).map(String));
  series.forEach((item, index) => {
    if (!item.experimentId || !item.observationSetId || !item.xField || !item.yField) {
      throw validationError("invalid_chart_spec", "Series-backed chart definitions require experiment, observation set, x field, and y field refs.", {
        seriesIndex: index,
      });
    }
    if (compatible.size && !compatible.has(String(item.experimentId))) {
      throw validationError("invalid_chart_spec", "Series-backed chart references an experiment outside compatibleExperimentIds.", {
        seriesIndex: index,
        experimentId: item.experimentId,
      });
    }
    const xFields = observationFieldsForSeries(datasetPayload, item, item.xField);
    const yFields = observationFieldsForSeries(datasetPayload, item, item.yField);
    if (!xFields.length || !yFields.length) {
      throw validationError("chart_source_unresolved", "Series-backed chart references observation fields not present in the dataset commit.", {
        seriesIndex: index,
        experimentId: item.experimentId,
        xField: item.xField,
        yField: item.yField,
      });
    }
  });
}

function axisLabel(axis, fallback) {
  return axis?.label || axis?.field || axis?.fieldId || fallback;
}

function requireAxisSources(axis, name, valueIds) {
  if (!isObject(axis)) {
    throw validationError("invalid_chart_spec", `Chart spec requires a ${name} field.`, { axis: name });
  }
  const ids = sourceIdsForAxis(axis);
  if (!ids.length) {
    throw validationError("invalid_chart_spec", `${axisLabel(axis, name)} must include sourceIds or measurementIds.`, {
      axis: name,
    });
  }
  const unresolved = ids.filter((id) => !valueIds.has(id));
  if (unresolved.length) {
    throw validationError("chart_source_unresolved", `${axisLabel(axis, name)} references fields not present in the dataset commit.`, {
      axis: name,
      unresolved,
    });
  }
}

function validateRefs(sourceRefs, knownRefs) {
  const refs = asArray(sourceRefs).map(String).filter(Boolean);
  const unresolved = refs.filter((ref) => !knownRefs.has(ref));
  if (unresolved.length) {
    throw validationError("chart_source_unresolved", "Chart spec references source refs not present in the dataset commit.", {
      unresolved,
    });
  }
}

export function validateChartSpecProposal({ proposal, datasetCommit } = {}) {
  if (!isObject(proposal)) {
    throw validationError("invalid_chart_spec", "Chart proposal must be an object.");
  }
  if (!datasetCommit?.id || !isObject(datasetCommit.datasetPayload)) {
    throw validationError("invalid_chart_spec", "A dataset commit with a dataset payload is required.");
  }

  const chartSpec = normalizeChartSpecShape(proposal);
  const chartType = chartSpec.chartType || "scatter";
  if (!ALLOWED_CHART_TYPES.has(chartType)) {
    throw validationError("invalid_chart_spec", `Unsupported chart type ${chartType}.`, {
      chartType,
      allowedChartTypes: [...ALLOWED_CHART_TYPES],
    });
  }

  const { valueIds, sourceRefs } = collectDatasetReferences(datasetCommit.datasetPayload);
  const seriesBacked = isObject(chartSpec.seriesScope) && asArray(chartSpec.series).length > 0;
  validateSeriesScope(chartSpec, datasetCommit.datasetPayload);
  if (chartType === "distribution_bar") {
    if (!isObject(chartSpec.x)) {
      throw validationError("invalid_chart_spec", "Distribution charts require a component x axis.", { axis: "x" });
    }
  } else if (!(seriesBacked && !sourceIdsForAxis(chartSpec.x).length)) {
    requireAxisSources(chartSpec.x, "x", valueIds);
  }
  const yFields = asArray(chartSpec.yFields).length ? asArray(chartSpec.yFields) : [chartSpec.y];
  const usableYFields = yFields.filter(isObject);
  if (!usableYFields.length) {
    throw validationError("invalid_chart_spec", "Chart spec requires at least one y field.", { axis: "y" });
  }
  if ((chartType === "grouped_bar" || chartType === "stacked_bar" || chartType === "distribution_bar") && usableYFields.length < 2) {
    throw validationError("invalid_chart_spec", "Grouped, stacked, and distribution chart specs require at least two yFields.", {
      chartType,
      yFieldCount: usableYFields.length,
    });
  }
  usableYFields.forEach((axis, index) => {
    if (seriesBacked && !sourceIdsForAxis(axis).length) return;
    requireAxisSources(axis, `y${index + 1}`, valueIds);
  });

  asArray(chartSpec.transforms).forEach((transform, index) => {
    const inputIds = transformInputIds(transform);
    if ((transform.type === "normalize_sum_to_percent" || transform.type === "pivot_longer") && inputIds.length < 2) {
      throw validationError("invalid_chart_spec", `${transform.type} requires at least two input fields.`, {
        transformIndex: index,
        transformType: transform.type,
      });
    }
    const unresolved = inputIds.filter((id) => !valueIds.has(id));
    if (unresolved.length) {
      throw validationError("chart_source_unresolved", "Chart transform references fields not present in the dataset commit.", {
        transformIndex: index,
        transformType: transform.type,
        unresolved,
      });
    }
  });

  const groupByIds = sourceIdsForAxis(chartSpec.groupBy);
  const unresolvedGroupBy = groupByIds.filter((id) => !valueIds.has(id));
  if (unresolvedGroupBy.length) {
    throw validationError("chart_source_unresolved", "Chart groupBy references fields not present in the dataset commit.", {
      axis: "groupBy",
      unresolved: unresolvedGroupBy,
    });
  }

  validateRefs([
    ...asArray(chartSpec.sourceRefs),
    ...sourceRefsForAxis(chartSpec.x),
    ...usableYFields.flatMap(sourceRefsForAxis),
    ...sourceRefsForAxis(chartSpec.groupBy),
  ], sourceRefs);

  return { ok: true, chartSpec };
}
