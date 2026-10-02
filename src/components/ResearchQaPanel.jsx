import React, { useEffect, useRef, useState } from "react";
import { uploadServerProjectFile, createServerWorkbookReviewSession } from "../data/serverApi.js";
import * as api from "../data/researchQaApi.js";
import { ResearchEvidenceViewer, evidenceLocation } from "./ResearchEvidenceViewer.jsx";
import "./research-qa.css";

const active = (status) => ["queued", "running"].includes(status);
const parsing = (status) => ["pending", "processing"].includes(status);
const labels = { ready: "Ready for questions", partial: "Partly readable", processing: "Reading…", pending: "Waiting to read", failed: "Failed", interrupted: "Interrupted — retry available" };
const answerStatus = { answered: "Answer from project evidence", insufficient_evidence: "The available evidence is insufficient", clarification: "More detail is needed",
  needs_analysis: "This needs a reviewed analysis plan", out_of_scope: "This request is outside source Q&A" };
const failures = { ai_unavailable: "The project model is not configured.", qa_citation_invalid: "The answer could not be supported by its sources. No unsupported answer was saved.",
  qa_provider_balance: "The configured model account has insufficient balance. A project administrator needs to restore service.",
  qa_provider_rate_limit: "The model service is rate limited. Retry later.", qa_provider_credentials: "The model service rejected its configured credentials. An administrator needs to update them.",
  qa_timeout: "The question reached its time limit.", qa_token_limit: "The question reached its model budget. Try a narrower question.",
  qa_token_count_unavailable: "The model service could not check the request size. Retry when the service is available.",
  qa_interrupted: "The service stopped before the answer was saved.", qa_request_limit: "The question reached its model request limit.",
  ai_request_failed: "The configured model could not complete the request.", qa_tool_limit: "The question reached its evidence-reading limit." };
const delay = (ms, signal) => new Promise((resolve, reject) => {
  const cancel = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
});

