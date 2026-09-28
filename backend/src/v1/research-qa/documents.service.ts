import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { DOCUMENT_LIMITS, DOCUMENT_PROCESSING_VERSION } from "../../research/documentLimits.js";
import { parseDocument } from "../../research/documentParser.js";
import { validateDocumentFile } from "../../research/documentText.js";
import { readFileObjectBuffer } from "../../saas/fileStorage.js";
import { makeId, sha256Hex } from "../../saas/ids.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { Capability } from "../authorization/authorization.policy.js";
import { EvidenceRepository } from "../evidence/evidence.repository.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import { V1_CONFIG, type V1Config } from "../platform/config/v1-config.js";
import { ApiError } from "../platform/http/api-error.js";
import type { DocumentPageDto, RegisterDocumentDto } from "./documents.dto.js";
import { DocumentsRepository, type DocumentVersion } from "./documents.repository.js";

function versionSummary(row: DocumentVersion) {
  const { leaseToken: _leaseToken, leaseExpiresAt, ...summary } = row;
  return { ...summary, status: row.status === "processing" && (!leaseExpiresAt || Date.parse(leaseExpiresAt) <= Date.now()) ? "interrupted" : row.status };
}

function numericCursor(cursor: string | undefined) {
  if (cursor && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) > 100_000)) {
    throw new ApiError(400, "invalid_cursor", "Document cursor is invalid.");
  }
  return Number(cursor || 0);
}

