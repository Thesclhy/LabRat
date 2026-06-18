import { decodeRange, encodeCell, encodeRange } from "../import/utils/excelAddress.js";
import { makeId, sha256Hex } from "./ids.js";

export const SOURCE_INDEX_VERSION = "labrat.sourceIndex.v1";
export const SOURCE_DOCUMENT_LIST_SCHEMA_VERSION = "labrat.sourceDocumentList.v1";
export const SOURCE_REGION_LIST_SCHEMA_VERSION = "labrat.sourceRegionList.v1";
export const SOURCE_QUERY_SCHEMA_VERSION = "labrat.sourceQuery.v1";
export const SOURCE_RANGE_SCHEMA_VERSION = "labrat.sourceRange.v1";

const DEFAULT_QUERY_LIMIT = 25;
const MAX_QUERY_LIMIT = 100;
const DEFAULT_RANGE_MAX_CELLS = 500;

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

function limitNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function safeDecodeRange(rangeRef) {
  if (!rangeRef) return null;
  try {
    const range = decodeRange(rangeRef);
    return {
      startRow: range.s.r,
      endRow: range.e.r,
      startCol: range.s.c,
      endCol: range.e.c,
      rangeRef: encodeRange(range),
    };
  } catch {
    return null;
  }
}

function regionBoundsFromCells(cells = []) {
  const usable = asArray(cells).filter((cell) => (
    Number.isInteger(cell?.row) && Number.isInteger(cell?.col)
  ));
  if (!usable.length) return null;
  const rows = usable.map((cell) => cell.row);
  const cols = usable.map((cell) => cell.col);
  const startRow = Math.min(...rows);
  const endRow = Math.max(...rows);
  const startCol = Math.min(...cols);
  const endCol = Math.max(...cols);
  return {
    startRow,
    endRow,
    startCol,
    endCol,
    rangeRef: encodeRange({ s: { r: startRow, c: startCol }, e: { r: endRow, c: endCol } }),
  };
}

function sourceRefFor({ fileObject, importRun, sheet, rangeRef, blockId = null }) {
  return {
    sourceType: "excel_range",
    fileObjectId: fileObject?.id || null,
    fileId: importRun?.scanResult?.file?.fileId || null,
    fileName: fileObject?.originalName || importRun?.scanResult?.file?.name || null,
    importRunId: importRun?.id || null,
    sheet: sheet?.name || null,
    blockId,
    range: rangeRef || null,
  };
}

function regionKindFor(sheet, block) {
  const detectedSupplementType = block?.detectedSupplementType || block?.metadata?.detectedSupplementType;
  if (detectedSupplementType) return detectedSupplementType;
  if (block?.detectedRecordKind) return block.detectedRecordKind;
  if (block?.type && block.type !== "unknown_block") return block.type;
  if (sheet?.layout?.type && sheet.layout.type !== "unknown") return sheet.layout.type;
  return "unknown_region";
}

function labelForBlock(block) {
  const title = block?.title?.value || block?.title?.rawValue;
  if (title) return normalizeText(title);
  const columns = asArray(block?.table?.columns)
    .map((column) => column?.label || column?.rawName)
    .filter(Boolean)
    .slice(0, 4);
  if (columns.length) return columns.join(", ");
  return block?.blockId || "Workbook region";
}

function fieldFromColumn(column = {}) {
  return {
    fieldId: column.fieldId || column.columnId || null,
    columnId: column.columnId || column.fieldId || null,
    rawName: column.rawName || column.displayName || column.label || "",
    displayName: column.displayName || column.label || column.rawName || "",
    unit: column.unit || null,
    role: column.role || null,
    valueType: column.valueType || null,
    confidence: typeof column.confidence === "number" ? column.confidence : null,
    source: column.source || null,
    warnings: asArray(column.warnings),
  };
}

function candidateFieldsForBlock(block) {
  const proposalColumns = asArray(block?.table?.structureProposal?.columns).map(fieldFromColumn);
  const tableColumns = asArray(block?.table?.columns).map(fieldFromColumn);
  const byKey = new Map();
  [...proposalColumns, ...tableColumns].forEach((field) => {
    const key = field.fieldId || field.columnId || field.displayName || field.rawName;
    if (key && !byKey.has(key)) byKey.set(key, field);
  });
  return [...byKey.values()];
}

function normalizeWarnings(...warningGroups) {
  return warningGroups.flatMap(asArray).map((warning) => {
    if (isObject(warning)) return warning;
    return { code: "warning", message: String(warning || "Unspecified warning.") };
  });
}

