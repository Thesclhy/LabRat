import React from "react";

export function ThinkingIndicator({ text = "AI is thinking..." }) {
  return (
    <span className="thinking-indicator" role="status" aria-live="polite">
      <span className="thinking-spinner" aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}
