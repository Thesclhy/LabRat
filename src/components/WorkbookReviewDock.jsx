import React, { useEffect, useMemo, useState } from "react";

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

const CELL_CLASS_LABELS = [
  ["terminal", "result", "results"],
  ["intermediate", "intermediate", "intermediate"],
  ["input", "input", "inputs"],
  ["constant", "label or unused value", "labels or unused values"],
];

export function cellClassSummaryChips(summary) {
  if (!summary || typeof summary !== "object") return [];
  return CELL_CLASS_LABELS
    .map(([key, singular, plural]) => {
      const count = Number(summary[key]) || 0;
      if (!count) return null;
      return { key, count, text: `${count} ${count === 1 ? singular : plural}` };
    })
    .filter(Boolean);
}

function seriesPreviewText(series) {
  const points = Number(series?.pointCount);
  const pointText = Number.isFinite(points) && points > 0 ? `${points} points` : "points from the header row";
  const x = series?.xSemanticKey ? series.xSemanticKey.replace(/_/g, " ") : "categories";
  const y = series?.yUnit ? `in ${series.yUnit}` : "unit not set";
  return `${series?.label || series?.seriesKey || "Series"}: ${pointText}, x = ${x} (${series?.xHeaderRange || "header row"}), y ${y} (${series?.yValueRange || "value row"})`;
}

