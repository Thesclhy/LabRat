import React, { useEffect, useRef, useState } from "react";
import { DEFAULT_STAR_COLOR, STAR_COLORS, getStarColor } from "../data/experimentStars.js";

function stop(event) {
  event.stopPropagation();
}

// Star toggle for an experiment row: gray when empty, colored when starred.
// Hovering a starred star previews its note; clicking opens a popover to pick a
// highlight color and edit the note.
export function StarCell({ starred, note, color = DEFAULT_STAR_COLOR, onToggle, onSaveNote, onChangeColor, label }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note || "");
  const wrapRef = useRef(null);
  const starColor = getStarColor(color);

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
      // Already starred: open the popover to recolor / edit the note.
      setEditing((value) => !value);
    } else {
      // Star it and immediately offer color + note.
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
        style={starred ? { color: starColor.star } : undefined}
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
            <span className="star-note-head-icon" aria-hidden="true" style={{ color: starColor.star }}>{"★"}</span>
            <span>{label ? `Note on ${label}` : "Note"}</span>
            <button type="button" className="star-note-close" aria-label="Close note" onClick={() => setEditing(false)}>{"×"}</button>
          </div>
          <div className="star-color-row" role="group" aria-label="Highlight color">
            {STAR_COLORS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`star-color-swatch ${color === option.id ? "active" : ""}`}
                style={{ background: option.star }}
                aria-label={option.label}
                aria-pressed={color === option.id}
                title={option.label}
                onClick={() => onChangeColor?.(option.id)}
              />
            ))}
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
