import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { setTimeout as delay } from "node:timers/promises";
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
import type { DocumentPageDto, DocumentPageTextDto, RegisterDocumentDto } from "./documents.dto.js";
import { canonicalPageSummary, readCanonicalPageWindow } from "../../research/documentPages.js";
import { DocumentsRepository, type DocumentVersion } from "./documents.repository.js";
import { createDoclingClient } from "../../research/doclingClient.js";
import { normalizeDoclingPages, PDF_PROCESSING_VERSION } from "../../research/doclingPages.js";

function versionSummary(row: DocumentVersion) {
  const { leaseToken: _leaseToken, leaseExpiresAt, processingTaskId: _taskId,
    processingActorId: _actorId, processingSessionId: _sessionId,
    processingAttempts: _attempts, processingStartedAt: _startedAt, nextAttemptAt: _nextAttempt, ...summary } = row;
  return { ...summary, status: row.status === "processing" && (!leaseExpiresAt || Date.parse(leaseExpiresAt) <= Date.now()) ? "interrupted" : row.status };
}

function numericCursor(cursor: string | undefined) {
  if (cursor && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) > 100_000)) {
    throw new ApiError(400, "invalid_cursor", "Document cursor is invalid.");
  }
  return Number(cursor || 0);
}

@Injectable()
export class DocumentsService implements OnModuleDestroy, OnModuleInit {
  private readonly jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private rendering = 0;
  private starting = 0;
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private recovering = false;
  private stopping = false;
  private lastCleanup = 0;
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repository: DocumentsRepository,
    private readonly evidence: EvidenceRepository,
    private readonly authorization: AuthorizationService,
    private readonly identity: IdentityRepository,
    @Inject(V1_CONFIG) private readonly config: V1Config,
  ) {}

  onModuleInit() {
    if (!this.config.doclingEndpoint || !this.config.doclingApiKey) return;
    this.recoveryTimer = setInterval(() => { void this.recoverPages(); }, 5000);
    this.recoveryTimer.unref();
    void this.recoverPages();
  }

  async onModuleDestroy() {
    this.stopping = true; clearInterval(this.recoveryTimer);
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.allSettled(jobs.map((job) => job.done));
  }

  async authorize(auth: AuthContext, projectId: string, capability: Capability = "read") {
    const actor = await this.identity.findUserById(auth.user.id);
    if (!actor?.isActive) throw new ApiError(403, "forbidden", "The account is no longer active.");
    await this.repository.requireSession(auth);
    if (auth.publicGuest || await this.identity.findPublicGuestScope(auth.user.id)) throw new ApiError(403, "public_guest_read_only", "Public Guest cannot read project document evidence.");
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
    const extension = validateDocumentFile({ buffer, filename: file.originalName, mimeType: file.mimeType });
    if (extension === "pdf") this.doclingClient();
    if (sha256Hex(buffer) !== file.checksumSha256) throw new ApiError(409, "document_content_changed", "The saved file no longer matches its original checksum.");
    if (extension !== "pdf" && this.jobs.size + this.starting >= 2) throw new ApiError(429, "document_processing_busy", "Two documents are already being processed. Retry shortly.");
    await this.authorize(auth, projectId, "propose");
    if (choice.newDocument && choice.documentId || choice.documentId && !choice.expectedVersion) throw new ApiError(400, "document_version_choice", "Choose a new reference or an existing document and its current version.");
    const registered = await this.repository.register({ projectId, labId: project.labId, fileObjectId: file.id,
      ...(choice.newDocument !== undefined ? { newDocument: choice.newDocument } : {}),
      ...(choice.documentId ? { documentId: choice.documentId, expectedVersion: choice.expectedVersion! } : {}),
      originalName: file.originalName, contentHash: file.checksumSha256,
      processingVersion: extension === "pdf" ? PDF_PROCESSING_VERSION : DOCUMENT_PROCESSING_VERSION, actorUserId: auth.user.id }, auth);
    if (extension === "pdf") void this.recoverPages();
    else await this.start(auth, projectId, registered.version.id);
    return { ...registered, version: await this.version(auth, projectId, registered.version.id) };
  }

  async retry(auth: AuthContext, projectId: string, versionId: string) {
    await this.authorize(auth, projectId, "propose");
    const version = await this.repository.findVersion(projectId, versionId);
    if (version?.processingVersion === PDF_PROCESSING_VERSION) {
      this.doclingClient(); await this.repository.queuePages(projectId, versionId, auth); void this.recoverPages();
    } else await this.start(auth, projectId, versionId);
    return { version: await this.version(auth, projectId, versionId) };
  }

  async cancel(auth: AuthContext, projectId: string, versionId: string) {
    await this.authorize(auth, projectId, "propose");
    await this.repository.cancelProcessing(projectId, versionId, auth);
    this.jobs.get(versionId)?.controller.abort();
    return { version: await this.version(auth, projectId, versionId) };
  }

  private doclingClient() {
    return createDoclingClient({ endpoint: this.config.doclingEndpoint, apiKey: this.config.doclingApiKey });
  }

  private async recoverPages() {
    if (this.stopping || this.recovering || !this.config.doclingEndpoint || !this.config.doclingApiKey) return;
    this.recovering = true;
    try {
      for (const { version } of await this.repository.recoverablePages()) {
        if (this.stopping || this.jobs.size) break;
        try {
          const auth = await this.repository.processingAuth(version);
          if (!auth) { await this.repository.interruptRecovery(version, "document_session_interrupted"); continue; }
          await this.authorize(auth, version.projectId, "propose");
          const token = makeId("parse_lease");
          const claimed = await this.repository.claimPages(version.projectId, version.id, token, auth);
          if (!claimed) continue;
          const controller = new AbortController();
          const done = this.processPages(auth, claimed, token, controller)
            .catch(() => this.logger.error("PDF processing state could not be saved; recovery will recheck the expired lease."))
            .finally(() => { this.jobs.delete(version.id); if (!this.stopping) void this.recoverPages(); });
          this.jobs.set(version.id, { controller, done });
          break;
        } catch (error: any) {
          if ([401, 403, 404, 409].includes(error.statusCode)) await this.repository.interruptRecovery(version, "document_access_interrupted");
          else throw error;
        }
      }
      if (Date.now() - this.lastCleanup > 600_000) {
        this.lastCleanup = Date.now();
        // This is a dedicated local Docling instance; retained results allow recovery.
        await this.doclingClient().clearExpired().catch(() => this.logger.warn("PDF temporary-result cleanup is temporarily unavailable."));
      }
    } catch { this.logger.warn("PDF recovery will retry its database/service check."); }
    finally { this.recovering = false; }
  }

  private async processPages(auth: AuthContext, version: DocumentVersion, token: string, controller: AbortController) {
    const signal = controller.signal;
    let heartbeatBusy = false, heartbeatError: any;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      void this.repository.heartbeatPages(version.projectId, version.id, token, auth)
        .catch((error) => { heartbeatError = error; controller.abort(); })
        .finally(() => { heartbeatBusy = false; });
    }, 15_000);
    heartbeat.unref();
    try {
      await this.authorize(auth, version.projectId, "propose");
      const file = await this.evidence.findFileObjectById(version.fileObjectId);
      if (!file || file.projectId !== version.projectId) throw new ApiError(404, "file_object_not_found", "File object not found.");
      const buffer = await readFileObjectBuffer(this.config, file);
      if (sha256Hex(buffer) !== version.contentHash) throw new ApiError(409, "document_content_changed", "Source file changed.");
      const inspection = await (parseDocument as any)({ buffer, filename: file.originalName, mimeType: file.mimeType, operation: "inspect", signal });
      const client = this.doclingClient();
      await client.verifyVersion(signal);
      let taskId = version.processingTaskId;
      let startedAt = version.processingStartedAt;
      if (!taskId) {
        if (startedAt && Date.now() - Date.parse(startedAt) < 360_000) throw new ApiError(503, "document_submission_uncertain", "Waiting for a previous uncertain submission to expire.");
        startedAt = await this.repository.beginPageAttempt(version.projectId, version.id, token, auth);
        taskId = await client.submit(buffer, signal);
        await this.repository.savePageTask(version.projectId, version.id, token, taskId, auth);
      }
      for (;;) {
        if (!startedAt || Date.now() - Date.parse(startedAt) > 360_000) throw new ApiError(503, "document_task_timeout", "PDF recognition reached its attempt deadline.");
        await this.repository.heartbeatPages(version.projectId, version.id, token, auth);
        const state = await client.status(taskId, signal);
        if (state === "success" || state === "failure") break;
        if (state === "cancelled") throw new ApiError(503, "document_task_cancelled", "PDF recognition was interrupted upstream.");
        await delay(500, undefined, { signal });
      }
      const result = normalizeDoclingPages(await client.result(taskId, signal), inspection);
      await this.authorize(auth, version.projectId, "propose");
      if (signal.aborted) throw new ApiError(409, "document_cancelled", "Document processing stopped.");
      await this.repository.finishPages(version.projectId, version.id, token, { ...result, contentHash: version.contentHash }, auth);
    } catch (error: any) {
      const current = await this.repository.findVersion(version.projectId, version.id);
      if (!current || current.leaseToken !== token) return;
      const code = String(heartbeatError?.code || error.code || "document_parse_failed").slice(0, 100);
      const transient = ["document_service_unavailable", "document_task_missing", "document_task_timeout",
        "document_task_cancelled", "document_submission_uncertain"].includes(code);
      const forgetTask = ["document_task_missing", "document_task_timeout", "document_task_cancelled", "document_parse_failed"].includes(code);
      const waiting = code === "document_submission_uncertain" || code === "document_service_unavailable" && !current.processingTaskId && current.processingStartedAt;
      const canRetry = transient && (current.processingAttempts < 3 || !forgetTask && Boolean(current.processingTaskId));
      const retryAt = this.stopping ? new Date().toISOString() : canRetry
        ? new Date(waiting ? Math.max(Date.now() + 5000, Date.parse(current.processingStartedAt!) + 360_000)
          : Date.now() + Math.min(30_000, 2000 * 2 ** current.processingAttempts)).toISOString() : undefined;
      await this.repository.releasePages(current, token, this.stopping ? "document_backend_interrupted" : code,
        { ...(retryAt ? { retryAt } : {}), forgetTask });
    } finally { clearInterval(heartbeat); }
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

  private async pageVersion(auth: AuthContext, projectId: string, versionId: string) {
    const version = await this.version(auth, projectId, versionId);
    if (version.metadata.pageSchemaVersion !== 2 && !version.processingVersion.startsWith("labrat.pdf.pages.v1:")) {
      throw new ApiError(409, "document_page_format_unsupported", "This historical version uses source passages.");
    }
    return version;
  }

  async listPages(auth: AuthContext, projectId: string, versionId: string, query: DocumentPageDto) {
    const version = await this.pageVersion(auth, projectId, versionId);
    const limit = query.limit || 20;
    const rows = await this.repository.listPages(projectId, versionId, numericCursor(query.cursor), limit);
    const items = rows.slice(0, limit).map((row) => canonicalPageSummary(row.body));
    await this.authorize(auth, projectId);
    return { versionId, pageCount: version.metadata.pageCount ?? null, items,
      nextCursor: rows.length > limit ? String(items.at(-1)!.page) : null };
  }

  async pageText(auth: AuthContext, projectId: string, versionId: string, number: number, query: DocumentPageTextDto) {
    await this.pageVersion(auth, projectId, versionId);
    if (!Number.isInteger(number) || number < 1 || number > DOCUMENT_LIMITS.pages) throw new ApiError(400, "invalid_page", "Page number is invalid.");
    const page = await this.repository.findPage(projectId, versionId, number);
    if (!page) throw new ApiError(404, "document_page_not_found", "The page has not been saved.");
    const result = readCanonicalPageWindow(page, query.cursor, query.limit);
    await this.authorize(auth, projectId);
    return { versionId, ...result };
  }

  async pageCitation(auth: AuthContext, projectId: string, evidence: Record<string, any>) {
    const version = await this.pageVersion(auth, projectId, evidence.version.versionId);
    const page = await this.repository.findPage(projectId, version.id, evidence.locator.page);
    const { start, end } = evidence.locator;
    if (!page || version.contentHash !== evidence.version.contentHash || version.processingVersion !== evidence.version.processingVersion
      || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > page.text.length
      || page.text.slice(start, end) !== evidence.data.text) {
      throw new ApiError(409, "document_citation_mismatch", "The saved source window does not match this page version.");
    }
    const blocks = page.blocks.filter((block: any) => block.end > start && block.start < end);
    const rectangles = blocks.filter((block: any) => block.bbox).slice(0, 200).map(({ bbox }: any) => ({
      left: bbox[0], top: bbox[1], width: bbox[2] - bbox[0], height: bbox[3] - bbox[1] }));
    await this.authorize(auth, projectId);
    return { ...evidence, version: { ...evidence.version, metadata: { pageCount: version.metadata.pageCount, pageSchemaVersion: 2 } },
      locator: { ...evidence.locator, rectangles,
        precision: rectangles.length && blocks.every((block: any) => block.bbox) ? "block" : "page" } };
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
