export const OBSERVATION_SERIES_SCHEMA_VERSION = "labrat.observationSeries.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unique(values) {
  return [...new Set(asArray(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function slug(value, fallback = "series") {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function camelFromSnake(value) {
  return String(value || "").replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function fieldMeta(observationSet, fieldName) {
  const fields = asArray(observationSet?.fields).filter(isObject);
  return fields.find((field) => field.field === fieldName)
    || fields.find((field) => field.key === fieldName)
    || { field: fieldName, key: camelFromSnake(fieldName), displayName: fieldName };
}

function experimentMapForDatasetPayload(datasetPayload = {}) {
  const map = new Map();
  asArray(datasetPayload.genericImports).forEach((genericImport) => {
    asArray(genericImport?.experiments).forEach((experiment) => {
      const id = experiment?.experimentId;
      if (!id || map.has(id)) return;
      map.set(id, {
        id,
        label: experiment.label || experiment.name || experiment.title || id,
      });
    });
  });
  return map;
}

function observationSeriesId({ datasetCommitId, sourceImportId, observationSetId, experimentId, yField }) {
  return `observation_series_${slug([
    datasetCommitId,
    experimentId || "unlinked",
    yField,
    sourceImportId,
    observationSetId,
  ].join("_"))}`.slice(0, 180);
}

function summaryForPoints(points) {
  const xs = points.map((point) => point.x).filter((value) => value != null);
  const ys = points.map((point) => point.y).filter((value) => value != null);
  return {
    pointCount: points.length,
    xMin: xs.length ? Math.min(...xs) : null,
    xMax: xs.length ? Math.max(...xs) : null,
    yMin: ys.length ? Math.min(...ys) : null,
    yMax: ys.length ? Math.max(...ys) : null,
  };
}

function deriveSeriesForObservationSet({ project, datasetCommit, datasetPayload, genericImport, observationSet }) {
  if (!isObject(observationSet) || observationSet.kind !== "reaction_rate_time_series") return [];
  const sourceImportId = genericImport.importId || genericImport.fileId || null;
  const observationSetId = observationSet.observationSetId || `${sourceImportId || "import"}_observation_set`;
  const xField = observationSet.xField || "reaction_time_min";
  const xMeta = fieldMeta(observationSet, xField);
  const xKey = xMeta.key || camelFromSnake(xField);
  const experimentMap = experimentMapForDatasetPayload(datasetPayload);
  const experimentIds = unique([
    ...asArray(observationSet.targetExperimentIds),
    ...asArray(genericImport.relatedExperimentIds),
    ...asArray(observationSet.relationship?.targetExperimentIds),
    ...asArray(genericImport.relationship?.targetExperimentIds),
  ]);
  const targets = experimentIds.length ? experimentIds : [null];

  return asArray(observationSet.yFields).flatMap((yField) => {
    const yMeta = fieldMeta(observationSet, yField);
    const yKey = yMeta.key || camelFromSnake(yField);
    const points = asArray(observationSet.observations)
      .map((observation) => ({
        observationId: observation?.observationId || null,
        rowIndex: observation?.rowIndex ?? null,
        x: numericValue(observation?.[xKey]),
        y: numericValue(observation?.[yKey]),
        sourceRefs: asArray(observation?.sourceRefs),
      }))
      .filter((point) => point.x != null && point.y != null);
    if (!points.length) return [];

    const sourceRefs = unique(points.flatMap((point) => point.sourceRefs));
    const summary = {
      ...summaryForPoints(points),
      observationCount: asArray(observationSet.observations).length,
      sourceFileName: genericImport.fileName || null,
      sourceSheetName: observationSet.sourceSheetName || null,
    };

    return targets.map((experimentId) => {
      const experiment = experimentId ? experimentMap.get(experimentId) : null;
      const experimentLabel = experiment?.label || observationSet.inferredExperimentLabel || experimentId || "Unlinked supplement";
      const id = observationSeriesId({
        datasetCommitId: datasetCommit.id,
        sourceImportId,
        observationSetId,
        experimentId,
        yField,
      });
      return {
        schemaVersion: OBSERVATION_SERIES_SCHEMA_VERSION,
        id,
        seriesId: id,
        labId: datasetCommit.labId || project?.labId || null,
        projectId: datasetCommit.projectId || project?.id || null,
        datasetCommitId: datasetCommit.id,
        sourceImportId,
        observationSetId,
        experimentId,
        experimentLabel,
        seriesKind: observationSet.kind,
        xField,
        xKey,
        xLabel: xMeta.displayName || xMeta.field || xField,
        xUnit: xMeta.unit || null,
        yField,
        yKey,
        yLabel: yMeta.displayName || yMeta.field || yField,
        yUnit: yMeta.unit || null,
        sourceRefs,
        summary,
        status: "active",
        isStale: false,
        staleReason: null,
        warnings: asArray(observationSet.warnings),
      };
    });
  });
}

export function deriveObservationSeriesFromDatasetCommit({ project = null, datasetCommit = null } = {}) {
  if (!datasetCommit?.id) return [];
  const datasetPayload = isObject(datasetCommit.datasetPayload) ? datasetCommit.datasetPayload : {};
  return asArray(datasetPayload.genericImports).flatMap((genericImport) => (
    asArray(genericImport?.observationSets).flatMap((observationSet) => deriveSeriesForObservationSet({
      project,
      datasetCommit,
      datasetPayload,
      genericImport,
      observationSet,
    }))
  ));
}

export function decorateObservationSeriesStaleness(series = [], currentDatasetCommitId = null) {
  const current = currentDatasetCommitId || null;
  return asArray(series).filter(isObject).map((item) => {
    const stale = Boolean(current && item.datasetCommitId && item.datasetCommitId !== current);
    return {
      ...item,
      status: stale ? "stale" : (item.status || "active"),
      isStale: stale,
      staleReason: stale ? "dataset_commit_replaced" : null,
    };
  });
}

export function mergePersistedAndDerivedObservationSeries(persisted = [], derivedCurrent = []) {
  const byId = new Map();
  asArray(persisted).forEach((item) => {
    if (item?.id) byId.set(item.id, item);
  });
  asArray(derivedCurrent).forEach((item) => {
    if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
  });
  return [...byId.values()];
}
