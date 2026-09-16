import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyServerRegionExtractionTemplate,
  confirmServerWorkbookReviewRegionsBatch,
  matchServerRegionExtractionTemplate,
} from "../data/serverApi.js";
import { listExperimentBrowserRows } from "../data/experimentBrowserApi.js";
import {
  createWorkbookBatchItems,
  runWorkbookBatchUpload,
  suggestExperimentForFile,
  summarizeWorkbookBatch,
  workbookBatchItemForStorage,
} from "../data/workbookBatchUpload.js";
import { uid } from "../utils/format";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function workbookBatchSummaryText(items) {
  const summary = summarizeWorkbookBatch(items);
  if (summary.uploading || summary.pending) {
    return `Uploading ${summary.total} workbooks: ${summary.uploaded} indexed, ${summary.failed} failed so far.`;
  }
  if (!summary.failed) {
    return `I indexed ${summary.uploaded} workbooks. AI is understanding their regions in the background; open any file to review it.`;
  }
  if (!summary.uploaded) {
    return `None of the ${summary.total} workbooks could be uploaded. Fix the errors below and retry.`;
  }
  return `I indexed ${summary.uploaded} of ${summary.total} workbooks. ${summary.failed} failed; retry them below or re-attach the files.`;
}

function compactTemplateMatch(result) {
  return {
    sourceDocumentId: result?.sourceDocumentId || "",
    workbookName: result?.workbookName || "",
    status: result?.status || "no_match",
    sheetName: result?.sheetName || "",
    matchedRange: result?.matchedRange || null,
    offset: result?.offset || null,
    experimentLabel: result?.experimentLabel || null,
    labelSource: result?.labelSource || null,
    isTemplateSource: Boolean(result?.isTemplateSource),
    eligibleForBatchConfirm: Boolean(result?.eligibleForBatchConfirm),
    eligibleForPrefill: result?.eligibleForPrefill === undefined
      ? Boolean(result?.eligibleForBatchConfirm)
      : Boolean(result?.eligibleForPrefill),
    headerRuns: asArray(result?.headerRuns).slice(0, 4),
    formulaMismatches: asArray(result?.formulaMismatches).slice(0, 8).map((item) => ({ address: item.address, found: item.found })),
    typedOverCells: asArray(result?.typedOverCells).slice(0, 8).map((item) => ({ address: item.address, found: item.found })),
    brokenCells: asArray(result?.brokenCells).slice(0, 8).map((item) => ({ address: item.address })),
    alternatives: asArray(result?.alternatives).slice(0, 4).map((item) => ({ matchedRange: item.matchedRange, offset: item.offset })),
  };
}

function appliedRowFromEntry(entry, batch) {
  const item = asArray(batch?.items).find((candidate) => candidate.workbookReviewLink?.sourceDocumentId === entry.sourceDocumentId);
  const region = entry.region || {};
  return {
    sourceDocumentId: entry.sourceDocumentId,
    fileName: item?.fileName || entry.workbookName || entry.sourceDocumentId,
    workbookReviewSessionId: entry.workbookReviewSessionId || region.workbookReviewSessionId || item?.workbookReviewLink?.workbookReviewSessionId || "",
    regionId: region.id || "",
    revisionId: entry.revision?.id || region.currentRevisionId || "",
    regionVersion: region.version,
    sheetName: region.sheetName || "",
    range: region.rangeRef || "",
    status: entry.status,
    reason: entry.reason,
    experimentLabel: region.templateMatch?.experimentLabel || null,
    linkStatus: region.templateMatch?.linkStatus || "none",
    linkedExperimentId: region.linkedExperimentId || null,
    matchStatus: region.templateMatch?.status || entry.status || null,
    // Typed-over formulas are prefilled but must be confirmed one at a time.
    needsIndividualConfirm: region.templateMatch?.status === "formula_mismatch",
    warning: asArray(region.warnings).find((item) => item?.code === "template_formula_mismatch")?.message || "",
    // Matched, but with typed numbers where the template expects formulas:
    // stays out of the default selection until the user looks at it.
    typedOver: region.templateMatch?.status !== "formula_mismatch"
      && asArray(region.warnings).some((item) => item?.code === "template_formula_mismatch"),
    confirmed: region.reviewStatus === "accepted",
    error: entry.warning?.message || "",
  };
}

async function defaultLoadExperiments(projectId) {
  if (!projectId) return [];
  try {
    const response = await listExperimentBrowserRows(projectId, { limit: 200 });
    return asArray(response?.rows)
      .map((row) => ({ experimentId: row?.experimentId || "", label: row?.label || "" }))
      .filter((row) => row.experimentId && row.label);
  } catch {
    return [];
  }
}

