import { Inject, Injectable } from "@nestjs/common";
import { makeId, sha256Hex } from "../../saas/ids.js";
import {
  acceptAnalysisPlanRevision,
  analysisPlanRevisionSummary,
  analysisResultSummary,
  analysisRunSummary,
  analysisThreadSummary,
  createAnalysisPlanRevision,
  createAnalysisThread,
  draftAnalysisPlanRevision,
  executeAnalysisRun,
  getAnalysisPlanSelectionPage,
  getAnalysisResultPreview,
  getAnalysisRunDetail,
  retryAnalysisRunGeneration,
  reviseAnalysisRun,
} from "../../saas/analysisThreads.js";
import { publishAcceptedAnalysisChart } from "../../saas/analysisChartPublisher.js";
import { publishAcceptedExperimentAnalysis } from "../../saas/analysisExperimentPublisher.js";
import { agentRunSummary, buildAgentRunDraft } from "../../saas/agentRuns.js";
import { sourceDocumentSummary } from "../../saas/sourceDocuments.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { Capability } from "../authorization/authorization.policy.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import {
  V1_ANALYSIS_EXECUTOR,
  type V1AnalysisExecutor,
} from "../platform/analysis/analysis-executor.js";
import { ApiError } from "../platform/http/api-error.js";
import { V1_MODEL_PROVIDER, type V1ModelProvider } from "../platform/model/model-provider.js";
import type {
  AnalysisPageQueryDto,
  AnalysisSelectionQueryDto,
  CreateAgentRunDto,
  CreateAnalysisPlanRevisionDto,
  CreateAnalysisThreadDto,
  ExecuteAnalysisRunDto,
  PublishAnalysisChartDto,
  PublishExperimentAnalysisDto,
  ReviseAnalysisRunDto,
} from "./analysis.dto.js";
import { AnalysisRepository } from "./analysis.repository.js";

const ANALYSIS_RETRY_LEASE_MS = 6 * 60 * 1_000;
const MAX_PLAN_BYTES = 64 * 1_024;

type LegacyAnalysisOperation = (input: Record<string, any>) => Promise<any>;

const acceptAnalysisPlanRevisionCompat = acceptAnalysisPlanRevision as LegacyAnalysisOperation;
const createAnalysisPlanRevisionCompat = createAnalysisPlanRevision as LegacyAnalysisOperation;
const createAnalysisThreadCompat = createAnalysisThread as LegacyAnalysisOperation;
const draftAnalysisPlanRevisionCompat = draftAnalysisPlanRevision as LegacyAnalysisOperation;
const executeAnalysisRunCompat = executeAnalysisRun as LegacyAnalysisOperation;
const getAnalysisPlanSelectionPageCompat = getAnalysisPlanSelectionPage as LegacyAnalysisOperation;
const getAnalysisResultPreviewCompat = getAnalysisResultPreview as LegacyAnalysisOperation;
const getAnalysisRunDetailCompat = getAnalysisRunDetail as LegacyAnalysisOperation;
const publishAcceptedAnalysisChartCompat = publishAcceptedAnalysisChart as LegacyAnalysisOperation;
const publishAcceptedExperimentAnalysisCompat = publishAcceptedExperimentAnalysis as LegacyAnalysisOperation;
const retryAnalysisRunGenerationCompat = retryAnalysisRunGeneration as LegacyAnalysisOperation;
const reviseAnalysisRunCompat = reviseAnalysisRun as LegacyAnalysisOperation;
const buildAgentRunDraftCompat = buildAgentRunDraft as LegacyAnalysisOperation;

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function nowIso(): string {
  return new Date().toISOString();
}

function idempotencyKey(value: string | string[] | undefined, operation: string): string {
  const normalized = String(Array.isArray(value) ? value[0] || "" : value || "").trim();
  if (!normalized) {
    throw new ApiError(400, "idempotency_key_required", `A valid Idempotency-Key is required to ${operation}.`);
  }
  if (normalized.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new ApiError(
      400,
      "invalid_idempotency_key",
      "Idempotency-Key must use 1-200 letters, numbers, dots, underscores, colons, or hyphens.",
    );
  }
  return normalized;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isInteger(value?.offset) || value.offset < 0) throw new Error("invalid");
    return value.offset;
  } catch {
    throw new ApiError(400, "invalid_cursor", "The pagination cursor is invalid.");
  }
}

function paginate<T>(items: T[], query: AnalysisPageQueryDto) {
  const offset = decodeCursor(query.cursor);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
  };
}

function publicConfig(source: { publicConfig?: () => Record<string, unknown> } | null | undefined) {
  const value = source?.publicConfig?.();
  return value && typeof value === "object" ? value : {};
}

