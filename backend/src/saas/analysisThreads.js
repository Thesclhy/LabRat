import {
  ANALYSIS_PLAN_REVISION_VERSION,
  ANALYSIS_RUNTIME_VERSION,
  pythonSourceHash,
  validateAnalysisPlanRevision,
} from "./analysisSchemas.js";
import {
  confirmedSourceRegionCatalog,
  inspectConfirmedSourceRange,
  inspectRunInput,
  materializeAnalysisInputs,
  resolveAnalysisSourceSelections,
  sourceRectanglesForSelections,
} from "./analysisSourceSelections.js";
import { buildAnalysisRunPackage } from "./analysisExecutor.js";
import { validateAnalysisResult } from "./analysisResultValidation.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { makeId } from "./ids.js";
import { validatePythonPolicy } from "./pythonPolicy.js";

const THREAD_LIST_LIMIT = 100;
const ANALYSIS_RUN_LEASE_MS = 360_000;
const MODEL_DRAFT_ATTEMPT_LIMIT = 2;

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

function validIdempotencyKey(value) {
  const key = text(value);
  return key.length > 0
    && key.length <= 200
    && /^[a-zA-Z0-9._:-]+$/.test(key);
}

function diagnostics(error) {
  const values = asArray(error?.details?.errors);
  if (values.length) return values.slice(0, 20);
  return [{
    code: error?.code || "analysis_failed",
    message: error?.message || "Analysis failed.",
  }];
}

