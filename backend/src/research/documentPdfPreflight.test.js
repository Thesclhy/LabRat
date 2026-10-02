import test from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "./documentParser.js";
import { DOCUMENT_LIMITS } from "./documentLimits.js";
import { syntheticPdf } from "./testing/documentFixtures.js";

const inspect = (buffer) => parseDocument({ buffer, filename: "limits.pdf", mimeType: "application/pdf", operation: "inspect" });

test("independent PDF preflight rejects 201 physical pages and oversized input before conversion", async () => {
  await assert.rejects(inspect(syntheticPdf(Array.from({ length: 201 }, () => ({ text: [] })))), { code: "document_page_limit" });
  const oversized = Buffer.alloc(DOCUMENT_LIMITS.fileBytes + 1);
  oversized.write("%PDF-1.7\n");
  await assert.rejects(inspect(oversized), { code: "document_too_large" });
});

test("independent PDF preflight keeps physical page order, rotation and blank state", async () => {
  const result = await inspect(syntheticPdf([{ text: ["ZnO 280 C"] }, { text: [], rotation: 90 }]));
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.pages.map((page) => page.page), [1, 2]);
  assert.ok(result.pages[0].nativeCharacters > 0);
  assert.equal(result.pages[0].isBlank, false);
  assert.equal(result.pages[1].rotation, 90);
  assert.equal(result.pages[1].isBlank, true);
});