@Injectable()
export class DocumentsService implements OnModuleDestroy {
  private readonly jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private rendering = 0;
  private starting = 0;
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repository: DocumentsRepository,
    private readonly evidence: EvidenceRepository,
    private readonly authorization: AuthorizationService,
    private readonly identity: IdentityRepository,
    @Inject(V1_CONFIG) private readonly config: V1Config,
  ) {}

  async onModuleDestroy() {
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.allSettled(jobs.map((job) => job.done));
  }

  async authorize(auth: AuthContext, projectId: string, capability: Capability = "read") {
    const actor = await this.identity.findUserById(auth.user.id);
    if (!actor?.isActive) throw new ApiError(403, "forbidden", "The account is no longer active.");
    return this.authorization.requireFullProjectCapability(auth, projectId, capability);
  }

  async list(auth: AuthContext, projectId: string, query: DocumentPageDto) {
    await this.authorize(auth, projectId);
    const limit = query.limit || 20;
    const rows = await this.repository.listDocuments(projectId, query.cursor, limit, query);
    const items = rows.slice(0, limit).map(({ document, currentVersion }) => ({ document, currentVersion: currentVersion ? versionSummary(currentVersion) : null }));
    await this.authorize(auth, projectId);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.document.id : null };
  }

  async detail(auth: AuthContext, projectId: string, documentId: string, query: DocumentPageDto) {
    await this.authorize(auth, projectId);
    const document = await this.repository.findDocument(projectId, documentId);
    if (!document) throw new ApiError(404, "document_not_found", "Document not found.");
    const limit = query.limit || 20;
    const rows = await this.repository.listVersions(projectId, documentId, numericCursor(query.cursor), limit);
    await this.authorize(auth, projectId);
    return { document, versions: rows.slice(0, limit).map(versionSummary), nextCursor: rows.length > limit ? String(rows[limit - 1]!.versionNumber) : null };
  }

  async version(auth: AuthContext, projectId: string, versionId: string) {
    await this.authorize(auth, projectId);
    const row = await this.repository.findVersion(projectId, versionId);
    if (!row) throw new ApiError(404, "document_version_not_found", "Document version not found.");
    await this.authorize(auth, projectId);
    return versionSummary(row);
  }

  async register(auth: AuthContext, projectId: string, fileObjectId: string, choice: Partial<RegisterDocumentDto> = {}) {
    const { project } = await this.authorize(auth, projectId, "propose");
    const file = await this.evidence.findFileObjectById(fileObjectId);
    if (!file || file.projectId !== projectId) throw new ApiError(404, "file_object_not_found", "File object not found.");
    if (file.sizeBytes > DOCUMENT_LIMITS.fileBytes) throw new ApiError(413, "document_too_large", "The document exceeds 25 MiB.");
    const buffer = await readFileObjectBuffer(this.config, file);
    validateDocumentFile({ buffer, filename: file.originalName, mimeType: file.mimeType });
    if (sha256Hex(buffer) !== file.checksumSha256) throw new ApiError(409, "document_content_changed", "The saved file no longer matches its original checksum.");
    if (this.jobs.size + this.starting >= 2) throw new ApiError(429, "document_processing_busy", "Two documents are already being processed. Retry shortly.");
    await this.authorize(auth, projectId, "propose");
    if (choice.newDocument && choice.documentId || choice.documentId && !choice.expectedVersion) throw new ApiError(400, "document_version_choice", "Choose a new reference or an existing document and its current version.");
    const registered = await this.repository.register({ projectId, labId: project.labId, fileObjectId: file.id,
      ...(choice.newDocument !== undefined ? { newDocument: choice.newDocument } : {}),
      ...(choice.documentId ? { documentId: choice.documentId, expectedVersion: choice.expectedVersion! } : {}),
      originalName: file.originalName, contentHash: file.checksumSha256, processingVersion: DOCUMENT_PROCESSING_VERSION, actorUserId: auth.user.id }, auth);
    await this.start(auth, projectId, registered.version.id);
    return { ...registered, version: await this.version(auth, projectId, registered.version.id) };
  }

  async retry(auth: AuthContext, projectId: string, versionId: string) {
    await this.authorize(auth, projectId, "propose");
    await this.start(auth, projectId, versionId);
    return { version: await this.version(auth, projectId, versionId) };
  }

  private async start(auth: AuthContext, projectId: string, versionId: string) {
    const version = await this.repository.findVersion(projectId, versionId);
    if (!version) throw new ApiError(404, "document_version_not_found", "Document version not found.");
    const document = await this.repository.findDocument(projectId, version.documentId);
    if (document?.status !== "active") throw new ApiError(409, "document_archived", "Document is archived.");
    if (this.jobs.has(versionId) || version.status === "ready") return;
    if (version.processingVersion !== DOCUMENT_PROCESSING_VERSION) {
      throw new ApiError(409, "document_parser_changed", "Register the original file again to create a version with the current parser.");
    }
    if (this.jobs.size + this.starting >= 2) throw new ApiError(429, "document_processing_busy", "Two documents are already being processed. Retry shortly.");
    const token = makeId("parse_lease");
    this.starting += 1;
    let claimed;
    try { claimed = await this.repository.claim(projectId, versionId, token, auth); }
    finally { this.starting -= 1; }
    if (!claimed) return;
    const controller = new AbortController();
    const done = this.process(auth, claimed, token, controller.signal)
      .catch(() => this.logger.error("Document processing state could not be saved; the lease will expire for retry."))
      .finally(() => this.jobs.delete(versionId));
    this.jobs.set(versionId, { controller, done });
  }

  private async process(auth: AuthContext, version: DocumentVersion, token: string, signal: AbortSignal) {
    try {
      await this.authorize(auth, version.projectId, "propose");
      const file = await this.evidence.findFileObjectById(version.fileObjectId);
      if (!file || file.projectId !== version.projectId) throw new ApiError(404, "file_object_not_found", "File object not found.");
      const buffer = await readFileObjectBuffer(this.config, file);
      if (sha256Hex(buffer) !== version.contentHash) throw new ApiError(409, "document_content_changed", "Source file changed.");
      const checkpoint = await this.repository.checkpoint(version.projectId, version.id);
      const result = await (parseDocument as any)({ buffer, filename: file.originalName, mimeType: file.mimeType,
        checkpoint, signal, onPage: async ({ page }: { page: Record<string, any> }) => {
          await this.authorize(auth, version.projectId, "propose");
          if (signal.aborted) throw new ApiError(409, "document_cancelled", "Processing was cancelled.");
          await this.repository.savePage(version.projectId, version.id, token, page, auth);
        } });
      await this.authorize(auth, version.projectId, "propose");
      if (signal.aborted) throw new ApiError(409, "document_cancelled", "Processing was cancelled.");
      await this.repository.finish(version.projectId, version.id, token, result, auth);
    } catch (error: any) {
      await this.repository.fail(version.projectId, version.id, token, String(error.code || "document_parse_failed").slice(0, 100));
    }
  }

  async listPassages(auth: AuthContext, projectId: string, versionId: string, query: DocumentPageDto) {
    await this.version(auth, projectId, versionId);
    const offset = numericCursor(query.cursor), limit = query.limit || 8;
    const rows = await this.repository.listPassages(projectId, versionId, offset, limit);
    await this.authorize(auth, projectId);
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(offset + limit) : null };
  }

  async passage(auth: AuthContext, projectId: string, versionId: string, passageId: string) {
    const version = await this.version(auth, projectId, versionId);
    const passage = await this.repository.findPassage(projectId, versionId, passageId);
    if (!passage) throw new ApiError(404, "passage_not_found", "Document passage not found.");
    const document = await this.repository.findDocument(projectId, version.documentId);
    await this.authorize(auth, projectId);
    return { document, version, passage };
  }

  async pageImage(auth: AuthContext, projectId: string, versionId: string, page: number) {
    const version = await this.version(auth, projectId, versionId);
    if (!Number.isInteger(page) || page < 1 || page > DOCUMENT_LIMITS.pages) throw new ApiError(400, "invalid_page", "Page number is invalid.");
    const file = await this.evidence.findFileObjectById(version.fileObjectId);
    if (!file || file.projectId !== projectId || file.extension !== "pdf") throw new ApiError(404, "pdf_not_found", "PDF not found.");
    if (this.rendering >= 2) throw new ApiError(429, "document_render_busy", "Source preview is busy. Retry shortly.");
    this.rendering += 1;
    try {
      const buffer = await readFileObjectBuffer(this.config, file);
      if (sha256Hex(buffer) !== version.contentHash) throw new ApiError(409, "document_content_changed", "Source file changed.");
      const image = await (parseDocument as any)({ buffer, filename: file.originalName, operation: "render", page });
      await this.authorize(auth, projectId);
      return image;
    } finally { this.rendering -= 1; }
  }

  async archive(auth: AuthContext, projectId: string, documentId: string, expectedVersion: number) {
    await this.authorize(auth, projectId, "propose");
    const document = await this.repository.findDocument(projectId, documentId);
    if (!document) throw new ApiError(404, "document_not_found", "Document not found.");
    const archived = await this.repository.archive(projectId, documentId, expectedVersion, auth);
    if (document.currentVersionId) this.jobs.get(document.currentVersionId)?.controller.abort();
    return { document: archived };
  }
}
