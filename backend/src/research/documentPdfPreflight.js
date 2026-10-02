import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DOCUMENT_LIMITS, documentError } from "./documentLimits.js";

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("pdfjs-dist/package.json")).replaceAll("\\", "/");

// Independent of Docling's page metadata. Runs in the bounded parser subprocess.
export async function inspectPdf(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false,
    standardFontDataUrl: `${root}/standard_fonts/`, cMapUrl: `${root}/cmaps/`, cMapPacked: true,
    wasmUrl: `${root}/wasm/`, enableXfa: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > DOCUMENT_LIMITS.pages) throw documentError("document_page_limit", "The PDF exceeds 200 physical pages.");
    const pages = [];
    let characters = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 1 });
      if (!(viewport.width > 0 && viewport.height > 0) || viewport.width * viewport.height > 144_000_000) {
        throw documentError("document_page_size", "The page dimensions exceed the rendering limit.");
      }
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str || "").join(" ");
      characters += text.length;
      if (characters > DOCUMENT_LIMITS.characters) throw documentError("document_text_limit", "The PDF exceeds its complete text limit.");
      const ops = await page.getOperatorList();
      const hasImage = ops.fnArray.some((op) => [OPS.paintImageXObject, OPS.paintInlineImageXObject,
        OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat].includes(op));
      const small = page.getViewport({ scale: Math.min(1, Math.sqrt(1_000_000 / (viewport.width * viewport.height))) });
      const canvas = createCanvas(Math.max(1, Math.ceil(small.width)), Math.max(1, Math.ceil(small.height)));
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context, viewport: small, background: "white" }).promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let darkest = 255, lightest = 0, visible = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const low = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
        const high = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        darkest = Math.min(darkest, low); lightest = Math.max(lightest, high);
        if (low < 245) visible += 1;
      }
      pages.push({ page: number, width: viewport.width, height: viewport.height, rotation: viewport.rotation,
        viewBox: [...page.view], transform: [...viewport.transform],
        nativeCharacters: text.replace(/\s/gu, "").length, hasImage,
        isBlank: darkest === 255 && text.trim().length === 0,
        lowContrast: darkest < 255 && lightest - darkest < 16,
        inkFraction: visible / (pixels.length / 4) });
      page.cleanup();
    }
    return { pageCount: pdf.numPages, pages };
  } catch (error) {
    if (error.name === "PasswordException") throw documentError("document_encrypted", "Password-protected PDFs cannot be read.");
    if (error.name === "InvalidPDFException") throw documentError("document_corrupt", "The PDF cannot be opened.");
    throw error;
  } finally { await task.destroy(); }
}
