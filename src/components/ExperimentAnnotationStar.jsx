import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const COLORS = ["amber", "red", "green", "blue", "purple", "pink"];

export function ExperimentAnnotationStar({ row, onSave, onDelete }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(row.annotation?.note || "");
  const [color, setColor] = useState(row.annotation?.color || "amber");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    setNote(row.annotation?.note || "");
    setColor(row.annotation?.color || "amber");
  }, [row.annotation]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!popoverRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave({ note: note.trim(), color });
      setOpen(false);
    } catch (requestError) {
      setError(requestError?.message || "Annotation could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError("");
    try {
      await onDelete();
      setOpen(false);
    } catch (requestError) {
      setError(requestError?.message || "Annotation could not be removed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="experiment-annotation" ref={triggerRef}>
      <button
        type="button"
        className={`experiment-star ${row.annotation ? "is-starred" : ""}`}
        aria-label={`${row.annotation ? "Edit star for" : "Star"} ${row.label}`}
        title={row.annotation?.note || (row.annotation ? "Edit annotation" : "Star experiment")}
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 330)),
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 310)),
          });
          setOpen((current) => !current);
        }}
      >
        {row.annotation ? "★" : "☆"}
      </button>
      {open ? createPortal(
        <div ref={popoverRef} className="experiment-annotation-popover" role="dialog" aria-label={`Annotation for ${row.label}`} style={position} onClick={(event) => event.stopPropagation()}>
          <strong>{row.annotation ? "Experiment annotation" : "Star experiment"}</strong>
          <label>
            Note
            <textarea value={note} maxLength={1000} placeholder="Why does this experiment matter?" onChange={(event) => setNote(event.target.value)} />
          </label>
          <span className="experiment-annotation-color-label">Highlight</span>
          <div className="experiment-annotation-colors" role="radiogroup" aria-label="Highlight color">
            {COLORS.map((option) => (
              <button
                type="button"
                key={option}
                role="radio"
                aria-checked={color === option}
                aria-label={option}
                className={`annotation-color annotation-${option} ${color === option ? "active" : ""}`}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
          {error ? <p className="experiment-annotation-error" role="alert">{error}</p> : null}
          <div className="experiment-annotation-actions">
            {row.annotation ? <button type="button" className="annotation-remove" disabled={saving} onClick={remove}>Unstar</button> : <span />}
            <button type="button" className="primary-action" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