function buildBlockRegion({ sheet, block, fileObject, importRun, index }) {
  const decoded = safeDecodeRange(block?.range || block?.source?.range || block?.table?.source?.range);
  const bounds = decoded || regionBoundsFromCells(block?.table?.rows?.flatMap((row) => (
    asArray(row?.values).map((value) => value?.source).filter(Boolean)
  )));
  const rangeRef = bounds?.rangeRef || block?.range || block?.source?.range || null;
  const blockId = block?.blockId || `block_${index + 1}`;
  return {
    id: makeId("source_region"),
    regionKey: `block:${sheet.sheetId || sheet.name}:${blockId}`,
    kind: regionKindFor(sheet, block),
    label: labelForBlock(block),
    sheetName: sheet.name,
    rangeRef,
    startRow: bounds?.startRow ?? null,
    endRow: bounds?.endRow ?? null,
    startCol: bounds?.startCol ?? null,
    endCol: bounds?.endCol ?? null,
    confidence: typeof block?.confidence === "number" ? block.confidence : sheet?.layout?.confidence ?? null,
    signals: {
      source: "scan_block",
      blockId,
      blockType: block?.type || null,
      layoutType: sheet?.layout?.type || null,
      layoutReasons: asArray(sheet?.layout?.reasons),
      detectedSupplementType: block?.detectedSupplementType || null,
      detectedRecordKind: block?.detectedRecordKind || null,
      metadata: asArray(block?.metadata).map((item) => ({
        rawKey: item?.rawKey || "",
        rawValue: item?.rawValue ?? "",
        parsedValue: item?.parsedValue ?? null,
        source: item?.source || null,
      })),
    },
    candidateFields: candidateFieldsForBlock(block),
    sourceRefs: [
      sourceRefFor({ fileObject, importRun, sheet, rangeRef, blockId }),
      ...(block?.source ? [block.source] : []),
    ],
    warnings: normalizeWarnings(block?.warnings, block?.table?.structureProposal?.warnings),
  };
}

function buildDetectedRegion({ sheet, region, fileObject, importRun, index }) {
  const rangeRef = region?.range || region?.bounds?.range || null;
  const decoded = safeDecodeRange(rangeRef);
  const bounds = decoded || (Number.isInteger(region?.startRow) && Number.isInteger(region?.startCol)
    ? {
      startRow: region.startRow,
      endRow: region.endRow ?? region.startRow,
      startCol: region.startCol,
      endCol: region.endCol ?? region.startCol,
      rangeRef: encodeRange({
        s: { r: region.startRow, c: region.startCol },
        e: { r: region.endRow ?? region.startRow, c: region.endCol ?? region.startCol },
      }),
    }
    : null);
  const finalRangeRef = bounds?.rangeRef || rangeRef;
  return {
    id: makeId("source_region"),
    regionKey: `region:${sheet.sheetId || sheet.name}:${region?.regionId || index + 1}`,
    kind: region?.type || region?.kind || "detected_region",
    label: region?.label || region?.type || "Detected region",
    sheetName: sheet.name,
    rangeRef: finalRangeRef,
    startRow: bounds?.startRow ?? null,
    endRow: bounds?.endRow ?? null,
    startCol: bounds?.startCol ?? null,
    endCol: bounds?.endCol ?? null,
    confidence: typeof region?.confidence === "number" ? region.confidence : null,
    signals: {
      source: "scan_region",
      regionId: region?.regionId || null,
      reasons: asArray(region?.reasons),
      metrics: cleanObject(region?.metrics),
    },
    candidateFields: [],
    sourceRefs: [sourceRefFor({ fileObject, importRun, sheet, rangeRef: finalRangeRef })],
    warnings: normalizeWarnings(region?.warnings),
  };
}

function scanSheetMetadata(sheet) {
  return {
    sheetId: sheet.sheetId || null,
    name: sheet.name || "",
    usedRange: sheet.usedRange || sheet.cellGrid?.range || null,
    rowCount: sheet.rowCount || sheet.cellGrid?.rowCount || 0,
    columnCount: sheet.columnCount || sheet.cellGrid?.columnCount || 0,
    nonEmptyCellCount: sheet.nonEmptyCellCount || asArray(sheet.cellGrid?.cells).length,
  };
}

