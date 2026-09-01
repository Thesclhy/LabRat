import { decodeRange, encodeRange } from "../import/utils/excelAddress.js";
import { sha256Hex } from "./ids.js";
import { readSourceDocumentRange, SOURCE_RANGE_MAX_CELLS } from "./sourceDocuments.js";
import { buildWorkbookUnderstandingPreview } from "./workbookUnderstandingPreview.js";

const SUPPORTED_SEMANTIC_TYPES = new Set([
  "experiment_table",
  "reaction_rate_time_series",
  "component_distribution",
  "calculation_table",
  "metadata_notes",
  "generic_table",
  "ignored_region",
  "unknown_region",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function fail(code, message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  throw error;
}

function canonicalRange(value) {
  try {
    return encodeRange(decodeRange(text(value)));
  } catch {
    fail("invalid_source_range", "range must be a valid Excel range such as A1:D20.");
  }
}

function sheetFor(sourceDocument, sheetName) {
  const normalized = text(sheetName);
  const sheet = asArray(sourceDocument?.metadata?.sheets).find((candidate) => text(candidate?.name) === normalized);
  if (!sheet) fail("source_sheet_not_found", `Sheet ${normalized || "(blank)"} was not found for this workbook.`, 404);
  return sheet;
}

function assertOwnership({ session, sourceDocument }) {
  if (!session?.id || !sourceDocument?.id || session.sourceDocumentId !== sourceDocument.id) {
    fail("source_document_mismatch", "Workbook review region must belong to the session SourceDocument.", 409);
  }
}

function assertRegionVersion(region, expectedRegionVersion) {
  const expected = Number(expectedRegionVersion);
  const actual = Number(region?.version);
  if (!Number.isInteger(expected) || expected !== actual) {
    fail("stale_workbook_review_region", "Workbook review region changed; reload before submitting this action.", 409, {
      expectedRegionVersion: Number.isFinite(expected) ? expected : null,
      currentRegionVersion: actual || null,
    });
  }
}

function summarySentences(value) {
  const sentences = asArray(value).map(text).filter(Boolean).slice(0, 4);
  if (sentences.length < 2) {
    fail("region_model_summary_invalid", "Region interpretation must contain two to four short summary sentences.", 422);
  }
  return sentences.map((sentence) => sentence.slice(0, 500));
}

function identityEvidenceFor({ sourceDocument, indexBlobs, region, interpretation }) {
  const source = cleanObject(interpretation);
  if (source.experimentAxis !== "rows") return null;
  const column = text(source.experimentIdColumn).toUpperCase();
  const inclusion = cleanObject(source.inclusion);
  const startRow = Number(inclusion.startRow);
  const endRow = Number(inclusion.endRow);
  if (!/^[A-Z]+$/.test(column) || !Number.isInteger(startRow) || !Number.isInteger(endRow) || endRow < startRow) {
    return null;
  }
  const range = `${column}${startRow}:${column}${endRow}`;
  const candidateRowCount = endRow - startRow + 1;
  if (candidateRowCount > SOURCE_RANGE_MAX_CELLS) {
    return { column, range, complete: false, candidateRowCount };
  }
  try {
    const result = readSourceDocumentRange({
      sourceDocument,
      indexBlobs,
      sheetName: region.sheetName,
      range,
      maxCells: SOURCE_RANGE_MAX_CELLS,
    });
    const identifiers = asArray(result.cells).map((cell) => text(cell?.rawValue ?? cell?.formattedValue)).filter(Boolean);
    return {
      column,
      range,
      complete: true,
      candidateRowCount,
      identifiedRowCount: identifiers.length,
      firstIdentifier: identifiers[0] || null,
      lastIdentifier: identifiers[identifiers.length - 1] || null,
    };
  } catch {
    return null;
  }
}

function claimsUnsampledScope(sentence) {
  const value = text(sentence);
  return /\bexp(?:eriment)?[\s_-]*0*\d+\b/i.test(value)
    || /\b\d+\s+(?:identified\s+)?experiments?\b/i.test(value)
    || /continuing beyond|visible rows?/i.test(value)
    || /\b\d+(?:\.\d+)?\s*(?:-|\u2013|\u2014|to)\s*\d+(?:\.\d+)?\b/i.test(value);
}

function groundedSummary({ modelSummary, identityEvidence, interpretation }) {
  const modelSentences = summarySentences(modelSummary);
  if (!identityEvidence?.complete || !identityEvidence.identifiedRowCount) return modelSentences;
  const count = identityEvidence.identifiedRowCount;
  const first = identityEvidence.firstIdentifier;
  const last = identityEvidence.lastIdentifier;
  const identitySentence = first && last
    ? `The selected region contains ${count} identified experiment row${count === 1 ? "" : "s"}; the first identifier is ${first} and the last is ${last}.`
    : `The selected region contains ${count} identified experiment row${count === 1 ? "" : "s"}.`;
  const fieldCount = asArray(interpretation?.fields).length;
  const structureSentence = `Column ${identityEvidence.column} contains experiment identifiers, with ${fieldCount} interpreted data field${fieldCount === 1 ? "" : "s"} in the selected table.`;
  return [
    identitySentence,
    structureSentence,
    ...modelSentences.filter((sentence) => !claimsUnsampledScope(sentence)),
  ].slice(0, 4);
}

function semanticType(value, fallback = "generic_table") {
  const normalized = text(value);
  return SUPPORTED_SEMANTIC_TYPES.has(normalized) ? normalized : fallback;
}

function workbookManifest(sourceDocument) {
  return {
    workbookName: text(sourceDocument?.metadata?.workbookName || sourceDocument?.metadata?.fileName || sourceDocument?.id),
    sheets: asArray(sourceDocument?.metadata?.sheets).slice(0, 100).map((sheet) => ({
      name: text(sheet?.name),
      usedRange: text(sheet?.usedRange) || null,
      rowCount: Number(sheet?.rowCount) || 0,
      columnCount: Number(sheet?.columnCount) || 0,
    })),
  };
}

function sourceRefsFor(previewRegion) {
  const interpretation = cleanObject(previewRegion?.interpretation);
  const refs = [
    previewRegion?.sourceRange?.sourceRef,
    ...asArray(interpretation.fields).flatMap((field) => asArray(field?.sourceRefs)),
    ...asArray(interpretation.series).flatMap((series) => asArray(series?.sourceRefs)),
  ].filter(Boolean);
  const seen = new Set();
  return refs.filter((ref) => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function currentRegion(store, region) {
  const loaded = await store.findWorkbookReviewRegionById(region?.id);
  if (!loaded) fail("workbook_review_region_not_found", "Workbook review region was not found.", 404);
  return loaded;
}

async function draftRevision({
  store,
  region,
  sourceDocument,
  indexBlobs,
  modelProvider,
  actorUserId,
  trigger,
  userFeedback,
  priorRevision,
  initialSemanticType,
}) {
  const draftRegion = {
    draftRegionId: region.id,
    sourceDocumentId: region.sourceDocumentId,
    sheetName: region.sheetName,
    range: region.rangeRef,
    semanticType: semanticType(initialSemanticType),
    description: text(userFeedback),
  };
  const baseline = buildWorkbookUnderstandingPreview({
    sourceDocument,
    indexBlobs,
    draftRegions: [draftRegion],
  });
  const baselineRegion = baseline.regions[0];
  const baselineIdentityEvidence = identityEvidenceFor({
    sourceDocument,
    indexBlobs,
    region,
    interpretation: baselineRegion.interpretation,
  });
  const otherRegions = (await store.listWorkbookReviewRegions({
    workbookReviewSessionId: region.workbookReviewSessionId,
    includeDeleted: false,
  })).filter((candidate) => candidate.id !== region.id).slice(0, 40).map((candidate) => ({
    id: candidate.id,
    sheetName: candidate.sheetName,
    range: candidate.rangeRef,
    reviewStatus: candidate.reviewStatus,
    disposition: candidate.disposition,
  }));
  const modelResult = typeof modelProvider?.interpretWorkbookRegion === "function"
    ? await modelProvider.interpretWorkbookRegion({
      workbook: workbookManifest(sourceDocument),
      region: {
        id: region.id,
        sheetName: region.sheetName,
        range: region.rangeRef,
        inspection: baselineRegion.inspection,
        deterministicCandidate: baselineRegion.interpretation,
        ...(baselineIdentityEvidence ? { identityEvidence: baselineIdentityEvidence } : {}),
      },
      otherRegions,
      priorInterpretation: priorRevision?.interpretation || null,
      userFeedback: text(userFeedback),
    })
    : {
      ok: false,
      warning: { code: "ai_unavailable", message: "Backend workbook-region model provider is unavailable." },
    };
  const latestRegion = await currentRegion(store, region);
  if (latestRegion.disposition !== "active" || Number(latestRegion.version) !== Number(region.version)) {
    return { region: latestRegion, revision: null, warning: null, cancelled: true };
  }
  if (!modelResult?.ok) {
    const warning = modelResult?.warning || { code: "ai_unavailable", message: "Backend workbook-region model provider is unavailable." };
    const failedRegion = await store.updateWorkbookReviewRegion(region.id, {
      expectedVersion: region.version,
      reviewStatus: "interpretation_failed",
      warnings: [warning],
      updatedBy: actorUserId,
    });
    return { region: failedRegion, revision: null, warning };
  }

  let finalPreview;
  let finalSemanticType = draftRegion.semanticType;
  try {
    const modelInterpretation = cleanObject(modelResult.interpretation);
    finalSemanticType = semanticType(modelInterpretation.semanticType, draftRegion.semanticType);
    const finalDraftRegion = {
      ...draftRegion,
      semanticType: finalSemanticType,
    };
    finalPreview = buildWorkbookUnderstandingPreview({
      sourceDocument,
      indexBlobs,
      draftRegions: [finalDraftRegion],
      interpretationPatches: [{
        ...modelInterpretation,
        draftRegionId: region.id,
        decisionSource: "backend_model",
      }],
    });
  } catch (error) {
    const warning = {
      code: error?.code || "region_model_interpretation_invalid",
      message: error?.message || "Backend model returned an invalid workbook-region interpretation.",
    };
    const failedRegion = await store.updateWorkbookReviewRegion(region.id, {
      expectedVersion: region.version,
      reviewStatus: "interpretation_failed",
      warnings: [warning],
      updatedBy: actorUserId,
    });
    return { region: failedRegion, revision: null, warning };
  }

  const previewRegion = finalPreview.regions[0];
  const revisions = await store.listRegionUnderstandingRevisions({ regionId: region.id });
  const revisionNumber = revisions.length
    ? Math.max(...revisions.map((revision) => Number(revision.revisionNumber) || 0)) + 1
    : 1;
  const identityEvidence = identityEvidenceFor({
    sourceDocument,
    indexBlobs,
    region,
    interpretation: previewRegion.interpretation,
  });
  const summary = groundedSummary({
    modelSummary: modelResult.summary,
    identityEvidence,
    interpretation: previewRegion.interpretation,
  });
  const sourceRefs = sourceRefsFor(previewRegion);
  const sourceContentHash = sha256Hex(JSON.stringify({
    sourceDocumentId: sourceDocument.id,
    sheetName: region.sheetName,
    range: region.rangeRef,
    inspection: previewRegion.inspection,
    identityEvidence,
  }));
  const dependencyHash = sha256Hex(JSON.stringify({
    regionId: region.id,
    revisionNumber,
    sourceContentHash,
    interpretation: { semanticType: finalSemanticType, ...previewRegion.interpretation },
  }));
  const validation = {
    status: finalPreview.blockers.length ? "blocked" : "ready",
    blockers: finalPreview.blockers,
  };
  const revision = await store.createRegionUnderstandingRevision({
    labId: region.labId,
    projectId: region.projectId,
    workbookReviewSessionId: region.workbookReviewSessionId,
    sourceDocumentId: region.sourceDocumentId,
    regionId: region.id,
    revisionNumber,
    trigger,
    userFeedback: text(userFeedback),
    summary,
    interpretation: { semanticType: finalSemanticType, ...previewRegion.interpretation },
    sourceRefs,
    sourceContentHash,
    dependencyHash,
    validation,
    provider: modelResult.metadata || {},
    warnings: finalPreview.warnings,
    confidence: Number(previewRegion.interpretation?.confidence) || null,
    createdBy: actorUserId,
  });
  const updatedRegion = await store.updateWorkbookReviewRegion(region.id, {
    expectedVersion: region.version,
    reviewStatus: "awaiting_review",
    currentRevisionId: revision.id,
    warnings: finalPreview.warnings,
    updatedBy: actorUserId,
  });
  return { region: updatedRegion, revision, warning: null };
}

export async function createWorkbookReviewRegionRecord({
  store,
  session,
  sourceDocument,
  input = {},
  actorUserId = null,
} = {}) {
  assertOwnership({ session, sourceDocument });
  const sheet = sheetFor(sourceDocument, input.sheetName);
  const rangeRef = canonicalRange(input.range || input.rangeRef);
  return store.createWorkbookReviewRegion({
    labId: session.labId,
    projectId: session.projectId,
    workbookReviewSessionId: session.id,
    sourceDocumentId: sourceDocument.id,
    sourceRegionId: text(input.sourceRegionId) || null,
    sheetName: sheet.name,
    rangeRef,
    selectionMethod: text(input.selectionMethod) || "manual",
    interpretationHint: {
      semanticType: semanticType(input.semanticType),
      description: text(input.description).slice(0, 2000),
    },
    disposition: "active",
    reviewStatus: "interpreting",
    warnings: [],
    createdBy: actorUserId,
  });
}

export async function interpretWorkbookReviewRegion({
  store,
  region,
  sourceDocument,
  indexBlobs = [],
  input = {},
  modelProvider,
  actorUserId = null,
} = {}) {
  const loaded = await currentRegion(store, region);
  assertRegionVersion(loaded, input.expectedRegionVersion);
  if (loaded.sourceDocumentId !== sourceDocument?.id) {
    fail("source_document_mismatch", "Workbook review region must belong to the session SourceDocument.", 409);
  }
  if (loaded.disposition !== "active") {
    fail("workbook_review_region_inactive", "Only an active workbook review region can be interpreted.", 409);
  }
  if (!["interpreting", "interpretation_failed"].includes(loaded.reviewStatus)) {
    fail("workbook_review_region_not_pending", "This workbook review region already has an interpretation.", 409);
  }
  const priorRevision = loaded.currentRevisionId
    ? await store.findRegionUnderstandingRevisionById(loaded.currentRevisionId)
    : null;
  const interpretationHint = cleanObject(loaded.interpretationHint);
  return draftRevision({
    store,
    region: loaded,
    sourceDocument,
    indexBlobs,
    modelProvider,
    actorUserId,
    trigger: priorRevision ? "retry" : "initial",
    userFeedback: text(input.description) || text(interpretationHint.description),
    priorRevision,
    initialSemanticType: input.semanticType
      || interpretationHint.semanticType
      || priorRevision?.interpretation?.semanticType
      || "generic_table",
  });
}

export async function createWorkbookReviewRegionDraft({
  store,
  session,
  sourceDocument,
  indexBlobs = [],
  input = {},
  modelProvider,
  actorUserId = null,
} = {}) {
  const region = await createWorkbookReviewRegionRecord({
    store,
    session,
    sourceDocument,
    input,
    actorUserId,
  });
  return interpretWorkbookReviewRegion({
    store,
    region,
    sourceDocument,
    indexBlobs,
    modelProvider,
    actorUserId,
    input: {
      expectedRegionVersion: region.version,
      description: input.description || "",
      semanticType: input.semanticType || "generic_table",
    },
  });
}

export async function reviseWorkbookReviewRegion({
  store,
  region,
  sourceDocument,
  indexBlobs = [],
  input = {},
  modelProvider,
  actorUserId = null,
} = {}) {
  const loaded = await currentRegion(store, region);
  assertRegionVersion(loaded, input.expectedRegionVersion);
  if (loaded.disposition !== "active") {
    fail("workbook_review_region_inactive", "Only an active workbook review region can be revised.", 409);
  }
  const previousRevisionId = text(input.previousRevisionId);
  if (loaded.currentRevisionId && previousRevisionId !== loaded.currentRevisionId) {
    fail("stale_region_understanding_revision", "Region interpretation changed; reload before submitting feedback.", 409, {
      previousRevisionId: previousRevisionId || null,
      currentRevisionId: loaded.currentRevisionId,
    });
  }
  const priorRevision = loaded.currentRevisionId
    ? await store.findRegionUnderstandingRevisionById(loaded.currentRevisionId)
    : null;
  return draftRevision({
    store,
    region: loaded,
    sourceDocument,
    indexBlobs,
    modelProvider,
    actorUserId,
    trigger: text(input.feedback) ? "user_feedback" : "retry",
    userFeedback: input.feedback || "",
    priorRevision,
    initialSemanticType: priorRevision?.interpretation?.semanticType || "generic_table",
  });
}

export async function confirmWorkbookReviewRegion({
  store,
  region,
  revisionId,
  expectedRegionVersion,
  actorUserId = null,
} = {}) {
  const loaded = await currentRegion(store, region);
  assertRegionVersion(loaded, expectedRegionVersion);
  const requestedRevisionId = text(revisionId);
  if (!requestedRevisionId || requestedRevisionId !== loaded.currentRevisionId) {
    fail("region_revision_not_current", "Confirm the current region interpretation revision.", 409, {
      requestedRevisionId: requestedRevisionId || null,
      currentRevisionId: loaded.currentRevisionId,
    });
  }
  const revision = await store.findRegionUnderstandingRevisionById(requestedRevisionId);
  if (!revision || revision.regionId !== loaded.id) {
    fail("region_understanding_revision_not_found", "Region understanding revision was not found.", 404);
  }
  if (asArray(revision.validation?.blockers).length) {
    fail("region_understanding_blocked", "Resolve region interpretation blockers before confirming.", 409, {
      blockers: revision.validation.blockers,
    });
  }
  const acceptedAt = new Date().toISOString();
  const updated = await store.updateWorkbookReviewRegion(loaded.id, {
    expectedVersion: loaded.version,
    reviewStatus: "accepted",
    acceptedRevisionId: revision.id,
    acceptedAt,
    acceptedBy: actorUserId,
    updatedBy: actorUserId,
  });
  return { region: updated, revision };
}

export async function ignoreWorkbookReviewRegion({
  store,
  region,
  expectedRegionVersion,
  reason,
  actorUserId = null,
} = {}) {
  const loaded = await currentRegion(store, region);
  assertRegionVersion(loaded, expectedRegionVersion);
  const updated = await store.updateWorkbookReviewRegion(loaded.id, {
    expectedVersion: loaded.version,
    disposition: "ignored",
    ignoredAt: new Date().toISOString(),
    ignoredBy: actorUserId,
    ignoredReason: text(reason),
    updatedBy: actorUserId,
  });
  return { region: updated };
}

export async function deleteWorkbookReviewRegion({
  store,
  region,
  expectedRegionVersion,
  reason,
  actorUserId = null,
} = {}) {
  const loaded = await currentRegion(store, region);
  assertRegionVersion(loaded, expectedRegionVersion);
  const updated = await store.updateWorkbookReviewRegion(loaded.id, {
    expectedVersion: loaded.version,
    disposition: "deleted",
    deletedAt: new Date().toISOString(),
    deletedBy: actorUserId,
    deletedReason: text(reason),
    updatedBy: actorUserId,
  });
  return { region: updated };
}
