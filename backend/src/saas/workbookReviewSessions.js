export const WORKBOOK_REVIEW_SESSION_SCHEMA_VERSION = "labrat.workbookReviewSession.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function sourceRegionRange(region) {
  return text(region?.range || region?.rangeRef || region?.range_ref);
}

function sourceRegionSheet(region) {
  return text(region?.sheetName || region?.sheet_name || region?.sheet);
}

function detectedSemanticType(region) {
  const value = text(region?.semanticType || region?.kind).toLowerCase();
  if (/rate.*time|time.*rate/.test(value)) return "reaction_rate_time_series";
  if (/experiment|table/.test(value)) return "experiment_table";
  if (/metadata|note/.test(value)) return "metadata_notes";
  return "generic_table";
}

function detectedCandidateRegions(sourceDocument, regions) {
  return asArray(regions).flatMap((region) => {
    const sheetName = sourceRegionSheet(region);
    const range = sourceRegionRange(region);
    if (!sourceDocument?.id || !sheetName || !range) return [];
    return [{
      sourceRegionId: region.id || null,
      sourceDocumentId: sourceDocument.id,
      sheetName,
      range,
      selectionMethod: "detected_region",
      description: text(region.description || region.label || region.summary),
      semanticType: detectedSemanticType(region),
      confidence: typeof region.confidence === "number" ? region.confidence : null,
      warnings: asArray(region.warnings),
    }];
  });
}

export function buildWorkbookReviewSessionDraft({ sourceDocument, regions = [] } = {}) {
  const metadata = cleanObject(sourceDocument?.metadata);
  const summary = cleanObject(sourceDocument?.summary);
  const sheets = asArray(metadata.sheets);
  const workbookName = metadata.workbookName || metadata.fileName || sourceDocument?.id || "workbook";
  const nonEmptyCellCount = Number(summary.nonEmptyCellCount) || 0;
  const candidateRegions = detectedCandidateRegions(sourceDocument, regions);
  const assistantMessage = [
    `I indexed ${workbookName}.`,
    `I found ${sheets.length || metadata.sheetCount || 0} sheet(s), ${candidateRegions.length} detected source region(s), and ${nonEmptyCellCount} non-empty cell(s).`,
  ].join(" ");
  return {
    schemaVersion: WORKBOOK_REVIEW_SESSION_SCHEMA_VERSION,
    status: "needs_user_review",
    workbookSummary: {
      sourceDocumentId: sourceDocument?.id || null,
      workbookName,
      documentType: sourceDocument?.documentType || "excel_workbook",
      sheetCount: sheets.length || metadata.sheetCount || 0,
      sheets,
      regionCount: candidateRegions.length,
      nonEmptyCellCount,
      warningCount: asArray(sourceDocument?.warnings).length
        + asArray(regions).reduce((total, region) => total + asArray(region?.warnings).length, 0),
    },
    candidateRegions,
    messages: [{
      id: "assistant_initial_summary",
      role: "assistant",
      content: assistantMessage,
      createdAt: new Date().toISOString(),
      metadata: { provider: "deterministic", source: "source_document_summary" },
    }],
    warnings: asArray(sourceDocument?.warnings),
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
    messages: asArray(session.messages),
    warnings: asArray(session.warnings),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    createdBy: session.createdBy,
    updatedBy: session.updatedBy,
  };
}
