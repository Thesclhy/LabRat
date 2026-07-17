import { decodeRange, encodeRange } from "../import/utils/excelAddress.js";
import { makeId } from "./ids.js";
import { buildWorkbookUnderstandingPreview } from "./workbookUnderstandingPreview.js";

export const WORKBOOK_REVIEW_SESSION_SCHEMA_VERSION = "labrat.workbookReviewSession.v1";
export const WORKBOOK_UNDERSTANDING_SCHEMA_VERSION = "labrat.workbookUnderstanding.v1";

const USER_DRAFT_REGION_SOURCE = "user_red_box";
const SUPPORTED_SEMANTIC_TYPES = new Set([
  "experiment_table",
  "reaction_rate_time_series",
  "component_distribution",
  "calculation_table",
  "metadata_notes",
  "generic_table",
  "unknown_region",
  "ignored_region",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanObject(value) {
  return isObject(value) ? value : {};
}

function copy(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function failRevision(code, message, details = {}, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = {
    clarification: {
      code,
      message,
      ...details,
    },
    validation: {
      status: "invalid",
      code,
    },
  };
  throw error;
}

function safeDecodeRange(rangeRef) {
  try {
    const decoded = decodeRange(String(rangeRef || ""));
    if (decoded.e.r < decoded.s.r || decoded.e.c < decoded.s.c) return null;
    return {
      decoded,
      rangeRef: encodeRange(decoded),
      rowCount: decoded.e.r - decoded.s.r + 1,
      columnCount: decoded.e.c - decoded.s.c + 1,
      cellCount: (decoded.e.r - decoded.s.r + 1) * (decoded.e.c - decoded.s.c + 1),
    };
  } catch {
    return null;
  }
}

function sheetSummariesFor(sourceDocument) {
  const metadata = cleanObject(sourceDocument?.metadata);
  const metadataSheets = asArray(metadata.sheets);
  if (metadataSheets.length) return metadataSheets;
  return asArray(metadata.sheetNames).map((name) => ({ name }));
}

function findSheetSummary(sourceDocument, sheetName) {
  const sheets = sheetSummariesFor(sourceDocument);
  if (!sheetName && sheets.length === 1) return sheets[0];
  const normalized = normalizeLower(sheetName);
  return sheets.find((sheet) => normalizeLower(sheet?.name) === normalized) || null;
}

function sheetNameOptions(sourceDocument) {
  return sheetSummariesFor(sourceDocument).map((sheet) => sheet.name).filter(Boolean);
}

function classifySemanticType(text) {
  const lower = normalizeLower(text);
  if (!lower) return "unknown_region";
  if (/\b(ignore|ignored|ignoring|skip|skipped|exclude|excluded|excluding|omit|omitted)\b/i.test(lower)) return "ignored_region";
  if (/\b(ignore|skip|exclude|不要|忽略)\b/i.test(lower)) return "ignored_region";
  if (/(reaction|rate|time|kinetic|反应速率|时间)/i.test(lower)) return "reaction_rate_time_series";
  if (/(c-?number|carbon number|carbon-number|carbon balance|distribution|分布|碳数)/i.test(lower)) return "component_distribution";
  if (/(calculation|calc|formula|计算)/i.test(lower)) return "calculation_table";
  if (/(note|metadata|description|备注|说明)/i.test(lower)) return "metadata_notes";
  if (/(experiment|master|condition|run table|实验|条件|主表)/i.test(lower)) return "experiment_table";
  if (/(table|表格|数据表)/i.test(lower)) return "generic_table";
  return "unknown_region";
}

function confidenceForSemanticType(semanticType, source = "user_revision") {
  if (semanticType === "ignored_region") return 1;
  if (semanticType === "unknown_region") return source === "user_revision" ? 0.45 : 0.3;
  return source === "user_revision" ? 0.8 : 0.65;
}

function regionDescription(update, message) {
  return normalizeText(update.description) || normalizeText(message) || "User selected workbook region.";
}

function normalizeOperation(value) {
  const operation = normalizeLower(value || "upsert");
  if (["upsert", "remove", "ignore"].includes(operation)) return operation;
  failRevision("invalid_red_box_operation", `Unsupported red-box operation: ${value}.`, { operation: value });
}

function normalizeRevisionMode(value) {
  const mode = normalizeLower(value || "merge");
  if (["replace_current", "current_selection", "update_current"].includes(mode)) return "replace_current";
  return "merge";
}

function validateRedBoxUpdate(update, { workbookReviewSession, sourceDocument, message }) {
  const source = cleanObject(update);
  const operation = normalizeOperation(source.operation);
  const draftRegionId = normalizeText(source.draftRegionId || source.clientRegionId) || makeId("draft_region");
  if (operation === "remove") {
    return { operation, draftRegionId };
  }
  const sourceDocumentId = normalizeText(source.sourceDocumentId);
  if (!sourceDocumentId || sourceDocumentId !== workbookReviewSession.sourceDocumentId) {
    failRevision("source_document_mismatch", "Red-box updates must target the workbook being reviewed.", {
      sourceDocumentId,
      expectedSourceDocumentId: workbookReviewSession.sourceDocumentId,
    });
  }
  const sheetName = normalizeText(source.sheetName);
  const sheet = findSheetSummary(sourceDocument, sheetName);
  if (!sheet) {
    failRevision("source_sheet_not_found", sheetName
      ? `Sheet ${sheetName} was not found for this workbook.`
      : "Select a sheet before submitting this red box.", {
        sheetName,
        options: sheetNameOptions(sourceDocument),
      }, 404);
  }
  const parsed = safeDecodeRange(source.range);
  if (!parsed) {
    failRevision("invalid_source_range", "range must be a valid Excel range such as A1:D20.", {
      range: source.range || null,
      sheetName: sheet.name,
    });
  }
  const warnings = [];
  if (sheet.rowCount && parsed.decoded.e.r >= sheet.rowCount) {
    warnings.push({
      code: "range_exceeds_used_rows",
      message: `Selected range extends past the indexed used row count (${sheet.rowCount}).`,
    });
  }
  if (sheet.columnCount && parsed.decoded.e.c >= sheet.columnCount) {
    warnings.push({
      code: "range_exceeds_used_columns",
      message: `Selected range extends past the indexed used column count (${sheet.columnCount}).`,
    });
  }
  const description = regionDescription(source, message);
  const requestedType = normalizeText(source.semanticType);
  const semanticType = operation === "ignore"
    ? "ignored_region"
    : (SUPPORTED_SEMANTIC_TYPES.has(requestedType) ? requestedType : classifySemanticType(`${description} ${message}`));
  if (semanticType === "unknown_region") {
    warnings.push({
      code: "region_description_needed",
      message: `Describe what ${sheet.name}!${parsed.rangeRef} represents before using it for analysis.`,
    });
  }
  return {
    operation,
    draftRegionId,
    clientRegionId: normalizeText(source.clientRegionId) || draftRegionId,
    sourceDocumentId,
    sheetName: sheet.name,
    range: parsed.rangeRef,
    rowCount: parsed.rowCount,
    columnCount: parsed.columnCount,
    cellCount: parsed.cellCount,
    selectionMethod: normalizeText(source.selectionMethod) || "manual",
    description,
    semanticType,
    confidence: confidenceForSemanticType(semanticType),
    warnings,
  };
}

function detectedSessionRegions(session) {
  return asArray(session?.regions).filter((region) => region?.source !== USER_DRAFT_REGION_SOURCE);
}

function draftRegionSourceKey(region) {
  return [
    normalizeText(region?.sourceDocumentId),
    normalizeLower(region?.sheetName),
    normalizeText(region?.range).toUpperCase(),
  ].join(":");
}

function draftRegionSummary(region) {
  return {
    id: region.draftRegionId,
    draftRegionId: region.draftRegionId,
    clientRegionId: region.clientRegionId || region.draftRegionId,
    source: USER_DRAFT_REGION_SOURCE,
    sourceDocumentId: region.sourceDocumentId,
    sheetName: region.sheetName,
    rangeRef: region.range,
    kind: region.semanticType || "unknown_region",
    semanticType: region.semanticType || "unknown_region",
    label: region.description || region.range,
    status: region.semanticType === "ignored_region" ? "ignored" : "draft",
    confidence: region.confidence ?? null,
    rowCount: region.rowCount ?? null,
    columnCount: region.columnCount ?? null,
    cellCount: region.cellCount ?? null,
    selectionMethod: region.selectionMethod || "manual",
    description: region.description || "",
    warnings: asArray(region.warnings),
    sourceRefs: [{
      sourceType: "excel_range",
      sourceDocumentId: region.sourceDocumentId,
      sheet: region.sheetName,
      range: region.range,
    }],
  };
}

function factFromDraftRegion(region, actorUserId = null, previewRegion = null) {
  const interpretation = previewRegion?.interpretation || null;
  return {
    factId: `fact_${region.draftRegionId}`,
    kind: "region_description",
    draftRegionId: region.draftRegionId,
    sourceDocumentId: region.sourceDocumentId,
    sheetName: region.sheetName,
    range: region.range,
    semanticType: region.semanticType || "unknown_region",
    description: region.description || "",
    confidence: region.confidence ?? null,
    source: interpretation?.decisionSource || "user_revision",
    sourceRefs: [{
      sourceType: "excel_range",
      sourceDocumentId: region.sourceDocumentId,
      sheet: region.sheetName,
      range: region.range,
    }],
    updatedBy: actorUserId || null,
    updatedAt: nowIso(),
    ...(interpretation ? { interpretation } : {}),
  };
}

function previewValidation(preview) {
  const blockers = asArray(preview?.blockers);
  return {
    status: blockers.length ? "blocked" : "ready",
    blockers,
  };
}

function previewPendingQuestions(preview) {
  return asArray(preview?.blockers).map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    draftRegionId: blocker.draftRegionId,
  }));
}

