import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { parseMultipartFormData } from "../../http/multipart.js";
import { runImportScan } from "../../import/services/importPipeline.js";
import { runEvidenceRetrievalAgent } from "../../saas/evidenceAgentRetrieval.js";
import { deleteUploadedFile, persistUploadedFile, readFileObjectBuffer } from "../../saas/fileStorage.js";
import { makeId, sha256Hex } from "../../saas/ids.js";
import {
  buildSourceDocumentIndex,
  querySourceDocument,
  readSourceDocumentRange,
  sourceDocumentSummary,
  sourceRegionSummary,
} from "../../saas/sourceDocuments.js";
import {
  buildWorkbookReviewSessionDraft,
  workbookReviewSessionSummary,
} from "../../saas/workbookReviewSessions.js";
import {
  confirmWorkbookReviewRegion,
  createWorkbookReviewRegionDraft,
  createWorkbookReviewRegionRecord,
  deleteWorkbookReviewRegion,
  ignoreWorkbookReviewRegion,
  interpretWorkbookReviewRegion,
  reviseWorkbookReviewRegion,
} from "../../saas/workbookReviewRegions.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { Capability } from "../authorization/authorization.policy.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import { V1_CONFIG, type V1Config } from "../platform/config/v1-config.js";
import { ApiError } from "../platform/http/api-error.js";
import {
  V1_MODEL_PROVIDER,
  type V1ModelProvider,
} from "../platform/model/model-provider.js";
import type {
  ConfirmWorkbookReviewRegionDto,
  CreateImportRunDto,
  CreateWorkbookReviewRegionDto,
  CreateWorkbookReviewSessionDto,
  DeleteWorkbookReviewRegionDto,
  DeleteWorkbookReviewSessionDto,
  IgnoreWorkbookReviewRegionDto,
  InterpretWorkbookReviewRegionDto,
  ReviseWorkbookReviewRegionDto,
  RetrieveEvidenceDto,
  SourceDocumentQueryDto,
  SourceDocumentRangeDto,
} from "./evidence.dto.js";
import {
  fileObjectSummary,
  importRunSummary,
  listWorkbookReviewRegionSummaries,
  regionUnderstandingRevisionSummary,
  workbookReviewRegionSummary,
} from "./evidence.presenters.js";
import { EvidenceRepository } from "./evidence.repository.js";

const FILE_OBJECT_DUPLICATE_CONSTRAINT = "file_objects_project_id_checksum_sha256_original_name_key";

type LegacyDomainOperation = (input: Record<string, any>) => any;

const querySourceDocumentCompat = querySourceDocument as LegacyDomainOperation;
const readSourceDocumentRangeCompat = readSourceDocumentRange as LegacyDomainOperation;
const buildWorkbookReviewSessionDraftCompat = buildWorkbookReviewSessionDraft as LegacyDomainOperation;
const confirmWorkbookReviewRegionCompat = confirmWorkbookReviewRegion as LegacyDomainOperation;
const createWorkbookReviewRegionDraftCompat = createWorkbookReviewRegionDraft as LegacyDomainOperation;
const createWorkbookReviewRegionRecordCompat = createWorkbookReviewRegionRecord as LegacyDomainOperation;
const deleteWorkbookReviewRegionCompat = deleteWorkbookReviewRegion as LegacyDomainOperation;
const ignoreWorkbookReviewRegionCompat = ignoreWorkbookReviewRegion as LegacyDomainOperation;
const interpretWorkbookReviewRegionCompat = interpretWorkbookReviewRegion as LegacyDomainOperation;
const reviseWorkbookReviewRegionCompat = reviseWorkbookReviewRegion as LegacyDomainOperation;
const runEvidenceRetrievalAgentCompat = runEvidenceRetrievalAgent as LegacyDomainOperation;

function duplicateFileObject(error: unknown): boolean {
  return Boolean(error && typeof error === "object"
    && "code" in error && error.code === "23505"
    && "constraint" in error && error.constraint === FILE_OBJECT_DUPLICATE_CONSTRAINT);
}

@Injectable()
export class EvidenceService {
  constructor(
    private readonly repository: EvidenceRepository,
    private readonly authorization: AuthorizationService,
    private readonly identityRepository: IdentityRepository,
    @Inject(V1_CONFIG) private readonly config: V1Config,
    @Inject(V1_MODEL_PROVIDER) private readonly modelProvider: V1ModelProvider,
  ) {}

