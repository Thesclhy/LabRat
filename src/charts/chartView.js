function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function chartSpecValue(chartSpecOrProposal) {
  const value = isObject(chartSpecOrProposal) ? chartSpecOrProposal : {};
  return isObject(value.spec) ? { ...value, ...value.spec } : value;
}

function idList(items) {
  return [...new Set(asArray(items)
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
}

function fieldKey(axis, fallback = "value") {
  return String(axis?.fieldId || axis?.field || fallback || "value").trim();
}

function unitDetail(xUnit, yUnit) {
  const x = String(xUnit ?? "").trim();
  const y = String(yUnit ?? "").trim();
  if (x && y) return `${x} to ${y}`;
  return x || y || "";
}

export function sourceSeriesTraceId(series, yField, index = 0) {
  const explicit = String(series?.traceId || "").trim();
  if (explicit) return explicit;
  const owner = String(series?.experimentId || series?.seriesId || `series_${index + 1}`).trim();
  return `${owner}:${fieldKey(yField)}`;
}

export function sourceFieldTraceId(axis, index = 0) {
  return `field:${fieldKey(axis, `value_${index + 1}`)}`;
}

export function traceOptionsForChartSpec(chartSpecOrProposal) {
  const spec = chartSpecValue(chartSpecOrProposal);
  if (spec.origin === "analysis_result") {
    return asArray(spec.traceCatalog).flatMap((trace) => {
      const id = String(trace?.traceId || "").trim();
      if (!id) return [];
      return [{
        id,
        label: trace.experimentLabel || trace.name || trace.experimentId || id,
        detail: unitDetail(trace.xUnit, trace.yUnit),
        experimentId: trace.experimentId || null,
      }];
    });
  }

  const yFields = asArray(spec.yFields).length ? asArray(spec.yFields) : [spec.y].filter(Boolean);
  const yField = yFields[0] || { field: spec.seriesScope?.yField || "value" };
  const catalogSeries = asArray(spec.sourceSnapshot?.series).length
    ? asArray(spec.sourceSnapshot.series)
    : asArray(spec.series);
  if (catalogSeries.length) {
    return catalogSeries.flatMap((series, index) => {
      if (!isObject(series)) return [];
      const declared = asArray(spec.series).find((candidate) => (
        candidate?.seriesId === series.seriesId
        || candidate?.experimentId === series.experimentId
      )) || series;
      return [{
        id: sourceSeriesTraceId(declared, yField, index),
        label: declared.experimentLabel
          || series.experimentLabel
          || series.experimentAlias
          || declared.label
          || declared.experimentId
          || declared.seriesId
          || `Series ${index + 1}`,
        detail: unitDetail(spec.x?.unit, yField?.unit),
        experimentId: declared.experimentId || series.experimentId || null,
      }];
    });
  }

  return yFields.map((axis, index) => ({
    id: sourceFieldTraceId(axis, index),
    label: axis?.label || fieldKey(axis, `Value ${index + 1}`),
    detail: unitDetail(spec.x?.unit, axis?.unit),
    experimentId: null,
  }));
}

export function normalizeChartView(chartSpecOrProposal, persistedView) {
  const spec = chartSpecValue(chartSpecOrProposal);
  const view = isObject(persistedView) ? persistedView : {};
  const options = traceOptionsForChartSpec(spec);
  const validIds = new Set(options.map((option) => option.id));
  const keepValid = (items) => {
    const normalized = idList(items);
    return validIds.size ? normalized.filter((id) => validIds.has(id)) : normalized;
  };

  if (Object.hasOwn(view, "visibleTraceIds")) {
    return { visibleTraceIds: keepValid(view.visibleTraceIds) };
  }

  const selectedExperimentIds = new Set(idList(view.selectedExperimentIds));
  const excludedExperimentIds = new Set(idList(view.excludedExperimentIds));
  if (selectedExperimentIds.size || excludedExperimentIds.size) {
    return {
      visibleTraceIds: options
        .filter((option) => {
          const experimentId = String(option.experimentId || "");
          if (selectedExperimentIds.size && !selectedExperimentIds.has(experimentId)) return false;
          return !excludedExperimentIds.has(experimentId);
        })
        .map((option) => option.id),
    };
  }

  if (spec.origin === "analysis_result" && Array.isArray(spec.defaultChartView?.visibleTraceIds)) {
    return { visibleTraceIds: keepValid(spec.defaultChartView.visibleTraceIds) };
  }

  return { visibleTraceIds: options.map((option) => option.id) };
}
