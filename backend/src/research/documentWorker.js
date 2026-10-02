import { parseDoc, parseDocx } from "./documentWord.js";
import { parsePdf, renderPdfPage } from "./documentPdf.js";
import { parseTxt, validateDocumentFile } from "./documentText.js";
import { inspectPdf } from "./documentPdfPreflight.js";

const send = (value) => new Promise((resolve, reject) => process.send(value, (error) => error ? reject(error) : resolve()));

if (process.send) process.once("message", async (input) => {
  try {
    const buffer = Buffer.from(input.buffer);
    const extension = validateDocumentFile({ ...input, buffer });
    let result;
    if (input.operation === "inspect" && extension === "pdf") result = await inspectPdf(buffer);
    else if (input.operation === "render" && extension === "pdf") result = await renderPdfPage(buffer, input.page);
    else if (extension === "txt") result = parseTxt(buffer);
    else if (extension === "docx") result = await parseDocx(buffer);
    else if (extension === "doc") result = await parseDoc(buffer);
    else result = await parsePdf(buffer, { completedPages: input.completedPages, onEvent: send, ocrDataPath: input.ocrDataPath });
    await send({ type: "result", value: result });
  } catch (error) {
    await send({ type: "error", code: error.code || "document_parse_failed", statusCode: error.statusCode || 422 });
  } finally { process.disconnect(); }
});
