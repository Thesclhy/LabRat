import {
  ANALYSIS_PLAN_REVISION_VERSION,
  ANALYSIS_RUNTIME_VERSION,
  ANALYSIS_OUTPUT_TARGETS,
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
import {
  experimentInputCatalog,
  inspectExperimentInput,
  loadActiveExperimentContext,
  materializeExperimentInputs,
  resolveExperimentSelections,
  validateExperimentBrowserResult,
} from "./experimentBrowserAnalysis.js";
import { buildAnalysisRunPackage } from "./analysisExecutor.js";
import { validateAnalysisResult } from "./analysisResultValidation.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { makeId } from "./ids.js";
import { validatePythonPolicy } from "./pythonPolicy.js";
import { deterministicExperimentBrowserProgram } from "./deterministicExperimentBrowserProgram.js";

const THREAD_LIST_LIMIT = 100;
const ANALYSIS_RUN_LEASE_MS = 360_000;
const MODEL_DRAFT_ATTEMPT_LIMIT = 2;
const PROGRAM_EXECUTION_REPAIR_LIMIT = 1;
const EXPERIMENT_BROWSER_PROGRAM_MAX_NONBLANK_LINES = 180;
const EXPERIMENT_BROWSER_PROGRAM_MAX_BYTES = 24_000;

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
    ...(error?.details && typeof error.details === "object"
      ? Object.fromEntries(Object.entries(error.details).filter(([key]) => key !== "errors"))
      : {}),
  }];
}

function groupedProgramRepairDiagnostics(values) {
  const grouped = new Map();
  asArray(values).forEach((item) => {
    const normalized = item || {};
    const key = JSON.stringify([
      normalized.code || "analysis_validation_failed",
      normalized.message || "",
    ]);
    const current = grouped.get(key) || {
      code: normalized.code || "analysis_validation_failed",
      message: normalized.message || "Analysis validation failed.",
      count: 0,
      examples: [],
    };
    current.count += 1;
    const example = [
      normalized.experimentLabel,
      normalized.fieldName,
    ].filter(Boolean).join(" / ") || normalized.path || "";
    if (example && current.examples.length < 8 && !current.examples.includes(example)) {
      current.examples.push(example);
    }
    if (normalized.code === "experiment_patch_numeric_value_invalid") {
      current.repairGuidance = "If the source is blank or a placeholder, emit value None, formattedValue None, an exact missingReason, and the original source pointer. Otherwise emit one finite number. Never emit a placeholder string or implicit zero.";
    }
    if ([
      "experiment_patch_missing_reason_required",
      "experiment_patch_missing_source_mismatch",
      "experiment_patch_missing_formatted_value_invalid",
    ].includes(normalized.code)) {
      current.repairGuidance = "For missing scalar data, emit value None, formattedValue None, a source-backed missingReason, and the exact accepted source pointer.";
    }
    if ([
      "experiment_patch_column_index_invalid",
      "experiment_patch_field_metadata_forbidden",
      "experiment_output_column_metadata_forbidden",
    ].includes(normalized.code)) {
      current.repairGuidance = "Define scalar metadata once in top-level columns, then reference it from recordPatches[].values with a valid zero-based columnIndex. Do not output semanticKey, role, targetFieldId, or columnId.";
    }
    if (normalized.code === "experiment_output_column_type_invalid") {
      current.repairGuidance = "Each top-level output column requires displayName, valueType (number, string, date, or boolean), and unit (or None).";
    }
    grouped.set(key, current);
  });
  return [...grouped.values()].slice(0, 20);
}