function assistantRevisionMessage({ workbookName, draftRegions, changedRegions = [], languageOnly }) {
  const regionsForReply = asArray(changedRegions).length ? asArray(changedRegions) : asArray(draftRegions);
  if (!regionsForReply.length && languageOnly) {
    return "I updated the workbook review notes while keeping the existing red-box source references.";
  }
  if (!regionsForReply.length) {
    return "Select at least one red box or describe an existing red box before confirming workbook understanding.";
  }
  const activeRegions = regionsForReply.filter((region) => region?.range && region?.sheetName);
  const descriptions = activeRegions.slice(0, 4).map((region) => (
    `${region.sheetName}!${region.range} as ${region.semanticType}`
  ));
  const selectedLabels = activeRegions.slice(0, 4).map((region) => `${region.sheetName}!${region.range}`);
  const suffix = activeRegions.length > descriptions.length
    ? ` and ${activeRegions.length - descriptions.length} more region(s)`
    : "";
  if (activeRegions.some((region) => region.semanticType === "unknown_region")) {
    return `I selected ${selectedLabels.join("; ")}${suffix}, but I still need to know what this region represents before using it for analysis. Describe whether it is reaction rate data, experiment conditions, a calculation table, a component distribution, notes, or another table.`;
  }
  const prefix = asArray(changedRegions).length
    ? `I updated the current selection in ${workbookName}`
    : `I updated my understanding of ${workbookName}`;
  return `${prefix}: ${descriptions.join("; ")}${suffix}. Review this draft before confirming.`;
}