function planningDiagnostics(metadata: Record<string, any> | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const diagnostics: Record<string, string | number> = {};
  const copyString = (key: string, value: unknown, maxLength: number) => {
    const normalized = String(value || "").trim().slice(0, maxLength);
    if (normalized) diagnostics[key] = normalized;
  };
  const copyNumber = (key: string, value: unknown) => {
    const normalized = Number(value);
    if (Number.isFinite(normalized) && normalized >= 0) diagnostics[key] = normalized;
  };
  copyString("provider", metadata.provider, 40);
  copyString("model", metadata.model, 120);
  copyString("stopReason", metadata.stopReason, 80);
  for (const key of [
    "requestedMaxTokens",
    "finalRequestedMaxTokens",
    "truncationRetryMaxTokens",
    "attemptCount",
    "repairAttempts",
    "toolRounds",
    "latencyMs",
  ]) copyNumber(key, metadata[key]);
  copyNumber("inputTokens", metadata.usage?.inputTokens);
  copyNumber("outputTokens", metadata.usage?.outputTokens);
  copyNumber("reasoningTokens", metadata.usage?.reasoningTokens);
  return Object.keys(diagnostics).length ? diagnostics : null;
}

function planningWarning(error: any) {
  const errors = asArray<Record<string, any>>(error?.details?.errors).slice(0, 8).map((item) => ({
    code: String(item.code || "analysis_plan_invalid").slice(0, 120),
    message: String(item.message || "Plan validation failed.").slice(0, 500),
    ...(Number.isInteger(Number(item.line)) ? { line: Number(item.line) } : {}),
  }));
  const provider = error?.details?.warning && typeof error.details.warning === "object"
    ? {
      code: String(error.details.warning.code || "provider_warning").slice(0, 120),
      message: String(error.details.warning.message || "Provider request failed.").slice(0, 500),
      detail: String(error.details.warning.detail || "").slice(0, 1_000) || null,
    }
    : null;
  const diagnostics = planningDiagnostics(error?.details?.metadata);
  return {
    code: String(error?.code || "analysis_plan_draft_failed").slice(0, 120),
    message: String(error?.message || "The reviewed analysis plan could not be drafted.").slice(0, 1_000),
    severity: "warning",
    ...((errors.length || provider || diagnostics) ? {
      details: {
        ...(errors.length ? { errors } : {}),
        ...(provider ? { provider } : {}),
        ...(diagnostics ? { diagnostics } : {}),
      },
    } : {}),
  };
}

function chartSpecListItem(chartSpec: Record<string, any>) {
  const spec = chartSpec.spec && typeof chartSpec.spec === "object" ? chartSpec.spec : {};
  if (spec.origin !== "analysis_result" || spec.schemaVersion !== "labrat.chartSpec.v3") return null;
  const { plotly, traceCatalog, sourceSelections, sourceRefs, ...metadata } = spec;
  return {
    ...chartSpec,
    spec: {
      ...metadata,
      traceCatalog: asArray<Record<string, any>>(traceCatalog).map((trace) => ({
        traceId: trace.traceId || null,
        name: trace.name || null,
        type: trace.type || null,
        pointCount: Number(trace.pointCount) || 0,
      })),
      sourceSelectionCount: asArray(sourceSelections).length,
      sourceRefCount: asArray(sourceRefs).length,
      plotlyTraceCount: asArray(plotly?.data).length,
      detailRequired: true,
    },
  };
}

function isEvidenceBlocked(agentRuns: Array<Record<string, any>>, analysisThreadId: string): boolean {
  return agentRuns.some((run) => (
    asArray<Record<string, any>>(run.proposalRefs).some((ref) => (
      ref.type === "analysis_thread" && ref.id === analysisThreadId
    ))
    && asArray<Record<string, any>>(run.warnings).some((warning) => warning.code === "analysis_evidence_required")
  ));
}

function planFailure(agentRuns: Array<Record<string, any>>, analysisThreadId: string) {
  const run = agentRuns.find((candidate) => (
    asArray<Record<string, any>>(candidate.proposalRefs).some((ref) => (
      ref.type === "analysis_thread" && ref.id === analysisThreadId
    ))
    && asArray<Record<string, any>>(candidate.warnings).some((warning) => warning.code !== "analysis_evidence_required")
  ));
  return run
    ? asArray<Record<string, any>>(run.warnings)
      .filter((warning) => warning.code !== "analysis_evidence_required").at(-1) || null
    : null;
}

@Injectable()
export class AnalysisService {
  constructor(
    private readonly repository: AnalysisRepository,
    private readonly authorization: AuthorizationService,
    private readonly identityRepository: IdentityRepository,
    @Inject(V1_MODEL_PROVIDER) private readonly modelProvider: V1ModelProvider,
    @Inject(V1_ANALYSIS_EXECUTOR) private readonly analysisExecutor: V1AnalysisExecutor,
  ) {}

