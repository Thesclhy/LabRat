import { runImportScan } from "../import/services/importPipeline.js";
import { normalizeApprovedScan } from "../import/services/normalizer.js";
import { validateNormalizeRequest } from "../import/schemas/normalizationSchemas.js";
import { activeChartSpecs } from "./chartSpecStaleness.js";
import { readFileObjectBuffer } from "./fileStorage.js";
import { buildImportRelationshipPreview } from "./importRelationshipResolver.js";

const BATCH_SCHEMA_VERSION = "labrat.supplementalImportBatch.v1";
const TERMINAL_ITEM_STATUSES = new Set(["ready_for_review", "failed"]);
const RUNNING_BATCHES = new Set();
const SUBSCRIBERS = new Map();
const BACKEND_BATCH_CONCURRENCY = 2;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanError(error) {
  return {
    code: error?.code || "supplemental_batch_item_failed",
    message: error?.message || String(error) || "Supplemental workbook processing failed.",
  };
}

function collectBlockIds(scanResult) {
  return asArray(scanResult?.sheets).flatMap((sheet) => (
    asArray(sheet?.blocks).map((block) => block?.blockId).filter(Boolean)
  ));
}

function batchSummary(items = []) {
  const total = items.length;
  const ready = items.filter((item) => item.status === "ready_for_review").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const processing = items.filter((item) => !TERMINAL_ITEM_STATUSES.has(item.status)).length;
  return {
    total,
    ready,
    failed,
    processing,
    completed: ready + failed,
  };
}

function batchStatus(items = []) {
  if (!items.length) return "completed";
  const summary = batchSummary(items);
  if (summary.completed < summary.total) return "processing";
  if (summary.ready > 0) return "ready_for_review";
  return "failed";
}