function currentDraftId(session) {
  return session?.currentUnderstanding?.id || makeId("workbook_understanding_draft");
}

function summarizeUnderstanding({ sourceDocument, draftRegions, message }) {
  const workbookName = cleanObject(sourceDocument?.metadata).workbookName
    || cleanObject(sourceDocument?.metadata).fileName
    || sourceDocument?.id
    || "workbook";
  if (draftRegions.length) {
    return assistantRevisionMessage({ workbookName, draftRegions, languageOnly: false });
  }
  return normalizeText(message) || `Review draft understanding for ${workbookName}.`;
}

export function applyWorkbookReviewRevision({
  workbookReviewSession,
  sourceDocument,
  indexBlobs = [],
  body = {},
  actorUserId = null,
} = {}) {
  if (!workbookReviewSession) failRevision("workbook_review_session_not_found", "Workbook review session not found.", {}, 404);
  if (!sourceDocument) failRevision("source_document_not_found", "Workbook source document was not found.", {}, 404);
  if (workbookReviewSession.status === "accepted") {
    failRevision("workbook_review_already_accepted", "Accepted workbook understanding cannot be revised in this session.", {}, 409);
  }
  const message = normalizeText(body.message);
  if (!message) {
    failRevision("workbook_revision_message_required", "Describe the red-box update before submitting a workbook revision.");
  }
  const previousUnderstandingId = normalizeText(body.previousUnderstandingId);
  const existingUnderstanding = cleanObject(workbookReviewSession.currentUnderstanding);
  if (previousUnderstandingId && existingUnderstanding.id && previousUnderstandingId !== existingUnderstanding.id) {
    failRevision("stale_workbook_understanding", "Workbook understanding draft changed; reload before submitting this revision.", {
      previousUnderstandingId,
      currentUnderstandingId: existingUnderstanding.id,
    }, 409);
  }

  const redBoxUpdates = asArray(body.redBoxUpdates);
  const revisionMode = normalizeRevisionMode(body.revisionMode);
  const activeDraftRegionId = normalizeText(body.activeDraftRegionId);
  const existingDraftRegions = asArray(existingUnderstanding.draftRegions);
  if (!redBoxUpdates.length && !existingDraftRegions.length) {
    failRevision("red_box_required", "Select at least one workbook red box before submitting a correction.", {
      sourceDocumentId: workbookReviewSession.sourceDocumentId,
    });
  }
  const draftById = new Map(existingDraftRegions.map((region) => [region.draftRegionId, copy(region)]));
  const validatedUpdates = redBoxUpdates.map((update) => validateRedBoxUpdate(update, {
    workbookReviewSession,
    sourceDocument,
    message,
  }));
  const changedRegions = [];
  validatedUpdates.forEach((update) => {
    if (update.operation === "remove") {
      draftById.delete(update.draftRegionId);
      changedRegions.push({
        operation: "remove",
        draftRegionId: update.draftRegionId,
        status: "removed",
      });
      return;
    }
    const nextRegion = {
      draftRegionId: update.draftRegionId,
      clientRegionId: update.clientRegionId,
      sourceDocumentId: update.sourceDocumentId,
      sheetName: update.sheetName,
      range: update.range,
      rowCount: update.rowCount,
      columnCount: update.columnCount,
      cellCount: update.cellCount,
      selectionMethod: update.selectionMethod,
      description: update.description,
      semanticType: update.semanticType,
      confidence: update.confidence,
      warnings: update.warnings,
      status: update.semanticType === "ignored_region" ? "ignored" : "draft",
      updatedBy: actorUserId || null,
      updatedAt: nowIso(),
    };
    const nextSourceKey = draftRegionSourceKey(nextRegion);
    for (const [existingId, existingRegion] of draftById.entries()) {
      if (existingId !== update.draftRegionId && draftRegionSourceKey(existingRegion) === nextSourceKey) {
        draftById.delete(existingId);
      }
    }
    draftById.set(update.draftRegionId, nextRegion);
    changedRegions.push(nextRegion);
  });

  const draftRegions = [...draftById.values()];
  const interpretationPreview = asArray(indexBlobs).length
    ? buildWorkbookUnderstandingPreview({
      sourceDocument,
      indexBlobs,
      draftRegions,
      existingFacts: asArray(existingUnderstanding.facts),
      interpretationPatches: asArray(body.interpretationPatches),
      message,
      messageTargetDraftRegionIds: validatedUpdates.map((update) => update.draftRegionId),
    })
    : null;
  const previewByDraftRegionId = new Map(asArray(interpretationPreview?.regions).map((region) => [region.draftRegionId, region]));
  const facts = draftRegions.map((region) => factFromDraftRegion(region, actorUserId, previewByDraftRegionId.get(region.draftRegionId)));
  const regionSummaries = draftRegions.map(draftRegionSummary);
  const warnings = [
    ...asArray(workbookReviewSession.warnings),
    ...draftRegions.flatMap((region) => asArray(region.warnings)),
    ...asArray(interpretationPreview?.warnings),
  ];
  const workbookName = cleanObject(sourceDocument.metadata).workbookName
    || cleanObject(sourceDocument.metadata).fileName
    || sourceDocument.id
    || "workbook";
  const assistantContent = assistantRevisionMessage({
    workbookName,
    draftRegions,
    changedRegions,
    languageOnly: !validatedUpdates.length,
  });
  const createdAt = nowIso();
  const messages = [
    ...asArray(workbookReviewSession.messages),
    {
      id: makeId("workbook_review_message"),
      role: "user",
      content: message,
      createdAt,
      metadata: {
        redBoxUpdateCount: redBoxUpdates.length,
        revisionMode,
        activeDraftRegionId: activeDraftRegionId || null,
      },
    },
    {
      id: makeId("workbook_review_message"),
      role: "assistant",
      content: assistantContent,
      createdAt,
      metadata: {
        provider: "deterministic",
        source: "workbook_review_revision",
        revisionMode,
        activeDraftRegionId: activeDraftRegionId || null,
        changedRegionCount: changedRegions.length,
      },
    },
  ];
  const currentUnderstanding = {
    schemaVersion: WORKBOOK_UNDERSTANDING_SCHEMA_VERSION,
    id: currentDraftId(workbookReviewSession),
    status: "draft",
    sourceDocumentId: workbookReviewSession.sourceDocumentId,
    summary: summarizeUnderstanding({ sourceDocument, draftRegions, message }),
    facts,
    regionSummaries,
    draftRegions,
    confidence: interpretationPreview?.confidence ?? (facts.length
      ? facts.reduce((sum, fact) => sum + (Number(fact.confidence) || 0), 0) / facts.length
      : null),
    warnings,
    validation: previewValidation(interpretationPreview),
    pendingQuestions: [
      ...previewPendingQuestions(interpretationPreview),
      ...draftRegions
      .filter((region) => region.semanticType === "unknown_region")
      .map((region) => ({
        code: "region_description_needed",
        message: `What does ${region.sheetName}!${region.range} represent?`,
        draftRegionId: region.draftRegionId,
      })),
    ].filter((question, index, questions) => (
      questions.findIndex((candidate) => candidate.code === question.code && candidate.draftRegionId === question.draftRegionId) === index
    )),
    updatedAt: createdAt,
    updatedBy: actorUserId || null,
  };
  const sessionPatch = {
    status: "needs_user_review",
    version: (Number(workbookReviewSession.version) || 1) + 1,
    currentUnderstanding,
    regions: [
      ...detectedSessionRegions(workbookReviewSession),
      ...regionSummaries,
    ],
    messages,
    warnings,
    updatedBy: actorUserId || null,
  };
  return {
    sessionPatch,
    workbookUnderstandingDraft: currentUnderstanding,
    messages: messages.slice(-2),
    clarification: null,
    validation: {
      status: "valid",
      sourceRefsResolved: true,
      redBoxUpdateCount: redBoxUpdates.length,
      changedRegionCount: changedRegions.length,
      revisionMode,
      activeDraftRegionId: activeDraftRegionId || null,
      blockers: asArray(interpretationPreview?.blockers),
    },
    changedRegions,
    revisionMode,
    activeDraftRegionId: activeDraftRegionId || null,
  };
}

