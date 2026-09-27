import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker, PSM } from "tesseract.js";
import { getDocument, Util, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DOCUMENT_LIMITS, documentError } from "./documentLimits.js";
import { addPassage, createDocumentResult } from "./documentText.js";

const require = createRequire(import.meta.url);
const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json")).replaceAll("\\", "/");
const clamp = (value) => Math.min(1, Math.max(0, value));

export function normalizedRect(points, width, height) {
  const xs = points.map(([x]) => x / width);
  const ys = points.map(([, y]) => y / height);
  const left = clamp(Math.min(...xs));
  const top = clamp(Math.min(...ys));
  return { left, top, width: clamp(Math.max(...xs)) - left, height: clamp(Math.max(...ys)) - top };
}

export function unrotateOcrBox(box, quarterTurns, width, height) {
  const undo = (x, y) => quarterTurns === 1 ? [y, height - x]
    : quarterTurns === 2 ? [width - x, height - y]
      : quarterTurns === 3 ? [width - y, x] : [x, y];
  return normalizedRect([undo(box.x0, box.y0), undo(box.x1, box.y0), undo(box.x0, box.y1), undo(box.x1, box.y1)], width, height);
}

function textRect(item, viewport) {
  const matrix = Util.transform(viewport.transform, item.transform);
  const angle = Math.atan2(matrix[1], matrix[0]);
  const width = item.width * viewport.scale;
  const height = Math.hypot(matrix[2], matrix[3]);
  const dx = width * Math.cos(angle), dy = width * Math.sin(angle);
  const hx = height * Math.sin(angle), hy = -height * Math.cos(angle);
  const x = matrix[4], y = matrix[5];
  return normalizedRect([[x, y], [x + dx, y + dy], [x + hx, y + hy], [x + dx + hx, y + dy + hy]], viewport.width, viewport.height);
}

async function hasUncoveredScan(page, viewport, items) {
  const ops = await page.getOperatorList();
  const stack = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  const textBoxes = items.filter((item) => item.str?.trim()).map((item) => textRect(item, viewport));
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const op = ops.fnArray[i];
    if (op === OPS.save) stack.push([...matrix]);
    else if (op === OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) matrix = Util.transform(matrix, ops.argsArray[i]);
    else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(op)) {
      const combined = Util.transform(viewport.transform, matrix);
      const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [
        combined[0] * x + combined[2] * y + combined[4], combined[1] * x + combined[3] * y + combined[5],
      ]);
      const rect = normalizedRect(points, viewport.width, viewport.height);
      const area = rect.width * rect.height;
      if (area < 0.2) continue;
      const overlap = textBoxes.reduce((total, box) => total + Math.max(0,
        Math.min(rect.left + rect.width, box.left + box.width) - Math.max(rect.left, box.left)) * Math.max(0,
        Math.min(rect.top + rect.height, box.top + box.height) - Math.max(rect.top, box.top)), 0);
      if (overlap / area < 0.03) return true;
    }
  }
  return false;
}

async function localOcrWorker(ocrDataPath) {
  if (!ocrDataPath) throw documentError("ocr_data_missing", "Local OCR language assets are unavailable.", 503);
  const worker = await createWorker("eng+chi_sim", 1, { langPath: ocrDataPath,
    cacheMethod: "none", logger: () => {}, errorHandler: () => {} });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1", user_defined_dpi: "200" });
  return worker;
}

function rotatedCanvas(original, turns) {
  if (!turns) return original;
  const canvas = createCanvas(turns % 2 ? original.height : original.width, turns % 2 ? original.width : original.height);
  const context = canvas.getContext("2d");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(turns * Math.PI / 2);
  context.drawImage(original, -original.width / 2, -original.height / 2);
  return canvas;
}

async function ocrPage(page, worker, viewport) {
  const scale = Math.min(200 / 72, Math.sqrt(DOCUMENT_LIMITS.pagePixels / (viewport.width * viewport.height)));
  const renderViewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.max(1, Math.floor(renderViewport.width)), Math.max(1, Math.floor(renderViewport.height)));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: renderViewport }).promise;
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let darkest = 255, lightest = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    darkest = Math.min(darkest, value); lightest = Math.max(lightest, value);
  }
  const qualityWarnings = lightest - darkest < 16 ? ["ocr_low_contrast_check_original"] : [];
  let best = null;
  for (const turns of [0, 1, 3, 2]) {
    const image = rotatedCanvas(canvas, turns);
    const { data } = await worker.recognize(image.toBuffer("image/png"), { rotateAuto: false }, { text: true, blocks: true });
    const letters = (data.text.match(/[\p{L}\p{N}]/gu) || []).length;
    const score = data.confidence * Math.min(1, letters / 25);
    if (!best || score > best.score) best = { data, turns, score };
    if (data.confidence >= 80 && letters >= 25) break;
  }
  return { ...best, width: canvas.width, height: canvas.height, scale, qualityWarnings };
}