  async capabilities(auth: AuthContext, projectId: string) {
    await this.fullProject(auth, projectId, "read");
    const [snapshots, heads, accepted] = await Promise.all([
      this.repository.listDataSnapshots({ projectId }),
      this.repository.listExperimentSnapshotHeads({ projectId }),
      this.repository.listAcceptedRegionUnderstandings({ projectId }),
    ]);
    const model = publicConfig(this.modelProvider);
    const executor = publicConfig(this.analysisExecutor);
    return {
      schemaVersion: "labrat.analysisCapabilities.v1",
      projectId,
      model: {
        provider: model.provider || null,
        model: model.model || null,
        configured: Boolean(model.configured),
      },
      executor: {
        mode: executor.mode || "disabled",
        adapter: executor.adapter || "disabled",
        configured: Boolean(executor.configured),
        productionSafe: Boolean(executor.productionSafe),
      },
      acceptedData: {
        acceptedSnapshotCount: snapshots.filter((snapshot) => snapshot.status === "accepted").length,
        activeExperimentHeadCount: heads.length,
        confirmedRegionCount: accepted.length,
      },
    };
  }

  async listThreads(auth: AuthContext, projectId: string, query: AnalysisPageQueryDto) {
    await this.fullProject(auth, projectId, "read");
    const threads = await this.repository.listAnalysisThreads({ projectId });
    return paginate(threads.map(analysisThreadSummary), query);
  }

  async createThread(auth: AuthContext, projectId: string, input: CreateAnalysisThreadDto) {
    if (input.outputTarget === "experiment_browser" && input.inputMode) {
      throw new ApiError(400, "chart_input_mode_conflict", "inputMode is only valid for chart analysis.");
    }
    const { project } = await this.fullProject(auth, projectId, "propose");
    const thread = await createAnalysisThreadCompat({
      store: this.repository,
      project,
      actorUserId: auth.user.id,
      originalRequest: input.originalRequest,
      outputTarget: input.outputTarget || "chart",
      inputMode: input.outputTarget === "experiment_browser" ? null : input.inputMode || null,
    });
    await this.audit(auth, project, "analysis_thread.create", "analysis_thread", thread.id,
      `Created analysis thread ${thread.id}.`);
    return analysisThreadSummary(thread);
  }

  async threadDetail(auth: AuthContext, threadId: string) {
    const thread = await this.thread(auth, threadId, "read");
    const [revisions, runs, agentRuns] = await Promise.all([
      this.repository.listAnalysisPlanRevisions({ analysisThreadId: thread.id }),
      this.repository.listAnalysisRuns({ projectId: thread.projectId, analysisThreadId: thread.id }),
      this.repository.listAgentRuns({ projectId: thread.projectId }),
    ]);
    const failure = !revisions.length && !runs.length ? planFailure(agentRuns, thread.id) : null;
    return {
      analysisThread: {
        ...analysisThreadSummary(thread),
        ...(failure ? { status: "plan_failed" } : {}),
        messages: asArray(thread.messages).slice(-200),
      },
      planRevisions: revisions.slice(0, 200).map(analysisPlanRevisionSummary),
      analysisRuns: runs.slice(0, 200).map(analysisRunSummary),
      planFailure: failure,
    };
  }

  async createPlanRevision(
    auth: AuthContext,
    threadId: string,
    input: CreateAnalysisPlanRevisionDto,
  ) {
    const thread = await this.thread(auth, threadId, "propose");
    const resolved = await this.fullProject(auth, thread.projectId, "propose");
    if (input.plan && Buffer.byteLength(JSON.stringify(input.plan), "utf8") > MAX_PLAN_BYTES) {
      throw new ApiError(413, "analysis_plan_too_large", "Analysis plan input exceeds 64 KiB.");
    }
    const revision = input.plan
      ? await createAnalysisPlanRevisionCompat({
        store: this.repository,
        project: resolved.project,
        analysisThreadId: thread.id,
        actorUserId: auth.user.id,
        plan: input.plan,
        feedback: input.feedback,
      })
      : await draftAnalysisPlanRevisionCompat({
        store: this.repository,
        project: resolved.project,
        analysisThreadId: thread.id,
        actorUserId: auth.user.id,
        modelProvider: this.modelProvider,
        feedback: input.feedback,
      });
    await this.audit(auth, resolved.project, "analysis_plan_revision.create", "analysis_plan_revision", revision.id,
      `Created analysis plan revision ${revision.revision}.`, { analysisThreadId: thread.id });
    return analysisPlanRevisionSummary(revision);
  }

