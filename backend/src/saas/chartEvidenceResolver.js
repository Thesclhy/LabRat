import { decodeRange, encodeRange } from "../import/utils/excelAddress.js";
import { normalizeEvidenceText } from "../charts/services/chartEvidenceIntent.js";
import { buildSourceExtractPreview, SOURCE_EXTRACT_PREVIEW_SCHEMA_VERSION, sourceExtractProposalSummary } from "./sourceExtracts.js";

export const EVIDENCE_RESOLUTION_SCHEMA_VERSION = "labrat.evidenceResolution.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function decodeRangeSafe(rangeRef) {
  try {
    const range = decodeRange(String(rangeRef || ""));
    return {
      startRow: range.s.r,
      endRow: range.e.r,
      startCol: range.s.c,
      endCol: range.e.c,
      rangeRef: encodeRange(range),
      area: (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1),
    };
  } catch {
    return null;
  }
}

function containsRange(containerRef, childRef) {
  const container = decodeRangeSafe(containerRef);
  const child = decodeRangeSafe(childRef);
  if (!container || !child) return false;
  return container.startRow <= child.startRow
    && container.endRow >= child.endRow
    && container.startCol <= child.startCol
    && container.endCol >= child.endCol;
}

function clarification(code, message, options = []) {
  return { code, message, options };
}

