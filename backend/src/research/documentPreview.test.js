import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createWorker, PSM } from "tesseract.js";
import { parseDocument } from "./documentParser.js";
import { syntheticPdf } from "./testing/documentFixtures.js";

const require = createRequire(import.meta.url);

test("preview PNG retains readable standard-font glyphs and numeric values", { timeout: 60_000 }, async () => {
  const worker = await createWorker("eng", 1, {
    langPath: require("@tesseract.js-data/eng").langPath,
    cacheMethod: "none", logger: () => {}, errorHandler: () => {},
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    for (const fontName of ["Helvetica", "Helvetica-Bold", "Times-Roman", "Courier"]) {
      const buffer = syntheticPdf([{ text: [
        "Cooling protocol", "Cool the dry sample to 30 C before weighing.", "Duration: 45 minutes.",
      ] }], { fontName });
      const png = await parseDocument({ buffer, filename: "standard-font.pdf", operation: "render", page: 1 });
      // Read the rendered pixels, not the PDF text layer: a valid PNG can still lose glyphs.
      const { data } = await worker.recognize(png);
      assert.match(data.text, /Cooling protocol/, `${fontName}: ${data.text}`);
      assert.match(data.text, /dry sample to 30 C before weighing/, `${fontName}: ${data.text}`);
      assert.match(data.text, /45 minutes/, `${fontName}: ${data.text}`);
    }
  } finally {
    await worker.terminate();
  }
});
