import { hashPassword } from "./passwords.js";
import { makeId } from "./ids.js";

function nowIso() {
  return new Date().toISOString();
}

function jsonb(value, fallback = {}) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function nullableJsonb(value) {
  return value == null ? null : JSON.stringify(value);
}

function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    isActive: row.is_active,
    isSuperAdmin: row.is_super_admin,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function labFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    settings: row.settings || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function membershipFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function projectFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    name: row.name,
    description: row.description,
    status: row.status,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function fileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    extension: row.extension,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function importRunFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    fileObjectId: row.file_object_id,
    status: row.status,
    scanResult: row.scan_result,
    normalizePreview: row.normalize_preview,
    reviewDecisions: row.review_decisions || {},
    warnings: row.warnings || [],
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function sourceDocumentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    fileObjectId: row.file_object_id,
    importRunId: row.import_run_id,
    documentType: row.document_type,
    indexVersion: row.index_version,
    status: row.status,
    metadata: row.metadata || {},
    summary: row.summary || {},
    warnings: row.warnings || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function sourceRegionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    sourceDocumentId: row.source_document_id,
    importRunId: row.import_run_id,
    regionKey: row.region_key,
    kind: row.kind,
    label: row.label,
    sheetName: row.sheet_name,
    rangeRef: row.range_ref,
    startRow: row.start_row,
    endRow: row.end_row,
    startCol: row.start_col,
    endCol: row.end_col,
    confidence: row.confidence == null ? null : Number(row.confidence),
    signals: row.signals || {},
    candidateFields: row.candidate_fields || [],
    sourceRefs: row.source_refs || [],
    warnings: row.warnings || [],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function sourceIndexBlobFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    sourceDocumentId: row.source_document_id,
    blobKind: row.blob_kind,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    payload: row.payload || {},
    checksumSha256: row.checksum_sha256,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function workbookReviewSessionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    sourceDocumentId: row.source_document_id,
    schemaVersion: row.schema_version || "labrat.workbookReviewSession.v1",
    status: row.status,
    version: row.version || 1,
    workbookSummary: row.workbook_summary || {},
    messages: row.messages || [],
    warnings: row.warnings || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function workbookReviewRegionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    workbookReviewSessionId: row.workbook_review_session_id,
    sourceDocumentId: row.source_document_id,
    sourceRegionId: row.source_region_id,
    sheetName: row.sheet_name,
    rangeRef: row.range_ref,
    selectionMethod: row.selection_method,
    interpretationHint: row.interpretation_hint || {},
    disposition: row.disposition,
    reviewStatus: row.review_status,
    currentRevisionId: row.current_revision_id,
    acceptedRevisionId: row.accepted_revision_id,
    version: row.version || 1,
    warnings: row.warnings || [],
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    ignoredAt: row.ignored_at,
    ignoredBy: row.ignored_by,
    ignoredReason: row.ignored_reason || "",
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletedReason: row.deleted_reason || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function regionUnderstandingRevisionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    workbookReviewSessionId: row.workbook_review_session_id,
    sourceDocumentId: row.source_document_id,
    regionId: row.region_id,
    revisionNumber: row.revision_number,
    trigger: row.trigger,
    userFeedback: row.user_feedback || "",
    summary: row.summary || [],
    interpretation: row.interpretation || {},
    sourceRefs: row.source_refs || [],
    sourceContentHash: row.source_content_hash,
    dependencyHash: row.dependency_hash,
    validation: row.validation || {},
    provider: row.provider || {},
    warnings: row.warnings || [],
    confidence: row.confidence,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function dataPlanFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    schemaVersion: row.schema_version,
    status: row.status,
    task: row.task,
    outputShape: row.output_shape,
    plan: row.plan || {},
    sourceEvidence: row.source_evidence || [],
    operations: row.operations || [],
    identityBindings: row.identity_bindings || [],
    dependencyHash: row.dependency_hash,
    validation: row.validation || {},
    warnings: row.warnings || [],
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function dataSnapshotFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    dataPlanId: row.data_plan_id,
    analysisPlanRevisionId: row.analysis_plan_revision_id || null,
    analysisRunId: row.analysis_run_id || null,
    analysisResultId: row.analysis_result_id || null,
    schemaVersion: row.schema_version,
    status: row.status,
    outputShape: row.output_shape,
    contentHash: row.content_hash,
    dependencyHash: row.dependency_hash,
    snapshot: row.snapshot || {},
    experimentRecords: row.experiment_records || [],
    sourceRefs: row.source_refs || [],
    summary: row.summary || {},
    warnings: row.warnings || [],
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function experimentIdentityFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    canonicalLabel: row.canonical_label,
    normalizedLabel: row.normalized_label,
    aliases: row.aliases || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function experimentSnapshotHeadFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    experimentId: row.experiment_id,
    dataSnapshotId: row.data_snapshot_id,
    recordIndex: Number(row.record_index),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function browserViewFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    schemaVersion: row.schema_version,
    name: row.name,
    payload: row.payload || {},
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function projectBrowserConfigFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    schemaVersion: row.schema_version,
    payload: row.payload || {},
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function experimentAnnotationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    userId: row.user_id,
    experimentId: row.experiment_id,
    schemaVersion: row.schema_version,
    note: row.note || "",
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function experimentCustomColumnFromRow(row) {
  if (!row) return null;
  return { id: row.id, labId: row.lab_id, projectId: row.project_id, schemaVersion: row.schema_version, label: row.label, version: Number(row.version), createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by };
}

function experimentCustomValueFromRow(row) {
  if (!row) return null;
  return { id: row.id, labId: row.lab_id, projectId: row.project_id, customColumnId: row.custom_column_id, experimentId: row.experiment_id, schemaVersion: row.schema_version, value: row.value || "", version: Number(row.version), createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by };
}

function experimentSnapshotPublishFromRow(row) {
  if (!row) return null;
  return {
    projectId: row.project_id,
    labId: row.lab_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    dataPlanId: row.data_plan_id,
    dataSnapshotId: row.data_snapshot_id,
    response: row.response || {},
    createdAt: row.created_at,
  };
}

function agentRunFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    schemaVersion: row.schema_version || "labrat.agentRun.v1",
    status: row.status,
    mode: row.mode,
    userMessage: row.user_message || "",
    selectedContext: row.selected_context || {},
    visibleSteps: row.visible_steps || [],
    toolTrace: row.tool_trace || [],
    proposalRefs: row.proposal_refs || [],
    actions: row.actions || [],
    usage: row.usage || {},
    warnings: row.warnings || [],
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function analysisThreadFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    schemaVersion: row.schema_version || "labrat.analysisThread.v1",
    status: row.status,
    outputTarget: row.output_target || "chart",
    inputMode: row.input_mode || null,
    originalRequest: row.original_request,
    messages: row.messages || [],
    planRevisionIds: row.plan_revision_ids || [],
    analysisRunIds: row.analysis_run_ids || [],
    acceptedAnalysisResultIds: row.accepted_analysis_result_ids || [],
    chartSpecIds: row.chart_spec_ids || [],
    dataSnapshotIds: row.data_snapshot_ids || [],
    browserViewIds: row.browser_view_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function analysisThreadRetryReceiptFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    analysisThreadId: row.analysis_thread_id,
    actorUserId: row.actor_user_id,
    schemaVersion: row.schema_version || "labrat.analysisThreadRetryReceipt.v1",
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    status: row.status,
    leaseExpiresAt: row.lease_expires_at,
    attemptCount: Number(row.attempt_count || 0),
    analysisPlanRevisionId: row.analysis_plan_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function analysisPlanRevisionFromRow(row) {
  if (!row) return null;
  const plan = row.plan || {};
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    analysisThreadId: row.analysis_thread_id,
    schemaVersion: row.schema_version || "labrat.analysisPlanRevision.v4",
    revision: Number(row.revision),
    status: row.status,
    outputTarget: row.output_target || plan.outputTarget || "chart",
    requestSummary: row.request_summary,
    plan,
    sourceSelections: plan.sourceSelections || [],
    experimentSelections: plan.experimentSelections || [],
    reviewPlan: plan.reviewPlan || {},
    displayPlan: plan.displayPlan || [],
    sourceRectangles: row.source_rectangles || [],
    feedback: row.feedback,
    warnings: row.warnings || [],
    validation: row.validation || {},
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function analysisRunFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    analysisThreadId: row.analysis_thread_id,
    acceptedPlanRevisionId: row.accepted_plan_revision_id,
    schemaVersion: row.schema_version || "labrat.analysisRun.v3",
    status: row.status,
    outputTarget: row.output_target || "chart",
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    inputHash: row.input_hash,
    programHash: row.program_hash,
    runtimeVersion: row.runtime_version,
    resultPreviewHash: row.result_preview_hash,
    payload: row.payload || {},
    warnings: row.warnings || [],
    validation: row.validation || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function analysisResultFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    analysisThreadId: row.analysis_thread_id,
    analysisRunId: row.analysis_run_id,
    schemaVersion: row.schema_version || "labrat.analysisResult.v3",
    status: row.status,
    outputTarget: row.output_target || "chart",
    contentHash: row.content_hash,
    resultPreviewHash: row.result_preview_hash,
    result: row.result || {},
    sourceRefs: row.source_refs || [],
    warnings: row.warnings || [],
    validation: row.validation || {},
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function analysisPublicationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    analysisThreadId: row.analysis_thread_id,
    analysisResultId: row.analysis_result_id,
    chartSpecId: row.chart_spec_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    response: row.response || {},
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function analysisExperimentPublicationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    analysisThreadId: row.analysis_thread_id,
    analysisResultId: row.analysis_result_id,
    dataSnapshotId: row.data_snapshot_id,
    browserViewId: row.browser_view_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    response: row.response || {},
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function chartSpecFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    analysisResultId: row.analysis_result_id || null,
    title: row.title,
    chartType: row.chart_type,
    spec: row.spec || {},
    layout: row.layout || {},
    warnings: row.warnings || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function chartStyleProfileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    schemaVersion: row.schema_version,
    name: row.name,
    description: row.description || "",
    status: row.status,
    currentVersionId: row.current_version_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function chartStyleProfileVersionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    chartStyleProfileId: row.chart_style_profile_id,
    ...(row.payload || {}),
    schemaVersion: row.schema_version,
    version: Number(row.version),
    status: row.status,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    createdBy: row.created_by,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
  };
}

function reusableChartTemplateFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    schemaVersion: row.schema_version,
    name: row.name,
    description: row.description || "",
    status: row.status,
    currentVersionId: row.current_version_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function reusableChartTemplateVersionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    reusableChartTemplateId: row.reusable_chart_template_id,
    ...(row.payload || {}),
    schemaVersion: row.schema_version,
    version: Number(row.version),
    status: row.status,
    sourceChartSpecId: row.source_chart_spec_id,
    chartStyleProfileVersionId: row.chart_style_profile_version_id || null,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    createdBy: row.created_by,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
  };
}

function reusableChartTemplateSlotBindingFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    reusableChartTemplateVersionId: row.reusable_chart_template_version_id,
    schemaVersion: row.schema_version,
    slotId: row.slot_id,
    columnId: row.column_id,
    valueType: row.value_type,
    unit: row.unit || null,
    sourceSignature: row.source_signature,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function reusableChartTemplateApplicationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    reusableChartTemplateVersionId: row.reusable_chart_template_version_id,
    schemaVersion: row.schema_version,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    experimentIds: row.experiment_ids || [],
    frozenHeadRefs: row.frozen_head_refs || [],
    bindings: row.bindings || [],
    compatibility: row.compatibility || {},
    analysisThreadId: row.analysis_thread_id || null,
    analysisPlanRevisionId: row.analysis_plan_revision_id || null,
    analysisRunId: row.analysis_run_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function chartStyleProfileVersionPayload(input = {}) {
  const {
    id, labId, projectId, chartStyleProfileId, schemaVersion, version, status,
    contentHash, createdAt, createdBy, acceptedAt, acceptedBy, ...payload
  } = input;
  return payload;
}

function reusableChartTemplateVersionPayload(input = {}) {
  const {
    id, labId, projectId, reusableChartTemplateId, schemaVersion, version,
    status, sourceChartSpecId, chartStyleProfileVersionId, contentHash,
    createdAt, createdBy, acceptedAt, acceptedBy, ...payload
  } = input;
  return payload;
}

function manuscriptFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    blocks: row.blocks || [],
    pages: row.pages || [],
    canvasState: row.canvas_state || {},
    references: row.references_payload || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

async function insertAnalysisPlanRevisionRow(client, input) {
  const result = await client.query(
    `insert into analysis_plan_revisions
     (id, lab_id, project_id, analysis_thread_id, schema_version, revision, status,
      output_target, request_summary, plan, source_rectangles, feedback, warnings, validation,
      accepted_at, accepted_by, created_at, updated_at, created_by, updated_by)
     values
     ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20)
     returning *`,
    [
      input.id,
      input.labId,
      input.projectId,
      input.analysisThreadId,
      input.schemaVersion || "labrat.analysisPlanRevision.v4",
      input.revision,
      input.status || "awaiting_review",
      input.outputTarget || input.plan?.outputTarget || "chart",
      input.requestSummary,
      jsonb(input.plan || {}),
      jsonb(input.sourceRectangles || [], []),
      input.feedback || null,
      jsonb(input.warnings || [], []),
      jsonb(input.validation || {}),
      input.acceptedAt || null,
      input.acceptedBy || null,
      input.createdAt || nowIso(),
      input.updatedAt || input.createdAt || nowIso(),
      input.createdBy,
      input.updatedBy || input.createdBy,
    ],
  );
  return analysisPlanRevisionFromRow(result.rows[0]);
}

async function insertAnalysisRunRow(client, input) {
  const result = await client.query(
    `insert into analysis_runs
     (id, lab_id, project_id, analysis_thread_id, accepted_plan_revision_id,
      schema_version, status, output_target, idempotency_key, request_hash, input_hash,
      program_hash, runtime_version, result_preview_hash, payload, warnings,
      validation, created_at, updated_at, created_by, updated_by)
     values
     ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20, $21)
     returning *`,
    [
      input.id,
      input.labId,
      input.projectId,
      input.analysisThreadId,
      input.acceptedPlanRevisionId,
      input.schemaVersion || "labrat.analysisRun.v3",
      input.status || "queued",
      input.outputTarget || "chart",
      input.idempotencyKey,
      input.requestHash,
      input.inputHash,
      input.programHash,
      input.runtimeVersion,
      input.resultPreviewHash || null,
      jsonb(input.payload || {}),
      jsonb(input.warnings || [], []),
      jsonb(input.validation || {}),
      input.createdAt || nowIso(),
      input.updatedAt || input.createdAt || nowIso(),
      input.createdBy,
      input.updatedBy || input.createdBy,
    ],
  );
  return analysisRunFromRow(result.rows[0]);
}

async function insertAnalysisResultRow(client, input) {
  const result = await client.query(
    `insert into analysis_results
     (id, lab_id, project_id, analysis_thread_id, analysis_run_id, schema_version,
      status, output_target, content_hash, result_preview_hash, result, source_refs, warnings,
      validation, accepted_at, accepted_by, created_at, updated_at, created_by,
      updated_by)
     values
     ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20)
     returning *`,
    [
      input.id,
      input.labId,
      input.projectId,
      input.analysisThreadId,
      input.analysisRunId,
      input.schemaVersion || "labrat.analysisResult.v1",
      input.status || "awaiting_review",
      input.outputTarget || "chart",
      input.contentHash,
      input.resultPreviewHash || null,
      jsonb(input.result || {}),
      jsonb(input.sourceRefs || [], []),
      jsonb(input.warnings || [], []),
      jsonb(input.validation || {}),
      input.acceptedAt || null,
      input.acceptedBy || null,
      input.createdAt || nowIso(),
      input.updatedAt || input.createdAt || nowIso(),
      input.createdBy,
      input.updatedBy || input.createdBy,
    ],
  );
  return analysisResultFromRow(result.rows[0]);
}