function buildGridBlob({ project, fileObject, importRun, scanResult, sheets }) {
  const payload = {
    schemaVersion: "labrat.sourceIndexBlob.v1",
    indexVersion: SOURCE_INDEX_VERSION,
    projectId: project.id,
    fileObjectId: fileObject.id,
    importRunId: importRun.id,
    workbookName: fileObject.originalName || scanResult.file?.name || "",
    sheets: sheets.map((sheet) => ({
      sheetId: sheet.sheetId || null,
      name: sheet.name || "",
      usedRange: sheet.usedRange || sheet.cellGrid?.range || null,
      rowCount: sheet.rowCount || sheet.cellGrid?.rowCount || 0,
      columnCount: sheet.columnCount || sheet.cellGrid?.columnCount || 0,
      cellGrid: {
        range: sheet.cellGrid?.range || sheet.usedRange || null,
        rowCount: sheet.cellGrid?.rowCount || sheet.rowCount || 0,
        columnCount: sheet.cellGrid?.columnCount || sheet.columnCount || 0,
        cells: asArray(sheet.cellGrid?.cells).map((cell) => ({
          row: cell.row,
          col: cell.col,
          address: cell.address,
          rawValue: cell.rawValue ?? null,
          formattedValue: cell.formattedValue ?? null,
          type: cell.type || null,
          formula: cell.formula || null,
          comments: asArray(cell.comments),
        })),
      },
    })),
  };
  return {
    id: makeId("source_index_blob"),
    blobKind: "excel_cell_grid_v1",
    storageProvider: "database",
    storageKey: null,
    payload,
    checksumSha256: sha256Hex(JSON.stringify(payload)),
  };
}

export function publicScanResult(scanResult) {
  if (!scanResult) return scanResult;
  return {
    ...copy(scanResult),
    sheets: asArray(scanResult.sheets).map((sheet) => ({
      ...copy(sheet),
      cellGrid: sheet.cellGrid
        ? {
          range: sheet.cellGrid.range || sheet.usedRange || null,
          rowCount: sheet.cellGrid.rowCount || sheet.rowCount || 0,
          columnCount: sheet.cellGrid.columnCount || sheet.columnCount || 0,
          hiddenRows: asArray(sheet.cellGrid.hiddenRows),
          hiddenColumns: asArray(sheet.cellGrid.hiddenColumns),
          cellCount: asArray(sheet.cellGrid.cells).length,
        }
        : null,
    })),
  };
}

export function buildSourceDocumentIndex({ project, fileObject, importRun, scanResult, actorUserId }) {
  const sheets = asArray(scanResult?.sheets);
  const sheetMetadata = sheets.map(scanSheetMetadata);
  const blockRegions = sheets.flatMap((sheet) => (
    asArray(sheet.blocks).map((block, index) => buildBlockRegion({ sheet, block, fileObject, importRun, index }))
  ));
  const blockRanges = new Set(blockRegions.map((region) => `${region.sheetName}:${region.rangeRef}`).filter(Boolean));
  const detectedRegions = sheets.flatMap((sheet) => asArray(sheet.regions)
    .map((region, index) => buildDetectedRegion({ sheet, region, fileObject, importRun, index }))
    .filter((region) => !region.rangeRef || !blockRanges.has(`${region.sheetName}:${region.rangeRef}`)));
  const regions = [...blockRegions, ...detectedRegions];
  const gridBlob = buildGridBlob({ project, fileObject, importRun, scanResult, sheets });
  const warnings = normalizeWarnings(scanResult?.warnings, sheets.flatMap((sheet) => sheet.warnings || []));
  return {
    id: makeId("source_doc"),
    labId: project.labId,
    projectId: project.id,
    fileObjectId: fileObject.id,
    importRunId: importRun.id,
    documentType: "excel_workbook",
    indexVersion: SOURCE_INDEX_VERSION,
    status: "indexed",
    metadata: {
      schemaVersion: SOURCE_INDEX_VERSION,
      workbookName: fileObject.originalName || scanResult?.file?.name || "",
      fileName: fileObject.originalName || scanResult?.file?.name || "",
      fileObjectId: fileObject.id,
      importRunId: importRun.id,
      checksumSha256: fileObject.checksumSha256 || scanResult?.file?.checksumSha256 || null,
      mimeType: fileObject.mimeType || scanResult?.file?.contentType || null,
      sizeBytes: fileObject.sizeBytes ?? scanResult?.file?.sizeBytes ?? null,
      workbookType: scanResult?.file?.type || null,
      sheetNames: sheetMetadata.map((sheet) => sheet.name),
      sheets: sheetMetadata,
    },
    summary: {
      sheetCount: sheetMetadata.length,
      regionCount: regions.length,
      blockRegionCount: blockRegions.length,
      scanRegionCount: detectedRegions.length,
      nonEmptyCellCount: sheetMetadata.reduce((sum, sheet) => sum + (sheet.nonEmptyCellCount || 0), 0),
      warningCount: warnings.length,
    },
    warnings,
    regions,
    indexBlobs: [gridBlob],
    createdBy: actorUserId || null,
    updatedBy: actorUserId || null,
  };
}

