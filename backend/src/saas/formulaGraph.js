import * as XLSX from "xlsx";

export const FORMULA_GRAPH_MAX_CELLS = 250_000;
export const REGION_PROVENANCE_SCHEMA_VERSION = "labrat.regionProvenance.v1";
export const SOURCE_CELL_CLASSES_SCHEMA_VERSION = "labrat.sourceCellClasses.v1";

const MAX_RANGE_REF_CELLS = 5_000;
const MAX_CHAIN_DEPTH = 4;
const MAX_BROKEN_CELLS = 20;
const MAX_SHARED_INPUTS = 2;
const MAX_DERIVATION_REFS = 6;
const MAX_DERIVATION_CHARS = 360;
const LABEL_SEARCH_DISTANCE = 12;

const REFERENCE_PATTERN = /(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!)?(?<![A-Za-z0-9_.$])(\$?[A-Z]{1,3}\$?\d{1,7})(?::(\$?[A-Z]{1,3}\$?\d{1,7}))?(?![A-Za-z0-9_(])/g;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeSheetName(value) {
  return text(value).toLowerCase();
}

function cellKey(sheetName, address) {
  return `${normalizeSheetName(sheetName)}!${String(address).toUpperCase()}`;
}

function stripStringLiterals(formula) {
  return String(formula || "").replace(/"(?:[^"]|"")*"/g, "\"\"");
}

function cleanAddress(address) {
  return String(address || "").replace(/\$/g, "").toUpperCase();
}

function isErrorCell(cell) {
  if (!cell) return false;
  if (cell.type === "error") return true;
  return typeof cell.formattedValue === "string" && /^#(DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NULL!)$/.test(cell.formattedValue.trim());
}

function isNumericValue(cell) {
  if (!cell) return false;
  if (isErrorCell(cell)) return false;
  if (typeof cell.rawValue === "number") return true;
  return cell.type === "number";
}

export function parseFormulaReferences(formula, defaultSheet = "") {
  const refs = [];
  const seen = new Set();
  const source = stripStringLiterals(formula);
  for (const match of source.matchAll(REFERENCE_PATTERN)) {
    const sheetName = match[1] ? match[1].replace(/''/g, "'") : match[2] || defaultSheet;
    const start = cleanAddress(match[3]);
    const end = match[4] ? cleanAddress(match[4]) : null;
    if (!end) {
      const key = cellKey(sheetName, start);
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ sheetName, address: start });
      }
      continue;
    }
    let decoded;
    try {
      decoded = XLSX.utils.decode_range(`${start}:${end}`);
    } catch {
      continue;
    }
    const cellCount = (decoded.e.r - decoded.s.r + 1) * (decoded.e.c - decoded.s.c + 1);
    if (!Number.isFinite(cellCount) || cellCount > MAX_RANGE_REF_CELLS) continue;
    for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
      for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const key = cellKey(sheetName, address);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({ sheetName, address });
      }
    }
  }
  return refs;
}

function r1c1Token(ref, origin) {
  const match = /^(\$?)([A-Z]{1,3})(\$?)(\d{1,7})$/.exec(ref);
  if (!match) return ref;
  const [, colAbs, colLetters, rowAbs, rowDigits] = match;
  const decoded = XLSX.utils.decode_cell(`${colLetters}${rowDigits}`);
  const rowPart = rowAbs ? `R${decoded.r + 1}` : (decoded.r === origin.r ? "R" : `R[${decoded.r - origin.r}]`);
  const colPart = colAbs ? `C${decoded.c + 1}` : (decoded.c === origin.c ? "C" : `C[${decoded.c - origin.c}]`);
  return `${rowPart}${colPart}`;
}

/**
 * Converts an A1 formula into a relative R1C1 shape anchored on `address`,
 * so the same calculation at another position produces the same string.
 * String literals are blanked and sheet prefixes are preserved.
 */
export function formulaShape(formula, address) {
  const origin = XLSX.utils.decode_cell(cleanAddress(address));
  const source = stripStringLiterals(formula).toUpperCase();
  return source.replace(REFERENCE_PATTERN, (full, quotedSheet, plainSheet, start, end) => {
    const prefix = quotedSheet ? `'${quotedSheet}'!` : plainSheet ? `${plainSheet}!` : "";
    const startToken = r1c1Token(start, origin);
    return end ? `${prefix}${startToken}:${r1c1Token(end, origin)}` : `${prefix}${startToken}`;
  });
}