  async selection(
    auth: AuthContext,
    revisionId: string,
    query: AnalysisPageQueryDto,
  ) {
    const revision = await this.planRevision(auth, revisionId, "read");
    return getAnalysisPlanSelectionPageCompat({
      store: this.repository,
      planRevisionId: revision.id,
      offset: decodeCursor(query.cursor),
      limit: query.limit || 50,
    });
  }

  async acceptPlan(
    auth: AuthContext,
    revisionId: string,
    rawIdempotencyKey: string | string[] | undefined,
    requestMeta: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    const revision = await this.planRevision(auth, revisionId, "approve");
    const { project } = await this.fullProject(auth, revision.projectId, "approve");
    const result = await acceptAnalysisPlanRevisionCompat({
      store: this.repository,
      project,
      actorUserId: auth.user.id,
      planRevisionId: revision.id,
      idempotencyKey: idempotencyKey(rawIdempotencyKey, "accept an analysis plan"),
      ...requestMeta,
    });
    return {
      statusCode: result.idempotentReplay ? 200 : 201,
      analysisThread: analysisThreadSummary(result.analysisThread),
      analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
      analysisRun: analysisRunSummary(result.analysisRun),
      idempotentReplay: result.idempotentReplay,
    };
  }

  async retryThread(
    auth: AuthContext,
    threadId: string,
    rawIdempotencyKey: string | string[] | undefined,
  ) {
    const thread = await this.thread(auth, threadId, "propose");
    const { project } = await this.fullProject(auth, thread.projectId, "propose");
    const key = idempotencyKey(rawIdempotencyKey, "retry an analysis thread");
    const [runs, accepted, agentRuns] = await Promise.all([
      this.repository.listAnalysisRuns({ projectId: project.id, analysisThreadId: thread.id }),
      this.repository.listAcceptedRegionUnderstandings({ projectId: project.id }),
      this.repository.listAgentRuns({ projectId: project.id }),
    ]);
    if (!isEvidenceBlocked(agentRuns, thread.id) || runs.length) {
      throw new ApiError(409, "analysis_retry_not_available", "This analysis thread is not awaiting accepted evidence.");
    }
    if (!accepted.length) {
      throw new ApiError(409, "analysis_evidence_required", "Confirm workbook regions before retrying this analysis plan.");
    }
    const requestHash = sha256Hex(JSON.stringify({
      operation: "analysis_thread_retry_v1",
      projectId: project.id,
      analysisThreadId: thread.id,
      actorUserId: auth.user.id,
    }));
    const claim = await this.repository.claimAnalysisThreadRetry({
      labId: project.labId,
      projectId: project.id,
      analysisThreadId: thread.id,
      actorUserId: auth.user.id,
      idempotencyKey: key,
      requestHash,
      leaseMs: ANALYSIS_RETRY_LEASE_MS,
    });
    if (claim?.claimStatus === "replay") {
      const replay = await this.repository.findAnalysisPlanRevisionById(claim.receipt.analysisPlanRevisionId);
      if (replay) return {
        statusCode: 200,
        analysisThread: analysisThreadSummary(claim.analysisThread || thread),
        analysisPlanRevision: analysisPlanRevisionSummary(replay),
        idempotentReplay: true,
      };
    }
    if (claim?.claimStatus === "in_progress") {
      throw new ApiError(409, "analysis_retry_in_progress", "This analysis retry is already drafting a plan.");
    }
    if (claim?.claimStatus !== "claimed") {
      throw new ApiError(409, "analysis_retry_not_available", "This analysis thread is not awaiting accepted evidence.");
    }
    let revision;
    let replayed = false;
    try {
      revision = await draftAnalysisPlanRevisionCompat({
        store: this.repository,
        project,
        analysisThreadId: thread.id,
        actorUserId: auth.user.id,
        modelProvider: this.modelProvider,
        allowRetryClaim: true,
      });
    } catch (error: any) {
      try {
        await this.repository.releaseAnalysisThreadRetry({
          projectId: project.id,
          analysisThreadId: thread.id,
          actorUserId: auth.user.id,
          idempotencyKey: key,
          requestHash,
        });
      } catch {
        // Preserve the provider/draft error; the lease will remain recoverable.
      }
      if (error?.code !== "analysis_plan_revision_conflict" && error?.code !== "23505") throw error;
      revision = (await this.repository.listAnalysisPlanRevisions({ analysisThreadId: thread.id }))
        .find((candidate) => candidate.status === "awaiting_review");
      if (!revision) throw error;
      replayed = true;
    }
    await this.repository.completeAnalysisThreadRetry({
      projectId: project.id,
      analysisThreadId: thread.id,
      actorUserId: auth.user.id,
      idempotencyKey: key,
      requestHash,
      analysisPlanRevisionId: revision.id,
    });
    if (!replayed) {
      await this.audit(auth, project, "analysis_thread.retry", "analysis_plan_revision", revision.id,
        `Retried analysis thread ${thread.id} with accepted evidence.`, { analysisThreadId: thread.id });
    }
    return {
      statusCode: replayed ? 200 : 201,
      analysisThread: analysisThreadSummary(await this.repository.findAnalysisThreadById(thread.id) || thread),
      analysisPlanRevision: analysisPlanRevisionSummary(revision),
      idempotentReplay: replayed,
    };
  }

