import * as XLSX from "xlsx";
import { sha256Hex } from "./ids.js";
import { buildFormulaGraph, regionProvenance } from "./formulaGraph.js";
import { buildWorkbookUnderstandingPreview } from "./workbookUnderstandingPreview.js";
import { buildWorkbookReviewSessionDraft } from "./workbookReviewSessions.js";
import { confirmWorkbookReviewRegion, createWorkbookReviewRegionRecord } from "./workbookReviewRegions.js";
import { sourceRegionSummary } from "./sourceDocuments.js";

export const TEMPLATE_MATCH_SELECTION_METHOD = "template_match";
export const TEMPLATE_MATCH_TRIGGER = "template_match";
export const APPLY_ELIGIBLE_STATUSES = Object.freeze(["exact", "shifted"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeAlias(value) {
  return text(value).toLowerCase().replace(/[\s_-]+/g, "").replace(/^exp(?:eriment)?0*/, "exp");
}

function fail(code, message, statusCode = 400, details = {}) {
  throw Object.assign(new Error(message), { code, statusCode, details });
}

export function resolveExperimentLink({ identities = [], experimentLabel } = {}) {
  const wanted = normalizeAlias(experimentLabel);
  if (!wanted) return { linkedExperimentId: null, linkStatus: "none", candidates: [] };
  const candidates = asArray(identities)
    .filter((identity) => [identity?.canonicalLabel, identity?.label, ...asArray(identity?.aliases)]
      .some((alias) => normalizeAlias(alias) === wanted))
    .map((identity) => ({ experimentId: identity.id, label: identity.canonicalLabel || identity.label || identity.id }));
  if (candidates.length === 1) return { linkedExperimentId: candidates[0].experimentId, linkStatus: "resolved", candidates };
  if (candidates.length > 1) return { linkedExperimentId: null, linkStatus: "ambiguous", candidates };
  return { linkedExperimentId: null, linkStatus: "unresolved", candidates: [] };
}

function absoluteRangeFrom(relative, origin) {
  if (!relative) return null;
  return XLSX.utils.encode_range({
    s: { r: origin.r + Number(relative.relRow || 0), c: origin.c + Number(relative.relCol || 0) },
    e: { r: origin.r + Number(relative.relRowEnd ?? relative.relRow ?? 0), c: origin.c + Number(relative.relColEnd ?? relative.relCol ?? 0) },
  });
}

function columnLetter(offset, origin) {
  return XLSX.utils.encode_col(origin.c + Number(offset || 0));
}

/**
 * Rebases the template's relative semantics onto the matched range and returns
 * an interpretation patch in the shape buildWorkbookUnderstandingPreview
 * validates, so a prefilled revision goes through the same checks as a model
 * or user patch.
 */
export function prefilledInterpretationPatch({ templateVersion, matchedRange, experimentLabel } = {}) {
  const semantics = templateVersion?.semantics || {};
  const decoded = XLSX.utils.decode_range(matchedRange);
  const origin = { r: decoded.s.r, c: decoded.s.c };
  const patch = { decisionSource: "template_match" };
  if (semantics.experimentAxis) patch.experimentAxis = semantics.experimentAxis;
  if (Number.isInteger(Number(semantics.headerRowOffset)) && semantics.headerRowOffset !== null) {
    patch.headerRow = origin.r + Number(semantics.headerRowOffset) + 1;
  }
  if (semantics.experimentAxis === "rows" && semantics.experimentIdColumnOffset !== null && semantics.experimentIdColumnOffset !== undefined) {
    patch.experimentIdColumn = columnLetter(semantics.experimentIdColumnOffset, origin);
  }
  if (semantics.experimentAxis === "region") patch.experimentLabel = text(experimentLabel) || null;
  const fields = asArray(semantics.fields).filter((field) => field && field.columnOffset !== null && field.columnOffset !== undefined);
  if (fields.length) {
    patch.fields = fields.map((field) => ({
      column: columnLetter(field.columnOffset, origin),
      semanticKey: field.semanticKey || undefined,
      displayName: field.displayName || undefined,
      role: field.role || undefined,
      valueType: field.valueType || undefined,
      unit: field.unit ?? undefined,
    }));
  }
  const seriesPatches = asArray(semantics.series).map((series) => {
    if (series.orientation === "header_row_categories" && series.xHeader && series.yValues) {
      return {
        seriesKey: series.seriesKey || series.label || "series",
        label: series.label || series.seriesKey || "Series",
        orientation: "header_row_categories",
        xHeaderRange: absoluteRangeFrom(series.xHeader, origin),
        yValueRange: absoluteRangeFrom(series.yValues, origin),
        xMeaning: series.xSemanticKey || "",
        xValueType: series.xValueType || "",
        yUnit: series.yUnit || "",
        yNumericScale: series.yNumericScale || "",
      };
    }
    if (series.xColumnOffset !== undefined && series.yColumnOffset !== undefined) {
      return {
        seriesKey: series.seriesKey || series.label || "series",
        label: series.label || series.seriesKey || "Series",
        orientation: "column_pair",
        xColumn: columnLetter(series.xColumnOffset, origin),
        yColumn: columnLetter(series.yColumnOffset, origin),
        xMeaning: series.xSemanticKey || "",
        yUnit: series.yUnit || "",
        yNumericScale: series.yNumericScale || "",
      };
    }
    return null;
  }).filter(Boolean);
  if (seriesPatches.length) patch.seriesPatches = seriesPatches;
  if (semantics.inclusion && semantics.inclusion.startRowOffset !== null && semantics.inclusion.startRowOffset !== undefined) {
    patch.inclusion = {
      startRow: origin.r + Number(semantics.inclusion.startRowOffset) + 1,
      ...(semantics.inclusion.endRowOffset !== null && semantics.inclusion.endRowOffset !== undefined
        ? { endRow: origin.r + Number(semantics.inclusion.endRowOffset) + 1 }
        : {}),
    };
  }
  return patch;
}

async function findOrCreateSession({ store, project, sourceDocument, actorUserId }) {
  const sessions = store.listWorkbookReviewSessions ? await store.listWorkbookReviewSessions({ projectId: project.id }) : [];
  const existing = sessions.find((session) => session.sourceDocumentId === sourceDocument.id && session.status !== "deleted");
  if (existing) return { session: existing, created: false };
  const regions = store.listSourceRegions ? await store.listSourceRegions({ sourceDocumentId: sourceDocument.id }) : [];
  const draft = buildWorkbookReviewSessionDraft({ sourceDocument, regions });
  const session = await store.createWorkbookReviewSession({
    labId: project.labId,
    projectId: project.id,
    sourceDocumentId: sourceDocument.id,
    ...draft,
    regions: regions.map(sourceRegionSummary),
    createdBy: actorUserId,
  });
  for (const detectedRegion of asArray(draft.candidateRegions)) {
    await createWorkbookReviewRegionRecord({
      store,
      session,
      sourceDocument,
      actorUserId,
      input: {
        sourceRegionId: detectedRegion.sourceRegionId,
        sheetName: detectedRegion.sheetName,
        range: detectedRegion.range,
        selectionMethod: "detected_region",
        semanticType: detectedRegion.semanticType,
        description: detectedRegion.description,
      },
    });
  }
  return { session, created: true };
}

function offsetText(offset) {
  if (!offset || (!offset.rows && !offset.cols)) return "";
  const parts = [];
  if (offset.rows) parts.push(`${Math.abs(offset.rows)} row${Math.abs(offset.rows) === 1 ? "" : "s"} ${offset.rows > 0 ? "down" : "up"}`);
  if (offset.cols) parts.push(`${Math.abs(offset.cols)} column${Math.abs(offset.cols) === 1 ? "" : "s"} ${offset.cols > 0 ? "right" : "left"}`);
  return ` (${parts.join(" and ")} from the template position)`;
}

export async function applyTemplateMatch({
  store,
  project,
  actorUserId = null,
  template,
  templateVersion,
  sourceDocument,
  indexBlobs = [],
  report,
  identities = [],
  idempotencyKey = null,
} = {}) {
  if (!APPLY_ELIGIBLE_STATUSES.includes(report?.status)) {
    return { skipped: true, reason: "not_eligible", status: report?.status || "no_match", sourceDocumentId: sourceDocument.id };
  }
  const sheetName = text(report.sheetName);
  const range = text(report.matchedRange);
  if (!sheetName || !range) return { skipped: true, reason: "match_incomplete", status: report.status, sourceDocumentId: sourceDocument.id };
  const { session, created: sessionCreated } = await findOrCreateSession({ store, project, sourceDocument, actorUserId });
  const regions = await store.listWorkbookReviewRegions({ workbookReviewSessionId: session.id, includeDeleted: false });
  const sameRange = regions.filter((region) => (
    region.disposition === "active"
    && text(region.sheetName).toLowerCase() === sheetName.toLowerCase()
    && text(region.rangeRef).toUpperCase() === range.toUpperCase()
  ));
  const existingTemplateRegion = sameRange.find((region) => region.selectionMethod === TEMPLATE_MATCH_SELECTION_METHOD);
  if (existingTemplateRegion) {
    const revision = existingTemplateRegion.currentRevisionId ? await store.findRegionUnderstandingRevisionById(existingTemplateRegion.currentRevisionId) : null;
    return { skipped: false, created: false, reason: "already_applied", session, sessionCreated, region: existingTemplateRegion, revision, sourceDocumentId: sourceDocument.id };
  }
  if (sameRange.length) {
    const region = sameRange[0];
    const revision = region.currentRevisionId ? await store.findRegionUnderstandingRevisionById(region.currentRevisionId) : null;
    return {
      skipped: true,
      reason: region.acceptedRevisionId ? "region_already_confirmed" : "region_exists",
      status: report.status,
      session,
      region,
      revision,
      sourceDocumentId: sourceDocument.id,
    };
  }
  const link = resolveExperimentLink({ identities, experimentLabel: report.experimentLabel });
  const dataKind = text(template?.name) || null;
  const templateMatch = {
    status: report.status,
    offset: report.offset || { rows: 0, cols: 0 },
    experimentLabel: report.experimentLabel || null,
    labelSource: report.labelSource || null,
    linkStatus: link.linkStatus,
    linkCandidates: link.candidates,
    templateName: template?.name || null,
    templateVersion: templateVersion.version,
    idempotencyKey: idempotencyKey || null,
    appliedAt: new Date().toISOString(),
  };
  const region = await store.createWorkbookReviewRegion({
    labId: project.labId,
    projectId: project.id,
    workbookReviewSessionId: session.id,
    sourceDocumentId: sourceDocument.id,
    sourceRegionId: null,
    sheetName,
    rangeRef: range,
    selectionMethod: TEMPLATE_MATCH_SELECTION_METHOD,
    interpretationHint: {
      semanticType: templateVersion.semantics?.semanticType || "generic_table",
      description: `Prefilled from extraction template ${template?.name || templateVersion.id}.`,
    },
    disposition: "active",
    reviewStatus: "awaiting_review",
    warnings: [],
    linkedExperimentId: link.linkedExperimentId,
    dataKind,
    regionExtractionTemplateVersionId: templateVersion.id,
    templateMatch,
    createdBy: actorUserId,
  });
  let preview;
  try {
    preview = buildWorkbookUnderstandingPreview({
      sourceDocument,
      indexBlobs,
      draftRegions: [{
        draftRegionId: region.id,
        sourceDocumentId: sourceDocument.id,
        sheetName,
        range,
        semanticType: templateVersion.semantics?.semanticType || "generic_table",
        description: "",
      }],
      interpretationPatches: [{
        ...prefilledInterpretationPatch({ templateVersion, matchedRange: range, experimentLabel: report.experimentLabel }),
        draftRegionId: region.id,
      }],
    });
  } catch (error) {
    const warning = { code: error?.code || "template_prefill_invalid", message: error?.message || "The template semantics could not be applied to this range." };
    const failed = await store.updateWorkbookReviewRegion(region.id, { reviewStatus: "interpretation_failed", warnings: [warning], updatedBy: actorUserId });
    return { skipped: true, reason: "prefill_failed", status: report.status, session, region: failed, revision: null, warning, sourceDocumentId: sourceDocument.id };
  }
  const previewRegion = preview.regions[0];
  let provenance = null;
  try {
    provenance = regionProvenance({ graph: buildFormulaGraph(indexBlobs), sheetName, range });
  } catch {
    provenance = null;
  }
  const interpretation = {
    semanticType: templateVersion.semantics?.semanticType || previewRegion.interpretation.semanticType || "generic_table",
    ...previewRegion.interpretation,
    ...(provenance ? { provenance } : {}),
  };
  const warnings = [...asArray(preview.warnings), ...asArray(provenance?.warnings)];
  const summary = [
    `Prefilled from extraction template ${template?.name || "template"} v${templateVersion.version}.`,
    `Matched ${report.status === "exact" ? "exactly" : "with an offset"} at ${sheetName}!${range}${offsetText(report.offset)}.`,
    link.linkStatus === "resolved"
      ? `Linked to experiment ${link.candidates[0]?.label || report.experimentLabel}.`
      : report.experimentLabel
        ? `Experiment label ${report.experimentLabel} ${link.linkStatus === "ambiguous" ? "matches several experiments" : "is not in Experiment Browser yet"}; choose the experiment before confirming.`
        : "No experiment label was found; choose the experiment before confirming.",
  ];
  const sourceContentHash = sha256Hex(JSON.stringify({ sourceDocumentId: sourceDocument.id, sheetName, range, inspection: previewRegion.inspection }));
  const dependencyHash = sha256Hex(JSON.stringify({ regionId: region.id, revisionNumber: 1, sourceContentHash, interpretation, templateVersionId: templateVersion.id }));
  const revision = await store.createRegionUnderstandingRevision({
    labId: project.labId,
    projectId: project.id,
    workbookReviewSessionId: session.id,
    sourceDocumentId: sourceDocument.id,
    regionId: region.id,
    revisionNumber: 1,
    trigger: TEMPLATE_MATCH_TRIGGER,
    userFeedback: "",
    summary,
    interpretation,
    sourceRefs: [
      previewRegion.sourceRange?.sourceRef,
      ...asArray(interpretation.series).flatMap((series) => asArray(series.sourceRefs)),
    ].filter(Boolean),
    sourceContentHash,
    dependencyHash,
    validation: { status: preview.blockers.length ? "blocked" : "ready", blockers: preview.blockers },
    provider: { provider: "template_match", templateVersionId: templateVersion.id, templateName: template?.name || null },
    warnings,
    confidence: Number(previewRegion.interpretation?.confidence) || null,
    createdBy: actorUserId,
  });
  const updatedRegion = await store.updateWorkbookReviewRegion(region.id, {
    reviewStatus: "awaiting_review",
    currentRevisionId: revision.id,
    warnings,
    updatedBy: actorUserId,
  });
  return { skipped: false, created: true, reason: "applied", session, sessionCreated, region: updatedRegion, revision, sourceDocumentId: sourceDocument.id };
}

export async function confirmTemplateRegionsBatch({ store, project, actorUserId = null, items = [], identities = [] } = {}) {
  const identityIds = new Set(asArray(identities).map((identity) => identity.id));
  const results = [];
  for (const item of asArray(items).slice(0, 200)) {
    const regionId = text(item?.regionId);
    const result = { regionId, ok: false, code: null, message: "", region: null, revision: null };
    try {
      const region = regionId ? await store.findWorkbookReviewRegionById(regionId) : null;
      if (!region || region.projectId !== project.id) fail("workbook_review_region_not_found", "Workbook review region was not found in this project.", 404);
      if (region.selectionMethod !== TEMPLATE_MATCH_SELECTION_METHOD || !APPLY_ELIGIBLE_STATUSES.includes(region.templateMatch?.status)) {
        fail("batch_confirm_requires_individual_review", "Only template-matched regions with an exact or shifted match can be confirmed in a batch.", 409);
      }
      let current = region;
      let expectedRegionVersion = item.expectedRegionVersion ?? region.version;
      if (item.linkedExperimentId !== undefined && item.linkedExperimentId !== null && text(item.linkedExperimentId) !== text(region.linkedExperimentId)) {
        const requested = text(item.linkedExperimentId);
        if (requested && !identityIds.has(requested)) fail("experiment_identity_not_found", "The chosen experiment does not belong to this project.", 404);
        const expected = Number(item.expectedRegionVersion);
        if (Number.isInteger(expected) && expected !== Number(region.version)) {
          fail("stale_workbook_review_region", "Workbook review region changed; reload before confirming.", 409, { expectedRegionVersion: expected, currentRegionVersion: region.version });
        }
        current = await store.updateWorkbookReviewRegion(region.id, {
          linkedExperimentId: requested || null,
          templateMatch: { ...(region.templateMatch || {}), linkStatus: requested ? "resolved" : "none", linkedBy: actorUserId, linkedAt: new Date().toISOString() },
          updatedBy: actorUserId,
        });
        expectedRegionVersion = current.version;
      }
      const confirmed = await confirmWorkbookReviewRegion({
        store,
        region: current,
        revisionId: item.revisionId || current.currentRevisionId,
        expectedRegionVersion,
        actorUserId,
      });
      result.ok = true;
      result.code = "confirmed";
      result.region = confirmed.region;
      result.revision = confirmed.revision;
    } catch (error) {
      result.code = error?.code || "batch_confirm_failed";
      result.message = error?.message || String(error);
      result.statusCode = error?.statusCode || 500;
    }
    results.push(result);
  }
  return {
    results,
    confirmedCount: results.filter((result) => result.ok).length,
    rejectedCount: results.filter((result) => !result.ok).length,
  };
}
