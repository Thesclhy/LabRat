import React from "react";

function statusLabel(status) {
  if (status === "accepted") return "Accepted";
  if (status === "superseded") return "Superseded";
  if (status === "awaiting_review") return "Needs review";
  return status || "Planning";
}

export function AnalysisConversationCard({ thread, revision = null, onOpen }) {
  if (!thread?.id) return null;
  const reviewable = Boolean(revision?.id);
  return (
    <article className={`analysis-conversation-card${reviewable ? " is-reviewable" : ""}`}>
      <header>
        <strong>
          {reviewable ? `Analysis plan revision ${revision.revision}` : "Analysis planning"}
        </strong>
        <span>{statusLabel(revision?.status || thread.status)}</span>
      </header>
      <p>{revision?.requestSummary || thread.originalRequest}</p>
      <small>
        {reviewable
          ? `${revision.sourceRectangles?.length || 0} source range(s)`
          : "A reviewable plan could not be drafted yet."}
      </small>
      {reviewable && (
        <button type="button" onClick={() => onOpen?.({ thread, revision })}>
          Review analysis plan
        </button>
      )}
    </article>
  );
}
