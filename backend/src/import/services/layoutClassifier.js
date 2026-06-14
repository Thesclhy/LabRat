import { confidenceFromSignals } from "../utils/confidence.js";

function hasRepeatedHeaderNames(headers) {
  const signatures = headers.map((header) => (
    header.columns.map((column) => column.label || column.rawName).join("|").toLowerCase()
  ));
  return signatures.some((signature, index) => signatures.indexOf(signature) !== index);
}

function classifyBlockTable(sheet) {
  const regions = sheet.regions || [];
  const headers = sheet.candidateHeaders || [];
  const metadata = sheet.candidateMetadata || [];
  const repeatedHeaders = hasRepeatedHeaderNames(headers);
  const result = confidenceFromSignals([
    { active: regions.length >= 2, weight: 0.3, reason: "multiple separated regions detected" },
    { active: headers.length >= 2, weight: 0.25, reason: "multiple candidate header rows detected" },
    { active: repeatedHeaders, weight: 0.25, reason: "repeated similar header rows detected" },
    { active: metadata.length >= 2, weight: 0.15, reason: "metadata-like key/value rows detected" },
  ]);
  return result.confidence >= 0.55 ? { type: "block_table", ...result } : null;
}

function classifyStandardTable(sheet) {
  const regions = sheet.regions || [];
  const headers = sheet.candidateHeaders || [];
  const dominantRegion = regions[0];
  const header = headers[0];
  if (!header) return null;
  const result = confidenceFromSignals([
    { active: regions.length === 1, weight: 0.3, reason: "one dominant region detected" },
    { active: !!header, weight: 0.3, reason: "candidate header row detected" },
    { active: (dominantRegion?.numericCellCount || 0) > 0, weight: 0.25, reason: "numeric data cells detected" },
    { active: headers.length <= 1, weight: 0.1, reason: "no repeated header pattern detected" },
  ]);
  return result.confidence >= 0.6 ? { type: "standard_table", ...result } : null;
}

export function classifySheetLayout(sheet) {
  const block = classifyBlockTable(sheet);
  if (block) return block;

  const standard = classifyStandardTable(sheet);
  if (standard) return standard;

  return {
    type: "unknown",
    confidence: 0.25,
    reasons: ["no reliable standard or block table pattern detected"],
  };
}
