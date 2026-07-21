import { runExperimentRecordDataPlan } from "./dataPlanAgent.js";
import { DATA_SNAPSHOT_SCHEMA_VERSION, stableDataHash } from "./dataPlanSchemas.js";
import { makeId } from "./ids.js";
import { readSourceDocumentRange } from "./sourceDocuments.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizedAlias(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function publishError(code, message, statusCode = 400, details = undefined) {
  return Object.assign(new Error(message), { code, statusCode, ...(details ? { details } : {}) });
}

function canonicalIdentityDecisions(identityDecisions) {
  return asArray(identityDecisions).map((decision) => ({
    sourceAlias: text(decision?.sourceAlias),
    action: text(decision?.action),
    experimentIdentityId: text(decision?.experimentIdentityId) || null,
  })).sort((a, b) => (
    normalizedAlias(a.sourceAlias).localeCompare(normalizedAlias(b.sourceAlias))
    || a.action.localeCompare(b.action)
    || text(a.experimentIdentityId).localeCompare(text(b.experimentIdentityId))
  ));
}

function regionRevisionIdsFromPlan(dataPlan) {
  return [...new Set(asArray(dataPlan?.sourceEvidence)
    .map((evidence) => text(evidence?.regionUnderstandingRevisionId))
    .filter(Boolean))]
    .sort();
}

export async function loadExperimentDataPlanReview({
  store,
  project,
  regionUnderstandingRevisionIds = [],
  identityDecisions = [],
} = {}) {
  const requestedIds = [...new Set(asArray(regionUnderstandingRevisionIds).map(text).filter(Boolean))].sort();
  const projectRegionUnderstandings = store.listAcceptedRegionUnderstandings
    ? await store.listAcceptedRegionUnderstandings({ projectId: project.id })
    : [];
  const acceptedByRevisionId = new Map(projectRegionUnderstandings.map((accepted) => [accepted.revision.id, accepted]));
  const missingRevisionIds = requestedIds.filter((id) => !acceptedByRevisionId.has(id));
  if (!requestedIds.length || missingRevisionIds.length) {
    return {
      resultKind: "clarification",
      clarification: {
        code: "accepted_region_understanding_not_found",
        message: "One or more active accepted region understanding revisions were not found in this project.",
        regionUnderstandingRevisionIds: missingRevisionIds.length ? missingRevisionIds : requestedIds,
      },
    };
  }
  const acceptedRegionUnderstandings = requestedIds.map((id) => acceptedByRevisionId.get(id));
  const sourceDocumentIds = [...new Set(acceptedRegionUnderstandings
    .map(({ region, revision }) => text(region?.sourceDocumentId || revision?.sourceDocumentId))
    .filter(Boolean))];
  const sourceDocuments = (await Promise.all(sourceDocumentIds.map((id) => store.findSourceDocumentById?.(id))))
    .filter((document) => document?.projectId === project.id);
  const sourceIndexBlobsByDocumentId = Object.fromEntries(await Promise.all(sourceDocuments.map(async (sourceDocument) => [
    sourceDocument.id,
    store.listSourceIndexBlobs
      ? await store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
      : [],
  ])));
  const sourceDocumentById = new Map(sourceDocuments.map((sourceDocument) => [sourceDocument.id, sourceDocument]));
  const existingExperimentIdentities = store.listExperimentIdentities
    ? await store.listExperimentIdentities({ projectId: project.id })
    : [];
  return runExperimentRecordDataPlan({
    acceptedRegionUnderstandings,
    sourceDocuments,
    sourceIndexBlobsByDocumentId,
    identityDecisions,
    existingExperimentIdentities: existingExperimentIdentities.map((identity) => ({
      id: identity.id,
      label: identity.canonicalLabel,
      aliases: identity.aliases,
    })),
    readRangePreview: (request) => {
      const sourceDocument = sourceDocumentById.get(request.sourceDocumentId);
      if (!sourceDocument) return null;
      return readSourceDocumentRange({
        sourceDocument,
        indexBlobs: sourceIndexBlobsByDocumentId[sourceDocument.id] || [],
        sheetName: request.sheetName,
        range: request.range,
        maxCells: 500,
      });
    },
  });
}

function acceptedIdentityRecords({ review, project, actorUserId, now }) {
  const existingById = new Map(asArray(review.existingExperimentIdentities).map((identity) => [identity.id, identity]));
  const identities = [];
  const identityByAlias = new Map();
  asArray(review.dataPlan.identityBindings).forEach((binding) => {
    const aliasKey = normalizedAlias(binding.sourceAlias);
    if (binding.action === "reuse") {
      const existing = existingById.get(binding.experimentIdentityId);
      if (!existing) {
        throw publishError(
          "identity_reuse_not_found",
          `Experiment identity ${binding.experimentIdentityId || "unknown"} is not available in this project.`,
          422,
        );
      }
      const aliases = [...new Set([...asArray(existing.aliases), text(binding.sourceAlias)].filter(Boolean))];
      const updated = { ...existing, aliases, updatedAt: now, updatedBy: actorUserId };
      identities.push(updated);
      identityByAlias.set(aliasKey, updated);
      return;
    }
    const identity = {
      id: makeId("experiment_identity"),
      labId: project.labId,
      projectId: project.id,
      canonicalLabel: text(binding.sourceAlias),
      normalizedLabel: aliasKey,
      aliases: [text(binding.sourceAlias)],
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    };
    identities.push(identity);
    identityByAlias.set(aliasKey, identity);
  });
  return { identities, identityByAlias };
}

