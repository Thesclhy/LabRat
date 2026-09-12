import * as XLSX from "xlsx";
import { sha256Hex } from "./ids.js";
import { buildFormulaGraph, formulaShape, regionProvenance } from "./formulaGraph.js";

export const REGION_EXTRACTION_TEMPLATE_SCHEMA_VERSION = "labrat.regionExtractionTemplate.v1";
export const REGION_EXTRACTION_TEMPLATE_VERSION_SCHEMA_VERSION = "labrat.regionExtractionTemplateVersion.v1";
export const LAYOUT_SIGNATURE_SCHEMA_VERSION = "labrat.layoutSignature.v1";
export const TEMPLATE_MATCH_REPORT_SCHEMA_VERSION = "labrat.regionTemplateMatchReport.v1";

export const TEMPLATE_MATCH_STATUSES = Object.freeze([
  "exact",
  "shifted",
  "ambiguous",
  "label_missing",
  "formula_mismatch",
  "header_mismatch",
  "no_match",
]);

const MAX_SIGNATURE_CELLS = 600;
const MAX_TEXT_ANCHORS = 12;
const MAX_BORDER_ANCHORS = 8;
const BORDER_DISTANCE = 3;
const MIN_HEADER_RUN = 4;
const MAX_SHEET_CELLS = 50_000;
const MAX_CANDIDATES = 6;
const MAX_MISMATCH_DETAILS = 20;
const EXPERIMENT_PATTERN = /\bexp(?:eriment)?[\s_-]*0*(\d{1,5})\b/i;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fail(code, message, statusCode = 400, details = {}) {
  throw Object.assign(new Error(message), { code, statusCode, details });
}

function isNumericCell(cell) {
  return Boolean(cell) && (typeof cell.rawValue === "number" || cell.type === "number");
}

function isTextCell(cell) {
  return Boolean(cell) && !cell.formula && typeof cell.rawValue === "string" && text(cell.rawValue) !== "";
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function isSubsequence(short, long) {
  let index = 0;
  for (const character of long) {
    if (character === short[index]) index += 1;
    if (index === short.length) return true;
  }
  return index === short.length;
}

export function fuzzyTextMatch(expected, actual) {
  const left = normalizeText(expected);
  const right = normalizeText(actual);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) return 0.85;
  const distance = levenshtein(left, right);
  const allowed = Math.max(1, Math.floor(Math.max(left.length, right.length) * 0.25));
  if (distance <= allowed) return 0.7;
  // Typing accidents such as "Overal+P31:AO32l tots" keep the original label
  // as an ordered subsequence with extra characters pasted inside it.
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length >= 6 && short.length / long.length >= 0.5 && isSubsequence(short, long)) return 0.6;
  return 0;
}

function sheetsOf(indexBlobs) {
  return asArray(indexBlobs).flatMap((blob) => asArray(blob?.payload?.sheets));
}

function findSheet(indexBlobs, sheetName) {
  const sheets = sheetsOf(indexBlobs);
  return sheets.find((sheet) => normalizeText(sheet?.name) === normalizeText(sheetName)) || null;
}

function sheetCellMap(sheet) {
  const map = new Map();
  for (const cell of asArray(sheet?.cellGrid?.cells)) {
    const address = String(cell?.address || "").toUpperCase();
    if (!address) continue;
    const decoded = XLSX.utils.decode_cell(address);
    map.set(`${decoded.r}:${decoded.c}`, { ...cell, address, r: decoded.r, c: decoded.c });
  }
  return map;
}

function cellAt(cells, r, c) {
  return r < 0 || c < 0 ? null : cells.get(`${r}:${c}`) || null;
}

function headerRunFrom(cells, r, cStart, cEnd) {
  const runs = [];
  let c = cStart;
  while (c <= cEnd) {
    const cell = cellAt(cells, r, c);
    const match = isTextCell(cell) ? /^([A-Za-z][A-Za-z\s\-]*?)?\s*(\d{1,4})$/.exec(text(cell.rawValue)) : null;
    if (!match) {
      c += 1;
      continue;
    }
    const prefix = normalizeText(match[1] || "");
    const startNumber = Number(match[2]);
    let count = 1;
    while (c + count <= cEnd) {
      const next = cellAt(cells, r, c + count);
      const nextMatch = isTextCell(next) ? /^([A-Za-z][A-Za-z\s\-]*?)?\s*(\d{1,4})$/.exec(text(next.rawValue)) : null;
      if (!nextMatch || normalizeText(nextMatch[1] || "") !== prefix || Number(nextMatch[2]) !== startNumber + count) break;
      count += 1;
    }
    if (count >= MIN_HEADER_RUN) runs.push({ r, c, count, prefix, startNumber });
    c += count;
  }
  return runs;
}

