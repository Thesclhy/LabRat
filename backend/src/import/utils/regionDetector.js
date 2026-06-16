import { encodeRange } from "./excelAddress.js";

function valueKind(cell) {
  if (cell.type === "number" || typeof cell.rawValue === "number") return "numeric";
  return "text";
}

function cellsAreNear(a, b, maxBlankGap) {
  const maxDistance = maxBlankGap + 1;
  return Math.abs(a.row - b.row) <= maxDistance && Math.abs(a.col - b.col) <= maxDistance;
}

function regionRange(cells) {
  const rows = cells.map((cell) => cell.row);
  const cols = cells.map((cell) => cell.col);
  return {
    s: { r: Math.min(...rows) - 1, c: Math.min(...cols) - 1 },
    e: { r: Math.max(...rows) - 1, c: Math.max(...cols) - 1 },
  };
}

function summarizeRegion(cells, index) {
  const kinds = cells.map(valueKind);
  const numericCellCount = kinds.filter((kind) => kind === "numeric").length;
  const textCellCount = kinds.filter((kind) => kind === "text").length;
  const type = numericCellCount && textCellCount ? "table_candidate" : textCellCount ? "metadata_candidate" : "unknown_dense_region";
  return {
    regionId: `region_${index + 1}`,
    type,
    range: encodeRange(regionRange(cells)),
    startRow: Math.min(...cells.map((cell) => cell.row)),
    endRow: Math.max(...cells.map((cell) => cell.row)),
    startCol: Math.min(...cells.map((cell) => cell.col)),
    endCol: Math.max(...cells.map((cell) => cell.col)),
    nonEmptyCellCount: cells.length,
    textCellCount,
    numericCellCount,
    confidence: Number(Math.min(0.95, 0.35 + Math.min(0.4, cells.length / 100) + (numericCellCount && textCellCount ? 0.2 : 0)).toFixed(3)),
    reasons: [
      `${cells.length} non-empty cell${cells.length === 1 ? "" : "s"}`,
      `${textCellCount} text cell${textCellCount === 1 ? "" : "s"}`,
      `${numericCellCount} numeric cell${numericCellCount === 1 ? "" : "s"}`,
    ],
    warnings: [],
  };
}

export function detectRegions(cellGrid, options = {}) {
  const maxBlankGap = Number.isFinite(options.maxBlankGap) ? options.maxBlankGap : 1;
  const cells = [...(cellGrid?.cells || [])].sort((a, b) => a.row - b.row || a.col - b.col);
  const visited = new Set();
  const regions = [];

  cells.forEach((cell, index) => {
    if (visited.has(index)) return;
    const stack = [index];
    const regionIndexes = [];
    visited.add(index);

    while (stack.length) {
      const currentIndex = stack.pop();
      const current = cells[currentIndex];
      regionIndexes.push(currentIndex);
      cells.forEach((candidate, candidateIndex) => {
        if (visited.has(candidateIndex)) return;
        if (!cellsAreNear(current, candidate, maxBlankGap)) return;
        visited.add(candidateIndex);
        stack.push(candidateIndex);
      });
    }

    regions.push(regionIndexes.map((regionIndex) => cells[regionIndex]));
  });

  return regions
    .map(summarizeRegion)
    .sort((a, b) => a.startRow - b.startRow || a.startCol - b.startCol)
    .map((region, index) => ({ ...region, regionId: `region_${index + 1}` }));
}