// Batch workbook upload, extraction-template match/apply, and one-click
// confirmation. The caller owns where the batch record lives (a chat message,
// onboarding state) and receives every change through onBatchUpdate(batchId,
// updater, { phase }); this hook owns the in-flight flags and the File objects
// needed for retry.
export function useWorkbookBatchActions({
  projectId = "",
  uploadFile,
  reloadProject,
  onBatchUpdate,
  onUploaded,
  loadExperiments,
} = {}) {
  const [retryingBatchId, setRetryingBatchId] = useState("");
  const [matchingBatchId, setMatchingBatchId] = useState("");
  const [applyingBatchId, setApplyingBatchId] = useState("");
  const [confirmingBatchId, setConfirmingBatchId] = useState("");
  const [experiments, setExperiments] = useState([]);
  const filesRef = useRef(new Map());
  const optionsRef = useRef({});
  optionsRef.current = { projectId, uploadFile, reloadProject, onBatchUpdate, onUploaded, loadExperiments };

  // Retry files belong to the project they were picked for.
  useEffect(() => () => {
    filesRef.current.clear();
  }, [projectId]);

  const update = useCallback((batchId, updater, phase) => {
    optionsRef.current.onBatchUpdate?.(batchId, updater, { phase });
  }, []);

  const fetchExperiments = useCallback(async () => {
    const { loadExperiments: custom, projectId: currentProjectId } = optionsRef.current;
    if (typeof custom === "function") {
      try {
        return asArray(await custom());
      } catch {
        return [];
      }
    }
    return defaultLoadExperiments(currentProjectId);
  }, []);

  const reload = useCallback(async () => {
    try {
      await optionsRef.current.reloadProject?.();
    } catch {
      // The next explicit project refresh reloads state; batch results are already shown.
    }
  }, []);

  const rememberFiles = useCallback((batchId, files) => {
    if (batchId && asArray(files).length) filesRef.current.set(batchId, asArray(files));
  }, []);

  const hasFiles = useCallback((batchId) => filesRef.current.has(batchId), []);

  const runBatch = useCallback(async (batchId, files, { items = null, onlyIndexes = null, signal = null } = {}) => {
    const { uploadFile: upload, onUploaded: uploaded } = optionsRef.current;
    if (typeof upload !== "function") throw new Error("A workbook upload function is required.");
    const knownExperiments = await fetchExperiments();
    const seededItems = (asArray(items).length ? asArray(items) : createWorkbookBatchItems(files)).map((item) => ({
      ...item,
      suggestedExperiment: suggestExperimentForFile(item.fileName, knownExperiments),
    }));
    const finalItems = await runWorkbookBatchUpload({
      files,
      items: seededItems,
      onlyIndexes,
      ...(signal ? { signal } : {}),
      uploadFile: (file, item, extra) => upload(file, item, extra),
      onUpdate: (nextItems) => update(batchId, (batch) => ({
        ...batch,
        items: nextItems.map(workbookBatchItemForStorage),
      }), "upload"),
    });
    const uploadedSessions = finalItems
      .filter((item) => item.status === "uploaded" && item.result?.session?.id)
      .map((item) => ({
        sessionId: item.result.session.id,
        sourceDocumentId: item.result.sourceDocument?.id || item.result.session.sourceDocumentId || "",
        workbookName: item.workbookReviewLink?.workbookName || item.fileName,
        regions: asArray(item.result.response?.reviewRegions),
      }));
    update(batchId, (batch) => ({ ...batch, items: finalItems.map(workbookBatchItemForStorage) }), "upload");
    if (uploadedSessions.length) uploaded?.(uploadedSessions);
    await reload();
    return finalItems;
  }, [fetchExperiments, reload, update]);

  const retryBatch = useCallback(async (batch) => {
    const batchId = batch?.batchId;
    const files = filesRef.current.get(batchId);
    if (!batchId || !files || retryingBatchId) return;
    const failedIndexes = asArray(batch.items).filter((item) => item.status === "failed").map((item) => item.index);
    if (!failedIndexes.length) return;
    setRetryingBatchId(batchId);
    try {
      return await runBatch(batchId, files, { items: batch.items, onlyIndexes: failedIndexes });
    } finally {
      setRetryingBatchId("");
    }
  }, [retryingBatchId, runBatch]);

  const matchTemplate = useCallback(async (batch, template) => {
    const batchId = batch?.batchId;
    if (!batchId || !template?.currentVersionId || matchingBatchId) return;
    const sourceDocumentIds = asArray(batch.items)
      .filter((item) => item.status === "uploaded" && item.workbookReviewLink?.sourceDocumentId)
      .map((item) => item.workbookReviewLink.sourceDocumentId);
    if (!sourceDocumentIds.length) return;
    setMatchingBatchId(batchId);
    try {
      const response = await matchServerRegionExtractionTemplate(template.currentVersionId, { sourceDocumentIds });
      update(batchId, (current) => ({
        ...current,
        match: {
          templateId: template.id,
          templateName: response?.templateName || template.name,
          templateVersionId: response?.templateVersionId || template.currentVersionId,
          templateVersion: response?.templateVersion || template.currentVersion || 1,
          summary: response?.summary || {},
          results: asArray(response?.matches).map(compactTemplateMatch),
          error: "",
        },
      }), "match");
    } catch (error) {
      update(batchId, (current) => ({
        ...current,
        match: {
          ...(current?.match || {}),
          templateId: template.id,
          templateName: template.name,
          templateVersion: template.currentVersion || 1,
          results: asArray(current?.match?.results),
          summary: current?.match?.summary || {},
          error: `Template match failed: ${error?.message || String(error)}`,
        },
      }), "match");
    } finally {
      setMatchingBatchId("");
    }
  }, [matchingBatchId, update]);

  const applyTemplate = useCallback(async (batch, sourceDocumentIds, { onlyStatuses = null } = {}) => {
    const batchId = batch?.batchId;
    const templateVersionId = batch?.match?.templateVersionId;
    if (!batchId || !templateVersionId || applyingBatchId || !asArray(sourceDocumentIds).length) return;
    setApplyingBatchId(batchId);
    try {
      const [response, knownExperiments] = await Promise.all([
        applyServerRegionExtractionTemplate(templateVersionId, {
          sourceDocumentIds,
          idempotencyKey: `apply_template_${uid()}`,
          ...(asArray(onlyStatuses).length ? { onlyStatuses: asArray(onlyStatuses) } : {}),
        }),
        fetchExperiments(),
      ]);
      setExperiments(knownExperiments);
      const rows = [
        ...asArray(response?.applied).map((entry) => appliedRowFromEntry(entry, batch)),
        ...asArray(response?.skipped).filter((entry) => entry.region?.id).map((entry) => appliedRowFromEntry(entry, batch)),
      ];
      // A second apply (for example the typed-over files after the clean ones)
      // adds rows rather than replacing the list.
      update(batchId, (current) => {
        const previous = current?.apply?.templateVersionId === templateVersionId ? asArray(current?.apply?.items) : [];
        const incoming = new Set(rows.map((row) => row.sourceDocumentId));
        return {
          ...current,
          apply: {
            templateVersionId,
            templateName: response?.templateName || batch.match?.templateName || "",
            items: [...previous.filter((row) => !incoming.has(row.sourceDocumentId)), ...rows],
            error: "",
          },
        };
      }, "apply");
      await reload();
    } catch (error) {
      update(batchId, (current) => ({
        ...current,
        apply: { ...(current?.apply || { items: [] }), templateVersionId, error: `Template apply failed: ${error?.message || String(error)}` },
      }), "apply");
    } finally {
      setApplyingBatchId("");
    }
  }, [applyingBatchId, fetchExperiments, reload, update]);

  const confirmRegions = useCallback(async (batch, selection) => {
    const batchId = batch?.batchId;
    const { projectId: currentProjectId } = optionsRef.current;
    if (!batchId || !currentProjectId || confirmingBatchId || !asArray(selection).length) return;
    setConfirmingBatchId(batchId);
    try {
      const response = await confirmServerWorkbookReviewRegionsBatch(currentProjectId, { items: selection });
      const resultsByRegion = new Map(asArray(response?.results).map((result) => [result.regionId, result]));
      update(batchId, (current) => ({
        ...current,
        apply: {
          ...(current?.apply || {}),
          items: asArray(current?.apply?.items).map((row) => {
            const result = resultsByRegion.get(row.regionId);
            if (!result) return row;
            return result.ok
              ? {
                ...row,
                confirmed: true,
                error: "",
                regionVersion: result.region?.version ?? row.regionVersion,
                linkedExperimentId: result.region?.linkedExperimentId ?? row.linkedExperimentId,
                linkStatus: result.region?.templateMatch?.linkStatus || row.linkStatus,
                experimentLabel: result.region?.templateMatch?.experimentLabel || row.experimentLabel,
              }
              : { ...row, error: result.message || result.code || "Confirmation failed." };
          }),
          error: "",
        },
      }), "confirm");
      await reload();
    } catch (error) {
      update(batchId, (current) => ({
        ...current,
        apply: { ...(current?.apply || { items: [] }), error: `Batch confirmation failed: ${error?.message || String(error)}` },
      }), "confirm");
    } finally {
      setConfirmingBatchId("");
    }
  }, [confirmingBatchId, reload, update]);

  return {
    runBatch,
    retryBatch,
    matchTemplate,
    applyTemplate,
    confirmRegions,
    rememberFiles,
    hasFiles,
    retryingBatchId,
    matchingBatchId,
    applyingBatchId,
    confirmingBatchId,
    experiments,
  };
}
