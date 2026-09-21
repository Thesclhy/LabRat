import React, { useEffect, useState } from "react";

function loggedLine(entry) {
  const who = entry?.createdByName || "a lab member";
  const when = entry?.createdAt ? new Date(entry.createdAt).toLocaleString() : "";
  return `Manually logged by ${who}${when ? ` on ${when}` : ""}.`;
}

/**
 * Detail drawer for a manually logged Experiment Browser row. A manual row has
 * no DataSnapshot, so there is no source-backed detail to load; the drawer only
 * edits the row's own name and note.
 */
export function ManualExperimentDrawer({ row, editable = false, onSave, onDelete, onClose }) {
  const [label, setLabel] = useState(row.label || "");
  const [note, setNote] = useState(row.manualEntry?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setLabel(row.label || "");
    setNote(row.manualEntry?.note || "");
  }, [row.experimentId, row.label, row.manualEntry?.note]);
  useEffect(() => {
    setError("");
    setConfirmingDelete(false);
  }, [row.experimentId]);

  const trimmedLabel = label.trim();
  const changed = trimmedLabel !== (row.label || "") || note !== (row.manualEntry?.note || "");

  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (requestError) { setError(requestError?.message || "The row could not be updated."); }
    finally { setBusy(false); }
  };

  return (
    <aside className="experiment-detail-drawer" aria-label="Manually added experiment">
      <header className="experiment-detail-head">
        <div>
          <span className="experiment-detail-kicker">Manually added row</span>
          <h2>{row.label}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close experiment detail" title="Close" onClick={onClose}>x</button>
      </header>
      <div className="experiment-detail-body">
        <section className="experiment-detail-section">
          <p className="browser-muted">{loggedLine(row.manualEntry)} It has no workbook source, so it is not used for charts or analysis. Click any of its cells in the table to fill them in.</p>
        </section>
        <form
          className="experiment-detail-section manual-experiment-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editable || !trimmedLabel || !changed) return;
            run(() => onSave({ label: trimmedLabel, note }));
          }}
        >
          <label>
            Experiment name
            <input value={label} maxLength={200} disabled={!editable || busy} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label>
            Note
            <textarea value={note} maxLength={2000} rows={5} disabled={!editable || busy} onChange={(event) => setNote(event.target.value)} />
          </label>
          {error && <p className="browser-error" role="alert">{error}</p>}
          {editable ? (
            <div className="manual-experiment-actions">
              <button type="submit" className="primary" disabled={busy || !trimmedLabel || !changed}>Save changes</button>
              {confirmingDelete ? (
                <>
                  <span>Delete this row and its custom values?</span>
                  <button type="button" disabled={busy} onClick={() => run(onDelete)}>Confirm delete</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmingDelete(false)}>Cancel</button>
                </>
              ) : <button type="button" disabled={busy} onClick={() => setConfirmingDelete(true)}>Delete row</button>}
            </div>
          ) : <p className="browser-muted">You have view access, so this row is read-only.</p>}
        </form>
      </div>
    </aside>
  );
}