  async listFiles(auth: AuthContext, projectId: string) {
    await this.fullProject(auth, projectId, "read");
    const rows = await this.repository.listFileObjects(projectId);
    return rows.map(fileObjectSummary);
  }

  async retrieveEvidence(auth: AuthContext, projectId: string, input: RetrieveEvidenceDto) {
    const { project } = await this.fullProject(auth, projectId, "read");
    const [acceptedRegionUnderstandings, sourceDocuments] = await Promise.all([
      this.repository.listAcceptedRegionUnderstandings(projectId),
      this.repository.listSourceDocuments(projectId),
    ]);
    const sourceRegions = (await Promise.all(sourceDocuments.map((sourceDocument) => (
      this.repository.listSourceRegions(sourceDocument.id)
    )))).flat();
    return runEvidenceRetrievalAgentCompat({
      project,
      query: input.query,
      acceptedRegionUnderstandings,
      sourceDocuments,
      sourceRegions,
      includePreview: input.includePreview !== false,
      includeUnconfirmedSuggestions: input.includeUnconfirmedSuggestions === true,
      readRangePreview: async (request: Record<string, unknown>) => {
        const sourceDocument = await this.repository.findSourceDocumentById(String(request.sourceDocumentId || ""));
        if (!sourceDocument || sourceDocument.projectId !== project.id) return null;
        const indexBlobs = await this.repository.listSourceIndexBlobs(sourceDocument.id);
        return readSourceDocumentRangeCompat({
          sourceDocument,
          indexBlobs,
          sheetName: request.sheetName,
          range: request.range,
          maxCells: 240,
        });
      },
    });
  }

  async uploadFile(auth: AuthContext, projectId: string, contentType: string | undefined, body: unknown) {
    const { project } = await this.fullProject(auth, projectId, "propose");
    if (!Buffer.isBuffer(body)) {
      throw new ApiError(415, "unsupported_media_type", "Expected a multipart/form-data file upload.");
    }
    const form = parseMultipartFormData(contentType, body);
    const file = form.files.find((candidate: { fieldName: string }) => candidate.fieldName === "file");
    if (!file?.filename) {
      throw new ApiError(400, "missing_file", "Upload a file in multipart field \"file\".");
    }
    const originalName = file.filename;
    const checksumSha256 = sha256Hex(file.buffer);
    const existing = await this.repository.findFileObjectByProjectChecksumName({
      projectId,
      checksumSha256,
      originalName,
    });
    if (existing) {
      await this.audit(auth, project, "file.reuse", "file_object", existing.id,
        `Reused uploaded file ${existing.originalName}.`, { checksumSha256 });
      return { fileObject: fileObjectSummary(existing), reused: true, statusCode: 200 };
    }

    const fileId = makeId("file");
    const storageKey = await persistUploadedFile(this.config, {
      fileId,
      projectId,
      originalName,
      buffer: file.buffer,
    });
    try {
      const created = await this.repository.createFileObject({
        id: fileId,
        labId: project.labId,
        projectId,
        originalName,
        mimeType: file.contentType || null,
        extension: path.extname(originalName).replace(/^[.]/, "").toLowerCase() || null,
        sizeBytes: file.sizeBytes,
        checksumSha256,
        storageProvider: "local",
        storageKey,
        createdBy: auth.user.id,
      });
      if (!created) throw new ApiError(500, "file_upload_failed", "File metadata could not be saved.");
      await this.audit(auth, project, "file.upload", "file_object", created.id,
        `Uploaded ${created.originalName}.`, { checksumSha256 });
      return { fileObject: fileObjectSummary(created), reused: false, statusCode: 201 };
    } catch (error) {
      try {
        await deleteUploadedFile(this.config, storageKey);
      } catch {
        // Preserve the database error; orphan cleanup remains best effort.
      }
      if (!duplicateFileObject(error)) throw error;
      const reused = await this.repository.findFileObjectByProjectChecksumName({
        projectId,
        checksumSha256,
        originalName,
      });
      if (!reused) throw error;
      await this.audit(auth, project, "file.reuse", "file_object", reused.id,
        `Reused uploaded file ${reused.originalName}.`, { checksumSha256, raceRecovered: true });
      return { fileObject: fileObjectSummary(reused), reused: true, statusCode: 200 };
    }
  }

