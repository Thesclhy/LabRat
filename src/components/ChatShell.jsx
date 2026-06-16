import React from "react";

export function ChatShell({
  open = true,
  title = "the lab rat",
  context = "",
  messages = [],
  input = "",
  onInputChange,
  onSend,
  onClose,
  busy = false,
  placeholder = "Ask LabRat...",
  footerActions = null,
  className = "",
}) {
  if (!open) return null;
  return (
    <aside className={`agent open ${className}`}>
      <div className="agent-head">
        <div className="agent-title">
          <img src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="" />
          <span>{title}</span>
        </div>
        <div className="agent-head-actions">
          {onClose && <button type="button" aria-label="Close" title="Close" onClick={onClose}>&times;</button>}
        </div>
      </div>
      {context && <div className="agent-context">{context}</div>}
      <div className="messages">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`msg ${message.role}`}>
            {message.role === "assistant"
              ? <img className="msg-avatar" src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="" />
              : <span className="msg-avatar user">You</span>}
            <div className="msg-body">
              <span>{message.role === "assistant" ? title : "You"}</span>
              <p>{message.text}</p>
            </div>
          </div>
        ))}
        {busy && <div className="typing">Saving...</div>}
      </div>
      <div className="agent-foot">
        {footerActions}
        <textarea
          value={input}
          onChange={(event) => onInputChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend?.();
            }
          }}
          placeholder={placeholder}
        />
        <button type="button" className="agent-send" disabled={busy || !input.trim()} onClick={() => onSend?.()}>&#8593;</button>
      </div>
    </aside>
  );
}
