import React, { useEffect, useMemo, useState } from "react";
import { useWorkspacePermissions } from "./WorkspacePermissions.jsx";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function regionLabel(region) {
  return `${region?.sheetName || "Sheet"}!${region?.rangeRef || region?.range || "n/a"}`;
}

function statusLabel(region) {
  if (region?.disposition === "ignored") return "Ignored";
  if (region?.reviewStatus === "interpreting") return "Interpreting";
  if (region?.reviewStatus === "interpretation_failed") return "Needs retry";
  if (region?.acceptedRevisionId === region?.currentRevisionId && region?.acceptedRevisionId) return "Confirmed";
  if (region?.acceptedRevisionId) return "New revision";
  return "Review";
}

function RegionReviewCard({
  region,
  active,
  onActivate,
  onRevise,
  onConfirm,
  onRetry,
  onIgnore,
  onDelete,
}) {
  const revision = region.currentRevision || null;
  const { canEdit, canApprove } = useWorkspacePermissions();
  const label = regionLabel(region);
  const [feedback, setFeedback] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const blockers = asArray(revision?.validation?.blockers);
  const warnings = [...asArray(region.warnings), ...asArray(revision?.warnings)];
  const hasAcceptedRevision = Boolean(region.acceptedRevisionId);
  const confirmed = Boolean(hasAcceptedRevision && region.acceptedRevisionId === revision?.id);
  const activeDisposition = region.disposition === "active";
  const interpreting = region.reviewStatus === "interpreting";
  const busy = Boolean(pendingAction);

  useEffect(() => {
    setActionError("");
  }, [revision?.id, region.version]);

  const run = async (action, callback) => {
    if (action === "confirm" ? !canApprove : !canEdit) return;
    if (busy || !callback) return;
    setPendingAction(action);
    setActionError("");
    try {
      await callback();
      if (action === "revise") setFeedback("");
    } catch (error) {
      setActionError(error?.message || String(error));
    } finally {
      setPendingAction("");
    }
  };

  const deleteRegion = () => {
    if (hasAcceptedRevision && !window.confirm(`Delete the confirmed region ${label}? Existing source history and downstream artifacts will be retained.`)) {
      return;
    }
    run("delete", () => onDelete?.(region.id, {
      expectedRegionVersion: region.version,
      reason: "Deleted during workbook review.",
    }));
  };

  return (
    <article
      role="article"
      aria-label={`Region ${label}`}
      className={`workbook-region-card${active ? " is-active" : ""}${confirmed ? " is-confirmed" : ""}${!activeDisposition ? " is-muted" : ""}`}
    >
      <header className="workbook-region-card-head">
        <button type="button" className="workbook-region-focus" aria-label={`Focus ${label}`} onClick={() => onActivate?.(region.id)}>
          <strong>{region.rangeRef || region.range || "n/a"}</strong>
          <span>{region.sheetName || "Sheet"}</span>
        </button>
        <span className={`workbook-region-status is-${String(statusLabel(region)).toLowerCase().replace(/\s+/g, "-")}`}>
          {statusLabel(region)}
        </span>
      </header>

      <div className="workbook-region-summary" aria-label={`AI summary for ${label}`} aria-live="polite">
        {interpreting ? (
          <div className="workbook-region-interpreting" role="status">
            <span className="thinking-spinner" aria-hidden="true" />
            <span>AI is understanding this region...</span>
          </div>
        ) : asArray(revision?.summary).length ? asArray(revision.summary).map((sentence, index) => (
          <p key={`${revision.id}-summary-${index}`}>{sentence}</p>
        )) : (
          <p>{region.reviewStatus === "interpretation_failed" ? "The backend model could not interpret this region." : "Interpretation is pending."}</p>
        )}
      </div>

      <div className="workbook-region-meta">
        {revision?.confidence != null && <span>{Math.round(Number(revision.confidence) * 100)}% structure confidence</span>}
        <span>{interpreting ? "AI interpretation pending" : revision ? `Revision ${revision.revisionNumber || 1}` : "No revision"}</span>
      </div>

      {!![...blockers, ...warnings].length && (
        <div className="workbook-region-notices" aria-label={`Notices for ${label}`}>
          {[...blockers, ...warnings].map((notice, index) => (
            <p key={`${notice.code || "notice"}-${index}`}>{notice.message || notice.code || String(notice)}</p>
          ))}
        </div>
      )}

      {activeDisposition && (
        <>
          {!interpreting && (
            <>
              <textarea
                className="workbook-region-feedback"
                value={feedback}
                disabled={!canEdit || busy}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="Describe what this region means or what should change..."
                aria-label={`Feedback for ${label}`}
                rows={3}
              />
              <div className="workbook-region-primary-actions">
                <button
                  type="button"
                  aria-label={`Submit revision for ${label}`}
                  disabled={!canEdit || busy || !feedback.trim() || !onRevise}
                  onClick={() => run("revise", () => onRevise(region.id, {
                    feedback: feedback.trim(),
                    previousRevisionId: revision?.id || null,
                    expectedRegionVersion: region.version,
                  }))}
                >
                  {pendingAction === "revise" ? "Submitting..." : "Submit revision"}
                </button>
                <button
                  type="button"
                  className="primary"
                  aria-label={confirmed ? `Region ${label} confirmed` : `Confirm region ${label}`}
                  disabled={!canApprove || busy || confirmed || !revision || blockers.length > 0 || !onConfirm}
                  onClick={() => run("confirm", () => onConfirm(region.id, {
                    revisionId: revision.id,
                    expectedRegionVersion: region.version,
                  }))}
                >
                  {pendingAction === "confirm" ? "Confirming..." : confirmed ? "Confirmed" : "Confirm region"}
                </button>
              </div>
            </>
          )}
          <div className="workbook-region-secondary-actions">
            {region.reviewStatus === "interpretation_failed" && (
              <button
                type="button"
                aria-label={`Retry AI for ${label}`}
                disabled={!canEdit || busy || !onRetry}
                onClick={() => run("retry", () => onRetry?.(region.id))}
              >
                {pendingAction === "retry" ? "Retrying..." : "Retry AI"}
              </button>
            )}
            <button
              type="button"
              aria-label={`Ignore region ${label}`}
              disabled={!canEdit || busy || !onIgnore}
              onClick={() => run("ignore", () => onIgnore(region.id, {
                expectedRegionVersion: region.version,
                reason: "Excluded during workbook review.",
              }))}
            >
              Ignore
            </button>
            <button type="button" aria-label={`Delete region ${label}`} disabled={!canEdit || busy || !onDelete} onClick={deleteRegion}>
              {pendingAction === "delete" ? "Deleting..." : "Delete"}
            </button>
          </div>
        </>
      )}

      {actionError && <p className="workbook-region-error" role="alert">{actionError}</p>}
    </article>
  );
}