  async listImportRuns(auth: AuthContext, projectId: string) {
    await this.fullProject(auth, projectId, "read");
    const rows = await this.repository.listImportRuns(projectId);
    return rows.map(importRunSummary);
  }

  async createImportRun(auth: AuthContext, projectId: string, input: CreateImportRunDto) {
    const { project } = await this.fullProject(auth, projectId, "propose");
    const fileObject = await this.fileInProject(projectId, input.fileObjectId);
    const { importRun } = await this.scanFile({
      auth,
      project,
      fileObject,
      status: "review_ready",
    });
    return importRunSummary(importRun);
  }

  async listSourceDocuments(auth: AuthContext, projectId: string) {
    await this.fullProject(auth, projectId, "read");
    const rows = await this.repository.listSourceDocuments(projectId);
    return rows.map(sourceDocumentSummary);
  }

  async listSourceDocumentRegions(auth: AuthContext, sourceDocumentId: string) {
    const sourceDocument = await this.sourceDocument(auth, sourceDocumentId, "read");
    const regions = await this.repository.listSourceRegions(sourceDocument.id);
    return {
      sourceDocument: sourceDocumentSummary(sourceDocument),
      items: regions.map(sourceRegionSummary),
    };
  }

  async querySourceDocument(auth: AuthContext, sourceDocumentId: string, input: SourceDocumentQueryDto) {
    const sourceDocument = await this.sourceDocument(auth, sourceDocumentId, "read");
    const [regions, indexBlobs] = await Promise.all([
      this.repository.listSourceRegions(sourceDocument.id),
      this.repository.listSourceIndexBlobs(sourceDocument.id),
    ]);
    return querySourceDocumentCompat({
      sourceDocument,
      regions,
      indexBlobs,
      query: input.query,
      limit: input.limit,
    });
  }

  async readSourceDocumentRange(auth: AuthContext, sourceDocumentId: string, input: SourceDocumentRangeDto) {
    const sourceDocument = await this.sourceDocument(auth, sourceDocumentId, "read");
    const indexBlobs = await this.repository.listSourceIndexBlobs(sourceDocument.id);
    return readSourceDocumentRangeCompat({
      sourceDocument,
      indexBlobs,
      sheetName: input.sheetName,
      range: input.range,
      maxCells: input.maxCells,
    });
  }

  async listWorkbookReviewSessions(auth: AuthContext, projectId: string) {
    await this.fullProject(auth, projectId, "read");
    const rows = await this.repository.listWorkbookReviewSessions(projectId);
    return rows.map(workbookReviewSessionSummary);
  }

  async createWorkbookReviewSession(
    auth: AuthContext,
    projectId: string,
    input: CreateWorkbookReviewSessionDto,
  ) {
    const { project } = await this.fullProject(auth, projectId, "propose");
    const source = await this.resolveSessionSource(auth, project, input);
    const regions = await this.repository.listSourceRegions(source.sourceDocument.id);
    const draft = buildWorkbookReviewSessionDraftCompat({
      sourceDocument: source.sourceDocument,
      regions,
    });
    const session = await this.repository.createWorkbookReviewSession({
      labId: project.labId,
      projectId,
      sourceDocumentId: source.sourceDocument.id,
      ...draft,
      createdBy: auth.user.id,
    });
    if (!session) {
      throw new ApiError(500, "workbook_review_session_create_failed", "Workbook review session could not be created.");
    }
    for (const detectedRegion of Array.isArray(draft.candidateRegions) ? draft.candidateRegions : []) {
      await createWorkbookReviewRegionRecordCompat({
        store: this.repository,
        session,
        sourceDocument: source.sourceDocument,
        actorUserId: auth.user.id,
        input: {
          sourceRegionId: detectedRegion.sourceRegionId,
          sheetName: detectedRegion.sheetName,
          range: detectedRegion.range,
          selectionMethod: "detected_region",
          semanticType: detectedRegion.semanticType,
          description: detectedRegion.description,
        },
      });
    }
    await this.audit(auth, project, "workbook_review_session.create", "workbook_review_session", session.id,
      `Created workbook review session for ${String(draft.workbookSummary.workbookName || "workbook")}.`, {
        sourceDocumentId: source.sourceDocument.id,
        importRunId: source.importRun?.id || null,
      });
    return {
      workbookReviewSession: workbookReviewSessionSummary(session),
      sourceDocument: sourceDocumentSummary(source.sourceDocument),
      sourceRegions: regions.map(sourceRegionSummary),
      reviewRegions: await listWorkbookReviewRegionSummaries(this.repository, session.id),
      interpretationDeferred: true,
      importRun: source.importRun ? importRunSummary(source.importRun) : null,
    };
  }

