import { validateChartSpecProposal } from "./chartSpecValidation.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { makeId } from "./ids.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").trim();
}

function publicationError(code, message, statusCode = 400, details = undefined) {
  return Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });
}

function uniqueTexts(values) {
  return [...new Set(asArray(values).map(text).filter(Boolean))];
}

function sourceRecordIdsForTrace(result, trace) {
  return uniqueTexts([
    ...asArray(trace?.sourceRecordIds),
    ...asArray(result?.result?.lineage?.[trace?.traceId]?.sourceRecordIds),
  ]);
}

function normalizeVisibleTraceIds(traces, requested) {
  const requestedIds = uniqueTexts(requested);
  const traceIds = new Set(traces.map((trace) => text(trace?.traceId)).filter(Boolean));
  const unknownTraceIds = requestedIds.filter((traceId) => !traceIds.has(traceId));
  if (unknownTraceIds.length) {
    throw publicationError(
      "analysis_chart_trace_unknown",
      "The reviewed chart view references traces outside the validated result.",
      422,
      { unknownTraceIds },
    );
  }
  const selected = new Set(requestedIds);
  return traces.map((trace) => text(trace.traceId)).filter((traceId) => selected.has(traceId));
}

async function inputSnapshotRefs(store, selection) {
  const records = asArray(selection?.records);
  const snapshotIds = [...new Set(records.map((record) => text(record.snapshotId)).filter(Boolean))];
  const snapshots = await Promise.all(snapshotIds.map((snapshotId) => (
    store.findDataSnapshotById(snapshotId)
  )));
  const byId = new Map(snapshots.filter(Boolean).map((snapshot) => [snapshot.id, snapshot]));
  return records.map((record, index) => {
    const snapshot = byId.get(record.snapshotId);
    if (
      !snapshot
      || snapshot.status !== "accepted"
      || snapshot.projectId !== selection.projectId
    ) {
      throw publicationError(
        "analysis_result_stale",
        "An accepted input snapshot is no longer available for chart publication.",
        409,
        { recordIndex: index, snapshotId: record.snapshotId || null },
      );
    }
    return {
      experimentId: record.experimentId,
      experimentLabel: record.experimentLabel || record.experimentId,
      headId: record.headId,
      snapshotId: record.snapshotId,
      recordIndex: Number(record.recordIndex),
      sourceRecordId: `${record.snapshotId}:${Number(record.recordIndex)}`,
      contentHash: snapshot.contentHash,
      dependencyHash: snapshot.dependencyHash,
    };
  });
}

function axisFromTraces(traces, axis, field) {
  const fieldKey = text(field);
  const units = uniqueTexts(traces.map((trace) => trace?.[`${axis}Unit`]));
  return {
    field: fieldKey || axis,
    label: fieldKey ? fieldKey.replaceAll("_", " ") : axis.toUpperCase(),
    unit: units.length === 1 ? units[0] : null,
  };
}

function buildTraceCatalog(result) {
  return asArray(result?.result?.traces).map((trace) => ({
    ...structuredClone(trace),
    traceId: text(trace.traceId),
    experimentId: trace.experimentId ? text(trace.experimentId) : null,
    experimentLabel: trace.experimentLabel || trace.name || trace.experimentId || trace.traceId,
    x: asArray(trace.x),
    y: asArray(trace.y),
    xUnit: trace.xUnit ?? null,
    yUnit: trace.yUnit ?? null,
    sourceRecordIds: sourceRecordIdsForTrace(result, trace),
  }));
}

