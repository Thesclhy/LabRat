import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { ApiError } from "../platform/http/api-error.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  fileObjects,
  importRuns,
  regionUnderstandingRevisions,
  sourceDocuments,
  sourceIndexBlobs,
  sourceRegions,
  workbookReviewRegions,
  workbookReviewSessions,
} from "../platform/database/schema.js";

type JsonObject = Record<string, unknown>;

interface FileObjectInput {
  id: string;
  labId: string;
  projectId: string;
  originalName: string;
  mimeType: string | null;
  extension: string | null;
  sizeBytes: number;
  checksumSha256: string;
  storageProvider: string;
  storageKey: string;
  metadata?: JsonObject;
  createdBy: string;
}

interface ImportRunInput {
  labId: string;
  projectId: string;
  fileObjectId: string;
  status: string;
  scanResult: JsonObject;
  warnings: unknown[];
  createdBy: string;
}

interface SourceIndexInput {
  id?: string;
  labId: string;
  projectId: string;
  fileObjectId: string;
  importRunId: string;
  documentType?: string;
  indexVersion?: string;
  status?: string;
  metadata?: JsonObject;
  summary?: JsonObject;
  warnings?: unknown[];
  regions?: Array<Record<string, unknown>>;
  indexBlobs?: Array<Record<string, unknown>>;
  createdBy?: string | null;
  updatedBy?: string | null;
}

interface WorkbookReviewSessionInput {
  labId: string;
  projectId: string;
  sourceDocumentId: string;
  schemaVersion?: string;
  status?: string;
  version?: number;
  workbookSummary?: JsonObject;
  messages?: unknown[];
  warnings?: unknown[];
  createdBy: string;
}

interface WorkbookReviewRegionInput {
  labId: string;
  projectId: string;
  workbookReviewSessionId: string;
  sourceDocumentId: string;
  sourceRegionId?: string | null;
  sheetName: string;
  rangeRef: string;
  selectionMethod?: string;
  interpretationHint?: JsonObject;
  disposition?: string;
  reviewStatus?: string;
  currentRevisionId?: string | null;
  acceptedRevisionId?: string | null;
  version?: number;
  warnings?: unknown[];
  createdBy?: string | null;
}

interface RegionUnderstandingRevisionInput {
  labId: string;
  projectId: string;
  workbookReviewSessionId: string;
  sourceDocumentId: string;
  regionId: string;
  revisionNumber: number;
  trigger?: string;
  userFeedback?: string;
  summary?: unknown[];
  interpretation?: JsonObject;
  sourceRefs?: unknown[];
  sourceContentHash: string;
  dependencyHash: string;
  validation?: JsonObject;
  provider?: JsonObject;
  warnings?: unknown[];
  confidence?: number | null;
  createdBy?: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function sourceRegionValue<T extends Record<string, unknown>>(row: T): T & { confidence: number | null } {
  return {
    ...row,
    confidence: row.confidence == null ? null : Number(row.confidence),
  };
}

@Injectable()
export class EvidenceRepository {
  constructor(private readonly database: DatabaseService) {}

  async createFileObject(input: FileObjectInput) {
    const [created] = await this.database.db.insert(fileObjects).values({
      ...input,
      metadata: input.metadata || {},
      createdAt: now(),
    }).returning();
    return created || null;
  }

  async findFileObjectById(id: string) {
    const [row] = await this.database.db.select().from(fileObjects)
      .where(eq(fileObjects.id, id)).limit(1);
    return row || null;
  }

  async findFileObjectByProjectChecksumName(input: {
    projectId: string;
    checksumSha256: string;
    originalName: string;
  }) {
    const [row] = await this.database.db.select().from(fileObjects).where(and(
      eq(fileObjects.projectId, input.projectId),
      eq(fileObjects.checksumSha256, input.checksumSha256),
      eq(fileObjects.originalName, input.originalName),
    )).limit(1);
    return row || null;
  }

