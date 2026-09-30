import React, { useEffect, useId, useRef, useState } from "react";
import { listContextDocuments } from "../data/researchQaApi.js";

export function ReferenceMentionComposer({ projectId, value, onChange, references, onReferencesChange, onSend, onAttach,
  disabled, canAttach, context, attachments, inputRef: suppliedRef }) {
  const localRef = useRef(null), inputRef = suppliedRef || localRef;
  const listId = useId();
  const [mention, setMention] = useState(null), [items, setItems] = useState([]), [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const composing = useRef(false);
  useEffect(() => {
    if (!mention) return undefined;
    const controller = new AbortController();
    setLoading(true); setError(""); setIndex(0);
    const timer = setTimeout(() => {
      listContextDocuments(projectId, { search: mention.query, limit: 20 }, { signal: controller.signal })
        .then((page) => { if (!controller.signal.aborted) setItems(page.items); })
        .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 160);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [projectId, mention?.query, Boolean(mention)]);
  const updateMention = (text, caret) => {
    const match = text.slice(0, caret).match(/(?:^|\s)@([^@\n]{0,100})$/u);
    setMention(match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null);
  };
  const choose = (item) => {
    if (!mention || !["ready", "partial"].includes(item.currentVersion?.status) || references.length >= 8) return;
    const reference = { documentId: item.document.id, versionId: item.currentVersion.id,
      label: item.document.originalName, versionNumber: item.currentVersion.versionNumber };
    if (!references.some((ref) => ref.versionId === reference.versionId)) onReferencesChange([...references, reference]);
    const position = mention.start;
    onChange(value.slice(0, position) + value.slice(mention.end)); setMention(null);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(position, position); });
  };
  return <div className="ask-composer">
    {context}
    {references.length > 0 && <div className="ask-mentions" aria-label="Selected references">
      {(showAll ? references : references.slice(0, 2)).map((ref) => <span className="ask-mention" key={ref.versionId} title={`${ref.label} · v${ref.versionNumber}`}>
        <span>@{ref.label}</span><button type="button" disabled={disabled} aria-label={`Remove ${ref.label}`} onClick={() => onReferencesChange(references.filter((item) => item.versionId !== ref.versionId))}>×</button>
      </span>)}
      {references.length > 2 && <button type="button" className="ask-more-references" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `+${references.length - 2} references`}</button>}
      <small>{/(?:仅|只)(?:根据|使用|参考|用)|\bonly\s+(?:use|using|from|based on)\b|\bbased\s+(?:only|solely)\s+on\b/i.test(value) ? "Only selected references for this question." : "Selected references first; other project evidence when needed."}</small>
    </div>}
    {attachments}
    <textarea ref={inputRef} value={value} maxLength={4000} disabled={disabled} aria-label="Ask LabRat"
      aria-autocomplete="list" aria-controls={mention ? listId : undefined} aria-expanded={Boolean(mention)}
      aria-activedescendant={mention && items[index] ? `${listId}-${index}` : undefined}
      placeholder="Ask about your research. Type @ to select a reference…"
      onChange={(event) => { onChange(event.target.value); if (!composing.current) updateMention(event.target.value, event.target.selectionStart); }}
      onCompositionStart={() => { composing.current = true; setMention(null); }}
      onCompositionEnd={(event) => { composing.current = false; updateMention(event.currentTarget.value, event.currentTarget.selectionStart); }}
      onClick={(event) => updateMention(value, event.currentTarget.selectionStart)}
      onBlur={() => setMention(null)}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (mention) {
          if (event.key === "Escape") { event.preventDefault(); setMention(null); }
          else if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setIndex((old) => Math.max(0, Math.min(items.length - 1, old + (event.key === "ArrowDown" ? 1 : -1)))); }
          else if (event.key === "Enter") { event.preventDefault(); if (!loading && items[index]) choose(items[index]); }
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); }
      }} />
    {mention && <div className="ask-mention-picker" id={listId} role="listbox" aria-label="Project references">
      {loading && <p role="status">Finding references…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !items.length && <p>No matching references. Add PDF, Word or TXT with +.</p>}
      {!loading && items.map((item, i) => {
        const ready = ["ready", "partial"].includes(item.currentVersion?.status);
        return <button type="button" role="option" id={`${listId}-${i}`} key={item.document.id} aria-selected={i === index}
          aria-disabled={!ready || references.length >= 8} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
          <span>{item.document.originalName}</span><small>v{item.currentVersion?.versionNumber || 1} · {item.currentVersion?.status || "pending"} · {new Date(item.document.updatedAt).toLocaleDateString()}</small>
        </button>;
      })}
      {references.length >= 8 && <p>Select up to eight references per question.</p>}
    </div>}
    <div className="ask-composer-tools">
      {canAttach && <button type="button" className="ask-attach" aria-label="Add files" disabled={disabled} onClick={onAttach}>+</button>}
      <span className="ask-input-hint">@ references · Shift + Enter for a new line</span>
      <button type="button" className="ask-send" aria-label="Send message" disabled={disabled} onClick={onSend}>↑</button>
    </div>
  </div>;
}
