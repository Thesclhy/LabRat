import { parseBlockTable } from "../parsers/blockTableParser.js";
import { parseStandardTable } from "../parsers/standardTableParser.js";
import { parseUnknownSheet } from "../parsers/unknownParser.js";
import { classifySheetLayout } from "./layoutClassifier.js";
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

  return {
    ...sheet,
    layout,
    blocks: parsed.blocks,
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