function blobSheets(indexBlobs) {
  return asArray(indexBlobs).flatMap((blob) => asArray(blob?.payload?.sheets));
}

export function buildFormulaGraph(indexBlobs = [], { maxCells = FORMULA_GRAPH_MAX_CELLS } = {}) {
  const sheets = blobSheets(indexBlobs);
  const cells = new Map();
  const sheetNames = new Map();
  let total = 0;
  for (const sheet of sheets) {
    const sheetName = text(sheet?.name);
    sheetNames.set(normalizeSheetName(sheetName), sheetName);
    for (const cell of asArray(sheet?.cellGrid?.cells)) {
      total += 1;
      if (total > maxCells) {
        return { cells, sheetNames, precedents: new Map(), dependents: new Map(), truncated: true, cellCount: total };
      }
      const address = cleanAddress(cell?.address);
      if (!address) continue;
      cells.set(cellKey(sheetName, address), { ...cell, address, sheetName });
    }
  }
  const precedents = new Map();
  const dependents = new Map();
  for (const [key, cell] of cells) {
    if (!cell.formula) continue;
    const refs = parseFormulaReferences(cell.formula, cell.sheetName);
    if (!refs.length) continue;
    const precedentKeys = new Set();
    for (const ref of refs) {
      const refKey = cellKey(ref.sheetName, ref.address);
      if (refKey === key) continue;
      precedentKeys.add(refKey);
      if (!dependents.has(refKey)) dependents.set(refKey, new Set());
      dependents.get(refKey).add(key);
    }
    precedents.set(key, precedentKeys);
  }
  return { cells, sheetNames, precedents, dependents, truncated: false, cellCount: total };
}

export function classifyGraphCell(graph, key) {
  const cell = graph.cells.get(key) || null;
  const dependentCount = graph.dependents.get(key)?.size || 0;
  if (cell?.formula) return dependentCount ? "intermediate" : "terminal";
  if (!cell || cell.rawValue == null || cell.rawValue === "") return "blank";
  return dependentCount ? "input" : "constant";
}

export function cellClassAt(graph, sheetName, address) {
  return classifyGraphCell(graph, cellKey(sheetName, cleanAddress(address)));
}

function splitKey(key) {
  const separator = key.lastIndexOf("!");
  return { sheetKey: key.slice(0, separator), address: key.slice(separator + 1) };
}

function displaySheetName(graph, sheetKey) {
  return graph.sheetNames.get(sheetKey) || sheetKey;
}

function labelForCell(graph, key) {
  const { sheetKey, address } = splitKey(key);
  const cell = XLSX.utils.decode_cell(address);
  const candidates = [];
  for (let offset = 1; offset <= LABEL_SEARCH_DISTANCE && cell.c - offset >= 0; offset += 1) {
    candidates.push(XLSX.utils.encode_cell({ r: cell.r, c: cell.c - offset }));
  }
  for (let offset = 1; offset <= LABEL_SEARCH_DISTANCE && cell.r - offset >= 0; offset += 1) {
    candidates.push(XLSX.utils.encode_cell({ r: cell.r - offset, c: cell.c }));
  }
  for (const candidate of candidates) {
    const neighbour = graph.cells.get(`${sheetKey}!${candidate}`);
    if (!neighbour || neighbour.formula) continue;
    if (typeof neighbour.rawValue === "string" && text(neighbour.rawValue)) return text(neighbour.rawValue).slice(0, 60);
  }
  return "";
}

function formattedFor(cell) {
  if (!cell) return "empty";
  const value = cell.formattedValue ?? cell.rawValue;
  if (value == null || value === "") return "empty";
  return String(value).slice(0, 24);
}

function derivationFor(graph, key) {
  const cell = graph.cells.get(key);
  if (!cell?.formula) return "";
  const refs = [...(graph.precedents.get(key) || [])].slice(0, MAX_DERIVATION_REFS);
  const { sheetKey } = splitKey(key);
  const parts = refs.map((refKey) => {
    const { sheetKey: refSheet, address } = splitKey(refKey);
    const label = labelForCell(graph, refKey);
    const where = refSheet === sheetKey ? address : `${displaySheetName(graph, refSheet)}!${address}`;
    const refCell = graph.cells.get(refKey);
    return `${where} = ${formattedFor(refCell)}${label ? ` (${label})` : ""}`;
  });
  const formula = String(cell.formula).slice(0, 120);
  const sentence = `${cell.address} = ${formula}${parts.length ? ` where ${parts.join("; ")}` : ""}`;
  return sentence.length > MAX_DERIVATION_CHARS ? `${sentence.slice(0, MAX_DERIVATION_CHARS - 1)}…` : sentence;
}

