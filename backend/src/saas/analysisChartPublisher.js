import { validateChartSpecProposal } from "./chartSpecValidation.js";
import { resolveAnalysisSourceSelections } from "./analysisSourceSelections.js";
import { resolveExperimentSelections } from "./experimentBrowserAnalysis.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { makeId } from "./ids.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function publicationError(code, message, statusCode = 400, details = undefined) {
  return Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details === undefined ? {} : { details }),
  });
}

function traceId(trace, index) {
  return text(trace?.traceId || trace?.meta?.labrat?.traceId || `trace_${index + 1}`);
}

function traceCatalog(plotly) {
  return asArray(plotly?.data).map((trace, index) => ({
    traceId: traceId(trace, index),
    name: text(trace?.name) || `Series ${index + 1}`,
    type: text(trace?.type) || "scatter",
    pointCount: Math.max(asArray(trace?.x).length, asArray(trace?.y).length),
  }));
}

function normalizeVisibleTraceIds(catalog, requested) {
  const requestedIds = [...new Set(asArray(requested).map(text).filter(Boolean))];
  const available = new Set(catalog.map((trace) => trace.traceId));
  const unknownTraceIds = requestedIds.filter((id) => !available.has(id));
  if (unknownTraceIds.length) {
    throw publicationError(
      "analysis_chart_trace_unknown",
      "The reviewed chart view references traces outside the validated result.",
      422,
      { unknownTraceIds },
    );
  }
  if (!requestedIds.length) {
    throw publicationError(
      "analysis_chart_trace_required",
      "Select at least one chart series before accepting the chart.",
      422,
    );
  }
  return catalog.map((trace) => trace.traceId).filter((id) => requestedIds.includes(id));
}

export function buildAnalysisResultChartSpec({
  thread,
  planRevision,
  run,
  result,
  defaultVisibleTraceIds,
  actorUserId,
  createdAt,
} = {}) {
  const plotly = structuredClone(result?.result?.plotly || { data: [], layout: {} });
  const catalog = traceCatalog(plotly);
  if (!catalog.length) {
    throw publicationError(
      "analysis_chart_traces_required",
      "The validated result contains no chart traces to publish.",
      422,
    );
  }
  const visibleTraceIds = normalizeVisibleTraceIds(catalog, defaultVisibleTraceIds);
  const reviewPlan = planRevision.plan?.reviewPlan || {};
  return {
    schemaVersion: "labrat.chartSpec.v3",
    origin: "analysis_result",
    status: "accepted",
    chartType: reviewPlan.chart?.chartType || "scatter",
    title: reviewPlan.chart?.title || planRevision.requestSummary || "Analysis result",
    analysisThreadId: thread.id,
    analysisPlanRevisionId: planRevision.id,
    analysisRunId: run.id,
    analysisResultId: result.id,
    sourceSelections: structuredClone(planRevision.plan?.sourceSelections || []),
    experimentSelections: structuredClone(planRevision.plan?.experimentSelections || []),
    sourceRefs: structuredClone(result.sourceRefs || []),
    plotly,
    traceCatalog: catalog,
    defaultChartView: { visibleTraceIds },
    warnings: structuredClone(asArray(result.warnings)),
    createdAt,
    createdBy: actorUserId,
  };
}

async function resultForRun(store, run) {
  const results = await store.listAnalysisResults({
    projectId: run.projectId,
    analysisThreadId: run.analysisThreadId,
  });
  return results.find((result) => result.analysisRunId === run.id) || null;
}

async function hydratePublication(store, receipt, idempotentReplay) {
  const [
    analysisThread,
    analysisPlanRevision,
    analysisRun,
    analysisResult,
    chartSpec,
  ] = await Promise.all([
    store.findAnalysisThreadById(receipt.analysisThreadId),
    store.findAnalysisPlanRevisionById(receipt.analysisPlanRevisionId),
    store.findAnalysisRunById(receipt.analysisRunId),
    store.findAnalysisResultById(receipt.analysisResultId),
    store.findChartSpecById(receipt.chartSpecId),
  ]);
  return {
    analysisThread,
    analysisPlanRevision,
    analysisRun,
    analysisResult,
    chartSpec,
    idempotentReplay,
  };
}