function publicExecution(payload = {}) {
  const {
    claimToken: _claimToken,
    pythonProgram: _pythonProgram,
    inputs: _inputs,
    ...value
  } = payload;
  return value;
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
  const plan = revision.plan || {};
  return {
    id: revision.id,
    labId: revision.labId,
    projectId: revision.projectId,
    analysisThreadId: revision.analysisThreadId,
    schemaVersion: revision.schemaVersion,
    revision: revision.revision,
    status: revision.status,
    requestSummary: revision.requestSummary,
    sourceSelections: revision.sourceSelections || plan.sourceSelections || [],
    reviewPlan: revision.reviewPlan || plan.reviewPlan || {},
    displayPlan: revision.displayPlan || plan.displayPlan || [],
    sourceRectangles: revision.sourceRectangles || [],
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
  return {
    id: run.id,
    labId: run.labId,
    projectId: run.projectId,
    analysisThreadId: run.analysisThreadId,
    acceptedPlanRevisionId: run.acceptedPlanRevisionId,
    schemaVersion: run.schemaVersion,
    status: run.status,
    execution: publicExecution(run.payload || {}),
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
  const summary = result.result?.summary || {};
  return {
    id: result.id,
    labId: result.labId,
    projectId: result.projectId,
    analysisThreadId: result.analysisThreadId,
    analysisRunId: result.analysisRunId,
    schemaVersion: result.schemaVersion,
    status: result.status,
    summary,
    pointCount: Number(summary.pointCount) || 0,
    traceCount: Number(summary.seriesCount) || 0,
    exclusionCount: Number(summary.excludedCount) || 0,
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
    schemaVersion: "labrat.analysisThread.v2",
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

function modelPlanCandidate(rawDraft, originalRequest) {
  return {
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    requestSummary: text(rawDraft?.requestSummary) || originalRequest,
    sourceSelections: asArray(rawDraft?.sourceSelections),
    reviewPlan: rawDraft?.reviewPlan || {},
    displayPlan: asArray(rawDraft?.displayPlan).map(text).filter(Boolean),
    warnings: asArray(rawDraft?.warnings),
  };
}

export async function draftAnalysisPlanRevision({
  store,
  project,
  analysisThreadId,
  actorUserId,
  modelProvider,
  feedback = null,
  reviewContext = null,
  allowRetryClaim = false,
  signal = undefined,
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
  const confirmedRegions = await confirmedSourceRegionCatalog({
    store,
    projectId: project.id,
  });
  if (!confirmedRegions.length) {
    throw analysisError(
      "analysis_evidence_required",
      "Confirm workbook regions before drafting an analysis plan.",
      409,
    );
  }
  const priorRevisions = await store.listAnalysisPlanRevisions({
    analysisThreadId: thread.id,
  });
  const request = {
    schemaVersion: "labrat.analysisPlanDraftRequest.v2",
    project: {
      id: project.id,
      name: project.name,
      description: project.description || "",
      projectProfile: project.metadata?.projectProfile || {},
    },
    originalRequest: thread.originalRequest,
    feedback: text(feedback) || null,
    reviewContext: reviewContext || null,
    priorRevisions: priorRevisions.slice(-5).map((revision) => ({
      id: revision.id,
      revision: revision.revision,
      status: revision.status,
      requestSummary: revision.requestSummary,
      sourceSelections: revision.plan?.sourceSelections || [],
      displayPlan: revision.plan?.displayPlan || [],
    })),
    confirmedRegions,
  };
  let draft = null;
  let plan = null;
  let repairContext = null;
  let repairCount = 0;
  for (let attempt = 1; attempt <= MODEL_DRAFT_ATTEMPT_LIMIT; attempt += 1) {
    draft = await modelProvider.draftAnalysisPlan({
      ...request,
      ...(repairContext ? { repairContext } : {}),
    }, {
      signal,
      inspectSourceRange: (input) => inspectConfirmedSourceRange({
        store,
        projectId: project.id,
        ...input,
      }),
    });
    if (!draft?.ok) {
      throw analysisError(
        "analysis_plan_draft_unavailable",
        draft?.warning?.message || "The backend model could not draft an analysis plan.",
        503,
        { warning: draft?.warning || null },
      );
    }
    try {
      const candidate = modelPlanCandidate(draft, thread.originalRequest);
      const sourceSelections = await resolveAnalysisSourceSelections({
        store,
        projectId: project.id,
        sourceSelections: candidate.sourceSelections,
      });
      plan = { ...candidate, sourceSelections };
      const validation = validateAnalysisPlanRevision(plan);
      if (!validation.ok) {
        throw analysisError(
          "analysis_plan_invalid",
          "The drafted analysis plan did not pass backend validation.",
          422,
          { errors: validation.errors },
        );
      }
      break;
    } catch (error) {
      if (attempt >= MODEL_DRAFT_ATTEMPT_LIMIT) throw error;
      repairCount += 1;
      repairContext = {
        attempt: repairCount,
        instruction: "Return a complete replacement plan that corrects every backend error.",
        errors: diagnostics(error),
      };
    }
  }
  const revision = await createAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: thread.id,
    actorUserId,
    plan,
    feedback,
    allowRetryClaim,
  });
  return {
    ...revision,
    draftMetadata: {
      ...(draft?.metadata || {}),
      repairCount,
    },
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
  const sourceSelections = await resolveAnalysisSourceSelections({
    store,
    projectId: project.id,
    sourceSelections: plan?.sourceSelections,
  });
  const normalizedPlan = {
    ...plan,
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    sourceSelections,
  };
  const validation = validateAnalysisPlanRevision(normalizedPlan);
  if (!validation.ok) {
    throw analysisError(
      "analysis_plan_invalid",
      "The analysis plan did not pass backend validation.",
      422,
      { errors: validation.errors },
    );
  }
  const revisions = await store.listAnalysisPlanRevisions({ analysisThreadId: thread.id });
  const prior = revisions.find((item) => item.status === "awaiting_review") || null;
  const createdAt = new Date().toISOString();
  const sourceRectangles = sourceRectanglesForSelections(sourceSelections);
  const revision = {
    id: makeId("analysis_plan_revision"),
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: thread.id,
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    revision: revisions.reduce((largest, item) => Math.max(largest, Number(item.revision) || 0), 0) + 1,
    status: "awaiting_review",
    requestSummary: normalizedPlan.requestSummary,
    plan: normalizedPlan,
    sourceSelections,
    reviewPlan: normalizedPlan.reviewPlan,
    displayPlan: normalizedPlan.displayPlan,
    sourceRectangles,
    feedback: text(feedback) || null,
    warnings: asArray(normalizedPlan.warnings),
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
      content: normalizedPlan.requestSummary,
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
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
  const sourceSelections = revision.plan?.sourceSelections || [];
  return {
    schemaVersion: "labrat.analysisSourceSelectionPage.v2",
    projectId: revision.projectId,
    analysisThreadId: revision.analysisThreadId,
    planRevisionId: revision.id,
    sourceSelections,
    sourceRectangles: revision.sourceRectangles || [],
    records: [],
    warnings: revision.warnings || [],
    page: {
      offset: boundedOffset,
      limit: boundedLimit,
      totalCount: sourceSelections.length,
    },
  };
}

export async function acceptAnalysisPlanRevision({
  store,
  project,
  actorUserId,
  planRevisionId,
  idempotencyKey,
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
    operation: "accept_analysis_plan_v2",
    projectId: project.id,
    planRevisionId: revision.id,
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
      "Only the current awaiting-review plan can be accepted.",
      409,
    );
  }
  await resolveAnalysisSourceSelections({
    store,
    projectId: project.id,
    sourceSelections: revision.plan?.sourceSelections,
  });
  const createdAt = new Date().toISOString();
  const analysisRun = {
    id: makeId("analysis_run"),
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: revision.analysisThreadId,
    acceptedPlanRevisionId: revision.id,
    schemaVersion: "labrat.analysisRun.v2",
    status: "queued",
    idempotencyKey: key,
    requestHash,
    inputHash: "pending",
    programHash: "pending",
    runtimeVersion: ANALYSIS_RUNTIME_VERSION,
    resultPreviewHash: null,
    payload: { phase: "queued" },
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

function inputManifest(inputs) {
  return {
    schemaVersion: inputs.schemaVersion,
    tables: asArray(inputs.tables).map((table) => ({
      tableId: table.tableId,
      sourceSelectionId: table.sourceSelectionId,
      source: table.source,
      startRow: table.startRow,
      startColumn: table.startColumn,
      rowCount: table.rowCount,
      columnCount: table.columnCount,
    })),
  };
}

async function draftPythonProgram({
  modelProvider,
  thread,
  revision,
  inputs,
} = {}) {
  if (typeof modelProvider?.draftAnalysisProgram !== "function") {
    throw analysisError(
      "analysis_program_draft_unavailable",
      "The backend model provider is not configured to generate analysis Python.",
      503,
    );
  }
  const manifest = inputManifest(inputs);
  const initialInputPages = manifest.tables.map((table) => inspectRunInput(inputs, {
    tableId: table.tableId,
    rowOffset: 0,
    rowLimit: Math.min(table.rowCount, 50),
    columnOffset: 0,
    columnLimit: Math.min(table.columnCount, 50),
  }));
  let repairContext = null;
  let response = null;
  for (let attempt = 1; attempt <= MODEL_DRAFT_ATTEMPT_LIMIT; attempt += 1) {
    response = await modelProvider.draftAnalysisProgram({
      schemaVersion: "labrat.analysisProgramDraftRequest.v2",
      originalRequest: thread.originalRequest,
      acceptedPlan: {
        requestSummary: revision.requestSummary,
        sourceSelections: revision.plan?.sourceSelections || [],
        reviewPlan: revision.plan?.reviewPlan || {},
        displayPlan: revision.plan?.displayPlan || [],
      },
      inputManifest: manifest,
      initialInputPages,
      ...(repairContext ? { repairContext } : {}),
    }, {
      inspectRunInput: (request) => inspectRunInput(inputs, request),
    });
    if (!response?.ok) {
      throw analysisError(
        "analysis_program_draft_unavailable",
        response?.warning?.message || "The backend model could not generate analysis Python.",
        503,
        { warning: response?.warning || null },
      );
    }
    const pythonProgram = {
      runtime: text(response.pythonProgram?.runtime) || ANALYSIS_RUNTIME_VERSION,
      entrypoint: text(response.pythonProgram?.entrypoint) || "analyze",
      source: String(response.pythonProgram?.source || ""),
    };
    const policy = validatePythonPolicy(pythonProgram.source, pythonProgram.runtime);
    if (policy.ok) {
      return {
        ...pythonProgram,
        sourceHash: pythonSourceHash(pythonProgram.source),
        modelMetadata: response.metadata || {},
      };
    }
    if (attempt >= MODEL_DRAFT_ATTEMPT_LIMIT) {
      throw analysisError(
        "analysis_python_policy_failed",
        "Generated analysis Python did not pass the backend runtime policy.",
        422,
        { errors: policy.errors },
      );
    }
    repairContext = {
      attempt,
      instruction: "Return a complete replacement Python program correcting every policy error.",
      errors: policy.errors,
    };
  }
  throw analysisError(
    "analysis_program_draft_unavailable",
    "The backend model could not generate analysis Python.",
    503,
  );
}

async function finalizeFailedRun({
  store,
  project,
  actorUserId,
  run,
  revision,
  status,
  error,
  payload = {},
  ipAddress,
  userAgent,
} = {}) {
  const completedAt = new Date().toISOString();
  const errors = diagnostics(error);
  const validation = { ok: false, errors, warnings: [] };
  const finalized = await store.finalizeAnalysisRun({
    projectId: project.id,
    analysisRunId: run.id,
    actorUserId,
    claimToken: run.payload?.claimToken,
    status,
    payload: {
      startedAt: run.payload?.startedAt || null,
      completedAt,
      phase: "failed",
      ...payload,
      error: errors[0],
    },
    warnings: [],
    validation,
    completedAt,
    auditEvents: [executionAuditEvent({
      project,
      actorUserId,
      action: "analysis_run.failed",
      targetType: "analysis_run",
      targetId: run.id,
      summary: errors[0]?.message || "Analysis execution failed.",
      metadata: {
        analysisThreadId: run.analysisThreadId,
        acceptedPlanRevisionId: revision.id,
        errorCodes: errors.map((item) => item.code),
      },
      createdAt: completedAt,
      ipAddress,
      userAgent,
    })],
  });
  return { ...finalized, analysisPlanRevision: revision, idempotentReplay: false };
}

export async function executeAnalysisRun({
  store,
  project,
  actorUserId,
  analysisRunId,
  executor,
  modelProvider,
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
  const startedAt = new Date().toISOString();
  run = await store.claimAnalysisRun({
    projectId: project.id,
    analysisRunId: run.id,
    actorUserId,
    expectedHeadRefs: [],
    staleValidation: {},
    staleAuditEvents: [],
    startedAt,
    staleAfterMs: ANALYSIS_RUN_LEASE_MS,
  });
  let inputs;
  let pythonProgram;
  let runPackage;
  try {
    inputs = await materializeAnalysisInputs({
      store,
      projectId: project.id,
      sourceSelections: revision.plan?.sourceSelections,
    });
    pythonProgram = await draftPythonProgram({
      modelProvider,
      thread: await store.findAnalysisThreadById(run.analysisThreadId),
      revision,
      inputs,
    });
    runPackage = buildAnalysisRunPackage({
      run,
      planRevision: revision,
      inputs,
      pythonProgram,
    });
  } catch (error) {
    return finalizeFailedRun({
      store,
      project,
      actorUserId,
      run,
      revision,
      status: error?.code === "analysis_python_policy_failed" ? "validation_failed" : "failed",
      error,
      payload: {
        phase: error?.code === "analysis_python_policy_failed" ? "policy_check" : "generating_python",
        inputManifest: inputs ? inputManifest(inputs) : null,
        pythonProgram: pythonProgram || null,
      },
      ipAddress,
      userAgent,
    });
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
        message: error?.message || "Analysis executor failed unexpectedly.",
      },
    };
  }
  if (!executorResult?.ok) {
    return finalizeFailedRun({
      store,
      project,
      actorUserId,
      run,
      revision,
      status: "failed",
      error: executorResult?.error || {
        code: "analysis_executor_failed",
        message: "Analysis execution failed.",
      },
      payload: {
        phase: "executing_python",
        inputManifest: inputManifest(inputs),
        inputHash: runPackage.inputHash,
        programHash: runPackage.programHash,
        pythonProgram,
        adapter: executorResult?.adapter || "unknown",
        runtime: executorResult?.runtime || {},
      },
      ipAddress,
      userAgent,
    });
  }
  const checked = validateAnalysisResult({
    run,
    plan: revision,
    executorResult,
  });
  if (!checked.ok) {
    return finalizeFailedRun({
      store,
      project,
      actorUserId,
      run,
      revision,
      status: "validation_failed",
      error: {
        code: "analysis_plotly_validation_failed",
        message: "Python returned a chart that did not pass backend Plotly validation.",
        details: { errors: checked.errors },
      },
      payload: {
        phase: "validating_plotly",
        inputManifest: inputManifest(inputs),
        inputHash: runPackage.inputHash,
        programHash: runPackage.programHash,
        pythonProgram,
        adapter: executorResult?.adapter || "unknown",
        runtime: executorResult?.runtime || {},
      },
      ipAddress,
      userAgent,
    });
  }
  const completedAt = new Date().toISOString();
  const analysisResult = {
    id: makeId("analysis_result"),
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: run.analysisThreadId,
    analysisRunId: run.id,
    schemaVersion: "labrat.analysisResult.v2",
    status: "awaiting_review",
    contentHash: checked.contentHash,
    resultPreviewHash: checked.resultPreviewHash,
    result: checked.result,
    sourceRefs: revision.sourceRectangles || [],
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
    payload: {
      startedAt: run.payload?.startedAt || startedAt,
      completedAt,
      phase: "result_ready",
      inputManifest: inputManifest(inputs),
      inputHash: runPackage.inputHash,
      programHash: runPackage.programHash,
      pythonProgram,
      packageHash: runPackage.packageHash,
      adapter: executorResult?.adapter || "unknown",
      runtime: executorResult?.runtime || {},
      error: null,
    },
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
      summary: "Generated Python from accepted source tables and created a reviewable Plotly result.",
      metadata: {
        analysisThreadId: run.analysisThreadId,
        analysisRunId: run.id,
        acceptedPlanRevisionId: revision.id,
        traceCount: checked.validation.traceCount,
        pointCount: checked.validation.pointCount,
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
  const plotly = detail.analysisResult.result?.plotly || { data: [], layout: {} };
  const traces = asArray(plotly.data);
  return {
    schemaVersion: "labrat.analysisResultPreview.v2",
    projectId: detail.analysisRun.projectId,
    analysisThreadId: detail.analysisRun.analysisThreadId,
    analysisRunId: detail.analysisRun.id,
    analysisResultId: detail.analysisResult.id,
    plotly,
    traces,
    summary: detail.analysisResult.result?.summary || {},
    exclusions: detail.analysisResult.result?.exclusions || [],
    checks: detail.analysisResult.result?.checks || [],
    validation: detail.analysisResult.validation || {},
    warnings: detail.analysisResult.warnings || [],
    sourceRefs: detail.analysisResult.sourceRefs || [],
    tracePage: {
      offset: 0,
      limit: traces.length,
      totalCount: traces.length,
    },
  };
}

export async function reviseAnalysisRun({
  store,
  project,
  actorUserId,
  analysisRunId,
  feedback,
  modelProvider,
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
  const analysisPlanRevision = await draftAnalysisPlanRevision({
    store,
    project,
    analysisThreadId: detail.analysisRun.analysisThreadId,
    actorUserId,
    modelProvider,
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
