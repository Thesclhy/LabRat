import { resolveAnalysisSelection } from "./analysisSelection.js";
import {
  ANALYSIS_PLAN_REVISION_VERSION,
  frozenPlanHash,
  pythonSourceHash,
  validateAnalysisPlanRevision,
} from "./analysisSchemas.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { makeId } from "./ids.js";
import { buildAnalysisRunPackage } from "./analysisExecutor.js";
import { validateAnalysisResult } from "./analysisResultValidation.js";
import { validatePythonPolicy } from "./pythonPolicy.js";

const THREAD_LIST_LIMIT = 100;
const SELECTION_PAGE_LIMIT = 200;
const RESULT_PAGE_LIMIT = 200;
const TRACE_PAGE_LIMIT = 500;
const ANALYSIS_RUN_LEASE_MS = 360_000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function analysisError(code, message, statusCode = 400, details = undefined) {
  return Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details === undefined ? {} : { details }),
  });
}

function sameValues(left, right) {
  return stableDataHash(asArray(left)) === stableDataHash(asArray(right));
}

function validIdempotencyKey(value) {
  const key = text(value);
  return key.length > 0
    && key.length <= 200
    && /^[a-zA-Z0-9._:-]+$/.test(key);
}

async function activeAnalysisInputs(store, projectId) {
  const [dataSnapshots, experimentIdentities, experimentSnapshotHeads] = await Promise.all([
    store.listDataSnapshots({ projectId }),
    store.listExperimentIdentities({ projectId }),
    store.listExperimentSnapshotHeads({ projectId }),
  ]);
  return {
    projectId,
    dataSnapshots,
    experimentIdentities,
    experimentSnapshotHeads,
  };
}

async function currentSelection(store, projectId, selectionRequest) {
  const selection = resolveAnalysisSelection({
    ...(await activeAnalysisInputs(store, projectId)),
    selectionRequest,
  });
  if (!selection.ok) {
    throw analysisError(
      "analysis_selection_invalid",
      "The analysis selection could not be resolved from this project's active accepted data.",
      422,
      { errors: selection.errors || [] },
    );
  }
  return selection;
}

function validatePlanSelection(plan, selection) {
  const validation = validateAnalysisPlanRevision(plan);
  if (!validation.ok) {
    throw analysisError(
      "analysis_plan_invalid",
      "The analysis plan did not pass backend validation.",
      422,
      { errors: validation.errors },
    );
  }
  const selected = plan.selection || {};
  const matches = (
    text(selected.selectionId) === selection.selectionId
    && text(selected.selectionHash) === selection.selectionHash
    && text(selected.dependencyHash) === selection.dependencyHash
    && sameValues(selected.experimentIds, selection.experimentIds)
    && sameValues(selected.fieldIds, selection.fieldIds)
  );
  if (!matches) {
    throw analysisError(
      "analysis_plan_selection_mismatch",
      "The plan selection does not match the backend-resolved accepted data.",
      422,
      {
        expected: {
          selectionId: selection.selectionId,
          selectionHash: selection.selectionHash,
          dependencyHash: selection.dependencyHash,
          experimentIds: selection.experimentIds,
          fieldIds: selection.fieldIds,
        },
      },
    );
  }
  return validation;
}

export function analysisThreadSummary(thread) {
  return {
    id: thread.id,
    labId: thread.labId,
    projectId: thread.projectId,
    schemaVersion: thread.schemaVersion,
    status: thread.status,
    originalRequest: thread.originalRequest,
    messageCount: asArray(thread.messages).length,
    planRevisionIds: asArray(thread.planRevisionIds),
    analysisRunIds: asArray(thread.analysisRunIds),
    acceptedAnalysisResultIds: asArray(thread.acceptedAnalysisResultIds),
    chartSpecIds: asArray(thread.chartSpecIds),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    createdBy: thread.createdBy,
    updatedBy: thread.updatedBy,
  };
}

export function analysisPlanRevisionSummary(revision) {
  return {
    id: revision.id,
    labId: revision.labId,
    projectId: revision.projectId,
    analysisThreadId: revision.analysisThreadId,
    schemaVersion: revision.schemaVersion,
    revision: revision.revision,
    status: revision.status,
    requestSummary: revision.requestSummary,
    processingSummary: revision.processingSummary || [],
    calculationManifest: revision.calculationManifest || {},
    pythonProgram: revision.pythonProgram || {},
    expectedOutput: revision.expectedOutput || {},
    sourceRectangles: revision.sourceRectangles || [],
    planHash: revision.planHash,
    dependencyHash: revision.dependencyHash,
    selectionHash: revision.selectionHash,
    programHash: revision.programHash,
    runtimeVersion: revision.runtimeVersion,
    feedback: revision.feedback || null,
    warnings: revision.warnings || [],
    validation: revision.validation || {},
    acceptedAt: revision.acceptedAt || null,
    acceptedBy: revision.acceptedBy || null,
    createdAt: revision.createdAt,
    updatedAt: revision.updatedAt,
    createdBy: revision.createdBy,
    updatedBy: revision.updatedBy,
  };
}

