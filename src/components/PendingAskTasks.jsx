import React, { useEffect, useRef, useState } from "react";
import * as api from "../data/researchQaApi.js";

const labels = { needs_upload: "Upload needed", needs_review: "Region confirmation needed", processing: "Reference processing", unavailable: "Source unavailable", ready: "Ready" };

export function PendingAskTasks({ projectId, refreshKey, canEdit, busy, onContinue, onOpenWorkbook, onOpenReferences, onUpload }) {
  const [tasks, setTasks] = useState([]), [error, setError] = useState(""), [working, setWorking] = useState("");
  const [shown, setShown] = useState(5);
  const [expanded, setExpanded] = useState(true);
  const alive = useRef(null), callbacks = useRef({});
  const previous = useRef([]);
  callbacks.current = { onContinue, onOpenWorkbook, onUpload };
  const reloadRef = useRef(null);
  useEffect(() => {
    const controller = new AbortController(); alive.current = controller;
    let running = false;
    const reload = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        const items = []; let cursor;
        do {
          const page = await api.listAssistantTasks(projectId, { limit: 40, ...(cursor ? { cursor } : {}) }, { signal: controller.signal });
          items.push(...page.items); cursor = page.nextCursor;
        } while (cursor && items.length < 100 && !controller.signal.aborted);
        for (const old of previous.current.filter((task) => !items.some((item) => item.id === task.id))) {
          const saved = await api.getAssistantTask(projectId, old.id, { signal: controller.signal });
          if (saved.status === "submitted" && saved.runId) {
            const answer = await api.getResearchQuestion(projectId, saved.runId, { signal: controller.signal });
            if (!controller.signal.aborted) callbacks.current.onContinue?.(saved, answer);
          }
        }
        if (!controller.signal.aborted) { previous.current = items; setTasks(items); setError(""); }
      } catch (failure) {
        if (!controller.signal.aborted) {
          if ([401, 403, 404].includes(failure.status)) { previous.current = []; setTasks([]); }
          setError(`Could not refresh saved tasks: ${failure.message}`);
        }
      }
      finally { running = false; }
    };
    reloadRef.current = reload; reload();
    const timer = window.setInterval(reload, 5000);
    window.addEventListener("focus", reload);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", reload); };
  }, [projectId]);
  useEffect(() => { reloadRef.current?.(); }, [refreshKey]);
  const act = async (task, action) => {
    const controller = alive.current;
    if (working || controller?.signal.aborted) return;
    setWorking(task.id); setError("");
    try { await action(controller.signal); if (!controller.signal.aborted) await reloadRef.current?.(); }
    catch (failure) { if (!controller.signal.aborted) { setError(failure.message); await reloadRef.current?.(); setError(failure.message); } }
    finally { if (!controller.signal.aborted) setWorking(""); }
  };
  if (!tasks.length && !error) return null;
  return <section className="ask-saved-tasks" aria-label="Saved questions to continue">
    <div className="ask-saved-tasks-heading"><strong>Questions to continue · {tasks.length}</strong><div>
      <button type="button" onClick={() => reloadRef.current?.()}>Refresh</button>
      <button type="button" aria-expanded={expanded} aria-label={expanded ? "Hide pending questions" : "Show pending questions"} onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide" : "Show"}</button>
    </div></div>
    <div className="ask-saved-tasks-body" hidden={!expanded}>
    <p className="ask-saved-tasks-hint">Saved to your account. Continue here or on another device.</p>
    {error && <p role="alert">{error}</p>}
    {tasks.slice(0, shown).map((task) => <article className="ask-task" key={task.id}>
      <strong>{task.ready ? "Ready to continue" : "Waiting for files or review"}</strong>
      <p>{task.question}</p>
      {!task.referencesReady && <p>A selected reference needs attention in the library.</p>}
      <ul>{task.attachments.map((file, index) => <li key={index}>
        <span title={file.name}>{file.name}</span><small>{labels[file.state] || file.state}</small>
        {file.workbookReviewSessionId && <button type="button" onClick={() => callbacks.current.onOpenWorkbook?.(file)}>Open review</button>}
        {file.versionId && <button type="button" onClick={onOpenReferences}>Open library</button>}
        {file.state === "needs_upload" && canEdit && <label className="ask-task-upload">Choose file
          <input type="file" aria-label={`Upload missing ${file.name}`} accept={file.kind === "workbook" ? ".xlsx,.xls" : ".pdf,.doc,.docx,.txt"}
            disabled={busy || Boolean(working)} onChange={(event) => {
              const upload = event.target.files?.[0]; event.target.value = "";
              if (!upload) return;
              act(task, (signal) => callbacks.current.onUpload(task, index, upload, signal));
            }} />
        </label>}
      </li>)}</ul>
      {task.attachments.some((file) => file.state === "needs_upload") && <p className="ask-saved-tasks-hint">Files that did not finish uploading must be selected again.</p>}
      <div className="ask-task-actions">
        <button type="button" disabled={!task.ready || busy || Boolean(working)} onClick={() => act(task, async (signal) => {
          const result = await api.continueAssistantTask(projectId, task.id, { signal });
          if (!signal.aborted) callbacks.current.onContinue?.(task, result);
        })}>{working === task.id ? "Saving…" : "Continue question"}</button>
        <button type="button" disabled={busy || Boolean(working)} onClick={() => act(task, (signal) => api.cancelAssistantTask(projectId, task.id, { signal }))}>Dismiss</button>
      </div>
    </article>)}
    {tasks.length > shown && <button type="button" onClick={() => setShown((count) => count + 5)}>Show more pending questions</button>}
    </div>
  </section>;
}
