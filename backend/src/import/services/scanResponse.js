const SCAN_SCHEMA_VERSION = "labrat.importScan.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeConfidence(value, fallback = null) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, Number(value.toFixed(3))))
    : fallback;
}

function normalizeWarning(warning) {
  if (!warning || typeof warning !== "object") {
    return {
      code: "warning",
      message: String(warning || "Unspecified import scan warning."),
      severity: "warning",
    };
  }
  return {
    ...warning,
    code: warning.code || "warning",
    message: warning.message || "Unspecified import scan warning.",
    severity: warning.severity || "warning",
  };
}

function normalizeSource(source) {
  if (!source) return null;
  return {
    ...source,
    fileId: source.fileId || null,
    fileName: source.fileName || null,
    sheet: source.sheet || null,
    blockId: source.blockId || null,
    cell: source.cell || null,
    range: source.range || source.cell || null,
    rawValue: source.rawValue ?? null,
  };
}

function normalizeTitle(title) {
  if (!title) return null;
  const value = title.value ?? title.rawValue ?? "";
  return {
    ...title,
    value,
    rawValue: title.rawValue ?? value,
    source: normalizeSource(title.source),
  };
}

function normalizeMetadata(metadata) {
  return {
    ...metadata,
    row: metadata.row ?? null,
    rawKey: metadata.rawKey || "",
    rawValue: metadata.rawValue ?? "",
    parsedValue: metadata.parsedValue ?? null,
    unit: metadata.unit || null,
    source: normalizeSource(metadata.source),
    confidence: normalizeConfidence(metadata.confidence, null),
  };
}

function normalizeColumn(column) {
  return {
    ...column,
    columnId: column.columnId || null,
    rawName: column.rawName || "",
    label: column.label || column.rawName || "",
    unit: column.unit || null,
    rawHeaderPath: asArray(column.rawHeaderPath),
    role: column.role || null,
    valueType: column.valueType || null,
    source: normalizeSource(column.source),
    confidence: normalizeConfidence(column.confidence, null),
    warnings: asArray(column.warnings).map(normalizeWarning),
  };
}

function normalizeValue(value) {
  return {
    ...value,
    columnId: value.columnId || null,
    value: value.value ?? null,
    rawValue: value.rawValue ?? "",
    source: normalizeSource(value.source),
  };
}

function normalizeTable(table) {
  if (!table) return null;
  return {
    ...table,
    headerRange: table.headerRange || null,
    dataRange: table.dataRange || null,
    columns: asArray(table.columns).map(normalizeColumn),
    rows: asArray(table.rows).map((row) => ({
      ...row,
      rowIndex: row.rowIndex ?? null,
      values: asArray(row.values).map(normalizeValue),
    })),
    source: normalizeSource(table.source),
    structureProposal: normalizeStructureProposal(table.structureProposal),
  };
}

function normalizeStructureProposal(proposal) {
  if (!proposal) return null;
  return {
    ...proposal,
    tableId: proposal.tableId || null,
    regionId: proposal.regionId || null,
    headerRows: asArray(proposal.headerRows),
    unitRows: asArray(proposal.unitRows),
    dataRows: asArray(proposal.dataRows),
    labelColumns: asArray(proposal.labelColumns),
    sideLabelColumns: asArray(proposal.sideLabelColumns),
    columns: asArray(proposal.columns).map((column) => ({
      ...column,
      fieldId: column.fieldId || column.columnId || null,
      columnId: column.columnId || column.fieldId || null,
      displayName: column.displayName || column.rawName || "",
      rawHeaderPath: asArray(column.rawHeaderPath),
      unit: column.unit || null,
      role: column.role || null,
      valueType: column.valueType || null,
      confidence: normalizeConfidence(column.confidence, null),
      source: normalizeSource(column.source),
      warnings: asArray(column.warnings).map(normalizeWarning),
    })),
    warnings: asArray(proposal.warnings).map(normalizeWarning),
    confidence: normalizeConfidence(proposal.confidence, null),
  };
}

function normalizeBlock(block) {
  const table = normalizeTable(block.table);
  return {
    ...block,
    blockId: block.blockId || null,
    type: block.type || "unknown_block",
    range: block.range || table?.source?.range || null,
    title: normalizeTitle(block.title),
    metadata: asArray(block.metadata).map(normalizeMetadata),
    table,
    source: normalizeSource(block.source || table?.source),
    warnings: asArray(block.warnings).map(normalizeWarning),
    confidence: normalizeConfidence(block.confidence, null),
    candidateHeaders: asArray(block.candidateHeaders),
    candidateMetadata: asArray(block.candidateMetadata).map(normalizeMetadata),
  };
}

function normalizeLayout(layout) {
  return {
    ...layout,
    type: layout?.type || "unknown",
    confidence: normalizeConfidence(layout?.confidence, 0),
    reasons: asArray(layout?.reasons),
  };
}

function normalizeSheet(sheet) {
  const cellGrid = sheet.cellGrid || {};
  return {
    sheetId: sheet.sheetId || null,
    name: sheet.name || "",
    usedRange: sheet.usedRange || null,
    rowCount: cellGrid.rowCount || 0,
    columnCount: cellGrid.columnCount || 0,
    nonEmptyCellCount: asArray(cellGrid.cells).length,
    cellGrid: {
      range: cellGrid.range || sheet.usedRange || null,
      rowCount: cellGrid.rowCount || 0,
      columnCount: cellGrid.columnCount || 0,
      hiddenRows: asArray(cellGrid.hiddenRows),
      hiddenColumns: asArray(cellGrid.hiddenColumns),
      cells: asArray(cellGrid.cells),
    },
    layout: normalizeLayout(sheet.layout),
    regions: asArray(sheet.regions),
    structureProposals: asArray(sheet.structureProposals).map(normalizeStructureProposal).filter(Boolean),
    candidateHeaders: asArray(sheet.candidateHeaders),
    candidateMetadata: asArray(sheet.candidateMetadata).map(normalizeMetadata),
    blocks: asArray(sheet.blocks).map(normalizeBlock),
    warnings: asArray(sheet.warnings).map(normalizeWarning),
  };
}

function countWarnings(sheets, warnings) {
  return asArray(warnings).length + sheets.reduce((total, sheet) => (
    total
    + sheet.warnings.length
    + sheet.blocks.reduce((blockTotal, block) => blockTotal + block.warnings.length, 0)
  ), 0);
}

export function shapeScanResponse(scan) {
  const sheets = asArray(scan.sheets).map(normalizeSheet);
  return {
    schemaVersion: SCAN_SCHEMA_VERSION,
    file: {
      fileId: scan.file?.fileId || null,
      name: scan.file?.name || "",
      type: scan.file?.type || null,
      sizeBytes: scan.file?.sizeBytes ?? null,
      contentType: scan.file?.contentType || null,
      ...(scan.file?.checksumSha256 ? { checksumSha256: scan.file.checksumSha256 } : {}),
    },
    summary: {
      sheetCount: sheets.length,
      blockCount: sheets.reduce((total, sheet) => total + sheet.blocks.length, 0),
      warningCount: countWarnings(sheets, scan.warnings),
    },
    sheets,
    warnings: asArray(scan.warnings).map(normalizeWarning),
  };
}