export function analysisRunSummary(run) {
  const { claimToken: _claimToken, ...execution } = run.payload || {};
  return {
    id: run.id,
    labId: run.labId,
    projectId: run.projectId,
    analysisThreadId: run.analysisThreadId,
    acceptedPlanRevisionId: run.acceptedPlanRevisionId,
    schemaVersion: run.schemaVersion,
    status: run.status,
    inputHash: run.inputHash,
    programHash: run.programHash,
    runtimeVersion: run.runtimeVersion,
    resultPreviewHash: run.resultPreviewHash || null,
    execution,
    warnings: run.warnings || [],
    validation: run.validation || {},
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    createdBy: run.createdBy,
    updatedBy: run.updatedBy,
  };
}

export function analysisResultSummary(result) {
  if (!result) return null;
  return {
    id: result.id,
    labId: result.labId,
    projectId: result.projectId,
    analysisThreadId: result.analysisThreadId,
    analysisRunId: result.analysisRunId,
    schemaVersion: result.schemaVersion,
    status: result.status,
    contentHash: result.contentHash,
    resultPreviewHash: result.resultPreviewHash || null,
    summary: result.result?.summary || {},
    rowCount: asArray(result.result?.resultTable).length,
    traceCount: asArray(result.result?.traces).length,
    sourceRefCount: asArray(result.sourceRefs).length,
    warnings: result.warnings || [],
    validation: result.validation || {},
    acceptedAt: result.acceptedAt || null,
    acceptedBy: result.acceptedBy || null,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    createdBy: result.createdBy,
    updatedBy: result.updatedBy,
  };
}

export async function createAnalysisThread({
  store,
  project,
  actorUserId,
  originalRequest,
  messages = [],
} = {}) {
  const request = text(originalRequest);
  if (!project?.id || !project?.labId || !request) {
    throw analysisError(
      "analysis_thread_request_required",
      "An analysis thread requires a project and originalRequest.",
    );
  }
  if (request.length > 10_000) {
    throw analysisError(
      "analysis_thread_request_too_long",
      "Analysis originalRequest must be 10,000 characters or fewer.",
      413,
    );
  }
  const createdAt = new Date().toISOString();
  return store.createAnalysisThread({
    id: makeId("analysis_thread"),
    labId: project.labId,
    projectId: project.id,
    schemaVersion: "labrat.analysisThread.v1",
    status: "planning",
    originalRequest: request,
    messages: asArray(messages).length ? messages : [{
      id: makeId("analysis_message"),
      role: "user",
      content: request,
      createdAt,
    }],
    planRevisionIds: [],
    analysisRunIds: [],
    acceptedAnalysisResultIds: [],
    chartSpecIds: [],
    createdAt,
    updatedAt: createdAt,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
}

export async function draftAnalysisPlanRevision({
  store,
  project,
  analysisThreadId,
  actorUserId,
  modelProvider,
  analysisToolRegistry,
  feedback = null,
  reviewContext = null,
  allowRetryClaim = false,
} = {}) {
  const thread = await store.findAnalysisThreadById(analysisThreadId);
  if (!thread || thread.projectId !== project?.id) {
    throw analysisError("analysis_thread_not_found", "Analysis thread was not found.", 404);
  }
  if (typeof modelProvider?.draftAnalysisPlan !== "function") {
    throw analysisError(
      "analysis_plan_draft_unavailable",
      "The backend model provider is not configured to draft analysis plans.",
      503,
    );
  }
  if (typeof analysisToolRegistry?.call !== "function") {
    throw analysisError(
      "analysis_plan_tools_unavailable",
      "Analysis planning tools are not configured.",
      503,
    );
  }
  const authContext = { projectId: project.id, actorUserId };
  const [
    projectContext,
    fieldResult,
    experimentIdentities,
    experimentSnapshotHeads,
  ] = await Promise.all([
    analysisToolRegistry.call(
      "get_project_analysis_context",
      { projectId: project.id },
      authContext,
    ),
    analysisToolRegistry.call(
      "list_analysis_fields",
      { projectId: project.id },
      authContext,
    ),
    store.listExperimentIdentities({ projectId: project.id }),
    store.listExperimentSnapshotHeads({ projectId: project.id }),
  ]);
  const fields = asArray(fieldResult.fields).slice(0, 500);
  const activeExperimentIds = new Set(
    asArray(experimentSnapshotHeads).map((head) => head.experimentId),
  );
  const experiments = asArray(experimentIdentities)
    .filter((identity) => activeExperimentIds.has(identity.id))
    .slice(0, 500)
    .map((identity) => ({
      experimentId: identity.id,
      label: identity.canonicalLabel || identity.id,
      aliases: asArray(identity.aliases),
    }));
  if (!fields.length) {
    throw analysisError(
      "analysis_evidence_required",
      "Publish accepted experiment data before drafting an analysis plan.",
      409,
    );
  }
  const priorRevisions = await store.listAnalysisPlanRevisions({
    analysisThreadId: thread.id,
  });
  const draft = await modelProvider.draftAnalysisPlan({
    schemaVersion: "labrat.analysisPlanDraftRequest.v1",
    project: projectContext.project || {
      id: project.id,
      name: project.name,
      description: project.description || "",
    },
    projectContext: {
      publishedExperimentCount: projectContext.publishedExperimentCount,
      sourceDocumentCount: projectContext.sourceDocumentCount,
      chartSpecCount: projectContext.chartSpecCount,
      manuscriptCount: projectContext.manuscriptCount,
    },
    originalRequest: thread.originalRequest,
    feedback: text(feedback) || null,
    reviewContext: reviewContext || null,
    priorRevisions: priorRevisions.slice(-5).map((revision) => ({
      id: revision.id,
      revision: revision.revision,
      status: revision.status,
      requestSummary: revision.requestSummary,
      processingSummary: revision.processingSummary,
      warnings: revision.warnings,
    })),
    fields,
    experiments,
  });
  if (!draft?.ok) {
    throw analysisError(
      "analysis_plan_draft_unavailable",
      draft?.warning?.message || "The backend model could not draft an analysis plan.",
      503,
      { warning: draft?.warning || null },
    );
  }
  const selectionRequest = draft.selectionRequest || draft.plan?.selectionRequest;
  if (!selectionRequest || !asArray(selectionRequest.fieldIds).length) {
    throw analysisError(
      "analysis_plan_selection_required",
      "The drafted plan did not choose any accepted analysis fields.",
      422,
    );
  }
  const selection = await analysisToolRegistry.call(
    "preview_analysis_selection",
    { projectId: project.id, selectionRequest },
    authContext,
  );
  if (!selection?.ok) {
    throw analysisError(
      "analysis_selection_invalid",
      "The drafted selection could not be resolved from active accepted data.",
      422,
      { errors: selection?.errors || [] },
    );
  }
  const rawPlan = draft.plan && typeof draft.plan === "object" ? draft.plan : draft;
  const source = text(rawPlan.pythonProgram?.source);
  const plan = {
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    requestSummary: text(rawPlan.requestSummary) || thread.originalRequest,
    selection: {
      selectionId: selection.selectionId,
      experimentIds: selection.experimentIds,
      fieldIds: selection.fieldIds,
      dependencyHash: selection.dependencyHash,
      selectionHash: selection.selectionHash,
    },
    processingSummary: asArray(rawPlan.processingSummary),
    calculationManifest: rawPlan.calculationManifest || {},
    pythonProgram: {
      ...(rawPlan.pythonProgram || {}),
      runtime: text(rawPlan.pythonProgram?.runtime) || "labrat-python-v1",
      entrypoint: text(rawPlan.pythonProgram?.entrypoint) || "analyze",
      source,
      sourceHash: pythonSourceHash(source),
    },
    expectedOutput: rawPlan.expectedOutput || {},
    warnings: asArray(rawPlan.warnings),
  };
  const planValidation = await analysisToolRegistry.call(
    "validate_analysis_plan",
    { projectId: project.id, plan },
    authContext,
  );
  if (!planValidation?.ok) {
    throw analysisError(
      "analysis_plan_invalid",
      "The drafted analysis plan did not pass backend validation.",
      422,
      { errors: planValidation?.errors || [] },
    );
  }
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId,
    plan,
    selectionRequest,
    feedback,
    allowRetryClaim,
  });
  return {
    ...revision,
    draftMetadata: draft.metadata || {},
  };
}

