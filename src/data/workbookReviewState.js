function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function regionId(region) {
  return String(region?.draftRegionId || region?.clientRegionId || "").trim();
}

function normalizeDraftRegion(region) {
  if (!region?.sourceDocumentId || !region?.sheetName || !region?.range) return null;
  const id = regionId(region);
  return {
    ...region,
    clientRegionId: region.clientRegionId || id,
    draftRegionId: region.draftRegionId || id,
    status: region.status || "draft",
  };
}

function visibleDraftRegions(regions) {
  return asArray(regions)
    .map(normalizeDraftRegion)
    .filter(Boolean)
    .filter((region) => !["removed", "deleted"].includes(region.status));
}

export function reconcileWorkbookDraftRegions(existingRegions, response = {}, updatedSession = null) {
  const serverDraftRegions = updatedSession?.currentUnderstanding?.draftRegions;
  if (Array.isArray(serverDraftRegions)) return visibleDraftRegions(serverDraftRegions);

  const regionsById = new Map();
  visibleDraftRegions(existingRegions).forEach((region) => {
    const id = regionId(region);
    if (id) regionsById.set(id, region);
  });
  asArray(response.changedRegions).forEach((changedRegion) => {
    const normalized = normalizeDraftRegion(changedRegion);
    const id = regionId(normalized);
    if (!normalized || !id) return;
    if (["removed", "deleted"].includes(normalized.status)) {
      regionsById.delete(id);
      return;
    }
    regionsById.set(id, normalized);
  });
  return [...regionsById.values()];
}

function detectedRegionDraftId(sourceDocumentId, sheetName, range) {
  return `draft_${sourceDocumentId}_${sheetName}_${range}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function initialWorkbookDraftRegions(response = {}, session = null) {
  if (Array.isArray(session?.currentUnderstanding?.draftRegions)) {
    return reconcileWorkbookDraftRegions([], {}, session);
  }
  const sourceDocumentId = response.sourceDocument?.id || session?.sourceDocumentId || "";
  const regionsById = new Map();
  asArray(response.regions).forEach((region) => {
    const nextSourceDocumentId = region?.sourceDocumentId || sourceDocumentId;
    const sheetName = region?.sheetName || region?.sheet_name || region?.sheet || "";
    const range = region?.range || region?.rangeRef || region?.range_ref || "";
    if (!nextSourceDocumentId || !sheetName || !range) return;
    const id = detectedRegionDraftId(nextSourceDocumentId, sheetName, range);
    regionsById.set(id, {
      clientRegionId: id,
      draftRegionId: id,
      operation: "upsert",
      sourceRegionId: region.id || region.sourceRegionId || null,
      sourceDocumentId: nextSourceDocumentId,
      sheetName,
      range,
      semanticType: region.semanticType || region.kind || "unclassified",
      description: region.description || region.label || region.summary || "",
      selectionMethod: "detected_region",
      confidence: region.confidence ?? null,
      warnings: asArray(region.warnings),
      status: "draft",
    });
  });
  return [...regionsById.values()];
}