export function WorkbookReviewDock({
  reviewState = {},
  reviewRegions = [],
  activeRegionId = "",
  onActiveRegionChange,
  onReviseRegion,
  onConfirmRegion,
  onRetryRegion,
  onIgnoreRegion,
  onDeleteRegion,
  onReviewExtractedExperiments,
}) {
  const session = reviewState.session || reviewState.workbookReviewSession || null;
  const regions = asArray(reviewRegions).filter((region) => region?.disposition !== "deleted");
  const fallbackActiveId = regions.find((region) => region.disposition === "active")?.id || regions[0]?.id || "";
  const resolvedActiveId = regions.some((region) => region.id === activeRegionId) ? activeRegionId : fallbackActiveId;
  const acceptedCount = useMemo(() => regions.filter((region) => (
    region.disposition === "active" && Boolean(region.acceptedRevisionId)
  )).length, [regions]);
  const workbookName = reviewState.sourceDocument?.metadata?.workbookName
    || session?.workbookSummary?.workbookName
    || "Workbook review";

  return (
    <aside className="workbook-review-chat" aria-label="Workbook review dock">
      <header className="workbook-review-chat-head">
        <div>
          <h3>{workbookName}</h3>
          <small>{regions.length} regions / {acceptedCount} confirmed</small>
        </div>
      </header>

      <div className="workbook-review-messages" aria-label="Workbook review conversation">
        <article className="chat-msg">
          <span>LabRat</span>
          <p>I identified {regions.length} source region{regions.length === 1 ? "" : "s"} in this workbook.</p>
        </article>
      </div>

      {reviewState.revisionError && <p className="workbook-region-error" role="alert">{reviewState.revisionError}</p>}

      <section className="workbook-region-list" aria-label="Workbook regions">
        {regions.map((region) => (
          <RegionReviewCard
            key={region.id}
            region={region}
            active={region.id === resolvedActiveId}
            onActivate={onActiveRegionChange}
            onRevise={onReviseRegion}
            onConfirm={onConfirmRegion}
            onRetry={onRetryRegion}
            onIgnore={onIgnoreRegion}
            onDelete={onDeleteRegion}
          />
        ))}
        {!regions.length && <p className="workbook-region-empty">No source regions are available.</p>}
      </section>

      {acceptedCount > 0 && onReviewExtractedExperiments && (
        <div className="workbook-review-next-step">
          <span>{acceptedCount} confirmed region{acceptedCount === 1 ? "" : "s"}</span>
          <button type="button" className="primary" onClick={onReviewExtractedExperiments}>
            Review extracted experiments
          </button>
        </div>
      )}
    </aside>
  );
}