export async function listAnalysisThreads({
  store,
  projectId,
  offset = 0,
  limit = 50,
} = {}) {
  const boundedOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), THREAD_LIST_LIMIT);
  const threads = await store.listAnalysisThreads({ projectId });
  return {
    analysisThreads: threads
      .slice(boundedOffset, boundedOffset + boundedLimit)
      .map(analysisThreadSummary),
    page: {
      offset: boundedOffset,
      limit: boundedLimit,
      totalCount: threads.length,
    },
  };
}

export async function createAnalysisPlanRevision({
  store,
  project,
  analysisThreadId,
  actorUserId,
  plan,
  selectionRequest = {},
  feedback = null,
  allowRetryClaim = false,
} = {}) {
  const thread = await store.findAnalysisThreadById(analysisThreadId);
  if (!thread || thread.projectId !== project?.id) {
    throw analysisError("analysis_thread_not_found", "Analysis thread was not found.", 404);
  }
  if (![
    "planning",
    "awaiting_plan_review",
    "awaiting_result_review",
    "execution_failed",
    ...(allowRetryClaim ? ["retry_drafting"] : []),
  ].includes(thread.status)) {
    throw analysisError(
      "analysis_thread_closed",
      `Analysis thread cannot accept a plan revision while ${thread.status}.`,
      409,
    );
  }
  const selection = await currentSelection(store, project.id, selectionRequest);
  const validation = validatePlanSelection(plan, selection);
  const policy = validatePythonPolicy(
    plan.pythonProgram?.source,
    plan.pythonProgram?.runtime,
  );
  if (!policy.ok) {
    throw analysisError(
      "analysis_python_policy_failed",
      "The analysis Python program did not pass the backend runtime policy.",
      422,
      { errors: policy.errors },
    );
  }
  const revisions = await store.listAnalysisPlanRevisions({ analysisThreadId: thread.id });
  const prior = revisions.find((item) => item.status === "awaiting_review") || null;
  const createdAt = new Date().toISOString();
  const revision = {
    id: makeId("analysis_plan_revision"),
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: thread.id,
    schemaVersion: plan.schemaVersion,
    revision: revisions.reduce((largest, item) => Math.max(largest, Number(item.revision) || 0), 0) + 1,
    status: "awaiting_review",
    requestSummary: plan.requestSummary,
    plan,
    selection,
    selectionRequest,
    processingSummary: plan.processingSummary,
    calculationManifest: plan.calculationManifest,
    pythonProgram: plan.pythonProgram,
    expectedOutput: plan.expectedOutput,
    sourceRectangles: selection.sourceRectangles,
    planHash: validation.planHash || frozenPlanHash(plan),
    dependencyHash: selection.dependencyHash,
    selectionHash: selection.selectionHash,
    programHash: plan.pythonProgram.sourceHash,
    runtimeVersion: plan.pythonProgram.runtime,
    feedback: text(feedback) || null,
    warnings: asArray(plan.warnings),
    validation: { ok: true, errors: [] },
    acceptedAt: null,
    acceptedBy: null,
    createdAt,
    updatedAt: createdAt,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  };
  const messages = [
    ...(text(feedback) ? [{
      id: makeId("analysis_message"),
      role: "user",
      content: text(feedback),
      createdAt,
      planRevisionId: revision.id,
    }] : []),
    {
      id: makeId("analysis_message"),
      role: "assistant",
      content: plan.requestSummary,
      createdAt,
      planRevisionId: revision.id,
    },
  ];
  return store.appendAnalysisPlanRevision({
    threadId: thread.id,
    priorRevisionId: prior?.id || null,
    revision,
    messages,
    actorUserId,
  });
}

