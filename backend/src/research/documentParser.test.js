import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DOCUMENT_LIMITS, DOCUMENT_PROCESSING_VERSION } from "./documentLimits.js";
import { parseDocument } from "./documentParser.js";
import { addPassage, createDocumentResult, decodeText, parseTxt, validateDocumentFile } from "./documentText.js";
import { parseDoc, parseDocx } from "./documentWord.js";
import { unrotateOcrBox } from "./documentPdf.js";
import { syntheticDoc, syntheticDocx, syntheticPdf } from "./testing/documentFixtures.js";
import { encryptedPdfFixture } from "./testing/encryptedPdfFixture.js";

test("TXT preserves Chinese, paragraph lines, blank lines and stable citations", () => {
  const buffer = Buffer.from("实验记录\r\n温度 80 C\r\n\r\nTime 30 min\r\n");
  const parsed = parseTxt(buffer);
  assert.equal(parsed.passages.length, 2);
  assert.equal(parsed.passages[0].locator.lineStart, 1);
  assert.equal(parsed.passages[1].locator.lineStart, 4);
  assert.match(parsed.passages[0].text, /温度 80 C/);
  assert.deepEqual(parseTxt(buffer), parsed);
});

test("TXT recognizes UTF-16 and reports inferred Chinese encoding; binary text fails", () => {
  assert.equal(decodeText(Buffer.concat([Buffer.from([255, 254]), Buffer.from("中文", "utf16le")])).text, "中文");
  const gb = decodeText(Buffer.from("d6d0cec4", "hex"));
  assert.equal(gb.text, "中文"); assert.deepEqual(gb.warnings, ["encoding_inferred_gb18030"]);
  assert.throws(() => decodeText(Buffer.from([0, 1, 2, 3])), /binary/);
  assert.throws(() => decodeText(Buffer.from([0xff])), /encoding/);
});

test("empty text stays partially readable and passage windows preserve Unicode characters", async () => {
  assert.equal(parseTxt(Buffer.from(" \n\n\t")).status, "partial");
  const emptyWord = await parseDocx(syntheticDocx({ body: "<w:p/>" }));
  assert.equal(emptyWord.status, "partial");
  assert.ok(emptyWord.warnings.includes("no_readable_text"));
  const text = "a".repeat(3999) + "🧪" + "b".repeat(4000);
  const result = createDocumentResult("txt");
  addPassage(result, text, { kind: "text", lineStart: 1, lineEnd: 1 });
  assert.equal(result.passages.map((part) => part.text).join(""), text);
  assert.ok(result.passages.every((part) => !/[\uD800-\uDBFF]$/u.test(part.text) && !/^[\uDC00-\uDFFF]/u.test(part.text)));
  assert.equal(result.passages[1].locator.charStart, 3999);
});

test("file signatures, MIME mismatch, unsupported extensions and size are rejected", () => {
  assert.throws(() => validateDocumentFile({ buffer: Buffer.from("not pdf"), filename: "x.pdf" }), /signature/);
  assert.throws(() => validateDocumentFile({ buffer: Buffer.from("hello"), filename: "x.txt", mimeType: "application/pdf" }), /declared/);
  assert.throws(() => validateDocumentFile({ buffer: Buffer.from("hello"), filename: "x.exe" }), /Use PDF/);
  assert.throws(() => validateDocumentFile({ buffer: Buffer.alloc(25 * 1024 * 1024 + 1), filename: "x.txt" }), /25 MiB/);
});

test("DOCX retains paragraph and table row/cell locators and reads headers", async () => {
  const parsed = await parseDocx(syntheticDocx({ extras: { "word/header1.xml": '<w:hdr xmlns:w="x"><w:p><w:r><w:t>Project Q</w:t></w:r></w:p></w:hdr>' } }));
  assert.match(parsed.passages[0].text, /中文/);
  const cell = parsed.passages.find((entry) => entry.text === "80 C");
  assert.equal(cell.locator.table, 1); assert.equal(cell.locator.row, 1); assert.equal(cell.locator.column, 2);
  assert.equal(parsed.passages.at(-1).locator.part, "word/header1.xml");
});

