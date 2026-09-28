import React, { useEffect, useRef, useState } from "react";
import { getResearchEvidence, listContextDocumentPassages } from "../data/researchQaApi.js";
import { PdfSourceViewer } from "./PdfSourceViewer.jsx";

export function evidenceLocation(evidence) {
  const place = evidence?.locator || {};
  if (place.kind === "pdf") return `Page ${place.page}`;
  if (place.kind === "word") return `${place.part || "Document"} · paragraph ${place.paragraph}${place.table ? ` · table ${place.table}, row ${place.row}, column ${place.column}` : ""}`;
  if (place.kind === "text") return `Lines ${place.lineStart}–${place.lineEnd}`;
  if (place.sheet) return `${place.sheet}!${place.range}`;
  if (evidence?.kind === "experiment_snapshot") return `${evidence.label} · accepted snapshot`;
  return "Saved project background";
}

const display = (value) => value == null ? "Missing" : typeof value === "object" ? JSON.stringify(value) : String(value);
const kindLabels = { document_passage: "Uploaded document", workbook_raw: "Raw workbook evidence", confirmed_region: "Confirmed region interpretation",
  experiment_snapshot: "Accepted experimental data", project_context: "User-authored project background" };

function CellEvidence({ data }) {
  return <div className="qa-table-scroll"><table><thead><tr><th>Cell</th><th>Raw value</th><th>Display</th><th>Formula / source state</th></tr></thead>
    <tbody>{(data?.cells || []).map((cell) => <tr key={cell.address}><th>{cell.address}</th><td>{display(cell.rawValue)}</td><td>{display(cell.formattedValue)}</td>
      <td>{cell.formula || ""}{cell.cacheMissing ? " · no cached value" : ""}{cell.mergedRange ? ` · merged ${cell.mergedRange}` : ""}</td></tr>)}</tbody></table></div>;
}

function EvidenceBody({ evidence }) {
  if (!evidence) return null;
  const data = evidence.data || {};
  return <>
    {data.uncertain && <p className="qa-warning">OCR is uncertain. Check the original page before relying on its text or numbers.</p>}
    {data.text && <blockquote className="qa-source-text">{data.text}</blockquote>}
    {evidence.kind === "workbook_raw" && <CellEvidence data={data} />}
    {evidence.kind === "confirmed_region" && <><p>Confirmed interpretation</p><pre className="qa-source-text">{JSON.stringify(data.interpretation, null, 2)}</pre><CellEvidence data={data.raw} /></>}
    {evidence.kind === "experiment_snapshot" && <>
      <div className="qa-table-scroll"><table><thead><tr><th>Field</th><th>Stored value</th><th>Unit</th><th>Scale / missing state</th></tr></thead>
        <tbody>{(data.fields || []).map((field, index) => <tr key={field.columnId || index}><th>{field.displayName || field.fieldId || field.key}</th><td>{display(field.value)}</td><td>{field.unit || "Not recorded"}</td><td>{field.numericScale || field.missingReason || "—"}</td></tr>)}</tbody></table></div>
      {data.seriesWindow && <div className="qa-table-scroll"><p>{data.seriesWindow.seriesKey} · saved series window</p><table><thead><tr><th>x ({data.seriesWindow.xField?.unit || "unit not recorded"})</th><th>y ({data.seriesWindow.yField?.unit || "unit not recorded"})</th></tr></thead>
        <tbody>{data.seriesWindow.points.map((point, index) => <tr key={index}><td>{display(point.x)}</td><td>{display(point.y)}</td></tr>)}</tbody></table></div>}
    </>}
    {evidence.kind === "project_context" && <dl className="qa-profile">{Object.entries({ name: data.name, description: data.description, ...data.projectProfile }).filter(([key, value]) => value && !["schemaVersion", "updatedBy"].includes(key)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{display(value)}</dd></div>)}</dl>}
    <details><summary>Source scope and warnings</summary><pre className="qa-source-text">{JSON.stringify({ coverage: evidence.coverage, warnings: evidence.warnings }, null, 2)}</pre></details>
  </>;
}