  async listRegionUnderstandings(auth: AuthContext, projectId: string) {
    await this.fullProject(auth, projectId, "read");
    const accepted = await this.repository.listAcceptedRegionUnderstandings(projectId);
    return Promise.all(accepted.map(async ({ region, revision }) => ({
      region: await workbookReviewRegionSummary(this.repository, region),
      revision: regionUnderstandingRevisionSummary(revision),
    })));
  }

  async getWorkbookReviewSession(auth: AuthContext, sessionId: string) {
    const session = await this.session(auth, sessionId, "read");
    const sourceDocument = await this.repository.findSourceDocumentById(session.sourceDocumentId);
    const sourceRegions = sourceDocument
      ? await this.repository.listSourceRegions(sourceDocument.id)
      : [];
    return {
      workbookReviewSession: workbookReviewSessionSummary(session),
      sourceDocument: sourceDocument ? sourceDocumentSummary(sourceDocument) : null,
      sourceRegions: sourceRegions.map(sourceRegionSummary),
      reviewRegions: await listWorkbookReviewRegionSummaries(this.repository, session.id),
    };
  }

  async deleteWorkbookReviewSession(
    auth: AuthContext,
    sessionId: string,
    input: DeleteWorkbookReviewSessionDto,
  ) {
    const session = await this.session(auth, sessionId, "propose");
    const deleted = await this.repository.deleteWorkbookReviewSession(session.id, {
      expectedVersion: input.expectedVersion,
      reason: input.reason || "",
      actorUserId: auth.user.id,
    });
    if (!deleted) {
      throw new ApiError(404, "workbook_review_session_not_found", "Workbook review session not found.");
    }
    await this.identityRepository.recordAudit({
      labId: session.labId,
      projectId: session.projectId,
      actorUserId: auth.user.id,
      action: "workbook_review_session.delete",
      targetType: "workbook_review_session",
      targetId: session.id,
      summary: `Deleted workbook review session for ${String(session.workbookSummary?.workbookName || "workbook")}.`,
      metadata: {
        sourceDocumentId: session.sourceDocumentId,
        deletedRegionCount: deleted.deletedRegionCount,
        reason: input.reason || "",
      },
    });
    return {
      workbookReviewSession: workbookReviewSessionSummary(deleted.workbookReviewSession),
      deletedRegionCount: deleted.deletedRegionCount,
    };
  }

  async listWorkbookReviewRegions(auth: AuthContext, sessionId: string) {
    const session = await this.session(auth, sessionId, "read");
    return {
      workbookReviewSessionId: session.id,
      items: await listWorkbookReviewRegionSummaries(this.repository, session.id),
    };
  }

  async createWorkbookReviewRegion(
    auth: AuthContext,
    sessionId: string,
    input: CreateWorkbookReviewRegionDto,
  ) {
    const session = await this.session(auth, sessionId, "propose");
    if (input.sourceDocumentId && input.sourceDocumentId !== session.sourceDocumentId) {
      throw new ApiError(409, "source_document_mismatch", "Region must target the workbook review session SourceDocument.");
    }
    const { sourceDocument, indexBlobs } = await this.sourceContext(session);
    const created = input.deferInterpretation
      ? {
        region: await createWorkbookReviewRegionRecordCompat({
          store: this.repository,
          session,
          sourceDocument,
          actorUserId: auth.user.id,
          input,
        }),
        revision: null,
        warning: null,
      }
      : await createWorkbookReviewRegionDraftCompat({
        store: this.repository,
        session,
        sourceDocument,
        indexBlobs,
        modelProvider: this.modelProvider,
        actorUserId: auth.user.id,
        input,
      });
    await this.identityRepository.recordAudit({
      labId: session.labId,
      projectId: session.projectId,
      actorUserId: auth.user.id,
      action: "workbook_review_region.create",
      targetType: "workbook_review_region",
      targetId: created.region.id,
      summary: `Created workbook review region ${created.region.sheetName}!${created.region.rangeRef}.`,
      metadata: { sourceDocumentId: session.sourceDocumentId },
    });
    return {
      region: await workbookReviewRegionSummary(this.repository, created.region),
      currentRevision: regionUnderstandingRevisionSummary(created.revision),
      warning: created.warning || null,
      interpretationDeferred: Boolean(input.deferInterpretation),
    };
  }