export function buildAnalysisResultChartSpec({
  project,
  thread,
  planRevision,
  run,
  result,
  snapshots,
  defaultVisibleTraceIds,
  actorUserId,
  createdAt,
} = {}) {
  const traceCatalog = buildTraceCatalog(result);
  if (!traceCatalog.length) {
    throw publicationError(
      "analysis_chart_traces_required",
      "The validated result contains no chart traces to publish.",
      422,
    );
  }
  const visibleTraceIds = normalizeVisibleTraceIds(traceCatalog, defaultVisibleTraceIds);
  const expectedOutput = planRevision.expectedOutput || {};
  const base = {
    schemaVersion: "labrat.chartSpec.v2",
    origin: "analysis_result",
    status: "accepted",
    chartType: expectedOutput.chartType || "scatter",
    title: expectedOutput.title || planRevision.requestSummary || "Analysis result",
    analysisThreadId: thread.id,
    analysisPlanRevisionId: planRevision.id,
    analysisRunId: run.id,
    analysisResultId: result.id,
    planHash: planRevision.planHash,
    selectionHash: planRevision.selectionHash,
    dependencyHash: planRevision.dependencyHash,
    inputHash: run.inputHash,
    programHash: run.programHash,
    resultHash: result.contentHash,
    resultPreviewHash: result.resultPreviewHash,
    runtimeVersion: run.runtimeVersion,
    inputSnapshotRefs: snapshots,
    traceCatalog,
    defaultChartView: { visibleTraceIds },
    x: axisFromTraces(traceCatalog, "x", expectedOutput.xField),
    y: axisFromTraces(traceCatalog, "y", asArray(expectedOutput.yFields)[0]),
    yFields: asArray(expectedOutput.yFields).map((field) => axisFromTraces(
      traceCatalog.filter((trace) => !trace.yField || trace.yField === field),
      "y",
      field,
    )),
    sourceRefs: structuredClone(asArray(result.sourceRefs)),
    warnings: structuredClone(asArray(result.warnings)),
    createdAt,
    createdBy: actorUserId,
  };
  return {
    ...base,
    contentHash: stableDataHash(base),
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
  resultHash,
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
  const traces = buildTraceCatalog(result);
  const visibleTraceIds = normalizeVisibleTraceIds(traces, defaultVisibleTraceIds);
  const requestHash = stableDataHash({
    projectId: project.id,
    runId: run.id,
    resultHash: text(resultHash),
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
  if (text(resultHash) !== result.contentHash) {
    throw publicationError(
      "analysis_result_hash_mismatch",
      "The accepted hash does not match the visible analysis result.",
      409,
      { currentResultHash: result.contentHash },
    );
  }
  if (
    thread.status !== "awaiting_result_review"
    || planRevision.status !== "accepted"
    || run.status !== "awaiting_result_review"
    || result.status !== "awaiting_review"
  ) {
    throw publicationError(
      "analysis_result_state_conflict",
      "Only the current awaiting-review analysis result can be published.",
      409,
    );
  }
  if (
    run.inputHash !== planRevision.selectionHash
    || run.programHash !== planRevision.programHash
    || run.runtimeVersion !== planRevision.runtimeVersion
    || run.resultPreviewHash !== result.resultPreviewHash
    || result.validation?.ok !== true
    || asArray(result.validation?.errors).length
  ) {
    throw publicationError(
      "analysis_result_validation_failed",
      "The analysis result no longer matches its accepted plan and validation hashes.",
      409,
    );
  }
  const selection = {
    ...(planRevision.selection || {}),
    projectId: project.id,
  };
  const snapshots = await inputSnapshotRefs(store, selection);
  const createdAt = new Date().toISOString();
  const spec = buildAnalysisResultChartSpec({
    project,
    thread,
    planRevision,
    run,
    result,
    snapshots,
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
    sourceChartProposalSetId: null,
    sourceProposalId: null,
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
    expectedHeadRefs: snapshots.map((snapshot) => ({
      headId: snapshot.headId,
      experimentId: snapshot.experimentId,
      dataSnapshotId: snapshot.snapshotId,
      recordIndex: snapshot.recordIndex,
    })),
    response,
    auditEvents: [{
      labId: project.labId,
      projectId: project.id,
      actorUserId,
      action: "analysis_result.publish_chart",
      targetType: "chart_spec",
      targetId: chartSpec.id,
      summary: "Accepted one validated analysis result and created its ChartSpec.",
      metadata: {
        analysisThreadId: thread.id,
        analysisPlanRevisionId: planRevision.id,
        analysisRunId: run.id,
        analysisResultId: result.id,
        resultHash: result.contentHash,
        chartSpecHash: spec.contentHash,
        defaultVisibleTraceIds: visibleTraceIds,
      },
      createdAt,
      ipAddress,
      userAgent,
    }],
  });
  return hydratePublication(store, stored, Boolean(stored.idempotentReplay));
}
