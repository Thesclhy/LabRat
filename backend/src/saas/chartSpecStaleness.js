function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function decorateChartSpecStaleness(chartSpec, currentDatasetCommitId = null) {
  const spec = copy(chartSpec);
  if (!spec) return spec;
  const specCommitId = spec.datasetCommitId || null;
  const activeCommitId = currentDatasetCommitId || null;
  const isStale = Boolean(specCommitId && activeCommitId && specCommitId !== activeCommitId);
  return {
    ...spec,
    isStale,
    status: isStale ? "stale" : "active",
    staleReason: isStale ? "dataset_commit_replaced" : null,
  };
}

export function decorateChartSpecsStaleness(chartSpecs = [], currentDatasetCommitId = null) {
  return (Array.isArray(chartSpecs) ? chartSpecs : [])
    .map((chartSpec) => decorateChartSpecStaleness(chartSpec, currentDatasetCommitId));
}

export function activeChartSpecs(chartSpecs = [], currentDatasetCommitId = null) {
  return decorateChartSpecsStaleness(chartSpecs, currentDatasetCommitId)
    .filter((chartSpec) => chartSpec && !chartSpec.isStale && chartSpec.status !== "stale");
}
