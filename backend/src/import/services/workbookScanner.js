import * as XLSX from "xlsx";
import { scanCells } from "../utils/cellScanner.js";
import { detectRegions } from "../utils/regionDetector.js";
import { detectHeaderRows } from "../utils/headerDetector.js";
import { detectKeyValuePairs } from "../utils/keyValueDetector.js";

function workbookTypeFromName(name) {
  return String(name || "").toLowerCase().endsWith(".xlsx") ? "xlsx" : "xls";
}

function makeFileMetadata(file) {
  return {
    fileId: file.fileId,
    name: file.filename,
    type: workbookTypeFromName(file.filename),
    sizeBytes: file.sizeBytes,
    contentType: file.contentType,
    ...(file.checksumSha256 ? { checksumSha256: file.checksumSha256 } : {}),
  };
}

function sheetSummary(sheetName, worksheet, index, file) {
  const usedRange = worksheet?.["!ref"] || null;
  const cellGrid = scanCells(worksheet);
  const regions = detectRegions(cellGrid);
  const sourceContext = { fileId: file.fileId, fileName: file.filename, sheetName };
  const candidateHeaders = detectHeaderRows(cellGrid.cells, { sourceContext });
  const candidateMetadata = detectKeyValuePairs(cellGrid.cells, sourceContext);
  const warnings = [];
  if (!usedRange) {
    warnings.push({
      code: "empty_sheet",
      message: "Sheet is empty and has no used range.",
    });
  }
  return {
    sheetId: `sheet_${index + 1}`,
    name: sheetName,
    usedRange,
    cellGrid,
    regions,
    candidateHeaders,
    candidateMetadata,
    warnings,
  };
}

export function scanWorkbook(file) {
  const workbook = XLSX.read(file.buffer, {
    type: "buffer",
    cellFormula: true,
    cellNF: true,
    cellText: true,
    cellStyles: true,
    cellComments: true,
  });
  const sheets = workbook.SheetNames.map((sheetName, index) => (
    sheetSummary(sheetName, workbook.Sheets[sheetName], index, file)
  ));
  const warnings = [];
  if (!sheets.length) {
    warnings.push({
      code: "no_sheets",
      message: "Workbook contains no sheets.",
    });
  }
  return {
    file: makeFileMetadata(file),
    sheets,
    warnings,
  };
}
