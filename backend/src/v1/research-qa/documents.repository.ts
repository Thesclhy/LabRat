import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { contextDocuments as documents, contextDocumentVersions as versions,
  contextDocumentPages as pages, contextDocumentPassages as passages, auditEvents } from "../platform/database/schema.js";
import { ApiError } from "../platform/http/api-error.js";
import { authorizeProjectTransaction } from "../authorization/authorized-store.js";
import type { AuthContext } from "../identity/identity.types.js";

const now = () => new Date().toISOString();
export type DocumentVersion = typeof versions.$inferSelect;

@Injectable()
export class DocumentsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findDocument(projectId: string, id: string) {
    const [row] = await this.database.db.select().from(documents).where(and(eq(documents.projectId, projectId), eq(documents.id, id))).limit(1);
    return row || null;
  }

  async findVersion(projectId: string, id: string) {
    const [row] = await this.database.db.select().from(versions).where(and(eq(versions.projectId, projectId), eq(versions.id, id))).limit(1);
    return row || null;
  }

  async listDocuments(projectId: string, after: string | undefined, limit: number) {
    return this.database.db.select({ document: documents, currentVersion: versions }).from(documents)
      .leftJoin(versions, and(eq(versions.id, documents.currentVersionId), eq(versions.projectId, projectId)))
      .where(and(eq(documents.projectId, projectId), eq(documents.status, "active"), after ? gt(documents.id, after) : undefined))
      .orderBy(asc(documents.id)).limit(limit + 1);
  }

  async listVersions(projectId: string, documentId: string, after: number, limit: number) {
    return this.database.db.select().from(versions).where(and(eq(versions.projectId, projectId), eq(versions.documentId, documentId),
      after ? lt(versions.versionNumber, after) : undefined)).orderBy(desc(versions.versionNumber)).limit(limit + 1);
  }

  async register(input: { projectId: string; labId: string; fileObjectId: string; originalName: string;
    contentHash: string; processingVersion: string; actorUserId: string }, auth: AuthContext) {
    return this.database.db.transaction(async (tx) => {
      await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, { id: input.projectId, labId: input.labId }, "propose");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${JSON.stringify(["context-document", input.projectId, input.originalName])}))`);
      let [document] = await tx.select().from(documents).where(and(eq(documents.projectId, input.projectId),
        eq(documents.originalName, input.originalName), eq(documents.status, "active"))).limit(1);
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
        createdBy: input.actorUserId, createdAt: timestamp, updatedAt: timestamp }).returning();
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
      const [row] = await tx.update(versions).set({ status: "processing", leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 210_000).toISOString(), failureCode: null, updatedAt: timestamp })
        .where(and(eq(versions.projectId, projectId), eq(versions.id, versionId),
          or(sql`${versions.status} in ('pending', 'partial', 'failed')`, and(eq(versions.status, "processing"), lt(versions.leaseExpiresAt, timestamp)))))
        .returning();
      return row || null;
    });
  }

  async checkpoint(projectId: string, versionId: string) {
    const version = await this.findVersion(projectId, versionId);
    if (!version) return null;
    const saved = await this.database.db.select().from(pages).where(eq(pages.versionId, versionId)).orderBy(asc(pages.pageNumber));
    return { contentHash: version.contentHash, processingVersion: version.processingVersion, pages: saved.map((row) => row.body) };
  }

  private async withLease(projectId: string, versionId: string, token: string, auth: AuthContext, operation: (tx: any, version: DocumentVersion) => Promise<void>) {
    return this.database.db.transaction(async (tx) => {
      const [version] = await tx.select().from(versions).where(and(eq(versions.projectId, projectId), eq(versions.id, versionId),
        eq(versions.leaseToken, token), eq(versions.status, "processing"), gt(versions.leaseExpiresAt, now()))).for("update");
      if (!version) throw new ApiError(409, "document_lease_lost", "Document processing is no longer current.");
      const [document] = await tx.select().from(documents).where(eq(documents.id, version.documentId)).for("update");
      if (document?.status !== "active") throw new ApiError(409, "document_archived", "Document is archived.");
      await authorizeProjectTransaction({ db: tx } as unknown as DatabaseService, auth, { id: projectId, labId: document.labId }, "propose");
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
