import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDoclingPages } from "./doclingPages.js";

const geometry = (page, height = 792) => ({ page, width: 612, height, rotation: 0, nativeCharacters: 30,
  hasImage: false, isBlank: false, lowContrast: false, inkFraction: 0.02, transform: [1, 0, 0, -1, 0, height] });
const document = (texts, count = 2) => ({ status: "success", document: { json_content: {
  body: { self_ref: "#/body", children: texts.map((_, i) => ({ $ref: `#/texts/${i}` })) },
  furniture: { self_ref: "#/furniture", children: [] }, groups: [], pictures: [], tables: [], texts,
  pages: Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), { page_no: i + 1 }])),
} } });
const prov = (page, start, end) => ({ page_no: page, charspan: [start, end],
  bbox: { l: 10, t: 700, r: 200, b: 680, coord_origin: "BOTTOMLEFT" } });

test("Python spans split Unicode cross-page text once and downgrade inconsistent coordinate frames", () => {
  const source = "中文🔬 alpha beta";
  const result = normalizeDoclingPages(document([{ self_ref: "#/texts/0", label: "text", orig: source, text: source,
    children: [], prov: [prov(1, 0, 9), prov(2, 10, 14)] }]), { pageCount: 2, pages: [geometry(1), geometry(2, 1400)] });
  assert.equal(result.pages[0].text, "中文🔬 alpha"); assert.equal(result.pages[1].text, "beta");
  assert.equal(result.pages[0].blocks[0].end, 10); assert.ok(result.pages[0].blocks[0].bbox);
  assert.equal(result.pages[1].blocks[0].bbox, undefined);
  assert.ok(result.pages[1].warnings.includes("page_precision_location"));
});

test("invalid cross-page spans fail affected pages and formulas retain original content", () => {
  const source = document([{ self_ref: "#/texts/0", label: "text", orig: "lost words", text: "lost words", children: [],
    prov: [prov(1, 0, 4), prov(2, 8, 99)] }]);
  const failed = normalizeDoclingPages(source, { pageCount: 2, pages: [geometry(1), geometry(2)] });
  assert.ok(failed.pages.every((page) => page.status === "failed" && !page.text));
  const formula = normalizeDoclingPages(document([{ self_ref: "#/texts/0", label: "formula", orig: "x² = −12.5", text: "",
    children: [], prov: [prov(1, 0, 10)] }], 1), { pageCount: 1, pages: [geometry(1)] });
  assert.equal(formula.pages[0].text, "x² = −12.5"); assert.equal(formula.pages[0].status, "needs_review");
});

test("upstream success with absent native text cannot become a blank successful page", () => {
  const result = normalizeDoclingPages(document([], 1), { pageCount: 1, pages: [geometry(1)] });
  assert.equal(result.pages[0].status, "failed"); assert.ok(result.pages[0].warnings.includes("missing_native_text"));
});
