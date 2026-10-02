import { Injectable } from "@nestjs/common";
import * as XLSX from "xlsx";
import { EvidenceRegistry, evidenceHash, documentCoverage, projectContextWindow, searchTerms, QA_LIMITS, RESEARCH_TOOLS } from "../../research/evidenceTools.js";
import { readCanonicalPageWindow } from "../../research/documentPages.js";
import { validateJsonSchema } from "../../ai/schemaValidation.js";
import { readSourceDocumentRange } from "../../saas/sourceDocuments.js";
import { EvidenceRepository } from "../evidence/evidence.repository.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { DocumentsRepository } from "./documents.repository.js";
import { DocumentsService } from "./documents.service.js";
import { ResearchEvidenceRepository } from "./research-evidence.repository.js";

const missing = () => new ApiError(404, "evidence_not_found", "Evidence is not available in this project and scope.");
const integer = (value: unknown) => Number.isInteger(value) ? Number(value) : 0;
function rangeBounds(range: string) {
  if (!/^[A-Z]{1,3}[1-9][0-9]{0,6}(:[A-Z]{1,3}[1-9][0-9]{0,6})?$/i.test(range)) {
    throw new ApiError(400, "invalid_source_range", "Choose an Excel cell or range such as A1:D20.");
  }
  const parsed = XLSX.utils.decode_range(range.toUpperCase());
  const count = (parsed.e.r - parsed.s.r + 1) * (parsed.e.c - parsed.s.c + 1);
  if (parsed.e.r < parsed.s.r || parsed.e.c < parsed.s.c || count < 1 || count > QA_LIMITS.cells
    || parsed.e.r >= 1_048_576 || parsed.e.c >= 16_384) {
    throw new ApiError(400, "source_range_too_large", "Read a valid window of at most 240 cells.");
  }
  return parsed;
}

@Injectable()
export class ResearchEvidenceService {
  constructor(private readonly repository: ResearchEvidenceRepository, private readonly documents: DocumentsRepository,
    private readonly authorization: DocumentsService, private readonly identity: IdentityRepository,
    private readonly evidence: EvidenceRepository) {}

  async authorize(auth: AuthContext, projectId: string) {
    if (!await this.repository.activeSession(auth.sessionId, auth.user.id)) throw new ApiError(401, "unauthorized", "The session is no longer active.");
    await this.authorization.authorize(auth, projectId);
    if (auth.publicGuest || await this.identity.findPublicGuestScope(auth.user.id)) {
      throw new ApiError(403, "public_guest_read_only", "The public Guest account cannot use AI Q&A.");
    }
  }

  async rawRange(projectId: string, sourceDocumentId: string, sheetName: string, range: string) {
    const bounds = rangeBounds(range);
    const source = await this.evidence.findSourceDocumentById(sourceDocumentId);
    if (!source || source.projectId !== projectId || source.status !== "indexed") throw missing();
    const indexBlobs = await this.repository.workbook(projectId, source.id, sheetName, bounds.s.r + 1, bounds.e.r + 1, bounds.s.c + 1, bounds.e.c + 1);
    if (indexBlobs.length !== 1) throw missing();
    const result = (readSourceDocumentRange as any)({ sourceDocument: source, indexBlobs, sheetName, range, maxCells: QA_LIMITS.cells });
    const { rows: _rows, ...data } = result;
    const cells = result.cells.map((cell: any) => ({ ...cell,
      cacheMissing: Boolean(cell.formula && cell.type !== "error" && cell.rawValue == null),
      missing: cell.rawValue == null && !String(cell.formattedValue ?? "").trim() }));
    return { kind: "workbook_raw", label: String(source.metadata.workbookName || source.id),
      version: { sourceDocumentId: source.id, indexVersion: source.indexVersion, fileObjectId: source.fileObjectId,
        contentHash: evidenceHash(indexBlobs.map((blob) => [blob.id, blob.checksumSha256])) },
      locator: { sheet: data.sheetName, range: data.range },
      data: { ...data, cells },
      coverage: { scope: "requested_range_only", cellCount: data.cellCount, semantics: "raw_unconfirmed" },
      warnings: [...(source.warnings || []), "Raw file evidence; no experimental meaning or units have been inferred.",
        ...(cells.some((cell: any) => cell.cacheMissing) ? ["A formula has no saved cached value; it was not evaluated."] : [])] };
  }