export function buildWorkbookUnderstandingForConfirmation({
  workbookReviewSession,
  body = {},
  actorUserId = null,
} = {}) {
  const currentUnderstanding = cleanObject(workbookReviewSession?.currentUnderstanding);
  if (!currentUnderstanding.id || !asArray(currentUnderstanding.facts).length) {
    failRevision("workbook_understanding_draft_required", "Submit at least one workbook revision before confirming understanding.", {}, 409);
  }
  const requestedId = normalizeText(body.workbookUnderstandingId);
  if (requestedId && requestedId !== currentUnderstanding.id) {
    failRevision("stale_workbook_understanding", "Workbook understanding draft changed; reload before confirming.", {
      requestedUnderstandingId: requestedId,
      currentUnderstandingId: currentUnderstanding.id,
    }, 409);
  }
  if (workbookReviewSession.status === "accepted") {
    failRevision("workbook_review_already_accepted", "Workbook understanding is already accepted.", {}, 409);
  }
  const missingInterpretations = asArray(currentUnderstanding.facts).filter((fact) => (
    !["ignored_region", "metadata_notes"].includes(fact?.semanticType)
    && !fact?.interpretation
  ));
  if (missingInterpretations.length) {
    failRevision(
      "workbook_interpretation_required",
      "Generate and review a structured interpretation for every experiment-bearing region before confirming.",
      { draftRegionIds: missingInterpretations.map((fact) => fact.draftRegionId) },
      409,
    );
  }
  const blockers = asArray(currentUnderstanding.validation?.blockers);
  if (blockers.length) {
    const blocker = blockers[0];
    failRevision(blocker.code || "workbook_interpretation_incomplete", blocker.message || "Resolve workbook interpretation blockers before confirming.", {
      blocker,
      blockers,
    }, 409);
  }
  const lowConfidenceFacts = asArray(currentUnderstanding.facts).filter((fact) => (
    fact?.interpretation
    && fact.interpretation.excluded !== true
    && Number(fact.interpretation.confidence) < 0.6
  ));
  const decisionSummary = cleanObject(body.decisionSummary);
  if (lowConfidenceFacts.length && decisionSummary.acknowledgedLowConfidence !== true) {
    failRevision(
      "low_confidence_confirmation_required",
      "Explicitly acknowledge the low-confidence workbook interpretation before confirming.",
      { draftRegionIds: lowConfidenceFacts.map((fact) => fact.draftRegionId) },
      409,
    );
  }
  const acceptedAt = nowIso();
  const acceptedDraftRegions = asArray(currentUnderstanding.draftRegions)
    .map((region) => ({ ...region, status: "accepted" }));
  const acceptedRegionSummaries = asArray(currentUnderstanding.regionSummaries)
    .map((region) => ({ ...region, status: "accepted" }));
  const acceptedUnderstanding = {
    ...currentUnderstanding,
    id: makeId("workbook_understanding"),
    draftId: currentUnderstanding.id,
    status: "accepted",
    draftRegions: acceptedDraftRegions,
    regionSummaries: acceptedRegionSummaries,
    acceptedAt,
    acceptedBy: actorUserId || null,
  };
  return {
    understandingInput: {
      labId: workbookReviewSession.labId,
      projectId: workbookReviewSession.projectId,
      sourceDocumentId: workbookReviewSession.sourceDocumentId,
      workbookReviewSessionId: workbookReviewSession.id,
      schemaVersion: WORKBOOK_UNDERSTANDING_SCHEMA_VERSION,
      status: "accepted",
      version: Number(workbookReviewSession.version) || 1,
      understanding: acceptedUnderstanding,
      facts: asArray(acceptedUnderstanding.facts),
      regionSummaries: acceptedRegionSummaries,
      warnings: asArray(acceptedUnderstanding.warnings),
      decisionSummary,
      createdBy: actorUserId || null,
    },
    sessionPatch: {
      status: "accepted",
      version: (Number(workbookReviewSession.version) || 1) + 1,
      currentUnderstanding: acceptedUnderstanding,
      messages: [
        ...asArray(workbookReviewSession.messages),
        {
          id: makeId("workbook_review_message"),
          role: "assistant",
          content: "Workbook understanding was confirmed. Future data and chart actions can use these reviewed source-region meanings.",
          createdAt: acceptedAt,
          metadata: {
            provider: "deterministic",
            source: "workbook_review_confirm",
          },
        },
      ],
      updatedBy: actorUserId || null,
    },
  };
}