  async getWorkbookReviewRegion(auth: AuthContext, sessionId: string, regionId: string) {
    const { region } = await this.region(auth, sessionId, regionId, "read");
    return workbookReviewRegionSummary(this.repository, region);
  }

  async interpretWorkbookReviewRegion(
    auth: AuthContext,
    sessionId: string,
    regionId: string,
    input: InterpretWorkbookReviewRegionDto,
  ) {
    const { session, region } = await this.region(auth, sessionId, regionId, "propose");
    const { sourceDocument, indexBlobs } = await this.sourceContext(session);
    const interpreted = await interpretWorkbookReviewRegionCompat({
      store: this.repository,
      region,
      sourceDocument,
      indexBlobs,
      modelProvider: this.modelProvider,
      actorUserId: auth.user.id,
      input,
    });
    await this.auditRegion(auth, region,
      interpreted.cancelled ? "interpret_cancelled" : "interpret",
      interpreted.revision ? "region_understanding_revision" : "workbook_review_region",
      interpreted.revision?.id || region.id,
      interpreted.cancelled
        ? `Skipped a stale interpretation for ${region.sheetName}!${region.rangeRef}.`
        : `Interpreted workbook review region ${region.sheetName}!${region.rangeRef}.`,
      { regionId: region.id, modelWarning: interpreted.warning?.code || null });
    return {
      region: await workbookReviewRegionSummary(this.repository, interpreted.region),
      currentRevision: regionUnderstandingRevisionSummary(interpreted.revision),
      warning: interpreted.warning || null,
      cancelled: interpreted.cancelled === true,
      created: Boolean(interpreted.revision),
    };
  }

  async deleteWorkbookReviewRegion(
    auth: AuthContext,
    sessionId: string,
    regionId: string,
    input: DeleteWorkbookReviewRegionDto,
  ) {
    const { region } = await this.region(auth, sessionId, regionId, "propose");
    const deleted = await deleteWorkbookReviewRegionCompat({
      store: this.repository,
      region,
      expectedRegionVersion: input.expectedRegionVersion,
      reason: input.reason,
      actorUserId: auth.user.id,
    });
    await this.auditRegion(auth, region, "delete", "workbook_review_region", region.id,
      `Deleted workbook review region ${region.sheetName}!${region.rangeRef}.`, { reason: input.reason || "" });
    return workbookReviewRegionSummary(this.repository, deleted.region);
  }

  async listRegionUnderstandingRevisions(auth: AuthContext, sessionId: string, regionId: string) {
    const { region } = await this.region(auth, sessionId, regionId, "read");
    const rows = await this.repository.listRegionUnderstandingRevisions({ regionId: region.id });
    return rows.map(regionUnderstandingRevisionSummary);
  }

  async reviseWorkbookReviewRegion(
    auth: AuthContext,
    sessionId: string,
    regionId: string,
    input: ReviseWorkbookReviewRegionDto,
  ) {
    const { session, region } = await this.region(auth, sessionId, regionId, "propose");
    const { sourceDocument, indexBlobs } = await this.sourceContext(session);
    const revised = await reviseWorkbookReviewRegionCompat({
      store: this.repository,
      region,
      sourceDocument,
      indexBlobs,
      modelProvider: this.modelProvider,
      actorUserId: auth.user.id,
      input,
    });
    await this.auditRegion(auth, region, "revise", "region_understanding_revision",
      revised.revision?.id || region.id,
      `Revised workbook review region ${region.sheetName}!${region.rangeRef}.`,
      { regionId: region.id, modelWarning: revised.warning?.code || null });
    return {
      region: await workbookReviewRegionSummary(this.repository, revised.region),
      currentRevision: regionUnderstandingRevisionSummary(revised.revision),
      warning: revised.warning || null,
    };
  }

