import yauzl from "yauzl";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import WordExtractor from "word-extractor";
import XLSX from "xlsx";
import { DOCUMENT_LIMITS, documentError } from "./documentLimits.js";
import { addPassage, createDocumentResult } from "./documentText.js";

async function wordXmlParts(buffer) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(buffer,
    { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)));
  const parts = new Map();
  let expanded = 0;
  let count = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      expanded += entry.uncompressedSize;
      count += 1;
      if (count > DOCUMENT_LIMITS.archiveEntries || expanded > DOCUMENT_LIMITS.expandedBytes) {
        throw documentError("document_archive_limit", "The document archive exceeds its resource limit.");
      }
      if (entry.generalPurposeBitFlag & 1) throw documentError("document_encrypted", "Encrypted Word documents cannot be read.");
      if (/vbaProject\.bin$/i.test(entry.fileName)) throw documentError("document_macros", "Macro-enabled Word files are not supported.");
      if (!/^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(entry.fileName)) continue;
      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > DOCUMENT_LIMITS.expandedBytes) throw documentError("document_archive_limit", "A document part exceeds its resource limit.");
        chunks.push(chunk);
      }
      const xml = Buffer.concat(chunks).toString("utf8");
      if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
        throw documentError("document_xml_invalid", "The Word document contains unsupported or invalid XML.");
      }
      if (parts.has(entry.fileName)) throw documentError("document_xml_invalid", "The document contains duplicate parts.");
      parts.set(entry.fileName, xml);
    }
  } finally { zip.close(); }
  if (!parts.has("word/document.xml")) throw documentError("document_type_mismatch", "This ZIP file is not a Word document.");
  return parts;
}

function innerText(nodes) {
  let text = "";
  for (const node of nodes || []) {
    for (const [key, children] of Object.entries(node)) {
      if (key === "#text") text += children;
      else if (key === "w:tab") text += "\t";
      else if (key === "w:br" || key === "w:cr") text += "\n";
      else if (![":@", "w:instrText", "w:del", "w:pPr", "w:rPr"].includes(key) && Array.isArray(children)) text += innerText(children);
    }
  }
  return text;
}

export async function parseDocx(buffer) {
  const parts = await wordXmlParts(buffer);
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false });
  const result = createDocumentResult("docx");
  const ordered = [...parts].sort(([a], [b]) => a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b));
  for (const [part, xml] of ordered) {
    let paragraph = 0;
    let table = 0;
    const walk = (nodes, context = {}) => {
      for (const node of nodes || []) {
        for (const [key, children] of Object.entries(node)) {
          if (key === "w:del") continue;
          if (key === "w:tbl") {
            const currentTable = ++table;
            let row = 0;
            for (const child of children) {
              if (!child["w:tr"]) continue;
              row += 1;
              let column = 0;
              for (const cell of child["w:tr"]) {
                if (cell["w:tc"]) walk(cell["w:tc"], { table: currentTable, row, column: ++column });
              }
            }
          } else if (key === "w:p") {
            paragraph += 1;
            addPassage(result, innerText(children), { kind: "word", part, paragraph, ...context });
          } else if (Array.isArray(children)) walk(children, context);
        }
      }
    };
    walk(parser.parse(xml));
    result.coverage.push({ part, status: "ready", paragraphs: paragraph, tables: table });
    if (/<w:(drawing|pict|object|altChunk)\b/.test(xml)) {
      result.warnings.push("word_embedded_content_not_read");
      result.status = "partial";
    }
    if (/<w:(gridSpan|vMerge)\b/.test(xml)) result.warnings.push("word_table_coordinates_are_physical_cells");
    if (/<w:(del|ins)\b/.test(xml)) result.warnings.push("word_current_text_only_tracked_changes_present");
  }
  result.limitations.push("word_page_layout_not_inferred", "fields_and_external_links_not_evaluated");
  result.warnings = [...new Set(result.warnings)];
  if (!result.passages.length) {
    result.status = "partial";
    for (const part of result.coverage) part.status = "partial";
    result.warnings.push("no_readable_text");
  }
  return result;
}

export async function parseDoc(buffer) {
  const compound = XLSX.CFB.read(buffer, { type: "buffer" });
  const word = XLSX.CFB.find(compound, "WordDocument")?.content;
  if (!word || word.length < 12) throw documentError("document_type_mismatch", "The file does not contain a Word document.");
  if (word.readUInt16LE(10) & 0x8100) throw documentError("document_encrypted", "Password-protected Word documents cannot be read.");
  const document = await new WordExtractor().extract(buffer);
  const result = createDocumentResult("doc");
  for (const [part, method] of [["body", "getBody"], ["footnotes", "getFootnotes"], ["endnotes", "getEndnotes"],
    ["headers", "getHeaders"], ["footers", "getFooters"], ["textboxes", "getTextboxes"]]) {
    const text = document[method]({ filterUnicode: false, includeFooters: false });
    text.split(/\r\n|\n|\r/).forEach((value, index) => {
      addPassage(result, value, { kind: "word", part, paragraph: index + 1 });
    });
    result.coverage.push({ part, status: "ready" });
  }
  result.limitations.push("legacy_word_table_and_page_layout_not_reconstructed", "embedded_images_and_fields_not_interpreted");
  if (!result.passages.length) throw documentError("no_readable_text", "No readable text was found in the Word document.");
  return result;
}
