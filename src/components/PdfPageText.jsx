import React, { useEffect, useRef, useState } from 'react';
import { readContextDocumentPage } from '../data/researchQaApi.js';

const statusLabels = { ready: 'Text available', empty: 'Blank page', needs_review: 'Check recognition against the original', failed: 'Text recognition failed' };
const warningLabels = {
  ocr_check_original: 'Text was recognized from an image. Check names, symbols and numbers against the original.',
  image_text_check_original: 'This page combines a text layer and images. Check text inside the images.',
  low_contrast_check_original: 'Low contrast may affect recognition.',
  sparse_text_check_original: 'Very little text could be recognized; missing text is not evidence of absence.',
  formula_layout_check_original: 'Formula structure may be incomplete. Check the original formula.',
  unrecognized_characters: 'Some characters could not be recognized.',
  page_precision_location: 'Some passages can only be located to the page.',
};

// The parent keys this component by project, immutable version and physical page.
export function PdfPageText({ projectId, versionId, page }) {
  const [state, setState] = useState({ text: '', end: 0, nextCursor: '0', loading: true, error: '', warnings: [] });
  const [expanded, setExpanded] = useState(false);
  const lifetime = useRef(null), pending = useRef(false);
  const load = async (cursor, signal) => {
    if (pending.current === signal || signal.aborted) return;
    pending.current = signal;
    setState((old) => ({ ...old, loading: true, error: '' }));
    try {
      const result = await readContextDocumentPage(projectId, versionId, page, { cursor }, { signal });
      if (!signal.aborted) setState((old) => ({ ...result, text: cursor === '0' ? result.text : old.text + result.text, loading: false, error: '' }));
    } catch (error) {
      if (!signal.aborted) setState((old) => ({ ...old, loading: false, error: error.message }));
    } finally { if (pending.current === signal) pending.current = null; }
  };
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    load('0', controller.signal);
    return () => controller.abort();
  }, [projectId, versionId, page]);
  return <section className="qa-page-text" aria-label={`Recognized text on page ${page}`}>
    {state.status && <p className={['needs_review', 'failed'].includes(state.status) ? 'qa-warning' : ''}>{statusLabels[state.status]}</p>}
    {state.warnings.length > 0 && <ul>{state.warnings.map((code) => <li key={code}>{warningLabels[code] || 'Some page content could not be reliably recognized. Check the original.'}</li>)}</ul>}
    {state.status === 'failed' && <p>The original page is still available. Retry processing from the reference library.</p>}
    {state.loading && <p role="status">Loading recognized text…</p>}
    {state.error && <p role="alert">{state.error} <button type="button" onClick={() => load(state.nextCursor || '0', lifetime.current.signal)}>Retry text</button></p>}
    {state.text && <>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide page text' : 'Show page text'}</button>
      {expanded && <><pre className="qa-source-text">{state.text}</pre>
        <p>{state.end} of {state.totalCharacters} characters shown.</p>
        {state.nextCursor !== null && <button type="button" disabled={state.loading} onClick={() => load(state.nextCursor, lifetime.current.signal)}>Load more page text</button>}</>}
    </>}
  </section>;
}