export async function getAnalysisPlanSelectionPage({
  store,
  planRevisionId,
  offset = 0,
  limit = 50,
} = {}) {
  const revision = await store.findAnalysisPlanRevisionById(planRevisionId);
  if (!revision) {
    throw analysisError("analysis_plan_revision_not_found", "Analysis plan revision was not found.", 404);
  }
  const boundedOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), SELECTION_PAGE_LIMIT);
  const records = asArray(revision.selection?.records);
  return {
    schemaVersion: "labrat.analysisSelectionPage.v1",
    projectId: revision.projectId,
    analysisThreadId: revision.analysisThreadId,
    planRevisionId: revision.id,
    selectionId: revision.selection?.selectionId || null,
    fieldCatalog: revision.selection?.fieldCatalog || [],
    experimentIds: revision.selection?.experimentIds || [],
    fieldIds: revision.selection?.fieldIds || [],
    records: records.slice(boundedOffset, boundedOffset + boundedLimit),
    sourceRectangles: revision.sourceRectangles || [],
    dependencyHash: revision.dependencyHash,
    selectionHash: revision.selectionHash,
    coverage: revision.selection?.coverage || {},
    warnings: revision.selection?.warnings || [],
    page: {
      offset: boundedOffset,
      limit: boundedLimit,
      totalCount: records.length,
    },
  };
}