function unique(values) {
  return [...new Set(asArray(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function documentText(sourceDocument) {
  return normalizeEvidenceText([
    sourceDocument?.metadata?.workbookName,
    sourceDocument?.metadata?.fileName,
    ...asArray(sourceDocument?.metadata?.sheetNames),
  ].join(" "));
}

function normalizedIncludes(haystack, needle) {
  const normalizedNeedle = normalizeEvidenceText(needle);
  if (!normalizedNeedle) return false;
  if (haystack.includes(normalizedNeedle)) return true;
  return haystack.replace(/\s+/g, "").includes(normalizedNeedle.replace(/\s+/g, ""));
}

function experimentAliasesFromText(value) {
  const aliases = [];
  const re = /(?:^|[^a-z0-9])exp(?:eriment)?[^0-9]*0*([0-9]+)\b/gi;
  let match = re.exec(String(value || ""));
  while (match) {
    aliases.push(`Exp${Number(match[1])}`);
    match = re.exec(String(value || ""));
  }
  const calcRe = /(?:^|[^a-z0-9])calc(?:ulation)?[^0-9]*(?:exp[^0-9]*)?0*([0-9]+)\b/gi;
  match = calcRe.exec(String(value || ""));
  while (match) {
    aliases.push(`Exp${Number(match[1])}`);
    match = calcRe.exec(String(value || ""));
  }
  return unique(aliases);
}

function sourceDocumentExperimentAliases(sourceDocument) {
  return experimentAliasesFromText([
    sourceDocument?.metadata?.workbookName,
    sourceDocument?.metadata?.fileName,
    ...asArray(sourceDocument?.metadata?.sheetNames),
  ].join(" "));
}

function workbookHintAliases(evidenceIntent) {
  const hint = normalizeText(evidenceIntent.workbookHint);
  if (!hint) return [];
  const aliases = [hint];
  const match = hint.match(/(?:exp|experiment|calculation|calc)?\s*0*([0-9]+)/i);
  if (match) {
    const number = Number(match[1]);
    aliases.push(
      `calculation${number}`,
      `calculation ${number}`,
      `calculation exp${number}`,
      `exp${number} calculation`,
      `Calculation_Exp${number}`,
    );
  }
  if (/^calcs?$/i.test(hint)) aliases.push("calculation");
  return unique(aliases);
}

function documentScore(sourceDocument, evidenceIntent) {
  const haystack = documentText(sourceDocument);
  const aliases = asArray(evidenceIntent.targetExperimentAliases).map(normalizeEvidenceText).filter(Boolean);
  const sheetName = normalizeEvidenceText(evidenceIntent.sheetName);
  let score = 0;
  aliases.forEach((alias) => {
    if (normalizedIncludes(haystack, alias)) score += 20;
  });
  workbookHintAliases(evidenceIntent).forEach((alias) => {
    if (normalizedIncludes(haystack, alias)) score += 12;
  });
  if (sheetName && normalizedIncludes(haystack, sheetName)) score += 4;
  if (/\b(calculation|source|gc|distribution|carbon)\b/.test(haystack)) score += 1;
  return score;
}

function bestSourceDocument(sourceDocuments, evidenceIntent) {
  if (!sourceDocuments.length) {
    return {
      clarification: clarification(
        "source_document_not_found",
        evidenceIntent.targetExperimentAliases?.length
          ? `No indexed source workbook matched ${evidenceIntent.targetExperimentAliases.join(", ")}.`
          : "No indexed source workbook is available for this source-range chart request.",
      ),
    };
  }
  const scored = sourceDocuments
    .map((sourceDocument) => ({ sourceDocument, score: documentScore(sourceDocument, evidenceIntent) }))
    .sort((a, b) => b.score - a.score || String(b.sourceDocument.updatedAt).localeCompare(String(a.sourceDocument.updatedAt)));
  const strongest = scored[0];
  const explicitHints = asArray(evidenceIntent.targetExperimentAliases).length || evidenceIntent.workbookHint || evidenceIntent.sheetName;
  if (sourceDocuments.length === 1 && (!explicitHints || strongest.score >= 0)) {
    return { sourceDocument: sourceDocuments[0] };
  }
  if (explicitHints && strongest.score <= 0) {
    return {
      clarification: clarification(
        "source_document_not_found",
        evidenceIntent.targetExperimentAliases?.length
          ? `No indexed source workbook matched ${evidenceIntent.targetExperimentAliases.join(", ")}.`
          : "No indexed source workbook matched the requested source evidence.",
      ),
    };
  }
  const tied = scored.filter((item) => item.score === strongest.score);
  if (tied.length > 1) {
    return {
      clarification: clarification(
        "source_document_ambiguous",
        evidenceIntent.range
          ? `Which workbook contains ${evidenceIntent.range}?`
          : "Which workbook contains the requested source evidence?",
        tied.slice(0, 5).map((item) => ({
          label: item.sourceDocument.metadata?.workbookName || item.sourceDocument.metadata?.fileName || item.sourceDocument.id,
          value: item.sourceDocument.id,
        })),
      ),
    };
  }
  return { sourceDocument: strongest.sourceDocument };
}

function sheetsFromIndexBlobs(indexBlobs) {
  return asArray(indexBlobs).flatMap((blob) => asArray(blob.payload?.sheets));
}

function sheetNameForEvidence({ evidenceIntent, sourceDocument, sourceRegions, indexBlobs }) {
  if (evidenceIntent.sheetName) return { sheetName: evidenceIntent.sheetName };
  const metadataSheetNames = asArray(sourceDocument.metadata?.sheetNames).filter(Boolean);
  const indexSheetNames = sheetsFromIndexBlobs(indexBlobs).map((sheet) => sheet.name).filter(Boolean);
  const sheetNames = [...new Set([...metadataSheetNames, ...indexSheetNames])];
  if (evidenceIntent.range) {
    const containing = sourceRegions.filter((region) => (
      region.rangeRef && containsRange(region.rangeRef, evidenceIntent.range)
    ));
    const containingSheets = [...new Set(containing.map((region) => region.sheetName).filter(Boolean))];
    if (containingSheets.length === 1) return { sheetName: containingSheets[0] };
  }
  if (sheetNames.length === 1) return { sheetName: sheetNames[0] };
  return {
    clarification: clarification(
      "source_sheet_ambiguous",
      evidenceIntent.range
        ? `Which sheet contains ${evidenceIntent.range}?`
        : "Which sheet contains the requested source evidence?",
      sheetNames.slice(0, 8).map((sheetName) => ({ label: sheetName, value: sheetName })),
    ),
  };
}

function sourceRegionForEvidence({ evidenceIntent, sheetName, sourceRegions }) {
  const sheetRegions = sourceRegions.filter((region) => !sheetName || normalizeLower(region.sheetName) === normalizeLower(sheetName));
  if (evidenceIntent.range) {
    return sheetRegions
      .filter((region) => region.rangeRef && containsRange(region.rangeRef, evidenceIntent.range))
      .sort((a, b) => (decodeRangeSafe(a.rangeRef)?.area || Number.MAX_SAFE_INTEGER) - (decodeRangeSafe(b.rangeRef)?.area || Number.MAX_SAFE_INTEGER))[0] || null;
  }
  const rowIndex = Number(evidenceIntent.rowNumber) - 1;
  if (!Number.isInteger(rowIndex) || rowIndex < 0) return sheetRegions[0] || null;
  return sheetRegions.find((region) => (
    Number.isInteger(region.startRow)
    && Number.isInteger(region.endRow)
    && region.startRow <= rowIndex
    && region.endRow >= rowIndex
  )) || sheetRegions[0] || null;
}

function rangeForEvidence(evidenceIntent, sourceRegion) {
  if (evidenceIntent.range) return evidenceIntent.range;
  const rowIndex = Number(evidenceIntent.rowNumber) - 1;
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || !sourceRegion) return sourceRegion?.rangeRef || "";
  const startCol = Number.isInteger(sourceRegion.startCol) ? sourceRegion.startCol : 0;
  const endCol = Number.isInteger(sourceRegion.endCol) ? sourceRegion.endCol : startCol;
  const headerRow = Math.max(sourceRegion.startRow ?? 0, rowIndex - 1);
  return encodeRange({
    s: { r: headerRow, c: startCol },
    e: { r: rowIndex, c: endCol },
  });
}

function resolutionBase(evidenceIntent, status, extra = {}) {
  return {
    schemaVersion: EVIDENCE_RESOLUTION_SCHEMA_VERSION,
    status,
    sourceKind: evidenceIntent.sourceKind,
    extractType: evidenceIntent.extractType,
    evidenceIntent,
    ...extra,
  };
}

function sheetNamesForDocument(sourceDocument, indexBlobs) {
  const metadataSheetNames = asArray(sourceDocument.metadata?.sheetNames).filter(Boolean);
  const indexSheetNames = sheetsFromIndexBlobs(indexBlobs).map((sheet) => sheet.name).filter(Boolean);
  return [...new Set([...metadataSheetNames, ...indexSheetNames])];
}

function isUsablePreviewForEvidence(preview, evidenceIntent) {
  if (!preview) return false;
  if (evidenceIntent.extractType === "component_distribution") {
    const fields = new Set(asArray(preview.fields).map((field) => field?.fieldId));
    return preview.extractType === "component_distribution"
      && fields.has("carbon_number")
      && fields.has("percentage")
      && asArray(preview.rows).some((row) => (
        Number.isFinite(Number(row?.values?.carbon_number))
        && Number.isFinite(Number(row?.values?.percentage))
      ));
  }
  return asArray(preview.fields).length > 0 || asArray(preview.rows).length > 0;
}

function buildPreviewForEvidence({ evidenceIntent, sourceDocument, sourceRegion, indexBlobs, sheetName }) {
  const range = rangeForEvidence(evidenceIntent, sourceRegion);
  return buildSourceExtractPreview({
    sourceDocument,
    sourceRegion,
    indexBlobs,
    body: {
      extractType: evidenceIntent.extractType || "table_range",
      sheetName,
      range,
      intent: {
        extractType: evidenceIntent.extractType || "table_range",
        title: asArray(evidenceIntent.targetExperimentAliases).length
          ? `${evidenceIntent.targetExperimentAliases[0]} source extract`
          : "Source extract",
        chartTitle: asArray(evidenceIntent.targetExperimentAliases).length
          ? `${evidenceIntent.targetExperimentAliases[0]} carbon number distribution`
          : "Carbon number distribution",
        purpose: "chart_source",
      },
    },
  });
}

function unresolvedSourceExtractClarification({ evidenceIntent, sourceDocument, range, sheetName }) {
  const workbook = sourceDocument?.metadata?.workbookName || sourceDocument?.metadata?.fileName || "the selected workbook";
  return clarification(
    "source_extract_unresolved",
    `Source range ${range || evidenceIntent.range || "the requested range"} in ${workbook}${sheetName ? ` sheet ${sheetName}` : ""} did not validate as a C-number/component distribution.`,
  );
}

async function sourceContextForDocument(context, sourceDocument) {
  const sourceRegions = context.store.listSourceRegions
    ? await context.store.listSourceRegions({ sourceDocumentId: sourceDocument.id })
    : [];
  const indexBlobs = context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  return { sourceRegions, indexBlobs };
}

function resolvePreviewFromDocument({ evidenceIntent, sourceDocument, sourceRegions, indexBlobs }) {
  const sheetNames = sheetNamesForDocument(sourceDocument, indexBlobs);
  if (evidenceIntent.sheetName) {
    const sourceRegion = sourceRegionForEvidence({ evidenceIntent, sheetName: evidenceIntent.sheetName, sourceRegions });
    const range = rangeForEvidence(evidenceIntent, sourceRegion);
    try {
      const sourceExtractPreview = buildPreviewForEvidence({
        evidenceIntent,
        sourceDocument,
        sourceRegion,
        indexBlobs,
        sheetName: evidenceIntent.sheetName,
      });
      if (!isUsablePreviewForEvidence(sourceExtractPreview, evidenceIntent)) {
        const unresolved = unresolvedSourceExtractClarification({
          evidenceIntent,
          sourceDocument,
          range: sourceExtractPreview.range?.range || range,
          sheetName: evidenceIntent.sheetName,
        });
        return { clarification: unresolved, sourceExtractPreview, sourceRegion, sheetName: evidenceIntent.sheetName, range };
      }
      return { sourceExtractPreview, sourceRegion, sheetName: sourceExtractPreview.range?.sheetName || evidenceIntent.sheetName, range: sourceExtractPreview.range?.range || range };
    } catch (error) {
      return {
        clarification: clarification(
          error.code || "source_evidence_unresolved",
          error.message || "The requested source evidence could not be resolved.",
        ),
        sourceRegion,
        sheetName: evidenceIntent.sheetName,
        range,
      };
    }
  }

  const containing = evidenceIntent.range
    ? sourceRegions.filter((region) => region.rangeRef && containsRange(region.rangeRef, evidenceIntent.range))
    : [];
  const containingSheets = [...new Set(containing.map((region) => region.sheetName).filter(Boolean))];
  const candidateSheets = containingSheets.length ? containingSheets : sheetNames;
  if (!candidateSheets.length) {
    return {
      clarification: clarification(
        "source_sheet_not_found",
        evidenceIntent.range
          ? `No indexed sheet is available for ${evidenceIntent.range}.`
          : "No indexed sheet is available for the requested source evidence.",
      ),
    };
  }

  const attempts = candidateSheets.map((sheetName) => {
    const sourceRegion = sourceRegionForEvidence({ evidenceIntent, sheetName, sourceRegions });
    const range = rangeForEvidence(evidenceIntent, sourceRegion);
    try {
      const sourceExtractPreview = buildPreviewForEvidence({
        evidenceIntent,
        sourceDocument,
        sourceRegion,
        indexBlobs,
        sheetName,
      });
      return {
        sheetName: sourceExtractPreview.range?.sheetName || sheetName,
        sourceRegion,
        range: sourceExtractPreview.range?.range || range,
        sourceExtractPreview,
        usable: isUsablePreviewForEvidence(sourceExtractPreview, evidenceIntent),
      };
    } catch (error) {
      return { sheetName, sourceRegion, range, error };
    }
  });
  const usable = attempts.filter((attempt) => attempt.usable);
  if (usable.length === 1) return usable[0];
  if (usable.length > 1) {
    return {
      clarification: clarification(
        "source_sheet_ambiguous",
        evidenceIntent.range
          ? `Which sheet contains ${evidenceIntent.range}?`
          : "Which sheet contains the requested source evidence?",
        usable.slice(0, 8).map((attempt) => ({ label: attempt.sheetName, value: attempt.sheetName })),
      ),
      ambiguousAttempts: usable,
    };
  }
  if (candidateSheets.length > 1 && evidenceIntent.extractType !== "component_distribution") {
    return {
      clarification: clarification(
        "source_sheet_ambiguous",
        evidenceIntent.range
          ? `Which sheet contains ${evidenceIntent.range}?`
          : "Which sheet contains the requested source evidence?",
        candidateSheets.slice(0, 8).map((sheetName) => ({ label: sheetName, value: sheetName })),
      ),
    };
  }
  const first = attempts[0] || {};
  return {
    clarification: unresolvedSourceExtractClarification({
      evidenceIntent,
      sourceDocument,
      range: first.sourceExtractPreview?.range?.range || first.range || evidenceIntent.range,
      sheetName: first.sheetName,
    }),
    sourceExtractPreview: first.sourceExtractPreview || null,
    sourceRegion: first.sourceRegion || null,
    sheetName: first.sheetName || null,
    range: first.range || evidenceIntent.range || "",
  };
}

async function resolveSingleEvidenceIntent({ context, project, evidenceIntent, sourceDocument = null }) {
  const documentChoice = sourceDocument
    ? { sourceDocument }
    : bestSourceDocument(
      context.store.listSourceDocuments
        ? await context.store.listSourceDocuments({ projectId: project.id })
        : [],
      evidenceIntent,
    );
  if (documentChoice.clarification) {
    return {
      evidenceResolution: resolutionBase(evidenceIntent, "needs_clarification", { clarification: documentChoice.clarification }),
      clarification: documentChoice.clarification,
      sourceExtractPreview: null,
    };
  }
  const chosenDocument = documentChoice.sourceDocument;
  const { sourceRegions, indexBlobs } = await sourceContextForDocument(context, chosenDocument);
  const previewChoice = resolvePreviewFromDocument({ evidenceIntent, sourceDocument: chosenDocument, sourceRegions, indexBlobs });
  if (previewChoice.clarification) {
    return {
      evidenceResolution: resolutionBase(evidenceIntent, "needs_clarification", {
        sourceDocumentId: chosenDocument.id,
        sourceRegionId: previewChoice.sourceRegion?.id || null,
        sheetName: previewChoice.sheetName || null,
        range: previewChoice.range || evidenceIntent.range || "",
        clarification: previewChoice.clarification,
      }),
      clarification: previewChoice.clarification,
      sourceDocument: chosenDocument,
      sourceRegion: previewChoice.sourceRegion || null,
      sourceExtractPreview: previewChoice.sourceExtractPreview || null,
    };
  }
  return {
    evidenceResolution: resolutionBase(evidenceIntent, "resolved", {
      sourceDocumentId: chosenDocument.id,
      sourceRegionId: previewChoice.sourceRegion?.id || null,
      sheetName: previewChoice.sheetName,
      range: previewChoice.range,
      rowCount: previewChoice.sourceExtractPreview.range?.rowCount ?? null,
      columnCount: previewChoice.sourceExtractPreview.range?.columnCount ?? null,
    }),
    clarification: null,
    sourceDocument: chosenDocument,
    sourceRegion: previewChoice.sourceRegion || null,
    sourceExtractPreview: previewChoice.sourceExtractPreview,
  };
}

function experimentIndexFromIdentities(identities = []) {
  const byAlias = new Map();
  asArray(identities).forEach((identity) => {
    const labels = unique([
      identity?.canonicalLabel,
      identity?.id,
      ...asArray(identity?.aliases),
      ...experimentAliasesFromText([identity?.canonicalLabel, ...asArray(identity?.aliases)].join(" ")),
    ]);
    labels.forEach((label) => {
      byAlias.set(normalizeEvidenceText(label).replace(/\s+/g, ""), identity);
    });
  });
  return {
    find(alias) {
      const key = normalizeEvidenceText(alias).replace(/\s+/g, "");
      return byAlias.get(key) || null;
    },
  };
}

async function publishedExperimentIndex(context, project) {
  const identities = context.store.listExperimentIdentities
    ? await context.store.listExperimentIdentities({ projectId: project.id })
    : [];
  return experimentIndexFromIdentities(identities);
}

function isCrossCompareEvidenceIntent(evidenceIntent) {
  return evidenceIntent?.chartTask === "cross_compare"
    && evidenceIntent?.seriesBy === "experiment"
    && (evidenceIntent.scope === "selected_experiments" || evidenceIntent.scope === "all_matching_experiments");
}

function sourceDocumentMatchesGeneralHint(sourceDocument, evidenceIntent) {
  const hintAliases = workbookHintAliases(evidenceIntent);
  if (!hintAliases.length) return true;
  const haystack = documentText(sourceDocument);
  return hintAliases.some((alias) => normalizedIncludes(haystack, alias));
}

function documentForAlias(sourceDocuments, evidenceIntent, alias) {
  const scopedIntent = {
    ...evidenceIntent,
    targetExperimentAliases: [alias],
  };
  const aliasCandidates = sourceDocuments.filter((sourceDocument) => (
    sourceDocumentExperimentAliases(sourceDocument).includes(alias)
    || normalizedIncludes(documentText(sourceDocument), alias)
  ));
  if (!aliasCandidates.length) {
    return {
      clarification: clarification(
        "source_document_not_found",
        `No calculation source workbook matched ${alias}.`,
      ),
    };
  }
  return bestSourceDocument(aliasCandidates, scopedIntent);
}

function sourceRefsFromPreview(preview) {
  return [
    ...asArray(preview?.sourceRefs),
    ...asArray(preview?.rows).flatMap((row) => asArray(row.sourceRefs)),
  ];
}

function rangeSummaryForPreview(preview) {
  return {
    sourceDocumentId: preview?.range?.sourceDocumentId || null,
    sheetName: preview?.range?.sheetName || null,
    range: preview?.range?.range || null,
    rowCount: preview?.range?.rowCount ?? null,
    columnCount: preview?.range?.columnCount ?? null,
    cellCount: preview?.range?.cellCount ?? null,
  };
}

function buildSeriesSourceExtractPreview({ evidenceIntent, resolvedSeries, skipped }) {
  const firstPreview = resolvedSeries[0]?.sourceExtractPreview || {};
  const fields = asArray(firstPreview.fields);
  const series = resolvedSeries.map((item) => ({
    seriesId: `series_${normalizeEvidenceText(item.experimentAlias).replace(/\s+/g, "_") || item.experimentId || item.sourceDocument.id}`,
    experimentId: item.experimentId,
    experimentAlias: item.experimentAlias,
    experimentLabel: item.experimentLabel || item.experimentAlias,
    sourceDocumentId: item.sourceDocument.id,
    sourceRegionId: item.sourceRegion?.id || null,
    sourceDocument: {
      id: item.sourceDocument.id,
      metadata: item.sourceDocument.metadata || {},
    },
    range: rangeSummaryForPreview(item.sourceExtractPreview),
    rows: asArray(item.sourceExtractPreview.rows),
    sourceRefs: sourceRefsFromPreview(item.sourceExtractPreview),
    summary: item.sourceExtractPreview.summary || {},
  }));
  const warnings = [
    ...asArray(firstPreview.warnings),
    ...asArray(skipped).map((item) => ({
      code: "skipped_source_extract_series",
      message: `${item.experimentAlias || "A source workbook"} was skipped for ${evidenceIntent.range || "the requested range"}: ${item.message || item.code}.`,
      severity: "warning",
      experimentAlias: item.experimentAlias || null,
    })),
  ];
  return {
    schemaVersion: SOURCE_EXTRACT_PREVIEW_SCHEMA_VERSION,
    extractType: "component_distribution_series",
    purpose: "chart_source",
    title: "Carbon number distribution cross-compare",
    fields,
    series,
    sourceRefs: series.flatMap((item) => asArray(item.sourceRefs)),
    summary: {
      seriesCount: series.length,
      rowCount: series.reduce((total, item) => total + asArray(item.rows).length, 0),
      fieldCount: fields.length,
    },
    chartIntentDraft: {
      chartType: "distribution_bar",
      xField: "carbon_number",
      yField: "percentage",
      title: "Carbon Balance Distribution Cross-Compare",
    },
    warnings,
  };
}

async function resolveMultiSourceEvidenceIntent({ context, project, evidenceIntent }) {
  const sourceDocuments = context.store.listSourceDocuments
    ? await context.store.listSourceDocuments({ projectId: project.id })
    : [];
  if (!sourceDocuments.length) {
    const missing = clarification(
      "source_document_not_found",
      "No indexed source workbook is available for this source-range cross-compare chart request.",
    );
    return {
      evidenceResolution: resolutionBase(evidenceIntent, "needs_clarification", { clarification: missing }),
      clarification: missing,
      sourceExtractPreview: null,
    };
  }
  const experimentIndex = await publishedExperimentIndex(context, project);
  const selectedAliases = asArray(evidenceIntent.targetExperimentAliases);
  const allMatching = evidenceIntent.scope === "all_matching_experiments";
  const aliases = allMatching
    ? unique(sourceDocuments
      .filter((sourceDocument) => sourceDocumentMatchesGeneralHint(sourceDocument, evidenceIntent))
      .flatMap(sourceDocumentExperimentAliases))
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }))
    : selectedAliases;

  if (!aliases.length) {
    const missing = clarification(
      "source_document_not_found",
      "No experiment-specific calculation workbook matched this source-range cross-compare request.",
    );
    return {
      evidenceResolution: resolutionBase(evidenceIntent, "needs_clarification", { clarification: missing }),
      clarification: missing,
      sourceExtractPreview: null,
    };
  }

  const resolvedSeries = [];
  const skipped = [];
  for (const alias of aliases) {
    const documentChoice = documentForAlias(sourceDocuments, evidenceIntent, alias);
    if (documentChoice.clarification || !documentChoice.sourceDocument) {
      skipped.push({ experimentAlias: alias, code: "source_document_not_found", message: `No calculation source workbook matched ${alias}.` });
      continue;
    }
    const scopedIntent = { ...evidenceIntent, targetExperimentAliases: [alias] };
    const single = await resolveSingleEvidenceIntent({
      context,
      project,
      evidenceIntent: scopedIntent,
      sourceDocument: documentChoice.sourceDocument,
    });
    if (single.clarification || !single.sourceExtractPreview) {
      skipped.push({
        experimentAlias: alias,
        code: single.clarification?.code || "source_extract_unresolved",
        message: single.clarification?.message || "The source extract could not be resolved.",
      });
      continue;
    }
    const experiment = experimentIndex.find(alias);
    resolvedSeries.push({
      experimentAlias: alias,
      experimentId: experiment?.id || `exp_${String(alias).replace(/^Exp/i, "")}`,
      experimentLabel: experiment?.canonicalLabel || alias,
      sourceDocument: single.sourceDocument,
      sourceRegion: single.sourceRegion,
      sourceExtractPreview: single.sourceExtractPreview,
    });
  }

  if (!allMatching && skipped.length) {
    const firstMissing = skipped.find((item) => item.code === "source_document_not_found") || skipped[0];
    const error = clarification(
      firstMissing.code || "source_extract_unresolved",
      firstMissing.message || "A requested experiment could not be resolved from source evidence.",
    );
    return {
      evidenceResolution: resolutionBase(evidenceIntent, "needs_clarification", {
        clarification: error,
        missingExperimentAliases: skipped.map((item) => item.experimentAlias),
        skipped,
      }),
      clarification: error,
      sourceExtractPreview: null,
    };
  }

  if (resolvedSeries.length < 2) {
    const error = clarification(
      "insufficient_cross_compare_series",
      `I found fewer than two resolved source series for a cross-compare chart from ${evidenceIntent.range || "the requested source range"}.`,
    );
    return {
      evidenceResolution: resolutionBase(evidenceIntent, "needs_clarification", {
        clarification: error,
        resolvedSeriesCount: resolvedSeries.length,
        skipped,
      }),
      clarification: error,
      sourceExtractPreview: null,
    };
  }

  const sourceExtractPreview = buildSeriesSourceExtractPreview({ evidenceIntent, resolvedSeries, skipped });
  return {
    evidenceResolution: resolutionBase(evidenceIntent, "resolved", {
      mode: "multi_source_series",
      series: resolvedSeries.map((item) => ({
        experimentAlias: item.experimentAlias,
        experimentId: item.experimentId,
        sourceDocumentId: item.sourceDocument.id,
        sourceRegionId: item.sourceRegion?.id || null,
        sheetName: item.sourceExtractPreview.range?.sheetName || null,
        range: item.sourceExtractPreview.range?.range || evidenceIntent.range || "",
      })),
      skipped,
    }),
    clarification: null,
    sourceDocument: null,
    sourceRegion: null,
    sourceExtractPreview,
  };
}

