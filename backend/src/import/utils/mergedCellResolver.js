import { encodeRange } from "./excelAddress.js";

export function findMergedRange(merges, rowIndex, colIndex) {
  return (Array.isArray(merges) ? merges : []).find((candidate) => (
    rowIndex >= candidate.s.r
    && rowIndex <= candidate.e.r
    && colIndex >= candidate.s.c
    && colIndex <= candidate.e.c
  )) || null;
}

export function mergedCellInfo(merges, rowIndex, colIndex) {
  const merge = findMergedRange(merges, rowIndex, colIndex);
  return merge ? { merged: true, mergedRange: encodeRange(merge) } : { merged: false, mergedRange: null };
}