export async function acceptAnalysisPlanRevision({
  store,
  project,
  actorUserId,
  planRevisionId,
  idempotencyKey,
  planHash,
  selectionHash,
  dependencyHash,
  ipAddress = null,
  userAgent = null,
} = {}) {
  const key = text(idempotencyKey);
  if (!validIdempotencyKey(key)) {
    throw analysisError(
      "idempotency_key_required",
      "A valid Idempotency-Key header is required to accept an analysis plan.",
    );
  }
  const revision = await store.findAnalysisPlanRevisionById(planRevisionId);
  if (!revision || revision.projectId !== project?.id) {
    throw analysisError("analysis_plan_revision_not_found", "Analysis plan revision was not found.", 404);
  }
  const requestHash = stableDataHash({
    projectId: project.id,
    planRevisionId: revision.id,
    planHash: text(planHash),
    selectionHash: text(selectionHash),
    dependencyHash: text(dependencyHash),
  });
  const prior = await store.findAnalysisRunByIdempotencyKey?.({
    projectId: project.id,
    idempotencyKey: key,
  });
  if (prior) {
    if (prior.requestHash !== requestHash) {
      throw analysisError(
        "idempotency_key_conflict",
        "This idempotency key was already used for a different plan acceptance.",
        409,
      );
    }
    return {
      analysisThread: await store.findAnalysisThreadById(prior.analysisThreadId),
      analysisPlanRevision: await store.findAnalysisPlanRevisionById(prior.acceptedPlanRevisionId),
      analysisRun: prior,
      idempotentReplay: true,
    };
  }
  if (revision.status !== "awaiting_review") {
    throw analysisError(
      "analysis_plan_revision_mismatch",
      "Only the current visible plan revision can be accepted.",
      409,
    );
  }
  if (
    text(planHash) !== revision.planHash
    || text(selectionHash) !== revision.selectionHash
    || text(dependencyHash) !== revision.dependencyHash
  ) {
    throw analysisError(
      "analysis_plan_revision_mismatch",
      "The accepted hashes do not match the visible plan revision.",
      409,
      {
        currentPlanHash: revision.planHash,
        currentSelectionHash: revision.selectionHash,
        currentDependencyHash: revision.dependencyHash,
      },
    );
  }
  const policy = validatePythonPolicy(
    revision.pythonProgram?.source,
    revision.runtimeVersion,
  );
  if (!policy.ok) {
    throw analysisError(
      "analysis_python_policy_failed",
      "The reviewed analysis Python program did not pass the backend runtime policy.",
      422,
      { errors: policy.errors },
    );
  }
  let selection;
  try {
    selection = await currentSelection(store, project.id, revision.selectionRequest);
  } catch (error) {
    if (error.code !== "analysis_selection_invalid") throw error;
    throw analysisError(
      "analysis_plan_stale",
      "The accepted experiment data changed after this plan was reviewed.",
      409,
      {
        reviewedSelectionHash: revision.selectionHash,
        reviewedDependencyHash: revision.dependencyHash,
        selectionErrors: error.details?.errors || [],
      },
    );
  }
  if (
    selection.selectionHash !== revision.selectionHash
    || selection.dependencyHash !== revision.dependencyHash
  ) {
    throw analysisError(
      "analysis_plan_stale",
      "The accepted experiment data changed after this plan was reviewed.",
      409,
      {
        reviewedSelectionHash: revision.selectionHash,
        currentSelectionHash: selection.selectionHash,
        reviewedDependencyHash: revision.dependencyHash,
        currentDependencyHash: selection.dependencyHash,
      },
    );
  }
  const createdAt = new Date().toISOString();
  const analysisRun = {
    id: makeId("analysis_run"),
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: revision.analysisThreadId,
    acceptedPlanRevisionId: revision.id,
    schemaVersion: "labrat.analysisRun.v1",
    status: "queued",
    idempotencyKey: key,
    requestHash,
    inputHash: revision.selectionHash,
    programHash: revision.programHash,
    runtimeVersion: revision.runtimeVersion,
    resultPreviewHash: null,
    payload: {},
    warnings: [],
    validation: {},
    createdAt,
    updatedAt: createdAt,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  };
  const result = await store.acceptAnalysisPlan({
    projectId: project.id,
    analysisThreadId: revision.analysisThreadId,
    planRevisionId: revision.id,
    actorUserId,
    idempotencyKey: key,
    requestHash,
    analysisRun,
    auditEvents: [{
      labId: project.labId,
      projectId: project.id,
      actorUserId,
      action: "analysis_plan.accept",
      targetType: "analysis_plan_revision",
      targetId: revision.id,
      summary: `Accepted analysis plan revision ${revision.revision} and queued one AnalysisRun.`,
      metadata: {
        analysisThreadId: revision.analysisThreadId,
        analysisRunId: analysisRun.id,
        planHash: revision.planHash,
        selectionHash: revision.selectionHash,
        dependencyHash: revision.dependencyHash,
      },
      createdAt,
      ipAddress,
      userAgent,
    }],
  });
  return { ...result, idempotentReplay: false };
}

async function analysisResultForRun(store, run) {
  if (!run) return null;
  const results = await store.listAnalysisResults({
    projectId: run.projectId,
    analysisThreadId: run.analysisThreadId,
  });
  return results.find((result) => result.analysisRunId === run.id) || null;
}