function topRegions(regions = []) {
  return asArray(regions)
    .slice()
    .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
    .slice(0, 6)
    .map((region) => ({
      id: region.id,
      label: region.label || region.kind || "Detected source region",
      kind: region.kind || "unknown_region",
      sheetName: region.sheetName || "",
      rangeRef: region.rangeRef || "",
      confidence: typeof region.confidence === "number" ? region.confidence : null,
      warningCount: asArray(region.warnings).length,
    }));
}

function detectedRegionSemanticType(region) {
  const kind = normalizeText(region?.semanticType || region?.kind);
  if (SUPPORTED_SEMANTIC_TYPES.has(kind)) return kind;
  if (kind === "standard_table") return "generic_table";
  return classifySemanticType(`${kind} ${region?.label || ""}`);
}

function detectedDraftRegions(sourceDocument, regions = []) {
  return asArray(regions).flatMap((region) => {
    const sourceDocumentId = normalizeText(region?.sourceDocumentId || sourceDocument?.id);
    const sheetName = normalizeText(region?.sheetName);
    const range = normalizeText(region?.rangeRef || region?.range);
    if (!sourceDocumentId || !sheetName || !range) return [];
    const sourceRegionId = normalizeText(region?.id || region?.sourceRegionId);
    const draftRegionId = `draft_${sourceRegionId || `${sourceDocumentId}_${sheetName}_${range}`}`
      .replace(/[^a-zA-Z0-9_]/g, "_");
    return [{
      draftRegionId,
      clientRegionId: draftRegionId,
      sourceRegionId: sourceRegionId || null,
      sourceDocumentId,
      sheetName,
      range,
      selectionMethod: "detected_region",
      description: normalizeText(region?.description || region?.label),
      semanticType: detectedRegionSemanticType(region),
      confidence: typeof region?.confidence === "number" ? region.confidence : null,
      warnings: asArray(region?.warnings),
      status: "draft",
    }];
  });
}

