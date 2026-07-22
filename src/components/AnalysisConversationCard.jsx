import React from "react";

function statusLabel(status) {
  if (status === "accepted") return "Accepted";
  if (status === "superseded") return "Superseded";
  if (status === "awaiting_review") return "Needs review";
  return status || "Planning";
}

export function AnalysisConversationCard({
  thread,
  revision = null,
  run = null,
  result = null,
  modelAvailable = true,
  retrying = false,
  onRetry,
  onOpen,
}) {
  if (!thread?.id) return null;
  const reviewable = Boolean(revision?.id);
  const resultReady = run?.status === "awaiting_result_review" && result?.status === "awaiting_review";
  const actionLabel = resultReady ? "Review analysis result" : "Review analysis plan";
  const canRetry = thread.status === "analysis_evidence_required" && !reviewable && typeof onRetry === "function";
  return (
    <article className={`analysis-conversation-card${reviewable ? " is-reviewable" : ""}`}>
      <header>
        <strong>
          {reviewable ? `Analysis plan revision ${revision.revision}` : "Analysis planning"}
        </strong>
        <span>{resultReady ? "Result ready" : statusLabel(revision?.status || thread.status)}</span>
      </header>
      <p>{revision?.requestSummary || thread.originalRequest}</p>
      <small>
        {resultReady
          ? `${result.rowCount || 0} result row(s), ${result.traceCount || 0} trace(s)`
          : reviewable
          ? `${revision.sourceRectangles?.length || 0} source range(s)`
          : "A reviewable plan could not be drafted yet."}
      </small>
      {reviewable && (
        <button
          type="button"
          onClick={() => onOpen?.({
            thread,
            revision,
            ...(run ? { run } : {}),
            ...(result ? { result } : {}),
          })}
        >
          {actionLabel}
        </button>
      )}
      {canRetry && (
        <div className="analysis-conversation-retry">
          <button
            type="button"
            onClick={() => onRetry(thread)}
            disabled={modelAvailable === false || retrying}
          >
            {retrying ? "Retrying..." : "Retry with published data"}
          </button>
          {modelAvailable === false && <small>Model planning is unavailable.</small>}
        </div>
      )}
    </article>
  );
}
