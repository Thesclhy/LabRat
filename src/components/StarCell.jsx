import React, { useEffect, useRef, useState } from "react";

function stop(event) {
  event.stopPropagation();
}

// Star toggle for an experiment row: gray when empty, gold when starred.
// Hovering a starred star previews its note; clicking opens a note editor popover.
export function StarCell({ starred, note, onToggle, onSaveNote, label }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note || "");
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!editing) return undefined;
    setDraft(note || "");
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setEditing(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setEditing(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const handleStarClick = (event) => {
    stop(event);
    if (starred) {
      // Already starred: open the note editor to view/edit.
      setEditing((value) => !value);
    } else {
      // Star it and immediately offer the note editor.
      onToggle?.();
      setEditing(true);
    }
  };

  const saveNote = () => {
    onSaveNote?.(draft);
    setEditing(false);
  };

  const unstar = () => {
    onToggle?.();
    setEditing(false);
  };

  const tooltip = starred ? (note ? note : "No note yet - click to add one") : "";

  return (
    <span className="star-cell" ref={wrapRef} onClick={stop}>
      <button
        type="button"
        className={`star-toggle ${starred ? "starred" : ""}`}
        aria-pressed={starred}
        aria-label={starred ? `Starred${label ? ` ${label}` : ""} - edit note` : `Star${label ? ` ${label}` : ""}`}
        title={editing ? "" : tooltip}
        onClick={handleStarClick}
      >
        <span aria-hidden="true">{"★"}</span>
      </button>
      {editing && (
        <div className="star-note-popover" role="dialog" aria-label="Experiment note" onClick={stop}>
          <div className="star-note-head">
            <span className="star-note-head-icon" aria-hidden="true">{"★"}</span>
            <span>{label ? `Note on ${label}` : "Note"}</span>
            <button type="button" className="star-note-close" aria-label="Close note" onClick={() => setEditing(false)}>{"×"}</button>
          </div>
          <textarea
            autoFocus
            value={draft}
            placeholder="Why does this experiment matter?"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="star-note-actions">
            <button type="button" className="star-note-unstar" onClick={unstar}>Unstar</button>
            <button type="button" className="primary" onClick={saveNote}>Save note</button>
          </div>
        </div>
      )}
    </span>
  );
}
