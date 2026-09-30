import React, { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { readWorkspaceRoute } from "./workspaceRoutes.jsx";

export function useUnsavedNavigation({ dirty, projectId, save, discard }) {
  const bypass = useRef(false);
  const actionRef = useRef(null);
  const generation = useRef(0);
  const [actionPending, setActionPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocker = useBlocker(useCallback(({ nextLocation }) => (
    !bypass.current && dirty && readWorkspaceRoute(nextLocation.pathname).projectId !== projectId
  ), [dirty, projectId]));
  const blocked = blocker.state === "blocked";
  const open = blocked || actionPending;
  const cancel = () => {
    generation.current += 1;
    if (blocked) blocker.reset();
    actionRef.current = null;
    setActionPending(false); setBusy(false); setError("");
  };
  const force = (action) => {
    cancel();
    bypass.current = true;
    action();
  };
  useEffect(() => { if (!dirty) bypass.current = false; }, [dirty, projectId]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const run = (action) => {
    if (busy || open) return;
    if (!dirty) { action(); return; }
    actionRef.current = action; setActionPending(true); setError("");
  };
  const leave = async (shouldSave) => {
    const version = ++generation.current;
    setBusy(true); setError("");
    try {
      if (shouldSave && !(await save())) throw new Error("Your changes could not be saved. Please retry or stay on this page.");
      if (version !== generation.current) return;
      if (!shouldSave) discard();
      const action = actionRef.current;
      actionRef.current = null; setActionPending(false); setBusy(false);
      if (blocked) blocker.proceed();
      else { bypass.current = true; action?.(); }
    } catch (err) {
      if (version === generation.current) { setBusy(false); setError(err.message); }
    }
  };
  const stayRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    stayRef.current?.focus();
    return () => previous?.isConnected && previous.focus?.();
  }, [open]);
  const dialog = open ? (
    <div className="modal-backdrop unsaved-navigation-backdrop" onKeyDown={(event) => {
      if (event.key === "Escape" && !busy) { event.stopPropagation(); cancel(); }
      if (event.key === "Tab") {
        const buttons = [...event.currentTarget.querySelectorAll("button:not(:disabled)")];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <section className="modal unsaved-navigation" role="dialog" aria-modal="true" aria-labelledby="unsaved-navigation-title">
        <h2 id="unsaved-navigation-title">Save your changes?</h2>
        <p>This project has unsaved manuscript changes.</p>
        {error && <p role="alert">{error}</p>}
        <div className="unsaved-navigation-actions">
          <button ref={stayRef} disabled={busy} onClick={cancel}>Stay here</button>
          <button disabled={busy} onClick={() => leave(false)}>Discard and leave</button>
          <button className="primary" disabled={busy} onClick={() => leave(true)}>{busy ? "Saving..." : "Save and leave"}</button>
        </div>
      </section>
    </div>
  ) : null;
  return { run, force, dialog };
}
