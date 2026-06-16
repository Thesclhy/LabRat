import { parseBlockTable } from "../parsers/blockTableParser.js";
import { parseStandardTable } from "../parsers/standardTableParser.js";
import { parseUnknownSheet } from "../parsers/unknownParser.js";
import { classifySheetLayout } from "./layoutClassifier.js";
import { detectReactionRateObservationSet } from "./reactionRateObservationSet.js";
import { shapeScanResponse } from "./scanResponse.js";
import { scanWorkbook } from "./workbookScanner.js";

function parseSheet(sheet, file) {
  const sourceContext = { fileId: file.fileId, fileName: file.name, sheetName: sheet.name };
  const layout = classifySheetLayout(sheet);
  const parseInput = { ...sheet, layout };
  const parsed = layout.type === "standard_table"
    ? parseStandardTable(parseInput, sourceContext)
    : layout.type === "block_table"
      ? parseBlockTable(parseInput, sourceContext)
      : parseUnknownSheet(parseInput, sourceContext);
  const blockDetections = new Map();
  const blocks = (parsed.blocks || []).map((block) => {
    const detection = detectReactionRateObservationSet({ fileName: file.name, sheetName: sheet.name, block });
    if (!detection) return block;
    blockDetections.set(block.blockId, detection);
    return {
      ...block,
      detectedSupplementType: detection.kind,
      detectedRecordKind: "supplemental_time_series",
      observationSetPreview: {
        schemaVersion: detection.schemaVersion,
        kind: detection.kind,
        inferredExperimentLabel: detection.inferredExperimentLabel,
        fieldCount: detection.columns.length,
        confidence: detection.confidence,
      },
    };
  });
  const structureProposals = (parsed.structureProposals || []).map((proposal) => {
    const detection = blockDetections.get(proposal.tableId);
    if (!detection) return proposal;
    return {
      ...proposal,
      detectedSupplementType: detection.kind,
      detectedRecordKind: "supplemental_time_series",
      observationSetPreview: {
        schemaVersion: detection.schemaVersion,
        kind: detection.kind,
        inferredExperimentLabel: detection.inferredExperimentLabel,
        fieldCount: detection.columns.length,
        confidence: detection.confidence,
      },
    };
  });

  return {
    ...sheet,
    layout,
    blocks,
    structureProposals,
    warnings: [...(sheet.warnings || []), ...(parsed.warnings || [])],
  };
}

export function runImportScan(file) {
  const scan = scanWorkbook(file);
  return shapeScanResponse({
    ...scan,
    sheets: scan.sheets.map((sheet) => parseSheet(sheet, scan.file)),
  });
}