  async confirmWorkbookReviewRegion(
    auth: AuthContext,
    sessionId: string,
    regionId: string,
    input: ConfirmWorkbookReviewRegionDto,
  ) {
    const { region } = await this.region(auth, sessionId, regionId, "approve");
    const confirmed = await confirmWorkbookReviewRegionCompat({
      store: this.repository,
      region,
      revisionId: input.revisionId,
      expectedRegionVersion: input.expectedRegionVersion,
      actorUserId: auth.user.id,
    });
    await this.auditRegion(auth, region, "confirm", "region_understanding_revision", confirmed.revision.id,
      `Confirmed workbook review region ${region.sheetName}!${region.rangeRef}.`, { regionId: region.id });
    return {
      region: await workbookReviewRegionSummary(this.repository, confirmed.region),
      acceptedRevision: regionUnderstandingRevisionSummary(confirmed.revision),
    };
  }

  async ignoreWorkbookReviewRegion(
    auth: AuthContext,
    sessionId: string,
    regionId: string,
    input: IgnoreWorkbookReviewRegionDto,
  ) {
    const { region } = await this.region(auth, sessionId, regionId, "propose");
    const ignored = await ignoreWorkbookReviewRegionCompat({
      store: this.repository,
      region,
      expectedRegionVersion: input.expectedRegionVersion,
      reason: input.reason,
      actorUserId: auth.user.id,
    });
    await this.auditRegion(auth, region, "ignore", "workbook_review_region", region.id,
      `Ignored workbook review region ${region.sheetName}!${region.rangeRef}.`, { reason: input.reason || "" });
    return workbookReviewRegionSummary(this.repository, ignored.region);
  }

  private fullProject(auth: AuthContext, projectId: string, capability: Capability) {
    return this.authorization.requireFullProjectCapability(auth, projectId, capability);
  }

  private async fileInProject(projectId: string, fileObjectId: string) {
    const fileObject = await this.repository.findFileObjectById(fileObjectId);
    if (!fileObject || fileObject.projectId !== projectId) {
      throw new ApiError(404, "file_object_not_found", "File object not found.");
    }
    return fileObject;
  }

  private async sourceDocument(auth: AuthContext, sourceDocumentId: string, capability: Capability) {
    const sourceDocument = await this.repository.findSourceDocumentById(sourceDocumentId);
    if (!sourceDocument) throw new ApiError(404, "source_document_not_found", "Source document not found.");
    await this.ownedProjectResource(
      auth,
      sourceDocument.projectId,
      capability,
      "source_document_not_found",
      "Source document not found.",
    );
    return sourceDocument;
  }

  private async session(auth: AuthContext, sessionId: string, capability: Capability) {
    const session = await this.repository.findWorkbookReviewSessionById(sessionId);
    if (!session || session.status === "deleted") {
      throw new ApiError(404, "workbook_review_session_not_found", "Workbook review session not found.");
    }
    await this.ownedProjectResource(
      auth,
      session.projectId,
      capability,
      "workbook_review_session_not_found",
      "Workbook review session not found.",
    );
    return session;
  }

  private async ownedProjectResource(
    auth: AuthContext,
    projectId: string,
    capability: Capability,
    notFoundCode: string,
    notFoundMessage: string,
  ) {
    const resolved = await this.authorization.resolveProjectAccess(auth, projectId);
    if (!resolved?.access?.allExperiments) {
      throw new ApiError(404, notFoundCode, notFoundMessage);
    }
    if (!resolved.access.capabilities.includes(capability)) {
      throw new ApiError(403, "forbidden", `Full-project capability ${capability} is required.`);
    }
    return resolved;
  }

  private async region(auth: AuthContext, sessionId: string, regionId: string, capability: Capability) {
    const session = await this.session(auth, sessionId, capability);
    const region = await this.repository.findWorkbookReviewRegionById(regionId);
    if (!region || region.workbookReviewSessionId !== session.id) {
      throw new ApiError(404, "workbook_review_region_not_found", "Workbook review region not found.");
    }
    return { session, region };
  }

  private async sourceContext(session: Record<string, unknown>) {
    const sourceDocumentId = String(session.sourceDocumentId || "");
    const sourceDocument = await this.repository.findSourceDocumentById(sourceDocumentId);
    if (!sourceDocument) {
      throw new ApiError(404, "source_document_not_found", "Source document not found for this workbook review session.");
    }
    const indexBlobs = await this.repository.listSourceIndexBlobs(sourceDocument.id);
    return { sourceDocument, indexBlobs };
  }