export async function parsePdf(buffer, { completedPages = [], onEvent = async () => {}, ocrDataPath } = {}) {
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true,
    cMapUrl: `${pdfRoot}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${pdfRoot}/standard_fonts/`,
    wasmUrl: `${pdfRoot}/wasm/`, enableXfa: false, verbosity: 0 });
  let pdf;
  let worker;
  const result = createDocumentResult("pdf");
  try {
    pdf = await task.promise;
    result.pageCount = pdf.numPages;
    await onEvent({ type: "metadata", pageCount: pdf.numPages });
    const count = Math.min(pdf.numPages, DOCUMENT_LIMITS.pages);
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      const cached = completedPages.find((part) => part.page === pageNumber && part.status === "ready");
      let part = cached;
      if (!part) {
        await onEvent({ type: "page_start", page: pageNumber });
        part = { page: pageNumber, status: "ready", method: "text", passages: [], warnings: [] };
        try {
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          if (!(viewport.width > 0 && viewport.height > 0) || viewport.width * viewport.height > 144_000_000) {
            throw documentError("document_page_size", "The page dimensions exceed the rendering limit.");
          }
          const base = { kind: "pdf", page: pageNumber, pageWidth: viewport.width, pageHeight: viewport.height,
            rotation: viewport.rotation, coordinateSystem: "display_normalized_top_left" };
          const content = await page.getTextContent();
          const text = content.items.map((item) => item.str || "").join(" ");
          const readable = (text.match(/[\p{L}\p{N}]/gu) || []).length;
          const partial = createDocumentResult("pdf");
          if (readable >= 24 && !text.includes("\ufffd") && !await hasUncoveredScan(page, viewport, content.items)) {
            let line = [], rectangles = [], lineNumber = 0;
            const flush = () => {
              addPassage(partial, line.join(" "), { ...base, line: ++lineNumber, rectangles }, { method: "text", uncertain: false });
              line = []; rectangles = [];
            };
            for (const item of content.items) {
              if (item.str?.trim()) { line.push(item.str); rectangles.push(textRect(item, viewport)); }
              if (item.hasEOL || line.join(" ").length >= 3000) flush();
            }
            if (line.length) flush();
          } else {
            part.method = "ocr";
            worker ||= await localOcrWorker(ocrDataPath);
            const recognized = await ocrPage(page, worker, viewport);
            const { data, turns, width, height, scale } = recognized;
            part.warnings.push(...recognized.qualityWarnings);
            part.ocr = { engine: "tesseract.js-7.0.0", languages: ["eng", "chi_sim"], languageVersion: "1.0.0",
              confidence: Number.isFinite(data.confidence) ? data.confidence : null, quarterTurns: turns, renderScale: scale };
            let lineNumber = 0;
            for (const block of data.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
              const uncertainWords = (line.words || []).filter((word) => word.confidence < 70 || (/\d/.test(word.text) && word.confidence < 90));
              const uncertain = recognized.qualityWarnings.length > 0 || !Number.isFinite(line.confidence) || line.confidence < 80 || uncertainWords.length > 0;
              addPassage(partial, line.text, { ...base, line: ++lineNumber,
                rectangles: [unrotateOcrBox(line.bbox, turns, width, height)] }, {
                method: "ocr", uncertain, confidence: line.confidence,
                uncertainWords: uncertainWords.map((word) => ({ text: word.text, confidence: word.confidence,
                  rectangle: unrotateOcrBox(word.bbox, turns, width, height) })),
              });
            }
            if (partial.passages.some((entry) => entry.uncertain)) part.warnings.push("ocr_uncertain_text_check_original");
            if (!partial.passages.length) { part.status = "partial"; part.warnings.push("no_readable_text_check_original"); }
          }
          part.passages = partial.passages;
          page.cleanup();
        } catch (error) {
          part.status = "failed";
          part.warnings.push(error.code || "page_read_failed");
        }
        await onEvent({ type: "page", value: part });
      }
      for (const entry of part.passages) {
        result.characterCount += entry.text.length;
        if (result.characterCount > DOCUMENT_LIMITS.characters || result.passages.length >= DOCUMENT_LIMITS.passages) {
          throw documentError("document_text_limit", "The PDF exceeds the bounded text index limit.");
        }
        result.passages.push({ ...entry, ordinal: (pageNumber - 1) * DOCUMENT_LIMITS.passages + entry.ordinal });
      }
      const { passages: _passages, ...coverage } = part;
      result.coverage.push(coverage);
      if (part.status !== "ready" || part.warnings.length) result.status = "partial";
    }
    if (pdf.numPages > count) {
      result.coverage.push({ pageStart: count + 1, pageEnd: pdf.numPages, status: "omitted", reason: "page_limit" });
      result.status = "partial";
    }
    result.limitations.push("figures_and_scientific_images_not_interpreted", "complex_table_structure_not_inferred");
    return result;
  } catch (error) {
    if (error.name === "PasswordException") throw documentError("document_encrypted", "Password-protected PDFs cannot be read.");
    throw error;
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
}

export async function renderPdfPage(buffer, pageNumber) {
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true,
    standardFontDataUrl: `${pdfRoot}/standard_fonts/`,
    cMapUrl: `${pdfRoot}/cmaps/`, cMapPacked: true,
    wasmUrl: `${pdfRoot}/wasm/`, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw documentError("page_not_found", "Page not found.", 404);
    const page = await pdf.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, Math.sqrt(DOCUMENT_LIMITS.pagePixels / (natural.width * natural.height)));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas.toBuffer("image/png");
  } finally { await task.destroy(); }
}