export async function persistSourceIndexForImportRun(context, {
  project,
  fileObject,
  importRun,
  scanResult = importRun?.scanResult,
  actorUserId = null,
  auditMetadata = {},
} = {}) {
  if (!context.store?.replaceSourceDocumentIndex || !project || !fileObject || !importRun || !scanResult) {
    return null;
  }
  const input = buildSourceDocumentIndex({ project, fileObject, importRun, scanResult, actorUserId });
  const sourceDocument = await context.store.replaceSourceDocumentIndex(input);
  if (context.store.recordAuditEvent) {
    await context.store.recordAuditEvent({
      labId: project.labId,
      projectId: project.id,
      actorUserId,
      action: "source.index",
      targetType: "source_document",
      targetId: sourceDocument.id,
      summary: `Indexed source document ${input.metadata.workbookName}.`,
      metadata: {
        fileObjectId: fileObject.id,
        importRunId: importRun.id,
        regionCount: input.summary.regionCount,
        ...auditMetadata,
      },
    });
  }
  return sourceDocument;
}

export function sourceDocumentSummary(sourceDocument) {
  return {
    id: sourceDocument.id,
    labId: sourceDocument.labId,
    projectId: sourceDocument.projectId,
    fileObjectId: sourceDocument.fileObjectId || null,
    importRunId: sourceDocument.importRunId || null,
    documentType: sourceDocument.documentType,
    indexVersion: sourceDocument.indexVersion,
    status: sourceDocument.status,
    metadata: sourceDocument.metadata || {},
    summary: sourceDocument.summary || {},
    warnings: sourceDocument.warnings || [],
    createdAt: sourceDocument.createdAt,
    updatedAt: sourceDocument.updatedAt,
    createdBy: sourceDocument.createdBy || null,
    updatedBy: sourceDocument.updatedBy || null,
  };
}

export function sourceRegionSummary(region) {
  return {
    id: region.id,
    labId: region.labId,
    projectId: region.projectId,
    sourceDocumentId: region.sourceDocumentId,
    importRunId: region.importRunId || null,
    regionKey: region.regionKey || null,
    kind: region.kind,
    label: region.label || "",
    sheetName: region.sheetName || null,
    rangeRef: region.rangeRef || null,
    startRow: region.startRow ?? null,
    endRow: region.endRow ?? null,
    startCol: region.startCol ?? null,
    endCol: region.endCol ?? null,
    confidence: region.confidence ?? null,
    signals: region.signals || {},
    candidateFields: region.candidateFields || [],
    sourceRefs: region.sourceRefs || [],
    warnings: region.warnings || [],
    status: region.status || "active",
    createdAt: region.createdAt,
    updatedAt: region.updatedAt,
  };
}

function regionSearchText(region) {
  return [
    region.label,
    region.kind,
    region.sheetName,
    region.rangeRef,
    ...asArray(region.candidateFields).flatMap((field) => [
      field.displayName,
      field.rawName,
      field.unit,
      field.role,
      field.valueType,
    ]),
    ...asArray(region.warnings).flatMap((warning) => [warning.code, warning.message]),
  ].map(normalizeText).join(" ").toLowerCase();
}

function cellSearchText(cell) {
  return [
    cell.address,
    cell.rawValue,
    cell.formattedValue,
    cell.formula,
    ...asArray(cell.comments).map((comment) => comment?.text || comment),
  ].map(normalizeText).join(" ").toLowerCase();
}

function blobsToSheets(indexBlobs = []) {
  return asArray(indexBlobs).flatMap((blob) => asArray(blob.payload?.sheets));
}

