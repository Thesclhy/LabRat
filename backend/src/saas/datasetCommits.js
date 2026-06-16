function copy(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(copy);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  }
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function countWarnings(items) {
  return asArray(items).reduce((total, item) => (
    total
    + asArray(item?.warnings).length
    + countWarnings(item?.experiments)
    + countWarnings(item?.fields)
    + countWarnings(item?.metadata)
    + countWarnings(item?.measurements)
  ), 0);
}

export function datasetPayloadCounts(datasetPayload = {}) {
  const genericImports = asArray(datasetPayload.genericImports);
  return {
    genericImportCount: genericImports.length,
    experimentCount: genericImports.reduce((total, item) => total + asArray(item?.experiments).length, 0),
    fieldCount: genericImports.reduce((total, item) => total + asArray(item?.fields).length, 0),
    measurementCount: genericImports.reduce((total, item) => total + asArray(item?.measurements).length, 0),
    warningCount: countWarnings(genericImports) + asArray(datasetPayload.warnings).length,
  };
}

function itemIdentity(item) {
  if (!isObject(item)) return null;
  return item.importId
    || item.experimentId
    || item.fieldValueId
    || item.measurementId
    || item.metadataId
    || item.sourceRef
    || item.fileId
    || item.mappingSetId
    || item.proposalSetId
    || item.chartSpecId
    || item.id
    || null;
}

function mergeArray(parentArray, patchArray, key) {
  const next = asArray(parentArray).map(copy);
  const seen = new Set(next.map(itemIdentity).filter(Boolean));
  const incomingIds = [];

  asArray(patchArray).forEach((item) => {
    const id = itemIdentity(item);
    if (id) incomingIds.push(id);
    if (id && seen.has(id)) {
      if (key === "genericImports") {
        throw Object.assign(new Error(`Generic import ${id} has already been committed to this project.`), {
          statusCode: 409,
          code: "duplicate_import_already_committed",
          details: { importId: id },
        });
      }
      return;
    }
    if (id) seen.add(id);
    next.push(copy(item));
  });

  return { merged: next, incomingIds };
}

function mergeObject(parentValue, patchValue) {
  return {
    ...copy(parentValue || {}),
    ...copy(patchValue || {}),
  };
}

function datasetCommitError(statusCode, code, message, details = undefined) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    ...(details ? { details } : {}),
  });
}

function valueKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function experimentKey(experiment, index) {
  return valueKey(experiment?.label || experiment?.name || experiment?.title || `row_${index + 1}`) || `row_${index + 1}`;
}

function fieldIdentity(field) {
  return valueKey(field?.canonicalField || field?.field || field?.displayName || field?.fieldId || field?.columnId || "field");
}

function comparableValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toPrecision(12)) : String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fieldSignature(field) {
  return JSON.stringify({
    value: comparableValue(field?.value),
    rawValue: comparableValue(field?.rawValue),
    unit: field?.unit ?? null,
  });
}

function warningSignature(warnings) {
  return JSON.stringify(asArray(warnings).map((warning) => ({
    code: warning?.code || null,
    message: warning?.message || null,
    severity: warning?.severity || null,
  })));
}

function importFieldRows(genericImport = {}) {
  const experiments = asArray(genericImport.experiments);
  const experimentKeys = new Map(experiments.map((experiment, index) => [
    experiment?.experimentId,
    experimentKey(experiment, index),
  ]));
  const fields = asArray(genericImport.fields).length
    ? asArray(genericImport.fields)
    : [
      ...asArray(genericImport.metadata).map((item) => ({ ...item, role: item?.role || "metadata" })),
      ...asArray(genericImport.measurements).map((item) => ({ ...item, role: item?.role || "measurement" })),
    ];
  return fields.map((field, index) => {
    const expKey = experimentKeys.get(field?.experimentId) || `field_${index + 1}`;
    const role = valueKey(field?.role || "metadata") || "metadata";
    const identity = fieldIdentity(field);
    const unit = valueKey(field?.unit || "");
    return {
      key: `${expKey}::${role}::${identity}::${unit}`,
      experimentKey: expKey,
      signature: fieldSignature(field),
      warningSignature: warningSignature(field?.warnings),
    };
  });
}

function mapByKey(items) {
  return new Map(items.map((item) => [item.key, item]));
}