function relativeRange(rangeRef, origin) {
  const decoded = XLSX.utils.decode_range(rangeRef);
  return {
    relRow: decoded.s.r - origin.r,
    relRowEnd: decoded.e.r - origin.r,
    relCol: decoded.s.c - origin.c,
    relColEnd: decoded.e.c - origin.c,
  };
}

function absoluteRange(relative, origin) {
  return XLSX.utils.encode_range({
    s: { r: origin.r + relative.relRow, c: origin.c + relative.relCol },
    e: { r: origin.r + relative.relRowEnd, c: origin.c + relative.relColEnd },
  });
}

function columnIndex(column) {
  return XLSX.utils.decode_col(String(column || "A").toUpperCase());
}

function semanticsFromInterpretation(interpretation, origin) {
  const source = interpretation && typeof interpretation === "object" ? interpretation : {};
  const { provenance: _provenance, ...rest } = source;
  return {
    semanticType: rest.semanticType || null,
    experimentAxis: rest.experimentAxis || null,
    headerRowOffset: Number.isInteger(Number(rest.headerRow)) ? Number(rest.headerRow) - 1 - origin.r : null,
    experimentIdColumnOffset: rest.experimentIdColumn ? columnIndex(rest.experimentIdColumn) - origin.c : null,
    fields: asArray(rest.fields).map((field) => ({
      columnOffset: columnIndex(field.column) - origin.c,
      semanticKey: field.semanticKey || null,
      displayName: field.displayName || null,
      role: field.role || null,
      valueType: field.valueType || null,
      unit: field.unit || null,
      numericScale: field.numericScale || null,
    })),
    series: asArray(rest.series).map((series) => ({
      seriesKey: series.seriesKey || null,
      label: series.label || null,
      orientation: series.orientation || "column_pair",
      ...(series.xHeaderRange ? { xHeader: relativeRange(series.xHeaderRange, origin) } : {}),
      ...(series.yValueRange ? { yValues: relativeRange(series.yValueRange, origin) } : {}),
      ...(series.xColumn ? { xColumnOffset: columnIndex(series.xColumn) - origin.c } : {}),
      ...(series.yColumn ? { yColumnOffset: columnIndex(series.yColumn) - origin.c } : {}),
      xSemanticKey: series.xSemanticKey || null,
      ySemanticKey: series.ySemanticKey || null,
      xValueType: series.xValueType || null,
      xUnit: series.xUnit || null,
      yUnit: series.yUnit || null,
      yNumericScale: series.yNumericScale || null,
    })),
    inclusion: rest.inclusion && typeof rest.inclusion === "object"
      ? {
        startRowOffset: Number.isInteger(Number(rest.inclusion.startRow)) ? Number(rest.inclusion.startRow) - 1 - origin.r : null,
        endRowOffset: Number.isInteger(Number(rest.inclusion.endRow)) ? Number(rest.inclusion.endRow) - 1 - origin.r : null,
      }
      : null,
  };
}

