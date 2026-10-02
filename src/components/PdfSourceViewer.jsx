import React, { useEffect, useState } from "react";
import { contextDocumentPageUrl, getContextDocumentVersion } from "../data/researchQaApi.js";
import { PdfPageText } from "./PdfPageText.jsx";

// The source-page endpoint shares the contract's 200-page processing limit.
const previewLimit = 200;
const validPageCount = (value) => Number.isInteger(value) && value > 0;

function PdfPage({ projectId, evidence, page, highlighted }) {
  const [status, setStatus] = useState("loading");
  return <>
    {status === "loading" && <p role="status">Loading page {page}…</p>}
    {status === "failed" ? <div className="qa-warning" role="alert">
      <p>This page could not be displayed.</p>
      <button type="button" onClick={() => setStatus("loading")}>Retry page</button>
    </div> : <div className="qa-pdf-page" aria-busy={status === "loading"}>
      <img src={contextDocumentPageUrl(projectId, evidence.version.versionId, page)}
        alt={`Original ${evidence.label}, page ${page}`} onLoad={() => setStatus("ready")} onError={() => setStatus("failed")} />
      {status === "ready" && highlighted && (evidence.locator.rectangles || []).map((rect, index) => <span key={index}
        className="qa-source-highlight" aria-hidden="true" style={{ left: `${rect.left * 100}%`, top: `${rect.top * 100}%`,
          width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />)}
    </div>}
  </>;
}

export function PdfSourceViewer({ projectId, evidence, cited, onPageChange }) {
  const [page, setPage] = useState(evidence.locator.page || 1);
  const [metadata, setMetadata] = useState(evidence.version.metadata || {});
  const [navigationError, setNavigationError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!validPageCount(evidence.version.metadata?.pageCount)) {
      setNavigationError("");
      getContextDocumentVersion(projectId, evidence.version.versionId, { signal: controller.signal }).then(({ version }) => {
        if (!controller.signal.aborted) {
          setMetadata(version.metadata || {});
          if (!validPageCount(version.metadata?.pageCount)) setNavigationError("The page count is not available yet.");
        }
      }).catch((error) => { if (!controller.signal.aborted) setNavigationError(error.message); });
    }
    return () => controller.abort();
  }, [projectId, evidence.version, refresh]);
  const total = validPageCount(metadata.pageCount) ? metadata.pageCount : null;
  const available = total ? Math.min(total, previewLimit) : Math.max(page, evidence.locator.page || 1);
  const highlighted = cited && page === evidence.locator.page;
  const coverage = Array.isArray(metadata.coverage) ? metadata.coverage : [];
  const pageCoverage = coverage.find((part) => part.page === page);
  const uncertain = (highlighted && evidence.data?.uncertain) || pageCoverage?.warnings?.some((warning) => warning.startsWith("ocr_"));
  const changePage = (value) => {
    if (Number.isInteger(value) && value >= 1 && value <= available) { setPage(value); onPageChange?.(); }
  };
  return <>
    <nav className="qa-pdf-toolbar" aria-label="PDF pages">
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => changePage(page - 1)}>Previous</button>
      <label className="qa-pdf-page-picker">Page <select aria-label="Page" value={page} onChange={(event) => changePage(Number(event.target.value))}>
        {Array.from({ length: available }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
      </select><span>of {total || "…"}</span></label>
      <button type="button" aria-label="Next page" disabled={!total || page >= available} onClick={() => changePage(page + 1)}>Next</button>
    </nav>
    {navigationError && <p className="qa-warning" role="alert">Page navigation: {navigationError} <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry page count</button></p>}
    {total > previewLimit && <p className="qa-warning">Preview is available for the first {previewLimit} of {total} pages.</p>}
    {cited && <p className="qa-pdf-citation-note">{highlighted ? (evidence.locator.rectangles?.length
      ? (evidence.kind === 'document_page' ? 'Source regions containing the read text are highlighted.' : 'Cited text is highlighted on this page.')
      : 'The source text was located to this page; an exact highlight is not available.') :
      <button type="button" onClick={() => changePage(evidence.locator.page)}>Return to cited page {evidence.locator.page}</button>}</p>}
    {uncertain && <p className="qa-warning">OCR is uncertain. Check the original page before relying on its text or numbers.</p>}
    {pageCoverage && pageCoverage.status !== "ready" && <p className="qa-warning">Searchable text is incomplete on this page. You can still inspect the original below.</p>}
    {(metadata.pageSchemaVersion === 2 || evidence.kind === 'document_page') && <PdfPageText
      key={`text:${projectId}:${evidence.version.versionId}:${page}`} projectId={projectId} versionId={evidence.version.versionId} page={page} />}
    <PdfPage key={`image:${projectId}:${evidence.version.versionId}:${page}`} projectId={projectId} evidence={evidence} page={page} highlighted={highlighted} />
    {highlighted && evidence.data?.text && <section aria-label="Cited text"><h3>Cited text</h3><blockquote className="qa-source-text">{evidence.data.text}</blockquote></section>}
    <details><summary>Source scope and warnings</summary><pre className="qa-source-text">{JSON.stringify({ coverage: metadata.coverage || evidence.coverage, warnings: metadata.warnings || evidence.warnings }, null, 2)}</pre></details>
  </>;
}