function summarizeImportDiff(targetImport, replacementImport) {
  const oldExperimentKeys = new Set(asArray(targetImport?.experiments).map(experimentKey));
  const newExperimentKeys = new Set(asArray(replacementImport?.experiments).map(experimentKey));
  const oldFields = mapByKey(importFieldRows(targetImport));
  const newFields = mapByKey(importFieldRows(replacementImport));
  const changedExperimentKeys = new Set();
  let valuesChanged = 0;
  let warningsChanged = 0;

  for (const [key, newField] of newFields.entries()) {
    const oldField = oldFields.get(key);
    if (!oldField) continue;
    if (oldField.signature !== newField.signature) {
      valuesChanged += 1;
      changedExperimentKeys.add(newField.experimentKey);
    }
    if (oldField.warningSignature !== newField.warningSignature) {
      warningsChanged += 1;
      changedExperimentKeys.add(newField.experimentKey);
    }
  }

  asArray(targetImport?.experiments).forEach((experiment, index) => {
    if (warningSignature(experiment?.warnings) !== warningSignature(asArray(replacementImport?.experiments)[index]?.warnings)) {
      warningsChanged += 1;
      changedExperimentKeys.add(experimentKey(experiment, index));
    }
  });

  return {
    experimentsAdded: [...newExperimentKeys].filter((key) => !oldExperimentKeys.has(key)).length,
    experimentsRemoved: [...oldExperimentKeys].filter((key) => !newExperimentKeys.has(key)).length,
    experimentsChanged: changedExperimentKeys.size,
    fieldsAdded: [...newFields.keys()].filter((key) => !oldFields.has(key)).length,
    fieldsRemoved: [...oldFields.keys()].filter((key) => !newFields.has(key)).length,
    valuesChanged,
    warningsChanged,
  };
}

function diffHasChanges(summary) {
  return Object.values(summary || {}).some((value) => Number(value || 0) > 0);
}

function replacementImportFromPatch(datasetPatch = {}) {
  const imports = asArray(datasetPatch.genericImports).filter(Boolean);
  if (imports.length !== 1) {
    throw datasetCommitError(
      400,
      "invalid_refresh_request",
      "Refresh requires exactly one normalized generic import replacement.",
      { genericImportCount: imports.length },
    );
  }
  return imports[0];
}

function findRefreshTarget(parentDatasetPayload = {}, replaceImportId) {
  const genericImports = asArray(parentDatasetPayload.genericImports);
  const index = genericImports.findIndex((item) => item?.importId === replaceImportId);
  if (index < 0) {
    throw datasetCommitError(
      404,
      "refresh_target_not_found",
      "The import selected for refresh was not found in the current dataset commit.",
      { replaceImportId },
    );
  }
  return { genericImports, index, targetImport: genericImports[index] };
}

export function assertExpectedParentDatasetCommit(parentCommit, expectedParentDatasetCommitId) {
  if (!expectedParentDatasetCommitId) {
    throw datasetCommitError(
      400,
      "invalid_refresh_request",
      "Refresh requires expectedParentDatasetCommitId.",
    );
  }
  if (!parentCommit?.id || parentCommit.id !== expectedParentDatasetCommitId) {
    throw datasetCommitError(
      409,
      "dataset_commit_conflict",
      "The project dataset changed before this refresh was applied.",
      {
        expectedParentDatasetCommitId,
        currentDatasetCommitId: parentCommit?.id || null,
      },
    );
  }
}

export function buildImportRefreshPreview({
  parentCommit,
  datasetPatch = {},
  replaceImportId,
  expectedParentDatasetCommitId,
} = {}) {
  if (!replaceImportId) {
    throw datasetCommitError(400, "invalid_refresh_request", "Refresh requires replaceImportId.");
  }
  assertExpectedParentDatasetCommit(parentCommit, expectedParentDatasetCommitId);
  const replacementImport = replacementImportFromPatch(datasetPatch);
  const { targetImport } = findRefreshTarget(parentCommit?.datasetPayload || {}, replaceImportId);
  const summary = summarizeImportDiff(targetImport, replacementImport);
  return {
    schemaVersion: "labrat.importRefreshPreview.v1",
    targetImportId: replaceImportId,
    replacementImportId: replacementImport?.importId || null,
    parentDatasetCommitId: parentCommit?.id || null,
    hasChanges: diffHasChanges(summary),
    summary,
    warnings: [],
  };
}

