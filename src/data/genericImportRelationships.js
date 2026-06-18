function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function byId(values, key = "id") {
  const map = new Map();
  asArray(values).forEach((value) => {
    const id = value?.[key];
    if (id) map.set(id, value);
  });
  return map;
}

export function isSupplementalImport(genericImport) {
  return genericImport?.relationship?.relationship === "supplement"
    || Boolean(genericImport?.relationship?.supplementType)
    || asArray(genericImport?.observationSets).length > 0;
}

export function getSupplementalImports(dataset = {}) {
  return asArray(dataset.genericImports).filter(isSupplementalImport);
}

export function getMasterImports(dataset = {}) {
  return asArray(dataset.genericImports).filter((genericImport) => !isSupplementalImport(genericImport));
}

export function hasMasterImport(dataset = {}) {
  return getMasterImports(dataset).length > 0;
}

function importFileName(genericImport = {}, fileObject = null, importRun = null) {
  return firstText(
    genericImport.fileName,
    genericImport.originalName,
    genericImport.files?.[0]?.fileName,
    genericImport.files?.[0]?.name,
    fileObject?.originalName,
    importRun?.scanResult?.file?.name,
    genericImport.importId,
  );
}

function supplementTypeFor(genericImport = {}) {
  const observationSetKinds = asArray(genericImport.observationSets).map((set) => set?.kind).filter(Boolean);
  return firstText(
    genericImport.relationship?.supplementType,
    genericImport.supplementType,
    observationSetKinds[0],
    genericImport.relationship?.relationship === "supplement" ? "supplemental_data" : "",
  );
}

function targetLabelsFor(genericImport = {}) {
  const ids = [
    ...asArray(genericImport.relationship?.targetExperimentIds),
    ...asArray(genericImport.relatedExperimentIds),
    ...asArray(genericImport.observationSets).flatMap((set) => asArray(set?.targetExperimentIds)),
  ];
  const inferred = asArray(genericImport.observationSets)
    .map((set) => set?.inferredExperimentLabel)
    .filter(Boolean);
  return [...new Set([...inferred, ...ids].map((value) => String(value || "").trim()).filter(Boolean))];
}

function observationSummary(genericImport = {}) {
  const observationSets = asArray(genericImport.observationSets);
  const observationCount = observationSets.reduce((total, set) => {
    const summaryCount = Number(set?.summary?.observationCount);
    return total + (Number.isFinite(summaryCount) ? summaryCount : asArray(set?.observations).length);
  }, 0);
  const yFields = [...new Set(observationSets.flatMap((set) => asArray(set?.yFields)).filter(Boolean))];
  return {
    observationSetCount: observationSets.length,
    observationCount,
    yFields,
  };
}

export function supplementalImportsForProject(projectState = {}, dataset = {}) {
  projectState = projectState || {};
  const fileObjectsById = byId(projectState.fileObjects);
  const importRunsById = byId(projectState.importRuns);
  return getSupplementalImports(dataset).map((genericImport) => {
    const importRun = importRunsById.get(genericImport.importRunId);
    const fileObject = fileObjectsById.get(genericImport.fileObjectId || importRun?.fileObjectId);
    const observations = observationSummary(genericImport);
    return {
      id: genericImport.importId || fileObject?.id || importRun?.id || importFileName(genericImport, fileObject, importRun),
      importId: genericImport.importId || null,
      fileName: importFileName(genericImport, fileObject, importRun),
      supplementType: supplementTypeFor(genericImport),
      targetLabels: targetLabelsFor(genericImport),
      observationSetCount: observations.observationSetCount,
      observationCount: observations.observationCount,
      yFields: observations.yFields,
      fieldCount: asArray(genericImport.fields).length,
      sourceCount: asArray(genericImport.sources).length,
      status: "applied",
      updatedAt: genericImport.appliedAt || genericImport.relationship?.appliedAt || importRun?.updatedAt || importRun?.createdAt || null,
    };
  });
}

export function pendingSupplementalImportRunsForProject(projectState = {}) {
  projectState = projectState || {};
  const fileObjectsById = byId(projectState.fileObjects);
  return asArray(projectState.importRuns)
    .filter((run) => run?.status && run.status !== "applied")
    .filter((run) => {
      const scanSheets = asArray(run.scanResult?.sheets);
      const normalizedImports = asArray(run.normalizePreview?.datasetPatch?.genericImports);
      return scanSheets.some((sheet) => asArray(sheet.blocks).some((block) => block?.detectedSupplementType))
        || normalizedImports.some(isSupplementalImport)
        || run.reviewDecisions?.applyMode === "supplement_import";
    })
    .map((run) => {
      const fileObject = fileObjectsById.get(run.fileObjectId);
      const normalizedImport = asArray(run.normalizePreview?.datasetPatch?.genericImports).find(isSupplementalImport) || {};
      const observations = observationSummary(normalizedImport);
      return {
        id: run.id,
        importRunId: run.id,
        fileName: firstText(fileObject?.originalName, run.scanResult?.file?.name, run.id),
        supplementType: firstText(
          supplementTypeFor(normalizedImport),
          asArray(run.scanResult?.sheets).flatMap((sheet) => asArray(sheet.blocks)).find((block) => block?.detectedSupplementType)?.detectedSupplementType,
          "supplemental_data",
        ),
        targetLabels: targetLabelsFor(normalizedImport),
        observationSetCount: observations.observationSetCount,
        observationCount: observations.observationCount,
        yFields: observations.yFields,
        fieldCount: asArray(normalizedImport.fields).length,
        sourceCount: asArray(normalizedImport.sources).length,
        status: run.status,
        updatedAt: run.updatedAt || run.createdAt || null,
      };
    });
}

export function supplementalWorkbookSummariesForProject(projectState = {}, dataset = {}) {
  projectState = projectState || {};
  return [
    ...supplementalImportsForProject(projectState, dataset),
    ...pendingSupplementalImportRunsForProject(projectState),
  ];
}
