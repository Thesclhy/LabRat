import { cellSource } from "./provenanceTracker.js";
import { detectUnitFromLabel } from "./unitDetector.js";
import { clampConfidence } from "./confidence.js";

function groupCellsByRow(cells) {
  const rows = new Map();
  (cells || []).forEach((cell) => {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  });
  return [...rows.entries()]
    .map(([row, rowCells]) => ({ row, cells: rowCells.sort((a, b) => a.col - b.col) }))
    .sort((a, b) => a.row - b.row);
}

function isNumericCell(cell) {
  return cell.type === "number" || typeof cell.rawValue === "number";
}

function isTextCell(cell) {
  return !isNumericCell(cell) && String(cell.rawValue ?? "").trim().length > 0;
}

function rowSummary(rowEntry) {
  const textCells = rowEntry.cells.filter(isTextCell);
  const numericCells = rowEntry.cells.filter(isNumericCell);
  return {
    row: rowEntry.row,
    cells: rowEntry.cells,
    textCount: textCells.length,
    numericCount: numericCells.length,
    nonEmptyCount: rowEntry.cells.length,
  };
}

function followingNumericRows(rows, rowIndex) {
  return rows.slice(rowIndex + 1, rowIndex + 4).filter((row) => row.numericCount > 0).length;
}

function headerConfidence(row, numericRowsBelow) {
  const textRatio = row.textCount / Math.max(1, row.nonEmptyCount);
  const base = row.textCount >= 2 ? 0.45 : 0.2;
  const dataBoost = Math.min(0.35, numericRowsBelow * 0.15);
  const ratioBoost = textRatio >= 0.7 ? 0.2 : 0;
  return clampConfidence(base + dataBoost + ratioBoost);
}

export function detectHeaderRows(cells, options = {}) {
  const minTextCells = options.minTextCells || 2;
  const sourceContext = options.sourceContext || {};
  const rows = groupCellsByRow(cells).map(rowSummary);
  return rows
    .map((row, index) => {
      const numericRowsBelow = followingNumericRows(rows, index);
      const textHeavy = row.textCount >= minTextCells && row.textCount >= row.numericCount;
      const likely = textHeavy && numericRowsBelow > 0;
      return {
        row: row.row,
        range: `${row.cells[0]?.address}:${row.cells[row.cells.length - 1]?.address}`,
        columns: row.cells.map((cell) => ({
          col: cell.col,
          address: cell.address,
          rawName: String(cell.rawValue ?? "").trim(),
          source: cellSource(cell, sourceContext),
          ...detectUnitFromLabel(cell.rawValue),
        })),
        confidence: likely ? headerConfidence(row, numericRowsBelow) : 0,
        reasons: likely
          ? [`${row.textCount} text cells in row`, `${numericRowsBelow} nearby numeric data row${numericRowsBelow === 1 ? "" : "s"} below`]
          : [],
      };
    })
    .filter((candidate) => candidate.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence || a.row - b.row);
}
