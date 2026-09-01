import { publicScanResult } from "../../saas/sourceDocuments.js";
import type { EvidenceRepository } from "./evidence.repository.js";

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function fileObjectSummary(fileObject: Record<string, unknown>) {
  return {
    id: fileObject.id,
    labId: fileObject.labId,
    projectId: fileObject.projectId,
    originalName: fileObject.originalName,
    mimeType: fileObject.mimeType,
    extension: fileObject.extension,
    sizeBytes: Number(fileObject.sizeBytes) || 0,
    checksumSha256: fileObject.checksumSha256,
    storageProvider: fileObject.storageProvider,
    createdAt: fileObject.createdAt,
    createdBy: fileObject.createdBy,
  };
}

export function importRunSummary(run: Record<string, unknown>) {
  return {
    id: run.id,
    labId: run.labId,
    projectId: run.projectId,
    fileObjectId: run.fileObjectId,
    status: run.status,
    scanResult: publicScanResult(run.scanResult),
    normalizePreview: run.normalizePreview || null,
    reviewDecisions: run.reviewDecisions || {},
    warnings: asArray(run.warnings),
    error: run.error || null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function regionUnderstandingRevisionSummary(revision: Record<string, unknown> | null) {
  if (!revision) return null;
  return {
    id: revision.id,
    regionId: revision.regionId,
    revisionNumber: revision.revisionNumber,
    trigger: revision.trigger,
    userFeedback: revision.userFeedback || "",
    summary: asArray(revision.summary),
    interpretation: revision.interpretation || {},
    sourceRefs: asArray(revision.sourceRefs),
    sourceContentHash: revision.sourceContentHash,
    dependencyHash: revision.dependencyHash,
    validation: revision.validation || {},
    provider: revision.provider || {},
    warnings: asArray(revision.warnings),
    confidence: revision.confidence ?? null,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
  };
}

export async function workbookReviewRegionSummary(
  repository: EvidenceRepository,
  region: Record<string, unknown> | null,
) {
  if (!region) return null;
  const currentRevisionId = typeof region.currentRevisionId === "string" ? region.currentRevisionId : null;
  const acceptedRevisionId = typeof region.acceptedRevisionId === "string" ? region.acceptedRevisionId : null;
  const [currentRevision, acceptedRevision] = await Promise.all([
    currentRevisionId ? repository.findRegionUnderstandingRevisionById(currentRevisionId) : null,
    acceptedRevisionId && acceptedRevisionId !== currentRevisionId
      ? repository.findRegionUnderstandingRevisionById(acceptedRevisionId)
      : null,
  ]);
  return {
    id: region.id,
    labId: region.labId,
    projectId: region.projectId,
    workbookReviewSessionId: region.workbookReviewSessionId,
    sourceDocumentId: region.sourceDocumentId,
    sourceRegionId: region.sourceRegionId,
    sheetName: region.sheetName,
    rangeRef: region.rangeRef,
    selectionMethod: region.selectionMethod,
    interpretationHint: region.interpretationHint || {},
    disposition: region.disposition,
    reviewStatus: region.reviewStatus,
    currentRevisionId,
    acceptedRevisionId,
    version: Number(region.version) || 1,
    warnings: asArray(region.warnings),
    acceptedAt: region.acceptedAt || null,
    acceptedBy: region.acceptedBy || null,
    ignoredAt: region.ignoredAt || null,
    ignoredBy: region.ignoredBy || null,
    ignoredReason: region.ignoredReason || "",
    deletedAt: region.deletedAt || null,
    deletedBy: region.deletedBy || null,
    deletedReason: region.deletedReason || "",
    currentRevision: regionUnderstandingRevisionSummary(currentRevision),
    acceptedRevision: regionUnderstandingRevisionSummary(
      acceptedRevision || (acceptedRevisionId === currentRevisionId ? currentRevision : null),
    ),
    createdAt: region.createdAt,
    updatedAt: region.updatedAt,
    createdBy: region.createdBy,
    updatedBy: region.updatedBy,
  };
}

export async function listWorkbookReviewRegionSummaries(
  repository: EvidenceRepository,
  sessionId: string,
  includeDeleted = false,
) {
  const regions = await repository.listWorkbookReviewRegions({
    workbookReviewSessionId: sessionId,
    includeDeleted,
  });
  return Promise.all(regions.map((region) => workbookReviewRegionSummary(repository, region)));
}