function RegionReviewCard({
  region,
  active,
  calculationOverlayActive = false,
  calculationOverlayState = null,
  onActivate,
  onRevise,
  onConfirm,
  onRetry,
  onIgnore,
  onDelete,
  onToggleCalculationOverlay,
  onSaveExtractionTemplate,
  existingTemplate = null,
}) {
  const revision = region.currentRevision || null;
  const label = regionLabel(region);
  const [feedback, setFeedback] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [templateNaming, setTemplateNaming] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savedTemplateName, setSavedTemplateName] = useState("");
  const blockers = asArray(revision?.validation?.blockers);
  const warnings = [...asArray(region.warnings), ...asArray(revision?.warnings)]
    .filter((notice, index, all) => all.findIndex((candidate) => (candidate?.code || candidate?.message) === (notice?.code || notice?.message)) === index);
  const hasAcceptedRevision = Boolean(region.acceptedRevisionId);
  const confirmed = Boolean(hasAcceptedRevision && region.acceptedRevisionId === revision?.id);
  const activeDisposition = region.disposition === "active";
  const interpreting = region.reviewStatus === "interpreting";
  const busy = Boolean(pendingAction);
  const provenance = revision?.interpretation?.provenance || null;
  const classChips = cellClassSummaryChips(provenance?.cellClassSummary);
  const headerRowSeries = asArray(revision?.interpretation?.series)
    .filter((series) => series?.orientation === "header_row_categories");
  const brokenCells = asArray(provenance?.brokenCells);

  useEffect(() => {
    setActionError("");
  }, [revision?.id, region.version]);

  const run = async (action, callback) => {
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

  const saveExtractionTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    run("save_template", async () => {
      const saved = await onSaveExtractionTemplate?.(region, { name });
      setSavedTemplateName(saved?.regionExtractionTemplate?.name || saved?.name || name);
      setTemplateNaming(false);
      setTemplateName("");
    });
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

      {!!headerRowSeries.length && (
        <div className="workbook-region-series" aria-label={`Series in ${label}`}>
          {headerRowSeries.map((series, index) => (
            <p key={`${series.seriesKey || "series"}-${index}`}>{seriesPreviewText(series)}</p>
          ))}
        </div>
      )}

      {provenance?.cellClassSummary && (
        <section className="workbook-region-calculation" aria-label={`Calculation provenance for ${label}`}>
          <div className="workbook-region-class-summary">
            {classChips.map((chip) => (
              <span key={chip.key} className={`workbook-region-class-chip is-${chip.key}`}>{chip.text}</span>
            ))}
            {onToggleCalculationOverlay && (
              <button
                type="button"
                className="workbook-region-calculation-toggle"
                aria-pressed={calculationOverlayActive}
                aria-label={`${calculationOverlayActive ? "Hide" : "Show"} calculation for ${label}`}
                disabled={Boolean(calculationOverlayActive && calculationOverlayState?.loading)}
                onClick={() => onToggleCalculationOverlay(region)}
              >
                {calculationOverlayActive
                  ? (calculationOverlayState?.loading ? "Loading calculation" : "Hide calculation")
                  : "Show calculation"}
              </button>
            )}
          </div>
          {provenance.derivation && <p className="workbook-region-derivation">{provenance.derivation}</p>}
          {!!brokenCells.length && (
            <p className="workbook-region-broken-cells">
              Typed over formulas: {brokenCells.slice(0, 6).map((item) => item.address).join(", ")}{brokenCells.length > 6 ? ` and ${brokenCells.length - 6} more` : ""}
            </p>
          )}
          {calculationOverlayActive && calculationOverlayState?.error && (
            <p className="workbook-region-error" role="alert">{calculationOverlayState.error}</p>
          )}
        </section>
      )}

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
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="Describe what this region means or what should change..."
                aria-label={`Feedback for ${label}`}
                rows={3}
              />
              <div className="workbook-region-primary-actions">
                <button
                  type="button"
                  aria-label={`Submit revision for ${label}`}
                  disabled={busy || !feedback.trim() || !onRevise}
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
                  disabled={busy || confirmed || !revision || blockers.length > 0 || !onConfirm}
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
          {confirmed && onSaveExtractionTemplate && (
            <div className="workbook-region-template" aria-label={`Extraction template for ${label}`}>
              {existingTemplate || savedTemplateName ? (
                <p className="workbook-region-template-note">
                  Extraction template: <strong>{existingTemplate?.name || savedTemplateName}</strong>
                  {existingTemplate?.currentVersion ? ` (v${existingTemplate.currentVersion})` : ""}
                </p>
              ) : templateNaming ? (
                <div className="workbook-region-template-form">
                  <label htmlFor={`extraction-template-name-${region.id}`}>Template name</label>
                  <input
                    id={`extraction-template-name-${region.id}`}
                    type="text"
                    value={templateName}
                    maxLength={120}
                    placeholder="Carbon distribution from calculation sheet"
                    onChange={(event) => setTemplateName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveExtractionTemplate();
                      }
                    }}
                  />
                  <div className="workbook-region-template-form-actions">
                    <button type="button" className="primary" disabled={busy || !templateName.trim()} onClick={saveExtractionTemplate}>
                      {pendingAction === "save_template" ? "Saving..." : "Save template"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => { setTemplateNaming(false); setTemplateName(""); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Save ${label} as extraction template`}
                  disabled={busy}
                  onClick={() => setTemplateNaming(true)}
                >
                  Save as extraction template
                </button>
              )}
            </div>
          )}
          <div className="workbook-region-secondary-actions">
            {region.reviewStatus === "interpretation_failed" && (
              <button
                type="button"
                aria-label={`Retry AI for ${label}`}
                disabled={busy || !onRetry}
                onClick={() => run("retry", () => onRetry?.(region.id))}
              >
                {pendingAction === "retry" ? "Retrying..." : "Retry AI"}
              </button>
            )}
            <button
              type="button"
              aria-label={`Ignore region ${label}`}
              disabled={busy || !onIgnore}
              onClick={() => run("ignore", () => onIgnore(region.id, {
                expectedRegionVersion: region.version,
                reason: "Excluded during workbook review.",
              }))}
            >
              Ignore
            </button>
            <button type="button" aria-label={`Delete region ${label}`} disabled={busy || !onDelete} onClick={deleteRegion}>
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
  calculationOverlayRegionId = "",
  calculationOverlayState = null,
  onActiveRegionChange,
  onReviseRegion,
  onConfirmRegion,
  onRetryRegion,
  onIgnoreRegion,
  onDeleteRegion,
  onToggleCalculationOverlay,
  onSaveExtractionTemplate,
  extractionTemplates = [],
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
            calculationOverlayActive={Boolean(calculationOverlayRegionId) && calculationOverlayRegionId === region.id}
            calculationOverlayState={calculationOverlayRegionId === region.id ? calculationOverlayState : null}
            onActivate={onActiveRegionChange}
            onRevise={onReviseRegion}
            onConfirm={onConfirmRegion}
            onRetry={onRetryRegion}
            onIgnore={onIgnoreRegion}
            onDelete={onDeleteRegion}
            onToggleCalculationOverlay={onToggleCalculationOverlay}
            onSaveExtractionTemplate={onSaveExtractionTemplate}
            existingTemplate={asArray(extractionTemplates).find((template) => (
              template?.status !== "archived" && template?.sourceRegionId === region.id
            )) || null}
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