function collectedSelectionSourceRefs(selection) {
  const candidates = [
    ...asArray(selection?.sourceRectangles),
    ...asArray(selection?.records).flatMap((record) => [
      ...asArray(record.sourceRefs),
      ...asArray(record.fields).flatMap((field) => asArray(field.sourceRefs)),
      ...asArray(record.series).flatMap((series) => [
        ...asArray(series.sourceRefs),
        ...asArray(series.points).flatMap((point) => asArray(point.sourceRefs)),
      ]),
    ]),
  ];
  const seen = new Set();
  return candidates.filter((sourceRef) => {
    const hash = stableDataHash(sourceRef);
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

function executionAuditEvent({
  project,
  actorUserId,
  action,
  targetType,
  targetId,
  summary,
  metadata,
  createdAt,
  ipAddress,
  userAgent,
}) {
  return {
    labId: project.labId,
    projectId: project.id,
    actorUserId,
    action,
    targetType,
    targetId,
    summary,
    metadata,
    createdAt,
    ipAddress,
    userAgent,
  };
}

export async function executeAnalysisRun({
  store,
  project,
  actorUserId,
  analysisRunId,
  executor,
  ipAddress = null,
  userAgent = null,
} = {}) {
  let run = await store.findAnalysisRunById(analysisRunId);
  if (!run || run.projectId !== project?.id) {
    throw analysisError("analysis_run_not_found", "Analysis run was not found.", 404);
  }
  const revision = await store.findAnalysisPlanRevisionById(run.acceptedPlanRevisionId);
  if (!revision || revision.projectId !== project.id || revision.status !== "accepted") {
    throw analysisError(
      "analysis_run_plan_invalid",
      "Analysis run does not reference one accepted plan revision.",
      409,
    );
  }
  if (["awaiting_result_review", "validation_failed", "failed"].includes(run.status)) {
    return {
      analysisThread: await store.findAnalysisThreadById(run.analysisThreadId),
      analysisPlanRevision: revision,
      analysisRun: run,
      analysisResult: await analysisResultForRun(store, run),
      idempotentReplay: true,
    };
  }
  if (!["queued", "running"].includes(run.status)) {
    throw analysisError(
      "analysis_run_state_conflict",
      `Analysis run cannot execute while ${run.status}.`,
      409,
    );
  }
  const selection = revision.selection || {};
  const staleValidation = {
    ok: false,
    errors: [{
      code: "analysis_run_stale",
      message: "Active accepted experiment heads changed before execution claim.",
    }],
    warnings: [],
  };
  const claimAt = new Date().toISOString();
  run = await store.claimAnalysisRun({
    projectId: project.id,
    analysisRunId: run.id,
    actorUserId,
    expectedHeadRefs: asArray(selection.records).map((record) => ({
      headId: record.headId,
      experimentId: record.experimentId,
      dataSnapshotId: record.snapshotId,
      recordIndex: Number(record.recordIndex),
    })),
    staleValidation,
    staleAuditEvents: [executionAuditEvent({
      project,
      actorUserId,
      action: "analysis_run.stale",
      targetType: "analysis_run",
      targetId: run.id,
      summary: "Analysis execution stopped because active accepted experiment heads changed.",
      metadata: {
        analysisThreadId: run.analysisThreadId,
        acceptedPlanRevisionId: revision.id,
      },
      createdAt: claimAt,
      ipAddress,
      userAgent,
    })],
    startedAt: claimAt,
    staleAfterMs: ANALYSIS_RUN_LEASE_MS,
  });
  if (run.status === "validation_failed") {
    return {
      analysisThread: await store.findAnalysisThreadById(run.analysisThreadId),
      analysisPlanRevision: revision,
      analysisRun: run,
      analysisResult: null,
      idempotentReplay: false,
    };
  }

  const preparationErrors = [];
  if (
    selection.selectionHash !== revision.selectionHash
    || selection.dependencyHash !== revision.dependencyHash
    || run.inputHash !== revision.selectionHash
    || run.programHash !== revision.programHash
    || run.runtimeVersion !== revision.runtimeVersion
  ) {
    preparationErrors.push({
      code: "analysis_run_hash_mismatch",
      message: "Frozen execution hashes differ from the accepted plan revision.",
    });
  }
  const policy = validatePythonPolicy(
    revision.pythonProgram?.source,
    revision.runtimeVersion,
  );
  if (!policy.ok) preparationErrors.push(...policy.errors);
  let runPackage = null;
  try {
    runPackage = buildAnalysisRunPackage({ run, planRevision: revision, selection });
  } catch (error) {
    preparationErrors.push({
      code: error.code || "analysis_run_package_invalid",
      message: error.message || "Accepted analysis run package is invalid.",
    });
  }
  if (preparationErrors.length) {
    const completedAt = new Date().toISOString();
    const validation = {
      ok: false,
      errors: preparationErrors,
      warnings: [],
    };
    const finalized = await store.finalizeAnalysisRun({
      projectId: project.id,
      analysisRunId: run.id,
      actorUserId,
      claimToken: run.payload?.claimToken,
      status: "validation_failed",
      payload: {
        startedAt: run.payload?.startedAt || null,
        completedAt,
        packageHash: runPackage?.packageHash || null,
        adapter: "not_started",
        runtime: {},
        error: preparationErrors[0],
      },
      warnings: [],
      validation,
      completedAt,
      auditEvents: [executionAuditEvent({
        project,
        actorUserId,
        action: "analysis_run.preparation_failed",
        targetType: "analysis_run",
        targetId: run.id,
        summary: "Analysis execution stopped because its frozen package failed validation.",
        metadata: {
          analysisThreadId: run.analysisThreadId,
          acceptedPlanRevisionId: revision.id,
          errorCodes: preparationErrors.map((error) => error.code),
        },
        createdAt: completedAt,
        ipAddress,
        userAgent,
      })],
    });
    return {
      ...finalized,
      analysisPlanRevision: revision,
      idempotentReplay: false,
    };
  }

  let executorResult;
  try {
    executorResult = typeof executor?.executeAcceptedRun === "function"
      ? await executor.executeAcceptedRun(runPackage)
      : {
        ok: false,
        adapter: "disabled",
        error: {
          code: "analysis_executor_disabled",
          message: "Analysis execution is disabled until an executor is configured.",
        },
      };
  } catch (error) {
    executorResult = {
      ok: false,
      adapter: "unknown",
      error: {
        code: "analysis_executor_failed",
        message: "Analysis executor failed unexpectedly.",
        detail: text(error?.message),
      },
    };
  }

  const completedAt = new Date().toISOString();
  const executionPayload = {
    startedAt: run.payload?.startedAt || null,
    completedAt,
    packageHash: runPackage.packageHash,
    adapter: executorResult?.adapter || "unknown",
    runtime: executorResult?.runtime || {},
    error: executorResult?.ok ? null : executorResult?.error || null,
  };
  if (!executorResult?.ok) {
    const validation = {
      ok: false,
      errors: [{
        code: executorResult?.error?.code || "analysis_executor_failed",
        message: executorResult?.error?.message || "Analysis execution failed.",
      }],
      warnings: [],
    };
    const finalized = await store.finalizeAnalysisRun({
      projectId: project.id,
      analysisRunId: run.id,
      actorUserId,
      claimToken: run.payload?.claimToken,
      status: "failed",
      payload: executionPayload,
      warnings: [],
      validation,
      completedAt,
      auditEvents: [executionAuditEvent({
        project,
        actorUserId,
        action: "analysis_run.execute_failed",
        targetType: "analysis_run",
        targetId: run.id,
        summary: "Analysis execution failed before producing a reviewable result.",
        metadata: {
          analysisThreadId: run.analysisThreadId,
          acceptedPlanRevisionId: revision.id,
          packageHash: runPackage.packageHash,
          errorCode: validation.errors[0].code,
        },
        createdAt: completedAt,
        ipAddress,
        userAgent,
      })],
    });
    return {
      ...finalized,
      analysisPlanRevision: revision,
      idempotentReplay: false,
    };
  }

  const checked = validateAnalysisResult({
    run,
    plan: revision,
    selection,
    executorResult,
  });
  if (!checked.ok) {
    const finalized = await store.finalizeAnalysisRun({
      projectId: project.id,
      analysisRunId: run.id,
      actorUserId,
      claimToken: run.payload?.claimToken,
      status: "validation_failed",
      payload: executionPayload,
      warnings: checked.warnings,
      validation: checked.validation,
      completedAt,
      auditEvents: [executionAuditEvent({
        project,
        actorUserId,
        action: "analysis_run.validation_failed",
        targetType: "analysis_run",
        targetId: run.id,
        summary: "Analysis output failed backend validation and was not persisted as a result.",
        metadata: {
          analysisThreadId: run.analysisThreadId,
          acceptedPlanRevisionId: revision.id,
          packageHash: runPackage.packageHash,
          errorCodes: checked.errors.map((error) => error.code),
        },
        createdAt: completedAt,
        ipAddress,
        userAgent,
      })],
    });
    return {
      ...finalized,
      analysisPlanRevision: revision,
      idempotentReplay: false,
    };
  }

  const analysisResult = {
    id: makeId("analysis_result"),
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: run.analysisThreadId,
    analysisRunId: run.id,
    schemaVersion: "labrat.analysisResult.v1",
    status: "awaiting_review",
    contentHash: checked.contentHash,
    resultPreviewHash: checked.resultPreviewHash,
    result: checked.result,
    sourceRefs: collectedSelectionSourceRefs(selection),
    warnings: checked.warnings,
    validation: checked.validation,
    acceptedAt: null,
    acceptedBy: null,
    createdAt: completedAt,
    updatedAt: completedAt,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  };
  const finalized = await store.finalizeAnalysisRun({
    projectId: project.id,
    analysisRunId: run.id,
    actorUserId,
    claimToken: run.payload?.claimToken,
    status: "awaiting_result_review",
    resultPreviewHash: checked.resultPreviewHash,
    payload: executionPayload,
    warnings: checked.warnings,
    validation: checked.validation,
    analysisResult,
    completedAt,
    auditEvents: [executionAuditEvent({
      project,
      actorUserId,
      action: "analysis_run.execute",
      targetType: "analysis_result",
      targetId: analysisResult.id,
      summary: "Executed one accepted analysis plan and created a reviewable result.",
      metadata: {
        analysisThreadId: run.analysisThreadId,
        analysisRunId: run.id,
        acceptedPlanRevisionId: revision.id,
        packageHash: runPackage.packageHash,
        resultHash: analysisResult.contentHash,
        resultPreviewHash: analysisResult.resultPreviewHash,
      },
      createdAt: completedAt,
      ipAddress,
      userAgent,
    })],
  });
  return {
    ...finalized,
    analysisPlanRevision: revision,
    idempotentReplay: false,
  };
}

export async function getAnalysisRunDetail({ store, analysisRunId } = {}) {
  const analysisRun = await store.findAnalysisRunById(analysisRunId);
  if (!analysisRun) {
    throw analysisError("analysis_run_not_found", "Analysis run was not found.", 404);
  }
  const [analysisThread, analysisPlanRevision, analysisResult] = await Promise.all([
    store.findAnalysisThreadById(analysisRun.analysisThreadId),
    store.findAnalysisPlanRevisionById(analysisRun.acceptedPlanRevisionId),
    analysisResultForRun(store, analysisRun),
  ]);
  return {
    analysisThread,
    analysisPlanRevision,
    analysisRun,
    analysisResult,
  };
}

export async function getAnalysisResultPreview({
  store,
  analysisRunId,
  offset = 0,
  limit = 50,
  traceOffset = 0,
  traceLimit = 50,
  sourceOffset = 0,
  sourceLimit = 50,
} = {}) {
  const detail = await getAnalysisRunDetail({ store, analysisRunId });
  if (!detail.analysisResult) {
    throw analysisError(
      "analysis_result_not_available",
      "This analysis run does not have a valid reviewable result.",
      409,
      { runStatus: detail.analysisRun.status },
    );
  }
  const rows = asArray(detail.analysisResult.result?.resultTable);
  const traces = asArray(detail.analysisResult.result?.traces);
  const sourceRefs = asArray(detail.analysisResult.sourceRefs);
  const boundedOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const boundedLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 50, 1),
    RESULT_PAGE_LIMIT,
  );
  const boundedTraceOffset = Math.max(Number.parseInt(traceOffset, 10) || 0, 0);
  const boundedTraceLimit = Math.min(
    Math.max(Number.parseInt(traceLimit, 10) || 50, 1),
    TRACE_PAGE_LIMIT,
  );
  const boundedSourceOffset = Math.max(Number.parseInt(sourceOffset, 10) || 0, 0);
  const boundedSourceLimit = Math.min(
    Math.max(Number.parseInt(sourceLimit, 10) || 50, 1),
    RESULT_PAGE_LIMIT,
  );
  const pagedRows = rows.slice(boundedOffset, boundedOffset + boundedLimit);
  const pagedTraces = traces.slice(
    boundedTraceOffset,
    boundedTraceOffset + boundedTraceLimit,
  );
  const visibleLineageIds = new Set([
    ...pagedRows.map((row) => String(row?.__result_id || row?.resultId || "").trim()),
    ...pagedTraces.map((trace) => String(trace?.traceId || "").trim()),
  ].filter(Boolean));
  const lineage = Object.fromEntries(
    Object.entries(detail.analysisResult.result?.lineage || {})
      .filter(([id]) => visibleLineageIds.has(id)),
  );
  return {
    schemaVersion: "labrat.analysisResultPreview.v1",
    projectId: detail.analysisRun.projectId,
    analysisThreadId: detail.analysisRun.analysisThreadId,
    analysisRunId: detail.analysisRun.id,
    analysisResultId: detail.analysisResult.id,
    contentHash: detail.analysisResult.contentHash,
    resultPreviewHash: detail.analysisResult.resultPreviewHash,
    rows: pagedRows,
    traces: pagedTraces,
    lineage,
    summary: detail.analysisResult.result?.summary || {},
    validation: detail.analysisResult.validation || {},
    warnings: detail.analysisResult.warnings || [],
    sourceRefs: sourceRefs.slice(
      boundedSourceOffset,
      boundedSourceOffset + boundedSourceLimit,
    ),
    rowPage: {
      offset: boundedOffset,
      limit: boundedLimit,
      totalCount: rows.length,
    },
    tracePage: {
      offset: boundedTraceOffset,
      limit: boundedTraceLimit,
      totalCount: traces.length,
    },
    sourcePage: {
      offset: boundedSourceOffset,
      limit: boundedSourceLimit,
      totalCount: sourceRefs.length,
    },
  };
}

export async function reviseAnalysisRun({
  store,
  project,
  actorUserId,
  analysisRunId,
  resultHash,
  feedback,
  modelProvider,
  analysisToolRegistry,
} = {}) {
  const value = text(feedback);
  if (!value) {
    throw analysisError(
      "analysis_revision_feedback_required",
      "Feedback is required to revise an analysis run.",
    );
  }
  const detail = await getAnalysisRunDetail({ store, analysisRunId });
  if (detail.analysisRun.projectId !== project?.id) {
    throw analysisError("analysis_run_not_found", "Analysis run was not found.", 404);
  }
  if (!["awaiting_result_review", "validation_failed", "failed"].includes(detail.analysisRun.status)) {
    throw analysisError(
      "analysis_run_revision_unavailable",
      `Analysis run cannot be revised while ${detail.analysisRun.status}.`,
      409,
    );
  }
  if (
    detail.analysisResult
    && text(resultHash) !== detail.analysisResult.contentHash
  ) {
    throw analysisError(
      "analysis_result_hash_mismatch",
      "Revision feedback must reference the exact visible analysis result.",
      409,
      { currentResultHash: detail.analysisResult.contentHash },
    );
  }
  const analysisPlanRevision = await draftAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: detail.analysisRun.analysisThreadId,
    actorUserId,
    modelProvider,
    analysisToolRegistry,
    feedback: value,
    reviewContext: {
      analysisRun: analysisRunSummary(detail.analysisRun),
      analysisResult: analysisResultSummary(detail.analysisResult),
      validation: detail.analysisRun.validation || {},
    },
  });
  return {
    analysisPlanRevision,
    priorAnalysisRun: detail.analysisRun,
    priorAnalysisResult: detail.analysisResult,
  };
}
