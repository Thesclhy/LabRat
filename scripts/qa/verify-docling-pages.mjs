// Real probe artifacts are private and intentionally not committed.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseDocument } from "../../backend/src/research/documentParser.js";
import { normalizeDoclingPages } from "../../backend/src/research/doclingPages.js";
import { readCanonicalPageWindow } from "../../backend/src/research/documentPages.js";

const root = path.resolve(process.argv[2] || "artifacts/docling-pdf-pages");
const paper = process.argv[3];
if (!paper) throw new Error("Supply the original paper path as the second argument.");
const golden = JSON.parse(await fs.readFile("doc/qa/docling-pdf-pages-goldens.json", "utf8"));
const compared = (text) => text.replaceAll("ﬁ", "fi").replaceAll("ﬂ", "fl").replace(/-\s*\n\s*/gu, "").replace(/\s+/gu, " ").trim();
const report = [];
for (const [name, input, probe] of [["paper", paper, "paper-pdfium"], ["native", "native.pdf", "native-unicode-pdfium"],
  ["scan", "scan.pdf", "scan-pdfium"], ["mixed", "mixed.pdf", "mixed-pdfium"], ["blank", "blank.pdf", "blank-pdfium"],
  ["low-quality", "low-quality.pdf", "low-quality-pdfium"], ["encrypted", "encrypted.pdf", null], ["corrupt", "corrupt.pdf", null]]) {
  const buffer = await fs.readFile(name === "paper" ? input : path.join(root, "fixtures", input));
  let inspection;
  try { inspection = await parseDocument({ buffer, filename: `${name}.pdf`, mimeType: "application/pdf", operation: "inspect" }); }
  catch (error) {
    if (!["encrypted", "corrupt"].includes(name)) throw error;
    assert.equal(error.code, `document_${name}`); report.push({ name, code: error.code }); continue;
  }
  assert.ok(probe, `${name} must fail preflight`);
  const converted = normalizeDoclingPages(JSON.parse(await fs.readFile(path.join(root, probe, "result.json"), "utf8")), inspection);
  await fs.writeFile(path.join(root, probe, "inspection.json"), JSON.stringify(inspection, null, 2));
  await fs.writeFile(path.join(root, probe, "canonical-pages.json"), JSON.stringify(converted, null, 2));
  for (const page of converted.pages) {
    let cursor = "0", text = "", count = 0;
    do {
      const window = readCanonicalPageWindow(page, cursor); assert.equal(window.start, text.length);
      assert.ok(window.text.isWellFormed()); text += window.text; cursor = window.nextCursor;
      assert.ok(++count < 1000);
    } while (cursor !== null);
    assert.equal(text, page.text);
  }
  const info = { name, pages: converted.pages.map(({ page, status, text, blocks, warnings }) => ({ page, status, characters: text.length, blocks: blocks.length, warnings })) };
  if (name === "paper") {
    assert.equal(converted.pageCount, golden.physicalPages);
    const missing = golden.anchors.filter(({ page, text }) => !compared(converted.pages[page - 1].text).includes(compared(text)));
    info.anchors = { passed: golden.anchors.length - missing.length, total: golden.anchors.length, missing };
    console.log(JSON.stringify(info)); assert.deepEqual(missing, []);
    assert.ok(converted.pages.every((page) => page.text.length > 100));
  } else if (name === "native") {
    const [first, rotated, long] = converted.pages;
    const indices = golden.synthetic.nativePage1Order.map((text) => first.text.indexOf(text));
    assert.ok(indices.every((index, i) => index >= 0 && (!i || index > indices[i - 1])));
    const table = first.blocks.find((block) => block.kind === "table"); assert.ok(table);
    for (const [r, row] of golden.synthetic.table.entries()) for (const [c, expected] of row.entries()) {
      const cell = table.table.cells.find((entry) => entry.row === r && entry.column === c);
      assert.ok(cell); assert.equal(compared(first.text.slice(cell.start, cell.end)), expected);
    }
    assert.ok(compared(rotated.text).includes(golden.synthetic.rotated));
    assert.ok(long.text.length >= golden.synthetic.longPageMinimumCharacters);
    assert.ok(long.text.includes(golden.synthetic.unicodeOffsetProbe));
    assert.ok(!rotated.text.includes("LONG-PAGE")); assert.ok(!long.text.includes("ROTATED-90"));
  } else if (name === "scan") {
    for (const anchor of golden.synthetic.scan) assert.ok(converted.pages[0].text.includes(anchor), anchor);
  } else if (name === "mixed") {
    const text = converted.pages[0].text;
    assert.equal(text.split(golden.synthetic.mixedNative).length - 1, 1);
    for (const anchor of golden.synthetic.mixedImage) assert.ok(text.includes(anchor), anchor);
  } else if (name === "blank") assert.equal(converted.pages[0].status, "empty");
  else if (name === "low-quality") assert.equal(converted.pages[0].status, "needs_review");
  report.push(info); if (name !== "paper") console.log(JSON.stringify(info));
}
await fs.writeFile(path.join(root, "canonical-audit.json"), JSON.stringify(report, null, 2));
console.log("Real Docling result normalization and independent preflight passed.");