  async runDetail(auth: AuthContext, runId: string) {
    const run = await this.run(auth, runId, "read");
    const detail = await getAnalysisRunDetailCompat({ store: this.repository, analysisRunId: run.id });
    return {
      analysisThread: analysisThreadSummary(detail.analysisThread),
      analysisPlanRevision: analysisPlanRevisionSummary(detail.analysisPlanRevision),
      analysisRun: analysisRunSummary(detail.analysisRun),
      analysisResult: analysisResultSummary(detail.analysisResult),
    };
  }

  async executeRun(
    auth: AuthContext,
    runId: string,
    input: ExecuteAnalysisRunDto,
    requestMeta: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    const run = await this.run(auth, runId, "propose");
    const { project } = await this.fullProject(auth, run.projectId, "propose");
    const result = await executeAnalysisRunCompat({
      store: this.repository,
      project,
      actorUserId: auth.user.id,
      analysisRunId: run.id,
      executor: this.analysisExecutor,
      modelProvider: this.modelProvider,
      executionStrategy: input.executionStrategy,
      ...requestMeta,
    });
    return {
      statusCode: result.idempotentReplay ? 200 : 201,
      analysisThread: analysisThreadSummary(result.analysisThread),
      analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
      analysisRun: analysisRunSummary(result.analysisRun),
      analysisResult: analysisResultSummary(result.analysisResult),
      idempotentReplay: result.idempotentReplay,
    };
  }

  async retryRun(
    auth: AuthContext,
    runId: string,
    rawIdempotencyKey: string | string[] | undefined,
    requestMeta: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    const run = await this.run(auth, runId, "propose");
    const { project } = await this.fullProject(auth, run.projectId, "propose");
    const result = await retryAnalysisRunGenerationCompat({
      store: this.repository,
      project,
      actorUserId: auth.user.id,
      analysisRunId: run.id,
      idempotencyKey: idempotencyKey(rawIdempotencyKey, "retry analysis generation"),
      ...requestMeta,
    });
    return {
      statusCode: result.idempotentReplay ? 200 : 201,
      analysisThread: analysisThreadSummary(result.analysisThread),
      analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
      analysisRun: analysisRunSummary(result.analysisRun),
      idempotentReplay: result.idempotentReplay,
    };
  }

  async preview(auth: AuthContext, runId: string, query: AnalysisSelectionQueryDto) {
    const run = await this.run(auth, runId, "read");
    return getAnalysisResultPreviewCompat({
      store: this.repository,
      analysisRunId: run.id,
      offset: decodeCursor(query.cursor),
      limit: query.limit || 50,
      traceOffset: decodeCursor(query.traceCursor),
      traceLimit: query.limit || 50,
      sourceOffset: decodeCursor(query.sourceCursor),
      sourceLimit: query.limit || 50,
    });
  }

  async reviseRun(auth: AuthContext, runId: string, input: ReviseAnalysisRunDto) {
    const run = await this.run(auth, runId, "propose");
    const { project } = await this.fullProject(auth, run.projectId, "propose");
    const result = await reviseAnalysisRunCompat({
      store: this.repository,
      project,
      actorUserId: auth.user.id,
      analysisRunId: run.id,
      feedback: input.feedback,
      modelProvider: this.modelProvider,
    });
    await this.audit(auth, project, "analysis_result.request_revision", "analysis_plan_revision",
      result.analysisPlanRevision.id,
      `Requested analysis revision ${result.analysisPlanRevision.revision}.`, {
        analysisThreadId: run.analysisThreadId,
        priorAnalysisRunId: run.id,
        priorAnalysisResultId: result.priorAnalysisResult?.id || null,
      });
    return {
      analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
      priorAnalysisRun: analysisRunSummary(result.priorAnalysisRun),
      priorAnalysisResult: analysisResultSummary(result.priorAnalysisResult),
    };
  }

