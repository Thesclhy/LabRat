import { decodeRange, encodeRange } from "../../import/utils/excelAddress.js";

const EVIDENCE_INTENT_VERSION = "labrat.evidenceIntent.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function unique(values) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function normalizeCellRef(value) {
  return normalizeText(value).replace(/\$/g, "").toUpperCase();
}

function normalizeSheetName(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.replace(/^'|'$/g, "").trim();
}

function normalizeSheetHint(value) {
  let text = normalizeText(value).replace(/^['"]|['"]$/g, "").trim();
  text = text.replace(/\s+sheet$/i, "").trim();
  const sheetNumber = text.match(/^sheet\s*([0-9]+)$/i) || text.match(/^([0-9]+)$/);
  if (sheetNumber) return `Sheet${Number(sheetNumber[1])}`;
  return normalizeSheetName(text);
}

function normalizeRange(start, end) {
  const rawRange = `${normalizeCellRef(start)}:${normalizeCellRef(end)}`;
  const decoded = decodeRange(rawRange);
  return encodeRange(decoded);
}

function experimentAliasesFromText(value) {
  const aliases = [];
  const re = /\bexp(?:eriment)?\s*0*([0-9]+)\b/gi;
  let match = re.exec(String(value || ""));
  while (match) {
    aliases.push(`Exp${Number(match[1])}`);
    match = re.exec(String(value || ""));
  }
  const listRe = /\bexperiments?\s+([0-9][0-9,\sand&-]*)/gi;
  let listMatch = listRe.exec(String(value || ""));
  while (listMatch) {
    const numbers = String(listMatch[1] || "").match(/[0-9]+/g) || [];
    numbers.forEach((number) => aliases.push(`Exp${Number(number)}`));
    listMatch = listRe.exec(String(value || ""));
  }
  const calculationRe = /\bcalc(?:ulation)?\s*(?:exp\s*)?0*([0-9]+)\b/gi;
  let calculationMatch = calculationRe.exec(String(value || ""));
  while (calculationMatch) {
    aliases.push(`Exp${Number(calculationMatch[1])}`);
    calculationMatch = calculationRe.exec(String(value || ""));
  }
  return unique(aliases);
}

function cleanWorkbookHint(value) {
  let text = normalizeText(value)
    .replace(/^(?:the\s+)?/i, "")
    .replace(/\s+(?:workbooks?|files?)$/i, "")
    .replace(/\s+\b(?:in|on|from)\s+(?:the\s+)?sheet\s*[A-Za-z0-9_. -]+$/i, "")
    .trim();
  if (/^calculations?$/i.test(text) || /^calcs?$/i.test(text)) text = "calculation";
  return text;
}

function workbookHintFromText(value) {
  const text = String(value || "");
  const filenameMatch = text.match(/\b((?:calculation|calc)[A-Za-z0-9_. -]*\.(?:xlsx|xls))\b/i);
  if (filenameMatch) return cleanWorkbookHint(filenameMatch[1]);
  const phraseMatch = text.match(/\b(?:in|from)\s+((?:(?:exp(?:eriment)?\s*0*[0-9]+\s+)?(?:calculation|calc)|(?:calculation|calc))[A-Za-z0-9_. -]*(?:workbooks?|files?)?)(?=$|[,.;])/i);
  if (phraseMatch) return cleanWorkbookHint(phraseMatch[1]);
  return "";
}

function sheetNameFromText(value) {
  const text = String(value || "");
  const explicitSheetWord = text.match(/\b(?:in|on|from)\s+(?:the\s+)?(sheet\s*[A-Za-z0-9_. -]*?)(?=$|[,.;])/i);
  if (explicitSheetWord) return normalizeSheetHint(explicitSheetWord[1]);
  const quotedAfterWorkbook = text.match(/\b(?:calculation|calc)[A-Za-z0-9_. -]*?\s+\b(?:in|on|from)\s+['"]([^'"]+)['"](?=$|[,.;])/i);
  if (quotedAfterWorkbook) return normalizeSheetHint(quotedAfterWorkbook[1]);
  const namedAfterWorkbook = text.match(/\b(?:calculation|calc)[A-Za-z0-9_. -]*?\s+\b(?:in|on|from)\s+([A-Za-z][A-Za-z0-9_. -]*?)(?=$|[,.;])/i);
  if (namedAfterWorkbook) return normalizeSheetHint(namedAfterWorkbook[1]);
  return "";
}

function crossCompareIntentFromText(text, targetExperimentAliases, source = {}) {
  const sourceTask = normalizeLower(source.chartTask || source.task || "");
  const wantsCrossCompare = ["cross_compare", "series_compare", "compare_series"].includes(sourceTask)
    || /\b(cross[-\s]?compare|cross[-\s]?experiment|compare|comparison)\b/i.test(text);
  const wantsAll = ["all_matching_experiments", "all_experiments"].includes(normalizeLower(source.scope))
    || /\b(every|all|all matching)\s+experiments?\b/i.test(text);
  const wantsSelected = normalizeLower(source.scope) === "selected_experiments" || targetExperimentAliases.length > 1;
  if (!wantsCrossCompare || (!wantsAll && !wantsSelected)) return {};
  return {
    chartTask: "cross_compare",
    seriesBy: source.seriesBy || "experiment",
    scope: wantsAll ? "all_matching_experiments" : "selected_experiments",
  };
}

function extractTypeFromText(text) {
  return /\b(c[-\s]?number|carbon\s+number|carbon\s+balance\s+distribution|component\s+distribution|distribution)\b/i.test(text)
    ? "component_distribution"
    : "table_range";
}

function parseExplicitRange(prompt) {
  const text = String(prompt || "");
  const sheetRangeMatch = text.match(/(.{0,120}?)!\$?([A-Z]{1,3}\$?\d{1,7})\s*(?::|\bto\b|\bthrough\b|-)\s*\$?([A-Z]{1,3}\$?\d{1,7})/i);
  if (sheetRangeMatch) {
    const rawPrefix = sheetRangeMatch[1] || "";
    const quoted = rawPrefix.match(/'([^']+)'$/);
    const sheetName = quoted
      ? quoted[1]
      : rawPrefix
        .split(/\b(?:using|from|in|with)\b/i)
        .pop()
        .trim()
        .replace(/^['"]|['"]$/g, "");
    return {
      sheetName: normalizeSheetName(sheetName),
      range: normalizeRange(sheetRangeMatch[2], sheetRangeMatch[3]),
    };
  }
  const rangeMatch = text.match(/\$?([A-Z]{1,3}\$?\d{1,7})\s*(?::|\bto\b|\bthrough\b|-)\s*\$?([A-Z]{1,3}\$?\d{1,7})/i);
  if (!rangeMatch) return null;
  return {
    sheetName: "",
    range: normalizeRange(rangeMatch[1], rangeMatch[2]),
  };
}

function parseRowReference(prompt) {
  const match = String(prompt || "").match(/\brow\s*([0-9]{1,7})\b/i);
  if (!match) return null;
  const rowNumber = Number(match[1]);
  return Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber : null;
}

function workbookHintFromIntent(intent = {}) {
  return normalizeText(intent.workbookHint || intent.fileName || intent.workbookName || intent.sourceWorkbook || "");
}

export function parseChartEvidenceIntent(prompt, intent = {}) {
  const text = String(prompt || "");
  const source = intent.evidenceIntent && typeof intent.evidenceIntent === "object" ? intent.evidenceIntent : intent;
  const explicitRange = parseExplicitRange(source.range || source.cellRange || text);
  const rowNumber = source.rowNumber || parseRowReference(text);
  if (!explicitRange && !rowNumber) return null;
  const sheetName = normalizeSheetName(source.sheetName || source.sheet || explicitRange?.sheetName || sheetNameFromText(text) || "");
  const range = explicitRange?.range || "";
  const targetExperimentAliases = unique([
    ...experimentAliasesFromText(text),
    ...asArray(source.targetExperimentAliases),
    ...asArray(source.experimentAliases),
    ...asArray(source.experiments),
  ]);
  const crossCompare = crossCompareIntentFromText(text, targetExperimentAliases, source);
  return {
    schemaVersion: EVIDENCE_INTENT_VERSION,
    ...crossCompare,
    sourceKind: explicitRange ? "excel_range" : "source_region",
    extractType: source.extractType || extractTypeFromText(text),
    range,
    rowNumber: explicitRange ? null : rowNumber,
    sheetName,
    workbookHint: workbookHintFromIntent(source) || workbookHintFromText(text),
    targetExperimentAliases,
    prompt: text,
  };
}

export function sourceEvidenceContextClarification(evidenceIntent) {
  return {
    code: "source_context_required",
    message: evidenceIntent?.range
      ? `Source range ${evidenceIntent.range} requires an indexed server project workbook before charting.`
      : "Source-specific chart requests require an indexed server project workbook before charting.",
    options: [],
  };
}

export function isExplicitEvidenceIntent(prompt, intent = {}) {
  return Boolean(parseChartEvidenceIntent(prompt, intent));
}

export function normalizeEvidenceText(value) {
  return normalizeLower(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
