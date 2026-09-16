import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { EvidenceRepository } from "../evidence/evidence.repository.js";
import { authorizeProjectTransaction } from "../authorization/authorized-store.js";
import type { Capability } from "../authorization/authorization.policy.js";
import type { AuthContext } from "../identity/identity.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  auditEvents, experimentIdentities, regionExtractionTemplates as templates,
  regionExtractionTemplateVersions as versions, regionTemplateApplyReceipts as receipts,
  sourceDocuments, workbookReviewRegions, workbookReviewSessions,
} from "../platform/database/schema.js";

type RecordValue = Record<string, any>;
function versionValue(row: typeof versions.$inferSelect | undefined) {
  if (!row) return null;
  const { payload, ...record } = row;
  return { ...payload, ...record };
}

@Injectable()
export class RegionTemplatesRepository {
  constructor(
    private readonly database: DatabaseService,
    readonly evidence: EvidenceRepository,
  ) {}

  transaction<T>(work: (repository: RegionTemplatesRepository) => Promise<T>): Promise<T> {
    return this.database.db.transaction(async (tx) => {
      const scoped = { db: tx } as unknown as DatabaseService;
      return work(new RegionTemplatesRepository(scoped, new EvidenceRepository(scoped)));
    });
  }

  async lockProject(projectId: string) {
    await this.database.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"region-templates:" + projectId}, 0))`);
  }

  async authorize(auth: AuthContext, project: { id: string; labId: string }, capability: Capability) {
    return authorizeProjectTransaction(this.database, auth, project, capability);
  }

  async lockSource(id: string, projectId: string) {
    const [source] = await this.database.db.select().from(sourceDocuments)
      .where(and(eq(sourceDocuments.id, id), eq(sourceDocuments.projectId, projectId))).for("update");
    if (source) await this.database.db.select({ id: workbookReviewSessions.id }).from(workbookReviewSessions)
      .where(and(eq(workbookReviewSessions.sourceDocumentId, id), eq(workbookReviewSessions.projectId, projectId)))
      .orderBy(asc(workbookReviewSessions.id)).for("update");
    return source || null;
  }

  async lockRegion(id: string, projectId: string) {
    const [region] = await this.database.db.select().from(workbookReviewRegions)
      .where(and(eq(workbookReviewRegions.id, id), eq(workbookReviewRegions.projectId, projectId))).for("update");
    return region || null;
  }

  listTemplates(projectId: string, includeArchived = false, offset = 0, limit = 51) {
    return this.database.db.select().from(templates).where(and(
      eq(templates.projectId, projectId), ...(includeArchived ? [] : [ne(templates.status, "archived")]),
    )).orderBy(desc(templates.updatedAt), asc(templates.id)).offset(offset).limit(limit);
  }

  async findTemplate(id: string, lock = false) {
    const query = this.database.db.select().from(templates).where(eq(templates.id, id));
    const [row] = lock ? await query.for("update") : await query.limit(1);
    return row || null;
  }

  async findVersion(id: string) {
    const [row] = await this.database.db.select().from(versions).where(eq(versions.id, id)).limit(1);
    return versionValue(row);
  }

  async listVersions(templateId: string) {
    return (await this.database.db.select().from(versions).where(eq(versions.regionExtractionTemplateId, templateId))
      .orderBy(desc(versions.version))).map((row) => versionValue(row)!);
  }

  async createTemplate(record: typeof templates.$inferInsert) {
    const [row] = await this.database.db.insert(templates).values(record).returning();
    return row!;
  }

  async insertVersion(input: RecordValue) {
    const { id, labId, projectId, regionExtractionTemplateId, schemaVersion, version,
      status, sourceRegionId, sourceRevisionId, sourceDocumentId, contentHash, createdAt, createdBy, ...payload } = input;
    const [row] = await this.database.db.insert(versions).values({
      id, labId, projectId, regionExtractionTemplateId, schemaVersion, version, status,
      sourceRegionId, sourceRevisionId, sourceDocumentId, contentHash, createdAt, createdBy, payload,
    }).returning();
    return versionValue(row)!;
  }

  async updateTemplate(id: string, patch: Partial<typeof templates.$inferInsert>) {
    const [row] = await this.database.db.update(templates).set(patch).where(eq(templates.id, id)).returning();
    return row!;
  }

  listIdentities(projectId: string) {
    return this.database.db.select().from(experimentIdentities).where(eq(experimentIdentities.projectId, projectId));
  }

  async findReceipt(projectId: string, key: string) {
    const [row] = await this.database.db.select().from(receipts)
      .where(and(eq(receipts.projectId, projectId), eq(receipts.idempotencyKey, key))).limit(1);
    return row || null;
  }

  async saveReceipt(record: typeof receipts.$inferInsert) {
    await this.database.db.insert(receipts).values(record);
  }

  async audit(project: { id: string; labId: string }, actorUserId: string, action: string,
    targetType: string, targetId: string, metadata: RecordValue = {}) {
    await this.database.db.insert(auditEvents).values({
      id: makeId("audit"), labId: project.labId, projectId: project.id, actorUserId,
      action, targetType, targetId, metadata, summary: action, createdAt: new Date().toISOString(),
    });
  }

  domainStore() {
    const e = this.evidence;
    return {
      findSourceDocumentById: (id: string) => e.findSourceDocumentById(id),
      listSourceDocuments: ({ projectId }: RecordValue) => e.listSourceDocuments(projectId),
      listSourceIndexBlobs: ({ sourceDocumentId }: RecordValue) => e.listSourceIndexBlobs(sourceDocumentId),
      listSourceRegions: ({ sourceDocumentId }: RecordValue) => e.listSourceRegions(sourceDocumentId),
      listAcceptedRegionUnderstandings: ({ projectId }: RecordValue) => e.listAcceptedRegionUnderstandings(projectId),
      listExperimentIdentities: ({ projectId }: RecordValue) => this.listIdentities(projectId),
      listWorkbookReviewSessions: ({ projectId, includeDeleted }: RecordValue) => e.listWorkbookReviewSessions(projectId, includeDeleted),
      createWorkbookReviewSession: (input: any) => e.createWorkbookReviewSession(input),
      findWorkbookReviewRegionById: (id: string) => e.findWorkbookReviewRegionById(id),
      listWorkbookReviewRegions: (input: any) => e.listWorkbookReviewRegions(input),
      createWorkbookReviewRegion: (input: any) => e.createWorkbookReviewRegion(input),
      updateWorkbookReviewRegion: (id: string, patch: RecordValue) => e.updateWorkbookReviewRegion(id, patch),
      createRegionUnderstandingRevision: (input: any) => e.createRegionUnderstandingRevision(input),
      findRegionUnderstandingRevisionById: (id: string) => e.findRegionUnderstandingRevisionById(id),
    };
  }
}