export function querySourceDocument({ sourceDocument, regions = [], indexBlobs = [], query, limit = DEFAULT_QUERY_LIMIT }) {
  const normalizedQuery = normalizeLower(query);
  if (!normalizedQuery) {
    const error = new Error("query must be a non-empty string.");
    error.statusCode = 400;
    error.code = "invalid_source_query";
    throw error;
  }
  const cappedLimit = limitNumber(limit, DEFAULT_QUERY_LIMIT, 1, MAX_QUERY_LIMIT);
  const matches = [];
  const pushMatch = (match) => {
    if (matches.length < cappedLimit) matches.push(match);
  };

  asArray(regions).forEach((region) => {
    if (regionSearchText(region).includes(normalizedQuery)) {
      pushMatch({
        type: "region",
        score: 0.82,
        sourceDocumentId: sourceDocument.id,
        region: sourceRegionSummary(region),
      });
    }
  });

  for (const sheet of blobsToSheets(indexBlobs)) {
    for (const cell of asArray(sheet?.cellGrid?.cells)) {
      if (matches.length >= cappedLimit) break;
      if (!cellSearchText(cell).includes(normalizedQuery)) continue;
      pushMatch({
        type: "cell",
        score: 0.72,
        sourceDocumentId: sourceDocument.id,
        sheetName: sheet.name,
        cell: {
          address: cell.address || encodeCell(cell.row, cell.col),
          row: cell.row,
          col: cell.col,
          rawValue: cell.rawValue ?? null,
          formattedValue: cell.formattedValue ?? null,
          type: cell.type || null,
          formula: cell.formula || null,
        },
        sourceRef: {
          sourceType: "excel_cell",
          sourceDocumentId: sourceDocument.id,
          fileObjectId: sourceDocument.fileObjectId || null,
          importRunId: sourceDocument.importRunId || null,
          sheet: sheet.name,
          cell: cell.address || encodeCell(cell.row, cell.col),
        },
      });
    }
  }

  const fullMatchCount = matches.length;
  return {
    schemaVersion: SOURCE_QUERY_SCHEMA_VERSION,
    sourceDocumentId: sourceDocument.id,
    query,
    matches,
    summary: {
      matchCount: matches.length,
      truncated: fullMatchCount >= cappedLimit,
      limit: cappedLimit,
    },
    warnings: [],
  };
}

function findSheet(indexBlobs, sheetName) {
  const sheets = blobsToSheets(indexBlobs);
  if (!sheetName && sheets.length === 1) return sheets[0];
  const normalized = normalizeLower(sheetName);
  return sheets.find((sheet) => normalizeLower(sheet?.name) === normalized) || null;
}

export function readSourceDocumentRange({
  sourceDocument,
  indexBlobs = [],
  sheetName,
  range,
  maxCells = DEFAULT_RANGE_MAX_CELLS,
}) {
  const sheet = findSheet(indexBlobs, sheetName);
  if (!sheet) {
    const error = new Error(sheetName
      ? `Sheet ${sheetName} was not found for this source document.`
      : "sheetName is required when the workbook has multiple sheets.");
    error.statusCode = 404;
    error.code = "source_sheet_not_found";
    throw error;
  }
  let decoded;
  try {
    decoded = decodeRange(String(range || ""));
  } catch {
    const error = new Error("range must be a valid Excel range such as A1:D20.");
    error.statusCode = 400;
    error.code = "invalid_source_range";
    throw error;
  }
  const rowCount = decoded.e.r - decoded.s.r + 1;
  const columnCount = decoded.e.c - decoded.s.c + 1;
  const cellCount = rowCount * columnCount;
  const cappedMaxCells = limitNumber(maxCells, DEFAULT_RANGE_MAX_CELLS, 1, DEFAULT_RANGE_MAX_CELLS);
  if (cellCount > cappedMaxCells) {
    const error = new Error(`Requested range contains ${cellCount} cells; maximum is ${cappedMaxCells}.`);
    error.statusCode = 400;
    error.code = "source_range_too_large";
    error.details = { cellCount, maxCells: cappedMaxCells };
    throw error;
  }
  const cellsByAddress = new Map(asArray(sheet.cellGrid?.cells).map((cell) => [
    cell.address || encodeCell(cell.row, cell.col),
    cell,
  ]));
  const rows = [];
  const cells = [];
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    const outputRow = [];
    for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
      const address = encodeCell(row, col);
      const cell = cellsByAddress.get(address) || { row, col, address, rawValue: null, formattedValue: null, type: "blank" };
      const outputCell = {
        address,
        row,
        col,
        rawValue: cell.rawValue ?? null,
        formattedValue: cell.formattedValue ?? null,
        type: cell.type || null,
        formula: cell.formula || null,
      };
      outputRow.push(outputCell);
      cells.push(outputCell);
    }
    rows.push(outputRow);
  }
  const normalizedRange = encodeRange(decoded);
  return {
    schemaVersion: SOURCE_RANGE_SCHEMA_VERSION,
    sourceDocumentId: sourceDocument.id,
    sheetName: sheet.name,
    range: normalizedRange,
    rowCount,
    columnCount,
    cellCount,
    cells,
    rows,
    sourceRef: {
      sourceType: "excel_range",
      sourceDocumentId: sourceDocument.id,
      fileObjectId: sourceDocument.fileObjectId || null,
      importRunId: sourceDocument.importRunId || null,
      sheet: sheet.name,
      range: normalizedRange,
    },
    warnings: [],
  };
}