export async function publishAcceptedAnalysisChart({
  store,
  project,
  actorUserId,
  runId,
  analysisResultId,
  defaultVisibleTraceIds = [],
  idempotencyKey,
  ipAddress = null,
  userAgent = null,
} = {}) {
  const key = text(idempotencyKey);
  if (!key) {
    throw publicationError(
      "idempotency_key_required",
      "Analysis result publication requires an idempotency key.",
    );
  }
  const run = await store.findAnalysisRunById(runId);
  if (!run || run.projectId !== project?.id) {
    throw publicationError("analysis_run_not_found", "Analysis run was not found.", 404);
  }
  const [thread, planRevision, result] = await Promise.all([
    store.findAnalysisThreadById(run.analysisThreadId),
    store.findAnalysisPlanRevisionById(run.acceptedPlanRevisionId),
    resultForRun(store, run),
  ]);
  if (!thread || !planRevision || !result) {
    throw publicationError(
      "analysis_result_not_found",
      "The analysis run has no validated result to publish.",
      404,
    );
  }
  if (analysisResultId && text(analysisResultId) !== result.id) {
    throw publicationError(
      "analysis_result_mismatch",
      "The accepted result does not match this analysis run.",
      409,
    );
  }
  const catalog = traceCatalog(result.result?.plotly);
  const visibleTraceIds = normalizeVisibleTraceIds(catalog, defaultVisibleTraceIds);
  const requestHash = stableDataHash({
    operation: "publish_analysis_chart_v3",
    projectId: project.id,
    runId: run.id,
    analysisResultId: result.id,
    defaultVisibleTraceIds: visibleTraceIds,
  });
  const prior = await store.findAnalysisPublication({
    projectId: project.id,
    idempotencyKey: key,
  });
  if (prior) {
    if (prior.requestHash !== requestHash) {
      throw publicationError(
        "idempotency_key_conflict",
        "This idempotency key was already used for another analysis publication.",
        409,
      );
    }
    return hydratePublication(store, prior.response, true);
  }
  if (
    thread.status !== "awaiting_result_review"
    || planRevision.status !== "accepted"
    || run.status !== "awaiting_result_review"
    || result.status !== "awaiting_review"
    || result.validation?.ok !== true
    || asArray(result.validation?.errors).length
  ) {
    throw publicationError(
      "analysis_result_state_conflict",
      "Only the current validated awaiting-review result can be published.",
      409,
    );
  }
  const sourceSelections = asArray(planRevision.plan?.sourceSelections);
  const experimentSelections = asArray(planRevision.plan?.experimentSelections);
  if (sourceSelections.length) {
    await resolveAnalysisSourceSelections({
      store,
      projectId: project.id,
      sourceSelections,
    });
  }
  if (experimentSelections.length) {
    await resolveExperimentSelections({
      store,
      projectId: project.id,
      experimentSelections,
    });
  }
  const expectedHeadRefs = experimentSelections
    .map((selection) => selection.baseHeadRef)
    .filter(Boolean);
  const createdAt = new Date().toISOString();
  const spec = buildAnalysisResultChartSpec({
    thread,
    planRevision,
    run,
    result,
    defaultVisibleTraceIds: visibleTraceIds,
    actorUserId,
    createdAt,
  });
  validateChartSpecProposal({ proposal: spec });
  const acceptedResult = {
    ...structuredClone(result),
    status: "accepted",
    acceptedAt: createdAt,
    acceptedBy: actorUserId,
    updatedAt: createdAt,
    updatedBy: actorUserId,
  };
  const completedRun = {
    ...structuredClone(run),
    status: "completed",
    updatedAt: createdAt,
    updatedBy: actorUserId,
  };
  const chartSpec = {
    id: makeId("chart_spec"),
    labId: project.labId,
    projectId: project.id,
    analysisResultId: result.id,
    title: spec.title,
    chartType: spec.chartType,
    spec,
    layout: {},
    warnings: spec.warnings,
    createdAt,
    updatedAt: createdAt,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  };
  const response = {
    analysisThreadId: thread.id,
    analysisPlanRevisionId: planRevision.id,
    analysisRunId: run.id,
    analysisResultId: result.id,
    chartSpecId: chartSpec.id,
  };
  const stored = await store.publishAnalysisResult({
    publicationId: makeId("analysis_publication"),
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: thread.id,
    actorUserId,
    idempotencyKey: key,
    requestHash,
    analysisPlanRevision: planRevision,
    analysisRun: completedRun,
    analysisResult: acceptedResult,
    chartSpec,
    expectedHeadRefs,
    response,
    auditEvents: [{
      labId: project.labId,
      projectId: project.id,
      actorUserId,
      action: "analysis_result.publish_chart",
      targetType: "chart_spec",
      targetId: chartSpec.id,
      summary: "Accepted one validated Plotly result and created its ChartSpec.",
      metadata: {
        analysisThreadId: thread.id,
        analysisPlanRevisionId: planRevision.id,
        analysisRunId: run.id,
        analysisResultId: result.id,
        defaultVisibleTraceIds: visibleTraceIds,
      },
      createdAt,
      ipAddress,
      userAgent,
    }],
  });
  return hydratePublication(store, stored, Boolean(stored.idempotentReplay));
}
