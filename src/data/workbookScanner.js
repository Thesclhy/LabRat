import { fileExpLabel, loadXLSX, readWorkbook, workbookRows } from "./masterTableImporter.js";

const KEYWORDS = ["reaction rate", "parr", "temperature", "pressure", "liquid", "sweep"];

function rangeFromRef(ref) {
  if (!ref) return null;
  const match = String(ref).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return { ref };
  return {
    ref,
    startCol: match[1],
    startRow: Number(match[2]),
    endCol: match[3],
    endRow: Number(match[4]),
  };
}

function nonEmptyBounds(rows) {
  let startRow = null;
  let endRow = null;
  let startCol = null;
  let endCol = null;
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (cell === "" || cell === null || cell === undefined) return;
      startRow = startRow == null ? rowIndex + 1 : Math.min(startRow, rowIndex + 1);
      endRow = endRow == null ? rowIndex + 1 : Math.max(endRow, rowIndex + 1);
      startCol = startCol == null ? colIndex + 1 : Math.min(startCol, colIndex + 1);
      endCol = endCol == null ? colIndex + 1 : Math.max(endCol, colIndex + 1);
    });
  });
  if (startRow == null) return null;
  return { startRow, endRow, startCol, endCol };
}

function candidateHeaderRows(rows) {
  return rows.slice(0, 12)
    .map((row, index) => {
      const stringCount = row.filter((cell) => typeof cell === "string" && cell.trim()).length;
      const unitHits = row.flatMap((cell) => String(cell || "").match(/\([^)]+\)/g) || []);
      return { row: index + 1, stringCount, unitHits };
    })
    .filter((entry) => entry.stringCount >= 2)
    .sort((a, b) => b.stringCount - a.stringCount)
    .slice(0, 3);
}

function detectExperimentLabels(rows) {
  const labels = new Set();
  rows.forEach((row) => {
    row.forEach((cell) => {
      const label = fileExpLabel(String(cell || ""));
      if (label) labels.add(label);
    });
  });
  return [...labels];
}

function detectUnits(rows) {
  const units = new Set();
  rows.forEach((row) => {
    row.forEach((cell) => {
      const matches = String(cell || "").match(/\([^)]+\)/g) || [];
      matches.forEach((match) => units.add(match));
    });
  });
  return [...units];
}

function detectKeywordHits(rows) {
  const hits = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const text = String(cell || "").trim();
      if (!text) return;
      const lower = text.toLowerCase();
      KEYWORDS.forEach((keyword) => {
        if (lower.includes(keyword)) {
          hits.push({ keyword, text, row: rowIndex + 1, col: colIndex + 1 });
        }
      });
    });
  });
  return hits;
}

function likelyTableBlocks(rows, bounds) {
  if (!bounds) return [];
  const headerCandidates = candidateHeaderRows(rows);
  const headerRow = headerCandidates[0]?.row || bounds.startRow;
  return [{
    startRow: headerRow,
    endRow: bounds.endRow,
    startCol: bounds.startCol,
    endCol: bounds.endCol,
  }];
}

export async function scanWorkbookStructure(file) {
  const XLSX = await loadXLSX();
  const workbook = await readWorkbook(XLSX, file);
  const sheets = workbook.SheetNames.map((sheetName) => {
    const ws = workbook.Sheets[sheetName];
    const rows = workbookRows(XLSX, workbook, sheetName);
    const bounds = nonEmptyBounds(rows);
    return {
      sheetName,
      usedRange: rangeFromRef(ws?.["!ref"] || null),
      nonEmptyBounds: bounds,
      candidateHeaderRows: candidateHeaderRows(rows),
      likelyTableBlocks: likelyTableBlocks(rows, bounds),
      detectedExperimentLabels: detectExperimentLabels(rows),
      detectedUnits: detectUnits(rows),
      keywordHits: detectKeywordHits(rows),
    };
  });
  return {
    fileName: file.name,
    experimentLabel: fileExpLabel(file.name),
    workbookType: /\.(xlsx|xls)$/i.test(file.name) ? "excel" : "unknown",
    sheetCount: sheets.length,
    sheetNames: sheets.map((sheet) => sheet.sheetName),
    sheets,
  };
}

export async function scanExcelFolder(fileList) {
  const files = Array.from(fileList || []).filter((file) => /\.(xlsx|xls)$/i.test(file.name));
  const scannedWorkbooks = [];
  for (const file of files) {
    scannedWorkbooks.push(await scanWorkbookStructure(file));
  }
  return {
    scannedAt: new Date().toISOString(),
    workbookCount: scannedWorkbooks.length,
    scannedWorkbooks,
  };
}
