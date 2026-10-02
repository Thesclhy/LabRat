import { DOCUMENT_LIMITS, documentError } from "./documentLimits.js";
import { validateCanonicalPage } from "./documentPages.js";

export const PDF_PROCESSING_VERSION = "labrat.pdf.pages.v1:serve-1.21.0:docling-2.96.1:pdfium:rapidocr-3.8.1:models-e4282b963037:normalize-1";
export const DOCLING_OPTIONS = Object.freeze({ to_formats: "json", pipeline: "standard", ocr_preset: "rapidocr",
  do_ocr: "true", force_ocr: "false", do_table_structure: "true", image_export_mode: "placeholder",
  include_images: "false", document_timeout: "300", abort_on_error: "false", pdf_backend: "pypdfium2" });
const kinds = new Set(["text", "title", "section_header", "caption", "formula", "table", "picture", "footnote",
  "page_header", "page_footer", "list_item", "code"]);
const invalid = (code = "document_docling_result_invalid") => {
  throw documentError(code, "The document conversion did not return a complete, valid page structure.");
};
const warning = (page, code) => { if (!page.warnings.includes(code)) page.warnings.push(code); };

function boxFor(box, geometry, multiPage, tableCell = false) {
  if (!box || multiPage) return;
  const { l, t, r, b, coord_origin: origin } = box;
  if (![l, t, r, b].every(Number.isFinite) || !["TOPLEFT", "BOTTOMLEFT"].includes(origin)) return;
  // Rotated OCR and mixed pages do not expose enough provenance to choose a coordinate frame.
  if (geometry.rotation && (geometry.hasImage || !geometry.nativeCharacters || tableCell)) return;
  let points;
  if (geometry.rotation) {
    if (origin !== "BOTTOMLEFT") return;
    const [a, c, d, e, x, y] = geometry.transform;
    points = [[l, t], [r, t], [l, b], [r, b]].map(([u, v]) => [a * u + d * v + x, c * u + e * v + y]);
  } else {
    points = [[l, t], [r, b]].map(([x, y]) => [x, origin === "BOTTOMLEFT" ? geometry.height - y : y]);
  }
  const result = [Math.min(...points.map((p) => p[0])) / geometry.width,
    Math.min(...points.map((p) => p[1])) / geometry.height,
    Math.max(...points.map((p) => p[0])) / geometry.width,
    Math.max(...points.map((p) => p[1])) / geometry.height];
  if (result.some((n) => !Number.isFinite(n) || n < -0.005 || n > 1.005)) return;
  const clipped = result.map((n) => Math.min(1, Math.max(0, n)));
  if (clipped[2] <= clipped[0] || clipped[3] <= clipped[1]) return;
  return clipped;
}

function orderedItems(document) {
  const map = new Map();
  for (const name of ["groups", "texts", "tables", "pictures"]) {
    if (!Array.isArray(document[name]) || document[name].length > 50_000) invalid();
    for (const [index, item] of document[name].entries()) {
      const ref = `#/${name}/${index}`;
      if (item?.self_ref !== ref) invalid();
      map.set(ref, item);
    }
  }
  const seen = new Set(), result = [];
  const visit = (item, depth = 0) => {
    if (!item || depth > 40) invalid();
    if (seen.has(item.self_ref)) return;
    seen.add(item.self_ref);
    if (!item.self_ref.startsWith("#/groups/") && !["#/body", "#/furniture"].includes(item.self_ref)) result.push(item);
    for (const child of item.children || []) visit(map.get(child.$ref), depth + 1);
  };
  visit(document.body); visit(document.furniture);
  // Orphan content must not silently disappear if an upstream tree is incomplete.
  for (const item of map.values()) if (!seen.has(item.self_ref)) visit(item);
  return result;
}