export function buildWorkbookReviewSessionDraft({ sourceDocument, regions = [], indexBlobs = [] } = {}) {
  const metadata = cleanObject(sourceDocument?.metadata);
  const summary = cleanObject(sourceDocument?.summary);
  const sheetSummaries = asArray(metadata.sheets);
  const workbookName = metadata.workbookName || metadata.fileName || sourceDocument?.id || "workbook";
  const detectedRegionSummaries = topRegions(regions);
  const draftRegions = detectedDraftRegions(sourceDocument, regions);
  const interpretationPreview = asArray(indexBlobs).length && draftRegions.length
    ? buildWorkbookUnderstandingPreview({ sourceDocument, indexBlobs, draftRegions })
    : null;
  const previewByDraftRegionId = new Map(asArray(interpretationPreview?.regions).map((region) => [region.draftRegionId, region]));
  const facts = interpretationPreview
    ? draftRegions.map((region) => factFromDraftRegion(region, null, previewByDraftRegionId.get(region.draftRegionId)))
    : null;
  const nonEmptyCellCount = Number(summary.nonEmptyCellCount) || 0;
  const warningCount = asArray(sourceDocument?.warnings).length + asArray(regions).reduce((total, region) => total + asArray(region?.warnings).length, 0);
  const assistantMessage = [
    `I indexed ${workbookName}.`,
    `I found ${sheetSummaries.length || metadata.sheetCount || 0} sheet(s), ${regions.length} detected source region(s), and ${nonEmptyCellCount} non-empty cell(s).`,
    "Review the highlighted workbook regions before turning any range into project data or charts.",
  ].join(" ");
  return {
    schemaVersion: WORKBOOK_REVIEW_SESSION_SCHEMA_VERSION,
    status: "needs_user_review",
    workbookSummary: {
      sourceDocumentId: sourceDocument?.id || null,
      workbookName,
      documentType: sourceDocument?.documentType || "excel_workbook",
      sheetCount: sheetSummaries.length || metadata.sheetCount || 0,
      sheets: sheetSummaries,
      regionCount: regions.length,
      nonEmptyCellCount,
      warningCount,
    },
    currentUnderstanding: {
      ...(interpretationPreview ? {
        schemaVersion: WORKBOOK_UNDERSTANDING_SCHEMA_VERSION,
        id: makeId("workbook_understanding_draft"),
        status: "draft",
        sourceDocumentId: sourceDocument?.id || null,
      } : {}),
      summary: assistantMessage,
      detectedRegions: detectedRegionSummaries,
      draftRegions,
      ...(facts ? {
        facts,
        regionSummaries: draftRegions.map(draftRegionSummary),
        validation: previewValidation(interpretationPreview),
      } : {}),
      confidence: interpretationPreview?.confidence ?? (detectedRegionSummaries.length
        ? detectedRegionSummaries.reduce((sum, region) => sum + (Number(region.confidence) || 0), 0) / detectedRegionSummaries.length
        : null),
      pendingQuestions: previewPendingQuestions(interpretationPreview),
    },
    messages: [{
      id: "assistant_initial_summary",
      role: "assistant",
      content: assistantMessage,
      createdAt: new Date().toISOString(),
      metadata: {
        provider: "deterministic",
        source: "source_document_summary",
      },
    }],
    warnings: [
      ...asArray(sourceDocument?.warnings),
      ...(warningCount ? [] : []),
    ],
  };
}

