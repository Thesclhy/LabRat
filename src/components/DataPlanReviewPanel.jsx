import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  applyIdentityDecisionBatch,
  identityCandidateKey,
  identityCandidateStatus,
  initialIdentityDecisionState,
  summarizeIdentityDecisions,
} from "../data/identityDecisionBatch.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function decisionMatchesReview(candidate, decision) {
  const accepted = candidate.decision;
  if (!accepted?.action || accepted.action !== decision?.action) return false;
  if (accepted.action !== "reuse") return true;
  return Boolean(accepted.experimentIdentityId)
    && accepted.experimentIdentityId === decision?.experimentIdentityId;
}

export function DataPlanReviewPanel({
  review,
  loading = false,
  error = "",
  onApplyIdentityDecisions,
  onOpenSource,
  onBack,
  onPublish,
  onPreviewStale,
}) {
  const candidates = asArray(review?.identityCandidates);
  const summary = review?.reviewSummary || {};
  const blockers = asArray(summary.blockers);
  const [decisions, setDecisions] = useState(() => initialIdentityDecisionState(candidates));
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [identityFilter, setIdentityFilter] = useState("all");
  const [undoDecisions, setUndoDecisions] = useState(null);
  const [publishState, setPublishState] = useState({ status: "idle", error: "", result: null });
  const publishLockRef = useRef(false);

  useEffect(() => {
    setDecisions(initialIdentityDecisionState(candidates));
    setSelectedKeys(new Set());
    setIdentityFilter("all");
    setUndoDecisions(null);
    setPublishState({ status: "idle", error: "", result: null });
    publishLockRef.current = false;
  }, [review?.dataPlan?.id, review?.snapshotPreview?.previewHash]);

  const submittedDecisions = useMemo(() => candidates.flatMap((candidate) => {
    const key = identityCandidateKey(candidate);
    const decision = decisions[key] || {};
    if (!decision.action) return [];
    if (decision.action === "reuse" && !decision.experimentIdentityId) return [];
    return [{
      sourceAlias: candidate.sourceAlias,
      action: decision.action,
      ...(decision.action === "reuse" ? { experimentIdentityId: decision.experimentIdentityId } : {}),
    }];
  }), [candidates, decisions]);
  const decisionsMatchAcceptedReview = candidates.every((candidate) => {
    const key = identityCandidateKey(candidate);
    return decisionMatchesReview(candidate, decisions[key]);
  });
  const identitySummary = useMemo(
    () => summarizeIdentityDecisions(candidates, decisions),
    [candidates, decisions],
  );
  const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
    if (identityFilter === "all") return true;
    const status = identityCandidateStatus(candidate, decisions[identityCandidateKey(candidate)] || {});
    return status === identityFilter;
  }), [candidates, decisions, identityFilter]);
  const publishReady = blockers.length === 0 && decisionsMatchAcceptedReview;
  const publishing = publishState.status === "publishing";
  const published = publishState.status === "published";

  const handlePublish = async () => {
    if (publishLockRef.current || !publishReady || !onPublish) return;
    publishLockRef.current = true;
    setPublishState({ status: "publishing", error: "", result: null });
    try {
      const result = await onPublish({
        dataPlan: review?.dataPlan,
        identityDecisions: submittedDecisions,
        expectedPreviewHash: review?.snapshotPreview?.previewHash,
        expectedDependencyHash: review?.dataPlan?.dependencyHash,
      });
      setPublishState({ status: "published", error: "", result });
    } catch (publishError) {
      const currentReview = publishError?.details?.currentReview;
      if (publishError?.code === "preview_stale" && currentReview && onPreviewStale) {
        onPreviewStale(currentReview);
      }
      setPublishState({
        status: "error",
        error: publishError?.message || "Experiment data could not be published.",
        result: null,
      });
    } finally {
      publishLockRef.current = false;
    }
  };

  const updateDecision = (candidate, patch) => {
    const key = identityCandidateKey(candidate);
    setUndoDecisions(null);
    setDecisions((current) => {
      const currentDecision = current[key] || {};
      const nextDecision = {
        ...currentDecision,
        ...patch,
      };
      if (Object.hasOwn(patch, "action") && patch.action !== currentDecision.action) {
        nextDecision.experimentIdentityId = "";
      }
      return {
        ...current,
        [key]: nextDecision,
      };
    });
  };
  const applyBulkDecisions = (mode, keys = null) => {
    const next = applyIdentityDecisionBatch(candidates, decisions, { mode, selectedKeys: keys });
    if (next === decisions) return;
    setUndoDecisions(decisions);
    setDecisions(next);
  };
  const toggleCandidateSelection = (candidate) => {
    const key = identityCandidateKey(candidate);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const visibleKeys = filteredCandidates.map(identityCandidateKey);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));
  const setAllVisibleSelected = (checked) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      visibleKeys.forEach((key) => {
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };

  if (!review && loading) {
    return <aside className="data-plan-review-panel" aria-label="Experiment data preview"><p>Compiling source-backed experiment records...</p></aside>;
  }

  return (
    <aside className="data-plan-review-panel" aria-label="Experiment data preview">
      <header className="data-plan-review-header">
        <div>
          <span className="data-plan-review-kicker">Accepted workbook evidence</span>
          <h2>Experiment data preview</h2>
        </div>
        {onBack && <button type="button" onClick={onBack}>Back</button>}
      </header>

      {error && <p className="data-plan-review-error" role="alert">{error}</p>}
      {publishState.error && <p className="data-plan-review-error" role="alert">{publishState.error}</p>}
      {published && (
        <p className="data-plan-review-success" role="status">
          Published {plural(Number(publishState.result?.experimentProjectionSummary?.publishedExperimentCount) || 0, "experiment")} to Browser.
        </p>
      )}

      <div className="data-plan-review-counts" aria-label="Preview counts">
        <strong>{plural(Number(summary.experimentRecordCount) || 0, "experiment record")}</strong>
        <span>{plural(Number(summary.includedRowCount) || 0, "included row")}</span>
        <span>{plural(Number(summary.skippedRowCount) || 0, "skipped row")}</span>
      </div>

      <section className="data-plan-review-section">
        <h3>Experiment identities</h3>
        {!candidates.length && <p>No experiment aliases were extracted.</p>}
        {!!candidates.length && (
          <>
            <div className="data-plan-identity-summary" aria-label="Identity decision summary">
              <strong>{identitySummary.total} total</strong>
              <span>{identitySummary.create} new</span>
              <span>{identitySummary.reuse} reused</span>
              <span>{identitySummary.unresolved} unresolved</span>
              <span>{identitySummary.conflict} {identitySummary.conflict === 1 ? "conflict" : "conflicts"}</span>
            </div>
            <div className="data-plan-identity-bulk-actions">
              <button
                type="button"
                onClick={() => applyBulkDecisions("create_unmatched")}
                disabled={loading || publishing || published || identitySummary.unmatchedAvailable === 0}
              >
                Create {identitySummary.unmatchedAvailable} unmatched
              </button>
              <button
                type="button"
                onClick={() => applyBulkDecisions("reuse_unique")}
                disabled={loading || publishing || published || identitySummary.exactMatchesAvailable === 0}
              >
                Accept {identitySummary.exactMatchesAvailable} exact {identitySummary.exactMatchesAvailable === 1 ? "match" : "matches"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDecisions(undoDecisions);
                  setUndoDecisions(null);
                }}
                disabled={loading || publishing || published || !undoDecisions}
              >
                Undo batch
              </button>
            </div>
            <div className="data-plan-identity-filters" aria-label="Filter identity decisions">
              {[
                ["all", identitySummary.total],
                ["unresolved", identitySummary.unresolved],
                ["create", identitySummary.create],
                ["reuse", identitySummary.reuse],
                ["conflict", identitySummary.conflict],
              ].map(([status, count]) => (
                <button
                  type="button"
                  key={status}
                  aria-pressed={identityFilter === status}
                  onClick={() => setIdentityFilter(status)}
                >
                  {status === "all" ? "All" : status === "create" ? "New" : status === "reuse" ? "Reused" : status === "conflict" ? "Conflicts" : "Unresolved"} {count}
                </button>
              ))}
            </div>
            <div className="data-plan-identity-selection-bar">
              <label>
                <input
                  type="checkbox"
                  aria-label="Select visible identities"
                  checked={allVisibleSelected}
                  onChange={(event) => setAllVisibleSelected(event.target.checked)}
                />
                <span>{selectedKeys.size ? `${selectedKeys.size} selected` : "Select visible"}</span>
              </label>
              <button
                type="button"
                onClick={() => applyBulkDecisions("create_unmatched", selectedKeys)}
                disabled={!selectedKeys.size || loading || publishing || published}
              >
                Create selected unmatched
              </button>
              <button
                type="button"
                onClick={() => applyBulkDecisions("reuse_unique", selectedKeys)}
                disabled={!selectedKeys.size || loading || publishing || published}
              >
                Accept selected exact matches
              </button>
              <button
                type="button"
                onClick={() => applyBulkDecisions("clear", selectedKeys)}
                disabled={!selectedKeys.size || loading || publishing || published}
              >
                Clear selected decisions
              </button>
            </div>
          </>
        )}
        <div className="data-plan-identity-list">
          {filteredCandidates.map((candidate) => {
            const key = identityCandidateKey(candidate);
            const decision = decisions[key] || {};
            const status = identityCandidateStatus(candidate, decision);
            return (
              <fieldset key={key} className="data-plan-identity-row" disabled={loading || publishing || published}>
                <legend>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Select ${candidate.sourceAlias}`}
                      checked={selectedKeys.has(key)}
                      onChange={() => toggleCandidateSelection(candidate)}
                    />
                    <span>{candidate.sourceAlias}</span>
                    <small>{status === "create" ? "New" : status === "reuse" ? "Reuse" : status === "conflict" ? "Conflict" : "Unresolved"}</small>
                  </label>
                </legend>
                <label>
                  <span>Decision</span>
                  <select
                    aria-label={`Identity decision for ${candidate.sourceAlias}`}
                    value={decision.action || ""}
                    onChange={(event) => updateDecision(candidate, { action: event.target.value })}
                  >
                    <option value="">Choose...</option>
                    <option value="create">Create new</option>
                    <option value="reuse">Reuse existing</option>
                  </select>
                </label>
                {decision.action === "reuse" && (
                  <label>
                    <span>Existing experiment</span>
                    <select
                      aria-label={`Existing identity for ${candidate.sourceAlias}`}
                      value={decision.experimentIdentityId || ""}
                      onChange={(event) => updateDecision(candidate, { experimentIdentityId: event.target.value })}
                    >
                      <option value="">Choose...</option>
                      {asArray(candidate.matches).map((match) => (
                        <option key={match.id} value={match.id}>{match.label || match.canonicalLabel || match.id}</option>
                      ))}
                    </select>
                  </label>
                )}
              </fieldset>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onApplyIdentityDecisions?.(submittedDecisions)}
          disabled={loading || publishing || published || !onApplyIdentityDecisions || submittedDecisions.length !== candidates.length}
        >
          {loading ? "Applying..." : "Apply identity decisions"}
        </button>
      </section>

      <section className="data-plan-review-section">
        <h3>Fields and units</h3>
        <div className="data-plan-field-table-wrap">
          <table className="data-plan-field-table">
            <thead>
              <tr><th>Field</th><th>Role</th><th>Type</th><th>Unit</th><th>Coverage</th></tr>
            </thead>
            <tbody>
              {asArray(summary.fields).map((field) => (
                <tr key={`${field.fieldKey}-${field.unit || "unitless"}-${field.valueType}`}>
                  <td>{field.displayName || field.fieldKey}</td>
                  <td>{field.role}</td>
                  <td>{field.valueType}</td>
                  <td>{field.unit || "Unitless"}</td>
                  <td>{Math.round((Number(field.coverage) || 0) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="data-plan-review-section">
        <h3>Source ranges</h3>
        <div className="data-plan-source-list">
          {asArray(summary.sourceRanges).map((source) => (
            <button
              type="button"
              key={source.evidenceKey}
              aria-label={`Open ${source.sheetName} ${source.range}`}
              onClick={() => onOpenSource?.(source)}
              disabled={!onOpenSource}
            >
              <span>{source.sheetName}</span>
              <strong>{source.range}</strong>
            </button>
          ))}
        </div>
      </section>

      {!!asArray(summary.warnings).length && (
        <section className="data-plan-review-section data-plan-review-warnings">
          <h3>Warnings</h3>
          {asArray(summary.warnings).map((warning, index) => <p key={`${warning.code}-${index}`}>{warning.message}</p>)}
        </section>
      )}

      {!!blockers.length && (
        <section className="data-plan-review-section data-plan-review-blockers" aria-label="Publish blockers">
          <h3>Required decisions</h3>
          {blockers.map((blocker, index) => <p key={`${blocker.code}-${index}`}>{blocker.message}</p>)}
        </section>
      )}

      <footer className="data-plan-review-actions">
        <button
          type="button"
          className="primary"
          onClick={handlePublish}
          disabled={loading || publishing || published || !publishReady || !onPublish}
          title={!onPublish
            ? "Publishing is enabled in the next reviewed milestone."
            : !publishReady
              ? "Apply all identity decisions before publishing."
              : undefined}
        >
          {publishing ? "Publishing..." : published ? "Published" : "Publish to Browser"}
        </button>
      </footer>
    </aside>
  );
}
