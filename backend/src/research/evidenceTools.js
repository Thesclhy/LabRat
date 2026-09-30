import { createHash } from "node:crypto";

export const QA_LIMITS = Object.freeze({ question: 4000, search: 8, candidates: 40, cells: 240,
  fields: 20, points: 40, characters: 4000, toolBytes: 32_000, evidenceBytes: 160_000,
  toolCalls: 24, toolRounds: 8, requests: 12, tokens: 60_000, deadlineMs: 120_000 });

export const evidenceHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const normalizeIdentity = (value) => String(value || "").normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/gu, "");

export function documentCoverage(metadata, locator) {
  const parts = Array.isArray(metadata.coverage) ? metadata.coverage : [];
  const statusCounts = {};
  for (const part of parts) statusCounts[part.status || "unknown"] = (statusCounts[part.status || "unknown"] || 0) + 1;
  const location = parts.find((part) => locator.page != null ? part.page === locator.page : part.part === (locator.part || "text"));
  return { parts: parts.length, statusCounts, location: location || null,
    warningParts: parts.filter((part) => part.warnings?.length).length,
    scope: "summary_and_cited_location_only", fullCoverageAvailableOnVersion: true };
}

const stopWords = new Set("a an the is are was were to of in on for and or what which how does do did has have from please tell about document uploaded experiment experiments says say show me with by this that it as at can according".split(" "));
export function searchTerms(query) {
  const normalized = String(query || "").normalize("NFKC").toLowerCase().trim();
  const words = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}_.-]*/gu) || [];
  const terms = words.filter((word) => !stopWords.has(word));
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) || []) {
    for (let i = 0; i < run.length - 1; i += 1) terms.push(run.slice(i, i + 2));
  }
  return [...new Set(terms)].slice(0, 24);
}

const string = (maxLength = 160) => ({ type: "string", minLength: 1, maxLength });
const cursor = { type: "integer", minimum: 0, maximum: 100_000 };
const contextFields = ["name", "description", ...["researchGoal", "experimentBackground", "materials", "methods", "instruments", "analysisNotes", "tags"].map((key) => `projectProfile.${key}`)];

export function projectContextWindow(context, input = {}) {
  const values = { name: context.name, description: context.description,
    ...Object.fromEntries(contextFields.filter((field) => field.startsWith("projectProfile.")).map((field) => [field, context.projectProfile?.[field.split(".")[1]] ?? null])) };
  const data = { id: context.id, updatedAt: context.updatedAt, projectProfile: {} };
  const fields = [], next = [];
  let remaining = QA_LIMITS.characters;
  for (const field of input.field ? [input.field] : contextFields) {
    const value = values[field], start = input.field ? Number(input.cursor || 0) : 0;
    let result, end;
    if (Array.isArray(value)) {
      result = []; end = start;
      for (const item of value.slice(start)) {
        const cost = JSON.stringify(item).length;
        if (cost > remaining) break;
        result.push(item); remaining -= cost; end += 1;
      }
    } else {
      const text = value == null ? "" : String(value);
      end = Math.min(text.length, start + remaining);
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end -= 1;
      result = value == null ? null : text.slice(start, end); remaining -= Math.max(0, end - start);
    }
    const length = value?.length || 0, complete = end >= length;
    if (field.startsWith("projectProfile.")) data.projectProfile[field.split(".")[1]] = result;
    else data[field] = result;
    fields.push({ field, start, end, length, unit: Array.isArray(value) ? "items" : "utf16_characters", complete });
    if (!complete) next.push({ field, cursor: end });
  }
  return { data, coverage: { scope: "saved_project_background_window", fields, next, complete: !next.length },
    locator: { field: input.field || "projectProfile", cursor: input.cursor || 0 } };
}
const define = (name, description, properties, required = []) => ({ name, description,
  input_schema: { type: "object", additionalProperties: false, properties, required } });

export const RESEARCH_TOOLS = [
  define("get_project_context", "Read a frozen saved project background window (user statements, not accepted results). Long fields return coverage.next entries; pass their field and cursor to continue. No scientific computation.",
    { field: { type: "string", enum: contextFields }, cursor }),
  define("search_project_documents", "Discover current PDF/Word/TXT passages, confirmed workbook regions and accepted experiment field names. Unconfirmed workbook cells are excluded. Query can be a filename, protocol code, topic, experiment field or workbook/sheet name. Returned target IDs are the only valid inputs for subsequent reads. For experiment_field hits resolve canonicalLabel with find_experiments, then read the pinned experiment at fieldOffset. Empty query only discovers sources for a requested read, never proves absence. If a precise term and synonym return no matches, finish with scoped insufficient_evidence instead of browsing all sources. Snippets are discovery only; read before citing. Preserve named identifiers and try concise English/Chinese terms. Never search the internet.",
    { query: { type: "string", maxLength: 500 }, cursor }, ["query"]),
  define("read_document_passage", "Read one uploaded passage and bounded adjacent context (4000 text characters total), each with its own evidence ID and original locator. Use versionId and passageId returned by discovery, never construct them from a filename. Read contextEvidence for exclusions and qualifiers; neighbors not included there need a separate read. Disclose OCR uncertainty.",
    { versionId: string(), passageId: string() }, ["versionId", "passageId"]),
  define("read_workbook_source", "Read up to 240 raw cells from an uploaded workbook, preserving raw/display/formula/cache/missing and merges. These are raw source statements, not accepted experiment semantics. Does not calculate or evaluate formulas.",
    { sourceDocumentId: string(), sheetName: string(250), range: string(80) }, ["sourceDocumentId", "sheetName", "range"]),
  define("find_experiments", "Resolve an exact experiment name/alias, or browse with an empty query. A named query never substitutes other experiments. Ambiguous matches need user clarification. Returns pinned current accepted snapshot/head and confirmed regions.",
    { query: { type: "string", maxLength: 250 }, cursor }, ["query"]),
  define("read_experiment_evidence", "Read an experiment using experimentId and snapshotId returned by find_experiments. Inspect returned field names to locate the requested value; continue at nextFieldOffset only if needed. Scalar fields are paged; series catalog and one series window are bounded. Preserve stored value, type, unit, numericScale and missing state. Do not convert, average, fit or calculate.",
    { experimentId: string(), snapshotId: string(), fieldOffset: cursor, seriesOffset: cursor, seriesKey: string(250), pointOffset: cursor }, ["experimentId", "snapshotId"]),
  define("read_confirmed_region_evidence", "Read one active accepted region revision and a range within its confirmed boundary. Interpretation and field/series catalogs are paged; raw cells remain distinct from accepted snapshot values.",
    { regionId: string(), revisionId: string(), range: string(80), semanticOffset: cursor }, ["regionId", "revisionId", "range"]),
];

export class EvidenceRegistry {
  constructor() { this.items = new Map(); this.bytes = 0; }
  add(evidence) {
    const frozen = JSON.parse(JSON.stringify(evidence));
    const id = `evidence_${evidenceHash(frozen).slice(0, 24)}`;
    if (!this.items.has(id)) {
      const bytes = Buffer.byteLength(JSON.stringify(frozen));
      if (bytes > QA_LIMITS.toolBytes || this.bytes + bytes > QA_LIMITS.evidenceBytes) {
        const error = new Error("Evidence budget reached; use a smaller source window."); error.code = "qa_evidence_limit"; throw error;
      }
      this.items.set(id, { id, ...frozen }); this.bytes += bytes;
    }
    return this.items.get(id);
  }
  values() { return [...this.items.values()]; }
}