function publicPlanSummary(plan) {
  return {
    id: plan.id,
    schemaVersion: plan.schemaVersion,
    status: plan.status,
    task: plan.task,
    outputShape: plan.outputShape,
    dependencyHash: plan.dependencyHash,
    acceptedAt: plan.acceptedAt,
    acceptedBy: plan.acceptedBy,
  };
}

function publicSnapshotSummary(snapshot) {
  return {
    id: snapshot.id,
    dataPlanId: snapshot.dataPlanId,
    schemaVersion: snapshot.schemaVersion,
    status: snapshot.status,
    outputShape: snapshot.outputShape,
    contentHash: snapshot.contentHash,
    dependencyHash: snapshot.dependencyHash,
    experimentRecordCount: snapshot.experimentRecords.length,
    includedRowCount: snapshot.summary.includedRowCount,
    skippedRowCount: snapshot.summary.skippedRowCount,
    warningCount: snapshot.warnings.length,
    acceptedAt: snapshot.acceptedAt,
    acceptedBy: snapshot.acceptedBy,
  };
}

export async function publishExperimentBrowserData({
  store,
  project,
  actorUserId,
  dataPlan,
  identityDecisions = [],
  expectedPreviewHash,
  expectedDependencyHash,
  idempotencyKey,
  ipAddress = null,
  userAgent = null,
} = {}) {
  const normalizedKey = text(idempotencyKey);
  if (!normalizedKey || normalizedKey.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(normalizedKey)) {
    throw publishError("idempotency_key_required", "A valid idempotencyKey is required for publish.");
  }
  const regionUnderstandingRevisionIds = regionRevisionIdsFromPlan(dataPlan);
  if (!regionUnderstandingRevisionIds.length) {
    throw publishError(
      "accepted_region_understanding_required",
      "The reviewed DataPlan must reference accepted region understanding revisions.",
      422,
    );
  }
  const canonicalDecisions = canonicalIdentityDecisions(identityDecisions);
  const requestHash = stableDataHash({
    projectId: project.id,
    regionUnderstandingRevisionIds,
    identityDecisions: canonicalDecisions,
    expectedPreviewHash: text(expectedPreviewHash),
    expectedDependencyHash: text(expectedDependencyHash),
  });
  const prior = await store.findExperimentSnapshotPublish?.({
    projectId: project.id,
    idempotencyKey: normalizedKey,
  });
  if (prior) {
    if (prior.requestHash !== requestHash) {
      throw publishError(
        "idempotency_key_conflict",
        "This idempotency key was already used for a different publish request.",
        409,
      );
    }
    return { ...prior.response, idempotentReplay: true };
  }

  const existingExperimentIdentities = store.listExperimentIdentities
    ? await store.listExperimentIdentities({ projectId: project.id })
    : [];
  const currentReview = await loadExperimentDataPlanReview({
    store,
    project,
    regionUnderstandingRevisionIds,
    identityDecisions: canonicalDecisions,
  });
  if (currentReview.resultKind !== "data_plan_review") {
    throw publishError(
      currentReview.clarification?.code || "data_plan_publish_invalid",
      currentReview.clarification?.message || "The reviewed DataPlan could not be reconstructed.",
      422,
      { currentReview },
    );
  }
  currentReview.existingExperimentIdentities = existingExperimentIdentities;
  if (asArray(currentReview.reviewSummary?.blockers).length) {
    throw publishError(
      "data_plan_publish_blocked",
      "Resolve all experiment identity and evidence blockers before publishing.",
      422,
      { blockers: currentReview.reviewSummary.blockers, currentReview },
    );
  }
  if (
    text(expectedPreviewHash) !== currentReview.snapshotPreview.previewHash
    || text(expectedDependencyHash) !== currentReview.dataPlan.dependencyHash
  ) {
    throw publishError(
      "preview_stale",
      "The reviewed preview no longer matches current accepted source evidence.",
      409,
      {
        expectedPreviewHash: text(expectedPreviewHash),
        currentPreviewHash: currentReview.snapshotPreview.previewHash,
        expectedDependencyHash: text(expectedDependencyHash),
        currentDependencyHash: currentReview.dataPlan.dependencyHash,
        currentReview,
      },
    );
  }

  const now = new Date().toISOString();
  const { identities, identityByAlias } = acceptedIdentityRecords({
    review: currentReview,
    project,
    actorUserId,
    now,
  });
  const experimentRecords = currentReview.snapshotPreview.experimentRecords.map((record) => {
    const identity = identityByAlias.get(normalizedAlias(record.label));
    if (!identity) {
      throw publishError("experiment_identity_required", `No accepted identity exists for ${record.label || "an experiment record"}.`, 422);
    }
    return {
      ...record,
      experimentId: identity.id,
      identityCandidateKey: null,
    };
  });
  const persistedPlanId = makeId("data_plan");
  const acceptedPlanPayload = {
    ...currentReview.dataPlan,
    id: persistedPlanId,
    status: "accepted",
  };
  const acceptedPlan = {
    id: persistedPlanId,
    labId: project.labId,
    projectId: project.id,
    schemaVersion: acceptedPlanPayload.schemaVersion,
    status: "accepted",
    task: acceptedPlanPayload.task,
    outputShape: acceptedPlanPayload.outputShape,
    plan: acceptedPlanPayload,
    sourceEvidence: acceptedPlanPayload.sourceEvidence,
    operations: acceptedPlanPayload.operations,
    identityBindings: acceptedPlanPayload.identityBindings,
    dependencyHash: acceptedPlanPayload.dependencyHash,
    validation: {
      previewHash: currentReview.snapshotPreview.previewHash,
      blockerCount: 0,
    },
    warnings: asArray(currentReview.reviewSummary?.warnings),
    acceptedAt: now,
    acceptedBy: actorUserId,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  };
  const persistedSnapshotId = makeId("data_snapshot");
  const acceptedSnapshotContent = {
    schemaVersion: DATA_SNAPSHOT_SCHEMA_VERSION,
    status: "accepted",
    outputShape: "experiment_records",
    dataPlanId: persistedPlanId,
    dependencyHash: acceptedPlan.dependencyHash,
    experimentRecords,
    includedRowCount: currentReview.snapshotPreview.includedRowCount,
    skippedRows: currentReview.snapshotPreview.skippedRows,
    warnings: currentReview.snapshotPreview.warnings,
  };
  const contentHash = stableDataHash(acceptedSnapshotContent);
  const acceptedSnapshotPayload = {
    ...acceptedSnapshotContent,
    id: persistedSnapshotId,
    contentHash,
  };
  const acceptedSnapshot = {
    id: persistedSnapshotId,
    labId: project.labId,
    projectId: project.id,
    dataPlanId: persistedPlanId,
    schemaVersion: DATA_SNAPSHOT_SCHEMA_VERSION,
    status: "accepted",
    outputShape: "experiment_records",
    contentHash,
    dependencyHash: acceptedPlan.dependencyHash,
    snapshot: acceptedSnapshotPayload,
    experimentRecords,
    sourceRefs: acceptedPlan.sourceEvidence.map((evidence) => ({
      sourceType: "excel_range",
      sourceDocumentId: evidence.sourceDocumentId,
      sheet: evidence.sheetName,
      range: evidence.range,
    })),
    summary: {
      experimentRecordCount: experimentRecords.length,
      includedRowCount: currentReview.snapshotPreview.includedRowCount,
      skippedRowCount: currentReview.snapshotPreview.skippedRows.length,
    },
    warnings: currentReview.snapshotPreview.warnings,
    acceptedAt: now,
    acceptedBy: actorUserId,
    createdAt: now,
    createdBy: actorUserId,
  };
  const priorHeads = store.listExperimentSnapshotHeads
    ? await store.listExperimentSnapshotHeads({ projectId: project.id })
    : [];
  const priorHeadByExperiment = new Map(priorHeads.map((head) => [head.experimentId, head]));
  const experimentSnapshotHeads = experimentRecords.map((record, recordIndex) => {
    const priorHead = priorHeadByExperiment.get(record.experimentId);
    return {
      id: priorHead?.id || makeId("experiment_snapshot_head"),
      labId: project.labId,
      projectId: project.id,
      experimentId: record.experimentId,
      dataSnapshotId: acceptedSnapshot.id,
      recordIndex,
      updatedAt: now,
      updatedBy: actorUserId,
    };
  });
  const response = {
    projectId: project.id,
    dataPlan: publicPlanSummary(acceptedPlan),
    dataSnapshot: publicSnapshotSummary(acceptedSnapshot),
    experimentIdentities: identities,
    experimentSnapshotHeads,
    experimentProjectionSummary: {
      publishedExperimentCount: experimentRecords.length,
      experimentIds: experimentRecords.map((record) => record.experimentId),
    },
  };
  return store.publishExperimentSnapshot({
    labId: project.labId,
    projectId: project.id,
    actorUserId,
    idempotencyKey: normalizedKey,
    requestHash,
    dataPlan: acceptedPlan,
    dataSnapshot: acceptedSnapshot,
    experimentIdentities: identities,
    experimentSnapshotHeads,
    auditEvents: [{
      labId: project.labId,
      projectId: project.id,
      actorUserId,
      action: "data_snapshot.publish",
      targetType: "data_snapshot",
      targetId: acceptedSnapshot.id,
      summary: `Published ${experimentRecords.length} experiment record${experimentRecords.length === 1 ? "" : "s"} to Experiment Browser.`,
      metadata: {
        dataPlanId: acceptedPlan.id,
        dataSnapshotId: acceptedSnapshot.id,
        experimentIds: experimentRecords.map((record) => record.experimentId),
        idempotencyKey: normalizedKey,
      },
      ipAddress,
      userAgent,
    }],
    response,
  });
}
