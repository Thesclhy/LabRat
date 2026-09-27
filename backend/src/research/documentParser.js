import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DOCUMENT_LIMITS, DOCUMENT_PROCESSING_VERSION, documentError } from "./documentLimits.js";
import { createDocumentResult, validateDocumentFile } from "./documentText.js";

const require = createRequire(import.meta.url);

export async function parseDocument({ buffer, filename, mimeType, signal, checkpoint, onPage, operation = "parse", page }) {
  const extension = validateDocumentFile({ buffer, filename, mimeType });
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  if (signal?.aborted) throw documentError("document_cancelled", "Document processing was cancelled.", 409);
  const completedPages = checkpoint?.contentHash === contentHash && checkpoint?.processingVersion === DOCUMENT_PROCESSING_VERSION
    ? checkpoint.pages.filter((part) => part.status === "ready") : [];
  const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]));
  const ocrDataPath = extension === "pdf" && operation === "parse" ? await mkdtemp(path.join(tmpdir(), "labrat-document-")) : null;
  try {
    if (ocrDataPath) for (const code of ["eng", "chi_sim"]) {
      await copyFile(path.join(require(`@tesseract.js-data/${code}`).langPath, `${code}.traineddata.gz`), path.join(ocrDataPath, `${code}.traineddata.gz`));
    }
    if (signal?.aborted) throw documentError("document_cancelled", "Document processing was cancelled.", 409);
  } catch (error) {
    if (ocrDataPath) await rm(ocrDataPath, { recursive: true, force: true });
    throw error;
  }
  return new Promise((resolve, reject) => {
    const child = fork(new URL("./documentWorker.js", import.meta.url), [], {
      execArgv: ["--max-old-space-size=512"], env, serialization: "advanced", windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const pages = [...completedPages];
    let pageCount = null;
    let pageTimer;
    let finished = false;
    let writes = Promise.resolve();
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(pageTimer);
      signal?.removeEventListener("abort", cancel);
      child.kill();
      if (!error && Buffer.byteLength(Buffer.isBuffer(result) ? result : JSON.stringify(result)) > DOCUMENT_LIMITS.resultBytes) {
        error = documentError("document_index_limit", "The document index exceeds its size limit.");
      }
      writes.then(() => error ? reject(error) : resolve(result), reject);
    };
    const timedOut = (code) => {
      if (operation !== "parse" || !pageCount || !pages.length) {
        finish(documentError(code, "Document processing reached its time limit. Retry to continue.")); return;
      }
      const result = createDocumentResult("pdf");
      result.status = "partial"; result.pageCount = pageCount; result.warnings.push(code);
      for (let i = 1; i <= Math.min(pageCount, DOCUMENT_LIMITS.pages); i += 1) {
        const part = pages.find((entry) => entry.page === i);
        if (!part) { result.coverage.push({ page: i, status: "failed", reason: code }); continue; }
        const { passages, ...coverage } = part;
        result.coverage.push(coverage);
        for (const passage of passages) {
          if (result.passages.length >= DOCUMENT_LIMITS.passages || result.characterCount + passage.text.length > DOCUMENT_LIMITS.characters) {
            finish(documentError("document_text_limit", "The document exceeds the bounded text index limit.")); return;
          }
          result.passages.push({ ...passage, ordinal: (i - 1) * DOCUMENT_LIMITS.passages + passage.ordinal }); result.characterCount += passage.text.length;
        }
      }
      if (pageCount > DOCUMENT_LIMITS.pages) result.coverage.push({ pageStart: DOCUMENT_LIMITS.pages + 1, pageEnd: pageCount, status: "omitted", reason: "page_limit" });
      finish(null, result);
    };
    const timer = setTimeout(() => timedOut("document_timeout"), operation === "render" ? DOCUMENT_LIMITS.pageMs : DOCUMENT_LIMITS.attemptMs);
    const cancel = () => finish(documentError("document_cancelled", "Document processing was cancelled.", 409));
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", () => finish(documentError("document_worker_failed", "Document processing could not start.", 503)));
    child.on("exit", () => { if (!finished) finish(documentError("document_worker_failed", "Document processing stopped unexpectedly.")); });
    child.on("message", (message) => {
      if (finished) return;
      if (message.type === "metadata") pageCount = message.pageCount;
      else if (message.type === "page_start") {
        clearTimeout(pageTimer);
        pageTimer = setTimeout(() => timedOut("document_page_timeout"), DOCUMENT_LIMITS.pageMs);
      } else if (message.type === "page") {
        clearTimeout(pageTimer);
        pages.push(message.value);
        if (onPage) writes = writes.then(() => onPage({ contentHash, processingVersion: DOCUMENT_PROCESSING_VERSION, page: message.value }));
        writes.catch((error) => finish(error));
      } else if (message.type === "result") {
        const bytes = Buffer.isBuffer(message.value) ? message.value.length : Buffer.byteLength(JSON.stringify(message.value));
        if (bytes > DOCUMENT_LIMITS.resultBytes) finish(documentError("document_index_limit", "The document index exceeds its size limit."));
        else finish(null, message.value);
      } else if (message.type === "error") finish(documentError(message.code, "The document could not be read. Check its format, encryption and readability.", message.statusCode));
    });
    child.send({ buffer, filename, mimeType, completedPages, operation, page, ocrDataPath });
  }).finally(async () => { if (ocrDataPath) await rm(ocrDataPath, { recursive: true, force: true }); });
}