export async function resolveChartEvidenceIntent({ context, project, evidenceIntent }) {
  if (!isObject(evidenceIntent)) {
    return {
      evidenceResolution: resolutionBase({}, "not_applicable"),
      clarification: null,
      sourceExtractPreview: null,
    };
  }
  if (isCrossCompareEvidenceIntent(evidenceIntent)) {
    return resolveMultiSourceEvidenceIntent({ context, project, evidenceIntent });
  }
  return resolveSingleEvidenceIntent({ context, project, evidenceIntent });
}

export async function createSourceExtractProposalFromEvidence({
  context,
  project,
  sourceDocument,
  sourceRegion = null,
  sourceExtractPreview,
  evidenceIntent,
  createdBy,
  recordAudit = true,
}) {
  const sourceDocumentId = sourceDocument?.id || sourceExtractPreview?.range?.sourceDocumentId || null;
  const proposal = await context.store.createSourceExtractProposal({
    labId: project.labId,
    projectId: project.id,
    sourceDocumentId,
    sourceRegionId: sourceRegion?.id || null,
    status: "proposed",
    purpose: sourceExtractPreview.purpose || "chart_source",
    extractType: sourceExtractPreview.extractType || evidenceIntent.extractType || "table_range",
    intent: {
      evidenceIntent,
      title: sourceExtractPreview.title,
      chartTitle: sourceExtractPreview.chartIntentDraft?.title || sourceExtractPreview.title,
    },
    preview: sourceExtractPreview,
    warnings: sourceExtractPreview.warnings || [],
    decisionSummary: {},
    createdBy,
  });
  if (recordAudit) {
    await context.store.recordAuditEvent({
      labId: project.labId,
      projectId: project.id,
      actorUserId: createdBy,
      action: "source.extract.propose",
      targetType: "source_extract_proposal",
      targetId: proposal.id,
      summary: `Created source extract proposal ${proposal.extractType || proposal.id}.`,
      metadata: {
        sourceDocumentId,
        sourceRegionId: sourceRegion?.id || null,
        extractType: proposal.extractType || null,
        evidenceIntent,
      },
    });
  }
  return sourceExtractProposalSummary(proposal);
}