function rangeCells(graph, sheetName, range) {
  const decoded = XLSX.utils.decode_range(range);
  const sheetKey = normalizeSheetName(sheetName);
  const cells = [];
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const key = `${sheetKey}!${address}`;
      cells.push({ key, address, row: row + 1, col: col + 1, cell: graph.cells.get(key) || null, cellClass: classifyGraphCell(graph, key) });
    }
  }
  return { decoded, sheetKey, cells };
}

function rowOf(address) {
  return XLSX.utils.decode_cell(address).r;
}

function mixedRunBreaks(graph, keys) {
  const entries = keys.map((key) => ({ key, cell: graph.cells.get(key) || null }));
  const formulas = entries.filter((entry) => entry.cell?.formula);
  if (!formulas.length) return [];
  return entries.filter((entry) => entry.cell && !entry.cell.formula && isNumericValue(entry.cell)).map((entry) => entry.key);
}

function brokenChainCells(graph, region) {
  const breaks = new Map();
  const noteBreak = (key, expectedFrom) => {
    if (breaks.has(key) || breaks.size >= MAX_BROKEN_CELLS) return;
    breaks.set(key, expectedFrom);
  };
  const byRow = new Map();
  for (const entry of region.cells) {
    if (!entry.cell) continue;
    if (!byRow.has(entry.row)) byRow.set(entry.row, []);
    byRow.get(entry.row).push(entry.key);
  }
  for (const [row, keys] of byRow) {
    for (const key of mixedRunBreaks(graph, keys)) noteBreak(key, `row ${row} of the selected range`);
  }
  let frontier = [...byRow.entries()].map(([row, keys]) => ({
    regionRow: row,
    keys: keys.filter((key) => graph.cells.get(key)?.formula),
  })).filter((group) => group.keys.length);
  const visited = new Set(frontier.flatMap((group) => group.keys));
  for (let depth = 1; depth <= MAX_CHAIN_DEPTH && frontier.length; depth += 1) {
    const nextGroups = new Map();
    for (const group of frontier) {
      for (const key of group.keys) {
        for (const precedentKey of graph.precedents.get(key) || []) {
          const { sheetKey, address } = splitKey(precedentKey);
          const groupKey = `${group.regionRow}|${sheetKey}|${rowOf(address)}`;
          if (!nextGroups.has(groupKey)) nextGroups.set(groupKey, { regionRow: group.regionRow, keys: new Set(), sheetKey, row: rowOf(address) + 1 });
          nextGroups.get(groupKey).keys.add(precedentKey);
        }
      }
    }
    frontier = [];
    for (const group of nextGroups.values()) {
      const keys = [...group.keys];
      for (const key of mixedRunBreaks(graph, keys)) {
        noteBreak(key, `${displaySheetName(graph, group.sheetKey)} row ${group.row}, ${depth} step${depth === 1 ? "" : "s"} upstream`);
      }
      const unvisitedFormulas = keys.filter((key) => !visited.has(key) && graph.cells.get(key)?.formula);
      unvisitedFormulas.forEach((key) => visited.add(key));
      if (unvisitedFormulas.length) frontier.push({ regionRow: group.regionRow, keys: unvisitedFormulas });
    }
  }
  return [...breaks.entries()].map(([key, expectedFrom]) => {
    const { sheetKey, address } = splitKey(key);
    return {
      sheetName: displaySheetName(graph, sheetKey),
      address,
      formattedValue: formattedFor(graph.cells.get(key)),
      expectedFrom,
    };
  });
}

