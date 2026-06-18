import { makeId, sha256Hex } from "./ids.js";
import { readSourceDocumentRange, sourceDocumentSummary, sourceRegionSummary } from "./sourceDocuments.js";

export const SOURCE_EXTRACT_PREVIEW_SCHEMA_VERSION = "labrat.sourceExtractPreview.v1";
export const SOURCE_EXTRACT_PROPOSAL_SCHEMA_VERSION = "labrat.sourceExtractProposal.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function slug(value, fallback = "field") {
  const text = normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function numberFromCell(cell) {
  const value = cell?.rawValue ?? cell?.formattedValue;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = normalizeText(value).replace(/,/g, "").replace(/%$/, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceCellRef({ sourceDocument, sourceRegion, sheetName, cell, fieldId }) {
  return {
    sourceType: "excel_cell",
    sourceDocumentId: sourceDocument.id,
    sourceRegionId: sourceRegion?.id || null,
    fileObjectId: sourceDocument.fileObjectId || null,
    importRunId: sourceDocument.importRunId || null,
    sheet: sheetName,
    cell: cell?.address || null,
    row: cell?.row ?? null,
    col: cell?.col ?? null,
    fieldId,
    rawValue: cell?.rawValue ?? null,
    formattedValue: cell?.formattedValue ?? null,
    formula: cell?.formula || null,
  };
}

function sourceRangeRef({ sourceDocument, sourceRegion, rangeResult }) {
  return {
    sourceType: "excel_range",
    sourceDocumentId: sourceDocument.id,
    sourceRegionId: sourceRegion?.id || null,
    fileObjectId: sourceDocument.fileObjectId || null,
    importRunId: sourceDocument.importRunId || null,
    sheet: rangeResult.sheetName,
    range: rangeResult.range,
  };
}

function cNumberFromHeader(cell) {
  const text = normalizeText(cell?.rawValue ?? cell?.formattedValue);
  const match = text.match(/^C\s*(\d{1,3})$/i);
  return match ? Number(match[1]) : null;
}

function rowLabel(row) {
  const firstText = normalizeText(row?.[0]?.rawValue ?? row?.[0]?.formattedValue);
  return firstText || null;
}

function cHeaderCells(row) {
  return asArray(row).map((cell, index) => ({
    cell,
    index,
    carbonNumber: cNumberFromHeader(cell),
  })).filter((item) => Number.isFinite(item.carbonNumber));
}

function chooseComponentDistributionRows(rows) {
  const headerCandidates = asArray(rows)
    .map((row, index) => ({ row, index, headers: cHeaderCells(row) }))
    .filter((candidate) => candidate.headers.length >= 2);
  if (!headerCandidates.length) return null;
  const headerCandidate = headerCandidates[0];
  const headerIndexes = new Set(headerCandidate.headers.map((header) => header.index));
  const valueCandidates = rows
    .map((row, index) => ({
      row,
      index,
      label: rowLabel(row),
      numericCount: asArray(row).filter((cell, cellIndex) => (
        headerIndexes.has(cellIndex) && numberFromCell(cell) != null
      )).length,
    }))
    .filter((candidate) => candidate.index > headerCandidate.index && candidate.numericCount >= 2)
    .sort((a, b) => {
      const aPreferred = /overall|tots?|total|distribution/i.test(a.label || "") ? 1 : 0;
      const bPreferred = /overall|tots?|total|distribution/i.test(b.label || "") ? 1 : 0;
      return bPreferred - aPreferred || a.index - b.index;
    });
  if (!valueCandidates.length) return null;
  return {
    headerRow: headerCandidate.row,
    headerRowIndex: headerCandidate.index,
    headerCells: headerCandidate.headers,
    valueRow: valueCandidates[0].row,
    valueRowIndex: valueCandidates[0].index,
    valueLabel: valueCandidates[0].label || "Component distribution",
  };
}

function buildComponentDistributionPreview({ sourceDocument, sourceRegion, rangeResult, intent }) {
  const choice = chooseComponentDistributionRows(rangeResult.rows);
  if (!choice) return null;
  const fields = [
    {
      fieldId: "carbon_number",
      label: "C number",
      valueType: "integer",
      semanticRole: "component",
      unit: null,
    },
    {
      fieldId: "percentage",
      label: intent?.yLabel || choice.valueLabel || "Percentage",
      valueType: "number",
      semanticRole: "measurement",
      unit: "%",
    },
  ];
  const rows = choice.headerCells.map(({ cell: headerCell, index, carbonNumber }) => {
    const valueCell = choice.valueRow[index];
    const percentage = numberFromCell(valueCell);
    if (percentage == null) return null;
    const rowId = `component_${carbonNumber}`;
    const sourceRefs = [
      sourceCellRef({ sourceDocument, sourceRegion, sheetName: rangeResult.sheetName, cell: headerCell, fieldId: "carbon_number" }),
      sourceCellRef({ sourceDocument, sourceRegion, sheetName: rangeResult.sheetName, cell: valueCell, fieldId: "percentage" }),
    ];
    return {
      rowId,
      label: `C${carbonNumber}`,
      values: {
        carbon_number: carbonNumber,
        percentage,
      },
      cells: {
        carbon_number: headerCell?.address || null,
        percentage: valueCell?.address || null,
      },
      sourceRefs,
    };
  }).filter(Boolean);
  if (!rows.length) return null;
  const sum = rows.reduce((total, row) => total + (Number(row.values.percentage) || 0), 0);
  const warnings = [];
  if (sum > 0 && (sum < 0.8 || sum > 120)) {
    warnings.push({
      code: "component_distribution_sum_unusual",
      message: `Extracted component distribution values sum to ${Number(sum.toFixed(3))}; review units before charting.`,
    });
  }
  return {
    schemaVersion: SOURCE_EXTRACT_PREVIEW_SCHEMA_VERSION,
    extractType: "component_distribution",
    purpose: intent?.purpose || "chart_source",
    title: intent?.title || `${choice.valueLabel} component distribution`,
    fields,
    rows,
    sourceRefs: [sourceRangeRef({ sourceDocument, sourceRegion, rangeResult })],
    summary: {
      rowCount: rows.length,
      fieldCount: fields.length,
      sourceRowLabel: choice.valueLabel,
      componentMin: Math.min(...rows.map((row) => row.values.carbon_number)),
      componentMax: Math.max(...rows.map((row) => row.values.carbon_number)),
      valueSum: Number(sum.toFixed(6)),
    },
    chartIntentDraft: {
      chartType: "distribution_bar",
      xField: "carbon_number",
      yField: "percentage",
      title: intent?.chartTitle || `${choice.valueLabel} by carbon number`,
    },
    warnings,
  };
}

function buildGenericTablePreview({ sourceDocument, sourceRegion, rangeResult, intent }) {
  const rows = asArray(rangeResult.rows);
  const headerRow = rows[0] || [];
  const fields = headerRow.map((cell, index) => {
    const label = normalizeText(cell?.rawValue ?? cell?.formattedValue) || `Column ${index + 1}`;
    return {
      fieldId: slug(label, `column_${index + 1}`),
      label,
      valueType: "unknown",
      semanticRole: index === 0 ? "label" : "value",
      unit: null,
      sourceRef: sourceCellRef({ sourceDocument, sourceRegion, sheetName: rangeResult.sheetName, cell, fieldId: slug(label, `column_${index + 1}`) }),
    };
  });
  const dataRows = rows.slice(1).map((row, rowIndex) => {
    const values = {};
    const cells = {};
    const sourceRefs = [];
    fields.forEach((field, index) => {
      const cell = row[index] || null;
      values[field.fieldId] = cell?.rawValue ?? cell?.formattedValue ?? null;
      cells[field.fieldId] = cell?.address || null;
      sourceRefs.push(sourceCellRef({ sourceDocument, sourceRegion, sheetName: rangeResult.sheetName, cell, fieldId: field.fieldId }));
    });
    return {
      rowId: `row_${rowIndex + 1}`,
      label: normalizeText(row[0]?.rawValue ?? row[0]?.formattedValue) || `Row ${rowIndex + 1}`,
      values,
      cells,
      sourceRefs,
    };
  });
  return {
    schemaVersion: SOURCE_EXTRACT_PREVIEW_SCHEMA_VERSION,
    extractType: intent?.extractType || "table_range",
    purpose: intent?.purpose || "table_source",
    title: intent?.title || `Source range ${rangeResult.range}`,
    fields,
    rows: dataRows,
    sourceRefs: [sourceRangeRef({ sourceDocument, sourceRegion, rangeResult })],
    summary: {
      rowCount: dataRows.length,
      fieldCount: fields.length,
      sourceRowLabel: null,
    },
    chartIntentDraft: null,
    warnings: fields.length ? [] : [{
      code: "empty_source_extract",
      message: "The selected source range did not contain extractable headers.",
    }],
  };
}

export function buildSourceExtractPreview({ sourceDocument, sourceRegion = null, indexBlobs = [], body = {} }) {
  const intent = isObject(body.intent) ? body.intent : {};
  const sheetName = body.sheetName || sourceRegion?.sheetName || null;
  const range = body.range || sourceRegion?.rangeRef || null;
  const rangeResult = readSourceDocumentRange({
    sourceDocument,
    indexBlobs,
    sheetName,
    range,
    maxCells: body.maxCells,
  });
  const extractType = body.extractType || intent.extractType || sourceRegion?.kind || "table_range";
  const componentPreview = /component_distribution|distribution|c[-_ ]?number/i.test(extractType)
    ? buildComponentDistributionPreview({ sourceDocument, sourceRegion, rangeResult, intent: { ...intent, extractType } })
    : null;
  const preview = componentPreview || buildGenericTablePreview({
    sourceDocument,
    sourceRegion,
    rangeResult,
    intent: { ...intent, extractType },
  });
  return {
    ...preview,
    sourceDocument: sourceDocumentSummary(sourceDocument),
    sourceRegion: sourceRegion ? sourceRegionSummary(sourceRegion) : null,
    range: {
      sourceDocumentId: sourceDocument.id,
      sheetName: rangeResult.sheetName,
      range: rangeResult.range,
      rowCount: rangeResult.rowCount,
      columnCount: rangeResult.columnCount,
      cellCount: rangeResult.cellCount,
    },
  };
}

export function sourceExtractProposalSummary(proposal) {
  return {
    id: proposal.id,
    labId: proposal.labId,
    projectId: proposal.projectId,
    sourceDocumentId: proposal.sourceDocumentId || null,
    sourceRegionId: proposal.sourceRegionId || null,
    datasetCommitId: proposal.datasetCommitId || null,
    schemaVersion: proposal.schemaVersion || SOURCE_EXTRACT_PROPOSAL_SCHEMA_VERSION,
    status: proposal.status || "proposed",
    purpose: proposal.purpose || null,
    extractType: proposal.extractType || null,
    intent: proposal.intent || {},
    preview: proposal.preview || {},
    warnings: proposal.warnings || [],
    decisionSummary: proposal.decisionSummary || {},
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    createdBy: proposal.createdBy,
    updatedBy: proposal.updatedBy,
  };
}

export function chartProposalFromSourceExtract(proposal) {
  const preview = proposal.preview || {};
  const fields = asArray(preview.fields);
  const rows = asArray(preview.rows);
  const xField = fields.find((field) => field.fieldId === "carbon_number") || fields[0] || null;
  const yField = fields.find((field) => field.fieldId === "percentage") || fields[1] || null;
  if (!xField || !yField || !rows.length) {
    const error = new Error("Source extract does not contain enough rows/fields to draft a chart proposal.");
    error.statusCode = 400;
    error.code = "source_extract_not_chartable";
    throw error;
  }
  const chartType = preview.chartIntentDraft?.chartType || (proposal.extractType === "component_distribution" ? "distribution_bar" : "bar");
  const proposalId = `source_extract_chart_${sha256Hex(proposal.id).slice(0, 16)}`;
  const title = preview.chartIntentDraft?.title || preview.title || "Source-backed chart";
  const sourceRefs = [
    ...asArray(preview.sourceRefs),
    ...rows.flatMap((row) => asArray(row.sourceRefs)),
  ];
  return {
    proposalId,
    status: "proposed",
    origin: "source_extract",
    sourceExtractProposalId: proposal.id,
    chartType,
    title,
    x: {
      fieldId: xField.fieldId,
      field: xField.fieldId,
      label: xField.label,
      unit: xField.unit || null,
      sourceIds: rows.map((row) => `${row.rowId}:${xField.fieldId}`),
    },
    y: {
      fieldId: yField.fieldId,
      field: yField.fieldId,
      label: yField.label,
      unit: yField.unit || null,
      sourceIds: rows.map((row) => `${row.rowId}:${yField.fieldId}`),
    },
    sourceSnapshot: {
      schemaVersion: SOURCE_EXTRACT_PREVIEW_SCHEMA_VERSION,
      fields,
      rows,
      summary: preview.summary || {},
      sourceRefs: preview.sourceRefs || [],
    },
    chartSpecDraft: {
      schemaVersion: "labrat.chartSpec.v1.4",
      origin: "source_extract",
      sourceExtractProposalId: proposal.id,
      datasetCommitId: null,
      chartType,
      title,
      x: {
        fieldId: xField.fieldId,
        field: xField.fieldId,
        label: xField.label,
        unit: xField.unit || null,
      },
      y: {
        fieldId: yField.fieldId,
        field: yField.fieldId,
        label: yField.label,
        unit: yField.unit || null,
      },
      sourceSnapshot: {
        fields,
        rows,
      },
      sourceRefs,
    },
    sourceRefs,
    confidence: 0.86,
    rationale: "Drafted from an accepted source extract proposal with cell-level source refs.",
    warnings: asArray(proposal.warnings),
    requiresReview: true,
  };
}