export function normalizeDoclingPages(result, inspection) {
  if (!inspection || !Number.isInteger(inspection.pageCount) || inspection.pageCount < 1
    || inspection.pageCount > DOCUMENT_LIMITS.pages || inspection.pages?.length !== inspection.pageCount) invalid();
  if (!["success", "partial_success"].includes(result?.status)) invalid("document_parse_failed");
  let document = result.document?.json_content;
  if (typeof document === "string") { try { document = JSON.parse(document); } catch { invalid(); } }
  if (!document || typeof document.pages !== "object") invalid();
  if (Object.keys(document.pages).some((key) => !/^[1-9]\d*$/.test(key) || Number(key) > inspection.pageCount)) invalid();
  const pages = inspection.pages.map((geometry, index) => {
    if (geometry.page !== index + 1) invalid();
    return { schemaVersion: 2, page: index + 1, status: "ready", text: "", width: geometry.width,
      height: geometry.height, rotation: geometry.rotation, blocks: [], warnings: [] };
  });
  const failed = new Set();
  const failPage = (number, code) => { failed.add(number); warning(pages[number - 1], code); };
  const append = (number, text, item, provenance, multiPage, cells) => {
    const page = pages[number - 1], geometry = inspection.pages[number - 1];
    if (!page || typeof text !== "string" || !text.isWellFormed()) invalid();
    if (page.text.length && text.length) page.text += "\n\n";
    const start = page.text.length;
    page.text += text;
    const bbox = boxFor(provenance.bbox, geometry, multiPage);
    const block = { id: `p${number}-${item.self_ref.slice(2).replaceAll("/", "-")}-${page.blocks.length}`,
      kind: kinds.has(item.label) ? item.label : "unknown", start, end: page.text.length, ...(bbox ? { bbox } : {}) };
    if (!bbox) warning(page, "page_precision_location");
    if (item.label === "formula") warning(page, "formula_layout_check_original");
    if (cells) block.table = { rows: item.data.num_rows, columns: item.data.num_cols,
      cells: cells.map((cell) => ({ ...cell, start: start + cell.start, end: start + cell.end })) };
    page.blocks.push(block);
  };
  for (const item of orderedItems(document)) {
    if (!Array.isArray(item.prov) || !item.prov.length) invalid();
    const numbers = [...new Set(item.prov.map((p) => p.page_no))];
    if (numbers.some((number) => !Number.isInteger(number) || number < 1 || number > pages.length)) invalid();
    const multiPage = numbers.length > 1;
    if (item.label === "table") {
      if (multiPage) { for (const number of numbers) failPage(number, "ambiguous_table_pages"); continue; }
      const number = numbers[0], geometry = inspection.pages[number - 1], data = item.data;
      if (!Array.isArray(data?.table_cells) || data.table_cells.length > 10_000) invalid();
      const ordered = [...data.table_cells].sort((a, b) => a.start_row_offset_idx - b.start_row_offset_idx || a.start_col_offset_idx - b.start_col_offset_idx);
      let text = "", row = 0;
      const cells = ordered.map((cell, index) => {
        if (typeof cell.text !== "string") invalid();
        if (index) text += cell.start_row_offset_idx === row ? "\t" : "\n";
        row = cell.start_row_offset_idx;
        const start = text.length; text += cell.text;
        const bbox = boxFor(cell.bbox, geometry, false, true);
        return { row, column: cell.start_col_offset_idx, rowSpan: cell.row_span, columnSpan: cell.col_span,
          start, end: text.length, header: Boolean(cell.column_header || cell.row_header || cell.row_section), ...(bbox ? { bbox } : {}) };
      });
      append(number, text, item, item.prov[0], false, cells);
      continue;
    }
    if (item.label === "picture") { append(numbers[0], "", item, item.prov[0], multiPage); continue; }
    // orig retains formula content and list numbers removed from display text.
    const text = typeof item.orig === "string" ? item.orig : item.text;
    if (typeof text !== "string") invalid();
    if (!multiPage) { append(numbers[0], text, item, item.prov[0], false); continue; }
    const codepoints = Array.from(text);
    let previous = 0;
    const spans = [...item.prov].sort((a, b) => a.charspan?.[0] - b.charspan?.[0]);
    const valid = spans.every((part) => {
      const [start, end] = part.charspan || [];
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < previous || end < start || end > codepoints.length
        || codepoints.slice(previous, start).join("").trim()) return false;
      previous = end; return true;
    }) && !codepoints.slice(previous).join("").trim();
    if (!valid) { for (const number of numbers) failPage(number, "invalid_source_spans"); continue; }
    const firstGeometry = inspection.pages[spans[0].page_no - 1];
    for (const part of spans) {
      const geometry = inspection.pages[part.page_no - 1];
      // Upstream merged provenance reuses the first page height for later boxes.
      const ambiguousFrame = geometry.width !== firstGeometry.width || geometry.height !== firstGeometry.height
        || geometry.rotation !== firstGeometry.rotation;
      append(part.page_no, codepoints.slice(...part.charspan).join(""), item, part, ambiguousFrame);
    }
  }
  for (const page of pages) {
    const geometry = inspection.pages[page.page - 1];
    const upstream = document.pages[String(page.page)];
    if (!upstream || upstream.page_no !== page.page) failPage(page.page, "incomplete_page");
    if (!page.text.trim() && !geometry.isBlank && geometry.nativeCharacters >= 12) failPage(page.page, "missing_native_text");
    if (failed.has(page.page)) { page.status = "failed"; page.text = ""; page.blocks = []; }
    else if (!page.text.trim() && geometry.isBlank) { page.status = "empty"; page.blocks = []; }
    else {
      const readable = (page.text.match(/[\p{L}\p{N}]/gu) || []).length;
      if (geometry.hasImage) warning(page, geometry.nativeCharacters < 12 ? "ocr_check_original" : "image_text_check_original");
      if (geometry.lowContrast) warning(page, "low_contrast_check_original");
      if (!page.text.trim() || !geometry.isBlank && readable < 12 && geometry.inkFraction > 0) warning(page, "sparse_text_check_original");
      if (page.text.includes("\ufffd")) warning(page, "unrecognized_characters");
      if (page.warnings.some((code) => code !== "page_precision_location")) page.status = "needs_review";
    }
    validateCanonicalPage(page);
  }
  const count = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (count > DOCUMENT_LIMITS.characters || Buffer.byteLength(JSON.stringify(pages)) > DOCUMENT_LIMITS.resultBytes) invalid("document_text_limit");
  return { pageCount: pages.length, pages, processingVersion: PDF_PROCESSING_VERSION,
    warnings: result.status === "partial_success" ? ["upstream_partial_result"] : [] };
}