export function buildRefreshDatasetCommitPayload({
  parentCommit,
  datasetPatch = {},
  replaceImportId,
  importRunId = null,
  appliedAt = new Date().toISOString(),
} = {}) {
  if (!replaceImportId) {
    throw datasetCommitError(400, "invalid_refresh_request", "Refresh requires replaceImportId.");
  }
  const parentDatasetPayload = isObject(parentCommit?.datasetPayload) ? parentCommit.datasetPayload : {};
  const replacementImport = replacementImportFromPatch(datasetPatch);
  const { genericImports, index, targetImport } = findRefreshTarget(parentDatasetPayload, replaceImportId);
  const replacementImportId = replacementImport?.importId || null;
  const duplicate = genericImports.find((item, itemIndex) => itemIndex !== index && item?.importId === replacementImportId);
  if (duplicate) {
    throw datasetCommitError(
      409,
      "duplicate_import_already_committed",
      `Generic import ${replacementImportId} has already been committed to this project.`,
      { importId: replacementImportId },
    );
  }
  const refreshSummary = summarizeImportDiff(targetImport, replacementImport);
  if (!diffHasChanges(refreshSummary)) {
    throw datasetCommitError(
      409,
      "refresh_no_changes_detected",
      "The refreshed import does not change the active dataset.",
      { replaceImportId, replacementImportId },
    );
  }

  const refreshedImport = {
    ...copy(replacementImport),
    refreshOfImportId: replaceImportId,
    refreshMetadata: {
      schemaVersion: "labrat.importRefresh.v1",
      refreshOfImportId: replaceImportId,
      replacementImportId,
      sourceImportRunId: importRunId,
      appliedAt,
    },
  };
  const next = copy(parentDatasetPayload) || {};
  next.genericImports = genericImports.map((item, itemIndex) => (
    itemIndex === index ? refreshedImport : copy(item)
  ));
  return {
    datasetPayload: next,
    replacedImportId: replaceImportId,
    replacementImportId,
    refreshSummary,
    counts: datasetPayloadCounts(next),
  };
}

export function buildNextDatasetCommitPayload({ parentDatasetPayload = {}, datasetPatch = {} } = {}) {
  const parent = isObject(parentDatasetPayload) ? parentDatasetPayload : {};
  const patch = isObject(datasetPatch) ? datasetPatch : {};
  const next = copy(parent) || {};
  const addedImportIds = [];

  Object.entries(patch).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      const { merged, incomingIds } = mergeArray(parent[key], value, key);
      next[key] = merged;
      if (key === "genericImports") addedImportIds.push(...incomingIds);
      return;
    }
    if (isObject(value) && isObject(parent[key])) {
      next[key] = mergeObject(parent[key], value);
      return;
    }
    next[key] = copy(value);
  });

  return {
    datasetPayload: next,
    addedImportIds,
    counts: datasetPayloadCounts(next),
  };
}

export function buildDatasetCommitSummary({
  parentCommit,
  datasetPatch = {},
  datasetPayload = {},
  normalizeSummary = {},
  sourceImportRunIds = [],
} = {}) {
  const patchImports = asArray(datasetPatch.genericImports);
  const counts = datasetPayloadCounts(datasetPayload);
  return {
    ...copy(normalizeSummary || {}),
    parentCommitId: parentCommit?.id || null,
    sourceImportRunIds: asArray(sourceImportRunIds),
    addedImportIds: patchImports.map((item) => item?.importId).filter(Boolean),
    addedGenericImportCount: patchImports.length,
    addedExperimentCount: patchImports.reduce((total, item) => total + asArray(item?.experiments).length, 0),
    addedFieldCount: patchImports.reduce((total, item) => total + asArray(item?.fields).length, 0),
    addedMeasurementCount: patchImports.reduce((total, item) => total + asArray(item?.measurements).length, 0),
    totalGenericImportCount: counts.genericImportCount,
    totalExperimentCount: counts.experimentCount,
    totalFieldCount: counts.fieldCount,
    totalMeasurementCount: counts.measurementCount,
    warningCount: counts.warningCount,
  };
}
