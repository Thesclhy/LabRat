import { DOCUMENT_LIMITS, documentError } from "./documentLimits.js";

export const PAGE_SCHEMA_VERSION = 2;
export const PAGE_STATUSES = ["ready", "empty", "needs_review", "failed"];
const KINDS = new Set(["text", "title", "section_header", "caption", "formula", "table", "picture",
  "footnote", "page_header", "page_footer", "list_item", "code", "unknown"]);
const invalid = () => { throw documentError("document_page_invalid", "The parsed page has an invalid structure.", 422); };
const fields = (value, names) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !names.includes(key))) invalid();
};
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const boundary = (text, offset) => offset === 0 || offset === text.length
  || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);

function checkBox(box) {
  if (box === undefined) return;
  if (!Array.isArray(box) || box.length !== 4 || box.some((n) => !Number.isFinite(n) || n < 0 || n > 1)
    || box[2] <= box[0] || box[3] <= box[1]) invalid();
}

function checkSpan(text, item) {
  if (!integer(item.start, 0, text.length) || !integer(item.end, item.start, text.length)
    || !boundary(text, item.start) || !boundary(text, item.end)) invalid();
}

export function validateCanonicalPage(page) {
  fields(page, ["schemaVersion", "page", "status", "text", "width", "height", "rotation", "blocks", "warnings"]);
  if (page.schemaVersion !== PAGE_SCHEMA_VERSION || !integer(page.page, 1, DOCUMENT_LIMITS.pages)
    || !PAGE_STATUSES.includes(page.status) || typeof page.text !== "string" || !page.text.isWellFormed()
    || page.text.length > DOCUMENT_LIMITS.characters || ![0, 90, 180, 270].includes(page.rotation)
    || !Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0
    || page.width * page.height > 144_000_000 || !Array.isArray(page.blocks) || page.blocks.length > 10_000
    || !Array.isArray(page.warnings) || page.warnings.length > 32
    || page.warnings.some((warning) => typeof warning !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(warning))) invalid();
  if (["empty", "failed"].includes(page.status) && page.text.length) invalid();
  if (page.status === "empty" && page.blocks.length || page.status === "needs_review" && !page.warnings.length) invalid();
  const ids = new Set();
  let previousEnd = 0;
  for (const block of page.blocks) {
    fields(block, ["id", "kind", "start", "end", "bbox", "table"]);
    if (typeof block.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(block.id) || ids.has(block.id)
      || !KINDS.has(block.kind) || block.start < previousEnd) invalid();
    ids.add(block.id); checkSpan(page.text, block); checkBox(block.bbox); previousEnd = block.end;
    if (block.table !== undefined) {
      fields(block.table, ["rows", "columns", "cells"]);
      const { rows, columns, cells } = block.table;
      if (block.kind !== "table" || !integer(rows, 1, 10_000) || !integer(columns, 1, 1000)
        || !Array.isArray(cells) || cells.length > 10_000) invalid();
      for (const cell of cells) {
        fields(cell, ["row", "column", "rowSpan", "columnSpan", "start", "end", "bbox", "header"]);
        if (!integer(cell.row, 0, rows - 1) || !integer(cell.column, 0, columns - 1)
          || !integer(cell.rowSpan, 1, rows - cell.row) || !integer(cell.columnSpan, 1, columns - cell.column)
          || cell.start < block.start || cell.end > block.end || typeof cell.header !== "boolean") invalid();
        checkSpan(page.text, cell); checkBox(cell.bbox);
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(page)) > DOCUMENT_LIMITS.resultBytes) invalid();
  return page;
}

export function canonicalPageSummary(page) {
  validateCanonicalPage(page);
  return { page: page.page, status: page.status, characterCount: page.text.length,
    width: page.width, height: page.height, rotation: page.rotation, warnings: page.warnings };
}

export function readCanonicalPageWindow(page, cursor = "0", limit = Number(DOCUMENT_LIMITS.passageCharacters)) {
  validateCanonicalPage(page);
  if (!/^(0|[1-9]\d*)$/.test(String(cursor)) || !integer(Number(cursor), 0, page.text.length)
    || !boundary(page.text, Number(cursor)) || !integer(limit, 2, DOCUMENT_LIMITS.passageCharacters)) {
    throw documentError("invalid_cursor", "The page text cursor is invalid.", 400);
  }
  const start = Number(cursor);
  let end = Math.min(page.text.length, start + limit);
  if (!boundary(page.text, end)) end -= 1;
  if (end < page.text.length) {
    const completed = page.blocks.filter((block) => block.end > start && block.end <= end).at(-1);
    if (completed) {
      const target = end;
      end = completed.end;
      while (end < target && /\s/u.test(page.text[end])) end += 1;
    }
  }
  let included = page.blocks.filter((block) => block.end > start && block.start < end);
  if (included.length > 200) {
    end = included[200].start;
    included = included.slice(0, 200);
  }
  return { schemaVersion: PAGE_SCHEMA_VERSION, page: page.page, status: page.status, start, end,
    text: page.text.slice(start, end), totalCharacters: page.text.length,
    nextCursor: end < page.text.length ? String(end) : null, warnings: page.warnings,
    blocks: included.map(({ id, kind, start: from, end: to, bbox }) => ({ id, kind,
      start: Math.max(start, from), end: Math.min(end, to), ...(bbox ? { bbox } : {}) })) };
}
