import React, { useEffect, useRef, useState } from "react";
import * as api from "../data/researchQaApi.js";
import { ResearchEvidenceViewer, evidenceLocation } from "./ResearchEvidenceViewer.jsx";

export function CitedAnswerCard({ projectId, runId, canEdit, onAnalysis, onSettled, onRunning }) {
  const [result, setResult] = useState(null), [error, setError] = useState(""), [source, setSource] = useState(null), [refresh, setRefresh] = useState(0);
  const settled = useRef(false), callback = useRef(onSettled);
  const lifetime = useRef(null), active = useRef(onRunning);
  callback.current = onSettled;
  active.current = onRunning;
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, [projectId, runId]);
  useEffect(() => {
    const controller = new AbortController(); let timer;
    setError("");
    const load = async () => {
      try {
        const response = await api.getResearchQuestion(projectId, runId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult(response);
        if (["queued", "running"].includes(response.request.status)) { active.current?.(); timer = setTimeout(load, 1200); }
        else if (!settled.current) { settled.current = true; callback.current?.(response); }
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure.message); callback.current?.(); }
      }
    };
    load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, runId, refresh]);
  const action = async (fn) => {
    const signal = lifetime.current.signal;
    try { setError(""); const response = await fn(projectId, runId, { signal }); if (signal.aborted) return; setResult(response); settled.current = false; setRefresh((n) => n + 1); }
    catch (failure) { if (!signal.aborted) setError(failure.message); }
  };
  const answer = result?.artifact?.answer, running = ["running", "queued"].includes(result?.request.status);
  return <div className="ask-cited-answer">
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh((n) => n + 1)}>Reload answer</button></div>}
    {!result && !error && <p role="status">Loading answer…</p>}
    {running && <div className="ask-task">
      <p className="ask-task-status" role="status">{result.request.status === "queued" ? "Question saved and waiting to start." : "Reading sources and checking citations…"}</p>
      <div className="ask-task-actions">{result.request.status === "queued" && <button type="button" onClick={() => action(api.retryResearchQuestion)}>Start saved question</button>}<button type="button" onClick={() => action(api.cancelResearchQuestion)}>Cancel</button></div>
    </div>}
    {result?.request.status === "cancelled" && <p>Question cancelled.</p>}
    {["failed", "interrupted"].includes(result?.request.status) && <div className="ask-task"><p role="alert">{result.request.failureCode === "qa_citation_invalid"
      ? "The answer’s citations could not be verified. Try again or narrow your question to a specific passage."
      : "The answer was not completed. Please try again."}</p><div className="ask-task-actions"><button type="button" onClick={() => action(api.retryResearchQuestion)}>Retry question</button></div><details><summary>Error details</summary>{result.request.failureCode || "Interrupted"}</details></div>}
    {answer?.claims.map((claim, i) => <div key={i} className="qa-claim"><p>{claim.text}</p><div className="qa-citations">{claim.citations.map((citation, n) => {
      const evidence = result.artifact.evidence.find((item) => item.id === citation.evidenceId);
      return <button type="button" key={n} title={`${evidence?.label || "Source"} · ${evidenceLocation(evidence)}`} onClick={() => setSource({ runId, evidenceId: citation.evidenceId })}>{evidence?.label || "Source"} · {evidenceLocation(evidence)}</button>;
    })}</div></div>)}
    {answer?.status === "needs_analysis" && <div className="ask-task"><p>This needs a reviewed analysis plan.</p>{canEdit
      ? <button type="button" onClick={() => onAnalysis(result.request.question)}>Prepare analysis plan</button>
      : <small>An editor can prepare the plan. Existing review permissions still apply.</small>}</div>}
    {answer?.status === "out_of_scope" && <p>This request is outside the current evidence Q&amp;A scope.</p>}
    {answer?.status === "insufficient_evidence" && <p>The available sources do not support a complete answer.</p>}
    {answer?.missingEvidence?.length > 0 && <ul className="ask-missing">{answer.missingEvidence.map((item, i) => <li key={i}>{item}</li>)}</ul>}
    {answer?.limitations?.length > 0 && <details><summary>Coverage and limitations</summary><ul>{answer.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
    {answer && <small className="ask-answer-note">Citations retain the source versions used for this answer.</small>}
    {source && <ResearchEvidenceViewer projectId={projectId} selection={source} onClose={() => setSource(null)} />}
  </div>;
}