export function compileLayoutSignature({ sourceDocument, indexBlobs, region, revision } = {}) {
  if (!region?.sheetName || !(region.rangeRef || region.range)) fail("region_extraction_template_invalid", "The source region needs a sheet and range.");
  const sheet = findSheet(indexBlobs, region.sheetName);
  if (!sheet) fail("source_sheet_not_found", `Sheet ${region.sheetName} was not found for this source document.`, 404);
  const rangeRef = region.rangeRef || region.range;
  const decoded = XLSX.utils.decode_range(rangeRef);
  const origin = { r: decoded.s.r, c: decoded.s.c };
  const rows = decoded.e.r - decoded.s.r + 1;
  const cols = decoded.e.c - decoded.s.c + 1;
  if (rows * cols > MAX_SIGNATURE_CELLS) {
    fail("region_extraction_template_too_large", `A template region may contain at most ${MAX_SIGNATURE_CELLS} cells.`, 400, { cellCount: rows * cols });
  }
  const cells = sheetCellMap(sheet);
  const headerRuns = [];
  for (let r = decoded.s.r; r <= decoded.e.r; r += 1) {
    for (const run of headerRunFrom(cells, r, decoded.s.c, decoded.e.c)) {
      headerRuns.push({ relRow: run.r - origin.r, relCol: run.c - origin.c, count: run.count, prefix: run.prefix, startNumber: run.startNumber });
    }
  }
  const inRun = (r, c) => headerRuns.some((run) => (
    r - origin.r === run.relRow && c - origin.c >= run.relCol && c - origin.c < run.relCol + run.count
  ));
  const cellExpectations = [];
  const textAnchors = [];
  let blankCount = 0;
  for (let r = decoded.s.r; r <= decoded.e.r; r += 1) {
    for (let c = decoded.s.c; c <= decoded.e.c; c += 1) {
      const cell = cellAt(cells, r, c);
      const relRow = r - origin.r;
      const relCol = c - origin.c;
      if (!cell || (cell.rawValue == null && !cell.formula) || cell.rawValue === "") {
        blankCount += 1;
        continue;
      }
      if (cell.formula) {
        cellExpectations.push({ relRow, relCol, kind: "formula", formulaShape: formulaShape(cell.formula, cell.address) });
      } else if (isNumericCell(cell)) {
        cellExpectations.push({ relRow, relCol, kind: "number" });
      } else if (isTextCell(cell)) {
        cellExpectations.push({ relRow, relCol, kind: "text" });
        if (!inRun(r, c)) textAnchors.push({ relRow, relCol, text: text(cell.rawValue).slice(0, 80) });
      } else {
        cellExpectations.push({ relRow, relCol, kind: "other" });
      }
    }
  }
  textAnchors.sort((a, b) => b.text.length - a.text.length);
  const borderAnchors = [];
  for (let r = decoded.s.r - BORDER_DISTANCE; r <= decoded.e.r + BORDER_DISTANCE; r += 1) {
    for (let c = decoded.s.c - BORDER_DISTANCE; c <= decoded.e.c + BORDER_DISTANCE; c += 1) {
      const inside = r >= decoded.s.r && r <= decoded.e.r && c >= decoded.s.c && c <= decoded.e.c;
      if (inside) continue;
      const cell = cellAt(cells, r, c);
      if (!isTextCell(cell)) continue;
      borderAnchors.push({ relRow: r - origin.r, relCol: c - origin.c, text: text(cell.rawValue).slice(0, 80) });
    }
  }
  borderAnchors.sort((a, b) => b.text.length - a.text.length);
  const experimentLabel = text(revision?.interpretation?.experimentLabel);
  let labelCell = null;
  if (experimentLabel) {
    const wanted = normalizeText(experimentLabel);
    for (const cell of cells.values()) {
      if (isTextCell(cell) && normalizeText(cell.rawValue) === wanted) {
        labelCell = cell.address;
        break;
      }
    }
  }
  const signature = {
    schemaVersion: LAYOUT_SIGNATURE_SCHEMA_VERSION,
    sheetName: sheet.name,
    companionSheetNames: sheetsOf(indexBlobs).map((item) => text(item?.name)).filter((name) => name && name !== sheet.name).slice(0, 20),
    anchorRange: XLSX.utils.encode_range(decoded),
    rangeShape: { rows, cols },
    headerRuns,
    textAnchors: textAnchors.slice(0, MAX_TEXT_ANCHORS),
    borderAnchors: borderAnchors.slice(0, MAX_BORDER_ANCHORS),
    cellExpectations,
    blankCount,
    experimentLabelRule: {
      ...(labelCell ? { kind: "cell", address: labelCell } : { kind: "filename" }),
      exampleLabel: experimentLabel || null,
      filenamePattern: EXPERIMENT_PATTERN.source,
    },
  };
  return {
    signature,
    semantics: semanticsFromInterpretation(revision?.interpretation, origin),
  };
}

export function buildRegionExtractionTemplateVersion({
  sourceDocument,
  indexBlobs,
  region,
  revision,
  version = 1,
} = {}) {
  if (!region?.id) fail("region_extraction_template_invalid", "A source region is required.");
  if (!revision?.id || revision.regionId !== region.id) fail("region_extraction_template_invalid", "The accepted revision must belong to the source region.");
  if (!region.acceptedRevisionId || region.acceptedRevisionId !== revision.id) {
    fail("region_extraction_template_requires_confirmed_region", "Confirm the region before saving it as an extraction template.", 409);
  }
  const compiled = compileLayoutSignature({ sourceDocument, indexBlobs, region, revision });
  const content = {
    schemaVersion: REGION_EXTRACTION_TEMPLATE_VERSION_SCHEMA_VERSION,
    signature: compiled.signature,
    semantics: compiled.semantics,
  };
  return {
    schemaVersion: REGION_EXTRACTION_TEMPLATE_VERSION_SCHEMA_VERSION,
    version,
    status: "accepted",
    sourceRegionId: region.id,
    sourceRevisionId: revision.id,
    sourceDocumentId: region.sourceDocumentId || sourceDocument?.id || null,
    sourceWorkbookName: text(sourceDocument?.metadata?.workbookName) || null,
    signature: compiled.signature,
    semantics: compiled.semantics,
    contentHash: sha256Hex(JSON.stringify(content)),
  };
}