  async publishChart(
    auth: AuthContext,
    runId: string,
    input: PublishAnalysisChartDto,
    rawIdempotencyKey: string | string[] | undefined,
    requestMeta: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    const run = await this.run(auth, runId, "approve");
    const { project } = await this.fullProject(auth, run.projectId, "approve");
    const result = await publishAcceptedAnalysisChartCompat({
      store: this.repository,
      project,
      actorUserId: auth.user.id,
      runId: run.id,
      analysisResultId: input.analysisResultId,
      defaultVisibleTraceIds: input.defaultVisibleTraceIds,
      idempotencyKey: idempotencyKey(rawIdempotencyKey, "publish an analysis chart"),
      ...requestMeta,
    });
    return {
      statusCode: result.idempotentReplay ? 200 : 201,
      analysisThread: analysisThreadSummary(result.analysisThread),
      analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
      analysisRun: analysisRunSummary(result.analysisRun),
      analysisResult: analysisResultSummary(result.analysisResult),
      chartSpec: result.chartSpec,
      idempotentReplay: result.idempotentReplay,
    };
  }

  async publishExperiments(
    auth: AuthContext,
    runId: string,
    input: PublishExperimentAnalysisDto,
    rawIdempotencyKey: string | string[] | undefined,
    requestMeta: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    const run = await this.run(auth, runId, "approve");
    const { project } = await this.fullProject(auth, run.projectId, "approve");
    const result = await publishAcceptedExperimentAnalysisCompat({
      store: this.repository,
      project,
      actorUserId: auth.user.id,
      analysisRunId: run.id,
      analysisResultId: input.analysisResultId,
      identityResolutions: input.identityResolutions,
      idempotencyKey: idempotencyKey(rawIdempotencyKey, "publish experiment data"),
      ...requestMeta,
    });
    return {
      statusCode: result.idempotentReplay ? 200 : 201,
      analysisThread: analysisThreadSummary(result.analysisThread),
      analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
      analysisRun: analysisRunSummary(result.analysisRun),
      analysisResult: analysisResultSummary(result.analysisResult),
      dataSnapshot: result.dataSnapshot,
      browserView: result.browserView,
      experimentIdentities: result.experimentIdentities,
      experimentSnapshotHeads: result.experimentSnapshotHeads,
      changeSummary: result.changeSummary,
      idempotentReplay: result.idempotentReplay,
    };
  }

  async listAgentRunSummaries(auth: AuthContext, projectId: string, query: AnalysisPageQueryDto) {
    await this.fullProject(auth, projectId, "read");
    return paginate((await this.repository.listAgentRuns({ projectId })).map(agentRunSummary), query);
  }

