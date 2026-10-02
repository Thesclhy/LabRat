import React, { useEffect, useRef, useState } from "react";
import * as api from "../data/researchQaApi.js";
import { uploadServerProjectFile } from "../data/serverApi.js";
import { ResearchEvidenceViewer } from "./ResearchEvidenceViewer.jsx";
import "./unified-ask.css";

const failureLabels = {
  document_encrypted: 'Password-protected PDF. Upload an unlocked copy.',
  document_corrupt: 'This PDF could not be opened. Check or replace the original file.',
  document_page_limit: 'The PDF exceeds the 200-page limit.',
  document_page_size: 'A page exceeds the supported rendering size.',
  document_text_limit: 'The PDF exceeds the supported text size.',
  document_cancelled: 'Reading was cancelled.',
  document_service_unavailable: 'The document reader is unavailable. Retry when it is running.',
  document_session_interrupted: 'Reading stopped after the initiating session ended. Retry to continue.',
};

export function ReferenceLibrary({ projectId, canEdit, onChanged, assistantOpen }) {
  const [page, setPage] = useState({ items: [], nextCursor: null }), [search, setSearch] = useState("");
  const [status, setStatus] = useState(""), [type, setType] = useState(""), [sort, setSort] = useState("newest");
  const [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [source, setSource] = useState(null), [versions, setVersions] = useState(null), [busy, setBusy] = useState("");
  const [notice, setNotice] = useState('');
  const input = useRef(null), target = useRef(null), lifetime = useRef(null), listRequest = useRef(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, [projectId]);
  const query = { search, status, type, sort, limit: 30 };
  useEffect(() => {
    const controller = new AbortController(); let poll;
    listRequest.current = controller;
    setLoading(true); setError(""); setPage({ items: [], nextCursor: null });
    const load = async () => {
      try {
        const response = await api.listContextDocuments(projectId, query, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setPage(response);
        if (response.items.some((item) => ["processing", "pending"].includes(item.currentVersion?.status))) poll = setTimeout(load, 2500);
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const timer = setTimeout(load, 150);
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(poll); };
  }, [projectId, search, status, type, sort, refresh]);
  const changed = () => { setRefresh((n) => n + 1); onChanged?.(); };
  const perform = async (label, action, refreshList = true) => {
    const signal = lifetime.current.signal; setBusy(label); setError(""); setNotice('');
    try { await action(signal); if (!signal.aborted && refreshList) changed(); }
    catch (failure) { if (!signal.aborted) setError(failure.message); }
    finally { if (!signal.aborted) setBusy(""); }
  };
  const upload = (event) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const document = target.current; target.current = null;
    perform(file.name, async (signal) => {
      if (!/\.(pdf|docx?|txt)$/i.test(file.name)) throw new Error("Reference files can be PDF, Word or TXT. Upload Excel through Ask for region review.");
      if (file.size > 25 * 1024 * 1024) throw new Error("The file limit is 25 MiB.");
      const uploaded = await uploadServerProjectFile(projectId, file, { signal });
      await api.registerContextDocument(projectId, uploaded.fileObject.id, { signal }, document
        ? { documentId: document.id, expectedVersion: document.version } : { newDocument: true });
    });
  };
  return <section className={`reference-library ${assistantOpen ? "with-assistant" : ""}`} aria-label="Reference library">
    <header><div><h2>Reference library</h2><p>PDF, Word and TXT for cited questions. Excel stays in Workbook Review.</p></div>
      {canEdit && <button type="button" className="reference-primary" disabled={Boolean(busy)} onClick={() => { target.current = null; input.current.click(); }}>Add reference</button>}
      <input ref={input} type="file" accept=".pdf,.doc,.docx,.txt" onChange={upload} hidden />
    </header>
    <div className="reference-filters">
      <input aria-label="Search references" placeholder="Search file names…" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label="Reference type" value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option><option value="pdf">PDF</option><option value="word">Word</option><option value="txt">TXT</option></select>
      <select aria-label="Reference status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All states</option><option value="ready">Ready</option><option value="partial">Partly readable</option><option value="processing">Processing</option><option value="failed">Failed</option></select>
      <select aria-label="Reference order" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
    </div>
    {error && <p role="alert" className="qa-warning">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && <p role="status">Working on {busy}…</p>}
    {loading && <p role="status">Loading references…</p>}
    {!loading && !page.items.length && <p className="reference-empty">{search || type || status ? "No references match these filters." : "Add your first reference, then type @ in Ask to select it."}</p>}
    <div className="reference-list">{page.items.map((item) => <article className="reference-row" key={item.document.id}>
      <div className="reference-file-name"><button type="button" title={item.document.originalName} disabled={!['ready', 'partial'].includes(item.currentVersion?.status)} onClick={() => setSource(item)}>{item.document.originalName}</button>
        <small>v{item.currentVersion?.versionNumber || 1} · {item.currentVersion?.status || "pending"} · {new Date(item.document.updatedAt).toLocaleDateString()}</small>
        {item.currentVersion?.failureCode && <small className="qa-warning">{failureLabels[item.currentVersion.failureCode] || 'Reading could not finish. Retry processing or check the original file.'}</small>}</div>
      <div className="reference-row-actions"><button type="button" onClick={() => perform("version history", async (signal) => { const data = await api.getContextDocument(projectId, item.document.id, {}, { signal }); if (!signal.aborted) setVersions(data); }, false)}>Versions</button>
        {canEdit && <><button type="button" disabled={Boolean(busy)} onClick={() => { target.current = item.document; input.current.click(); }}>New version</button>
          {/\.pdf$/i.test(item.document.originalName) && !['pending', 'processing'].includes(item.currentVersion?.status)
            && <button type="button" disabled={Boolean(busy)} title="Read the saved PDF with the current parser; preserve earlier versions and citations"
              onClick={() => perform(item.document.originalName, async (signal) => {
                const result = await api.registerContextDocument(projectId, item.currentVersion.fileObjectId, { signal },
                  { documentId: item.document.id, expectedVersion: item.document.version });
                if (!signal.aborted) setNotice(result.reused ? 'This PDF already has a version from the current reader. Use Retry for interrupted or failed processing.'
                  : 'A new version is being read from the saved PDF. Earlier versions and citations remain available.');
              })}>Reprocess PDF</button>}
          {['pending', 'processing'].includes(item.currentVersion?.status) && item.currentVersion?.processingVersion?.startsWith('labrat.pdf.pages.v1:')
            && <button type="button" disabled={Boolean(busy)} onClick={() => perform(item.document.originalName,
              (signal) => api.cancelContextDocumentVersion(projectId, item.currentVersion.id, { signal }))}>Cancel reading</button>}
          {["failed", "partial", "interrupted", "pending"].includes(item.currentVersion?.status) && <button type="button" disabled={Boolean(busy)} onClick={() => perform(item.document.originalName, (signal) => api.retryContextDocumentVersion(projectId, item.currentVersion.id, { signal }))}>Retry</button>}
          <button type="button" disabled={Boolean(busy)} title="Exclude from future questions; preserve historical citations" onClick={() => perform(item.document.originalName, (signal) => api.archiveContextDocument(projectId, item.document.id, item.document.version, { signal }))}>Archive</button></>}
      </div>
    </article>)}</div>
    {page.nextCursor && <button type="button" disabled={Boolean(busy)} onClick={() => {
      const signal = listRequest.current.signal;
      api.listContextDocuments(projectId, { ...query, cursor: page.nextCursor }, { signal }).then((next) => { if (!signal.aborted) setPage((old) => ({ items: [...old.items, ...next.items], nextCursor: next.nextCursor })); }).catch((failure) => { if (!signal.aborted) setError(failure.message); });
    }}>More references</button>}
    {versions && <section className="reference-versions" aria-label="Document versions"><header><h3>{versions.document.originalName}</h3><button type="button" onClick={() => setVersions(null)}>Close versions</button></header>
      {versions.versions.map((version) => <div key={version.id}><button type="button" disabled={!['ready', 'partial'].includes(version.status)} onClick={() => setSource({ document: versions.document, currentVersion: version })}>Version {version.versionNumber}</button><span>{version.status} · {new Date(version.createdAt).toLocaleString()}</span></div>)}
      {versions.nextCursor && <button type="button" onClick={() => perform("version history", async (signal) => { const next = await api.getContextDocument(projectId, versions.document.id, { cursor: versions.nextCursor }, { signal }); if (!signal.aborted) setVersions((old) => ({ ...next, versions: [...old.versions, ...next.versions] })); }, false)}>Older versions</button>}
    </section>}
    {source && <ResearchEvidenceViewer projectId={projectId} selection={source} onClose={() => setSource(null)} />}
  </section>;
}
