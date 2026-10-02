import React from "react";
import { evidenceLocation } from "./ResearchEvidenceViewer.jsx";

const toolLabels = {
  search_project_documents: 'Search project sources', find_experiments: 'Find experiment',
  read_document_passage: 'Read passage', read_document_page: 'Read page text', read_experiment_evidence: 'Read accepted data',
  read_confirmed_region_evidence: 'Read confirmed cells', get_project_context: 'Read project background',
};
function sourceKey(item) {
  const v = item.version || {};
  if (['document_passage', 'document_page'].includes(item.kind)) return ['document', v.documentId, v.versionId].join(':');
  if (item.kind === 'experiment_snapshot') return ['experiment', v.experimentId, v.snapshotId].join(':');
  if (v.sourceDocumentId) return ['workbook', v.sourceDocumentId, v.indexVersion, v.contentHash].join(':');
  return [item.kind, v.projectId, v.contentHash || item.id].join(':');
}

function SourceWindows({ items, onOpen }) {
  const pages = new Map();
  for (const item of items) {
    const key = item.locator?.kind === 'pdf' ? `page-${item.locator.page}` : item.id;
    if (!pages.has(key)) pages.set(key, []);
    pages.get(key).push(item);
  }
  return [...pages.entries()].map(([key, windows]) => windows.length === 1
    ? <button type="button" key={key} title={(windows[0].label || 'Source') + ' · ' + windowLabel(windows[0])}
      onClick={() => onOpen(windows[0].id)}>{windowLabel(windows[0])}</button>
    : <details className="ask-page-windows" key={key}><summary>{windowLabel(windows[0])} · {windows.length} passages</summary>
      {windows.map((item, index) => <button type="button" key={item.id} onClick={() => onOpen(item.id)}
        title={`Open passage ${index + 1} on page ${item.locator.page}`}>Passage {index + 1}</button>)}</details>);
}
function windowLabel(item) {
  if (item.kind === 'experiment_snapshot') {
    const p = item.locator || {};
    return p.seriesKey ? p.seriesKey + ' · points from ' + ((p.pointOffset || 0) + 1)
      : 'Accepted fields from ' + ((p.fieldOffset || 0) + 1);
  }
  return evidenceLocation(item);
}

export function SourcesRead({ artifact, onOpen }) {
  const evidence = artifact.evidence || [], trace = artifact.trace || [];
  const completeTrace = artifact.answer?.provenanceVersion === 2;
  const groups = new Map();
  for (const item of evidence) {
    const key = sourceKey(item);
    if (!groups.has(key)) groups.set(key, { key, label: item.label, version: item.version, items: [] });
    groups.get(key).items.push(item);
  }
  if (!evidence.length && !trace.length) return null;
  return <details className="ask-sources-read">
    <summary>{completeTrace ? 'Sources read' : 'Saved sources'} · {groups.size}</summary>
    <p className="ask-sources-scope">{completeTrace
      ? 'Only the listed passages and data windows were read. Open a source to check its original content.'
      : 'This earlier answer saved its cited sources; a complete reading record is not available.'}</p>
    {!evidence.length && <p>No source passages or data windows were read.</p>}
    {[...groups.values()].map((group) => <div className="ask-source-group" key={group.key}>
      <div className="ask-source-heading"><strong>{group.label || 'Source'}</strong>
        {group.version?.versionNumber != null && <span>v{group.version.versionNumber}</span>}</div>
      <div className="ask-source-windows"><SourceWindows items={group.items} onOpen={onOpen} /></div>
    </div>)}
    {trace.length > 0 && <details className="ask-read-activity"><summary>Search and read activity</summary>
      <ol>{trace.map((entry, index) => <li key={index}>
        <span>{toolLabels[entry.tool] || 'Source lookup'}{entry.input?.query ? ' · “' + entry.input.query + '”' : ''}</span>
        <small>{entry.status !== 'ok' ? 'Could not complete: ' + entry.status
          : entry.phase === 'discovery' ? (entry.returnedCount || 0) + ' matches · search only'
          : Array.isArray(entry.evidenceIds) ? entry.evidenceIds.length + ' evidence windows read'
          : 'Completed · earlier record'}</small>
      </li>)}</ol>
    </details>}
  </details>;
}
