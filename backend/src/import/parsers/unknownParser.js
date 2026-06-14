import { rangeSource } from "../utils/provenanceTracker.js";

export function parseUnknownSheet(sheet, sourceContext = {}) {
  const warnings = [{
    code: "unknown_layout",
    message: "Unknown layout; returning candidate regions, headers, and metadata only.",
  }];

  const blocks = (sheet.regions || []).map((region, index) => ({
    blockId: `${sheet.sheetId}_unknown_${index + 1}`,
    type: "unknown_region",
    range: region.range,
    source: rangeSource(region.range, { ...sourceContext, blockId: `${sheet.sheetId}_unknown_${index + 1}` }),
    candidateHeaders: (sheet.candidateHeaders || []).filter((header) => header.row >= region.startRow && header.row <= region.endRow),
    candidateMetadata: (sheet.candidateMetadata || []).filter((metadata) => metadata.row >= region.startRow && metadata.row <= region.endRow),
    table: null,
    warnings,
    confidence: 0.25,
  }));

  return {
    blocks,
    warnings,
  };
}
