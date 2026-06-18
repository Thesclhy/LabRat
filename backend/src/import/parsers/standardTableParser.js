import { cellSource, rangeSource } from "../utils/provenanceTracker.js";
import { decodeRange, encodeRange } from "../utils/excelAddress.js";
import { detectUnitFromLabel } from "../utils/unitDetector.js";
import { fieldDescriptorFromHeader } from "../utils/fieldRoleClassifier.js";

function cellKey(row, col) {
  return `${row}:${col}`;
}

function mapCells(cells) {
  return new Map((cells || []).map((cell) => [cellKey(cell.row, cell.col), cell]));
}

function rangeIncludesCol(rangeRef, col) {
  if (!rangeRef) return false;
  const decoded = decodeRange(rangeRef);
  return col >= decoded.s.c + 1 && col <= decoded.e.c + 1;
}

function cellsByRow(cells) {
  const rows = new Map();
  (cells || []).forEach((cell) => {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  });
  rows.forEach((items) => items.sort((a, b) => a.col - b.col));
  return rows;
}

function headerBand(candidateHeaders = []) {
  const sorted = [...candidateHeaders].sort((a, b) => a.row - b.row);
  if (!sorted.length) return [];
  const band = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].row === band[band.length - 1].row + 1 && band.length < 3) {
      band.push(sorted[index]);
    }
  }
  return band;
}

function headerCellForColumn(rowCells, col, { fillFromLeft = false } = {}) {
  const exact = rowCells.find((cell) => cell.col === col);
  if (exact && String(exact.rawValue ?? "").trim() !== "") return exact;
  const merged = rowCells.find((cell) => cell.col <= col && rangeIncludesCol(cell.mergedRange, col));
  if (merged && String(merged.rawValue ?? "").trim() !== "") return merged;
  if (!fillFromLeft) return null;
  return [...rowCells].reverse().find((cell) => cell.col < col && String(cell.rawValue ?? "").trim() !== "") || null;
}