function candidateOriginsFor(signature, cells, originalOrigin) {
  const votes = new Map();
  const addVote = (r, c, weight) => {
    if (r < 0 || c < 0) return;
    const key = `${r}:${c}`;
    votes.set(key, (votes.get(key) || 0) + weight);
  };
  const anchors = [...asArray(signature.borderAnchors), ...asArray(signature.textAnchors)];
  if (anchors.length) {
    for (const cell of cells.values()) {
      if (!isTextCell(cell)) continue;
      for (const anchor of anchors) {
        const score = fuzzyTextMatch(anchor.text, cell.rawValue);
        if (score) addVote(cell.r - anchor.relRow, cell.c - anchor.relCol, score);
      }
    }
  }
  for (const run of asArray(signature.headerRuns)) {
    const first = `${run.prefix}${run.startNumber}`;
    for (const cell of cells.values()) {
      if (!isTextCell(cell) || normalizeText(cell.rawValue) !== first) continue;
      const found = headerRunFrom(cells, cell.r, cell.c, cell.c + run.count + 2).find((candidate) => candidate.c === cell.c);
      if (found && found.count >= Math.min(run.count, MIN_HEADER_RUN)) addVote(cell.r - run.relRow, cell.c - run.relCol, 2);
    }
  }
  if (originalOrigin) addVote(originalOrigin.r, originalOrigin.c, 0);
  return [...votes.entries()]
    .map(([key, score]) => {
      const [r, c] = key.split(":").map(Number);
      return { r, c, votes: score };
    })
    .sort((a, b) => b.votes - a.votes || a.r - b.r || a.c - b.c)
    .slice(0, MAX_CANDIDATES + 1);
}

function evaluateCandidate({ signature, cells, origin, sheetName, indexBlobs, graph }) {
  const headerRunResults = asArray(signature.headerRuns).map((run) => {
    const found = headerRunFrom(cells, origin.r + run.relRow, origin.c + run.relCol, origin.c + run.relCol + run.count + 4)
      .find((candidate) => candidate.c === origin.c + run.relCol && candidate.prefix === run.prefix && candidate.startNumber === run.startNumber);
    return { expectedCount: run.count, foundCount: found?.count || 0, ok: Boolean(found && found.count === run.count) };
  });
  const headerRunsOk = headerRunResults.every((result) => result.ok);
  const anchors = [...asArray(signature.borderAnchors), ...asArray(signature.textAnchors)];
  const anchorScores = anchors.map((anchor) => {
    const cell = cellAt(cells, origin.r + anchor.relRow, origin.c + anchor.relCol);
    return isTextCell(cell) ? fuzzyTextMatch(anchor.text, cell.rawValue) : 0;
  });
  const textScore = anchors.length ? anchorScores.reduce((sum, score) => sum + score, 0) / anchors.length : 1;
  const formulaMismatches = [];
  let formulaExpected = 0;
  let formulaOk = 0;
  for (const expectation of asArray(signature.cellExpectations)) {
    const cell = cellAt(cells, origin.r + expectation.relRow, origin.c + expectation.relCol);
    if (expectation.kind === "formula") {
      formulaExpected += 1;
      if (cell?.formula && formulaShape(cell.formula, cell.address) === expectation.formulaShape) {
        formulaOk += 1;
      } else if (formulaMismatches.length < MAX_MISMATCH_DETAILS) {
        formulaMismatches.push({
          address: XLSX.utils.encode_cell({ r: origin.r + expectation.relRow, c: origin.c + expectation.relCol }),
          expected: "formula",
          found: cell?.formula ? "different_formula" : isNumericCell(cell) ? "typed_number" : cell ? "other_value" : "blank",
        });
      }
    } else if (expectation.kind === "number") {
      if (!(isNumericCell(cell) || cell?.formula) && formulaMismatches.length < MAX_MISMATCH_DETAILS) {
        formulaMismatches.push({
          address: XLSX.utils.encode_cell({ r: origin.r + expectation.relRow, c: origin.c + expectation.relCol }),
          expected: "number",
          found: cell ? "other_value" : "blank",
        });
      }
    }
  }
  const matchedRange = XLSX.utils.encode_range({
    s: origin,
    e: { r: origin.r + signature.rangeShape.rows - 1, c: origin.c + signature.rangeShape.cols - 1 },
  });
  let provenance = null;
  let brokenCells = [];
  const structureOk = headerRunsOk && !formulaMismatches.length;
  if (structureOk) {
    try {
      provenance = regionProvenance({ graph, indexBlobs, sheetName, range: matchedRange });
      brokenCells = asArray(provenance.brokenCells);
    } catch {
      provenance = null;
    }
  }
  let status;
  if (!headerRunsOk) status = "header_mismatch";
  else if (formulaMismatches.length || brokenCells.length) status = "formula_mismatch";
  else status = "matched";
  const anchorEvidence = textScore > 0 || headerRunResults.some((result) => result.foundCount > 0);
  return {
    origin,
    matchedRange,
    status,
    anchorEvidence,
    score: (headerRunsOk ? 2 : 0) + textScore + (formulaExpected ? formulaOk / formulaExpected : 1),
    textScore,
    headerRuns: headerRunResults,
    formulaMismatches,
    brokenCells,
    provenanceWarnings: asArray(provenance?.warnings),
  };
}