test("DOCX never executes field instructions or macros and rejects custom XML entities", async () => {
  const parsed = await parseDocx(syntheticDocx({ body: '<w:p><w:r><w:instrText>INCLUDETEXT https://example.invalid/private</w:instrText><w:t>Cached text</w:t></w:r></w:p>' }));
  assert.equal(parsed.passages[0].text, "Cached text");
  await assert.rejects(parseDocx(syntheticDocx({ extras: { "word/vbaProject.bin": "macro" } })), /Macro/);
  await assert.rejects(parseDocx(syntheticDocx({ body: '<!DOCTYPE x [<!ENTITY a "exploit">]><w:p>&a;</w:p>' })), /XML/);
});

test("genuine OLE Word text uses immutable part/paragraph locations", async () => {
  const parsed = await parseDoc(syntheticDoc());
  assert.equal(parsed.extension, "doc");
  assert.match(parsed.passages.map((p) => p.text).join("\n"), /时间 30 分钟/);
  assert.equal(parsed.passages.find((p) => p.text.includes("80 C")).locator.paragraph, 2);
  assert.ok(parsed.limitations.includes("legacy_word_table_and_page_layout_not_reconstructed"));
});

test("actual worker returns indexed TXT and DOCX; cancellation rejects", async () => {
  const parsed = await parseDocument({ buffer: Buffer.from("No model call.\nTemperature 80 C."), filename: "notes.txt" });
  assert.equal(parsed.status, "ready");
  const docx = await parseDocument({ buffer: syntheticDocx(), filename: "notes.docx" });
  assert.equal(docx.passages[2].text, "80 C");
  await assert.rejects(parseDocument({ buffer: Buffer.from("hello"), filename: "x.txt", signal: AbortSignal.abort() }), /cancelled/);
});

test("text PDF locators and PNG rendering use the same original rotated page", async () => {
  const buffer = syntheticPdf([{ text: ["Protocol RQ-001 requires a dry sample", "Temperature: 80 C"], rotation: 90 }]);
  const parsed = await parseDocument({ buffer, filename: "method.pdf" });
  assert.equal(parsed.coverage[0].method, "text");
  assert.equal(parsed.passages[0].locator.rotation, 90);
  assert.equal(parsed.passages[0].locator.pageWidth, 800);
  const image = await parseDocument({ buffer, filename: "method.pdf", operation: "render", page: 1 });
  assert.ok(image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")));
  await assert.rejects(parseDocument({ buffer, filename: "method.pdf", operation: "render", page: 2 }), { code: "page_not_found" });
});

test("OCR inverse rectangles map quarter rotations back to original page", () => {
  const box = { x0: 10, y0: 20, x1: 30, y1: 40 };
  assert.deepEqual(unrotateOcrBox(box, 0, 100, 200), { left: .1, top: .1, width: .19999999999999998, height: .1 });
  const rotated = unrotateOcrBox(box, 1, 100, 200);
  assert.equal(rotated.left, .2); assert.equal(rotated.top, .85);
  assert.ok(Math.abs(rotated.width - .2) < 1e-8);
  assert.ok(Math.abs(rotated.height - .1) < 1e-8);
});

test("actual English/Chinese OCR and mixed pages produce original-page citations without duplicate text", { timeout: 160_000 }, async () => {
  const buffer = syntheticPdf([
    { text: ["Research protocol RQ-001 requires a dry sample", "Temperature: 80 C"] },
    { scan: {} }, { scan: { chinese: true } },
  ]);
  const pages = [];
  const parsed = await parseDocument({ buffer, filename: "mixed.pdf", onPage: async (value) => pages.push(value.page) });
  assert.equal(parsed.pageCount, 3);
  assert.deepEqual(parsed.coverage.map((page) => page.method), ["text", "ocr", "ocr"]);
  const english = parsed.passages.filter((entry) => entry.locator.page === 2);
  assert.equal(english[0].ordinal, DOCUMENT_LIMITS.passages, "page order cannot shift when an earlier failed page is retried");
  assert.match(english.map((entry) => entry.text).join(" "), /Temperature.*80/);
  assert.match(parsed.passages.filter((entry) => entry.locator.page === 3).map((entry) => entry.text).join(" "), /反应时间|反应 时间/);
  for (const passage of english) {
    assert.ok(passage.locator.rectangles.every((r) => r.left >= 0 && r.top >= 0 && r.left + r.width <= 1.00001 && r.top + r.height <= 1.00001));
  }
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const replay = await parseDocument({ buffer, filename: "mixed.pdf", checkpoint: { contentHash, processingVersion: DOCUMENT_PROCESSING_VERSION, pages },
    onPage: () => assert.fail("completed pages must not be re-OCRed") });
  assert.deepEqual(replay.passages, parsed.passages);
  const filled = await parseDocument({ buffer, filename: "mixed.pdf", checkpoint: { contentHash, processingVersion: DOCUMENT_PROCESSING_VERSION, pages: pages.filter((part) => part.page !== 1) } });
  assert.deepEqual(filled.passages, parsed.passages, "filling an earlier page preserves later passage identities and order");
});

test("actual rotated/multicolumn scan and low-contrast pages retain coverage warnings", { timeout: 160_000 }, async () => {
  const buffer = syntheticPdf([{ scan: { turns: 1, columns: true } }, { scan: { lowContrast: true } }]);
  const parsed = await parseDocument({ buffer, filename: "difficult.pdf" });
  assert.match(parsed.passages.filter((p) => p.locator.page === 1).map((p) => p.text).join(" "), /Research protocol/);
  const heading = parsed.passages.find((p) => p.locator.page === 1 && /Research protocol/.test(p.text));
  assert.ok(heading.locator.rectangles[0].left > .8, "rotated heading citation must stay at the right edge of the original page");
  const second = parsed.coverage[1];
  assert.equal(second.method, "ocr");
  assert.ok(second.ocr.confidence === null || Number.isFinite(second.ocr.confidence));
  assert.ok(second.warnings.includes("ocr_low_contrast_check_original"));
  assert.ok(parsed.passages.filter((p) => p.locator.page === 2).every((p) => p.uncertain));
  if (!parsed.passages.some((p) => p.locator.page === 2)) assert.equal(second.status, "partial");
});

test("encrypted/corrupt files and excessive archive/text input fail explicitly", async () => {
  await assert.rejects(parseDocument({ buffer: encryptedPdfFixture(), filename: "locked.pdf" }), { code: "document_encrypted" });
  await assert.rejects(parseDocument({ buffer: Buffer.from("%PDF-1.7\nnot a valid document"), filename: "broken.pdf" }));
  await assert.rejects(parseDoc(syntheticDoc("Unreadable encrypted content", { encrypted: true })), { code: "document_encrypted" });
  await assert.rejects(parseDocx(syntheticDocx({ extras: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`extra/${i}.txt`, "x"])) })), { code: "document_archive_limit" });
  assert.throws(() => parseTxt(Buffer.from("x".repeat(2_000_001))), { code: "document_text_limit" });
});