function sharedInputsFor(graph, region) {
  const formulaKeys = region.cells.filter((entry) => entry.cell?.formula).map((entry) => entry.key);
  if (formulaKeys.length < 2) return [];
  const regionKeys = new Set(region.cells.map((entry) => entry.key));
  const reach = new Map();
  for (const startKey of formulaKeys) {
    const seen = new Set([startKey]);
    let frontier = [startKey];
    for (let depth = 1; depth <= 3 && frontier.length; depth += 1) {
      const next = [];
      for (const key of frontier) {
        for (const precedentKey of graph.precedents.get(key) || []) {
          if (seen.has(precedentKey)) continue;
          seen.add(precedentKey);
          if (!regionKeys.has(precedentKey)) {
            const entry = reach.get(precedentKey) || { count: 0, depth };
            entry.count += 1;
            entry.depth = Math.min(entry.depth, depth);
            reach.set(precedentKey, entry);
          }
          if (graph.cells.get(precedentKey)?.formula) next.push(precedentKey);
        }
      }
      frontier = next;
    }
  }
  const threshold = Math.ceil(formulaKeys.length * 0.8);
  const candidates = [...reach.entries()]
    .filter(([key, entry]) => entry.count >= threshold && graph.cells.get(key) && graph.cells.get(key).rawValue != null)
    .sort((a, b) => a[1].depth - b[1].depth || b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([key]) => key);
  // Keep the nearest shared cells; drop anything that only feeds an already chosen one.
  const chosen = [];
  for (const key of candidates) {
    if (chosen.length >= MAX_SHARED_INPUTS) break;
    const feedsChosen = chosen.some((chosenKey) => graph.precedents.get(chosenKey)?.has(key));
    if (feedsChosen) continue;
    chosen.push(key);
  }
  return chosen
    .map((key) => {
      const { sheetKey, address } = splitKey(key);
      const cell = graph.cells.get(key);
      return {
        sheetName: displaySheetName(graph, sheetKey),
        address,
        label: labelForCell(graph, key),
        formattedValue: formattedFor(cell),
        cellClass: classifyGraphCell(graph, key),
      };
    });
}

export function regionProvenance({ graph, indexBlobs, sheetName, range } = {}) {
  const resolvedGraph = graph || buildFormulaGraph(indexBlobs);
  if (resolvedGraph.truncated) {
    return {
      schemaVersion: REGION_PROVENANCE_SCHEMA_VERSION,
      graphTruncated: true,
      cellClassSummary: null,
      numericCellCount: 0,
      derivation: "",
      sharedInputs: [],
      brokenCells: [],
      warnings: [{
        code: "formula_graph_skipped",
        message: `The workbook has more than ${FORMULA_GRAPH_MAX_CELLS} cells, so formula provenance was not computed.`,
      }],
    };
  }
  const region = rangeCells(resolvedGraph, sheetName, range);
  const summary = { terminal: 0, intermediate: 0, input: 0, constant: 0, blank: 0 };
  region.cells.forEach((entry) => { summary[entry.cellClass] += 1; });
  const numeric = region.cells.filter((entry) => entry.cell && ((entry.cell.formula && !isErrorCell(entry.cell)) || isNumericValue(entry.cell)));
  const numericCount = numeric.length;
  const count = (cellClass) => numeric.filter((entry) => entry.cellClass === cellClass).length;
  const warnings = [];
  if (numericCount >= 3) {
    const terminalShare = count("terminal") / numericCount;
    const intermediateShare = count("intermediate") / numericCount;
    const inputShare = count("input") / numericCount;
    if (terminalShare < 0.25 && intermediateShare >= 0.5) {
      warnings.push({
        code: "region_mostly_intermediate_cells",
        message: `${count("intermediate")} of ${numericCount} numeric cells feed other calculations in this workbook. The final results are usually the cells nothing else references.`,
      });
    } else if (terminalShare + intermediateShare === 0 && inputShare >= 0.5) {
      warnings.push({
        code: "region_mostly_input_cells",
        message: `${count("input")} of ${numericCount} numeric cells are typed inputs used by formulas elsewhere, not calculated results.`,
      });
    }
  }
  const errorCells = region.cells.filter((entry) => entry.cell && isErrorCell(entry.cell));
  if (errorCells.length && errorCells.length >= Math.max(1, Math.ceil(numericCount * 0.5))) {
    const sample = errorCells.slice(0, 4).map((entry) => entry.address).join(", ");
    warnings.push({
      code: "region_formula_errors",
      message: `${errorCells.length} cell${errorCells.length === 1 ? "" : "s"} in this region show Excel errors such as ${formattedFor(errorCells[0].cell)} (${sample}). The calculation has no valid inputs here; this may be a blank template sheet rather than a result.`,
    });
  }
  const brokenCells = brokenChainCells(resolvedGraph, region);
  if (brokenCells.length) {
    const sample = brokenCells.slice(0, 4).map((item) => item.address).join(", ");
    warnings.push({
      code: "formula_chain_broken",
      message: `${brokenCells.length} cell${brokenCells.length === 1 ? "" : "s"} in this calculation chain hold typed numbers where neighbouring cells hold formulas (${sample}). The values were read as stored; check that they were not overwritten by hand.`,
    });
  }
  const firstTerminal = region.cells.find((entry) => entry.cellClass === "terminal") || region.cells.find((entry) => entry.cell?.formula);
  const sharedInputs = sharedInputsFor(resolvedGraph, region);
  let derivation = firstTerminal ? derivationFor(resolvedGraph, firstTerminal.key) : "";
  if (derivation && sharedInputs.length) {
    derivation += `. Every calculated cell also depends on ${sharedInputs.map((input) => `${input.address}${input.label ? ` (${input.label} = ${input.formattedValue})` : ` = ${input.formattedValue}`}`).join(" and ")}`;
  }
  return {
    schemaVersion: REGION_PROVENANCE_SCHEMA_VERSION,
    graphTruncated: false,
    cellClassSummary: summary,
    numericCellCount: numericCount,
    derivation,
    sharedInputs,
    brokenCells,
    warnings,
  };
}