function experimentBrowserProgramSizeErrors(source) {
  const value = String(source || "");
  const nonblankLines = value.split(/\r?\n/).filter((line) => line.trim()).length;
  const bytes = Buffer.byteLength(value, "utf8");
  const errors = [];
  if (nonblankLines > EXPERIMENT_BROWSER_PROGRAM_MAX_NONBLANK_LINES) {
    errors.push({
      code: "analysis_program_line_limit_exceeded",
      message: `Experiment Browser Python must contain at most ${EXPERIMENT_BROWSER_PROGRAM_MAX_NONBLANK_LINES} non-blank lines.`,
      nonblankLines,
    });
  }
  if (bytes > EXPERIMENT_BROWSER_PROGRAM_MAX_BYTES) {
    errors.push({
      code: "analysis_program_byte_limit_exceeded",
      message: `Experiment Browser Python must be at most ${EXPERIMENT_BROWSER_PROGRAM_MAX_BYTES} bytes.`,
      bytes,
    });
  }
  return errors;
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
    outputTarget: thread.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART,
    originalRequest: thread.originalRequest,
    messageCount: asArray(thread.messages).length,
    planRevisionIds: asArray(thread.planRevisionIds),
    analysisRunIds: asArray(thread.analysisRunIds),
    acceptedAnalysisResultIds: asArray(thread.acceptedAnalysisResultIds),
    chartSpecIds: asArray(thread.chartSpecIds),
    dataSnapshotIds: asArray(thread.dataSnapshotIds),
    browserViewIds: asArray(thread.browserViewIds),
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
    outputTarget: revision.outputTarget || plan.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART,
    requestSummary: revision.requestSummary,
    sourceSelections: revision.sourceSelections || plan.sourceSelections || [],
    experimentSelections: revision.experimentSelections || plan.experimentSelections || [],
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
    outputTarget: run.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART,
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
    outputTarget: result.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART,
    summary,
    pointCount: Number(summary.pointCount) || 0,
    traceCount: Number(summary.seriesCount) || 0,
    experimentCount: Number(summary.experimentCount) || 0,
    newExperimentCount: Number(summary.newExperimentCount) || 0,
    changedFieldCount: Number(summary.changedFieldCount) || 0,
    conflictCount: Number(summary.conflictCount) || 0,
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
  outputTarget = ANALYSIS_OUTPUT_TARGETS.CHART,
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
  const normalizedTarget = Object.values(ANALYSIS_OUTPUT_TARGETS).includes(text(outputTarget))
    ? text(outputTarget)
    : ANALYSIS_OUTPUT_TARGETS.CHART;
  return store.createAnalysisThread({
    id: makeId("analysis_thread"),
    labId: project.labId,
    projectId: project.id,
    schemaVersion: "labrat.analysisThread.v2",
    status: "planning",
    outputTarget: normalizedTarget,
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
    dataSnapshotIds: [],
    browserViewIds: [],
    createdAt,
    updatedAt: createdAt,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
}

function modelPlanCandidate(rawDraft, originalRequest, outputTarget = ANALYSIS_OUTPUT_TARGETS.CHART) {
  return {
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    outputTarget,
    requestSummary: text(rawDraft?.requestSummary) || originalRequest,
    sourceSelections: asArray(rawDraft?.sourceSelections),
    experimentSelections: asArray(rawDraft?.experimentSelections),
    reviewPlan: rawDraft?.reviewPlan || {},
    displayPlan: asArray(rawDraft?.displayPlan).map(text).filter(Boolean),
    warnings: asArray(rawDraft?.warnings),
  };
}

function compactExperimentPlanningCatalog(activeExperiments = []) {
  return {
    experimentCount: asArray(activeExperiments).length,
    experiments: asArray(activeExperiments).map((experiment) => ({
      experimentId: experiment.experimentId,
      label: experiment.label,
      aliases: experiment.aliases,
      activeHead: experiment.activeHead,
      fields: asArray(experiment.fields).map((field) => ({
        columnIndex: field.columnIndex,
        displayName: field.displayName,
        valueType: field.valueType,
        unit: field.unit,
        sourceSummary: field.sourceSummary || null,
      })),
      series: asArray(experiment.series),
    })),
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
  const outputTarget = thread.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART;
  const draftProvider = outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
    ? modelProvider?.draftExperimentBrowserPlan
    : modelProvider?.draftAnalysisPlan;
  if (typeof draftProvider !== "function") {
    throw analysisError(
      "analysis_plan_draft_unavailable",
      "The backend model provider is not configured to draft analysis plans.",
      503,
    );
  }
  const [confirmedRegions, activeExperiments] = await Promise.all([
    confirmedSourceRegionCatalog({
      store,
      projectId: project.id,
    }),
    experimentInputCatalog({ store, projectId: project.id }),
  ]);
  if (!confirmedRegions.length && !activeExperiments.length) {
    throw analysisError(
      "analysis_evidence_required",
      "Confirm workbook regions or publish experiment data before drafting an analysis plan.",
      409,
    );
  }
  const priorRevisions = await store.listAnalysisPlanRevisions({
    analysisThreadId: thread.id,
  });
  const activeExperimentCatalog = compactExperimentPlanningCatalog(activeExperiments);
  const request = {
    schemaVersion: "labrat.analysisPlanDraftRequest.v4",
    project: {
      id: project.id,
      name: project.name,
      description: project.description || "",
      projectProfile: project.metadata?.projectProfile || {},
    },
    originalRequest: thread.originalRequest,
    outputTarget,
    feedback: text(feedback) || null,
    reviewContext: reviewContext || null,
    priorRevisions: priorRevisions.slice(-5).map((revision) => ({
      id: revision.id,
      revision: revision.revision,
      status: revision.status,
      requestSummary: revision.requestSummary,
      sourceSelections: revision.plan?.sourceSelections || [],
      experimentSelections: revision.plan?.experimentSelections || [],
      displayPlan: revision.plan?.displayPlan || [],
    })),
    confirmedRegions,
    activeExperimentCatalog,
  };
  let draft = null;
  let plan = null;
  let repairContext = null;
  let repairCount = 0;
  for (let attempt = 1; attempt <= MODEL_DRAFT_ATTEMPT_LIMIT; attempt += 1) {
    draft = await draftProvider.call(modelProvider, {
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
      const candidate = modelPlanCandidate(draft, thread.originalRequest, outputTarget);
      const sourceSelections = candidate.sourceSelections.length
        ? await resolveAnalysisSourceSelections({
          store,
          projectId: project.id,
          sourceSelections: candidate.sourceSelections,
        })
        : [];
      const experimentSelections = await resolveExperimentSelections({
        store,
        projectId: project.id,
        experimentSelections: candidate.experimentSelections,
      });
      plan = {
        ...candidate,
        sourceSelections,
        experimentSelections,
      };
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
  const outputTarget = thread.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART;
  if (text(plan?.outputTarget) && text(plan.outputTarget) !== outputTarget) {
    throw analysisError(
      "analysis_output_target_mismatch",
      "A plan revision cannot change the analysis thread output target.",
      409,
    );
  }
  const sourceSelections = asArray(plan?.sourceSelections).length
    ? await resolveAnalysisSourceSelections({
      store,
      projectId: project.id,
      sourceSelections: plan?.sourceSelections,
    })
    : [];
  const experimentSelections = await resolveExperimentSelections({
    store,
    projectId: project.id,
    experimentSelections: plan?.experimentSelections,
  });
  const normalizedPlan = {
    ...plan,
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    outputTarget,
    sourceSelections,
    experimentSelections,
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
    outputTarget,
    requestSummary: normalizedPlan.requestSummary,
    plan: normalizedPlan,
    sourceSelections,
    experimentSelections,
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
  const experimentSelections = revision.plan?.experimentSelections || [];
  return {
    schemaVersion: "labrat.analysisSourceSelectionPage.v3",
    projectId: revision.projectId,
    analysisThreadId: revision.analysisThreadId,
    planRevisionId: revision.id,
    sourceSelections,
    experimentSelections,
    sourceRectangles: revision.sourceRectangles || [],
    records: [],
    warnings: revision.warnings || [],
    page: {
      offset: boundedOffset,
      limit: boundedLimit,
      totalCount: sourceSelections.length + experimentSelections.length,
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
    operation: "accept_analysis_plan_v3",
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
  if (asArray(revision.plan?.sourceSelections).length) {
    await resolveAnalysisSourceSelections({
      store,
      projectId: project.id,
      sourceSelections: revision.plan?.sourceSelections,
    });
  }
  if (asArray(revision.plan?.experimentSelections).length) {
    await resolveExperimentSelections({
      store,
      projectId: project.id,
      experimentSelections: revision.plan?.experimentSelections,
    });
  }
  const createdAt = new Date().toISOString();
  const analysisRun = {
    id: makeId("analysis_run"),
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: revision.analysisThreadId,
    acceptedPlanRevisionId: revision.id,
    schemaVersion: "labrat.analysisRun.v3",
    status: "queued",
    outputTarget: revision.outputTarget || revision.plan?.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART,
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

export async function retryAnalysisRunGeneration({
  store,
  project,
  actorUserId,
  analysisRunId,
  idempotencyKey,
  ipAddress = null,
  userAgent = null,
} = {}) {
  const key = text(idempotencyKey);
  if (!validIdempotencyKey(key)) {
    throw analysisError(
      "idempotency_key_required",
      "A valid Idempotency-Key header is required to retry generation.",
    );
  }
  const failedRun = await store.findAnalysisRunById(analysisRunId);
  if (!failedRun || failedRun.projectId !== project?.id) {
    throw analysisError("analysis_run_not_found", "Analysis run was not found.", 404);
  }
  if (!["failed", "validation_failed"].includes(failedRun.status)) {
    throw analysisError(
      "analysis_run_retry_unavailable",
      "Only a failed analysis generation can be retried.",
      409,
    );
  }
  const revision = await store.findAnalysisPlanRevisionById(failedRun.acceptedPlanRevisionId);
  if (!revision || revision.projectId !== project.id || revision.status !== "accepted") {
    throw analysisError(
      "analysis_run_plan_invalid",
      "The failed run no longer references an accepted plan.",
      409,
    );
  }
  const requestHash = stableDataHash({
    operation: "retry_analysis_generation_v1",
    projectId: project.id,
    failedAnalysisRunId: failedRun.id,
    acceptedPlanRevisionId: revision.id,
  });
  const prior = await store.findAnalysisRunByIdempotencyKey?.({
    projectId: project.id,
    idempotencyKey: key,
  });
  if (prior) {
    if (prior.requestHash !== requestHash) {
      throw analysisError(
        "idempotency_key_conflict",
        "This idempotency key was already used for a different generation retry.",
        409,
      );
    }
    return {
      analysisThread: await store.findAnalysisThreadById(prior.analysisThreadId),
      analysisPlanRevision: revision,
      analysisRun: prior,
      idempotentReplay: true,
    };
  }
  const createdAt = new Date().toISOString();
  const analysisRun = {
    id: makeId("analysis_run"),
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: failedRun.analysisThreadId,
    acceptedPlanRevisionId: revision.id,
    schemaVersion: "labrat.analysisRun.v3",
    status: "queued",
    outputTarget: failedRun.outputTarget || revision.outputTarget || ANALYSIS_OUTPUT_TARGETS.CHART,
    idempotencyKey: key,
    requestHash,
    inputHash: "pending",
    programHash: "pending",
    runtimeVersion: ANALYSIS_RUNTIME_VERSION,
    resultPreviewHash: null,
    payload: { phase: "queued", retryOfAnalysisRunId: failedRun.id },
    warnings: [],
    validation: {},
    createdAt,
    updatedAt: createdAt,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  };
  const result = await store.retryAnalysisRun({
    projectId: project.id,
    failedAnalysisRunId: failedRun.id,
    analysisThreadId: failedRun.analysisThreadId,
    planRevisionId: revision.id,
    actorUserId,
    idempotencyKey: key,
    requestHash,
    analysisRun,
    auditEvents: [executionAuditEvent({
      project,
      actorUserId,
      action: "analysis_run.retry",
      targetType: "analysis_run",
      targetId: analysisRun.id,
      summary: "Queued a new generation attempt using the same accepted analysis plan.",
      metadata: {
        analysisThreadId: failedRun.analysisThreadId,
        failedAnalysisRunId: failedRun.id,
        acceptedPlanRevisionId: revision.id,
      },
      createdAt,
      ipAddress,
      userAgent,
    })],
  });
  return { ...result, analysisPlanRevision: revision, idempotentReplay: false };
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
      columns: asArray(table.columns),
    })),
    experiments: asArray(inputs.experiments).map((experiment) => ({
      experimentSelectionId: experiment.experimentSelectionId,
      experimentId: experiment.experimentId,
      label: experiment.label,
      fieldCount: asArray(experiment.fields).length,
      seriesCount: asArray(experiment.series).length,
      activeHead: experiment.activeHead,
    })),
  };
}

async function draftPythonProgram({
  modelProvider,
  thread,
  revision,
  inputs,
  initialRepairContext = null,
  executionStrategy = "model_generated_python",
} = {}) {
  const outputTarget = revision.outputTarget
    || revision.plan?.outputTarget
    || ANALYSIS_OUTPUT_TARGETS.CHART;
  if (
    outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
    && executionStrategy === "direct_source_mapping"
  ) {
    const program = deterministicExperimentBrowserProgram();
    const policy = validatePythonPolicy(program.source, program.runtime);
    if (!policy.ok) {
      throw analysisError(
        "analysis_python_policy_failed",
        "The built-in Experiment Browser source mapper did not pass the backend runtime policy.",
        500,
        { errors: policy.errors },
      );
    }
    return {
      ...program,
      sourceHash: pythonSourceHash(program.source),
    };
  }
  const programProvider = outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
    ? modelProvider?.draftExperimentBrowserProgram
    : modelProvider?.draftAnalysisProgram;
  if (typeof programProvider !== "function") {
    throw analysisError(
      "analysis_program_draft_unavailable",
      "The backend model provider is not configured to generate analysis Python.",
      503,
    );
  }
  const manifest = inputManifest(inputs);
  const initialRowLimit = outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
    ? 12
    : 50;
  const initialInputPages = manifest.tables.map((table) => inspectRunInput(inputs, {
    tableId: table.tableId,
    rowOffset: 0,
    rowLimit: Math.min(table.rowCount, initialRowLimit),
    columnOffset: 0,
    columnLimit: Math.min(table.columnCount, 50),
  }));
  let repairContext = initialRepairContext;
  let response = null;
  for (let attempt = 1; attempt <= MODEL_DRAFT_ATTEMPT_LIMIT; attempt += 1) {
    response = await programProvider.call(modelProvider, {
      schemaVersion: "labrat.analysisProgramDraftRequest.v4",
      originalRequest: thread.originalRequest,
      acceptedPlan: {
        requestSummary: revision.requestSummary,
        sourceSelections: revision.plan?.sourceSelections || [],
        experimentSelections: revision.plan?.experimentSelections || [],
        reviewPlan: revision.plan?.reviewPlan || {},
        displayPlan: revision.plan?.displayPlan || [],
      },
      inputManifest: manifest,
      initialInputPages,
      ...(repairContext ? { repairContext } : {}),
    }, {
      inspectRunInput: (request) => inspectRunInput(inputs, request),
      inspectExperimentInput: (request) => inspectExperimentInput(inputs, request),
    });
    if (!response?.ok) {
      if (
        response?.warning?.code === "ai_output_truncated"
        && attempt < MODEL_DRAFT_ATTEMPT_LIMIT
      ) {
        repairContext = {
          attempt,
          instruction: outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
            ? "The prior response exceeded the output limit. Return only one complete compact program under 180 non-blank lines. Use loops over inputs; do not embed rows, values, records, explanations, or a statement per experiment."
            : "The prior response exceeded the output limit. Return only one complete compact replacement program with no explanation or embedded input data.",
          errors: [{
            code: "ai_output_truncated",
            message: "The prior generated program exceeded the provider output-token limit.",
          }],
        };
        continue;
      }
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
    const sizeErrors = outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
      ? experimentBrowserProgramSizeErrors(pythonProgram.source)
      : [];
    const programErrors = [...asArray(policy.errors), ...sizeErrors];
    if (policy.ok && !sizeErrors.length) {
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
        { errors: programErrors },
      );
    }
    repairContext = {
      attempt,
      instruction: sizeErrors.length
        ? "Return one complete compact replacement program under 180 non-blank lines and 24000 bytes. Use reusable loops and do not embed source rows or output records."
        : "Return a complete replacement Python program correcting every policy error.",
      errors: programErrors,
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
  const validation = {
    ok: false,
    errors,
    warnings: [],
    totalErrorCount: Number(error?.details?.totalErrorCount) || errors.length,
  };
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
  executionStrategy = "model_generated_python",
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
  const outputTarget = run.outputTarget
    || revision.outputTarget
    || revision.plan?.outputTarget
    || ANALYSIS_OUTPUT_TARGETS.CHART;
  const resolvedExecutionStrategy = outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
    && executionStrategy === "direct_source_mapping"
    ? "direct_source_mapping"
    : "model_generated_python";
  const plannedHeadRefs = asArray(revision.plan?.experimentSelections)
    .map((selection) => selection.baseHeadRef)
    .filter(Boolean);
  run = await store.claimAnalysisRun({
    projectId: project.id,
    analysisRunId: run.id,
    actorUserId,
    expectedHeadRefs: plannedHeadRefs,
    staleValidation: {},
    staleAuditEvents: [],
    startedAt,
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
  let inputs;
  let pythonProgram;
  let runPackage;
  let activeContext;
  let executorResult;
  let checked;
  const programAttempts = [];
  try {
    const workbookInputs = await materializeAnalysisInputs({
      store,
      projectId: project.id,
      sourceSelections: revision.plan?.sourceSelections,
    });
    const experimentInputs = await materializeExperimentInputs({
      store,
      projectId: project.id,
      experimentSelections: revision.plan?.experimentSelections,
    });
    activeContext = outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
      ? await loadActiveExperimentContext({ store, projectId: project.id })
      : null;
    inputs = {
      ...workbookInputs,
      schemaVersion: "labrat.analysisInputs.v5",
      experiments: experimentInputs.experiments,
    };
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
        phase: "materializing_inputs",
        inputManifest: inputs ? inputManifest(inputs) : null,
        programAttempts,
      },
      ipAddress,
      userAgent,
    });
  }

  const thread = await store.findAnalysisThreadById(run.analysisThreadId);
  let repairContext = null;
  const maxProgramAttempts = resolvedExecutionStrategy === "direct_source_mapping"
    ? 1
    : PROGRAM_EXECUTION_REPAIR_LIMIT + 1;
  for (let programAttempt = 1; programAttempt <= maxProgramAttempts; programAttempt += 1) {
    try {
      pythonProgram = await draftPythonProgram({
        modelProvider,
        thread,
        revision,
        inputs,
        initialRepairContext: repairContext,
        executionStrategy: resolvedExecutionStrategy,
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
          inputManifest: inputManifest(inputs),
          executionStrategy: resolvedExecutionStrategy,
          pythonProgram: pythonProgram || null,
          programAttempts,
        },
        ipAddress,
        userAgent,
      });
    }

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
      const executionError = executorResult?.error || {
        code: "analysis_executor_failed",
        message: "Analysis execution failed.",
      };
      programAttempts.push({
        attempt: programAttempt,
        programHash: runPackage.programHash,
        outcome: "execution_failed",
        errors: diagnostics(executionError),
      });
      const repairable = [
        "analysis_python_runner_failed",
        "analysis_executor_output_invalid",
        "analysis_executor_failed",
      ].includes(executionError.code);
      if (repairable && programAttempt < maxProgramAttempts) {
        repairContext = {
          attempt: programAttempt,
          instruction: "Return a complete replacement Python program that preserves the accepted plan and corrects every execution error.",
          previousProgram: {
            runtime: pythonProgram.runtime,
            entrypoint: pythonProgram.entrypoint,
            source: pythonProgram.source,
          },
          errors: diagnostics(executionError),
        };
        continue;
      }
      return finalizeFailedRun({
        store,
        project,
        actorUserId,
        run,
        revision,
        status: "failed",
        error: executionError,
        payload: {
          phase: "executing_python",
          inputManifest: inputManifest(inputs),
          inputHash: runPackage.inputHash,
          programHash: runPackage.programHash,
          pythonProgram,
          programAttempts,
          adapter: executorResult?.adapter || "unknown",
          runtime: executorResult?.runtime || {},
        },
        ipAddress,
        userAgent,
      });
    }

    checked = outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
      ? validateExperimentBrowserResult({
        projectId: project.id,
        run,
        plan: revision,
        executorResult,
        inputs,
        activeContext,
      })
      : validateAnalysisResult({
        run,
        plan: revision,
        executorResult,
      });
    if (checked.ok) {
      programAttempts.push({
        attempt: programAttempt,
        programHash: runPackage.programHash,
        outcome: "result_ready",
        errors: [],
      });
      break;
    }

    programAttempts.push({
      attempt: programAttempt,
      programHash: runPackage.programHash,
      outcome: "validation_failed",
      errors: checked.errors.slice(0, 20),
    });
    if (programAttempt < maxProgramAttempts) {
      const repairErrors = outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
        ? groupedProgramRepairDiagnostics(checked.errors)
        : checked.errors.slice(0, 20);
      repairContext = {
        attempt: programAttempt,
        instruction: "Return a complete replacement Python program that preserves the accepted plan and corrects every output-contract validation error.",
        previousProgram: {
          runtime: pythonProgram.runtime,
          entrypoint: pythonProgram.entrypoint,
          source: pythonProgram.source,
        },
        errors: repairErrors,
      };
      continue;
    }
    return finalizeFailedRun({
      store,
      project,
      actorUserId,
      run,
      revision,
      status: "validation_failed",
      error: {
        code: outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
          ? "experiment_browser_result_validation_failed"
          : "analysis_plotly_validation_failed",
        message: outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
          ? "Python returned Experiment Browser patches that did not pass backend validation."
          : "Python returned a chart that did not pass backend Plotly validation.",
        details: {
          errors: outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
            ? groupedProgramRepairDiagnostics(checked.errors)
            : checked.errors,
          totalErrorCount: checked.errors.length,
        },
      },
      payload: {
        phase: outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
          ? "validating_experiment_records"
          : "validating_plotly",
        inputManifest: inputManifest(inputs),
        inputHash: runPackage.inputHash,
        programHash: runPackage.programHash,
        pythonProgram,
        programAttempts,
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
    schemaVersion: "labrat.analysisResult.v3",
    status: "awaiting_review",
    outputTarget,
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
      executionStrategy: resolvedExecutionStrategy,
      inputHash: runPackage.inputHash,
      programHash: runPackage.programHash,
      pythonProgram,
      programAttempts,
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
      summary: outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER
        ? "Generated Python from accepted inputs and created a reviewable Experiment Browser result."
        : "Generated Python from accepted source tables and created a reviewable Plotly result.",
      metadata: {
        analysisThreadId: run.analysisThreadId,
        analysisRunId: run.id,
        acceptedPlanRevisionId: revision.id,
        outputTarget,
        traceCount: checked.validation.traceCount || 0,
        pointCount: checked.validation.pointCount || 0,
        experimentCount: checked.validation.recordCount || 0,
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
  limit = 200,
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
  const outputTarget = detail.analysisResult.outputTarget
    || detail.analysisRun.outputTarget
    || detail.analysisPlanRevision?.outputTarget
    || ANALYSIS_OUTPUT_TARGETS.CHART;
  if (outputTarget === ANALYSIS_OUTPUT_TARGETS.EXPERIMENT_BROWSER) {
    const projection = detail.analysisResult.result?.projection || {
      columns: [],
      rows: [],
      totalCount: 0,
    };
    const boundedOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 1_000);
    const rows = asArray(projection.rows).slice(boundedOffset, boundedOffset + boundedLimit);
    return {
      schemaVersion: "labrat.experimentBrowserResultPreview.v2",
      outputTarget,
      projectId: detail.analysisRun.projectId,
      analysisThreadId: detail.analysisRun.analysisThreadId,
      analysisRunId: detail.analysisRun.id,
      analysisResultId: detail.analysisResult.id,
      columns: projection.columns || [],
      rows,
      totalCount: Number(projection.totalCount) || asArray(projection.rows).length,
      rowChanges: asArray(detail.analysisResult.result?.rowChanges)
        .slice(boundedOffset, boundedOffset + boundedLimit),
      identityCandidates: detail.analysisResult.result?.identityCandidates || [],
      changeSummary: detail.analysisResult.result?.summary || {},
      exclusions: detail.analysisResult.result?.exclusions || [],
      browserView: detail.analysisResult.result?.browserView || null,
      validation: detail.analysisResult.validation || {},
      warnings: detail.analysisResult.warnings || [],
      sourceRefs: detail.analysisResult.sourceRefs || [],
      page: {
        offset: boundedOffset,
        limit: boundedLimit,
        returnedCount: rows.length,
        totalCount: Number(projection.totalCount) || asArray(projection.rows).length,
      },
    };
  }
  const plotly = detail.analysisResult.result?.plotly || { data: [], layout: {} };
  const traces = asArray(plotly.data);
  return {
    schemaVersion: "labrat.analysisResultPreview.v2",
    outputTarget,
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