  private async resolveSessionSource(
    auth: AuthContext,
    project: { id: string; labId: string },
    input: CreateWorkbookReviewSessionDto,
  ) {
    if (Boolean(input.sourceDocumentId) === Boolean(input.fileObjectId)) {
      throw new ApiError(
        400,
        "invalid_workbook_review_session_request",
        "Provide exactly one of fileObjectId or sourceDocumentId.",
      );
    }
    if (input.sourceDocumentId) {
      const sourceDocument = await this.repository.findSourceDocumentById(input.sourceDocumentId);
      if (!sourceDocument || sourceDocument.projectId !== project.id) {
        throw new ApiError(404, "source_document_not_found", "Source document not found for this project.");
      }
      return { sourceDocument, importRun: null };
    }
    if (!input.fileObjectId) throw new ApiError(400, "invalid_workbook_review_session_request", "fileObjectId is required.");
    const fileObject = await this.fileInProject(project.id, input.fileObjectId);
    const existing = (await this.repository.listSourceDocuments(project.id))
      .find((document) => document.fileObjectId === fileObject.id);
    if (existing) return { sourceDocument: existing, importRun: null };
    return this.scanFile({ auth, project, fileObject, status: "source_review_ready" });
  }

  private async scanFile(input: {
    auth: AuthContext;
    project: { id: string; labId: string };
    fileObject: Awaited<ReturnType<EvidenceRepository["findFileObjectById"]>> & Record<string, unknown>;
    status: "review_ready" | "source_review_ready";
  }) {
    const buffer = await readFileObjectBuffer(this.config, input.fileObject);
    const scanFileId = input.fileObject.checksumSha256
      ? `upload_${String(input.fileObject.checksumSha256).slice(0, 16)}`
      : String(input.fileObject.id);
    const scanResult = runImportScan({
      fileId: scanFileId,
      checksumSha256: input.fileObject.checksumSha256,
      filename: input.fileObject.originalName,
      contentType: input.fileObject.mimeType,
      sizeBytes: input.fileObject.sizeBytes,
      buffer,
    });
    const importRun = await this.repository.createImportRun({
      labId: input.project.labId,
      projectId: input.project.id,
      fileObjectId: String(input.fileObject.id),
      status: input.status,
      scanResult,
      warnings: Array.isArray(scanResult.warnings) ? scanResult.warnings : [],
      createdBy: input.auth.user.id,
    });
    if (!importRun) throw new ApiError(500, "import_run_create_failed", "Import run could not be created.");
    const sourceInput = buildSourceDocumentIndex({
      project: input.project,
      fileObject: input.fileObject,
      importRun,
      scanResult,
      actorUserId: input.auth.user.id,
    });
    const sourceDocument = await this.repository.replaceSourceDocumentIndex(sourceInput);
    await this.audit(input.auth, input.project, "source.index", "source_document", sourceDocument.id,
      `Indexed source document ${String(sourceInput.metadata.workbookName || "workbook")}.`, {
        fileObjectId: input.fileObject.id,
        importRunId: importRun.id,
        regionCount: sourceInput.summary.regionCount,
      });
    await this.audit(input.auth, input.project, "import.scan", "import_run", importRun.id,
      input.status === "source_review_ready"
        ? `Created source review scan for ${String(input.fileObject.originalName)}.`
        : `Created import run for ${String(input.fileObject.originalName)}.`);
    return { importRun, sourceDocument };
  }

  private audit(
    auth: AuthContext,
    project: { id: string; labId: string },
    action: string,
    targetType: string,
    targetId: string,
    summary: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.identityRepository.recordAudit({
      labId: project.labId,
      projectId: project.id,
      actorUserId: auth.user.id,
      action,
      targetType,
      targetId,
      summary,
      ...(metadata ? { metadata } : {}),
    });
  }

  private auditRegion(
    auth: AuthContext,
    region: Record<string, unknown>,
    action: string,
    targetType: string,
    targetId: string,
    summary: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.identityRepository.recordAudit({
      labId: String(region.labId),
      projectId: String(region.projectId),
      actorUserId: auth.user.id,
      action: `workbook_review_region.${action}`,
      targetType,
      targetId,
      summary,
      ...(metadata ? { metadata } : {}),
    });
  }
}
