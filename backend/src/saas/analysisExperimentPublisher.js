import {
  applyExperimentRecordPatches,
  loadActiveExperimentContext,
} from "./experimentBrowserAnalysis.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { makeId } from "./ids.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeAlias(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function publicationError(code, message, statusCode = 400, details = undefined) {
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

export async function publishAcceptedExperimentAnalysis({
  store,
  project,
  actorUserId,
  analysisRunId,
  analysisResultId,
  identityResolutions = [],
  idempotencyKey,
  ipAddress = null,
  userAgent = null,
} = {}) {
  const key = text(idempotencyKey);
  if (!validIdempotencyKey(key)) {
    throw publicationError(
      "idempotency_key_required",
      "A valid Idempotency-Key header is required to publish Experiment Browser data.",
    );
  }
  const run = await store.findAnalysisRunById(analysisRunId);
  if (!run || run.projectId !== project?.id || run.outputTarget !== "experiment_browser") {
    throw publicationError("analysis_run_not_found", "Experiment Browser analysis run was not found.", 404);
  }
  const [thread, revision, result] = await Promise.all([
    store.findAnalysisThreadById(run.analysisThreadId),
    store.findAnalysisPlanRevisionById(run.acceptedPlanRevisionId),
    store.findAnalysisResultById(analysisResultId),
  ]);
  const requestHash = stableDataHash({
    operation: "publish_experiment_analysis_v2",
    projectId: project.id,
    analysisRunId: run.id,
    analysisResultId: result.id,
    identityResolutions: asArray(identityResolutions).map((item) => ({
      candidateId: text(item?.candidateId),
      action: text(item?.action),
      experimentId: text(item?.experimentId) || null,
    })),
  });
  const prior = await store.findExperimentAnalysisPublication?.({
    projectId: project.id,
    idempotencyKey: key,
  });
  if (prior) {
    if (prior.requestHash !== requestHash) {
      throw publicationError(
        "idempotency_key_conflict",
        "This idempotency key was already used for another Experiment Browser publication.",
        409,
      );
    }
    return { ...prior.response, idempotentReplay: true };
  }
  if (
    !thread
    || !revision
    || !result
    || thread.status !== "awaiting_result_review"
    || revision.status !== "accepted"
    || run.status !== "awaiting_result_review"
    || result.status !== "awaiting_review"
    || result.analysisRunId !== run.id
    || result.outputTarget !== "experiment_browser"
    || result.validation?.ok !== true
    || asArray(result.validation?.errors).length
  ) {
    throw publicationError(
      "experiment_analysis_result_not_publishable",
      "Only the current validated Experiment Browser result can be published.",
      409,
    );
  }

  const activeContext = await loadActiveExperimentContext({ store, projectId: project.id });
  const now = new Date().toISOString();
  const applied = applyExperimentRecordPatches({
    projectId: project.id,
    result: result.result,
    activeContext,
    identityResolutions,
    identityFactory: (label) => ({
      id: makeId("experiment_identity"),
      labId: project.labId,
      projectId: project.id,
      canonicalLabel: label,
      normalizedLabel: normalizeAlias(label),
      aliases: [label],
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    }),
  });
  const duplicateNormalized = new Set();
  applied.identities.forEach((identity) => {
    const normalized = normalizeAlias(identity.canonicalLabel);
    if (!normalized || duplicateNormalized.has(normalized) && !activeContext.identityById.has(identity.id)) {
      throw publicationError(
        "experiment_identity_conflict",
        `Experiment identity ${identity.canonicalLabel || identity.id} conflicts with another output.`,
        422,
      );
    }
    duplicateNormalized.add(normalized);
  });

  const dataSnapshotId = makeId("data_snapshot");
  const acceptedContent = {
    schemaVersion: "labrat.dataSnapshot.v4",
    status: "accepted",
    outputShape: "experiment_records",
    analysisPlanRevisionId: revision.id,
    analysisRunId: run.id,
    analysisResultId: result.id,
    experimentRecords: applied.experimentRecords,
    sourceRefs: result.sourceRefs || [],
    summary: {
      ...result.result?.summary,
      publishedExperimentCount: applied.experimentRecords.length,
    },
    warnings: result.warnings || [],
  };
  const contentHash = stableDataHash(acceptedContent);
  const dependencyHash = stableDataHash({
    sourceSelections: revision.plan?.sourceSelections || [],
    experimentSelections: revision.plan?.experimentSelections || [],
    baseHeadRefs: result.result?.baseHeadRefs || [],
    analysisPlanRevisionId: revision.id,
    analysisRunId: run.id,
  });
  const dataSnapshot = {
    id: dataSnapshotId,
    labId: project.labId,
    projectId: project.id,
    dataPlanId: null,
    analysisPlanRevisionId: revision.id,
    analysisRunId: run.id,
    analysisResultId: result.id,
    schemaVersion: acceptedContent.schemaVersion,
    status: "accepted",
    outputShape: acceptedContent.outputShape,
    contentHash,
    dependencyHash,
    snapshot: {
      ...acceptedContent,
      id: dataSnapshotId,
      contentHash,
      dependencyHash,
    },
    experimentRecords: applied.experimentRecords,
    sourceRefs: result.sourceRefs || [],
    summary: acceptedContent.summary,
    warnings: acceptedContent.warnings,
    acceptedAt: now,
    acceptedBy: actorUserId,
    createdAt: now,
    createdBy: actorUserId,
  };
  const priorHeadByExperiment = new Map(activeContext.experimentSnapshotHeads
    .map((head) => [head.experimentId, head]));
  const experimentSnapshotHeads = applied.experimentRecords.map((record, recordIndex) => ({
    id: priorHeadByExperiment.get(record.experimentId)?.id || makeId("experiment_snapshot_head"),
    labId: project.labId,
    projectId: project.id,
    experimentId: record.experimentId,
    dataSnapshotId,
    recordIndex,
    updatedAt: now,
    updatedBy: actorUserId,
  }));
  const browserViewId = makeId("browser_view");
  const requestedView = result.result?.browserView || {};
  const projectedColumnIds = asArray(result.result?.projection?.columns)
    .map((column) => text(column?.id))
    .filter(Boolean);
  const visibleColumnIds = asArray(requestedView.visibleColumnIds).map(text).filter(Boolean);
  const availableColumnIds = projectedColumnIds.length
    ? projectedColumnIds
    : [...new Set([
      ...visibleColumnIds,
      ...asArray(requestedView.columnOrder).map(text).filter(Boolean),
    ])];
  const visibleColumnSet = new Set(visibleColumnIds);
  const requestedOrder = asArray(requestedView.columnOrder).map(text).filter(Boolean);
  const orderedColumnIds = [
    ...requestedOrder,
    ...availableColumnIds,
  ].filter((columnId, index, all) => (
    availableColumnIds.includes(columnId) && all.indexOf(columnId) === index
  ));
  const browserView = {
    id: browserViewId,
    labId: project.labId,
    projectId: project.id,
    ownerUserId: actorUserId,
    schemaVersion: "labrat.browserView.v1",
    name: text(requestedView.name) || "LabRat data update",
    payload: {
      columns: orderedColumnIds.map((columnId, order) => ({
        columnId,
        order,
        hidden: !visibleColumnSet.has(columnId),
        ...(Number.isFinite(Number(requestedView.columnWidths?.[columnId]))
          ? { width: Number(requestedView.columnWidths[columnId]) }
          : {}),
      })),
      filters: asArray(requestedView.filters),
      sort: asArray(requestedView.sort),
      groupBy: null,
      selectedExperimentIds: experimentSnapshotHeads.map((head) => head.experimentId),
    },
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  const acceptedResult = {
    ...result,
    status: "accepted",
    acceptedAt: now,
    acceptedBy: actorUserId,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  const completedRun = {
    ...run,
    status: "completed",
    updatedAt: now,
    updatedBy: actorUserId,
  };
  const response = {
    projectId: project.id,
    analysisThread: {
      ...thread,
      status: "completed",
      acceptedAnalysisResultIds: [
        ...asArray(thread.acceptedAnalysisResultIds).filter((id) => id !== result.id),
        result.id,
      ],
      dataSnapshotIds: [
        ...asArray(thread.dataSnapshotIds).filter((id) => id !== dataSnapshot.id),
        dataSnapshot.id,
      ],
      browserViewIds: [
        ...asArray(thread.browserViewIds).filter((id) => id !== browserView.id),
        browserView.id,
      ],
      updatedAt: now,
      updatedBy: actorUserId,
    },
    analysisPlanRevision: revision,
    analysisRun: completedRun,
    analysisResult: acceptedResult,
    dataSnapshot,
    browserView,
    experimentIdentities: applied.identities,
    experimentSnapshotHeads,
    changeSummary: result.result?.summary || {},
  };
  return store.publishExperimentAnalysis({
    labId: project.labId,
    projectId: project.id,
    actorUserId,
    idempotencyKey: key,
    requestHash,
    publicationId: makeId("analysis_experiment_publication"),
    analysisThread: response.analysisThread,
    analysisPlanRevision: revision,
    analysisRun: completedRun,
    analysisResult: acceptedResult,
    expectedHeadRefs: result.result?.baseHeadRefs || [],
    dataSnapshot,
    browserView,
    experimentIdentities: applied.identities,
    experimentSnapshotHeads,
    response,
    auditEvents: [{
      labId: project.labId,
      projectId: project.id,
      actorUserId,
      action: "analysis_result.publish_experiments",
      targetType: "data_snapshot",
      targetId: dataSnapshot.id,
      summary: `Published ${applied.experimentRecords.length} reviewed experiment record${applied.experimentRecords.length === 1 ? "" : "s"} to Experiment Browser.`,
      metadata: {
        analysisThreadId: thread.id,
        analysisRunId: run.id,
        analysisResultId: result.id,
        browserViewId: browserView.id,
        experimentIds: experimentSnapshotHeads.map((head) => head.experimentId),
      },
      createdAt: now,
      ipAddress,
      userAgent,
    }],
  });
}