function uniqueParts(parts) {
  const result = [];
  parts.forEach((part) => {
    const text = String(part || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    if (result.some((existing) => existing.toLowerCase() === text.toLowerCase())) return;
    result.push(text);
  });
  return result;
}

function combineHeaderPath(rawHeaderPath) {
  let unit = null;
  const labels = rawHeaderPath.map((part) => {
    const parsed = detectUnitFromLabel(part);
    if (parsed.unit && !unit) unit = parsed.unit;
    return parsed.label || parsed.rawLabel || part;
  }).filter(Boolean);
  const label = uniqueParts(labels).join(" ");
  return {
    rawName: unit ? `${label} (${unit})` : label,
    label,
    unit,
  };
}

function resolveHeaderColumns({ headerRows, cellMap, rowMap, sourceContext, dataRows = [] }) {
  const headerCols = headerRows.flatMap((header) => header.columns.map((column) => column.col));
  const dataCols = dataRows.flatMap((row) => row.cells.map((cell) => cell.col));
  const startCol = Math.min(...headerCols, ...dataCols);
  const endCol = Math.max(...headerCols, ...dataCols);
  const columns = [];

  for (let col = startCol; col <= endCol; col += 1) {
    const pathCells = headerRows.map((header, index) => (
      headerCellForColumn(rowMap.get(header.row) || [], col, { fillFromLeft: index === 0 })
    ));
    const rawHeaderPath = uniqueParts(pathCells.map((cell) => cell?.rawValue));
    if (!rawHeaderPath.length) continue;
    const combined = combineHeaderPath(rawHeaderPath);
    const sourceCell = pathCells.find((cell) => cell?.col === col) || pathCells.find(Boolean);
    columns.push({
      columnId: `col_${columns.length + 1}`,
      col,
      rawName: combined.rawName,
      label: combined.label,
      rawHeaderPath,
      unit: combined.unit,
      source: sourceCell ? cellSource(sourceCell, sourceContext) : null,
      confidence: Math.max(...headerRows.map((header) => header.confidence || 0)),
    });
  }
  return columns;
}

function tableRange(headerRows, columns, rows) {
  const headerCols = columns.map((column) => column.col);
  const rowNumbers = rows.map((row) => row.rowIndex);
  const startRow = Math.min(...headerRows.map((header) => header.row));
  const endRow = Math.max(...headerRows.map((header) => header.row), ...rowNumbers);
  const startCol = Math.min(...headerCols);
  const endCol = Math.max(...headerCols);
  return encodeRange({
    s: { r: startRow - 1, c: startCol - 1 },
    e: { r: endRow - 1, c: endCol - 1 },
  });
}

function valueForCell(cell, columnId, sourceContext) {
  const rawValue = cell?.rawValue ?? null;
  const formattedValue = cell?.formattedValue ?? (rawValue == null ? "" : String(rawValue));
  return {
    columnId,
    value: rawValue,
    rawValue: rawValue == null ? "" : String(rawValue),
    formattedValue,
    source: cell ? cellSource(cell, sourceContext) : null,
  };
}

export function parseStandardTable(sheet, sourceContext = {}) {
  const headers = headerBand(sheet.candidateHeaders);
  if (!headers.length) {
    return {
      blocks: [],
      warnings: [{ code: "no_header_row", message: "No candidate header row was found for standard table parsing." }],
    };
  }

  const cellMap = mapCells(sheet.cellGrid?.cells);
  const rowMap = cellsByRow(sheet.cellGrid?.cells);
  const maxHeaderRow = Math.max(...headers.map((header) => header.row));
  const maxRow = sheet.cellGrid?.rowCount || maxHeaderRow;
  const dataRowEntries = [];
  for (let row = maxHeaderRow + 1; row <= maxRow; row += 1) {
    dataRowEntries.push({ row, cells: rowMap.get(row) || [] });
  }
  const columns = resolveHeaderColumns({
    headerRows: headers,
    cellMap,
    rowMap,
    sourceContext,
    dataRows: dataRowEntries.filter((row) => row.cells.length),
  });
  const columnByCol = new Map(columns.map((column) => [column.col, column]));
  const rows = [];
  for (let row = maxHeaderRow + 1; row <= maxRow; row += 1) {
    const values = columns.map((column) => (
      valueForCell(cellMap.get(cellKey(row, column.col)), column.columnId, sourceContext)
    ));
    if (values.every((value) => value.value == null || value.rawValue === "")) continue;
    rows.push({ rowIndex: row, values });
  }

  const columnsWithRoles = columns.map((column) => {
    const values = rows
      .map((row) => row.values.find((value) => value.columnId === column.columnId))
      .map((value) => value?.value ?? value?.rawValue)
      .filter((value) => value != null && String(value).trim() !== "");
    return {
      ...column,
      ...fieldDescriptorFromHeader({
        columnId: column.columnId,
        displayName: column.rawName || column.label,
        rawHeaderPath: column.rawHeaderPath,
        values,
        unit: column.unit,
        source: column.source,
        confidence: column.confidence,
      }),
    };
  });

  const range = tableRange(headers, columnsWithRoles, rows);
  const headerRange = encodeRange({
    s: {
      r: Math.min(...headers.map((header) => header.row)) - 1,
      c: Math.min(...columnsWithRoles.map((column) => column.col)) - 1,
    },
    e: {
      r: maxHeaderRow - 1,
      c: Math.max(...columnsWithRoles.map((column) => column.col)) - 1,
    },
  });
  const labelColumns = columnsWithRoles.filter((column) => column.role === "identifier").map((column) => column.columnId);
  const structureProposal = {
    tableId: `${sheet.sheetId}_table_1`,
    regionId: sheet.regions?.[0]?.regionId || null,
    headerRows: headers.map((header) => header.row),
    unitRows: [],
    dataRows: rows.map((row) => row.rowIndex),
    labelColumns,
    sideLabelColumns: [],
    columns: columnsWithRoles.map((column) => ({
      fieldId: column.columnId,
      columnId: column.columnId,
      col: column.col,
      displayName: column.displayName || column.rawName,
      rawHeaderPath: column.rawHeaderPath,
      unit: column.unit,
      role: column.role,
      valueType: column.valueType,
      confidence: column.confidence,
      source: column.source,
      warnings: column.warnings || [],
    })),
    warnings: labelColumns.length ? [] : [{
      code: "label_column_not_detected",
      message: "No obvious experiment label column was detected.",
      severity: "warning",
    }],
    confidence: Number((columnsWithRoles.reduce((total, column) => total + (column.confidence || 0), 0) / Math.max(1, columnsWithRoles.length)).toFixed(3)),
  };
  return {
    blocks: [{
      blockId: `${sheet.sheetId}_table_1`,
      type: "standard_table",
      range,
      table: {
        headerRange,
        dataRange: rows.length ? encodeRange({
          s: { r: rows[0].rowIndex - 1, c: Math.min(...columnsWithRoles.map((column) => column.col)) - 1 },
          e: { r: rows[rows.length - 1].rowIndex - 1, c: Math.max(...columnsWithRoles.map((column) => column.col)) - 1 },
        }) : null,
        columns: columnsWithRoles,
        rows,
        source: rangeSource(range, sourceContext),
        structureProposal,
      },
      warnings: rows.length ? [] : [{ code: "no_data_rows", message: "Header was found but no data rows were detected." }],
      confidence: structureProposal.confidence,
    }],
    structureProposals: [structureProposal],
    warnings: [],
  };
}
