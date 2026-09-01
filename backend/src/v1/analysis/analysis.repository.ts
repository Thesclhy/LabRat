import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { PostgresSaasStore } from "../../saas/postgresStore.js";
import { EvidenceRepository } from "../evidence/evidence.repository.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  agentRuns,
  analysisExperimentPublications,
  analysisPlanRevisions,
  analysisPublications,
  analysisResults,
  analysisRuns,
  analysisThreads,
  chartSpecs,
  dataSnapshots,
  experimentIdentities,
  experimentSnapshotHeads,
  manuscripts,
} from "../platform/database/schema.js";

type JsonObject = Record<string, unknown>;
type AtomicStore = any;

function now(): string {
  return new Date().toISOString();
}

@Injectable()
export class AnalysisRepository {
  private atomicStoreInstance: AtomicStore | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly evidence: EvidenceRepository,
  ) {}

  private atomicStore(): AtomicStore {
    if (!this.atomicStoreInstance) {
      const store = new PostgresSaasStore({ databaseUrl: "" }) as unknown as AtomicStore;
      store.pool = this.database.rawPool;
      this.atomicStoreInstance = store;
    }
    return this.atomicStoreInstance;
  }

  async createAgentRun(input: Record<string, any>) {
    const timestamp = now();
    const [created] = await this.database.db.insert(agentRuns).values({
      id: input.id || makeId("agent_run"),
      labId: input.labId,
      projectId: input.projectId,
      schemaVersion: input.schemaVersion || "labrat.agentRun.v1",
      status: input.status || "waiting_for_user",
      mode: input.mode || null,
      userMessage: input.userMessage || "",
      selectedContext: input.selectedContext || {},
      visibleSteps: input.visibleSteps || [],
      toolTrace: input.toolTrace || [],
      proposalRefs: input.proposalRefs || [],
      actions: input.actions || [],
      usage: input.usage || {},
      warnings: input.warnings || [],
      error: input.error || null,
      createdAt: input.createdAt || timestamp,
      updatedAt: input.updatedAt || timestamp,
      createdBy: input.createdBy || null,
      updatedBy: input.updatedBy || input.createdBy || null,
    }).returning();
    return created || null;
  }

  async findAgentRunById(id: string) {
    const [row] = await this.database.db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
    return row || null;
  }

  async listAgentRuns({ projectId }: { projectId: string }) {
    return this.database.db.select().from(agentRuns)
      .where(eq(agentRuns.projectId, projectId))
      .orderBy(desc(agentRuns.updatedAt), desc(agentRuns.id));
  }

  async updateAgentRun(id: string, changes: Record<string, any>) {
    const current = await this.findAgentRunById(id);
    if (!current) return null;
    const [updated] = await this.database.db.update(agentRuns).set({
      status: changes.status ?? current.status,
      mode: changes.mode ?? current.mode,
      selectedContext: changes.selectedContext ?? current.selectedContext,
      visibleSteps: changes.visibleSteps ?? current.visibleSteps,
      toolTrace: changes.toolTrace ?? current.toolTrace,
      proposalRefs: changes.proposalRefs ?? current.proposalRefs,
      actions: changes.actions ?? current.actions,
      usage: changes.usage ?? current.usage,
      warnings: changes.warnings ?? current.warnings,
      error: changes.error !== undefined ? changes.error : current.error,
      updatedAt: changes.updatedAt || now(),
      updatedBy: changes.updatedBy || current.updatedBy,
    }).where(eq(agentRuns.id, id)).returning();
    return updated || null;
  }

  async createAnalysisThread(input: Record<string, any>) {
    const timestamp = input.createdAt || now();
    const [created] = await this.database.db.insert(analysisThreads).values({
      id: input.id || makeId("analysis_thread"),
      labId: input.labId,
      projectId: input.projectId,
      schemaVersion: input.schemaVersion || "labrat.analysisThread.v1",
      status: input.status || "planning",
      originalRequest: input.originalRequest || "",
      messages: input.messages || [],
      planRevisionIds: input.planRevisionIds || [],
      analysisRunIds: input.analysisRunIds || [],
      acceptedAnalysisResultIds: input.acceptedAnalysisResultIds || [],
      chartSpecIds: input.chartSpecIds || [],
      outputTarget: input.outputTarget || "chart",
      dataSnapshotIds: input.dataSnapshotIds || [],
      browserViewIds: input.browserViewIds || [],
      createdAt: timestamp,
      updatedAt: input.updatedAt || timestamp,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy || input.createdBy,
    }).returning();
    return created || null;
  }

  async findAnalysisThreadById(id: string) {
    const [row] = await this.database.db.select().from(analysisThreads)
      .where(eq(analysisThreads.id, id)).limit(1);
    return row || null;
  }

  async listAnalysisThreads({ projectId }: { projectId: string }) {
    return this.database.db.select().from(analysisThreads)
      .where(eq(analysisThreads.projectId, projectId))
      .orderBy(desc(analysisThreads.updatedAt), desc(analysisThreads.id));
  }

  async updateAnalysisThread(id: string, changes: Record<string, any> = {}) {
    const current = await this.findAnalysisThreadById(id);
    if (!current) return null;
    const [updated] = await this.database.db.update(analysisThreads).set({
      status: changes.status ?? current.status,
      outputTarget: changes.outputTarget ?? current.outputTarget,
      messages: changes.messages ?? current.messages,
      planRevisionIds: changes.planRevisionIds ?? current.planRevisionIds,
      analysisRunIds: changes.analysisRunIds ?? current.analysisRunIds,
      acceptedAnalysisResultIds: changes.acceptedAnalysisResultIds ?? current.acceptedAnalysisResultIds,
      chartSpecIds: changes.chartSpecIds ?? current.chartSpecIds,
      dataSnapshotIds: changes.dataSnapshotIds ?? current.dataSnapshotIds,
      browserViewIds: changes.browserViewIds ?? current.browserViewIds,
      updatedAt: changes.updatedAt || now(),
      updatedBy: changes.updatedBy || current.updatedBy,
    }).where(eq(analysisThreads.id, id)).returning();
    return updated || null;
  }

  async findAnalysisPlanRevisionById(id: string) {
    const [row] = await this.database.db.select().from(analysisPlanRevisions)
      .where(eq(analysisPlanRevisions.id, id)).limit(1);
    return row || null;
  }

  async listAnalysisPlanRevisions({ analysisThreadId }: { analysisThreadId: string }) {
    return this.database.db.select().from(analysisPlanRevisions)
      .where(eq(analysisPlanRevisions.analysisThreadId, analysisThreadId))
      .orderBy(desc(analysisPlanRevisions.revision));
  }

  async findAnalysisRunById(id: string) {
    const [row] = await this.database.db.select().from(analysisRuns)
      .where(eq(analysisRuns.id, id)).limit(1);
    return row || null;
  }

  async findAnalysisRunByIdempotencyKey(input: { projectId: string; idempotencyKey: string }) {
    const [row] = await this.database.db.select().from(analysisRuns).where(and(
      eq(analysisRuns.projectId, input.projectId),
      eq(analysisRuns.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    return row || null;
  }

  async listAnalysisRuns(input: { projectId: string; analysisThreadId?: string | null }) {
    const condition = input.analysisThreadId
      ? and(eq(analysisRuns.projectId, input.projectId), eq(analysisRuns.analysisThreadId, input.analysisThreadId))
      : eq(analysisRuns.projectId, input.projectId);
    return this.database.db.select().from(analysisRuns).where(condition)
      .orderBy(desc(analysisRuns.createdAt), desc(analysisRuns.id));
  }

  async findAnalysisResultById(id: string) {
    const [row] = await this.database.db.select().from(analysisResults)
      .where(eq(analysisResults.id, id)).limit(1);
    return row || null;
  }

  async listAnalysisResults(input: { projectId: string; analysisThreadId?: string | null }) {
    const condition = input.analysisThreadId
      ? and(eq(analysisResults.projectId, input.projectId), eq(analysisResults.analysisThreadId, input.analysisThreadId))
      : eq(analysisResults.projectId, input.projectId);
    return this.database.db.select().from(analysisResults).where(condition)
      .orderBy(desc(analysisResults.createdAt), desc(analysisResults.id));
  }

  async listDataSnapshots({ projectId }: { projectId: string }) {
    return this.database.db.select().from(dataSnapshots)
      .where(eq(dataSnapshots.projectId, projectId)).orderBy(desc(dataSnapshots.createdAt));
  }

  async listExperimentIdentities({ projectId }: { projectId: string }) {
    return this.database.db.select().from(experimentIdentities)
      .where(eq(experimentIdentities.projectId, projectId)).orderBy(experimentIdentities.canonicalLabel);
  }

  async listExperimentSnapshotHeads({ projectId }: { projectId: string }) {
    return this.database.db.select().from(experimentSnapshotHeads)
      .where(eq(experimentSnapshotHeads.projectId, projectId)).orderBy(experimentSnapshotHeads.experimentId);
  }

  listAcceptedRegionUnderstandings({ projectId }: { projectId: string }) {
    return this.evidence.listAcceptedRegionUnderstandings(projectId);
  }

  listSourceDocuments({ projectId }: { projectId: string }) {
    return this.evidence.listSourceDocuments(projectId);
  }

  findSourceDocumentById(id: string) {
    return this.evidence.findSourceDocumentById(id);
  }

  listSourceIndexBlobs({ sourceDocumentId }: { sourceDocumentId: string }) {
    return this.evidence.listSourceIndexBlobs(sourceDocumentId);
  }

  async listChartSpecs({ projectId }: { projectId: string }) {
    return this.database.db.select().from(chartSpecs)
      .where(eq(chartSpecs.projectId, projectId)).orderBy(desc(chartSpecs.updatedAt));
  }

  async findChartSpecById(id: string) {
    const [row] = await this.database.db.select().from(chartSpecs).where(eq(chartSpecs.id, id)).limit(1);
    return row || null;
  }

  async listManuscripts({ projectId }: { projectId: string }) {
    return this.database.db.select().from(manuscripts)
      .where(eq(manuscripts.projectId, projectId)).orderBy(desc(manuscripts.updatedAt));
  }

  async findAnalysisPublication(input: { projectId: string; idempotencyKey: string }) {
    const [row] = await this.database.db.select().from(analysisPublications).where(and(
      eq(analysisPublications.projectId, input.projectId),
      eq(analysisPublications.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    return row || null;
  }

  async findExperimentAnalysisPublication(input: { projectId: string; idempotencyKey: string }) {
    const [row] = await this.database.db.select().from(analysisExperimentPublications).where(and(
      eq(analysisExperimentPublications.projectId, input.projectId),
      eq(analysisExperimentPublications.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    return row || null;
  }

  appendAnalysisPlanRevision(input: Record<string, unknown>) {
    return this.atomicStore().appendAnalysisPlanRevision(input);
  }

  claimAnalysisThreadRetry(input: Record<string, unknown>) {
    return this.atomicStore().claimAnalysisThreadRetry(input);
  }

  releaseAnalysisThreadRetry(input: Record<string, unknown>) {
    return this.atomicStore().releaseAnalysisThreadRetry(input);
  }

  completeAnalysisThreadRetry(input: Record<string, unknown>) {
    return this.atomicStore().completeAnalysisThreadRetry(input);
  }

  acceptAnalysisPlan(input: Record<string, unknown>) {
    return this.atomicStore().acceptAnalysisPlan(input);
  }

  retryAnalysisRun(input: Record<string, unknown>) {
    return this.atomicStore().retryAnalysisRun(input);
  }

  claimAnalysisRun(input: Record<string, unknown>) {
    return this.atomicStore().claimAnalysisRun(input);
  }

  finalizeAnalysisRun(input: Record<string, unknown>) {
    return this.atomicStore().finalizeAnalysisRun(input);
  }

  publishAnalysisResult(input: Record<string, unknown>) {
    return this.atomicStore().publishAnalysisResult(input);
  }

  publishExperimentAnalysis(input: Record<string, unknown>) {
    return this.atomicStore().publishExperimentAnalysis(input);
  }
}
