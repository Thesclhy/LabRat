import { cellSource, rangeSource } from "../utils/provenanceTracker.js";
import { encodeRange } from "../utils/excelAddress.js";

function cellKey(row, col) {
  return `${row}:${col}`;
}

function mapCells(cells) {
  return new Map((cells || []).map((cell) => [cellKey(cell.row, cell.col), cell]));
}

function tableRange(header, rows) {
  const headerCols = header.columns.map((column) => column.col);
  const rowNumbers = rows.map((row) => row.rowIndex);
  const startRow = header.row;
  const endRow = Math.max(header.row, ...rowNumbers);
  const startCol = Math.min(...headerCols);
  const endCol = Math.max(...headerCols);
  return encodeRange({
    s: { r: startRow - 1, c: startCol - 1 },
    e: { r: endRow - 1, c: endCol - 1 },
  });
}

function valueForCell(cell, columnId, sourceContext) {
  return {
    columnId,
    value: cell?.rawValue ?? null,
    rawValue: cell?.rawValue == null ? "" : String(cell.rawValue),
    source: cell ? cellSource(cell, sourceContext) : null,
  };
}

export function parseStandardTable(sheet, sourceContext = {}) {
  const header = sheet.candidateHeaders?.[0];
  if (!header) {
    return {
      blocks: [],
      warnings: [{ code: "no_header_row", message: "No candidate header row was found for standard table parsing." }],
    };
  }

  const cellMap = mapCells(sheet.cellGrid?.cells);
  const columnIds = header.columns.map((column, index) => `col_${index + 1}`);
  const columns = header.columns.map((column, index) => ({
    columnId: columnIds[index],
    rawName: column.rawName,
    label: column.label,
    unit: column.unit,
    source: column.source,
    confidence: header.confidence,
  }));

  const maxRow = sheet.cellGrid?.rowCount || header.row;
  const rows = [];
  for (let row = header.row + 1; row <= maxRow; row += 1) {
    const values = header.columns.map((column, index) => (
      valueForCell(cellMap.get(cellKey(row, column.col)), columnIds[index], sourceContext)
    ));
    if (values.every((value) => value.value == null || value.rawValue === "")) continue;
    rows.push({ rowIndex: row, values });
  }

  const range = tableRange(header, rows);
  return {
    blocks: [{
      blockId: `${sheet.sheetId}_table_1`,
      type: "standard_table",
      range,
      table: {
        headerRange: header.range,
        dataRange: rows.length ? encodeRange({
          s: { r: rows[0].rowIndex - 1, c: Math.min(...header.columns.map((column) => column.col)) - 1 },
          e: { r: rows[rows.length - 1].rowIndex - 1, c: Math.max(...header.columns.map((column) => column.col)) - 1 },
        }) : null,
        columns,
        rows,
        source: rangeSource(range, sourceContext),
      },
      warnings: rows.length ? [] : [{ code: "no_data_rows", message: "Header was found but no data rows were detected." }],
      confidence: header.confidence,
    }],
    warnings: [],
  };
}
