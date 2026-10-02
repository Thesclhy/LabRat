import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { DatabaseService, type V1Transaction } from "../platform/database/database.service.js";
import { contextDocuments as documents, contextDocumentVersions as versions,
  contextDocumentPages as pages, contextDocumentPassages as passages, auditEvents, sessions } from "../platform/database/schema.js";
import { ApiError } from "../platform/http/api-error.js";
import { authorizeProjectTransaction } from "../authorization/authorized-store.js";
import type { AuthContext } from "../identity/identity.types.js";
import { validateCanonicalPage } from "../../research/documentPages.js";
import { DOCUMENT_LIMITS } from "../../research/documentLimits.js";
import { PDF_PROCESSING_VERSION } from "../../research/doclingPages.js";
import { IdentityRepository } from "../identity/identity.repository.js";

const now = () => new Date().toISOString();
export type DocumentVersion = typeof versions.$inferSelect;

@Injectable()
export class DocumentsRepository {
  constructor(private readonly database: DatabaseService) {}

  async requireSession(auth: AuthContext, tx = this.database.db as any) {
    const [session] = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, auth.sessionId),
      eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now()))).for("share");
    if (!session) throw new ApiError(401, "unauthorized", "The session is no longer active.");
  }

  async findDocument(projectId: string, id: string) {
    const [row] = await this.database.db.select().from(documents).where(and(eq(documents.projectId, projectId), eq(documents.id, id))).limit(1);
    return row || null;
  }

  async findVersion(projectId: string, id: string) {
    const [row] = await this.database.db.select().from(versions).where(and(eq(versions.projectId, projectId), eq(versions.id, id))).limit(1);
    return row || null;
  }

  async listDocuments(projectId: string, after: string | undefined, limit: number, filters: { search?: string; type?: string; status?: string; sort?: string } = {}) {
    const cursor = after && filters.sort ? await this.findDocument(projectId, after) : null;
    if (after && filters.sort && !cursor) throw new ApiError(400, "document_cursor_invalid", "Refresh the reference list.");
    const ascending = filters.sort === "oldest";
    const cursorFilter = !after ? undefined : filters.sort && cursor
      ? (ascending ? sql`(${documents.createdAt},${documents.id}) > (${cursor.createdAt}::timestamptz,${cursor.id})`
        : sql`(${documents.createdAt},${documents.id}) < (${cursor.createdAt}::timestamptz,${cursor.id})`)
      : gt(documents.id, after);
    return this.database.db.select({ document: documents, currentVersion: versions }).from(documents)
      .leftJoin(versions, and(eq(versions.id, documents.currentVersionId), eq(versions.projectId, projectId)))
      .where(and(eq(documents.projectId, projectId), eq(documents.status, "active"), cursorFilter,
        filters.search ? sql`position(lower(${filters.search}) in lower(${documents.originalName})) > 0` : undefined,
        filters.status ? eq(versions.status, filters.status) : undefined,
        filters.type ? sql`lower(${documents.originalName}) ~ ${filters.type === "word" ? '\\.(doc|docx)$' : `\\.${filters.type}$`}` : undefined))
      .orderBy(...(filters.sort ? (ascending ? [asc(documents.createdAt), asc(documents.id)] : [desc(documents.createdAt), desc(documents.id)]) : [asc(documents.id)])).limit(limit + 1);
  }

  async listVersions(projectId: string, documentId: string, after: number, limit: number) {
    return this.database.db.select().from(versions).where(and(eq(versions.projectId, projectId), eq(versions.documentId, documentId),
      after ? lt(versions.versionNumber, after) : undefined)).orderBy(desc(versions.versionNumber)).limit(limit + 1);
  }

  async register(input: { projectId: string; labId: string; fileObjectId: string; originalName: string;
    contentHash: string; processingVersion: string; actorUserId: string; newDocument?: boolean; documentId?: string; expectedVersion?: number }, auth: AuthContext) {
    return this.database.db.transaction(async (tx) => {
      await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, { id: input.projectId, labId: input.labId }, "propose");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${JSON.stringify(["context-document", input.projectId, input.originalName])}))`);
      const matching = await tx.select().from(documents).where(and(eq(documents.projectId, input.projectId),
        input.documentId ? eq(documents.id, input.documentId) : input.newDocument ? sql`false` : eq(documents.originalName, input.originalName),
        eq(documents.status, "active"))).limit(2).for("update");
      if (matching.length > 1) throw new ApiError(409, "document_identity_required", "Choose an existing reference for a new version, or add a separate reference.");
      let [document] = matching;
      if (input.documentId && (!document || document.version !== input.expectedVersion)) throw new ApiError(409, "document_version_conflict", "The reference changed. Refresh before adding a version.");
      const timestamp = now();
      if (!document) {
        [document] = await tx.insert(documents).values({ id: makeId("context_doc"), projectId: input.projectId,
          labId: input.labId, originalName: input.originalName, createdBy: input.actorUserId, createdAt: timestamp, updatedAt: timestamp }).returning();
      }
      if (!document) throw new ApiError(500, "document_create_failed", "Document could not be saved.");
      const [existing] = await tx.select().from(versions).where(and(eq(versions.documentId, document.id),
        eq(versions.contentHash, input.contentHash), eq(versions.processingVersion, input.processingVersion))).limit(1);
      if (existing) return { document, version: existing, reused: true };
      const [latest] = await tx.select().from(versions).where(eq(versions.documentId, document.id)).orderBy(desc(versions.versionNumber)).limit(1);
      const [version] = await tx.insert(versions).values({ id: makeId("document_version"), documentId: document.id,
        projectId: input.projectId, fileObjectId: input.fileObjectId, contentHash: input.contentHash,
        processingVersion: input.processingVersion, versionNumber: (latest?.versionNumber || 0) + 1,
        createdBy: input.actorUserId, createdAt: timestamp, updatedAt: timestamp,
        ...(input.processingVersion === PDF_PROCESSING_VERSION ? { processingActorId: auth.user.id,
          processingSessionId: auth.sessionId, nextAttemptAt: timestamp } : {}) }).returning();
      if (!version) throw new ApiError(500, "document_create_failed", "Document version could not be saved.");
      [document] = await tx.update(documents).set({ currentVersionId: version.id, version: document.version + 1, updatedAt: timestamp })
        .where(eq(documents.id, document.id)).returning();
      await tx.insert(auditEvents).values({ id: makeId("audit"), labId: input.labId, projectId: input.projectId,
        actorUserId: input.actorUserId, action: "context_document.version.create", targetType: "document_version", targetId: version.id,
        summary: "Registered uploaded document evidence.", metadata: { documentId: document!.id }, createdAt: timestamp });
      return { document: document!, version, reused: false };
    });
  }

  async claim(projectId: string, versionId: string, token: string, auth: AuthContext) {
    const timestamp = now();
    return this.database.db.transaction(async (tx) => {
      const [document] = await tx.select({ id: documents.projectId, labId: documents.labId }).from(documents)
        .innerJoin(versions, eq(versions.documentId, documents.id)).where(and(eq(documents.projectId, projectId), eq(versions.id, versionId))).limit(1);
      if (!document) throw new ApiError(404, "document_version_not_found", "Document version not found.");
      await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, document, "propose");
      await this.requireSession(auth, tx);
      const [row] = await tx.update(versions).set({ status: "processing", leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 210_000).toISOString(), failureCode: null, updatedAt: timestamp })
        .where(and(eq(versions.projectId, projectId), eq(versions.id, versionId),
          or(sql`${versions.status} in ('pending', 'partial', 'failed')`, and(eq(versions.status, "processing"), lt(versions.leaseExpiresAt, timestamp)))))
        .returning();
      return row || null;
    });
  }

  async recoverablePages() {
    return this.database.db.select({ version: versions }).from(versions)
      .innerJoin(documents, eq(documents.id, versions.documentId))
      .where(and(eq(documents.status, "active"), eq(versions.processingVersion, PDF_PROCESSING_VERSION),
        sql`${versions.processingActorId} is not null`,
        or(and(eq(versions.status, "pending"), sql`(${versions.nextAttemptAt} is null or ${versions.nextAttemptAt} <= now())`),
          and(eq(versions.status, "processing"), sql`(${versions.leaseExpiresAt} is null or ${versions.leaseExpiresAt} < now())`))))
      .orderBy(asc(versions.createdAt)).limit(10);
  }

  async processingAuth(version: DocumentVersion): Promise<AuthContext | null> {
    if (!version.processingActorId || !version.processingSessionId) return null;
    const identity = new IdentityRepository(this.database);
    const user = await identity.findUserById(version.processingActorId);
    if (!user?.isActive || await identity.findPublicGuestScope(user.id)) return null;
    const auth: AuthContext = { sessionId: version.processingSessionId, user: { id: user.id, username: user.username,
      displayName: user.displayName, isActive: user.isActive, isSuperAdmin: user.isSuperAdmin }, memberships: [] };
    try { await this.requireSession(auth); } catch { return null; }
    return auth;
  }

  async interruptRecovery(version: DocumentVersion, code: string) {
    await this.database.db.update(versions).set({ status: "failed", failureCode: code, leaseToken: null,
      leaseExpiresAt: null, nextAttemptAt: null, processingActorId: null, processingSessionId: null, updatedAt: now() })
      .where(and(eq(versions.id, version.id), eq(versions.projectId, version.projectId),
        sql`(${versions.leaseExpiresAt} is null or ${versions.leaseExpiresAt} < now())`,
        sql`${versions.status} in ('pending','processing')`));
  }

  async queuePages(projectId: string, versionId: string, auth: AuthContext) {
    return this.database.db.transaction(async (tx) => {
      const [version] = await tx.select().from(versions).where(and(eq(versions.projectId, projectId), eq(versions.id, versionId))).for("update");
      if (!version) throw new ApiError(404, "document_version_not_found", "Document version not found.");
      const [document] = await tx.select().from(documents).where(eq(documents.id, version.documentId)).for("update");
      if (document?.status !== "active") throw new ApiError(409, "document_archived", "Document is archived.");
      await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, { id: projectId, labId: document.labId }, "propose");
      await this.requireSession(auth, tx);
      if (version.status === "ready" || version.status === "processing" && Date.parse(version.leaseExpiresAt || "") > Date.now()) return;
      if (version.processingAttempts >= 3 && !version.processingTaskId) throw new ApiError(409, "document_attempt_limit", "This document reached its three-attempt limit.");
      if (["document_encrypted", "document_corrupt", "document_page_limit", "document_text_limit", "document_page_size", "document_too_large"].includes(version.failureCode || "")) {
        throw new ApiError(422, version.failureCode!, "This source file cannot be retried. Upload a readable file within the supported limits.");
      }
      await tx.update(versions).set({ status: "pending", processingActorId: auth.user.id, processingSessionId: auth.sessionId,
        nextAttemptAt: now(), leaseToken: null, leaseExpiresAt: null, failureCode: null, updatedAt: now() }).where(eq(versions.id, versionId));
    });
  }

  async claimPages(projectId: string, versionId: string, token: string, auth: AuthContext) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('labrat-docling-cpu-worker'))`);
      const [active] = await tx.select({ id: versions.id }).from(versions).where(and(eq(versions.processingVersion, PDF_PROCESSING_VERSION),
        eq(versions.status, "processing"), gt(versions.leaseExpiresAt, now()))).limit(1);
      if (active) return null;
      const [version] = await tx.select().from(versions).where(and(eq(versions.projectId, projectId), eq(versions.id, versionId))).for("update");
      if (!version || !["pending", "processing"].includes(version.status) || version.processingActorId !== auth.user.id
        || version.processingVersion !== PDF_PROCESSING_VERSION
        || version.processingSessionId !== auth.sessionId || version.nextAttemptAt && Date.parse(version.nextAttemptAt) > Date.now()) return null;
      const [document] = await tx.select().from(documents).where(eq(documents.id, version.documentId)).for("update");
      if (document?.status !== "active") throw new ApiError(409, "document_archived", "Document is archived.");
      await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, { id: projectId, labId: document.labId }, "propose");
      await this.requireSession(auth, tx);
      const [claimed] = await tx.update(versions).set({ status: "processing", leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), nextAttemptAt: null, updatedAt: now() }).where(eq(versions.id, versionId)).returning();
      return claimed!;
    });
  }

  async heartbeatPages(projectId: string, versionId: string, token: string, auth: AuthContext) {
    await this.withLease(projectId, versionId, token, auth, async (tx) => {
      await tx.update(versions).set({ leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), updatedAt: now() }).where(eq(versions.id, versionId));
    });
  }

  async beginPageAttempt(projectId: string, versionId: string, token: string, auth: AuthContext) {
    let startedAt = "";
    await this.withLease(projectId, versionId, token, auth, async (tx, version) => {
      if (version.processingAttempts >= 3) throw new ApiError(409, "document_attempt_limit", "This document reached its three-attempt limit.");
      startedAt = now();
      await tx.update(versions).set({ processingAttempts: version.processingAttempts + 1,
        processingStartedAt: startedAt, processingTaskId: null, updatedAt: startedAt }).where(eq(versions.id, versionId));
    });
    return startedAt;
  }

  async savePageTask(projectId: string, versionId: string, token: string, taskId: string, auth: AuthContext) {
    await this.withLease(projectId, versionId, token, auth, async (tx) => {
      await tx.update(versions).set({ processingTaskId: taskId, updatedAt: now() }).where(eq(versions.id, versionId));
    });
  }

  async releasePages(version: DocumentVersion, token: string, code: string, options: { retryAt?: string; forgetTask?: boolean } = {}) {
    await this.database.db.update(versions).set({ status: options.retryAt ? "pending" : "failed", failureCode: code,
      nextAttemptAt: options.retryAt || null, leaseToken: null, leaseExpiresAt: null,
      ...(options.forgetTask ? { processingTaskId: null, processingStartedAt: null } : {}), updatedAt: now() })
      .where(and(eq(versions.projectId, version.projectId), eq(versions.id, version.id), eq(versions.status, "processing"), eq(versions.leaseToken, token)));
  }

  async cancelProcessing(projectId: string, versionId: string, auth: AuthContext) {
    await this.database.db.transaction(async (tx) => {
      const [version] = await tx.select().from(versions).where(and(eq(versions.projectId, projectId), eq(versions.id, versionId))).for("update");
      if (!version) throw new ApiError(404, "document_version_not_found", "Document version not found.");
      const [document] = await tx.select().from(documents).where(eq(documents.id, version.documentId)).for("update");
      if (!document) throw new ApiError(404, "document_not_found", "Document not found.");
      await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, { id: projectId, labId: document.labId }, "propose");
      await this.requireSession(auth, tx);
      if (!["pending", "processing"].includes(version.status)) return;
      await tx.update(versions).set({ status: "failed", failureCode: "document_cancelled", leaseToken: null,
        leaseExpiresAt: null, nextAttemptAt: null, processingActorId: null, processingSessionId: null,
        processingTaskId: null, processingStartedAt: null, updatedAt: now() }).where(eq(versions.id, versionId));
    });
  }

  async checkpoint(projectId: string, versionId: string) {
    const version = await this.findVersion(projectId, versionId);
    if (!version) return null;
    const saved = await this.database.db.select().from(pages).where(eq(pages.versionId, versionId)).orderBy(asc(pages.pageNumber));
    return { contentHash: version.contentHash, processingVersion: version.processingVersion, pages: saved.map((row) => row.body) };
  }

  private async withLease(projectId: string, versionId: string, token: string, auth: AuthContext, operation: (tx: V1Transaction, version: DocumentVersion) => Promise<void>) {
    return this.database.db.transaction(async (tx) => {
      const [version] = await tx.select().from(versions).where(and(eq(versions.projectId, projectId), eq(versions.id, versionId),
        eq(versions.leaseToken, token), eq(versions.status, "processing"), gt(versions.leaseExpiresAt, now()))).for("update");
      if (!version) throw new ApiError(409, "document_lease_lost", "Document processing is no longer current.");
      const [document] = await tx.select().from(documents).where(eq(documents.id, version.documentId)).for("update");
      if (document?.status !== "active") throw new ApiError(409, "document_archived", "Document is archived.");
      await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, { id: projectId, labId: document.labId }, "propose");
      await this.requireSession(auth, tx);
      await operation(tx, version);
    });
  }

  async savePage(projectId: string, versionId: string, token: string, page: Record<string, any>, auth: AuthContext) {
    await this.withLease(projectId, versionId, token, auth, async (tx) => {
      if (page.status !== "ready") return;
      await tx.insert(pages).values({ versionId, pageNumber: page.page, body: page }).onConflictDoNothing();
    });
  }

  async finish(projectId: string, versionId: string, token: string, result: Record<string, any>, auth: AuthContext) {
    await this.withLease(projectId, versionId, token, auth, async (tx) => {
      const { passages: extracted, ...metadata } = result;
      for (let offset = 0; offset < extracted.length; offset += 100) {
        await tx.insert(passages).values(extracted.slice(offset, offset + 100).map((entry: Record<string, any>) => {
          const { id, ordinal, text, locator, ...details } = entry;
          return { versionId, projectId, id, ordinal, text, locator, metadata: details };
        })).onConflictDoNothing();
      }
      await tx.update(versions).set({ status: result.status, metadata, failureCode: null,
        leaseToken: null, leaseExpiresAt: null, updatedAt: now() }).where(eq(versions.id, versionId));
    });
  }

  async fail(projectId: string, versionId: string, token: string, code: string) {
    await this.database.db.update(versions).set({ status: "failed", failureCode: code, leaseToken: null,
      leaseExpiresAt: null, updatedAt: now() }).where(and(eq(versions.projectId, projectId), eq(versions.id, versionId), eq(versions.leaseToken, token)));
  }

  async finishPages(projectId: string, versionId: string, token: string, result: {
    contentHash: string; processingVersion: string; pageCount: number;
    pages: Array<Record<string, any>>; warnings?: string[];
  }, auth: AuthContext) {
    if (!Number.isSafeInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > DOCUMENT_LIMITS.pages
      || result.pages.length !== result.pageCount || Buffer.byteLength(JSON.stringify(result)) > DOCUMENT_LIMITS.resultBytes) {
      throw new ApiError(422, "document_page_set_invalid", "The complete physical page set is required.");
    }
    const ordered = [...result.pages].sort((a, b) => a.page - b.page);
    ordered.forEach((page, index) => {
      validateCanonicalPage(page);
      if (page.page !== index + 1) throw new ApiError(422, "document_page_set_invalid", "Page numbers must be contiguous.");
    });
    await this.withLease(projectId, versionId, token, auth, async (tx, version) => {
      if (version.contentHash !== result.contentHash || version.processingVersion !== result.processingVersion) {
        throw new ApiError(409, "document_processing_changed", "The parsing result no longer matches this source version.");
      }
      const saved = await tx.select().from(pages).where(eq(pages.versionId, versionId)).for("update");
      const existing = new Map<number, Record<string, any>>(saved.map((row: any) => [row.pageNumber, row.body]));
      if (saved.some((row: any) => row.pageNumber > result.pageCount)) {
        throw new ApiError(409, "document_page_conflict", "The saved physical page set cannot be replaced.");
      }
      const finalPages = [];
      for (const page of ordered) {
        const old = existing.get(page.page);
        if (old?.schemaVersion === 2 && old.status !== "failed" && page.status === "failed") {
          finalPages.push(validateCanonicalPage(old));
          continue;
        }
        const updated = await tx.insert(pages).values({ versionId, pageNumber: page.page, body: page })
          .onConflictDoUpdate({ target: [pages.versionId, pages.pageNumber], set: { body: page },
            setWhere: sql`(${pages.body} ->> 'schemaVersion' = '2' and ${pages.body} ->> 'status' = 'failed')
              or ${pages.body} = ${JSON.stringify(page)}::jsonb` }).returning({ page: pages.pageNumber });
        if (!updated.length) throw new ApiError(409, "document_page_conflict", "An existing successful page has different content. Create a new processing version.");
        finalPages.push(page);
      }
      const characterCount = finalPages.reduce((sum, page) => sum + page.text.length, 0);
      if (characterCount > DOCUMENT_LIMITS.characters || Buffer.byteLength(JSON.stringify(finalPages)) > DOCUMENT_LIMITS.resultBytes) {
        throw new ApiError(422, "document_text_limit", "The document exceeds its complete text limit.");
      }
      const status = finalPages.every((page) => ["ready", "empty"].includes(page.status)) ? "ready"
        : finalPages.some((page) => page.status !== "failed") ? "partial" : "failed";
      await tx.update(versions).set({ status, metadata: { format: "pdf", pageSchemaVersion: 2,
        pageCount: result.pageCount, characterCount, warnings: (result.warnings || []).slice(0, 32) },
        failureCode: status === "failed" ? "document_parse_failed" : null,
        leaseToken: null, leaseExpiresAt: null, processingTaskId: null, processingActorId: null, processingStartedAt: null,
        processingSessionId: null, nextAttemptAt: null, updatedAt: now() }).where(eq(versions.id, versionId));
    });
  }

  async listPages(projectId: string, versionId: string, after: number, limit: number) {
    return this.database.db.select({ body: pages.body }).from(pages)
      .innerJoin(versions, eq(pages.versionId, versions.id))
      .where(and(eq(versions.projectId, projectId), eq(pages.versionId, versionId),
        gt(pages.pageNumber, after), sql`${pages.body} ->> 'schemaVersion' = '2'`))
      .orderBy(asc(pages.pageNumber)).limit(limit + 1);
  }

  async findPage(projectId: string, versionId: string, pageNumber: number) {
    const [row] = await this.database.db.select({ body: pages.body }).from(pages)
      .innerJoin(versions, eq(pages.versionId, versions.id))
      .where(and(eq(versions.projectId, projectId), eq(pages.versionId, versionId), eq(pages.pageNumber, pageNumber),
        sql`${pages.body} ->> 'schemaVersion' = '2'`)).limit(1);
    return row?.body || null;
  }

  async listPassages(projectId: string, versionId: string, offset: number, limit: number) {
    return this.database.db.select().from(passages).where(and(eq(passages.projectId, projectId), eq(passages.versionId, versionId)))
      .orderBy(asc(passages.ordinal), asc(passages.id)).offset(offset).limit(limit + 1);
  }

  async findPassage(projectId: string, versionId: string, passageId: string) {
    const [row] = await this.database.db.select().from(passages).where(and(eq(passages.projectId, projectId),
      eq(passages.versionId, versionId), eq(passages.id, passageId))).limit(1);
    return row || null;
  }

  async archive(projectId: string, id: string, expectedVersion: number, auth: AuthContext) {
    return this.database.db.transaction(async (tx) => {
      const [current] = await tx.select().from(documents).where(and(eq(documents.projectId, projectId), eq(documents.id, id))).limit(1);
      if (!current) throw new ApiError(404, "document_not_found", "Document not found.");
      await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, { id: projectId, labId: current.labId }, "propose");
      const [row] = await tx.update(documents).set({ status: "archived", version: expectedVersion + 1, updatedAt: now() })
        .where(and(eq(documents.projectId, projectId), eq(documents.id, id), eq(documents.version, expectedVersion), eq(documents.status, "active"))).returning();
      if (!row) throw new ApiError(409, "document_version_conflict", "Document changed. Refresh before archiving.");
      await tx.insert(auditEvents).values({ id: makeId("audit"), labId: row.labId, projectId, actorUserId: auth.user.id,
        action: "context_document.archive", targetType: "context_document", targetId: id,
        summary: "Archived document from future Q&A retrieval.", metadata: {}, createdAt: now() });
      return row;
    });
  }
}
