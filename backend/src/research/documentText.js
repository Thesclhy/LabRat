import { createHash } from "node:crypto";
import path from "node:path";
import { DOCUMENT_LIMITS, DOCUMENT_PROCESSING_VERSION, documentError } from "./documentLimits.js";

const MIME_TYPES = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  txt: ["text/plain"],
};

export function validateDocumentFile({ buffer, filename, mimeType }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw documentError("empty_document", "The file is empty.");
  if (buffer.length > DOCUMENT_LIMITS.fileBytes) throw documentError("document_too_large", "The file exceeds 25 MiB.", 413);
  const extension = path.extname(filename || "").slice(1).toLowerCase();
  if (!MIME_TYPES[extension]) throw documentError("unsupported_document", "Use PDF, DOC, DOCX or TXT; Excel uses the workbook upload workflow.", 415);
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (mime && mime !== "application/octet-stream" && !MIME_TYPES[extension].includes(mime)) {
    throw documentError("document_type_mismatch", "The declared file type does not match its extension.", 415);
  }
  const matches = extension === "pdf" ? buffer.subarray(0, 5).toString() === "%PDF-"
    : extension === "doc" ? buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))
      : extension === "docx" ? buffer.subarray(0, 4).equals(Buffer.from("504b0304", "hex")) : true;
  if (!matches) throw documentError("document_type_mismatch", "The file signature does not match its extension.", 415);
  return extension;
}

export function decodeText(buffer) {
  const bom = buffer.subarray(0, 3).toString("hex");
  const prefix = buffer.subarray(0, 2).toString("hex");
  const encoding = bom === "efbbbf" ? "utf-8" : prefix === "fffe" ? "utf-16le" : prefix === "feff" ? "utf-16be" : null;
  let text;
  let usedEncoding = encoding || "utf-8";
  try {
    text = new TextDecoder(usedEncoding, { fatal: true }).decode(buffer);
  } catch {
    if (encoding) throw documentError("document_encoding_invalid", "The document contains invalid encoded text.");
    usedEncoding = "gb18030";
    try { text = new TextDecoder(usedEncoding, { fatal: true }).decode(buffer); }
    catch { throw documentError("document_encoding_invalid", "Text encoding is not readable; save as UTF-8 and retry."); }
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f\ufffd]/u.test(text)) {
    throw documentError("document_encoding_invalid", "The file contains binary or undecodable text.");
  }
  return { text, encoding: usedEncoding, warnings: usedEncoding === "gb18030" ? ["encoding_inferred_gb18030"] : [] };
}

export function createDocumentResult(extension) {
  return {
    extension, processingVersion: DOCUMENT_PROCESSING_VERSION, status: "ready",
    passages: [], coverage: [], warnings: [], limitations: [], characterCount: 0,
  };
}

export function addPassage(result, text, locator, metadata = {}) {
  if (!text?.trim()) return;
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + DOCUMENT_LIMITS.passageCharacters);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end -= 1;
    const chunk = text.slice(offset, end);
    if (result.passages.length >= DOCUMENT_LIMITS.passages || result.characterCount + chunk.length > DOCUMENT_LIMITS.characters) {
      throw documentError("document_text_limit", "The document exceeds the bounded text index limit.");
    }
    const position = { ...locator, charStart: offset, charEnd: offset + chunk.length };
    const ordinal = result.passages.length;
    const id = `passage_${createHash("sha256").update(JSON.stringify([position, chunk])).digest("hex").slice(0, 32)}`;
    result.passages.push({ id, ordinal, text: chunk, locator: position, ...metadata });
    result.characterCount += chunk.length;
    offset = end;
  }
}

export function parseTxt(buffer) {
  const decoded = decodeText(buffer);
  const result = createDocumentResult("txt");
  result.encoding = decoded.encoding;
  result.warnings.push(...decoded.warnings);
  const lines = decoded.text.split(/\r\n|\n|\r/);
  let start = 0;
  let content = [];
  const flush = (end) => {
    addPassage(result, content.join("\n"), { kind: "text", lineStart: start + 1, lineEnd: end + 1 });
    content = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    if (!content.length) start = i;
    content.push(lines[i]);
    if (!lines[i].trim() || content.join("\n").length >= 3000) flush(i);
  }
  if (content.length) flush(lines.length - 1);
  result.coverage.push({ part: "text", status: "ready", lines: lines.length });
  if (!result.passages.length) {
    result.status = "partial";
    result.coverage[0].status = "partial";
    result.warnings.push("no_readable_text");
  }
  return result;
}