  listFileObjects(projectId: string) {
    return this.database.db.select().from(fileObjects)
      .where(eq(fileObjects.projectId, projectId))
      .orderBy(desc(fileObjects.createdAt), asc(fileObjects.id));
  }

  async createImportRun(input: ImportRunInput) {
    const timestamp = now();
    const [created] = await this.database.db.insert(importRuns).values({
      id: makeId("import_run"),
      ...input,
      reviewDecisions: {},
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy: input.createdBy,
    }).returning();
    return created || null;
  }

  listImportRuns(projectId: string) {
    return this.database.db.select().from(importRuns)
      .where(eq(importRuns.projectId, projectId))
      .orderBy(desc(importRuns.updatedAt), asc(importRuns.id));
  }

  async replaceSourceDocumentIndex(input: SourceIndexInput) {
    return this.database.db.transaction(async (tx) => {
      const timestamp = now();
      const proposedId = input.id || makeId("source_doc");
      const [document] = await tx.insert(sourceDocuments).values({
        id: proposedId,
        labId: input.labId,
        projectId: input.projectId,
        fileObjectId: input.fileObjectId,
        importRunId: input.importRunId,
        documentType: input.documentType || "excel_workbook",
        indexVersion: input.indexVersion || "labrat.sourceIndex.v1",
        status: input.status || "indexed",
        metadata: input.metadata || {},
        summary: input.summary || {},
        warnings: input.warnings || [],
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: input.createdBy || null,
        updatedBy: input.updatedBy || input.createdBy || null,
      }).onConflictDoUpdate({
        target: [sourceDocuments.projectId, sourceDocuments.fileObjectId],
        set: {
          importRunId: input.importRunId,
          documentType: input.documentType || "excel_workbook",
          indexVersion: input.indexVersion || "labrat.sourceIndex.v1",
          status: input.status || "indexed",
          metadata: input.metadata || {},
          summary: input.summary || {},
          warnings: input.warnings || [],
          updatedAt: timestamp,
          updatedBy: input.updatedBy || input.createdBy || null,
        },
      }).returning();
      if (!document) throw new ApiError(500, "source_index_failed", "Source document index could not be saved.");

      await tx.delete(sourceRegions).where(eq(sourceRegions.sourceDocumentId, document.id));
      await tx.delete(sourceIndexBlobs).where(eq(sourceIndexBlobs.sourceDocumentId, document.id));

      const regionValues = (input.regions || []).map((region) => ({
        id: String(region.id || makeId("source_region")),
        labId: input.labId,
        projectId: input.projectId,
        sourceDocumentId: document.id,
        importRunId: input.importRunId,
        regionKey: region.regionKey ? String(region.regionKey) : null,
        kind: String(region.kind || "unknown_region"),
        label: String(region.label || ""),
        sheetName: region.sheetName ? String(region.sheetName) : null,
        rangeRef: region.rangeRef ? String(region.rangeRef) : null,
        startRow: region.startRow == null ? null : Number(region.startRow),
        endRow: region.endRow == null ? null : Number(region.endRow),
        startCol: region.startCol == null ? null : Number(region.startCol),
        endCol: region.endCol == null ? null : Number(region.endCol),
        confidence: region.confidence == null ? null : String(region.confidence),
        signals: region.signals as JsonObject || {},
        candidateFields: Array.isArray(region.candidateFields) ? region.candidateFields : [],
        sourceRefs: Array.isArray(region.sourceRefs) ? region.sourceRefs : [],
        warnings: Array.isArray(region.warnings) ? region.warnings : [],
        status: String(region.status || "active"),
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: input.updatedBy || input.createdBy || null,
        updatedBy: input.updatedBy || input.createdBy || null,
      }));
      if (regionValues.length) await tx.insert(sourceRegions).values(regionValues);

      const blobValues = (input.indexBlobs || []).map((blob) => ({
        id: String(blob.id || makeId("source_index_blob")),
        labId: input.labId,
        projectId: input.projectId,
        sourceDocumentId: document.id,
        blobKind: String(blob.blobKind || "excel_cell_grid_v1"),
        storageProvider: String(blob.storageProvider || "database"),
        storageKey: blob.storageKey ? String(blob.storageKey) : null,
        payload: blob.payload as JsonObject || {},
        checksumSha256: blob.checksumSha256 ? String(blob.checksumSha256) : null,
        createdAt: timestamp,
        createdBy: input.updatedBy || input.createdBy || null,
      }));
      if (blobValues.length) await tx.insert(sourceIndexBlobs).values(blobValues);
      return document;
    });
  }

