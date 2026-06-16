import { buildProjectDataCatalog, searchProjectDataCatalog, slug } from "./projectDataCatalog.js";

export const DATA_RESOLVE_QUERY_VERSION = "labrat.dataResolveQuery.v1";
export const VIEW_INTENT_VERSION = "labrat.viewIntent.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactEntry(entry) {
  return {
    entryId: entry.entryId,
    kind: entry.kind,
    label: entry.label,
    importIds: asArray(entry.importIds),
    experimentIds: asArray(entry.experimentIds),
    fieldIds: asArray(entry.fieldIds),
    sourceRefs: asArray(entry.sourceRefs),
    sourceFileName: entry.sourceFileName || null,
    sheetName: entry.sheetName || null,
    cellRange: entry.cellRange || null,
    role: entry.role || null,
    unit: entry.unit || null,
    valueType: entry.valueType || null,
    metadata: entry.metadata || {},
    confidence: entry.confidence ?? null,
    retrievalScore: entry.retrievalScore || null,
    warnings: asArray(entry.warnings),
  };
}

function selectedExperimentAliases(prompt) {
  const text = slug(prompt);
  const aliases = [];
  const re = /\bexp(?:eriment)?\s*0*([0-9]+)\b/g;
  let match = re.exec(text);
  while (match) {
    aliases.push(`exp${match[1]}`, `experiment ${Number(match[1])}`);
    match = re.exec(text);
  }
  return aliases;
}

function fieldIntentTerms(prompt) {
  const text = slug(prompt);
  const terms = [];
  [
    ["reaction rate", /\breaction rate\b|\brate\b/],
    ["gas selectivity", /\bgas\b.*\bselectivity\b|\bselectivity\b.*\bgas\b/],
    ["liquid selectivity", /\bliquid\b.*\bselectivity\b|\bselectivity\b.*\bliquid\b/],
    ["solid selectivity", /\bsolid\b.*\bselectivity\b|\bselectivity\b.*\bsolid\b/],
    ["temperature", /\btemperature\b|\btemp\b/],
    ["pressure", /\bpressure\b/],
    ["conversion", /\bconversion\b|\bconv\b/],
    ["yield", /\byield\b/],
    ["c number", /\bc\s*number\b|\bcarbon number\b|\bc[0-9]+\b/],
  ].forEach(([term, pattern]) => {
    if (pattern.test(text)) terms.push(term);
  });
  return terms;
}

function rowEntriesForPrompt(catalog, prompt, selectedExperimentIds) {
  const explicit = new Set(asArray(selectedExperimentIds).filter(Boolean));
  if (explicit.size) {
    return asArray(catalog.entries).filter((entry) => (
      entry.kind === "experiment" && asArray(entry.experimentIds).some((id) => explicit.has(id))
    ));
  }
  const aliases = selectedExperimentAliases(prompt);
  const matches = aliases.flatMap((alias) => searchProjectDataCatalog(catalog, alias, { kinds: ["experiment"], limit: 10 }));
  return uniqueBy(matches, (entry) => entry.entryId);
}

function fieldEntriesForPrompt(catalog, prompt, selectedImportIds) {
  const importFilter = new Set(asArray(selectedImportIds).filter(Boolean));
  const terms = fieldIntentTerms(prompt);
  const matches = terms.flatMap((term) => searchProjectDataCatalog(catalog, term, { kinds: ["field"], limit: 20 }));
  const filtered = importFilter.size
    ? matches.filter((entry) => asArray(entry.importIds).some((id) => importFilter.has(id)))
    : matches;
  if (filtered.length) return uniqueBy(filtered, (entry) => entry.entryId);
  return searchProjectDataCatalog(catalog, prompt, { kinds: ["field"], limit: 20 });
}

function relatedFieldsForRows(fieldEntries, rowEntries) {
  if (!rowEntries.length) return fieldEntries;
  const rowIds = new Set(rowEntries.flatMap((entry) => asArray(entry.experimentIds)));
  const related = fieldEntries.filter((entry) => asArray(entry.experimentIds).some((id) => rowIds.has(id)));
  return related.length ? related : fieldEntries;
}

function sourceRefsFor(entries) {
  return [...new Set(entries.flatMap((entry) => asArray(entry.sourceRefs)).filter(Boolean))];
}