test("the PDF page cap is explicit and available pages remain citable", async () => {
  const buffer = syntheticPdf(Array.from({ length: 201 }, (_, index) => ({ text: [`Synthetic readable source page ${index + 1} for coverage testing.`] })));
  const parsed = await parseDocument({ buffer, filename: "many-pages.pdf" });
  assert.equal(parsed.status, "partial"); assert.equal(parsed.pageCount, 201);
  assert.equal(parsed.passages.at(-1).locator.page, 200);
  assert.deepEqual(parsed.coverage.at(-1), { pageStart: 201, pageEnd: 201, status: "omitted", reason: "page_limit" });
});

test("hidden text avoids duplicate OCR while incomplete overlays and skewed scans retain missing content", { timeout: 160_000 }, async () => {
  const lines = ["Research protocol RQ-001", "Temperature: 80 C", "Duration: 30 minutes", "Sample: Exp17", "This procedure requires a dry sample."];
  const parsed = await parseDocument({ buffer: syntheticPdf([
    { scan: {}, text: lines }, { scan: {}, text: [lines[0]] }, { scan: { skew: .035 } },
    { scan: { lowContrast: true, numericBlur: true } },
  ]), filename: "scan-coverage.pdf" });
  assert.equal(parsed.coverage[0].method, "text");
  assert.equal(parsed.passages.filter((p) => p.locator.page === 1 && /Temperature/.test(p.text)).length, 1);
  assert.equal(parsed.coverage[1].method, "ocr");
  assert.match(parsed.passages.filter((p) => p.locator.page === 2).map((p) => p.text).join(" "), /Duration.*30/);
  const skewed = parsed.passages.find((p) => p.locator.page === 3 && /Temperature/.test(p.text));
  assert.ok(skewed, "slightly skewed, readable text must remain available");
  assert.ok(skewed.locator.rectangles[0].top > .1 && skewed.locator.rectangles[0].top < .2);
  assert.ok(parsed.coverage[3].warnings.includes("ocr_low_contrast_check_original"));
  assert.ok(parsed.passages.filter((p) => p.locator.page === 4).every((p) => p.uncertain));
});