export function ResearchEvidenceViewer({ projectId, selection, onClose }) {
  const dialog = useRef(null), close = useRef(null);
  const [state, setState] = useState({ loading: true, error: "", items: [], cursor: null });
  const [index, setIndex] = useState(0);
  const controller = useRef(null);
  const load = async (cursor, signal) => {
    if (selection.runId) {
      const result = await getResearchEvidence(projectId, selection.runId, selection.evidenceId, { signal });
      if (!signal.aborted) setState({ loading: false, error: "", items: [result.evidence], cursor: null });
    } else if (selection.currentVersion?.metadata?.extension === "pdf" || /\.pdf$/i.test(selection.document?.originalName || "")) {
      if (!signal.aborted) setState({ loading: false, error: "", cursor: null, items: [{ kind: "document_passage",
        label: selection.document.originalName, version: { ...selection.currentVersion, versionId: selection.currentVersion.id },
        locator: { kind: "pdf", page: 1 }, data: {}, coverage: selection.currentVersion.metadata?.coverage,
        warnings: selection.currentVersion.metadata?.warnings }] });
    } else {
      const result = await listContextDocumentPassages(projectId, selection.currentVersion.id, { ...(cursor ? { cursor } : {}), limit: 8 }, { signal });
      const items = result.items.map((passage) => ({ kind: "document_passage", label: selection.document.originalName,
        version: { ...selection.currentVersion, versionId: selection.currentVersion.id }, locator: passage.locator,
        data: { text: passage.text, ...passage.metadata }, coverage: selection.currentVersion.metadata?.coverage, warnings: selection.currentVersion.metadata?.warnings }));
      if (!signal.aborted) setState((old) => ({ loading: false, error: "", items: cursor ? [...old.items, ...items] : items, cursor: result.nextCursor }));
    }
  };
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    setIndex(0); setState({ loading: true, error: "", items: [], cursor: null });
    load(null, abort.signal).catch((error) => { if (!abort.signal.aborted) setState({ loading: false, error: error.message, items: [], cursor: null }); });
    return () => abort.abort();
  }, [projectId, selection]);
  useEffect(() => {
    const previous = document.activeElement;
    if (dialog.current?.showModal && !dialog.current.open) dialog.current.showModal();
    else dialog.current?.setAttribute("open", "");
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const evidence = state.items[index];
  return <dialog ref={dialog} className="qa-evidence-dialog" aria-labelledby="qa-evidence-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id="qa-evidence-title">{evidence?.label || selection.document?.originalName || "Source evidence"}</h2>
      {evidence && <p>{kindLabels[evidence.kind]} · {evidence.locator?.kind === "pdf" ? "PDF" : evidenceLocation(evidence)}{evidence.version?.versionNumber ? ` · version ${evidence.version.versionNumber}` : ""}</p>}</div>
      <button ref={close} type="button" aria-label="Close source evidence" onClick={onClose}>×</button></header>
    {state.loading && <p role="status">Loading the cited source…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {!state.loading && !state.error && !state.items.length && <p>No readable passages are available. Check the document processing status.</p>}
    {state.items.length > 1 && evidence?.locator?.kind !== "pdf" && <label>Passage <select value={index} onChange={(event) => setIndex(Number(event.target.value))}>{state.items.map((item, i) => <option key={i} value={i}>{evidenceLocation(item)}</option>)}</select></label>}
    {evidence?.locator?.kind === "pdf" ? <PdfSourceViewer key={`${projectId}:${evidence.version.versionId}:${evidence.id || "document"}`} projectId={projectId} evidence={evidence} cited={Boolean(selection.runId)} onPageChange={() => { if (dialog.current) dialog.current.scrollTop = 0; }} /> : <EvidenceBody evidence={evidence} />}
    {state.cursor && <button type="button" onClick={() => load(state.cursor, controller.current.signal).catch((error) => { if (!controller.current.signal.aborted) setState((old) => ({ ...old, error: error.message })); })}>Load more passages</button>}
  </dialog>;
}