function buildViewIntent({ prompt, rowEntries, fieldEntries, sourceEntries }) {
  const columns = uniqueBy(fieldEntries, (entry) => entry.metadata?.fieldValueId || entry.fieldIds?.[0] || entry.entryId)
    .slice(0, 24)
    .map((entry) => ({
      fieldId: entry.metadata?.fieldValueId || entry.fieldIds?.[0] || entry.entryId,
      label: entry.label,
      role: entry.role || null,
      unit: entry.unit || null,
      sourceRefs: asArray(entry.sourceRefs),
      sourceFileName: entry.sourceFileName || null,
    }));
  const rows = uniqueBy(rowEntries, (entry) => entry.experimentIds?.[0] || entry.entryId)
    .map((entry) => ({
      experimentId: entry.experimentIds?.[0] || null,
      label: entry.label,
      importIds: asArray(entry.importIds),
      sourceRefs: asArray(entry.sourceRefs),
    }));
  if (!columns.length) return null;
  return {
    schemaVersion: VIEW_INTENT_VERSION,
    status: "proposed",
    viewType: rows.length ? "table" : "detail_panel",
    title: prompt ? `Data view: ${String(prompt).slice(0, 80)}` : "Data view",
    rows: {
      source: "experiments",
      experimentIds: rows.map((row) => row.experimentId).filter(Boolean),
      items: rows,
    },
    columns,
    filters: [],
    sort: [],
    sourceRefs: sourceRefsFor([...rows, ...columns, ...sourceEntries]),
    warnings: [],
    rationale: "Resolved from project catalog entries; no raw workbook payload was sent to AI.",
  };
}

export function resolveProjectDataQuery({
  project,
  datasetCommit,
  mappingSets = [],
  chartSpecs = [],
  prompt = "",
  selectedExperimentIds = [],
  selectedImportIds = [],
  maxResults = 50,
} = {}) {
  const catalog = buildProjectDataCatalog({ project, datasetCommit, mappingSets, chartSpecs });
  const warnings = [...asArray(catalog.warnings)];
  if (!datasetCommit?.id) {
    return {
      schemaVersion: DATA_RESOLVE_QUERY_VERSION,
      catalogSummary: catalog.summary,
      retrievedContext: { experiments: [], fields: [], imports: [], sources: [], mappings: [] },
      viewIntentDraft: null,
      clarification: {
        message: "This project does not have a current dataset commit yet.",
        options: [],
      },
      warnings,
    };
  }

  const rowEntries = rowEntriesForPrompt(catalog, prompt, selectedExperimentIds);
  const fieldEntries = relatedFieldsForRows(fieldEntriesForPrompt(catalog, prompt, selectedImportIds), rowEntries);
  const importIds = new Set([
    ...rowEntries.flatMap((entry) => asArray(entry.importIds)),
    ...fieldEntries.flatMap((entry) => asArray(entry.importIds)),
  ]);
  const importEntries = asArray(catalog.entries)
    .filter((entry) => entry.kind === "import_run" && asArray(entry.importIds).some((id) => importIds.has(id)))
    .slice(0, maxResults);
  const sourceEntries = [...rowEntries, ...fieldEntries]
    .filter((entry) => asArray(entry.sourceRefs).length)
    .slice(0, maxResults);
  const viewIntentDraft = buildViewIntent({ prompt, rowEntries, fieldEntries, sourceEntries });
  const clarification = viewIntentDraft ? null : {
    message: "No matching project fields were found for this request.",
    options: searchProjectDataCatalog(catalog, prompt, { limit: 8 }).map((entry) => ({
      label: entry.label,
      kind: entry.kind,
      entryId: entry.entryId,
    })),
  };

  return {
    schemaVersion: DATA_RESOLVE_QUERY_VERSION,
    catalogSummary: catalog.summary,
    retrievedContext: {
      experiments: rowEntries.slice(0, maxResults).map(compactEntry),
      fields: fieldEntries.slice(0, maxResults).map(compactEntry),
      imports: importEntries.map(compactEntry),
      sources: sourceEntries.map(compactEntry),
      mappings: searchProjectDataCatalog(catalog, prompt, { kinds: ["mapping"], limit: 12 }).map(compactEntry),
    },
    viewIntentDraft,
    clarification,
    warnings,
  };
}
