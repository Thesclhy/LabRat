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

function unitDetail(xUnit, yUnit) {
  const x = String(xUnit ?? "").trim();
  const y = String(yUnit ?? "").trim();
  if (x && y) return `${x} to ${y}`;
  return x || y || "";
}

export function traceOptionsForChartSpec(chartSpecOrProposal) {
  const spec = chartSpecValue(chartSpecOrProposal);
  if (spec.origin !== "analysis_result") return [];
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

  if (Array.isArray(spec.defaultChartView?.visibleTraceIds)) {
    return { visibleTraceIds: keepValid(spec.defaultChartView.visibleTraceIds) };
  }

  return { visibleTraceIds: options.map((option) => option.id) };
}