  async findSourceDocumentById(id: string) {
    const [row] = await this.database.db.select().from(sourceDocuments)
      .where(eq(sourceDocuments.id, id)).limit(1);
    return row || null;
  }

  listSourceDocuments(projectId: string) {
    return this.database.db.select().from(sourceDocuments)
      .where(eq(sourceDocuments.projectId, projectId))
      .orderBy(desc(sourceDocuments.updatedAt), asc(sourceDocuments.id));
  }

  async listSourceRegions(sourceDocumentId: string) {
    const rows = await this.database.db.select().from(sourceRegions)
      .where(eq(sourceRegions.sourceDocumentId, sourceDocumentId))
      .orderBy(asc(sourceRegions.sheetName), asc(sourceRegions.startRow), asc(sourceRegions.startCol), asc(sourceRegions.id));
    return rows.map(sourceRegionValue);
  }

  listSourceIndexBlobs(sourceDocumentId: string) {
    return this.database.db.select().from(sourceIndexBlobs)
      .where(eq(sourceIndexBlobs.sourceDocumentId, sourceDocumentId))
      .orderBy(asc(sourceIndexBlobs.createdAt), asc(sourceIndexBlobs.id));
  }

  async createWorkbookReviewSession(input: WorkbookReviewSessionInput) {
    const timestamp = now();
    const [created] = await this.database.db.insert(workbookReviewSessions).values({
      id: makeId("workbook_review_session"),
      ...input,
      schemaVersion: input.schemaVersion || "labrat.workbookReviewSession.v1",
      status: input.status || "needs_user_review",
      version: input.version || 1,
      workbookSummary: input.workbookSummary || {},
      messages: input.messages || [],
      warnings: input.warnings || [],
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy: input.createdBy,
    }).returning();
    return created || null;
  }

  async findWorkbookReviewSessionById(id: string) {
    const [row] = await this.database.db.select().from(workbookReviewSessions)
      .where(eq(workbookReviewSessions.id, id)).limit(1);
    return row || null;
  }

  listWorkbookReviewSessions(projectId: string, includeDeleted = false) {
    return this.database.db.select().from(workbookReviewSessions).where(and(
      eq(workbookReviewSessions.projectId, projectId),
      ...(includeDeleted ? [] : [ne(workbookReviewSessions.status, "deleted")]),
    )).orderBy(desc(workbookReviewSessions.updatedAt), asc(workbookReviewSessions.id));
  }