  async createAgentRun(auth: AuthContext, projectId: string, input: CreateAgentRunDto) {
    const { project } = await this.fullProject(auth, projectId, "propose");
    const selectedChartInputMode = String(input.selectedContext?.chartInputMode || "").trim();
    if (selectedChartInputMode && !["experiment_browser", "workbook"].includes(selectedChartInputMode)) {
      throw new ApiError(
        400,
        "invalid_chart_input_mode",
        "selectedContext.chartInputMode must be experiment_browser or workbook.",
      );
    }
    const [chartSpecs, manuscripts, heads, sourceDocuments, accepted] = await Promise.all([
      this.repository.listChartSpecs({ projectId }),
      this.repository.listManuscripts({ projectId }),
      this.repository.listExperimentSnapshotHeads({ projectId }),
      this.repository.listSourceDocuments({ projectId }),
      this.repository.listAcceptedRegionUnderstandings({ projectId }),
    ]);
    const boundedChartSpecs = chartSpecs.map(chartSpecListItem).filter(Boolean);
    const draft = await buildAgentRunDraftCompat({
      context: { store: this.repository, modelProvider: this.modelProvider },
      project,
      projectProfile: project.metadata?.projectProfile || {},
      chartSpecs: boundedChartSpecs,
      manuscripts: manuscripts.map((manuscript) => ({ id: manuscript.id, title: manuscript.title })),
      experimentSnapshotHeads: heads,
      sourceDocuments: sourceDocuments.map(sourceDocumentSummary),
      message: input.message,
      conversation: input.conversation || [],
      selectedContext: input.selectedContext || {},
    });
    if (
      selectedChartInputMode
      && draft.mode === "analysis_planning"
      && draft.analysisRequest?.outputTarget !== "chart"
    ) {
      throw new ApiError(
        400,
        "chart_input_mode_conflict",
        "selectedContext.chartInputMode can only be used with a chart analysis request.",
      );
    }
    let agentRun = await this.repository.createAgentRun({
      labId: project.labId,
      projectId,
      status: draft.status || "waiting_for_user",
      mode: draft.mode || null,
      userMessage: input.message,
      selectedContext: input.selectedContext || {},
      visibleSteps: draft.visibleSteps || [],
      toolTrace: draft.toolTrace || [],
      proposalRefs: draft.proposalRefs || [],
      actions: draft.actions || [],
      usage: draft.usage || {},
      warnings: draft.warnings || [],
      createdBy: auth.user.id,
    });
    if (!agentRun) throw new ApiError(500, "agent_run_create_failed", "Agent run could not be created.");

    let thread = null;
    let revision = null;
    let reply = String(draft.reply || "");
    if (draft.mode === "analysis_planning") {
      thread = await createAnalysisThreadCompat({
        store: this.repository,
        project,
        actorUserId: auth.user.id,
        originalRequest: input.message,
        outputTarget: draft.analysisRequest?.outputTarget || "chart",
        inputMode: draft.analysisRequest?.outputTarget === "chart" ? selectedChartInputMode || null : null,
        messages: [{
          id: makeId("analysis_message"),
          role: "user",
          content: input.message,
          createdAt: agentRun.createdAt,
          agentRunId: agentRun.id,
        }],
      });
      const warnings = [...asArray<Record<string, any>>(agentRun.warnings)];
      let failedMetadata = null;
      if (accepted.length || (draft.analysisRequest?.outputTarget === "experiment_browser" && heads.length)) {
        try {
          revision = await draftAnalysisPlanRevisionCompat({
            store: this.repository,
            project,
            analysisThreadId: thread.id,
            actorUserId: auth.user.id,
            modelProvider: this.modelProvider,
          });
        } catch (error: any) {
          failedMetadata = error?.details?.metadata || null;
          const warning = planningWarning(error);
          warnings.push(warning);
          reply = `I created an analysis thread, but the backend could not draft a reviewable plan. ${warning.message}`;
        }
      } else {
        const message = draft.analysisRequest?.outputTarget === "experiment_browser"
          ? "Confirm workbook regions or publish experiment data before drafting an Experiment Browser plan."
          : "Confirm workbook regions before drafting an analysis plan.";
        warnings.push({ code: "analysis_evidence_required", message, severity: "info" });
        reply = draft.analysisRequest?.outputTarget === "experiment_browser"
          ? "I created an Experiment Browser data thread, but confirmed workbook regions or active experiment data are required before I can draft the reviewed plan."
          : "I created an analysis thread, but user-confirmed workbook regions are required before I can draft the reviewed analysis plan.";
      }
      const metadata = revision?.draftMetadata || failedMetadata || {};
      const diagnostics = planningDiagnostics(metadata);
      const priorUsage = agentRun.usage || {};
      agentRun = await this.repository.updateAgentRun(agentRun.id, {
        visibleSteps: [
          ...asArray(agentRun.visibleSteps),
          {
            stepId: makeId("agent_step"),
            label: revision ? "Drafted reviewable analysis plan" : "Created analysis thread",
            details: { analysisThreadId: thread.id, planRevisionId: revision?.id || null },
            createdAt: nowIso(),
          },
        ],
        toolTrace: revision ? [
          ...asArray(agentRun.toolTrace),
          {
            tool: "list_confirmed_analysis_regions",
            observation: { projectId, confirmedRegionCount: accepted.length },
          },
          {
            tool: "select_confirmed_source_ranges",
            observation: {
              projectId,
              selectionCount: asArray(revision.sourceSelections).length,
              sourceSelections: asArray<Record<string, any>>(revision.sourceSelections).map((selection) => ({
                sourceDocumentId: selection.sourceDocumentId,
                sheetName: selection.sheetName,
                range: selection.range,
              })),
            },
          },
          { tool: "validate_analysis_plan", observation: { projectId, planRevisionId: revision.id, ok: true } },
        ] : agentRun.toolTrace,
        proposalRefs: [
          ...asArray(agentRun.proposalRefs),
          { type: "analysis_thread", id: thread.id },
          ...(revision ? [{ type: "analysis_plan_revision", id: revision.id }] : []),
        ],
        usage: {
          ...priorUsage,
          provider: metadata.provider || priorUsage.provider,
          model: metadata.model || priorUsage.model,
          inputTokens: (Number(priorUsage.inputTokens) || 0) + (Number(metadata.usage?.inputTokens) || 0),
          outputTokens: (Number(priorUsage.outputTokens) || 0) + (Number(metadata.usage?.outputTokens) || 0),
          ...((Object.hasOwn(priorUsage, "reasoningTokens") || Object.hasOwn(metadata.usage || {}, "reasoningTokens"))
            ? { reasoningTokens: (Number(priorUsage.reasoningTokens) || 0) + (Number(metadata.usage?.reasoningTokens) || 0) }
            : {}),
          latencyMs: (Number(priorUsage.latencyMs) || 0) + (Number(metadata.latencyMs) || 0),
          ...(diagnostics ? { planning: diagnostics } : {}),
        },
        warnings,
        updatedBy: auth.user.id,
      });
      if (!agentRun) throw new ApiError(500, "agent_run_update_failed", "Agent run could not be updated.");
      if (!revision && warnings.some((warning) => warning.code !== "analysis_evidence_required")) {
        await this.repository.updateAnalysisThread(thread.id, { status: "plan_failed", updatedBy: auth.user.id });
      }
      thread = await this.repository.findAnalysisThreadById(thread.id);
      if (!thread) throw new ApiError(500, "analysis_thread_missing", "Created analysis thread could not be reloaded.");
      await this.audit(auth, project, "analysis_thread.create", "analysis_thread", thread.id,
        `Created analysis thread ${thread.id} from AgentRun.`, {
          agentRunId: agentRun.id,
          currentPlanRevisionId: revision?.id || null,
        });
      if (revision) {
        await this.audit(auth, project, "analysis_plan_revision.create", "analysis_plan_revision", revision.id,
          `Created analysis plan revision ${revision.revision} from AgentRun.`, {
            agentRunId: agentRun.id,
            analysisThreadId: thread.id,
          });
      }
    }
    await this.audit(auth, project, "agent_run.create", "agent_run", agentRun.id,
      `Created AgentRun ${agentRun.id}.`, {
        mode: agentRun.mode,
        actionCount: asArray(agentRun.actions).length,
      });
    return {
      agentRun: agentRunSummary(agentRun),
      reply,
      analysisThread: thread ? analysisThreadSummary(thread) : null,
      currentPlanRevision: revision ? analysisPlanRevisionSummary(revision) : null,
    };
  }