export function ResearchQaPanel({ open, onClose, projectId, canEdit, onWorkflow, onAnalysis, projectState, onWorkbookUploaded, onOpenWorkbook }) {
  const [expanded, setExpanded] = useState(false), [question, setQuestion] = useState("");
  const [history, setHistory] = useState({ items: [], nextCursor: null });
  const [documents, setDocuments] = useState({ items: [], nextCursor: null });
  const [selectedId, setSelectedId] = useState(""), [result, setResult] = useState(null);
  const [error, setError] = useState(""), [sending, setSending] = useState(false), [uploading, setUploading] = useState("");
  const [source, setSource] = useState(null), [refresh, setRefresh] = useState(0);
  const lifetime = useRef(null), fileInput = useRef(null), pendingRequest = useRef(null), sendingRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, [projectId]);
  const options = () => ({ signal: lifetime.current.signal });
  const failed = (failure) => { if (!lifetime.current?.signal.aborted && failure.name !== "AbortError") setError(failure.message); };
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    api.listResearchQuestions(projectId, {}, { signal: controller.signal }).then((page) => {
      if (controller.signal.aborted) return;
      setHistory(page); setSelectedId((id) => id || page.items.find((item) => active(item.status))?.runId || page.items[0]?.runId || "");
    }).catch((failure) => { if (!controller.signal.aborted) failed(failure); });
    return () => controller.abort();
  }, [open, projectId, refresh]);
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController(); let timer;
    const update = async () => {
      try {
        const page = await api.listContextDocuments(projectId, {}, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setDocuments(page);
        if (page.items.some((item) => parsing(item.currentVersion?.status))) timer = setTimeout(update, 1800);
      } catch (failure) { if (!controller.signal.aborted) failed(failure); }
    };
    update(); return () => { controller.abort(); clearTimeout(timer); };
  }, [open, projectId, refresh]);
  useEffect(() => {
    setResult(null);
    if (!selectedId || !open) return undefined;
    const controller = new AbortController(); let timer;
    const update = async () => {
      try {
        const value = await api.getResearchQuestion(projectId, selectedId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult(value);
        if (active(value.request.status)) timer = setTimeout(update, 1000);
      } catch (failure) { if (!controller.signal.aborted) failed(failure); }
    };
    update(); return () => { controller.abort(); clearTimeout(timer); };
  }, [selectedId, projectId, open, refresh]);

  const ask = async (event) => {
    event?.preventDefault();
    const text = question.trim(); if (!text || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setError("");
    if (pendingRequest.current?.question !== text) pendingRequest.current = { requestKey: `qa-${crypto.randomUUID()}`, question: text };
    try {
      const value = await api.createResearchQuestion(projectId, pendingRequest.current, options());
      if (lifetime.current.signal.aborted) return;
      pendingRequest.current = null; setQuestion(""); setSelectedId(value.request.runId); setResult(value); setRefresh((count) => count + 1);
    } catch (failure) { failed(failure); }
    finally { if (!lifetime.current.signal.aborted) { sendingRef.current = false; setSending(false); } }
  };
  const actOnQuestion = async (action) => {
    setError("");
    try { const value = await action(projectId, selectedId, options()); if (!lifetime.current.signal.aborted) { setResult(value); setRefresh((count) => count + 1); } }
    catch (failure) { failed(failure); }
  };
  const upload = async (event) => {
    const files = Array.from(event.target.files || []); event.target.value = "";
    if (!canEdit || !files.length || uploading) return;
    if (files.length > 8) { setError("Choose up to eight files per batch."); return; }
    setError("");
    const signal = lifetime.current.signal;
    try {
      for (const file of files) {
        if (!/\.(pdf|docx?|txt|xlsx?)$/i.test(file.name)) throw new Error(`${file.name}: choose PDF, Word, TXT or Excel.`);
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: the file limit is 25 MiB.`);
        setUploading(file.name);
        const uploaded = await uploadServerProjectFile(projectId, file, { signal });
        if (/\.xlsx?$/i.test(file.name)) {
          const workbook = await createServerWorkbookReviewSession(projectId, { fileObjectId: uploaded.fileObject.id }, { signal });
          signal.throwIfAborted(); await onWorkbookUploaded?.(workbook);
        } else {
          const registered = await api.registerContextDocument(projectId, uploaded.fileObject.id, { signal });
          setRefresh((count) => count + 1);
          let version = registered.version;
          while (parsing(version.status)) {
            await delay(1500, signal);
            version = (await api.getContextDocumentVersion(projectId, version.id, { signal })).version;
          }
          if (version.status === "failed") throw new Error(`${file.name} could not be read. Use Retry beside the source for another bounded attempt.`);
        }
        signal.throwIfAborted(); setRefresh((count) => count + 1);
      }
    } catch (failure) { failed(failure); }
    finally { if (!signal.aborted) { setUploading(""); setRefresh((count) => count + 1); } }
  };
  const editSource = async (item, archive = false) => {
    setError("");
    try {
      if (archive) await api.archiveContextDocument(projectId, item.document.id, item.document.version, options());
      else await api.retryContextDocumentVersion(projectId, item.currentVersion.id, options());
      if (!lifetime.current.signal.aborted) setRefresh((count) => count + 1);
    } catch (failure) { failed(failure); }
  };
  const answer = result?.artifact?.answer, running = active(result?.request?.status);
  return <>
    <aside className={`agent qa-panel ${open ? "open" : ""} ${expanded ? "expanded" : ""}`} aria-label="Ask LabRat sources">
      <div className="agent-head"><div className="agent-title"><span>Ask LabRat</span></div><div className="agent-head-actions">
        {canEdit && <button type="button" onClick={onWorkflow}>Analysis &amp; manuscript</button>}
        <button type="button" aria-label={expanded ? "Collapse source questions" : "Expand source questions"} onClick={() => setExpanded((value) => !value)}>{expanded ? "↙" : "↗"}</button>
        <button type="button" aria-label="Close Ask LabRat" onClick={onClose}>×</button></div></div>
      <p className="qa-scope">Questions use this project’s uploaded sources and accepted data. New calculations require plan review.</p>
      <details className="qa-sources"><summary>Project sources · {documents.items.length} document{documents.items.length === 1 ? "" : "s"}{documents.nextCursor ? "+" : ""}</summary>
        {canEdit && <><button type="button" disabled={Boolean(uploading)} onClick={() => fileInput.current.click()}>Upload sources</button>
          <input className="agent-file-input" ref={fileInput} type="file" multiple accept=".pdf,.doc,.docx,.txt,.xls,.xlsx" onChange={upload} aria-label="Upload PDF, Word, TXT or Excel" /></>}
        <p>PDF (including scans), Word, TXT and Excel become available after reading. Raw Excel cells do not require region confirmation for Q&amp;A.</p>
        {uploading && <p role="status">Reading {uploading}…</p>}
        {documents.items.map((item) => <div key={item.document.id} className="qa-source-row">
          <button type="button" disabled={!item.currentVersion || parsing(item.currentVersion.status)} onClick={() => setSource(item)}>{item.document.originalName}</button>
          <small>{labels[item.currentVersion?.status] || "Waiting"} · v{item.currentVersion?.versionNumber || 1}</small>
          {canEdit && ["failed", "partial", "interrupted", "pending"].includes(item.currentVersion?.status) && <button type="button" onClick={() => editSource(item)}>Retry</button>}
          {canEdit && <button type="button" title="Exclude from future questions; keep historical citations" onClick={() => editSource(item, true)}>Archive</button>}
        </div>)}
        {documents.nextCursor && <button type="button" onClick={() => api.listContextDocuments(projectId, { cursor: documents.nextCursor }, options()).then((page) => { if (!lifetime.current.signal.aborted) setDocuments((old) => ({ items: [...old.items, ...page.items], nextCursor: page.nextCursor })); }).catch(failed)}>More documents</button>}
        {(projectState?.workbookReviewSessions || []).map((item) => <div className="qa-source-row" key={item.id}>
          <button type="button" onClick={() => onOpenWorkbook?.({ workbookReviewSessionId: item.id, sourceDocumentId: item.sourceDocumentId, workbookName: item.workbookSummary?.workbookName })}>{item.workbookSummary?.workbookName || "Excel workbook"}</button><small>Raw workbook evidence available</small></div>)}
      </details>
      <div className="qa-conversation">
        {error && <p className="qa-warning" role="alert">{error}</p>}
        {history.items.length > 0 && <details><summary>My previous questions</summary>{history.items.map((item) => <button className="qa-history-item" type="button" key={item.runId} onClick={() => { setSelectedId(item.runId); setError(""); }}>{item.question}</button>)}
          {history.nextCursor && <button type="button" onClick={() => api.listResearchQuestions(projectId, { cursor: history.nextCursor }, options()).then((page) => { if (!lifetime.current.signal.aborted) setHistory((old) => ({ items: [...old.items, ...page.items], nextCursor: page.nextCursor })); }).catch(failed)}>More questions</button>}</details>}
        {!selectedId && <p>Ask what a source reports, inspect a raw cell, or read an accepted experimental value. Every factual answer links to its evidence.</p>}
        {selectedId && !result && <p role="status">Loading question…</p>}
        {result && <article className="qa-answer"><h3>{result.request.question}</h3>
          {running && <div role="status"><p>Reading evidence and checking citations…</p><button type="button" onClick={() => actOnQuestion(api.cancelResearchQuestion)}>Cancel question</button></div>}
          {result.request.status === "cancelled" && <p>Question cancelled. No answer was saved.</p>}
          {["failed", "interrupted", "queued"].includes(result.request.status) && <div><p role="alert">{failures[result.request.failureCode] || `Question ${result.request.status}. Try again or ask a narrower question.`}</p><button type="button" onClick={() => actOnQuestion(api.retryResearchQuestion)}>Retry question</button></div>}
          {answer && <><p className="qa-answer-status">{answerStatus[answer.status]}</p>
            {answer.claims.map((claim, index) => <div className="qa-claim" key={index}><p>{claim.text}</p><div className="qa-citations">{claim.citations.map((citation, i) => {
              const ref = result.artifact.evidence.find((item) => item.id === citation.evidenceId);
              return <button type="button" key={`${citation.evidenceId}-${i}`} title={citation.quote} onClick={() => setSource({ runId: result.request.runId, evidenceId: citation.evidenceId })}>{ref?.label || "Source"} · {evidenceLocation(ref)}</button>;
            })}</div></div>)}
            {answer.missingEvidence.length > 0 && <div className="qa-warning"><p>Needed to answer:</p><ul>{answer.missingEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
            {answer.status === "needs_analysis" && (canEdit ? <button type="button" onClick={() => onAnalysis?.(result.request.question)}>Prepare a reviewed analysis plan</button> : <p>An editor can prepare the analysis plan. Execution and publication require their existing permissions.</p>)}
            {answer.status === "out_of_scope" && <p>Source Q&amp;A reads uploaded evidence. Experiment diagnosis, next-parameter recommendations and publishing are not part of this feature.</p>}
            {answer.limitations?.length > 0 && <details><summary>Coverage and limitations</summary><ul>{answer.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
            <small>Saved answer · sources are fixed to the versions read for this question.</small></>}
        </article>}
      </div>
      <form className="qa-question-form" onSubmit={ask}><label htmlFor="qa-question">Question about project sources</label><textarea id="qa-question" value={question} maxLength={4000} onChange={(event) => setQuestion(event.target.value)} placeholder="What does the protocol say? What is the accepted value for Exp17?" />
        <div><small>{question.length}/4000</small><button type="submit" disabled={!question.trim() || sending || running}>{sending ? "Sending…" : "Ask with citations"}</button></div></form>
    </aside>
    {source && <ResearchEvidenceViewer projectId={projectId} selection={source} onClose={() => setSource(null)} />}
  </>;
}
