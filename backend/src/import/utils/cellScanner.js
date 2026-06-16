import * as XLSX from "xlsx";
import { decodeRange, encodeCell } from "./excelAddress.js";
import { mergedCellInfo } from "./mergedCellResolver.js";

function cellType(cell) {
  if (!cell) return "blank";
  if (cell.f) return "formula";
  if (cell.t === "n") return "number";
  if (cell.t === "b") return "boolean";
  if (cell.t === "d") return "date";
  if (cell.t === "e") return "error";
  return "string";
}

function cellValue(cell) {
  if (!cell) return null;
  return cell.v ?? null;
}

export function scanCells(worksheet) {
  const usedRange = worksheet?.["!ref"] || null;
  if (!worksheet || !usedRange) {
    return {
      range: usedRange,
      rowCount: 0,
      columnCount: 0,
      cells: [],
    };
  }

  const decoded = decodeRange(usedRange);
  const merges = Array.isArray(worksheet["!merges"]) ? worksheet["!merges"] : [];
  const rowMeta = Array.isArray(worksheet["!rows"]) ? worksheet["!rows"] : [];
  const colMeta = Array.isArray(worksheet["!cols"]) ? worksheet["!cols"] : [];
  const cells = [];

  for (let rowIndex = decoded.s.r; rowIndex <= decoded.e.r; rowIndex += 1) {
    for (let colIndex = decoded.s.c; colIndex <= decoded.e.c; colIndex += 1) {
      const address = encodeCell(rowIndex, colIndex);
      const cell = worksheet[address];
      const rawValue = cellValue(cell);
      if (rawValue == null && !cell?.f) continue;
      const merge = mergedCellInfo(merges, rowIndex, colIndex);
      cells.push({
        row: rowIndex + 1,
        col: colIndex + 1,
        address,
        rawValue,
        formattedValue: cell?.w ?? (rawValue == null ? "" : String(rawValue)),
        type: cellType(cell),
        formula: cell?.f || null,
        style: cell?.s || null,
        comments: Array.isArray(cell?.c) ? cell.c.map((comment) => ({
          author: comment.a || "",
          text: comment.t || "",
        })) : [],
        hiddenRow: Boolean(rowMeta[rowIndex]?.hidden),
        hiddenColumn: Boolean(colMeta[colIndex]?.hidden),
        ...merge,
      });
    }
  }

  return {
    range: usedRange,
    rowCount: decoded.e.r - decoded.s.r + 1,
    columnCount: decoded.e.c - decoded.s.c + 1,
    hiddenRows: rowMeta
      .map((row, index) => (row?.hidden ? index + 1 : null))
      .filter(Boolean),
    hiddenColumns: colMeta
      .map((column, index) => (column?.hidden ? index + 1 : null))
      .filter(Boolean),
    cells,
  };
}
