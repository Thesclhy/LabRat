import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPageSummary, readCanonicalPageWindow, validateCanonicalPage } from "./documentPages.js";

const page = (text, blocks = [{ id: "p1-b0", kind: "text", start: 0, end: text.length }]) => ({
  schemaVersion: 2, page: 1, status: "ready", text, width: 612, height: 792, rotation: 0, blocks, warnings: [],
});

test("complete long pages survive storage validation and consecutive Unicode windows", () => {
  const source = page("a".repeat(3999) + "🔬中文 −12.5 °C\n" + "b".repeat(10_003));
  assert.equal(validateCanonicalPage(source), source);
  let cursor = "0", restored = "", previous = 0;
  do {
    const result = readCanonicalPageWindow(source, cursor);
    assert.equal(result.start, previous);
    assert.equal(result.text.isWellFormed(), true);
    assert.ok(result.text.length <= 4000);
    assert.ok(result.end > result.start);
    restored += result.text; previous = result.end; cursor = result.nextCursor;
  } while (cursor !== null);
  assert.equal(restored, source.text);
  assert.throws(() => readCanonicalPageWindow(source, "4000"), { code: "invalid_cursor" });
});

test("windows prefer whole blocks while retaining all separators and bounding block count", () => {
  const text = "abc\n\n".repeat(210);
  const source = page(text, Array.from({ length: 210 }, (_, n) => ({ id: `b${n}`, kind: "text", start: n * 5, end: n * 5 + 3 })));
  const first = readCanonicalPageWindow(source);
  assert.equal(first.blocks.length, 200);
  assert.equal(first.end, 1000);
  assert.equal(first.text + readCanonicalPageWindow(source, first.nextCursor).text, text);
  assert.equal(readCanonicalPageWindow(source, "0", 12).end, 10);
});

test("invalid coordinates, split characters, duplicate/overlapping blocks and redundant fields reject", () => {
  for (const bad of [
    { ...page("a"), metadata: { fullText: "a" } },
    page("a", [{ id: "b", kind: "text", start: 0, end: 1, bbox: [0, 0, 2, 1] }]),
    page("🔬", [{ id: "b", kind: "text", start: 0, end: 1 }]),
    page("ab", [{ id: "b", kind: "text", start: 0, end: 1 }, { id: "b", kind: "text", start: 1, end: 2 }]),
    { ...page("not empty"), status: "empty" },
    { ...page("uncertain"), status: "needs_review" },
  ]) assert.throws(() => validateCanonicalPage(bad), { code: "document_page_invalid" });
});

test("empty and failed pages remain explicit, with no fabricated content", () => {
  for (const status of ["empty", "failed"]) {
    const source = { ...page("", []), status, warnings: status === "failed" ? ["incomplete_page"] : [] };
    assert.equal(canonicalPageSummary(source).status, status);
    assert.equal(readCanonicalPageWindow(source).nextCursor, null);
  }
});

test("table structure references the one page text without repeating cells in read payloads", () => {
  const source = page("ZnO\t73 wt%", [{ id: "table", kind: "table", start: 0, end: 10,
    table: { rows: 1, columns: 2, cells: [
      { row: 0, column: 0, rowSpan: 1, columnSpan: 1, start: 0, end: 3, header: false },
      { row: 0, column: 1, rowSpan: 1, columnSpan: 1, start: 4, end: 10, header: false },
    ] } }]);
  validateCanonicalPage(source);
  const window = readCanonicalPageWindow(source);
  assert.equal(window.text, source.text);
  assert.equal("table" in window.blocks[0], false);
});