export function experimentLabelFromWorkbookName(workbookName) {
  const match = EXPERIMENT_PATTERN.exec(text(workbookName));
  return match ? `Exp${Number(match[1])}` : null;
}

function resolveExperimentLabel({ signature, cells, sourceDocument }) {
  const rule = signature.experimentLabelRule || {};
  if (rule.kind === "cell" && rule.address) {
    const decoded = XLSX.utils.decode_cell(rule.address);
    const cell = cellAt(cells, decoded.r, decoded.c);
    const value = text(cell?.formattedValue ?? cell?.rawValue);
    if (value) return { experimentLabel: value, labelSource: "cell", labelAddress: rule.address };
  }
  const workbookName = text(sourceDocument?.metadata?.workbookName || sourceDocument?.metadata?.fileName);
  const match = EXPERIMENT_PATTERN.exec(workbookName);
  if (match) return { experimentLabel: `Exp${Number(match[1])}`, labelSource: "filename", labelAddress: null };
  return { experimentLabel: null, labelSource: null, labelAddress: null };
}

function matchSheet({ signature, sheet, sourceDocument, indexBlobs, graph, originalOrigin }) {
  const cells = sheetCellMap(sheet);
  if (cells.size > MAX_SHEET_CELLS) {
    return { sheetName: sheet.name, status: "no_match", warnings: [{ code: "sheet_too_large", message: `Sheet ${sheet.name} has more than ${MAX_SHEET_CELLS} cells and was not scanned.` }] };
  }
  const candidates = candidateOriginsFor(signature, cells, originalOrigin)
    .map((candidate) => ({
      ...evaluateCandidate({ signature, cells, origin: { r: candidate.r, c: candidate.c }, sheetName: sheet.name, indexBlobs, graph }),
      votes: candidate.votes,
    }));
  const matched = candidates.filter((candidate) => candidate.status === "matched");
  const original = originalOrigin
    ? candidates.find((candidate) => candidate.origin.r === originalOrigin.r && candidate.origin.c === originalOrigin.c)
    : null;
  const describe = (candidate) => ({
    matchedRange: candidate.matchedRange,
    offset: originalOrigin ? { rows: candidate.origin.r - originalOrigin.r, cols: candidate.origin.c - originalOrigin.c } : { rows: 0, cols: 0 },
    score: Number(candidate.score.toFixed(3)),
    textAnchorScore: Number(candidate.textScore.toFixed(3)),
    headerRuns: candidate.headerRuns,
    formulaMismatches: candidate.formulaMismatches,
    brokenCells: candidate.brokenCells,
    provenanceWarnings: candidate.provenanceWarnings,
  });
  let chosen = null;
  let status = "no_match";
  let alternatives = [];
  if (original?.status === "matched") {
    chosen = original;
    status = "exact";
    alternatives = matched.filter((candidate) => candidate !== original).map(describe);
  } else if (matched.length === 1) {
    chosen = matched[0];
    status = "shifted";
  } else if (matched.length > 1) {
    chosen = matched[0];
    status = "ambiguous";
    alternatives = matched.map(describe);
  } else {
    const withEvidence = candidates.filter((candidate) => candidate.anchorEvidence || candidate === original);
    const best = [...withEvidence].sort((a, b) => b.score - a.score)[0] || null;
    if (best && best.anchorEvidence) {
      chosen = best;
      status = best.status;
    }
  }
  const label = ["exact", "shifted"].includes(status) ? resolveExperimentLabel({ signature, cells, sourceDocument }) : { experimentLabel: null, labelSource: null, labelAddress: null };
  if (["exact", "shifted"].includes(status) && !label.experimentLabel) status = "label_missing";
  return {
    sheetName: sheet.name,
    status,
    ...(chosen ? describe(chosen) : { matchedRange: null, offset: null, score: 0, textAnchorScore: 0, headerRuns: [], formulaMismatches: [], brokenCells: [], provenanceWarnings: [] }),
    alternatives,
    ...label,
    warnings: [],
  };
}

