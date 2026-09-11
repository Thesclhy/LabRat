import { Injectable } from "@nestjs/common";
import { and, desc, eq, ne } from "drizzle-orm";
import { PostgresSaasStore } from "../../saas/postgresStore.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  chartStyleProfiles,
  chartStyleProfileVersions,
  reusableChartTemplateApplications,
  reusableChartTemplates,
  reusableChartTemplateVersions,
} from "../platform/database/schema.js";

type CompatStore = any;

function versionPayload<T extends { payload: Record<string, unknown> }>(row: T | undefined) {
  if (!row) return null;
  const { payload, ...record } = row;
  return { ...payload, ...record };
}

@Injectable()
export class ReusableChartsRepository {
  private compatStoreInstance: CompatStore | null = null;

  constructor(private readonly database: DatabaseService) {}

  private compatStore(): CompatStore {
    if (!this.compatStoreInstance) {
      const store = new PostgresSaasStore({ databaseUrl: "" }) as unknown as CompatStore;
      store.pool = this.database.rawPool;
      this.compatStoreInstance = store;
    }
    return this.compatStoreInstance;
  }

  listChartStyleProfiles(projectId: string, includeArchived = false, offset = 0, limit = 51) {
    const condition = includeArchived
      ? eq(chartStyleProfiles.projectId, projectId)
      : and(eq(chartStyleProfiles.projectId, projectId), ne(chartStyleProfiles.status, "archived"));
    return this.database.db.select().from(chartStyleProfiles)
      .where(condition).orderBy(desc(chartStyleProfiles.updatedAt), desc(chartStyleProfiles.id))
      .offset(offset).limit(limit);
  }

  async findChartStyleProfileById(id: string) {
    const [row] = await this.database.db.select().from(chartStyleProfiles)
      .where(eq(chartStyleProfiles.id, id)).limit(1);
    return row || null;
  }

  async findChartStyleProfileVersionById(id: string) {
    const [row] = await this.database.db.select().from(chartStyleProfileVersions)
      .where(eq(chartStyleProfileVersions.id, id)).limit(1);
    return versionPayload(row);
  }

  async listChartStyleProfileVersions(chartStyleProfileId: string) {
    const rows = await this.database.db.select().from(chartStyleProfileVersions)
      .where(eq(chartStyleProfileVersions.chartStyleProfileId, chartStyleProfileId))
      .orderBy(desc(chartStyleProfileVersions.version));
    return rows.map((row) => versionPayload(row));
  }

  listReusableChartTemplates(projectId: string, includeArchived = false, offset = 0, limit = 51) {
    const condition = includeArchived
      ? eq(reusableChartTemplates.projectId, projectId)
      : and(eq(reusableChartTemplates.projectId, projectId), ne(reusableChartTemplates.status, "archived"));
    return this.database.db.select().from(reusableChartTemplates)
      .where(condition).orderBy(desc(reusableChartTemplates.updatedAt), desc(reusableChartTemplates.id))
      .offset(offset).limit(limit);
  }

  async findReusableChartTemplateById(id: string) {
    const [row] = await this.database.db.select().from(reusableChartTemplates)
      .where(eq(reusableChartTemplates.id, id)).limit(1);
    return row || null;
  }

  async findReusableChartTemplateVersionById(id: string) {
    const [row] = await this.database.db.select().from(reusableChartTemplateVersions)
      .where(eq(reusableChartTemplateVersions.id, id)).limit(1);
    return versionPayload(row);
  }

  async listReusableChartTemplateVersions(reusableChartTemplateId: string) {
    const rows = await this.database.db.select().from(reusableChartTemplateVersions)
      .where(eq(reusableChartTemplateVersions.reusableChartTemplateId, reusableChartTemplateId))
      .orderBy(desc(reusableChartTemplateVersions.version));
    return rows.map((row) => versionPayload(row));
  }

  async findReusableChartTemplateApplicationByIdempotencyKey(projectId: string, key: string) {
    const [row] = await this.database.db.select().from(reusableChartTemplateApplications).where(and(
      eq(reusableChartTemplateApplications.projectId, projectId),
      eq(reusableChartTemplateApplications.idempotencyKey, key),
    )).limit(1);
    return row || null;
  }

  async findReusableChartTemplateApplicationById(id: string) {
    const [row] = await this.database.db.select().from(reusableChartTemplateApplications)
      .where(eq(reusableChartTemplateApplications.id, id)).limit(1);
    return row || null;
  }

  findFileObjectById(id: string) {
    return this.compatStore().findFileObjectById(id);
  }

  findChartSpecById(id: string) {
    return this.compatStore().findChartSpecById(id);
  }

  findDataSnapshotById(id: string) {
    return this.compatStore().findDataSnapshotById(id);
  }

  listExperimentSnapshotHeads(input: Record<string, unknown>) {
    return this.compatStore().listExperimentSnapshotHeads(input);
  }

  listReusableChartTemplateSlotBindings(input: Record<string, unknown>) {
    return this.compatStore().listReusableChartTemplateSlotBindings(input);
  }

  findAnalysisThreadById(id: string) {
    return this.compatStore().findAnalysisThreadById(id);
  }

  findAnalysisPlanRevisionById(id: string) {
    return this.compatStore().findAnalysisPlanRevisionById(id);
  }

  findAnalysisRunById(id: string) {
    return this.compatStore().findAnalysisRunById(id);
  }

  createChartStyleProfile(input: Record<string, unknown>) {
    return this.compatStore().createChartStyleProfile(input);
  }

  appendChartStyleProfileVersion(input: Record<string, unknown>) {
    return this.compatStore().appendChartStyleProfileVersion(input);
  }

  archiveChartStyleProfile(input: Record<string, unknown>) {
    return this.compatStore().archiveChartStyleProfile(input);
  }

  createReusableChartTemplate(input: Record<string, unknown>) {
    return this.compatStore().createReusableChartTemplate(input);
  }

  appendReusableChartTemplateVersion(input: Record<string, unknown>) {
    return this.compatStore().appendReusableChartTemplateVersion(input);
  }

  archiveReusableChartTemplate(input: Record<string, unknown>) {
    return this.compatStore().archiveReusableChartTemplate(input);
  }

  createReusableChartTemplateApplication(input: Record<string, unknown>) {
    return this.compatStore().createReusableChartTemplateApplication(input);
  }

  updateReusableChartTemplateApplication(id: string, changes: Record<string, unknown>) {
    return this.compatStore().updateReusableChartTemplateApplication(id, changes);
  }
}