export function publicSupplementalImportBatch(batch) {
  const items = asArray(batch?.items).map((item) => ({
    id: item.id,
    batchId: item.batchId,
    fileObjectId: item.fileObjectId,
    importRunId: item.importRunId || null,
    fileName: item.fileName,
    status: item.status,
    progressMessage: item.progressMessage || "",
    summary: item.summary || {},
    relationshipPreview: item.relationshipPreview || null,
    warnings: item.warnings || [],
    error: item.error || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
  return {
    schemaVersion: BATCH_SCHEMA_VERSION,
    id: batch.id,
    labId: batch.labId,
    projectId: batch.projectId,
    status: batch.status,
    summary: batch.summary && Object.keys(batch.summary).length ? batch.summary : batchSummary(items),
    items,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

function sseWrite(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitBatchEvent(batchId, event, payload) {
  const subscribers = SUBSCRIBERS.get(batchId);
  if (!subscribers) return;
  for (const res of subscribers) {
    try {
      sseWrite(res, event, payload);
    } catch {
      subscribers.delete(res);
    }
  }
}

export function subscribeSupplementalImportBatchEvents(batch, res) {
  const batchId = batch.id;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  if (!SUBSCRIBERS.has(batchId)) SUBSCRIBERS.set(batchId, new Set());
  SUBSCRIBERS.get(batchId).add(res);
  sseWrite(res, "snapshot", { batch: publicSupplementalImportBatch(batch) });
  if (!["queued", "processing"].includes(batch.status)) {
    sseWrite(res, "complete", { batch: publicSupplementalImportBatch(batch) });
  }
  const keepAlive = setInterval(() => {
    try {
      res.write(": keep-alive\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 15000);
  res.on("close", () => {
    clearInterval(keepAlive);
    const subscribers = SUBSCRIBERS.get(batchId);
    if (!subscribers) return;
    subscribers.delete(res);
    if (!subscribers.size) SUBSCRIBERS.delete(batchId);
  });
}

async function emitLatestBatch(context, batchId, event = "batch") {
  const latest = await context.store.findSupplementalImportBatchById(batchId);
  if (latest) emitBatchEvent(batchId, event, { batch: publicSupplementalImportBatch(latest) });
  return latest;
}

async function updateBatchFromItems(context, batchId, updatedBy) {
  const current = await context.store.findSupplementalImportBatchById(batchId);
  if (!current) return null;
  const summary = batchSummary(current.items);
  const status = batchStatus(current.items);
  await context.store.updateSupplementalImportBatch(batchId, { status, summary, updatedBy });
  return emitLatestBatch(context, batchId, status === "processing" ? "batch" : "complete");
}

async function updateItem(context, batch, item, changes, event = "item") {
  await context.store.updateSupplementalImportBatchItem(batch.id, item.id, changes);
  const latest = await updateBatchFromItems(context, batch.id, changes.updatedBy || batch.updatedBy || batch.createdBy);
  emitBatchEvent(batch.id, event, { batch: publicSupplementalImportBatch(latest) });
  return latest?.items?.find((candidate) => candidate.id === item.id) || item;
}

async function processOneItem(context, batch, item, userId) {
  let importRun = null;
  try {
    item = await updateItem(context, batch, item, {
      status: "scanning",
      progressMessage: "Scanning workbook structure...",
      error: null,
      updatedBy: userId,
    });
    const fileObject = await context.store.findFileObjectById(item.fileObjectId);
    if (!fileObject || fileObject.projectId !== batch.projectId) {
      throw Object.assign(new Error("File object not found for this project."), { code: "file_object_not_found" });
    }
    const buffer = await readFileObjectBuffer(context.config, fileObject);
    const scanFileId = fileObject.checksumSha256
      ? `upload_${String(fileObject.checksumSha256).slice(0, 16)}`
      : fileObject.id;
    const scanResult = runImportScan({
      fileId: scanFileId,
      checksumSha256: fileObject.checksumSha256,
      filename: fileObject.originalName,
      contentType: fileObject.mimeType,
      sizeBytes: fileObject.sizeBytes,
      buffer,
    });
    importRun = await context.store.createImportRun({
      labId: batch.labId,
      projectId: batch.projectId,
      fileObjectId: fileObject.id,
      status: "review_ready",
      scanResult,
      warnings: scanResult.warnings || [],
      createdBy: userId,
    });
    await context.store.recordAuditEvent({
      labId: batch.labId,
      projectId: batch.projectId,
      actorUserId: userId,
      action: "import.scan",
      targetType: "import_run",
      targetId: importRun.id,
      summary: `Created supplemental batch import run for ${fileObject.originalName}.`,
      metadata: { batchId: batch.id, batchItemId: item.id },
    });
    item = await updateItem(context, batch, item, {
      importRunId: importRun.id,
      status: "normalizing",
      progressMessage: "Normalizing reviewable supplemental data...",
      warnings: scanResult.warnings || [],
      updatedBy: userId,
    });

    const approvedBlockIds = collectBlockIds(scanResult);
    if (!approvedBlockIds.length) {
      throw Object.assign(new Error("No importable workbook blocks were detected."), { code: "no_importable_blocks" });
    }
    const normalizeRequest = {
      scanResult,
      approvedBlockIds,
      approvedStructures: {},
      fieldRoleOverrides: {},
      mappingOverrides: {},
      templateId: null,
    };
    const validation = validateNormalizeRequest(normalizeRequest);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.errors.join(" ")), { code: "invalid_normalize_request" });
    }
    const normalizePreview = normalizeApprovedScan(validation.value);
    importRun = await context.store.updateImportRun(importRun.id, {
      status: "normalized_preview",
      normalizePreview,
      reviewDecisions: {
        approvedBlockIds,
        approvedStructures: {},
        fieldRoleOverrides: {},
        mappingOverrides: {},
        templateId: null,
      },
      warnings: normalizePreview.warnings || [],
      updatedBy: userId,
    });
    await context.store.recordAuditEvent({
      labId: batch.labId,
      projectId: batch.projectId,
      actorUserId: userId,
      action: "import.normalize_preview",
      targetType: "import_run",
      targetId: importRun.id,
      summary: "Created supplemental batch normalized preview.",
      metadata: { batchId: batch.id, batchItemId: item.id },
    });
    item = await updateItem(context, batch, item, {
      status: "resolving_relationship",
      progressMessage: "AI is resolving experiment links...",
      summary: normalizePreview.summary || {},
      warnings: normalizePreview.warnings || [],
      updatedBy: userId,
    });

    const project = await context.store.findProjectById(batch.projectId);
    const parentCommit = project?.currentDatasetCommitId
      ? await context.store.findDatasetCommitById(project.currentDatasetCommitId)
      : null;
    const [mappingSets, chartSpecs] = await Promise.all([
      context.store.listMappingSets({ projectId: batch.projectId }),
      context.store.listChartSpecs({ projectId: batch.projectId }),
    ]);
    const relationshipPreview = buildImportRelationshipPreview({
      project,
      parentCommit,
      datasetPatch: normalizePreview.datasetPatch || {},
      importRunId: importRun.id,
      mappingSets,
      chartSpecs: activeChartSpecs(chartSpecs, project?.currentDatasetCommitId),
    });
    await updateItem(context, batch, item, {
      status: "ready_for_review",
      progressMessage: "Ready for relationship review.",
      summary: normalizePreview.summary || {},
      relationshipPreview,
      warnings: [...asArray(normalizePreview.warnings), ...asArray(relationshipPreview.warnings)],
      error: null,
      updatedBy: userId,
    }, "item_ready");
    await context.store.recordAuditEvent({
      labId: batch.labId,
      projectId: batch.projectId,
      actorUserId: userId,
      action: "import.supplement_batch_item_ready",
      targetType: "import_run",
      targetId: importRun.id,
      summary: `Supplemental workbook ${item.fileName} is ready for relationship review.`,
      metadata: { batchId: batch.id, batchItemId: item.id },
    });
  } catch (error) {
    const clean = cleanError(error);
    if (importRun?.id) {
      await context.store.updateImportRun(importRun.id, {
        status: "failed",
        error: clean,
        updatedBy: userId,
      });
    }
    await updateItem(context, batch, item, {
      importRunId: importRun?.id || item.importRunId || null,
      status: "failed",
      progressMessage: "Processing failed.",
      error: clean,
      updatedBy: userId,
    }, "item_failed");
    await context.store.recordAuditEvent({
      labId: batch.labId,
      projectId: batch.projectId,
      actorUserId: userId,
      action: "import.supplement_batch_item_failed",
      targetType: importRun?.id ? "import_run" : "file_object",
      targetId: importRun?.id || item.fileObjectId,
      summary: `Supplemental workbook ${item.fileName} failed during batch processing.`,
      metadata: { batchId: batch.id, batchItemId: item.id, error: clean },
    });
  }
}

async function runPool(items, concurrency, fn) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function startSupplementalImportBatchProcessing(context, batchId, userId) {
  if (RUNNING_BATCHES.has(batchId)) return;
  RUNNING_BATCHES.add(batchId);
  setTimeout(async () => {
    try {
      const batch = await context.store.findSupplementalImportBatchById(batchId);
      if (!batch) return;
      const items = asArray(batch.items).filter((item) => !TERMINAL_ITEM_STATUSES.has(item.status));
      if (!items.length) {
        await updateBatchFromItems(context, batchId, userId);
        return;
      }
      await context.store.updateSupplementalImportBatch(batchId, {
        status: "processing",
        summary: batchSummary(batch.items),
        updatedBy: userId,
      });
      await emitLatestBatch(context, batchId, "batch");
      await runPool(items, BACKEND_BATCH_CONCURRENCY, (item) => processOneItem(context, batch, item, userId));
      const latest = await updateBatchFromItems(context, batchId, userId);
      await context.store.recordAuditEvent({
        labId: batch.labId,
        projectId: batch.projectId,
        actorUserId: userId,
        action: "import.supplement_batch_complete",
        targetType: "supplemental_import_batch",
        targetId: batch.id,
        summary: "Supplemental import batch processing completed.",
        metadata: { summary: latest?.summary || {} },
      });
    } finally {
      RUNNING_BATCHES.delete(batchId);
    }
  }, 0);
}