const STATUS_RANK = { exact: 6, shifted: 5, label_missing: 4, ambiguous: 3, formula_mismatch: 2, header_mismatch: 1, no_match: 0 };

export function matchTemplateVersionToDocument({ templateVersion, sourceDocument, indexBlobs } = {}) {
  const signature = templateVersion?.signature;
  if (!signature) fail("region_extraction_template_invalid", "The template version has no layout signature.");
  const sheets = sheetsOf(indexBlobs);
  const originalOrigin = (() => {
    try {
      const decoded = XLSX.utils.decode_range(signature.anchorRange);
      return { r: decoded.s.r, c: decoded.s.c };
    } catch {
      return null;
    }
  })();
  const graph = buildFormulaGraph(indexBlobs);
  const sameName = sheets.filter((sheet) => normalizeText(sheet?.name) === normalizeText(signature.sheetName));
  const others = sheets.filter((sheet) => !sameName.includes(sheet));
  let best = null;
  for (const sheet of [...sameName, ...others]) {
    const result = matchSheet({ signature, sheet, sourceDocument, indexBlobs, graph, originalOrigin });
    if (!best || STATUS_RANK[result.status] > STATUS_RANK[best.status] || (STATUS_RANK[result.status] === STATUS_RANK[best.status] && result.score > best.score)) {
      best = result;
    }
    if (best.status === "exact") break;
  }
  const report = best || { sheetName: null, status: "no_match", matchedRange: null, offset: null, score: 0, textAnchorScore: 0, headerRuns: [], formulaMismatches: [], brokenCells: [], provenanceWarnings: [], alternatives: [], experimentLabel: null, labelSource: null, labelAddress: null, warnings: [] };
  return {
    schemaVersion: TEMPLATE_MATCH_REPORT_SCHEMA_VERSION,
    templateVersionId: templateVersion.id || null,
    sourceDocumentId: sourceDocument?.id || null,
    workbookName: text(sourceDocument?.metadata?.workbookName) || null,
    isTemplateSource: Boolean(templateVersion.sourceDocumentId && templateVersion.sourceDocumentId === sourceDocument?.id),
    ...report,
    eligibleForBatchConfirm: ["exact", "shifted"].includes(report.status),
  };
}

export function regionExtractionTemplateSummary(template, currentVersion = null) {
  return {
    id: template.id,
    schemaVersion: template.schemaVersion,
    name: template.name,
    description: template.description || "",
    status: template.status,
    currentVersionId: template.currentVersionId,
    currentVersion: currentVersion?.version || null,
    sourceRegionId: currentVersion?.sourceRegionId || null,
    sourceDocumentId: currentVersion?.sourceDocumentId || null,
    sourceWorkbookName: currentVersion?.sourceWorkbookName || null,
    sheetName: currentVersion?.signature?.sheetName || null,
    anchorRange: currentVersion?.signature?.anchorRange || null,
    semanticType: currentVersion?.semantics?.semanticType || null,
    seriesCount: asArray(currentVersion?.semantics?.series).length,
    updatedAt: template.updatedAt,
  };
}

export function regionExtractionTemplateName(value) {
  const name = text(value);
  if (!name) fail("region_extraction_template_invalid", "Name the extraction template before saving it.");
  if (name.length > 120) fail("region_extraction_template_invalid", "Extraction template names must be at most 120 characters.");
  return name;
}

export function regionExtractionTemplateDescription(value) {
  const description = text(value);
  if (description.length > 1000) fail("region_extraction_template_invalid", "Extraction template descriptions must be at most 1000 characters.");
  return description;
}