export function workbookReviewSessionSummary(session) {
  if (!session) return null;
  return {
    id: session.id,
    labId: session.labId,
    projectId: session.projectId,
    sourceDocumentId: session.sourceDocumentId,
    schemaVersion: session.schemaVersion || WORKBOOK_REVIEW_SESSION_SCHEMA_VERSION,
    status: session.status,
    version: session.version || 1,
    workbookSummary: session.workbookSummary || {},
    currentUnderstanding: session.currentUnderstanding || {},
    regions: asArray(session.regions),
    messages: asArray(session.messages),
    warnings: asArray(session.warnings),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    createdBy: session.createdBy,
    updatedBy: session.updatedBy,
  };
}

export function workbookUnderstandingSummary(understanding) {
  if (!understanding) return null;
  return {
    id: understanding.id,
    labId: understanding.labId,
    projectId: understanding.projectId,
    sourceDocumentId: understanding.sourceDocumentId,
    workbookReviewSessionId: understanding.workbookReviewSessionId,
    schemaVersion: understanding.schemaVersion || WORKBOOK_UNDERSTANDING_SCHEMA_VERSION,
    status: understanding.status,
    version: understanding.version || 1,
    understanding: understanding.understanding || {},
    facts: asArray(understanding.facts),
    regionSummaries: asArray(understanding.regionSummaries),
    warnings: asArray(understanding.warnings),
    decisionSummary: understanding.decisionSummary || {},
    createdAt: understanding.createdAt,
    updatedAt: understanding.updatedAt,
    createdBy: understanding.createdBy,
    updatedBy: understanding.updatedBy,
  };
}