async function insertAuditEventRows(client, events = []) {
  for (const event of events) {
    await client.query(
      `insert into audit_events
       (id, lab_id, project_id, actor_user_id, action, target_type, target_id,
        summary, metadata, created_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        event.id || makeId("audit"),
        event.labId || null,
        event.projectId || null,
        event.actorUserId || null,
        event.action,
        event.targetType || null,
        event.targetId || null,
        event.summary || null,
        jsonb(event.metadata || {}),
        event.createdAt || nowIso(),
        event.ipAddress || null,
        event.userAgent || null,
      ],
    );
  }
}

export class PostgresSaasStore {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  async initialize() {
    const { Pool } = await import("pg");
    this.pool = new Pool({ connectionString: this.config.databaseUrl });
    if (this.config.seedDevAccounts) {
      await this.seedDevAccounts();
    }
  }

  async query(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result;
  }

  async seedDevAccounts() {
    const existing = await this.query("select count(*)::int as count from users");
    if (existing.rows[0]?.count) return;
    const createdAt = nowIso();
    await this.query(
      `insert into labs (id, name, slug, status, settings, created_at, updated_at)
       values ($1, $2, $3, 'active', '{}', $4, $4)`,
      ["lab_hanqi_test", "Hanqi Test Lab", "hanqi-test-lab", createdAt],
    );
    await this.query(
      `insert into users (id, username, display_name, password_hash, is_active, is_super_admin, created_at, updated_at)
       values ($1, $2, $3, $4, true, true, $5, $5)`,
      ["user_admin", "admin", "LabRat Super Admin", hashPassword("LabRatAdmin123!"), createdAt],
    );
    await this.query(
      `insert into users (id, username, display_name, password_hash, is_active, is_super_admin, created_at, updated_at, created_by)
       values ($1, $2, $3, $4, true, false, $5, $5, $6)`,
      ["user_labuser", "labuser", "Hanqi Test Lab Owner", hashPassword("LabRatLab123!"), createdAt, "user_admin"],
    );
    await this.query(
      `insert into lab_memberships (id, lab_id, user_id, role, status, created_at, updated_at, created_by)
       values ($1, $2, $3, 'lab_owner', 'active', $4, $4, $5)`,
      ["membership_hanqi_owner", "lab_hanqi_test", "user_labuser", createdAt, "user_admin"],
    );
  }

  async findUserByUsername(username) {
    const result = await this.query("select * from users where username = $1", [username]);
    return userFromRow(result.rows[0]);
  }

  async findUserById(userId) {
    const result = await this.query("select * from users where id = $1", [userId]);
    return userFromRow(result.rows[0]);
  }

  async createSession({ userId, tokenHash, expiresAt, ipAddress, userAgent }) {
    const session = {
      id: makeId("session"),
      userId,
      tokenHash,
      expiresAt,
      createdAt: nowIso(),
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    };
    const result = await this.query(
      `insert into sessions (id, user_id, session_token_hash, expires_at, created_at, last_seen_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, $5, $6, $7)
       returning *`,
      [session.id, userId, tokenHash, expiresAt, session.createdAt, session.ipAddress, session.userAgent],
    );
    return {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      sessionTokenHash: result.rows[0].session_token_hash,
      expiresAt: result.rows[0].expires_at,
      createdAt: result.rows[0].created_at,
      revokedAt: result.rows[0].revoked_at,
    };
  }

  async findSessionByTokenHash(tokenHash) {
    const result = await this.query(
      `update sessions set last_seen_at = now()
       where session_token_hash = $1 and revoked_at is null
       returning *`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      userId: row.user_id,
      sessionTokenHash: row.session_token_hash,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    } : null;
  }

  async revokeSession(sessionId) {
    await this.query("update sessions set revoked_at = now() where id = $1", [sessionId]);
  }

  async listLabsForUser(userId) {
    const user = await this.findUserById(userId);
    if (!user) return [];
    if (user.isSuperAdmin) {
      const labs = await this.query("select * from labs where status = 'active' order by name");
      return labs.rows.map((lab) => ({ labId: lab.id, name: lab.name, slug: lab.slug, role: "super_admin" }));
    }
    const result = await this.query(
      `select l.id as lab_id, l.name, l.slug, m.role
       from lab_memberships m
       join labs l on l.id = m.lab_id
       where m.user_id = $1 and m.status = 'active' and l.status = 'active'
       order by l.name`,
      [userId],
    );
    return result.rows.map((row) => ({ labId: row.lab_id, name: row.name, slug: row.slug, role: row.role }));
  }

  async listLabs() {
    const result = await this.query("select * from labs order by name");
    return result.rows.map(labFromRow);
  }

  async createLab({ name, slug, createdBy }) {
    const result = await this.query(
      `insert into labs (id, name, slug, status, settings, created_at, updated_at, created_by)
       values ($1, $2, $3, 'active', '{}', now(), now(), $4)
       returning *`,
      [makeId("lab"), name, slug, createdBy],
    );
    return labFromRow(result.rows[0]);
  }

  async listUsers(filter = {}) {
    const result = filter.labId
      ? await this.query(
        `select u.* from users u
         left join lab_memberships m on m.user_id = u.id
         where m.lab_id = $1 or u.is_super_admin = true
         order by u.username`,
        [filter.labId],
      )
      : await this.query("select * from users order by username");
    return Promise.all(result.rows.map(async (row) => {
      const memberships = await this.query("select * from lab_memberships where user_id = $1", [row.id]);
      return {
        ...userFromRow(row),
        memberships: memberships.rows.map(membershipFromRow),
      };
    }));
  }

  async createUser({ username, displayName, temporaryPassword, isSuperAdmin = false, labId = null, role = null, createdBy = null }) {
    const id = makeId("user");
    const result = await this.query(
      `insert into users (id, username, display_name, password_hash, is_active, is_super_admin, created_at, updated_at, created_by)
       values ($1, $2, $3, $4, true, $5, now(), now(), $6)
       returning *`,
      [id, username, displayName, hashPassword(temporaryPassword), Boolean(isSuperAdmin), createdBy],
    );
    let membership = null;
    if (labId && role) {
      const memberResult = await this.query(
        `insert into lab_memberships (id, lab_id, user_id, role, status, created_at, updated_at, created_by)
         values ($1, $2, $3, $4, 'active', now(), now(), $5)
         returning *`,
        [makeId("membership"), labId, id, role, createdBy],
      );
      membership = membershipFromRow(memberResult.rows[0]);
    }
    return { user: userFromRow(result.rows[0]), membership };
  }

  async updateUser(userId, changes) {
    const result = await this.query(
      `update users
       set display_name = coalesce($2, display_name),
           is_active = coalesce($3, is_active),
           is_super_admin = coalesce($4, is_super_admin),
           updated_at = now()
       where id = $1
       returning *`,
      [userId, changes.displayName ?? null, changes.isActive ?? null, changes.isSuperAdmin ?? null],
    );
    if (Array.isArray(changes.memberships)) {
      for (const membership of changes.memberships) {
        await this.query(
          `insert into lab_memberships (id, lab_id, user_id, role, status, created_at, updated_at, created_by)
           values ($1, $2, $3, $4, coalesce($5, 'active'), now(), now(), $6)
           on conflict (lab_id, user_id)
           do update set role = excluded.role, status = excluded.status, updated_at = now()`,
          [makeId("membership"), membership.labId, userId, membership.role, membership.status || "active", changes.updatedBy || null],
        );
      }
    }
    return userFromRow(result.rows[0]);
  }

  async resetPassword(userId, temporaryPassword) {
    const result = await this.query(
      "update users set password_hash = $2, updated_at = now() where id = $1 returning *",
      [userId, hashPassword(temporaryPassword)],
    );
    return userFromRow(result.rows[0]);
  }

  async listProjects({ labId }) {
    const result = await this.query("select * from projects where lab_id = $1 order by updated_at desc", [labId]);
    return result.rows.map(projectFromRow);
  }

  async createProject({ labId, name, description = "", metadata = {}, createdBy }) {
    const result = await this.query(
      `insert into projects (id, lab_id, name, description, status, metadata, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, 'active', $5, now(), now(), $6, $6)
       returning *`,
      [makeId("project"), labId, name, description, jsonb(metadata || {}), createdBy],
    );
    return projectFromRow(result.rows[0]);
  }

  async findProjectById(projectId) {
    const result = await this.query("select * from projects where id = $1", [projectId]);
    return projectFromRow(result.rows[0]);
  }

  async updateProject(projectId, changes) {
    const current = await this.findProjectById(projectId);
    if (!current) return null;
    const result = await this.query(
      `update projects
       set name = $2,
           description = $3,
           status = $4,
           metadata = $5,
           updated_by = coalesce($6, updated_by),
           updated_at = now()
       where id = $1
       returning *`,
      [
        projectId,
        changes.name ?? current.name,
        changes.description ?? current.description,
        changes.status ?? current.status,
        jsonb(changes.metadata ?? current.metadata ?? {}),
        changes.updatedBy ?? null,
      ],
    );
    return projectFromRow(result.rows[0]);
  }

  async createFileObject(input) {
    const result = await this.query(
      `insert into file_objects
       (id, lab_id, project_id, original_name, mime_type, extension, size_bytes, checksum_sha256, storage_provider, storage_key, metadata, created_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)
       returning *`,
      [
        input.id || makeId("file"),
        input.labId,
        input.projectId,
        input.originalName,
        input.mimeType || null,
        input.extension || null,
        input.sizeBytes,
        input.checksumSha256,
        input.storageProvider || "local",
        input.storageKey || null,
        jsonb(input.metadata || {}),
        input.createdBy,
      ],
    );
    return fileFromRow(result.rows[0]);
  }

  async findFileObjectById(fileObjectId) {
    const result = await this.query("select * from file_objects where id = $1", [fileObjectId]);
    return fileFromRow(result.rows[0]);
  }

  async findFileObjectByProjectChecksumName({ projectId, checksumSha256, originalName }) {
    const result = await this.query(
      `select * from file_objects
       where project_id = $1
         and checksum_sha256 = $2
         and original_name = $3
       limit 1`,
      [projectId, checksumSha256, originalName],
    );
    return fileFromRow(result.rows[0]);
  }

  async listFileObjects({ projectId }) {
    const result = await this.query("select * from file_objects where project_id = $1 order by created_at desc", [projectId]);
    return result.rows.map(fileFromRow);
  }

  async createImportRun(input) {
    const result = await this.query(
      `insert into import_runs
       (id, lab_id, project_id, file_object_id, status, scan_result, warnings, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8, $8)
       returning *`,
      [
        makeId("import_run"),
        input.labId,
        input.projectId,
        input.fileObjectId || null,
        input.status || "uploaded",
        nullableJsonb(input.scanResult),
        jsonb(input.warnings || [], []),
        input.createdBy,
      ],
    );
    return importRunFromRow(result.rows[0]);
  }

  async findImportRunById(importRunId) {
    const result = await this.query("select * from import_runs where id = $1", [importRunId]);
    return importRunFromRow(result.rows[0]);
  }

  async listImportRuns({ projectId }) {
    const result = await this.query("select * from import_runs where project_id = $1 order by updated_at desc", [projectId]);
    return result.rows.map(importRunFromRow);
  }

  async updateImportRun(importRunId, changes) {
    const current = await this.findImportRunById(importRunId);
    if (!current) return null;
    const result = await this.query(
      `update import_runs
       set status = $2, normalize_preview = $3, review_decisions = $4, warnings = $5,
           error = $6, updated_by = coalesce($7, updated_by), updated_at = now()
       where id = $1
       returning *`,
      [
        importRunId,
        changes.status || current.status,
        nullableJsonb(changes.normalizePreview ?? current.normalizePreview),
        jsonb(changes.reviewDecisions ?? current.reviewDecisions ?? {}),
        jsonb(changes.warnings ?? current.warnings ?? [], []),
        nullableJsonb(changes.error ?? current.error),
        changes.updatedBy || null,
      ],
    );
    return importRunFromRow(result.rows[0]);
  }

  async replaceSourceDocumentIndex(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query(
        "select * from source_documents where project_id = $1 and file_object_id = $2 limit 1",
        [input.projectId, input.fileObjectId || null],
      );
      const existingDocument = sourceDocumentFromRow(existing.rows[0]);
      const sourceDocumentId = existingDocument?.id || input.id || makeId("source_doc");
      const documentResult = await client.query(
        `insert into source_documents
         (id, lab_id, project_id, file_object_id, import_run_id, document_type, index_version, status, metadata, summary, warnings, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), $12, $13)
         on conflict (project_id, file_object_id)
         do update set
           import_run_id = excluded.import_run_id,
           document_type = excluded.document_type,
           index_version = excluded.index_version,
           status = excluded.status,
           metadata = excluded.metadata,
           summary = excluded.summary,
           warnings = excluded.warnings,
           updated_at = now(),
           updated_by = excluded.updated_by
         returning *`,
        [
          sourceDocumentId,
          input.labId,
          input.projectId,
          input.fileObjectId || null,
          input.importRunId || null,
          input.documentType || "excel_workbook",
          input.indexVersion || "labrat.sourceIndex.v1",
          input.status || "indexed",
          jsonb(input.metadata || {}),
          jsonb(input.summary || {}),
          jsonb(input.warnings || [], []),
          input.createdBy || null,
          input.updatedBy || input.createdBy || null,
        ],
      );
      const document = sourceDocumentFromRow(documentResult.rows[0]);
      await client.query("delete from source_regions where source_document_id = $1", [document.id]);
      await client.query("delete from source_index_blobs where source_document_id = $1", [document.id]);
      for (const region of input.regions || []) {
        await client.query(
          `insert into source_regions
           (id, lab_id, project_id, source_document_id, import_run_id, region_key, kind, label, sheet_name, range_ref, start_row, end_row, start_col, end_col, confidence, signals, candidate_fields, source_refs, warnings, status, created_at, updated_at, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now(), now(), $21, $22)`,
          [
            region.id || makeId("source_region"),
            input.labId,
            input.projectId,
            document.id,
            input.importRunId || null,
            region.regionKey || null,
            region.kind || "unknown_region",
            region.label || "",
            region.sheetName || null,
            region.rangeRef || null,
            region.startRow ?? null,
            region.endRow ?? null,
            region.startCol ?? null,
            region.endCol ?? null,
            region.confidence ?? null,
            jsonb(region.signals || {}),
            jsonb(region.candidateFields || [], []),
            jsonb(region.sourceRefs || [], []),
            jsonb(region.warnings || [], []),
            region.status || "active",
            input.updatedBy || input.createdBy || null,
            input.updatedBy || input.createdBy || null,
          ],
        );
      }
      for (const blob of input.indexBlobs || []) {
        await client.query(
          `insert into source_index_blobs
           (id, lab_id, project_id, source_document_id, blob_kind, storage_provider, storage_key, payload, checksum_sha256, created_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)`,
          [
            blob.id || makeId("source_index_blob"),
            input.labId,
            input.projectId,
            document.id,
            blob.blobKind || "excel_cell_grid_v1",
            blob.storageProvider || "database",
            blob.storageKey || null,
            jsonb(blob.payload || {}),
            blob.checksumSha256 || null,
            input.updatedBy || input.createdBy || null,
          ],
        );
      }
      await client.query("commit");
      return document;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findSourceDocumentById(id) {
    const result = await this.query("select * from source_documents where id = $1", [id]);
    return sourceDocumentFromRow(result.rows[0]);
  }

  async listSourceDocuments({ projectId }) {
    const result = await this.query(
      "select * from source_documents where project_id = $1 order by updated_at desc",
      [projectId],
    );
    return result.rows.map(sourceDocumentFromRow);
  }

  async listSourceRegions({ sourceDocumentId }) {
    const result = await this.query(
      "select * from source_regions where source_document_id = $1 order by sheet_name asc, start_row asc nulls last, start_col asc nulls last",
      [sourceDocumentId],
    );
    return result.rows.map(sourceRegionFromRow);
  }

  async findSourceRegionById(id) {
    const result = await this.query("select * from source_regions where id = $1", [id]);
    return sourceRegionFromRow(result.rows[0]);
  }

  async listSourceIndexBlobs({ sourceDocumentId }) {
    const result = await this.query(
      "select * from source_index_blobs where source_document_id = $1 order by created_at asc",
      [sourceDocumentId],
    );
    return result.rows.map(sourceIndexBlobFromRow);
  }

  async createWorkbookReviewSession(input) {
    const result = await this.query(
      `insert into workbook_review_sessions
       (id, lab_id, project_id, source_document_id, schema_version, status, version, workbook_summary, messages, warnings, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now(), $11, $11)
       returning *`,
      [
        input.id || makeId("workbook_review_session"),
        input.labId,
        input.projectId,
        input.sourceDocumentId,
        input.schemaVersion || "labrat.workbookReviewSession.v1",
        input.status || "needs_user_review",
        input.version || 1,
        jsonb(input.workbookSummary || {}),
        jsonb(input.messages || [], []),
        jsonb(input.warnings || [], []),
        input.createdBy,
      ],
    );
    return workbookReviewSessionFromRow(result.rows[0]);
  }

  async findWorkbookReviewSessionById(id) {
    const result = await this.query("select * from workbook_review_sessions where id = $1", [id]);
    return workbookReviewSessionFromRow(result.rows[0]);
  }

  async updateWorkbookReviewSession(id, patch = {}) {
    const result = await this.query(
      `update workbook_review_sessions
       set status = coalesce($2, status),
           version = coalesce($3, version),
           workbook_summary = coalesce($4, workbook_summary),
           messages = coalesce($5, messages),
           warnings = coalesce($6, warnings),
           updated_at = now(),
           updated_by = coalesce($7, updated_by)
       where id = $1
       returning *`,
      [
        id,
        patch.status ?? null,
        patch.version ?? null,
        patch.workbookSummary === undefined ? null : jsonb(patch.workbookSummary),
        patch.messages === undefined ? null : jsonb(patch.messages, []),
        patch.warnings === undefined ? null : jsonb(patch.warnings, []),
        patch.updatedBy ?? null,
      ],
    );
    return workbookReviewSessionFromRow(result.rows[0]);
  }

  async deleteWorkbookReviewSession(id, {
    expectedVersion,
    reason = "",
    actorUserId = null,
  } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const currentResult = await client.query(
        "select * from workbook_review_sessions where id = $1 for update",
        [id],
      );
      const current = workbookReviewSessionFromRow(currentResult.rows[0]);
      if (!current) {
        await client.query("rollback");
        return null;
      }
      if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) !== Number(current.version)) {
        throw Object.assign(new Error("Workbook review session changed; reload before deleting it."), {
          statusCode: 409,
          code: "workbook_review_session_version_conflict",
          details: {
            expectedVersion: Number.isInteger(Number(expectedVersion)) ? Number(expectedVersion) : null,
            currentVersion: Number(current.version) || 1,
          },
        });
      }
      const sessionResult = await client.query(
        `update workbook_review_sessions
         set status = 'deleted',
             version = version + 1,
             updated_at = now(),
             updated_by = coalesce($2, updated_by)
         where id = $1
         returning *`,
        [id, actorUserId],
      );
      const regionsResult = await client.query(
        `update workbook_review_regions
         set disposition = 'deleted',
             deleted_at = now(),
             deleted_by = $2,
             deleted_reason = $3,
             version = version + 1,
             updated_at = now(),
             updated_by = coalesce($2, updated_by)
         where workbook_review_session_id = $1
           and disposition = 'active'
         returning id`,
        [id, actorUserId, String(reason || "").trim()],
      );
      await client.query("commit");
      return {
        workbookReviewSession: workbookReviewSessionFromRow(sessionResult.rows[0]),
        deletedRegionCount: regionsResult.rowCount,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listWorkbookReviewSessions({ projectId, includeDeleted = false }) {
    const result = await this.query(
      `select * from workbook_review_sessions
       where project_id = $1
         and ($2::boolean = true or status <> 'deleted')
       order by updated_at desc`,
      [projectId, includeDeleted === true],
    );
    return result.rows.map(workbookReviewSessionFromRow);
  }

  async createWorkbookReviewRegion(input) {
    const result = await this.query(
      `insert into workbook_review_regions
       (id, lab_id, project_id, workbook_review_session_id, source_document_id, source_region_id,
        sheet_name, range_ref, selection_method, interpretation_hint, disposition, review_status,
        current_revision_id, accepted_revision_id, version, warnings, accepted_at, accepted_by,
        ignored_at, ignored_by, ignored_reason, deleted_at, deleted_by, deleted_reason,
        created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               $16, $17, $18, $19, $20, $21, $22, $23, $24, now(), now(), $25, $25)
       returning *`,
      [
        input.id || makeId("workbook_review_region"),
        input.labId,
        input.projectId,
        input.workbookReviewSessionId,
        input.sourceDocumentId,
        input.sourceRegionId || null,
        input.sheetName,
        input.rangeRef,
        input.selectionMethod || "manual",
        jsonb(input.interpretationHint || {}),
        input.disposition || "active",
        input.reviewStatus || "interpreting",
        input.currentRevisionId || null,
        input.acceptedRevisionId || null,
        Number(input.version) || 1,
        jsonb(input.warnings || [], []),
        input.acceptedAt || null,
        input.acceptedBy || null,
        input.ignoredAt || null,
        input.ignoredBy || null,
        input.ignoredReason || "",
        input.deletedAt || null,
        input.deletedBy || null,
        input.deletedReason || "",
        input.createdBy || null,
      ],
    );
    return workbookReviewRegionFromRow(result.rows[0]);
  }

  async findWorkbookReviewRegionById(id) {
    const result = await this.query("select * from workbook_review_regions where id = $1", [id]);
    return workbookReviewRegionFromRow(result.rows[0]);
  }

  async listWorkbookReviewRegions({ projectId = null, workbookReviewSessionId = null, sourceDocumentId = null, includeDeleted = false } = {}) {
    const result = await this.query(
      `select * from workbook_review_regions
       where ($1::text is null or project_id = $1)
         and ($2::text is null or workbook_review_session_id = $2)
         and ($3::text is null or source_document_id = $3)
         and ($4::boolean = true or disposition <> 'deleted')
       order by created_at asc`,
      [projectId, workbookReviewSessionId, sourceDocumentId, includeDeleted === true],
    );
    return result.rows.map(workbookReviewRegionFromRow);
  }

  async updateWorkbookReviewRegion(id, patch = {}) {
    const result = await this.query(
      `update workbook_review_regions
       set disposition = coalesce($2, disposition),
           review_status = coalesce($3, review_status),
           current_revision_id = coalesce($4, current_revision_id),
           accepted_revision_id = coalesce($5, accepted_revision_id),
           warnings = coalesce($6, warnings),
           accepted_at = coalesce($7, accepted_at),
           accepted_by = coalesce($8, accepted_by),
           ignored_at = coalesce($9, ignored_at),
           ignored_by = coalesce($10, ignored_by),
           ignored_reason = coalesce($11, ignored_reason),
           deleted_at = coalesce($12, deleted_at),
           deleted_by = coalesce($13, deleted_by),
           deleted_reason = coalesce($14, deleted_reason),
           version = version + 1,
           updated_at = now(),
           updated_by = coalesce($15, updated_by)
       where id = $1
       returning *`,
      [
        id,
        patch.disposition ?? null,
        patch.reviewStatus ?? null,
        patch.currentRevisionId ?? null,
        patch.acceptedRevisionId ?? null,
        patch.warnings === undefined ? null : jsonb(patch.warnings, []),
        patch.acceptedAt ?? null,
        patch.acceptedBy ?? null,
        patch.ignoredAt ?? null,
        patch.ignoredBy ?? null,
        patch.ignoredReason ?? null,
        patch.deletedAt ?? null,
        patch.deletedBy ?? null,
        patch.deletedReason ?? null,
        patch.updatedBy ?? null,
      ],
    );
    return workbookReviewRegionFromRow(result.rows[0]);
  }

  async createRegionUnderstandingRevision(input) {
    const result = await this.query(
      `insert into region_understanding_revisions
       (id, lab_id, project_id, workbook_review_session_id, source_document_id, region_id,
        revision_number, trigger, user_feedback, summary, interpretation, source_refs,
        source_content_hash, dependency_hash, validation, provider, warnings, confidence,
        created_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, now(), $19)
       returning *`,
      [
        input.id || makeId("region_understanding_revision"),
        input.labId,
        input.projectId,
        input.workbookReviewSessionId,
        input.sourceDocumentId,
        input.regionId,
        Number(input.revisionNumber) || 1,
        input.trigger || "initial",
        input.userFeedback || "",
        jsonb(input.summary || [], []),
        jsonb(input.interpretation || {}),
        jsonb(input.sourceRefs || [], []),
        input.sourceContentHash,
        input.dependencyHash,
        jsonb(input.validation || {}),
        jsonb(input.provider || {}),
        jsonb(input.warnings || [], []),
        input.confidence ?? null,
        input.createdBy || null,
      ],
    );
    return regionUnderstandingRevisionFromRow(result.rows[0]);
  }

  async findRegionUnderstandingRevisionById(id) {
    const result = await this.query("select * from region_understanding_revisions where id = $1", [id]);
    return regionUnderstandingRevisionFromRow(result.rows[0]);
  }

  async listRegionUnderstandingRevisions({ regionId = null, projectId = null } = {}) {
    const result = await this.query(
      `select * from region_understanding_revisions
       where ($1::text is null or region_id = $1)
         and ($2::text is null or project_id = $2)
       order by revision_number asc`,
      [regionId, projectId],
    );
    return result.rows.map(regionUnderstandingRevisionFromRow);
  }

  async listAcceptedRegionUnderstandings({ projectId = null, sourceDocumentId = null, workbookReviewSessionId = null } = {}) {
    const regions = await this.listWorkbookReviewRegions({
      projectId,
      sourceDocumentId,
      workbookReviewSessionId,
      includeDeleted: false,
    });
    const accepted = regions.filter((region) => region.disposition === "active" && region.acceptedRevisionId);
    const revisions = await Promise.all(accepted.map((region) => this.findRegionUnderstandingRevisionById(region.acceptedRevisionId)));
    return accepted.flatMap((region, index) => (
      revisions[index] ? [{ region, revision: revisions[index] }] : []
    ));
  }

  async findDataPlanById(id) {
    const result = await this.query("select * from data_plans where id = $1", [id]);
    return dataPlanFromRow(result.rows[0]);
  }

  async listDataPlans({ projectId }) {
    const result = await this.query(
      "select * from data_plans where project_id = $1 order by created_at desc",
      [projectId],
    );
    return result.rows.map(dataPlanFromRow);
  }

  async findDataSnapshotById(id) {
    const result = await this.query("select * from data_snapshots where id = $1", [id]);
    return dataSnapshotFromRow(result.rows[0]);
  }

  async listDataSnapshots({ projectId }) {
    const result = await this.query(
      "select * from data_snapshots where project_id = $1 order by created_at desc",
      [projectId],
    );
    return result.rows.map(dataSnapshotFromRow);
  }

  async findExperimentIdentityById(id) {
    const result = await this.query("select * from experiment_identities where id = $1", [id]);
    return experimentIdentityFromRow(result.rows[0]);
  }

  async listExperimentIdentities({ projectId }) {
    const result = await this.query(
      "select * from experiment_identities where project_id = $1 order by canonical_label, id",
      [projectId],
    );
    return result.rows.map(experimentIdentityFromRow);
  }

  async listExperimentSnapshotHeads({ projectId }) {
    const result = await this.query(
      "select * from experiment_snapshot_heads where project_id = $1 order by experiment_id",
      [projectId],
    );
    return result.rows.map(experimentSnapshotHeadFromRow);
  }

  async findExperimentSnapshotPublish({ projectId, idempotencyKey }) {
    const result = await this.query(
      "select * from experiment_snapshot_publishes where project_id = $1 and idempotency_key = $2",
      [projectId, idempotencyKey],
    );
    return experimentSnapshotPublishFromRow(result.rows[0]);
  }

  async publishExperimentSnapshot(input) {
    const records = Array.isArray(input.dataSnapshot?.experimentRecords) ? input.dataSnapshot.experimentRecords : [];
    const identities = Array.isArray(input.experimentIdentities) ? input.experimentIdentities : [];
    const heads = Array.isArray(input.experimentSnapshotHeads) ? input.experimentSnapshotHeads : [];
    const invalid = (
      !input.idempotencyKey
      || !input.requestHash
      || !input.dataPlan?.id
      || !input.dataSnapshot?.id
      || input.dataPlan.projectId !== input.projectId
      || input.dataSnapshot.projectId !== input.projectId
      || input.dataSnapshot.dataPlanId !== input.dataPlan.id
      || identities.some((identity) => !identity?.id || identity.projectId !== input.projectId)
      || heads.some((head) => {
        const record = records[Number(head?.recordIndex)];
        return !head?.id
          || head.projectId !== input.projectId
          || head.dataSnapshotId !== input.dataSnapshot.id
          || !record
          || record.experimentId !== head.experimentId
          || !identities.some((identity) => identity.id === head.experimentId);
      })
    );
    if (invalid) {
      throw Object.assign(new Error("The experiment snapshot publish package is invalid."), {
        statusCode: 400,
        code: "invalid_publish_package",
      });
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, input.idempotencyKey],
      );
      const priorResult = await client.query(
        "select * from experiment_snapshot_publishes where project_id = $1 and idempotency_key = $2",
        [input.projectId, input.idempotencyKey],
      );
      const prior = experimentSnapshotPublishFromRow(priorResult.rows[0]);
      if (prior) {
        if (prior.requestHash !== input.requestHash) {
          throw Object.assign(new Error("This idempotency key was already used for a different publish request."), {
            statusCode: 409,
            code: "idempotency_key_conflict",
          });
        }
        await client.query("commit");
        return { ...prior.response, idempotentReplay: true };
      }

      const plan = input.dataPlan;
      await client.query(
        `insert into data_plans
         (id, lab_id, project_id, schema_version, status, task, output_shape, plan, source_evidence, operations, identity_bindings, dependency_hash, validation, warnings, accepted_at, accepted_by, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          plan.id,
          plan.labId,
          plan.projectId,
          plan.schemaVersion,
          plan.status,
          plan.task,
          plan.outputShape,
          jsonb(plan.plan || {}),
          jsonb(plan.sourceEvidence || [], []),
          jsonb(plan.operations || [], []),
          jsonb(plan.identityBindings || [], []),
          plan.dependencyHash,
          jsonb(plan.validation || {}),
          jsonb(plan.warnings || [], []),
          plan.acceptedAt,
          plan.acceptedBy,
          plan.createdAt,
          plan.updatedAt,
          plan.createdBy,
          plan.updatedBy,
        ],
      );

      for (const identity of identities) {
        const existing = await client.query("select project_id from experiment_identities where id = $1", [identity.id]);
        if (existing.rows[0] && existing.rows[0].project_id !== input.projectId) {
          throw Object.assign(new Error("Experiment identity belongs to another project."), {
            statusCode: 422,
            code: "identity_reuse_not_found",
          });
        }
        await client.query(
          `insert into experiment_identities
           (id, lab_id, project_id, canonical_label, normalized_label, aliases, created_at, updated_at, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (id) do update
           set aliases = excluded.aliases,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`,
          [
            identity.id,
            identity.labId,
            identity.projectId,
            identity.canonicalLabel,
            identity.normalizedLabel,
            jsonb(identity.aliases || [], []),
            identity.createdAt,
            identity.updatedAt,
            identity.createdBy,
            identity.updatedBy,
          ],
        );
      }

      const snapshot = input.dataSnapshot;
      await client.query(
        `insert into data_snapshots
         (id, lab_id, project_id, data_plan_id, schema_version, status, output_shape, content_hash, dependency_hash, snapshot, experiment_records, source_refs, summary, warnings, accepted_at, accepted_by, created_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          snapshot.id,
          snapshot.labId,
          snapshot.projectId,
          snapshot.dataPlanId,
          snapshot.schemaVersion,
          snapshot.status,
          snapshot.outputShape,
          snapshot.contentHash,
          snapshot.dependencyHash,
          jsonb(snapshot.snapshot || {}),
          jsonb(snapshot.experimentRecords || [], []),
          jsonb(snapshot.sourceRefs || [], []),
          jsonb(snapshot.summary || {}),
          jsonb(snapshot.warnings || [], []),
          snapshot.acceptedAt,
          snapshot.acceptedBy,
          snapshot.createdAt,
          snapshot.createdBy,
        ],
      );

      for (const head of heads) {
        await client.query(
          `insert into experiment_snapshot_heads
           (id, lab_id, project_id, experiment_id, data_snapshot_id, record_index, updated_at, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (project_id, experiment_id) do update
           set data_snapshot_id = excluded.data_snapshot_id,
               record_index = excluded.record_index,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`,
          [
            head.id,
            head.labId,
            head.projectId,
            head.experimentId,
            head.dataSnapshotId,
            head.recordIndex,
            head.updatedAt,
            head.updatedBy,
          ],
        );
      }

      for (const event of Array.isArray(input.auditEvents) ? input.auditEvents : []) {
        await client.query(
          `insert into audit_events
           (id, lab_id, project_id, actor_user_id, action, target_type, target_id, summary, metadata, created_at, ip_address, user_agent)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            event.id || makeId("audit"),
            event.labId || input.labId || null,
            event.projectId || input.projectId || null,
            event.actorUserId || input.actorUserId || null,
            event.action,
            event.targetType || null,
            event.targetId || null,
            event.summary || null,
            jsonb(event.metadata || {}),
            event.createdAt || nowIso(),
            event.ipAddress || null,
            event.userAgent || null,
          ],
        );
      }

      const response = { ...input.response, idempotentReplay: false };
      await client.query(
        `insert into experiment_snapshot_publishes
         (project_id, lab_id, idempotency_key, request_hash, data_plan_id, data_snapshot_id, response, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())`,
        [
          input.projectId,
          input.labId,
          input.idempotencyKey,
          input.requestHash,
          plan.id,
          snapshot.id,
          jsonb(response),
        ],
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createBrowserView(input) {
    const result = await this.query(
      `insert into browser_views
       (id, lab_id, project_id, owner_user_id, schema_version, name, payload, is_default, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
       returning *`,
      [
        input.id || makeId("browser_view"),
        input.labId,
        input.projectId,
        input.ownerUserId,
        input.schemaVersion || "labrat.browserView.v1",
        input.name || "Untitled view",
        jsonb(input.payload || {}),
        Boolean(input.isDefault),
      ],
    );
    return browserViewFromRow(result.rows[0]);
  }

  async findBrowserViewById(id) {
    const result = await this.query("select * from browser_views where id = $1", [id]);
    return browserViewFromRow(result.rows[0]);
  }

  async listBrowserViews({ projectId, ownerUserId = null }) {
    const result = await this.query(
      `select * from browser_views
       where project_id = $1 and ($2::text is null or owner_user_id = $2)
       order by updated_at desc`,
      [projectId, ownerUserId],
    );
    return result.rows.map(browserViewFromRow);
  }

  async updateBrowserView(id, changes = {}) {
    const result = await this.query(
      `update browser_views
       set name = coalesce($2, name),
           payload = coalesce($3, payload),
           is_default = coalesce($4, is_default),
           updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        changes.name === undefined ? null : String(changes.name),
        changes.payload === undefined ? null : jsonb(changes.payload || {}),
        changes.isDefault === undefined ? null : Boolean(changes.isDefault),
      ],
    );
    return browserViewFromRow(result.rows[0]);
  }

  async deleteBrowserView(id) {
    const result = await this.query("delete from browser_views where id = $1", [id]);
    return result.rowCount > 0;
  }

  async findProjectBrowserConfig({ projectId }) {
    const result = await this.query(
      "select * from project_browser_configs where project_id = $1",
      [projectId],
    );
    return projectBrowserConfigFromRow(result.rows[0]);
  }

  async saveProjectBrowserConfig(input) {
    const expectedVersion = Number(input.expectedVersion) || 0;
    const values = [
      input.id || makeId("project_browser_config"),
      input.labId,
      input.projectId,
      input.schemaVersion || "labrat.projectBrowserConfig.v1",
      jsonb(input.payload || {}),
      input.updatedBy || null,
      expectedVersion,
    ];
    const result = expectedVersion === 0
      ? await this.query(
        `insert into project_browser_configs
         (id, lab_id, project_id, schema_version, payload, version, created_at, updated_at, updated_by)
         values ($1, $2, $3, $4, $5, 1, now(), now(), $6)
         on conflict (project_id) do nothing
         returning *`,
        values.slice(0, 6),
      )
      : await this.query(
        `update project_browser_configs
         set payload = $1,
             version = version + 1,
             updated_at = now(),
             updated_by = $2
         where project_id = $3 and version = $4
         returning *`,
        [values[4], values[5], values[2], values[6]],
      );
    if (!result.rows[0]) {
      throw Object.assign(new Error("The shared Experiment Browser configuration changed. Reload the latest configuration and try again."), {
        statusCode: 409,
        code: "project_browser_config_conflict",
      });
    }
    return projectBrowserConfigFromRow(result.rows[0]);
  }

  async listExperimentAnnotations({ projectId, userId }) {
    const result = await this.query(
      `select * from experiment_annotations
       where project_id = $1 and user_id = $2
       order by updated_at desc`,
      [projectId, userId],
    );
    return result.rows.map(experimentAnnotationFromRow);
  }

  async findExperimentAnnotation({ projectId, userId, experimentId }) {
    const result = await this.query(
      `select * from experiment_annotations
       where project_id = $1 and user_id = $2 and experiment_id = $3`,
      [projectId, userId, experimentId],
    );
    return experimentAnnotationFromRow(result.rows[0]);
  }

  async saveExperimentAnnotation(input) {
    const result = await this.query(
      `insert into experiment_annotations
       (id, lab_id, project_id, user_id, experiment_id, schema_version, note, color, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
       on conflict (project_id, user_id, experiment_id)
       do update set note = excluded.note, color = excluded.color, updated_at = now()
       returning *`,
      [
        input.id || makeId("experiment_annotation"),
        input.labId,
        input.projectId,
        input.userId,
        input.experimentId,
        input.schemaVersion || "labrat.experimentAnnotation.v1",
        String(input.note || ""),
        input.color || "amber",
      ],
    );
    return experimentAnnotationFromRow(result.rows[0]);
  }

  async deleteExperimentAnnotation({ projectId, userId, experimentId }) {
    const result = await this.query(
      `delete from experiment_annotations
       where project_id = $1 and user_id = $2 and experiment_id = $3`,
      [projectId, userId, experimentId],
    );
    return result.rowCount > 0;
  }

  async listExperimentCustomColumns({ projectId }) {
    const result = await this.query("select * from experiment_custom_columns where project_id = $1 order by created_at, id", [projectId]);
    return result.rows.map(experimentCustomColumnFromRow);
  }

  async findExperimentCustomColumn({ projectId, customColumnId }) {
    const result = await this.query("select * from experiment_custom_columns where project_id = $1 and id = $2", [projectId, customColumnId]);
    return experimentCustomColumnFromRow(result.rows[0]);
  }

  async createExperimentCustomColumn(input) {
    const result = await this.query(
      `insert into experiment_custom_columns (id, lab_id, project_id, schema_version, label, version, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, 1, now(), now(), $6, $6) returning *`,
      [input.id || makeId("experiment_custom_column"), input.labId, input.projectId, input.schemaVersion || "labrat.experimentCustomColumn.v1", input.label, input.actorUserId || null],
    );
    return experimentCustomColumnFromRow(result.rows[0]);
  }

  async updateExperimentCustomColumn({ projectId, customColumnId, expectedVersion, label, actorUserId }) {
    const result = await this.query(
      `update experiment_custom_columns set label = $1, version = version + 1, updated_at = now(), updated_by = $2
       where project_id = $3 and id = $4 and version = $5 returning *`,
      [label, actorUserId || null, projectId, customColumnId, expectedVersion],
    );
    if (!result.rows[0]) {
      const existing = await this.findExperimentCustomColumn({ projectId, customColumnId });
      if (!existing) return null;
      throw Object.assign(new Error("The custom column changed. Reload and try again."), { statusCode: 409, code: "experiment_custom_column_conflict" });
    }
    return experimentCustomColumnFromRow(result.rows[0]);
  }

  async deleteExperimentCustomColumn({ projectId, customColumnId }) {
    const result = await this.query("delete from experiment_custom_columns where project_id = $1 and id = $2", [projectId, customColumnId]);
    return result.rowCount > 0;
  }

  async listExperimentCustomValues({ projectId }) {
    const result = await this.query("select * from experiment_custom_values where project_id = $1", [projectId]);
    return result.rows.map(experimentCustomValueFromRow);
  }

  async saveExperimentCustomValue(input) {
    const expectedVersion = input.expectedVersion == null ? 0 : Number(input.expectedVersion);
    const result = expectedVersion === 0
      ? await this.query(
        `insert into experiment_custom_values
         (id, lab_id, project_id, custom_column_id, experiment_id, schema_version, value, version, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, 1, now(), now(), $8, $8)
         on conflict (project_id, custom_column_id, experiment_id) do nothing returning *`,
        [input.id || makeId("experiment_custom_value"), input.labId, input.projectId, input.customColumnId, input.experimentId, input.schemaVersion || "labrat.experimentCustomValue.v1", input.value, input.actorUserId || null],
      )
      : await this.query(
        `update experiment_custom_values set value = $1, version = version + 1, updated_at = now(), updated_by = $2
         where project_id = $3 and custom_column_id = $4 and experiment_id = $5 and version = $6 returning *`,
        [input.value, input.actorUserId || null, input.projectId, input.customColumnId, input.experimentId, expectedVersion],
      );
    if (!result.rows[0]) throw Object.assign(new Error("The custom cell changed. Reload and try again."), { statusCode: 409, code: "experiment_custom_value_conflict" });
    return experimentCustomValueFromRow(result.rows[0]);
  }

  async createAgentRun(input) {
    const result = await this.query(
      `insert into agent_runs
       (id, lab_id, project_id, schema_version, status, mode, user_message, selected_context, visible_steps, tool_trace, proposal_refs, actions, usage, warnings, error, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), now(), $16, $16)
       returning *`,
      [
        input.id || makeId("agent_run"),
        input.labId,
        input.projectId,
        input.schemaVersion || "labrat.agentRun.v1",
        input.status || "waiting_for_user",
        input.mode || null,
        input.userMessage || "",
        jsonb(input.selectedContext || {}),
        jsonb(input.visibleSteps || [], []),
        jsonb(input.toolTrace || [], []),
        jsonb(input.proposalRefs || [], []),
        jsonb(input.actions || [], []),
        jsonb(input.usage || {}),
        jsonb(input.warnings || [], []),
        nullableJsonb(input.error || null),
        input.createdBy,
      ],
    );
    return agentRunFromRow(result.rows[0]);
  }

  async findAgentRunById(id) {
    const result = await this.query("select * from agent_runs where id = $1", [id]);
    return agentRunFromRow(result.rows[0]);
  }

  async listAgentRuns({ projectId }) {
    const result = await this.query(
      "select * from agent_runs where project_id = $1 order by updated_at desc",
      [projectId],
    );
    return result.rows.map(agentRunFromRow);
  }

  async updateAgentRun(id, changes) {
    const current = await this.findAgentRunById(id);
    if (!current) return null;
    const result = await this.query(
      `update agent_runs
       set status = $2,
           mode = $3,
           selected_context = $4,
           visible_steps = $5,
           tool_trace = $6,
           proposal_refs = $7,
           actions = $8,
           usage = $9,
           warnings = $10,
           error = $11,
           updated_by = coalesce($12, updated_by),
           updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        changes.status ?? current.status,
        changes.mode ?? current.mode,
        jsonb(changes.selectedContext ?? current.selectedContext ?? {}),
        jsonb(changes.visibleSteps ?? current.visibleSteps ?? [], []),
        jsonb(changes.toolTrace ?? current.toolTrace ?? [], []),
        jsonb(changes.proposalRefs ?? current.proposalRefs ?? [], []),
        jsonb(changes.actions ?? current.actions ?? [], []),
        jsonb(changes.usage ?? current.usage ?? {}),
        jsonb(changes.warnings ?? current.warnings ?? [], []),
        nullableJsonb(changes.error !== undefined ? changes.error : current.error),
        changes.updatedBy || null,
      ],
    );
    return agentRunFromRow(result.rows[0]);
  }

  async createAnalysisThread(input) {
    const result = await this.query(
      `insert into analysis_threads
       (id, lab_id, project_id, schema_version, status, original_request, messages,
        plan_revision_ids, analysis_run_ids, accepted_analysis_result_ids,
        chart_spec_ids, output_target, input_mode, data_snapshot_ids, browser_view_ids,
        created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       returning *`,
      [
        input.id || makeId("analysis_thread"),
        input.labId,
        input.projectId,
        input.schemaVersion || "labrat.analysisThread.v1",
        input.status || "planning",
        input.originalRequest || "",
        jsonb(input.messages || [], []),
        jsonb(input.planRevisionIds || [], []),
        jsonb(input.analysisRunIds || [], []),
        jsonb(input.acceptedAnalysisResultIds || [], []),
        jsonb(input.chartSpecIds || [], []),
        input.outputTarget || "chart",
        input.inputMode || null,
        jsonb(input.dataSnapshotIds || [], []),
        jsonb(input.browserViewIds || [], []),
        input.createdAt || nowIso(),
        input.updatedAt || input.createdAt || nowIso(),
        input.createdBy,
        input.updatedBy || input.createdBy,
      ],
    );
    return analysisThreadFromRow(result.rows[0]);
  }

  async findAnalysisThreadById(id) {
    const result = await this.query("select * from analysis_threads where id = $1", [id]);
    return analysisThreadFromRow(result.rows[0]);
  }

  async listAnalysisThreads({ projectId }) {
    const result = await this.query(
      "select * from analysis_threads where project_id = $1 order by updated_at desc, id desc",
      [projectId],
    );
    return result.rows.map(analysisThreadFromRow);
  }

  async updateAnalysisThread(id, changes = {}) {
    const current = await this.findAnalysisThreadById(id);
    if (!current) return null;
    const result = await this.query(
      `update analysis_threads
       set status = $2,
           output_target = $3,
           input_mode = $4,
           messages = $5,
           plan_revision_ids = $6,
           analysis_run_ids = $7,
           accepted_analysis_result_ids = $8,
           chart_spec_ids = $9,
           data_snapshot_ids = $10,
           browser_view_ids = $11,
           updated_at = $12,
           updated_by = $13
       where id = $1
       returning *`,
      [
        id,
        changes.status ?? current.status,
        changes.outputTarget ?? current.outputTarget ?? "chart",
        changes.inputMode !== undefined ? changes.inputMode : current.inputMode,
        jsonb(changes.messages ?? current.messages ?? [], []),
        jsonb(changes.planRevisionIds ?? current.planRevisionIds ?? [], []),
        jsonb(changes.analysisRunIds ?? current.analysisRunIds ?? [], []),
        jsonb(changes.acceptedAnalysisResultIds ?? current.acceptedAnalysisResultIds ?? [], []),
        jsonb(changes.chartSpecIds ?? current.chartSpecIds ?? [], []),
        jsonb(changes.dataSnapshotIds ?? current.dataSnapshotIds ?? [], []),
        jsonb(changes.browserViewIds ?? current.browserViewIds ?? [], []),
        changes.updatedAt || nowIso(),
        changes.updatedBy || current.updatedBy,
      ],
    );
    return analysisThreadFromRow(result.rows[0]);
  }

  async claimAnalysisThreadRetry(input = {}) {
    const claimedAt = input.claimedAt || nowIso();
    const claimedAtMs = Date.parse(claimedAt);
    const leaseMs = Number.isFinite(Number(input.leaseMs)) && Number(input.leaseMs) > 0
      ? Number(input.leaseMs)
      : 6 * 60 * 1000;
    const required = [
      input.labId,
      input.projectId,
      input.analysisThreadId,
      input.actorUserId,
      input.idempotencyKey,
      input.requestHash,
    ];
    if (required.some((value) => !String(value || "").trim()) || !Number.isFinite(claimedAtMs)) {
      throw Object.assign(new Error("The analysis retry claim is invalid."), {
        statusCode: 400,
        code: "invalid_analysis_retry_claim",
      });
    }
    const leaseExpiresAt = new Date(claimedAtMs + leaseMs).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, `analysis_retry_thread:${input.analysisThreadId}`],
      );
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, `analysis_retry_key:${input.idempotencyKey}`],
      );
      const priorResult = await client.query(
        `select * from analysis_thread_retry_receipts
         where project_id = $1 and idempotency_key = $2
         for update`,
        [input.projectId, input.idempotencyKey],
      );
      let receipt = analysisThreadRetryReceiptFromRow(priorResult.rows[0]);
      if (receipt && (
        receipt.analysisThreadId !== input.analysisThreadId
        || receipt.actorUserId !== input.actorUserId
        || receipt.requestHash !== input.requestHash
      )) {
        throw Object.assign(new Error("This idempotency key was already used for another analysis retry."), {
          statusCode: 409,
          code: "idempotency_key_conflict",
        });
      }
      const threadResult = await client.query(
        "select * from analysis_threads where id = $1 for update",
        [input.analysisThreadId],
      );
      const thread = analysisThreadFromRow(threadResult.rows[0]);
      if (!thread || thread.projectId !== input.projectId || thread.labId !== input.labId) {
        await client.query("commit");
        return { claimStatus: "not_available", receipt, analysisThread: thread };
      }
      if (
        receipt?.status === "drafting"
        && thread.status === "awaiting_plan_review"
        && thread.planRevisionIds.length
      ) {
        const reconciled = await client.query(
          `update analysis_thread_retry_receipts
           set status = 'completed', lease_expires_at = null,
               analysis_plan_revision_id = $2, updated_at = $3
           where id = $1
           returning *`,
          [receipt.id, thread.planRevisionIds.at(-1), claimedAt],
        );
        receipt = analysisThreadRetryReceiptFromRow(reconciled.rows[0]);
      }
      if (receipt?.status === "completed") {
        await client.query("commit");
        return { claimStatus: "replay", receipt, analysisThread: thread };
      }
      if (receipt?.status === "drafting" && Date.parse(receipt.leaseExpiresAt) > claimedAtMs) {
        await client.query("commit");
        return { claimStatus: "in_progress", receipt, analysisThread: thread };
      }
      const activeResult = await client.query(
        `select * from analysis_thread_retry_receipts
         where project_id = $1 and analysis_thread_id = $2
           and status = 'drafting' and lease_expires_at > $3
         order by updated_at desc
         limit 1`,
        [input.projectId, input.analysisThreadId, claimedAt],
      );
      const activeReceipt = analysisThreadRetryReceiptFromRow(activeResult.rows[0]);
      if (activeReceipt) {
        await client.query("commit");
        return { claimStatus: "in_progress", receipt: activeReceipt, analysisThread: thread };
      }
      await client.query(
        `update analysis_thread_retry_receipts
         set status = 'retryable', lease_expires_at = null, updated_at = $3
         where project_id = $1 and analysis_thread_id = $2
           and status = 'drafting' and lease_expires_at <= $3`,
        [input.projectId, input.analysisThreadId, claimedAt],
      );
      if (!["planning", "retry_drafting"].includes(thread.status)) {
        await client.query("commit");
        return { claimStatus: "not_available", receipt, analysisThread: thread };
      }

      const recovered = receipt?.status === "drafting" || thread.status === "retry_drafting";
      let claimedReceiptResult;
      if (receipt) {
        claimedReceiptResult = await client.query(
          `update analysis_thread_retry_receipts
           set status = 'drafting', lease_expires_at = $2,
               attempt_count = attempt_count + 1,
               analysis_plan_revision_id = null, updated_at = $3
           where id = $1
           returning *`,
          [receipt.id, leaseExpiresAt, claimedAt],
        );
      } else {
        claimedReceiptResult = await client.query(
          `insert into analysis_thread_retry_receipts
           (id, lab_id, project_id, analysis_thread_id, actor_user_id, schema_version,
            idempotency_key, request_hash, status, lease_expires_at, attempt_count,
            analysis_plan_revision_id, created_at, updated_at)
           values ($1, $2, $3, $4, $5, 'labrat.analysisThreadRetryReceipt.v1',
                   $6, $7, 'drafting', $8, 1, null, $9, $9)
           returning *`,
          [
            makeId("analysis_retry_receipt"),
            input.labId,
            input.projectId,
            input.analysisThreadId,
            input.actorUserId,
            input.idempotencyKey,
            input.requestHash,
            leaseExpiresAt,
            claimedAt,
          ],
        );
      }
      const claimedThreadResult = await client.query(
        `update analysis_threads
         set status = 'retry_drafting', updated_at = $2, updated_by = $3
         where id = $1
         returning *`,
        [input.analysisThreadId, claimedAt, input.actorUserId],
      );
      await client.query("commit");
      return {
        claimStatus: "claimed",
        receipt: analysisThreadRetryReceiptFromRow(claimedReceiptResult.rows[0]),
        analysisThread: analysisThreadFromRow(claimedThreadResult.rows[0]),
        recovered,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseAnalysisThreadRetry(input = {}) {
    const releasedAt = input.releasedAt || nowIso();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, `analysis_retry_thread:${input.analysisThreadId}`],
      );
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, `analysis_retry_key:${input.idempotencyKey}`],
      );
      const receiptResult = await client.query(
        `select * from analysis_thread_retry_receipts
         where project_id = $1 and idempotency_key = $2
         for update`,
        [input.projectId, input.idempotencyKey],
      );
      let receipt = analysisThreadRetryReceiptFromRow(receiptResult.rows[0]);
      if (!receipt) {
        await client.query("commit");
        return null;
      }
      if (
        receipt.analysisThreadId !== input.analysisThreadId
        || receipt.actorUserId !== input.actorUserId
        || receipt.requestHash !== input.requestHash
      ) {
        throw Object.assign(new Error("This idempotency key was already used for another analysis retry."), {
          statusCode: 409,
          code: "idempotency_key_conflict",
        });
      }
      if (receipt.status === "drafting") {
        const releasedReceipt = await client.query(
          `update analysis_thread_retry_receipts
           set status = 'retryable', lease_expires_at = null, updated_at = $2
           where id = $1
           returning *`,
          [receipt.id, releasedAt],
        );
        receipt = analysisThreadRetryReceiptFromRow(releasedReceipt.rows[0]);
      }
      const updatedThread = await client.query(
        `update analysis_threads
         set status = 'planning', updated_at = $2, updated_by = $3
         where id = $1 and status = 'retry_drafting'
         returning *`,
        [input.analysisThreadId, releasedAt, input.actorUserId],
      );
      let thread = analysisThreadFromRow(updatedThread.rows[0]);
      if (!thread) {
        const currentThread = await client.query(
          "select * from analysis_threads where id = $1",
          [input.analysisThreadId],
        );
        thread = analysisThreadFromRow(currentThread.rows[0]);
      }
      await client.query("commit");
      return { receipt, analysisThread: thread };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeAnalysisThreadRetry(input = {}) {
    const completedAt = input.completedAt || nowIso();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, `analysis_retry_thread:${input.analysisThreadId}`],
      );
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, `analysis_retry_key:${input.idempotencyKey}`],
      );
      const receiptResult = await client.query(
        `select * from analysis_thread_retry_receipts
         where project_id = $1 and idempotency_key = $2
         for update`,
        [input.projectId, input.idempotencyKey],
      );
      const receipt = analysisThreadRetryReceiptFromRow(receiptResult.rows[0]);
      if (!receipt) {
        throw Object.assign(new Error("The analysis retry receipt was not found."), {
          statusCode: 409,
          code: "analysis_retry_receipt_conflict",
        });
      }
      if (
        receipt.analysisThreadId !== input.analysisThreadId
        || receipt.actorUserId !== input.actorUserId
        || receipt.requestHash !== input.requestHash
      ) {
        throw Object.assign(new Error("This idempotency key was already used for another analysis retry."), {
          statusCode: 409,
          code: "idempotency_key_conflict",
        });
      }
      if (receipt.status === "completed") {
        if (receipt.analysisPlanRevisionId !== input.analysisPlanRevisionId) {
          throw Object.assign(new Error("The analysis retry receipt already references another revision."), {
            statusCode: 409,
            code: "analysis_retry_receipt_conflict",
          });
        }
        await client.query("commit");
        return receipt;
      }
      const revisionResult = await client.query(
        `select id from analysis_plan_revisions
         where id = $1 and project_id = $2 and analysis_thread_id = $3`,
        [input.analysisPlanRevisionId, input.projectId, input.analysisThreadId],
      );
      if (receipt.status !== "drafting" || !revisionResult.rows[0]) {
        throw Object.assign(new Error("The analysis retry receipt cannot complete with this revision."), {
          statusCode: 409,
          code: "analysis_retry_receipt_conflict",
        });
      }
      const completed = await client.query(
        `update analysis_thread_retry_receipts
         set status = 'completed', lease_expires_at = null,
             analysis_plan_revision_id = $2, updated_at = $3
         where id = $1
         returning *`,
        [receipt.id, input.analysisPlanRevisionId, completedAt],
      );
      await client.query("commit");
      return analysisThreadRetryReceiptFromRow(completed.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createAnalysisPlanRevision(input) {
    return insertAnalysisPlanRevisionRow(this, input);
  }

  async findAnalysisPlanRevisionById(id) {
    const result = await this.query(
      "select * from analysis_plan_revisions where id = $1",
      [id],
    );
    return analysisPlanRevisionFromRow(result.rows[0]);
  }

  async listAnalysisPlanRevisions({ analysisThreadId }) {
    const result = await this.query(
      `select * from analysis_plan_revisions
       where analysis_thread_id = $1
       order by revision`,
      [analysisThreadId],
    );
    return result.rows.map(analysisPlanRevisionFromRow);
  }

  async updateAnalysisPlanRevisionStatus(id, changes = {}) {
    const result = await this.query(
      `update analysis_plan_revisions
       set status = coalesce($2, status),
           accepted_at = case when $3::boolean then $4 else accepted_at end,
           accepted_by = case when $5::boolean then $6 else accepted_by end,
           updated_at = $7,
           updated_by = coalesce($8, updated_by)
       where id = $1
       returning *`,
      [
        id,
        changes.status === undefined ? null : String(changes.status),
        changes.acceptedAt !== undefined,
        changes.acceptedAt ?? null,
        changes.acceptedBy !== undefined,
        changes.acceptedBy ?? null,
        changes.updatedAt || nowIso(),
        changes.updatedBy || null,
      ],
    );
    return analysisPlanRevisionFromRow(result.rows[0]);
  }

  async appendAnalysisPlanRevision({
    threadId,
    priorRevisionId = null,
    revision,
    messages = [],
    actorUserId,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const threadResult = await client.query(
        "select * from analysis_threads where id = $1 for update",
        [threadId],
      );
      const thread = analysisThreadFromRow(threadResult.rows[0]);
      if (
        !thread
        || revision.analysisThreadId !== thread.id
        || revision.projectId !== thread.projectId
      ) {
        throw Object.assign(new Error("The analysis plan revision package is invalid."), {
          statusCode: 409,
          code: "analysis_plan_revision_conflict",
        });
      }
      if (priorRevisionId) {
        const priorResult = await client.query(
          "select * from analysis_plan_revisions where id = $1 for update",
          [priorRevisionId],
        );
        const prior = analysisPlanRevisionFromRow(priorResult.rows[0]);
        if (!prior || prior.analysisThreadId !== thread.id || prior.status !== "awaiting_review") {
          throw Object.assign(new Error("The prior analysis plan revision changed."), {
            statusCode: 409,
            code: "analysis_plan_revision_conflict",
          });
        }
        await client.query(
          `update analysis_plan_revisions
           set status = 'superseded', updated_at = $2, updated_by = $3
           where id = $1`,
          [prior.id, revision.createdAt || nowIso(), actorUserId],
        );
      }
      const created = await insertAnalysisPlanRevisionRow(client, revision);
      const updatedThreadResult = await client.query(
        `update analysis_threads
         set status = 'awaiting_plan_review',
             messages = $2,
             plan_revision_ids = $3,
             updated_at = $4,
             updated_by = $5
         where id = $1
         returning *`,
        [
          thread.id,
          jsonb([...(thread.messages || []), ...messages], []),
          jsonb([...(thread.planRevisionIds || []), created.id], []),
          revision.createdAt || nowIso(),
          actorUserId,
        ],
      );
      if (!updatedThreadResult.rows[0]) {
        throw Object.assign(new Error("Analysis thread changed during revision creation."), {
          statusCode: 409,
          code: "analysis_plan_revision_conflict",
        });
      }
      await client.query("commit");
      return created;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createAnalysisRun(input) {
    return insertAnalysisRunRow(this, input);
  }

  async retryAnalysisRun(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, input.idempotencyKey],
      );
      const priorResult = await client.query(
        "select * from analysis_runs where project_id = $1 and idempotency_key = $2",
        [input.projectId, input.idempotencyKey],
      );
      const prior = analysisRunFromRow(priorResult.rows[0]);
      if (prior) {
        if (prior.requestHash !== input.requestHash) {
          throw Object.assign(new Error("This idempotency key was already used for another generation retry."), {
            statusCode: 409,
            code: "idempotency_key_conflict",
          });
        }
        const threadResult = await client.query(
          "select * from analysis_threads where id = $1",
          [prior.analysisThreadId],
        );
        await client.query("commit");
        return { analysisThread: analysisThreadFromRow(threadResult.rows[0]), analysisRun: prior };
      }
      const failedResult = await client.query(
        "select * from analysis_runs where id = $1 and project_id = $2 for update",
        [input.failedAnalysisRunId, input.projectId],
      );
      const threadResult = await client.query(
        "select * from analysis_threads where id = $1 and project_id = $2 for update",
        [input.analysisThreadId, input.projectId],
      );
      const revisionResult = await client.query(
        "select * from analysis_plan_revisions where id = $1 and project_id = $2 for update",
        [input.planRevisionId, input.projectId],
      );
      const failedRun = analysisRunFromRow(failedResult.rows[0]);
      const thread = analysisThreadFromRow(threadResult.rows[0]);
      const revision = analysisPlanRevisionFromRow(revisionResult.rows[0]);
      if (
        !failedRun
        || !thread
        || !revision
        || !["failed", "validation_failed"].includes(failedRun.status)
        || revision.status !== "accepted"
        || revision.analysisThreadId !== thread.id
        || input.analysisRun?.analysisThreadId !== thread.id
        || input.analysisRun?.acceptedPlanRevisionId !== revision.id
      ) {
        throw Object.assign(new Error("The analysis generation retry package is invalid."), {
          statusCode: 409,
          code: "analysis_run_retry_unavailable",
        });
      }
      const analysisRun = await insertAnalysisRunRow(client, input.analysisRun);
      const updatedThreadResult = await client.query(
        `update analysis_threads
         set status = 'executing',
             analysis_run_ids = $2,
             updated_at = $3,
             updated_by = $4
         where id = $1
         returning *`,
        [
          thread.id,
          jsonb([...(thread.analysisRunIds || []), analysisRun.id], []),
          analysisRun.createdAt,
          input.actorUserId,
        ],
      );
      await insertAuditEventRows(client, input.auditEvents || []);
      await client.query("commit");
      return {
        analysisThread: analysisThreadFromRow(updatedThreadResult.rows[0]),
        analysisRun,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findAnalysisRunById(id) {
    const result = await this.query("select * from analysis_runs where id = $1", [id]);
    return analysisRunFromRow(result.rows[0]);
  }

  async findAnalysisRunByIdempotencyKey({ projectId, idempotencyKey }) {
    const result = await this.query(
      `select * from analysis_runs
       where project_id = $1 and idempotency_key = $2`,
      [projectId, idempotencyKey],
    );
    return analysisRunFromRow(result.rows[0]);
  }

  async listAnalysisRuns({ projectId, analysisThreadId = null }) {
    const result = await this.query(
      `select * from analysis_runs
       where project_id = $1
         and ($2::text is null or analysis_thread_id = $2)
       order by created_at desc, id desc`,
      [projectId, analysisThreadId],
    );
    return result.rows.map(analysisRunFromRow);
  }

  async claimAnalysisRun({
    projectId,
    analysisRunId,
    actorUserId,
    expectedHeadRefs = [],
    staleValidation = {},
    staleError = null,
    staleAuditEvents = [],
    startedAt = nowIso(),
    staleAfterMs = 360_000,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const runResult = await client.query(
        "select * from analysis_runs where id = $1 and project_id = $2 for update",
        [analysisRunId, projectId],
      );
      const run = analysisRunFromRow(runResult.rows[0]);
      const threadResult = run
        ? await client.query(
          "select * from analysis_threads where id = $1 and project_id = $2 for update",
          [run.analysisThreadId, projectId],
        )
        : { rows: [] };
      const thread = analysisThreadFromRow(threadResult.rows[0]);
      const priorStartedAt = Date.parse(run?.payload?.startedAt || "");
      const claimStartedAt = Date.parse(startedAt);
      const expiredLease = run?.status === "running"
        && Number.isFinite(priorStartedAt)
        && Number.isFinite(claimStartedAt)
        && claimStartedAt - priorStartedAt >= Math.max(Number(staleAfterMs) || 0, 1);
      if (!run || !thread || run.status !== "queued" && !expiredLease) {
        throw Object.assign(new Error("Analysis run is not queued for execution."), {
          statusCode: 409,
          code: "analysis_run_state_conflict",
        });
      }

      const expectedRefs = Array.isArray(expectedHeadRefs) ? expectedHeadRefs : [];
      const experimentIds = [...new Set(
        expectedRefs.map((head) => head.experimentId).filter(Boolean),
      )];
      const headsResult = experimentIds.length
        ? await client.query(
          `select * from experiment_snapshot_heads
           where project_id = $1 and experiment_id = any($2::text[])
           for share`,
          [projectId, experimentIds],
        )
        : { rows: [] };
      const currentHeads = headsResult.rows.map(experimentSnapshotHeadFromRow);
      const headMismatches = expectedRefs.flatMap((expected) => {
        const current = currentHeads.find((head) => head.experimentId === expected.experimentId);
        return (
          current
          && current.id === expected.headId
          && current.dataSnapshotId === expected.dataSnapshotId
          && Number(current.recordIndex) === Number(expected.recordIndex)
        ) ? [] : [{
          experimentId: expected.experimentId,
          expected,
          current: current ? {
            headId: current.id,
            dataSnapshotId: current.dataSnapshotId,
            recordIndex: Number(current.recordIndex),
          } : null,
        }];
      });
      if (headMismatches.length) {
        const payload = {
          ...(run.payload || {}),
          completedAt: startedAt,
          error: staleError || {
            code: "analysis_run_stale",
            message: "Active accepted experiment heads changed before execution claim.",
          },
          headMismatches,
        };
        const completedResult = await client.query(
          `update analysis_runs
           set status = 'validation_failed',
               payload = $3,
               validation = $4,
               updated_at = $5,
               updated_by = $6
           where id = $1 and project_id = $2
           returning *`,
          [
            analysisRunId,
            projectId,
            jsonb(payload),
            jsonb(staleValidation || {}),
            startedAt,
            actorUserId,
          ],
        );
        await client.query(
          `update analysis_threads
           set status = 'execution_failed', updated_at = $2, updated_by = $3
           where id = $1`,
          [thread.id, startedAt, actorUserId],
        );
        await insertAuditEventRows(client, staleAuditEvents);
        await client.query("commit");
        return analysisRunFromRow(completedResult.rows[0]);
      }

      const payload = {
        ...(run.payload || {}),
        ...(expiredLease ? {
          recoveredFromStartedAt: run.payload?.startedAt || null,
          recoveryCount: (Number(run.payload?.recoveryCount) || 0) + 1,
        } : {}),
        claimToken: makeId("analysis_claim"),
        startedAt,
      };
      const claimedResult = await client.query(
        `update analysis_runs
         set status = 'running',
             payload = $3,
             updated_at = $4,
             updated_by = $5
         where id = $1 and project_id = $2
         returning *`,
        [
          analysisRunId,
          projectId,
          jsonb(payload),
          startedAt,
          actorUserId,
        ],
      );
      await client.query("commit");
      return analysisRunFromRow(claimedResult.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizeAnalysisRun({
    projectId,
    analysisRunId,
    actorUserId,
    claimToken,
    status,
    resultPreviewHash = null,
    payload = {},
    warnings = [],
    validation = {},
    analysisResult = null,
    threadStatus,
    completedAt = nowIso(),
    auditEvents = [],
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const runResult = await client.query(
        "select * from analysis_runs where id = $1 and project_id = $2 for update",
        [analysisRunId, projectId],
      );
      const run = analysisRunFromRow(runResult.rows[0]);
      const threadResult = run
        ? await client.query(
          "select * from analysis_threads where id = $1 and project_id = $2 for update",
          [run.analysisThreadId, projectId],
        )
        : { rows: [] };
      const thread = analysisThreadFromRow(threadResult.rows[0]);
      if (
        !run
        || run.status !== "running"
        || !claimToken
        || claimToken !== run.payload?.claimToken
        || !thread
        || !["failed", "validation_failed", "awaiting_result_review"].includes(status)
        || analysisResult && (
          status !== "awaiting_result_review"
          || analysisResult.projectId !== projectId
          || analysisResult.analysisThreadId !== thread.id
          || analysisResult.analysisRunId !== run.id
        )
      ) {
        throw Object.assign(new Error("The analysis run completion package is invalid."), {
          statusCode: 409,
          code: "analysis_run_state_conflict",
        });
      }
      const persistedResult = analysisResult
        ? await insertAnalysisResultRow(client, analysisResult)
        : null;
      const completedRunResult = await client.query(
        `update analysis_runs
         set status = $3,
             result_preview_hash = $4,
             payload = $5,
             warnings = $6,
             validation = $7,
             updated_at = $8,
             updated_by = $9
         where id = $1 and project_id = $2
         returning *`,
        [
          analysisRunId,
          projectId,
          status,
          resultPreviewHash,
          jsonb(payload || {}),
          jsonb(warnings || [], []),
          jsonb(validation || {}),
          completedAt,
          actorUserId,
        ],
      );
      const updatedThreadResult = await client.query(
        `update analysis_threads
         set status = $2, updated_at = $3, updated_by = $4
         where id = $1
         returning *`,
        [
          thread.id,
          threadStatus || (
            status === "awaiting_result_review" ? "awaiting_result_review" : "execution_failed"
          ),
          completedAt,
          actorUserId,
        ],
      );
      await insertAuditEventRows(client, auditEvents);
      await client.query("commit");
      return {
        analysisRun: analysisRunFromRow(completedRunResult.rows[0]),
        analysisThread: analysisThreadFromRow(updatedThreadResult.rows[0]),
        analysisResult: persistedResult,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createAnalysisResult(input) {
    return insertAnalysisResultRow(this, input);
  }

  async findAnalysisResultById(id) {
    const result = await this.query("select * from analysis_results where id = $1", [id]);
    return analysisResultFromRow(result.rows[0]);
  }

  async listAnalysisResults({ projectId, analysisThreadId = null }) {
    const result = await this.query(
      `select * from analysis_results
       where project_id = $1
         and ($2::text is null or analysis_thread_id = $2)
       order by created_at desc, id desc`,
      [projectId, analysisThreadId],
    );
    return result.rows.map(analysisResultFromRow);
  }

  async acceptAnalysisPlan(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, input.idempotencyKey],
      );
      const priorResult = await client.query(
        `select * from analysis_runs
         where project_id = $1 and idempotency_key = $2`,
        [input.projectId, input.idempotencyKey],
      );
      const prior = analysisRunFromRow(priorResult.rows[0]);
      if (prior) {
        if (prior.requestHash !== input.requestHash) {
          throw Object.assign(new Error("This idempotency key was already used for another plan acceptance."), {
            statusCode: 409,
            code: "idempotency_key_conflict",
          });
        }
        const threadResult = await client.query(
          "select * from analysis_threads where id = $1",
          [prior.analysisThreadId],
        );
        const revisionResult = await client.query(
          "select * from analysis_plan_revisions where id = $1",
          [prior.acceptedPlanRevisionId],
        );
        await client.query("commit");
        return {
          analysisThread: analysisThreadFromRow(threadResult.rows[0]),
          analysisPlanRevision: analysisPlanRevisionFromRow(revisionResult.rows[0]),
          analysisRun: prior,
        };
      }
      const threadResult = await client.query(
        "select * from analysis_threads where id = $1 for update",
        [input.analysisThreadId],
      );
      const revisionResult = await client.query(
        "select * from analysis_plan_revisions where id = $1 for update",
        [input.planRevisionId],
      );
      const thread = analysisThreadFromRow(threadResult.rows[0]);
      const revision = analysisPlanRevisionFromRow(revisionResult.rows[0]);
      if (
        !thread
        || !revision
        || thread.projectId !== input.projectId
        || revision.projectId !== input.projectId
        || revision.analysisThreadId !== thread.id
        || revision.status !== "awaiting_review"
        || !input.analysisRun?.id
        || input.analysisRun.projectId !== input.projectId
        || input.analysisRun.analysisThreadId !== thread.id
        || input.analysisRun.acceptedPlanRevisionId !== revision.id
        || input.analysisRun.idempotencyKey !== input.idempotencyKey
        || input.analysisRun.requestHash !== input.requestHash
      ) {
        throw Object.assign(new Error("The analysis plan acceptance package is invalid."), {
          statusCode: 409,
          code: "analysis_plan_revision_mismatch",
        });
      }
      const acceptedAt = input.analysisRun.createdAt || nowIso();
      const acceptedRevisionResult = await client.query(
        `update analysis_plan_revisions
         set status = 'accepted',
             accepted_at = $2,
             accepted_by = $3,
             updated_at = $2,
             updated_by = $3
         where id = $1 and status = 'awaiting_review'
         returning *`,
        [revision.id, acceptedAt, input.actorUserId],
      );
      if (!acceptedRevisionResult.rows[0]) {
        throw Object.assign(new Error("The analysis plan revision changed before acceptance."), {
          statusCode: 409,
          code: "analysis_plan_revision_mismatch",
        });
      }
      const analysisRun = await insertAnalysisRunRow(client, input.analysisRun);
      const updatedThreadResult = await client.query(
        `update analysis_threads
         set status = 'executing',
             analysis_run_ids = $2,
             updated_at = $3,
             updated_by = $4
         where id = $1
         returning *`,
        [
          thread.id,
          jsonb([...(thread.analysisRunIds || []), analysisRun.id], []),
          acceptedAt,
          input.actorUserId,
        ],
      );
      await insertAuditEventRows(client, input.auditEvents || []);
      await client.query("commit");
      return {
        analysisThread: analysisThreadFromRow(updatedThreadResult.rows[0]),
        analysisPlanRevision: analysisPlanRevisionFromRow(acceptedRevisionResult.rows[0]),
        analysisRun,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findAnalysisPublication({ projectId, idempotencyKey }) {
    const result = await this.query(
      `select * from analysis_publications
       where project_id = $1 and idempotency_key = $2`,
      [projectId, idempotencyKey],
    );
    return analysisPublicationFromRow(result.rows[0]);
  }

  async publishAnalysisResult(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, input.idempotencyKey],
      );
      const priorResult = await client.query(
        `select * from analysis_publications
         where project_id = $1 and idempotency_key = $2`,
        [input.projectId, input.idempotencyKey],
      );
      const prior = analysisPublicationFromRow(priorResult.rows[0]);
      if (prior) {
        if (prior.requestHash !== input.requestHash) {
          throw Object.assign(new Error("This idempotency key was already used for another analysis publication."), {
            statusCode: 409,
            code: "idempotency_key_conflict",
          });
        }
        await client.query("commit");
        return { ...prior.response, idempotentReplay: true };
      }
      const threadResult = await client.query(
        "select * from analysis_threads where id = $1 and project_id = $2 for update",
        [input.analysisThreadId, input.projectId],
      );
      const revisionResult = input.analysisPlanRevision?.id
        ? await client.query(
          "select * from analysis_plan_revisions where id = $1 and project_id = $2 for share",
          [input.analysisPlanRevision.id, input.projectId],
        )
        : { rows: [] };
      const runResult = input.analysisRun?.id
        ? await client.query(
          "select * from analysis_runs where id = $1 and project_id = $2 for update",
          [input.analysisRun.id, input.projectId],
        )
        : { rows: [] };
      const storedResultQuery = input.analysisResult?.id
        ? await client.query(
          "select * from analysis_results where id = $1 and project_id = $2 for update",
          [input.analysisResult.id, input.projectId],
        )
        : { rows: [] };
      const thread = analysisThreadFromRow(threadResult.rows[0]);
      const revision = analysisPlanRevisionFromRow(revisionResult.rows[0]);
      const run = analysisRunFromRow(runResult.rows[0]);
      const storedResult = analysisResultFromRow(storedResultQuery.rows[0]);
      const resultPackage = input.analysisResult;
      const chart = input.chartSpec;
      if (
        !input.idempotencyKey
        || !input.requestHash
        || !thread
        || thread.projectId !== input.projectId
        || thread.status !== "awaiting_result_review"
        || !revision
        || revision.analysisThreadId !== thread.id
        || revision.status !== "accepted"
        || !run
        || run.analysisThreadId !== thread.id
        || run.acceptedPlanRevisionId !== revision.id
        || run.status !== "awaiting_result_review"
        || run.resultPreviewHash !== storedResult?.resultPreviewHash
        || input.analysisRun.status !== "completed"
        || !resultPackage?.id
        || resultPackage.projectId !== input.projectId
        || resultPackage.analysisThreadId !== thread.id
        || resultPackage.analysisRunId !== run.id
        || resultPackage.status !== "accepted"
        || !storedResult
        || storedResult.analysisThreadId !== thread.id
        || storedResult.analysisRunId !== run.id
        || storedResult.status !== "awaiting_review"
        || storedResult.contentHash !== resultPackage.contentHash
        || storedResult.resultPreviewHash !== resultPackage.resultPreviewHash
        || storedResult.validation?.ok !== true
        || (storedResult.validation?.errors || []).length
        || !chart?.id
        || chart.projectId !== input.projectId
        || chart.analysisResultId !== resultPackage.id
        || chart.spec?.origin !== "analysis_result"
        || chart.spec?.schemaVersion !== "labrat.chartSpec.v3"
        || chart.spec?.analysisThreadId !== thread.id
        || chart.spec?.analysisPlanRevisionId !== revision.id
        || chart.spec?.analysisRunId !== run.id
        || chart.spec?.analysisResultId !== storedResult.id
        || !Array.isArray(input.expectedHeadRefs)
      ) {
        throw Object.assign(new Error("The analysis result publication package is invalid."), {
          statusCode: 400,
          code: "invalid_analysis_publication_package",
        });
      }

      const expectedRefs = Array.isArray(input.expectedHeadRefs) ? input.expectedHeadRefs : [];
      const experimentIds = [...new Set(
        expectedRefs.map((head) => head.experimentId).filter(Boolean),
      )];
      const headsResult = experimentIds.length
        ? await client.query(
          `select * from experiment_snapshot_heads
           where project_id = $1 and experiment_id = any($2::text[])
           for share`,
          [input.projectId, experimentIds],
        )
        : { rows: [] };
      const currentHeads = headsResult.rows.map(experimentSnapshotHeadFromRow);
      const headMismatches = expectedRefs.flatMap((expected) => {
        const current = currentHeads.find((head) => head.experimentId === expected.experimentId);
        return (
          current
          && current.id === expected.headId
          && current.dataSnapshotId === expected.dataSnapshotId
          && Number(current.recordIndex) === Number(expected.recordIndex)
        ) ? [] : [{
          experimentId: expected.experimentId,
          expected,
          current: current ? {
            headId: current.id,
            dataSnapshotId: current.dataSnapshotId,
            recordIndex: Number(current.recordIndex),
          } : null,
        }];
      });
      if (headMismatches.length) {
        throw Object.assign(new Error(input.staleError?.message || "Accepted experiment snapshots changed before chart publication."), {
          statusCode: 409,
          code: input.staleError?.code || "analysis_result_stale",
          details: { headMismatches },
        });
      }

      const acceptedAt = resultPackage.acceptedAt || nowIso();
      const acceptedResultQuery = await client.query(
        `update analysis_results
         set status = 'accepted',
             accepted_at = $3,
             accepted_by = $4,
             updated_at = $3,
             updated_by = $4
         where id = $1 and project_id = $2 and status = 'awaiting_review'
         returning *`,
        [resultPackage.id, input.projectId, acceptedAt, input.actorUserId],
      );
      const analysisResult = analysisResultFromRow(acceptedResultQuery.rows[0]);
      const completedRunQuery = await client.query(
        `update analysis_runs
         set status = 'completed',
             updated_at = $3,
             updated_by = $4
         where id = $1 and project_id = $2 and status = 'awaiting_result_review'
         returning *`,
        [run.id, input.projectId, acceptedAt, input.actorUserId],
      );
      if (!analysisResult || !completedRunQuery.rows[0]) {
        throw Object.assign(new Error("Analysis result publication state changed concurrently."), {
          statusCode: 409,
          code: "analysis_result_state_conflict",
        });
      }
      const chartResult = await client.query(
        `insert into chart_specs
         (id, lab_id, project_id, analysis_result_id, title, chart_type, spec, layout, warnings, created_at,
          updated_at, created_by, updated_by)
         values
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         returning *`,
        [
          chart.id,
          chart.labId,
          chart.projectId,
          analysisResult.id,
          chart.title || null,
          chart.chartType,
          jsonb(chart.spec || {}),
          jsonb(chart.layout || {}),
          jsonb(chart.warnings || [], []),
          chart.createdAt || nowIso(),
          chart.updatedAt || chart.createdAt || nowIso(),
          chart.createdBy,
          chart.updatedBy || chart.createdBy,
        ],
      );
      const chartSpec = chartSpecFromRow(chartResult.rows[0]);
      const completedAt = analysisResult.acceptedAt || acceptedAt;
      await client.query(
        `update analysis_threads
         set status = 'completed',
             accepted_analysis_result_ids = $2,
             chart_spec_ids = $3,
             updated_at = $4,
             updated_by = $5
         where id = $1`,
        [
          thread.id,
          jsonb([
            ...(thread.acceptedAnalysisResultIds || []).filter((id) => id !== analysisResult.id),
            analysisResult.id,
          ], []),
          jsonb([
            ...(thread.chartSpecIds || []).filter((id) => id !== chartSpec.id),
            chartSpec.id,
          ], []),
          completedAt,
          input.actorUserId,
        ],
      );
      const response = { ...input.response, idempotentReplay: false };
      await client.query(
        `insert into analysis_publications
         (id, lab_id, project_id, analysis_thread_id, analysis_result_id,
          chart_spec_id, idempotency_key, request_hash, response, created_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          input.publicationId || makeId("analysis_publication"),
          input.labId,
          input.projectId,
          thread.id,
          analysisResult.id,
          chartSpec.id,
          input.idempotencyKey,
          input.requestHash,
          jsonb(response),
          completedAt,
          input.actorUserId,
        ],
      );
      await insertAuditEventRows(client, input.auditEvents || []);
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findExperimentAnalysisPublication({ projectId, idempotencyKey }) {
    const result = await this.query(
      `select * from analysis_experiment_publications
       where project_id = $1 and idempotency_key = $2`,
      [projectId, idempotencyKey],
    );
    return analysisExperimentPublicationFromRow(result.rows[0]);
  }

  async publishExperimentAnalysis(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.projectId, input.idempotencyKey],
      );
      const priorResult = await client.query(
        `select * from analysis_experiment_publications
         where project_id = $1 and idempotency_key = $2`,
        [input.projectId, input.idempotencyKey],
      );
      const prior = analysisExperimentPublicationFromRow(priorResult.rows[0]);
      if (prior) {
        if (prior.requestHash !== input.requestHash) {
          throw Object.assign(new Error("This idempotency key was already used for another Experiment Browser publication."), {
            statusCode: 409,
            code: "idempotency_key_conflict",
          });
        }
        await client.query("commit");
        return { ...prior.response, idempotentReplay: true };
      }
      const threadResult = await client.query(
        "select * from analysis_threads where id = $1 and project_id = $2 for update",
        [input.analysisThread.id, input.projectId],
      );
      const revisionResult = await client.query(
        "select * from analysis_plan_revisions where id = $1 and project_id = $2 for share",
        [input.analysisPlanRevision.id, input.projectId],
      );
      const runResult = await client.query(
        "select * from analysis_runs where id = $1 and project_id = $2 for update",
        [input.analysisRun.id, input.projectId],
      );
      const storedResultQuery = await client.query(
        "select * from analysis_results where id = $1 and project_id = $2 for update",
        [input.analysisResult.id, input.projectId],
      );
      const thread = analysisThreadFromRow(threadResult.rows[0]);
      const revision = analysisPlanRevisionFromRow(revisionResult.rows[0]);
      const run = analysisRunFromRow(runResult.rows[0]);
      const storedResult = analysisResultFromRow(storedResultQuery.rows[0]);
      const snapshot = input.dataSnapshot;
      const browserView = input.browserView;
      const records = Array.isArray(snapshot?.experimentRecords) ? snapshot.experimentRecords : [];
      const heads = Array.isArray(input.experimentSnapshotHeads) ? input.experimentSnapshotHeads : [];
      if (
        !thread
        || thread.status !== "awaiting_result_review"
        || thread.outputTarget !== "experiment_browser"
        || !revision
        || revision.status !== "accepted"
        || revision.analysisThreadId !== thread.id
        || !run
        || run.status !== "awaiting_result_review"
        || run.outputTarget !== "experiment_browser"
        || run.acceptedPlanRevisionId !== revision.id
        || !storedResult
        || storedResult.status !== "awaiting_review"
        || storedResult.outputTarget !== "experiment_browser"
        || storedResult.validation?.ok !== true
        || input.analysisResult.status !== "accepted"
        || input.analysisRun.status !== "completed"
        || !snapshot?.id
        || snapshot.projectId !== input.projectId
        || snapshot.analysisResultId !== storedResult.id
        || !browserView?.id
        || browserView.projectId !== input.projectId
        || browserView.ownerUserId !== input.actorUserId
        || heads.some((head) => {
          const record = records[Number(head.recordIndex)];
          return !record
            || head.dataSnapshotId !== snapshot.id
            || record.experimentId !== head.experimentId;
        })
      ) {
        throw Object.assign(new Error("The Experiment Browser publication package is invalid."), {
          statusCode: 400,
          code: "invalid_experiment_analysis_publication_package",
        });
      }
      const expectedRefs = Array.isArray(input.expectedHeadRefs) ? input.expectedHeadRefs : [];
      const expectedIds = [...new Set(expectedRefs.map((item) => item.experimentId).filter(Boolean))];
      const currentHeadsResult = expectedIds.length
        ? await client.query(
          `select * from experiment_snapshot_heads
           where project_id = $1 and experiment_id = any($2::text[])
           for share`,
          [input.projectId, expectedIds],
        )
        : { rows: [] };
      const currentHeads = currentHeadsResult.rows.map(experimentSnapshotHeadFromRow);
      const headMismatches = expectedRefs.flatMap((expected) => {
        const current = currentHeads.find((head) => head.experimentId === expected.experimentId);
        return (
          current
          && current.id === expected.headId
          && current.dataSnapshotId === expected.dataSnapshotId
          && Number(current.recordIndex) === Number(expected.recordIndex)
        ) ? [] : [{ experimentId: expected.experimentId, expected, current: current || null }];
      });
      if (headMismatches.length) {
        throw Object.assign(new Error("Accepted experiment snapshots changed before publication."), {
          statusCode: 409,
          code: "analysis_result_stale",
          details: { headMismatches },
        });
      }

      for (const identity of input.experimentIdentities || []) {
        const existing = await client.query(
          "select project_id from experiment_identities where id = $1",
          [identity.id],
        );
        if (existing.rows[0] && existing.rows[0].project_id !== input.projectId) {
          throw Object.assign(new Error("Experiment identity belongs to another project."), {
            statusCode: 422,
            code: "identity_reuse_not_found",
          });
        }
        await client.query(
          `insert into experiment_identities
           (id, lab_id, project_id, canonical_label, normalized_label, aliases,
            created_at, updated_at, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (id) do update
           set aliases = excluded.aliases,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`,
          [
            identity.id,
            identity.labId,
            identity.projectId,
            identity.canonicalLabel,
            identity.normalizedLabel,
            jsonb(identity.aliases || [], []),
            identity.createdAt,
            identity.updatedAt,
            identity.createdBy,
            identity.updatedBy,
          ],
        );
      }
      await client.query(
        `insert into data_snapshots
         (id, lab_id, project_id, data_plan_id, analysis_plan_revision_id,
          analysis_run_id, analysis_result_id, schema_version, status, output_shape,
          content_hash, dependency_hash, snapshot, experiment_records, source_refs,
          summary, warnings, accepted_at, accepted_by, created_at, created_by)
         values
         ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20)`,
        [
          snapshot.id,
          snapshot.labId,
          snapshot.projectId,
          snapshot.analysisPlanRevisionId,
          snapshot.analysisRunId,
          snapshot.analysisResultId,
          snapshot.schemaVersion,
          snapshot.status,
          snapshot.outputShape,
          snapshot.contentHash,
          snapshot.dependencyHash,
          jsonb(snapshot.snapshot || {}),
          jsonb(snapshot.experimentRecords || [], []),
          jsonb(snapshot.sourceRefs || [], []),
          jsonb(snapshot.summary || {}),
          jsonb(snapshot.warnings || [], []),
          snapshot.acceptedAt,
          snapshot.acceptedBy,
          snapshot.createdAt,
          snapshot.createdBy,
        ],
      );
      for (const head of heads) {
        await client.query(
          `insert into experiment_snapshot_heads
           (id, lab_id, project_id, experiment_id, data_snapshot_id, record_index,
            updated_at, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (project_id, experiment_id) do update
           set data_snapshot_id = excluded.data_snapshot_id,
               record_index = excluded.record_index,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`,
          [
            head.id,
            head.labId,
            head.projectId,
            head.experimentId,
            head.dataSnapshotId,
            head.recordIndex,
            head.updatedAt,
            head.updatedBy,
          ],
        );
      }
      if (browserView.isDefault) {
        await client.query(
          `update browser_views
           set is_default = false, updated_at = $3
           where project_id = $1 and owner_user_id = $2 and is_default = true`,
          [input.projectId, browserView.ownerUserId, browserView.createdAt],
        );
      }
      await client.query(
        `insert into browser_views
         (id, lab_id, project_id, owner_user_id, schema_version, name, payload,
          is_default, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          browserView.id,
          browserView.labId,
          browserView.projectId,
          browserView.ownerUserId,
          browserView.schemaVersion,
          browserView.name,
          jsonb(browserView.payload || {}),
          browserView.isDefault,
          browserView.createdAt,
          browserView.updatedAt,
        ],
      );
      await client.query(
        `update analysis_results
         set status = 'accepted', accepted_at = $2, accepted_by = $3,
             updated_at = $2, updated_by = $3
         where id = $1`,
        [storedResult.id, input.analysisResult.acceptedAt, input.actorUserId],
      );
      await client.query(
        `update analysis_runs
         set status = 'completed', updated_at = $2, updated_by = $3
         where id = $1`,
        [run.id, input.analysisRun.updatedAt, input.actorUserId],
      );
      await client.query(
        `update analysis_threads
         set status = 'completed',
             accepted_analysis_result_ids = $2,
             data_snapshot_ids = $3,
             browser_view_ids = $4,
             updated_at = $5,
             updated_by = $6
         where id = $1`,
        [
          thread.id,
          jsonb(input.analysisThread.acceptedAnalysisResultIds || [], []),
          jsonb(input.analysisThread.dataSnapshotIds || [], []),
          jsonb(input.analysisThread.browserViewIds || [], []),
          input.analysisThread.updatedAt,
          input.actorUserId,
        ],
      );
      await insertAuditEventRows(client, input.auditEvents || []);
      const response = { ...input.response, idempotentReplay: false };
      await client.query(
        `insert into analysis_experiment_publications
         (id, lab_id, project_id, analysis_thread_id, analysis_result_id,
          data_snapshot_id, browser_view_id, idempotency_key, request_hash,
          response, created_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          input.publicationId,
          input.labId,
          input.projectId,
          thread.id,
          storedResult.id,
          snapshot.id,
          browserView.id,
          input.idempotencyKey,
          input.requestHash,
          jsonb(response),
          snapshot.createdAt,
          input.actorUserId,
        ],
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createChartSpec(input) {
    const result = await this.query(
      `insert into chart_specs
       (id, lab_id, project_id, analysis_result_id, title, chart_type, spec, layout, warnings, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10, $10)
       returning *`,
      [
        makeId("chart_spec"),
        input.labId,
        input.projectId,
        input.analysisResultId || null,
        input.title || null,
        input.chartType,
        jsonb(input.spec || {}),
        jsonb(input.layout || {}),
        jsonb(input.warnings || [], []),
        input.createdBy,
      ],
    );
    return chartSpecFromRow(result.rows[0]);
  }

  async findChartSpecById(id) {
    const result = await this.query("select * from chart_specs where id = $1", [id]);
    return chartSpecFromRow(result.rows[0]);
  }

  async listChartSpecs({ projectId }) {
    const result = await this.query("select * from chart_specs where project_id = $1 order by updated_at desc", [projectId]);
    return result.rows.map(chartSpecFromRow);
  }

  async createChartStyleProfile({ profile, version }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const profileResult = await client.query(
        `insert into chart_style_profiles
         (id, lab_id, project_id, schema_version, name, description, status,
          current_version_id, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, null, $8, $8, $9, $9)
         returning *`,
        [profile.id, profile.labId, profile.projectId, profile.schemaVersion, profile.name, profile.description || "", profile.status || "active", profile.createdAt, profile.createdBy],
      );
      const versionResult = await client.query(
        `insert into chart_style_profile_versions
         (id, lab_id, project_id, chart_style_profile_id, schema_version, version,
          status, payload, content_hash, created_at, created_by, accepted_at, accepted_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         returning *`,
        [version.id, version.labId, version.projectId, version.chartStyleProfileId, version.schemaVersion, version.version, version.status, jsonb(chartStyleProfileVersionPayload(version)), version.contentHash, version.createdAt, version.createdBy, version.acceptedAt, version.acceptedBy],
      );
      const updatedResult = await client.query(
        "update chart_style_profiles set current_version_id = $2 where id = $1 returning *",
        [profile.id, version.id],
      );
      await client.query("commit");
      return { profile: chartStyleProfileFromRow(updatedResult.rows[0] || profileResult.rows[0]), version: chartStyleProfileVersionFromRow(versionResult.rows[0]) };
    } catch (error) {
      await client.query("rollback");
      if (error?.code === "23505") throw Object.assign(new Error("A chart style profile or version with this name/content already exists."), { code: "chart_style_profile_name_conflict", statusCode: 409 });
      throw error;
    } finally {
      client.release();
    }
  }

  async findChartStyleProfileById(id) {
    const result = await this.query("select * from chart_style_profiles where id = $1", [id]);
    return chartStyleProfileFromRow(result.rows[0]);
  }

  async findChartStyleProfileVersionById(id) {
    const result = await this.query("select * from chart_style_profile_versions where id = $1", [id]);
    return chartStyleProfileVersionFromRow(result.rows[0]);
  }

  async listChartStyleProfiles({ projectId, includeArchived = false }) {
    const result = await this.query(
      `select * from chart_style_profiles
       where project_id = $1 and ($2::boolean or status <> 'archived')
       order by updated_at desc, id`,
      [projectId, includeArchived],
    );
    return result.rows.map(chartStyleProfileFromRow);
  }

  async listChartStyleProfileVersions({ chartStyleProfileId }) {
    const result = await this.query(
      "select * from chart_style_profile_versions where chart_style_profile_id = $1 order by version desc",
      [chartStyleProfileId],
    );
    return result.rows.map(chartStyleProfileVersionFromRow);
  }

  async appendChartStyleProfileVersion({ profileId, version, actorUserId, updatedAt }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const profileResult = await client.query("select * from chart_style_profiles where id = $1 for update", [profileId]);
      if (!profileResult.rows[0]) {
        await client.query("rollback");
        return null;
      }
      const versionResult = await client.query(
        `insert into chart_style_profile_versions
         (id, lab_id, project_id, chart_style_profile_id, schema_version, version,
          status, payload, content_hash, created_at, created_by, accepted_at, accepted_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         returning *`,
        [version.id, version.labId, version.projectId, version.chartStyleProfileId, version.schemaVersion, version.version, version.status, jsonb(chartStyleProfileVersionPayload(version)), version.contentHash, version.createdAt, version.createdBy, version.acceptedAt, version.acceptedBy],
      );
      const updatedResult = await client.query(
        "update chart_style_profiles set current_version_id = $2, updated_at = $3, updated_by = $4 where id = $1 returning *",
        [profileId, version.id, updatedAt, actorUserId],
      );
      await client.query("commit");
      return { profile: chartStyleProfileFromRow(updatedResult.rows[0]), version: chartStyleProfileVersionFromRow(versionResult.rows[0]) };
    } catch (error) {
      await client.query("rollback");
      if (error?.code === "23505") throw Object.assign(new Error("This chart style version already exists."), { code: "chart_style_profile_version_conflict", statusCode: 409 });
      throw error;
    } finally {
      client.release();
    }
  }

  async archiveChartStyleProfile({ profileId, actorUserId, updatedAt }) {
    const result = await this.query(
      "update chart_style_profiles set status = 'archived', updated_at = $2, updated_by = $3 where id = $1 returning *",
      [profileId, updatedAt, actorUserId],
    );
    return chartStyleProfileFromRow(result.rows[0]);
  }

  async createReusableChartTemplate({ template, version }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const templateResult = await client.query(
        `insert into reusable_chart_templates
         (id, lab_id, project_id, schema_version, name, description, status,
          current_version_id, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, null, $8, $8, $9, $9)
         returning *`,
        [template.id, template.labId, template.projectId, template.schemaVersion, template.name, template.description || "", template.status || "active", template.createdAt, template.createdBy],
      );
      const versionResult = await client.query(
        `insert into reusable_chart_template_versions
         (id, lab_id, project_id, reusable_chart_template_id, schema_version,
          version, status, source_chart_spec_id, chart_style_profile_version_id,
          payload, content_hash, created_at, created_by, accepted_at, accepted_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning *`,
        [version.id, version.labId, version.projectId, version.reusableChartTemplateId, version.schemaVersion, version.version, version.status, version.sourceChartSpecId, version.chartStyleProfileVersionId, jsonb(reusableChartTemplateVersionPayload(version)), version.contentHash, version.createdAt, version.createdBy, version.acceptedAt, version.acceptedBy],
      );
      const updatedResult = await client.query(
        "update reusable_chart_templates set current_version_id = $2 where id = $1 returning *",
        [template.id, version.id],
      );
      await client.query("commit");
      return { template: reusableChartTemplateFromRow(updatedResult.rows[0] || templateResult.rows[0]), version: reusableChartTemplateVersionFromRow(versionResult.rows[0]) };
    } catch (error) {
      await client.query("rollback");
      if (error?.code === "23505") throw Object.assign(new Error("A reusable chart template or version with this name/content already exists."), { code: "reusable_chart_template_name_conflict", statusCode: 409 });
      throw error;
    } finally {
      client.release();
    }
  }

  async findReusableChartTemplateById(id) {
    const result = await this.query("select * from reusable_chart_templates where id = $1", [id]);
    return reusableChartTemplateFromRow(result.rows[0]);
  }

  async findReusableChartTemplateVersionById(id) {
    const result = await this.query("select * from reusable_chart_template_versions where id = $1", [id]);
    return reusableChartTemplateVersionFromRow(result.rows[0]);
  }

  async listReusableChartTemplates({ projectId, includeArchived = false }) {
    const result = await this.query(
      `select * from reusable_chart_templates
       where project_id = $1 and ($2::boolean or status <> 'archived')
       order by updated_at desc, id`,
      [projectId, includeArchived],
    );
    return result.rows.map(reusableChartTemplateFromRow);
  }

  async listReusableChartTemplateVersions({ reusableChartTemplateId }) {
    const result = await this.query(
      "select * from reusable_chart_template_versions where reusable_chart_template_id = $1 order by version desc",
      [reusableChartTemplateId],
    );
    return result.rows.map(reusableChartTemplateVersionFromRow);
  }

  async appendReusableChartTemplateVersion({ templateId, version, actorUserId, updatedAt }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const templateResult = await client.query("select * from reusable_chart_templates where id = $1 for update", [templateId]);
      if (!templateResult.rows[0]) {
        await client.query("rollback");
        return null;
      }
      const versionResult = await client.query(
        `insert into reusable_chart_template_versions
         (id, lab_id, project_id, reusable_chart_template_id, schema_version,
          version, status, source_chart_spec_id, chart_style_profile_version_id,
          payload, content_hash, created_at, created_by, accepted_at, accepted_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning *`,
        [version.id, version.labId, version.projectId, version.reusableChartTemplateId, version.schemaVersion, version.version, version.status, version.sourceChartSpecId, version.chartStyleProfileVersionId, jsonb(reusableChartTemplateVersionPayload(version)), version.contentHash, version.createdAt, version.createdBy, version.acceptedAt, version.acceptedBy],
      );
      const updatedResult = await client.query(
        "update reusable_chart_templates set current_version_id = $2, updated_at = $3, updated_by = $4 where id = $1 returning *",
        [templateId, version.id, updatedAt, actorUserId],
      );
      await client.query("commit");
      return { template: reusableChartTemplateFromRow(updatedResult.rows[0]), version: reusableChartTemplateVersionFromRow(versionResult.rows[0]) };
    } catch (error) {
      await client.query("rollback");
      if (error?.code === "23505") throw Object.assign(new Error("This reusable chart template version already exists."), { code: "reusable_chart_template_version_conflict", statusCode: 409 });
      throw error;
    } finally {
      client.release();
    }
  }

  async archiveReusableChartTemplate({ templateId, actorUserId, updatedAt }) {
    const result = await this.query(
      "update reusable_chart_templates set status = 'archived', updated_at = $2, updated_by = $3 where id = $1 returning *",
      [templateId, updatedAt, actorUserId],
    );
    return reusableChartTemplateFromRow(result.rows[0]);
  }

  async listReusableChartTemplateSlotBindings({ reusableChartTemplateVersionId, status = null }) {
    const result = await this.query(
      `select * from reusable_chart_template_slot_bindings
       where reusable_chart_template_version_id = $1 and ($2::text is null or status = $2)
       order by created_at desc, id`,
      [reusableChartTemplateVersionId, status],
    );
    return result.rows.map(reusableChartTemplateSlotBindingFromRow);
  }

  async findReusableChartTemplateApplicationById(id) {
    const result = await this.query("select * from reusable_chart_template_applications where id = $1", [id]);
    return reusableChartTemplateApplicationFromRow(result.rows[0]);
  }

  async findReusableChartTemplateApplicationByIdempotencyKey({ projectId, idempotencyKey }) {
    const result = await this.query(
      "select * from reusable_chart_template_applications where project_id = $1 and idempotency_key = $2",
      [projectId, idempotencyKey],
    );
    return reusableChartTemplateApplicationFromRow(result.rows[0]);
  }

  async createReusableChartTemplateApplication(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [input.application.projectId, input.application.idempotencyKey]);
      const priorResult = await client.query(
        "select * from reusable_chart_template_applications where project_id = $1 and idempotency_key = $2",
        [input.application.projectId, input.application.idempotencyKey],
      );
      const prior = reusableChartTemplateApplicationFromRow(priorResult.rows[0]);
      if (prior) {
        if (prior.requestHash !== input.application.requestHash) {
          throw Object.assign(new Error("This idempotency key was already used for different template inputs."), {
            code: "chart_template_idempotency_conflict",
            statusCode: 409,
          });
        }
        const [threadResult, revisionResult, runResult] = await Promise.all([
          prior.analysisThreadId ? client.query("select * from analysis_threads where id = $1", [prior.analysisThreadId]) : { rows: [] },
          prior.analysisPlanRevisionId ? client.query("select * from analysis_plan_revisions where id = $1", [prior.analysisPlanRevisionId]) : { rows: [] },
          prior.analysisRunId ? client.query("select * from analysis_runs where id = $1", [prior.analysisRunId]) : { rows: [] },
        ]);
        await client.query("commit");
        return {
          application: prior,
          analysisThread: analysisThreadFromRow(threadResult.rows[0]),
          analysisPlanRevision: analysisPlanRevisionFromRow(revisionResult.rows[0]),
          analysisRun: analysisRunFromRow(runResult.rows[0]),
          replayed: true,
        };
      }
      for (const binding of input.slotBindings || []) {
        await client.query(
          `update reusable_chart_template_slot_bindings set status = 'superseded'
           where reusable_chart_template_version_id = $1 and slot_id = $2 and status = 'active'`,
          [binding.reusableChartTemplateVersionId, binding.slotId],
        );
        await client.query(
          `insert into reusable_chart_template_slot_bindings
           (id, lab_id, project_id, reusable_chart_template_version_id, schema_version,
            slot_id, column_id, value_type, unit, source_signature, status, created_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [binding.id, binding.labId, binding.projectId, binding.reusableChartTemplateVersionId, binding.schemaVersion, binding.slotId, binding.columnId, binding.valueType, binding.unit, binding.sourceSignature, binding.status, binding.createdAt, binding.createdBy],
        );
      }
      let analysisThread = null;
      let analysisPlanRevision = null;
      let analysisRun = null;
      if (input.analysisThread) {
        const threadResult = await client.query(
          `insert into analysis_threads
           (id, lab_id, project_id, schema_version, status, original_request, messages,
            plan_revision_ids, analysis_run_ids, accepted_analysis_result_ids, chart_spec_ids,
            output_target, data_snapshot_ids, browser_view_ids, created_at, updated_at, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
           returning *`,
          [input.analysisThread.id, input.analysisThread.labId, input.analysisThread.projectId, input.analysisThread.schemaVersion, input.analysisThread.status, input.analysisThread.originalRequest, jsonb(input.analysisThread.messages, []), jsonb(input.analysisThread.planRevisionIds, []), jsonb(input.analysisThread.analysisRunIds, []), jsonb(input.analysisThread.acceptedAnalysisResultIds, []), jsonb(input.analysisThread.chartSpecIds, []), input.analysisThread.outputTarget, jsonb(input.analysisThread.dataSnapshotIds, []), jsonb(input.analysisThread.browserViewIds, []), input.analysisThread.createdAt, input.analysisThread.updatedAt, input.analysisThread.createdBy, input.analysisThread.updatedBy],
        );
        analysisThread = analysisThreadFromRow(threadResult.rows[0]);
        analysisPlanRevision = await insertAnalysisPlanRevisionRow(client, input.analysisPlanRevision);
        analysisRun = await insertAnalysisRunRow(client, input.analysisRun);
      }
      const applicationResult = await client.query(
        `insert into reusable_chart_template_applications
         (id, lab_id, project_id, reusable_chart_template_version_id, schema_version,
          status, idempotency_key, request_hash, experiment_ids, frozen_head_refs,
          bindings, compatibility, analysis_thread_id, analysis_plan_revision_id,
          analysis_run_id, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         returning *`,
        [input.application.id, input.application.labId, input.application.projectId, input.application.reusableChartTemplateVersionId, input.application.schemaVersion, input.application.status, input.application.idempotencyKey, input.application.requestHash, jsonb(input.application.experimentIds, []), jsonb(input.application.frozenHeadRefs, []), jsonb(input.application.bindings, []), jsonb(input.application.compatibility), input.application.analysisThreadId, input.application.analysisPlanRevisionId, input.application.analysisRunId, input.application.createdAt, input.application.updatedAt, input.application.createdBy, input.application.updatedBy],
      );
      await insertAuditEventRows(client, input.auditEvents || []);
      await client.query("commit");
      return { application: reusableChartTemplateApplicationFromRow(applicationResult.rows[0]), analysisThread, analysisPlanRevision, analysisRun, replayed: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateReusableChartTemplateApplication(id, changes) {
    const result = await this.query(
      `update reusable_chart_template_applications
       set status = coalesce($2, status), updated_at = coalesce($3, updated_at), updated_by = coalesce($4, updated_by)
       where id = $1 returning *`,
      [id, changes.status || null, changes.updatedAt || null, changes.updatedBy || null],
    );
    return reusableChartTemplateApplicationFromRow(result.rows[0]);
  }

  async listManuscripts({ projectId }) {
    const result = await this.query("select * from manuscripts where project_id = $1 order by updated_at desc", [projectId]);
    return result.rows.map(manuscriptFromRow);
  }

  async createManuscript(input) {
    const result = await this.query(
      `insert into manuscripts
       (id, lab_id, project_id, title, status, blocks, pages, canvas_state, references_payload, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, coalesce($5, 'draft'), $6, $7, $8, $9, now(), now(), $10, $10)
       returning *`,
      [
        makeId("manuscript"),
        input.labId,
        input.projectId,
        input.title,
        input.status || "draft",
        jsonb(input.blocks || [], []),
        jsonb(input.pages || [], []),
        jsonb(input.canvasState || {}),
        jsonb(input.references || [], []),
        input.createdBy,
      ],
    );
    return manuscriptFromRow(result.rows[0]);
  }

  async findManuscriptById(id) {
    const result = await this.query("select * from manuscripts where id = $1", [id]);
    return manuscriptFromRow(result.rows[0]);
  }

  async updateManuscript(id, changes) {
    const current = await this.findManuscriptById(id);
    if (!current) return null;
    const result = await this.query(
      `update manuscripts
       set title = coalesce($2, title),
           blocks = $3,
           pages = $4,
           canvas_state = $5,
           references_payload = $6,
           updated_by = coalesce($7, updated_by),
           updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        changes.title ?? null,
        jsonb(changes.blocks ?? current.blocks ?? [], []),
        jsonb(changes.pages ?? current.pages ?? [], []),
        jsonb(changes.canvasState ?? current.canvasState ?? {}),
        jsonb(changes.references ?? current.references ?? [], []),
        changes.updatedBy || null,
      ],
    );
    return manuscriptFromRow(result.rows[0]);
  }

  async recordAuditEvent(input) {
    const result = await this.query(
      `insert into audit_events
       (id, lab_id, project_id, actor_user_id, action, target_type, target_id, summary, metadata, created_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11)
       returning *`,
      [
        makeId("audit"),
        input.labId || null,
        input.projectId || null,
        input.actorUserId || null,
        input.action,
        input.targetType || null,
        input.targetId || null,
        input.summary || null,
        jsonb(input.metadata || {}),
        input.ipAddress || null,
        input.userAgent || null,
      ],
    );
    return result.rows[0];
  }

  async listAuditEvents(filter = {}) {
    const clauses = [];
    const params = [];
    if (filter.labId) {
      params.push(filter.labId);
      clauses.push(`lab_id = $${params.length}`);
    }
    if (filter.projectId) {
      params.push(filter.projectId);
      clauses.push(`project_id = $${params.length}`);
    }
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const result = await this.query(
      `select * from audit_events ${where} order by created_at desc`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      labId: row.lab_id,
      projectId: row.project_id,
      actorUserId: row.actor_user_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      summary: row.summary,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    }));
  }
}