  async getAgentRun(auth: AuthContext, agentRunId: string) {
    const run = await this.agentRun(auth, agentRunId, "read");
    return agentRunSummary(run);
  }

  async cancelAgentRun(auth: AuthContext, agentRunId: string) {
    const run = await this.agentRun(auth, agentRunId, "propose");
    if (run.status === "completed") {
      throw new ApiError(409, "agent_run_completed", "Completed AgentRuns cannot be cancelled.");
    }
    const updated = await this.repository.updateAgentRun(run.id, {
      status: "cancelled",
      updatedBy: auth.user.id,
    });
    if (!updated) throw new ApiError(404, "agent_run_not_found", "Agent run not found.");
    await this.identityRepository.recordAudit({
      labId: run.labId,
      projectId: run.projectId,
      actorUserId: auth.user.id,
      action: "agent_run.cancel",
      targetType: "agent_run",
      targetId: run.id,
      summary: `Cancelled AgentRun ${run.id}.`,
    });
    return agentRunSummary(updated);
  }

  private fullProject(auth: AuthContext, projectId: string, capability: Capability) {
    return this.authorization.requireFullProjectCapability(auth, projectId, capability);
  }

  private async ownedProjectResource(
    auth: AuthContext,
    projectId: string,
    capability: Capability,
    code: string,
    message: string,
  ) {
    const resolved = await this.authorization.resolveProjectAccess(auth, projectId);
    if (!resolved?.access?.allExperiments) throw new ApiError(404, code, message);
    if (!resolved.access.capabilities.includes(capability)) {
      throw new ApiError(403, "forbidden", `Full-project capability ${capability} is required.`);
    }
    return resolved;
  }

  private async thread(auth: AuthContext, threadId: string, capability: Capability) {
    const thread = await this.repository.findAnalysisThreadById(threadId);
    if (!thread) throw new ApiError(404, "analysis_thread_not_found", "Analysis thread not found.");
    await this.ownedProjectResource(auth, thread.projectId, capability,
      "analysis_thread_not_found", "Analysis thread not found.");
    return thread;
  }

  private async planRevision(auth: AuthContext, revisionId: string, capability: Capability) {
    const revision = await this.repository.findAnalysisPlanRevisionById(revisionId);
    if (!revision) throw new ApiError(404, "analysis_plan_revision_not_found", "Analysis plan revision not found.");
    await this.ownedProjectResource(auth, revision.projectId, capability,
      "analysis_plan_revision_not_found", "Analysis plan revision not found.");
    return revision;
  }

  private async run(auth: AuthContext, runId: string, capability: Capability) {
    const run = await this.repository.findAnalysisRunById(runId);
    if (!run) throw new ApiError(404, "analysis_run_not_found", "Analysis run not found.");
    await this.ownedProjectResource(auth, run.projectId, capability,
      "analysis_run_not_found", "Analysis run not found.");
    return run;
  }

  private async agentRun(auth: AuthContext, agentRunId: string, capability: Capability) {
    const run = await this.repository.findAgentRunById(agentRunId);
    if (!run) throw new ApiError(404, "agent_run_not_found", "Agent run not found.");
    await this.ownedProjectResource(auth, run.projectId, capability,
      "agent_run_not_found", "Agent run not found.");
    return run;
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
}
