import { detectHeaderRows } from "../utils/headerDetector.js";
import { detectKeyValuePairs } from "../utils/keyValueDetector.js";
import { cellSource, rangeSource } from "../utils/provenanceTracker.js";
import { parseStandardTable } from "./standardTableParser.js";

function cellsInRegion(cells, region) {
  return (cells || []).filter((cell) => (
    cell.row >= region.startRow
    && cell.row <= region.endRow
    && cell.col >= region.startCol
    && cell.col <= region.endCol
  ));
}

function titleForRegion(cells, headerRow, sourceContext) {
  const titleCell = cells
    .filter((cell) => cell.row < headerRow && typeof cell.rawValue === "string" && String(cell.rawValue).trim())
    .sort((a, b) => a.row - b.row || a.col - b.col)[0];
  if (!titleCell) return null;
  return {
    value: String(titleCell.rawValue).trim(),
    source: cellSource(titleCell, sourceContext),
  };
}

function metadataBeforeHeader(cells, headerRow, sourceContext) {
  return detectKeyValuePairs(cells.filter((cell) => cell.row < headerRow), sourceContext);
}

export function parseBlockTable(sheet, sourceContext = {}) {
  const blocks = [];
  const warnings = [];
  const regions = sheet.regions || [];

  regions.forEach((region, index) => {
    const regionCells = cellsInRegion(sheet.cellGrid?.cells, region);
    const candidateHeaders = detectHeaderRows(regionCells, { sourceContext });
    const header = candidateHeaders[0];
    const blockId = `${sheet.sheetId}_block_${index + 1}`;
    const blockContext = { ...sourceContext, blockId };

    if (!header) {
      warnings.push({
        code: "block_header_not_found",
        message: `No header row found for block ${index + 1}.`,
        range: region.range,
      });
      blocks.push({
        blockId,
        type: "unknown_block",
        range: region.range,
        title: null,
        metadata: [],
        table: null,
        source: rangeSource(region.range, blockContext),
        warnings: [{ code: "block_header_not_found", message: "No header row found for this block." }],
        confidence: 0.25,
      });
      return;
    }

    const parsed = parseStandardTable({
      sheetId: sheet.sheetId,
      cellGrid: { rowCount: region.endRow, cells: regionCells },
      candidateHeaders,
    }, blockContext);
    const tableBlock = parsed.blocks[0];
    blocks.push({
      blockId,
      type: "experiment_block",
      range: region.range,
      title: titleForRegion(regionCells, header.row, blockContext),
      metadata: metadataBeforeHeader(regionCells, header.row, blockContext),
      table: tableBlock?.table || null,
      source: rangeSource(region.range, blockContext),
      warnings: tableBlock?.warnings || parsed.warnings || [],
      confidence: Math.min(0.95, Math.max(header.confidence, 0.7)),
    });
  });

  if (!regions.length) {
    warnings.push({ code: "no_regions", message: "No regions were available for block table parsing." });
  }

  return { blocks, warnings };
}