export function sourceCellClasses({ sourceDocument, indexBlobs = [], sheetName, range, maxCells = 500 } = {}) {
  const sheets = blobSheets(indexBlobs);
  const resolvedSheet = (!sheetName && sheets.length === 1)
    ? sheets[0]
    : sheets.find((sheet) => normalizeSheetName(sheet?.name) === normalizeSheetName(sheetName)) || null;
  if (!resolvedSheet) {
    throw Object.assign(new Error(sheetName
      ? `Sheet ${sheetName} was not found for this source document.`
      : "sheetName is required when the workbook has multiple sheets."), {
      statusCode: 404,
      code: "source_sheet_not_found",
    });
  }
  let decoded;
  try {
    const normalizedRange = String(range || "").trim().toUpperCase();
    if (!/^\$?[A-Z]{1,3}\$?\d{1,7}(?::\$?[A-Z]{1,3}\$?\d{1,7})?$/.test(normalizedRange)) throw new Error("invalid");
    decoded = XLSX.utils.decode_range(normalizedRange.replace(/\$/g, ""));
    if (!Number.isFinite(decoded.s.r) || !Number.isFinite(decoded.e.c) || decoded.e.r < decoded.s.r || decoded.e.c < decoded.s.c) throw new Error("invalid");
  } catch {
    throw Object.assign(new Error("range must be a valid Excel range such as A1:D20."), {
      statusCode: 400,
      code: "invalid_source_range",
    });
  }
  const cellCount = (decoded.e.r - decoded.s.r + 1) * (decoded.e.c - decoded.s.c + 1);
  if (cellCount > maxCells) {
    throw Object.assign(new Error(`Requested range contains ${cellCount} cells; maximum is ${maxCells}.`), {
      statusCode: 400,
      code: "source_range_too_large",
      details: { cellCount, maxCells },
    });
  }
  const graph = buildFormulaGraph(indexBlobs);
  const normalizedRange = XLSX.utils.encode_range(decoded);
  const provenance = regionProvenance({ graph, sheetName: resolvedSheet.name, range: normalizedRange });
  const region = graph.truncated ? { cells: [] } : rangeCells(graph, resolvedSheet.name, normalizedRange);
  return {
    schemaVersion: SOURCE_CELL_CLASSES_SCHEMA_VERSION,
    sourceDocumentId: sourceDocument?.id || null,
    sheetName: resolvedSheet.name,
    range: normalizedRange,
    cellCount,
    graphTruncated: graph.truncated,
    cells: region.cells.map((entry) => ({
      address: entry.address,
      row: entry.row,
      col: entry.col,
      cellClass: entry.cellClass,
      formula: entry.cell?.formula || null,
      formattedValue: entry.cell?.formattedValue ?? (entry.cell?.rawValue == null ? null : String(entry.cell.rawValue)),
      precedentCount: graph.precedents.get(entry.key)?.size || 0,
      dependentCount: graph.dependents.get(entry.key)?.size || 0,
    })),
    summary: provenance.cellClassSummary,
    provenance,
  };
}
