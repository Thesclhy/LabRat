import { encodeRange } from "./excelAddress.js";
import { keyValueSource } from "./provenanceTracker.js";
import { detectUnitFromValue } from "./unitDetector.js";
import { confidenceResult } from "./confidence.js";

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

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isNumericCell(cell) {
  return cell.type === "number" || typeof cell.rawValue === "number";
}

function rowRange(cells) {
  return encodeRange({
    s: { r: cells[0].row - 1, c: cells[0].col - 1 },
    e: { r: cells[cells.length - 1].row - 1, c: cells[cells.length - 1].col - 1 },
  });
}

function withParsedValue(rawValue) {
  const detected = detectUnitFromValue(rawValue);
  if (detected.unit) return detected;
  return {
    rawValue: cleanText(rawValue),
    parsedValue: isFinite(Number(rawValue)) && cleanText(rawValue) !== "" ? Number(rawValue) : null,
    unit: null,
  };
}

function candidateFromSingleCell(cell, context = {}) {
  const text = cleanText(cell.rawValue);
  const match = text.match(/^([^:=]{2,80})\s*[:=]\s*(.+)$/);
  if (!match) return null;
  const parsed = withParsedValue(match[2]);
  const confidence = confidenceResult(0.86, ["single-cell key/value delimiter"]);
  return {
    rawKey: cleanText(match[1]),
    rawValue: parsed.rawValue,
    parsedValue: parsed.parsedValue,
    unit: parsed.unit,
    source: keyValueSource(cell, cell, { ...context, range: cell.address }),
    ...confidence,
  };
}

function candidateFromTwoCells(cells, context = {}) {
  if (cells.length < 2 || cells.length > 3) return null;
  const [keyCell, valueCell] = cells;
  if (isNumericCell(keyCell)) return null;
  const rawKey = cleanText(keyCell.rawValue).replace(/[:=]\s*$/, "");
  if (rawKey.length < 2 || rawKey.length > 80) return null;
  if (rawKey.includes("|")) return null;
  const rawValueText = cleanText(valueCell.rawValue);
  if (!rawValueText) return null;
  const parsed = withParsedValue(rawValueText);
  const confidence = confidenceResult(0.78, ["adjacent key/value cells"]);
  return {
    rawKey,
    rawValue: parsed.rawValue,
    parsedValue: parsed.parsedValue,
    unit: parsed.unit,
    source: keyValueSource(keyCell, valueCell, { ...context, range: rowRange([keyCell, valueCell]) }),
    ...confidence,
  };
}

export function detectKeyValuePairs(cells, context = {}) {
  return groupCellsByRow(cells)
    .flatMap((rowEntry) => {
      const singleCellCandidates = rowEntry.cells
        .map((cell) => candidateFromSingleCell(cell, context))
        .filter(Boolean);
      if (singleCellCandidates.length) {
        return singleCellCandidates.map((candidate) => ({ ...candidate, row: rowEntry.row }));
      }
      const twoCellCandidate = candidateFromTwoCells(rowEntry.cells, context);
      return twoCellCandidate ? [{ ...twoCellCandidate, row: rowEntry.row }] : [];
    });
}