  async deleteWorkbookReviewSession(id: string, input: {
    expectedVersion: number;
    reason?: string;
    actorUserId: string;
  }) {
    const client = await this.database.rawPool.connect();
    try {
      await client.query("begin");
      const currentResult = await client.query(
        "select * from workbook_review_sessions where id = $1 for update",
        [id],
      );
      const current = currentResult.rows[0] as Record<string, unknown> | undefined;
      if (!current) {
        await client.query("rollback");
        return null;
      }
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion !== Number(current.version)) {
        throw new ApiError(
          409,
          "workbook_review_session_version_conflict",
          "Workbook review session changed; reload before deleting it.",
          { expectedVersion: input.expectedVersion, currentVersion: Number(current.version) || 1 },
        );
      }
      const sessionResult = await client.query(
        `update workbook_review_sessions
         set status = 'deleted', version = version + 1, updated_at = now(), updated_by = $2
         where id = $1 returning *`,
        [id, input.actorUserId],
      );
      const regionsResult = await client.query(
        `update workbook_review_regions
         set disposition = 'deleted', deleted_at = now(), deleted_by = $2,
             deleted_reason = $3, version = version + 1, updated_at = now(), updated_by = $2
         where workbook_review_session_id = $1 and disposition = 'active'
         returning id`,
        [id, input.actorUserId, String(input.reason || "").trim()],
      );
      await client.query("commit");
      return {
        workbookReviewSession: this.sessionFromRaw(sessionResult.rows[0]),
        deletedRegionCount: regionsResult.rowCount || 0,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createWorkbookReviewRegion(input: WorkbookReviewRegionInput) {
    const timestamp = now();
    const [created] = await this.database.db.insert(workbookReviewRegions).values({
      id: makeId("workbook_review_region"),
      ...input,
      sourceRegionId: input.sourceRegionId || null,
      selectionMethod: input.selectionMethod || "manual",
      interpretationHint: input.interpretationHint || {},
      disposition: input.disposition || "active",
      reviewStatus: input.reviewStatus || "interpreting",
      currentRevisionId: input.currentRevisionId || null,
      acceptedRevisionId: input.acceptedRevisionId || null,
      version: input.version || 1,
      warnings: input.warnings || [],
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy: input.createdBy || null,
    }).returning();
    return created || null;
  }

  async findWorkbookReviewRegionById(id: string) {
    const [row] = await this.database.db.select().from(workbookReviewRegions)
      .where(eq(workbookReviewRegions.id, id)).limit(1);
    return row || null;
  }

  listWorkbookReviewRegions(input: {
    projectId?: string | null;
    workbookReviewSessionId?: string | null;
    sourceDocumentId?: string | null;
    includeDeleted?: boolean;
  } = {}) {
    return this.database.db.select().from(workbookReviewRegions).where(and(
      ...(input.projectId ? [eq(workbookReviewRegions.projectId, input.projectId)] : []),
      ...(input.workbookReviewSessionId
        ? [eq(workbookReviewRegions.workbookReviewSessionId, input.workbookReviewSessionId)] : []),
      ...(input.sourceDocumentId
        ? [eq(workbookReviewRegions.sourceDocumentId, input.sourceDocumentId)] : []),
      ...(input.includeDeleted ? [] : [ne(workbookReviewRegions.disposition, "deleted")]),
    )).orderBy(asc(workbookReviewRegions.createdAt), asc(workbookReviewRegions.id));
  }

  async updateWorkbookReviewRegion(id: string, patch: Record<string, unknown> = {}) {
    const [updated] = await this.database.db.update(workbookReviewRegions).set({
      ...(patch.disposition !== undefined ? { disposition: String(patch.disposition) } : {}),
      ...(patch.reviewStatus !== undefined ? { reviewStatus: String(patch.reviewStatus) } : {}),
      ...(patch.currentRevisionId !== undefined ? { currentRevisionId: String(patch.currentRevisionId) } : {}),
      ...(patch.acceptedRevisionId !== undefined ? { acceptedRevisionId: String(patch.acceptedRevisionId) } : {}),
      ...(patch.warnings !== undefined ? { warnings: patch.warnings as unknown[] } : {}),
      ...(patch.acceptedAt !== undefined ? { acceptedAt: String(patch.acceptedAt) } : {}),
      ...(patch.acceptedBy !== undefined ? { acceptedBy: String(patch.acceptedBy) } : {}),
      ...(patch.ignoredAt !== undefined ? { ignoredAt: String(patch.ignoredAt) } : {}),
      ...(patch.ignoredBy !== undefined ? { ignoredBy: String(patch.ignoredBy) } : {}),
      ...(patch.ignoredReason !== undefined ? { ignoredReason: String(patch.ignoredReason) } : {}),
      ...(patch.deletedAt !== undefined ? { deletedAt: String(patch.deletedAt) } : {}),
      ...(patch.deletedBy !== undefined ? { deletedBy: String(patch.deletedBy) } : {}),
      ...(patch.deletedReason !== undefined ? { deletedReason: String(patch.deletedReason) } : {}),
      version: sql`${workbookReviewRegions.version} + 1`,
      updatedAt: now(),
      ...(patch.updatedBy !== undefined ? { updatedBy: String(patch.updatedBy) } : {}),
    }).where(and(
      eq(workbookReviewRegions.id, id),
      ...(patch.expectedVersion === undefined
        ? []
        : [eq(workbookReviewRegions.version, Number(patch.expectedVersion))]),
    )).returning();
    if (!updated && patch.expectedVersion !== undefined) {
      const current = await this.findWorkbookReviewRegionById(id);
      if (current) {
        throw new ApiError(
          409,
          "stale_workbook_review_region",
          "Workbook review region changed; reload before submitting this action.",
          {
            expectedRegionVersion: Number(patch.expectedVersion),
            currentRegionVersion: Number(current.version) || null,
          },
        );
      }
    }
    return updated || null;
  }

  async createRegionUnderstandingRevision(input: RegionUnderstandingRevisionInput) {
    const [created] = await this.database.db.insert(regionUnderstandingRevisions).values({
      id: makeId("region_understanding_revision"),
      ...input,
      trigger: input.trigger || "initial",
      userFeedback: input.userFeedback || "",
      summary: input.summary || [],
      interpretation: input.interpretation || {},
      sourceRefs: input.sourceRefs || [],
      validation: input.validation || {},
      provider: input.provider || {},
      warnings: input.warnings || [],
      confidence: input.confidence ?? null,
      createdAt: now(),
      createdBy: input.createdBy || null,
    }).returning();
    return created || null;
  }

  async findRegionUnderstandingRevisionById(id: string) {
    const [row] = await this.database.db.select().from(regionUnderstandingRevisions)
      .where(eq(regionUnderstandingRevisions.id, id)).limit(1);
    return row || null;
  }

  listRegionUnderstandingRevisions(input: { regionId?: string; projectId?: string } = {}) {
    return this.database.db.select().from(regionUnderstandingRevisions).where(and(
      ...(input.regionId ? [eq(regionUnderstandingRevisions.regionId, input.regionId)] : []),
      ...(input.projectId ? [eq(regionUnderstandingRevisions.projectId, input.projectId)] : []),
    )).orderBy(asc(regionUnderstandingRevisions.revisionNumber), asc(regionUnderstandingRevisions.id));
  }

  async listAcceptedRegionUnderstandings(projectId: string) {
    const rows = await this.database.db.select({
      region: workbookReviewRegions,
      revision: regionUnderstandingRevisions,
    }).from(workbookReviewRegions).innerJoin(
      regionUnderstandingRevisions,
      eq(regionUnderstandingRevisions.id, workbookReviewRegions.acceptedRevisionId),
    ).where(and(
      eq(workbookReviewRegions.projectId, projectId),
      eq(workbookReviewRegions.disposition, "active"),
    )).orderBy(asc(workbookReviewRegions.createdAt), asc(workbookReviewRegions.id));
    return rows;
  }

  private sessionFromRaw(row: Record<string, unknown>) {
    return {
      id: row.id,
      labId: row.lab_id,
      projectId: row.project_id,
      sourceDocumentId: row.source_document_id,
      schemaVersion: row.schema_version,
      status: row.status,
      version: Number(row.version) || 1,
      workbookSummary: row.workbook_summary || {},
      messages: row.messages || [],
      warnings: row.warnings || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
    };
  }
}