  async resolveReferences(auth: AuthContext, projectId: string, references: Array<{ documentId: string; versionId: string }>) {
    await this.authorize(auth, projectId);
    const resolved: Array<{ documentId: string; versionId: string; label: string; versionNumber: number }> = [];
    for (const reference of references) {
      const document = await this.documents.findDocument(projectId, reference.documentId);
      const version = await this.documents.findVersion(projectId, reference.versionId);
      if (!document || document.status !== "active" || !version || version.documentId !== document.id
        || !["ready", "partial"].includes(version.status)) {
        throw new ApiError(409, "qa_reference_unavailable", "A selected reference is unavailable or still being read. Review your selected files.");
      }
      if (!resolved.some((item) => item.versionId === version.id)) resolved.push({ documentId: document.id, versionId: version.id,
        label: document.originalName, versionNumber: version.versionNumber });
    }
    return resolved;
  }

  createSession(auth: AuthContext, projectId: string, signal: AbortSignal, context: Record<string, any> = {}) {
    const registry = new EvidenceRegistry();
    const preferredVersions: string[] = (context.referenceDocuments || []).map((item: any) => item.versionId);
    const selectedVersions = new Set<string>(preferredVersions);
    const experiments = new Map<string, any>();
    const trace: Array<Record<string, unknown>> = [];
    let calls = 0;
    const startedAt = Date.now();
    const definitions = new Map(RESEARCH_TOOLS.map((tool) => [tool.name, tool]));
    const check = async () => {
      if (signal.aborted) throw new ApiError(409, "qa_cancelled", "Q&A was cancelled.");
      if (Date.now() - startedAt >= QA_LIMITS.deadlineMs) throw new ApiError(408, "qa_timeout", "Q&A reached its time limit.");
      await this.authorize(auth, projectId);
      if (preferredVersions.length) await this.resolveReferences(auth, projectId, context.referenceDocuments);
    };
    const read = async (name: string, input: any): Promise<any> => {
      if (context.sourceScope === "selected" && !["search_project_documents", "read_document_passage", "read_document_page"].includes(name)) throw missing();
      if (name === "get_project_context") {
        const data = await this.repository.context(projectId);
        if (!data) throw missing();
        const window = projectContextWindow(data, input);
        return { evidence: registry.add({ kind: "project_context", label: data.name,
          version: { projectId, updatedAt: data.updatedAt, contentHash: evidenceHash(data) },
          ...window,
          warnings: ["User-authored project context; not an accepted scientific result."] }) };
      }
      if (name === "search_project_documents") {
        const offset = integer(input.cursor);
        const candidates = await this.repository.search(projectId, input.query, offset, preferredVersions, context.sourceScope === "selected");
        const items = candidates.slice(0, QA_LIMITS.search);
        for (const item of items) {
          item.target.matchType = !input.query.trim() ? "discovery" : "keyword";
          if (["document", "document_page"].includes(item.kind)) selectedVersions.add(item.target.versionId);
          if (item.kind !== "document_page") continue;
          const page = await this.documents.findPage(projectId, item.target.versionId, item.target.page);
          if (!page || page.schemaVersion !== 2) throw missing();
          // JS regex offsets use the same UTF-16 units as page windows and citations.
          const matches = searchTerms(input.query).map((term: string) => page.text.search(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"))).filter((index: number) => index >= 0);
          const hit = matches.length ? Math.min(...matches) : 0;
          const block = page.blocks.find((part: any) => part.start <= hit && part.end > hit);
          let cursor = block && hit - block.start < 3000 ? block.start : Math.max(0, hit - 1000);
          if (cursor && /[\uDC00-\uDFFF]/u.test(page.text[cursor])) cursor -= 1;
          item.target.cursor = cursor;
          let previewStart = Math.max(cursor, hit - 150);
          if (previewStart && /[\uDC00-\uDFFF]/u.test(page.text[previewStart])) previewStart -= 1;
          let previewEnd = Math.min(page.text.length, previewStart + 700);
          if (previewEnd < page.text.length && /[\uDC00-\uDFFF]/u.test(page.text[previewEnd])) previewEnd -= 1;
          item.target.snippet = page.text.slice(previewStart, previewEnd);
        }
        return { items, nextCursor: candidates.length > items.length ? offset + items.length : null,
          coverage: { scope: context.sourceScope === "selected" ? "selected_document_versions" : "current_project_sources", readForCitation: false, returned: items.length,
            candidateWindow: candidates.length, complete: candidates.length <= items.length,
            includes: context.sourceScope === "selected" ? ["selected_document_versions"] : ["uploaded_documents", "confirmed_regions", "accepted_field_names"],
            note: context.sourceScope === "selected" ? "Only the selected document versions were searched. Search snippets are not complete evidence; read relevant passages. complete describes candidate pagination, not full-source reading or proof of absence. No experiment records or other project sources were searched."
              : "Search snippets are not complete evidence. This search includes accepted experiment field names as well as documents and confirmed regions. If a precise query and synonym have no relevant matches, answer insufficient_evidence within that search coverage. Do not enumerate experiments or read every field to prove absence." } };
      }
      if (name === "read_document_page") {
        if (!selectedVersions.has(input.versionId)) throw missing();
        const version = await this.documents.findVersion(projectId, input.versionId);
        const document = version && await this.documents.findDocument(projectId, version.documentId);
        const page = await this.documents.findPage(projectId, input.versionId, input.page);
        if (!version || document?.status !== "active" || !["ready", "partial"].includes(version.status)
          || page?.schemaVersion !== 2) throw missing();
        const window = readCanonicalPageWindow(page, String(input.cursor ?? 0));
        const evidence = registry.add({ kind: "document_page", label: document.originalName,
          version: { documentId: document.id, versionId: version.id, versionNumber: version.versionNumber,
            contentHash: version.contentHash, processingVersion: version.processingVersion },
          locator: { kind: "pdf", page: window.page, start: window.start, end: window.end, unit: "utf16" },
          data: { text: window.text, uncertain: window.status === "needs_review" },
          coverage: { scope: "page_window", status: window.status, totalCharacters: window.totalCharacters,
            nextCursor: window.nextCursor === null ? null : Number(window.nextCursor) }, warnings: window.warnings });
        return { evidence };
      }
      if (name === "read_document_passage") {
        if (!selectedVersions.has(input.versionId)) throw missing();
        const version = await this.documents.findVersion(projectId, input.versionId);
        const document = version && await this.documents.findDocument(projectId, version.documentId);
        const passage = await this.documents.findPassage(projectId, input.versionId, input.passageId);
        if (!version || document?.status !== "active" || !passage || !["ready", "partial"].includes(version.status)) throw missing();
        const neighbors = await this.repository.neighbors(projectId, version.id, passage.ordinal);
        const asEvidence = (part: any) => ({ kind: "document_passage", label: document.originalName,
          version: { documentId: document.id, versionId: version.id, versionNumber: version.versionNumber,
            contentHash: version.contentHash, processingVersion: version.processingVersion },
          locator: part.locator, data: { text: part.text, ...part.metadata },
          coverage: { scope: "one_passage", passageId: part.id, status: version.status,
            source: documentCoverage(version.metadata, part.locator), limitations: version.metadata.limitations },
          warnings: version.metadata.warnings || [] });
        const evidence = registry.add(asEvidence(passage));
        const adjacent = neighbors.filter((item) => item.id !== passage.id);
        const contextEvidence: any[] = [];
        let remaining = QA_LIMITS.characters - passage.text.length;
        for (const neighbor of adjacent) {
          const part = await this.documents.findPassage(projectId, version.id, neighbor.id);
          if (!part || part.text.length > remaining) continue;
          const value = asEvidence(part);
          if (Buffer.byteLength(JSON.stringify({ evidence, contextEvidence: [...contextEvidence, value], neighbors: adjacent })) + 128 > QA_LIMITS.toolBytes) continue;
          contextEvidence.push(registry.add(value)); remaining -= part.text.length;
        }
        return { evidence, contextEvidence, neighbors: adjacent };
      }
      if (name === "read_workbook_source") throw new ApiError(409, "qa_workbook_review_required", "Select and confirm workbook regions first, then read confirmed region evidence.");
      if (name === "find_experiments") {
        const offset = integer(input.cursor);
        const rows = await this.repository.experiments(projectId, input.query, offset);
        const ambiguous = Boolean(input.query.trim() && (offset > 0 || rows.length > 1));
        const items = [];
        for (const row of rows.slice(0, QA_LIMITS.search)) {
          const regions = await this.repository.confirmedRegions(projectId, row.id);
          const item = { ...row, confirmedRegions: regions.slice(0, 8), moreConfirmedRegions: regions.length > 8 };
          items.push(item);
          if (!ambiguous) experiments.set(`${row.id}:${row.snapshotId}`, row);
        }
        return { status: ambiguous ? "ambiguous" : items.length ? "matched" : "no_match", items,
          nextCursor: rows.length > items.length ? offset + items.length : null,
          coverage: { exactNameOrAlias: Boolean(input.query.trim()), complete: rows.length <= items.length,
            note: ambiguous ? "Ask the user for the unique canonical name before reading an experiment."
              : !items.length && input.query.trim() ? "No exact match. Ask for the correct name; do not substitute another experiment or enumerate unrelated data."
              : "Only active accepted snapshot heads are listed." } };
      }
      if (name === "read_experiment_evidence") {
        const pinned = experiments.get(`${input.experimentId}:${input.snapshotId}`);
        if (!pinned) throw missing();
        const fieldOffset = integer(input.fieldOffset), seriesOffset = integer(input.seriesOffset), pointOffset = integer(input.pointOffset);
        const data = await this.repository.experiment(projectId, pinned.snapshotId, pinned.recordIndex, fieldOffset, seriesOffset, input.seriesKey, pointOffset);
        if (!data || data.contentHash !== pinned.contentHash || data.experimentId && data.experimentId !== input.experimentId) throw missing();
        if (input.seriesKey && !data.seriesWindow) throw missing();
        return { evidence: registry.add({ kind: "experiment_snapshot", label: pinned.canonicalLabel,
          version: { experimentId: pinned.id, snapshotId: pinned.snapshotId, contentHash: pinned.contentHash,
            headId: pinned.headId, headUpdatedAt: pinned.headUpdatedAt, recordIndex: pinned.recordIndex },
          locator: { fieldOffset, seriesOffset, seriesKey: input.seriesKey || null, pointOffset }, data,
          coverage: { scope: "accepted_snapshot_window", fieldCount: data.fieldCount, seriesCount: data.seriesCount,
            nextFieldOffset: fieldOffset + data.fields.length < data.fieldCount ? fieldOffset + data.fields.length : null,
            nextSeriesOffset: seriesOffset + data.series.length < data.seriesCount ? seriesOffset + data.series.length : null,
            nextPointOffset: data.seriesWindow && pointOffset + data.seriesWindow.points.length < data.seriesWindow.pointCount ? pointOffset + data.seriesWindow.points.length : null },
          warnings: [...(data.warnings || []), ...(data.recordWarnings || []), "Values retain their stored scale and unit; no conversion or new calculation was performed."] }) };
      }
      if (name === "read_confirmed_region_evidence") {
        const data = await this.repository.region(projectId, input.regionId, input.revisionId, integer(input.semanticOffset));
        if (!data) throw missing();
        const requested = rangeBounds(input.range), confirmed = XLSX.utils.decode_range(data.range);
        if (requested.s.r < confirmed.s.r || requested.s.c < confirmed.s.c || requested.e.r > confirmed.e.r || requested.e.c > confirmed.e.c) throw missing();
        const raw = await this.rawRange(projectId, data.sourceDocumentId, data.sheetName, input.range);
        return { evidence: registry.add({ kind: "confirmed_region", label: `${raw.label} / ${data.sheetName} ${data.range}`,
          version: { regionId: data.regionId, revisionId: data.revisionId, regionVersion: data.version,
            sourceContentHash: data.sourceContentHash, dependencyHash: data.dependencyHash, ...raw.version },
          locator: { ...raw.locator, semanticOffset: integer(input.semanticOffset) }, data: { ...data, raw: raw.data },
          coverage: { scope: "confirmed_region_window", nextSemanticOffset: integer(input.semanticOffset) + 20 < Math.max(data.fieldCount, data.seriesCount)
            ? integer(input.semanticOffset) + 20 : null }, warnings: [...(data.warnings || []), "Confirmed interpretation of this region; not a published experimental dataset."] }) };
      }
      throw new ApiError(400, "qa_tool_unavailable", "This read-only tool is unavailable.");
    };
    const invoke = async (name: string, input: any = {}) => {
      const start = Date.now(); calls += 1;
      const previousIds = new Set(registry.items.keys());
      let status = "ok";
      let recordedInput: Record<string, unknown> = {};
      let output: Record<string, unknown> = {};
      const sequence = calls;
      try {
        await check();
        if (calls > QA_LIMITS.toolCalls) throw new ApiError(429, "qa_tool_limit", "Q&A reached its tool-call limit.");
        const definition = definitions.get(name);
        if (!definition || !validateJsonSchema(definition.input_schema, input).valid) throw new ApiError(400, "qa_tool_input_invalid", "Tool arguments do not match the read-only schema.");
        recordedInput = JSON.parse(JSON.stringify(input));
        const result = await read(name, input);
        await check();
        if (Buffer.byteLength(JSON.stringify(result)) > QA_LIMITS.toolBytes) throw new ApiError(422, "qa_tool_result_limit", "This source window is too large; request a smaller range.");
        const evidenceIds = [result.evidence, ...(result.contextEvidence || [])].filter(Boolean).map((item: any) => item.id);
        output = { evidenceIds, ...(result.coverage ? { coverage: result.coverage } : {}),
          ...(result.status ? { matchStatus: result.status } : {}),
          ...(Array.isArray(result.items) ? { returnedCount: result.items.length,
            matches: result.items.map((item: any) => ({ kind: item.kind || 'experiment', label: item.label || item.canonicalLabel,
              target: item.target || { experimentId: item.id, snapshotId: item.snapshotId } })),
            nextCursor: result.nextCursor ?? null } : {}) };
        return result;
      } catch (error: any) {
        for (const id of registry.items.keys()) if (!previousIds.has(id)) registry.items.delete(id);
        registry.bytes = registry.values().reduce((size: number, item: unknown) => size + Buffer.byteLength(JSON.stringify(item)), 0);
        status = String(error.code || "qa_tool_failed");
        if (error instanceof ApiError) throw error;
        throw new ApiError(422, status, "Evidence could not be read within the request limits.");
      } finally {
        trace.push({ sequence, tool: name, phase: ['search_project_documents', 'find_experiments'].includes(name) ? 'discovery' : 'read',
          input: recordedInput, status, ...output, elapsedMs: Date.now() - start });
        trace.sort((a, b) => Number(a.sequence) - Number(b.sequence));
      }
    };
    return { registry, trace, invoke, check,
      handlers: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, (input: any) => invoke(tool.name, input)])) };
  }
}
