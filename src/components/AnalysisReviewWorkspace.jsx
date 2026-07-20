import React, { useEffect, useMemo, useState } from "react";

import {
  acceptAnalysisPlanRevision,
  createAnalysisPlanRevision,
  getAnalysisPlanSelection,
  getAnalysisThread,
} from "../data/analysisApi.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function messageText(message) {
  return message?.content || message?.text || "";
}

function rectangleSheet(rectangle) {
  return rectangle?.sheetName || rectangle?.sheet || "";
}

function rectangleRange(rectangle) {
  return rectangle?.range || rectangle?.rangeRef || "";
}

function rectangleId(rectangle, index) {
  return [
    "analysis_rect",
    rectangle?.sourceDocumentId || "source",
    rectangleSheet(rectangle) || "sheet",
    rectangleRange(rectangle) || index,
  ].join("_").replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function sourceReviewRegions(rectangles) {
  return asArray(rectangles)
    .filter((rectangle) => rectangle?.sourceDocumentId && rectangleSheet(rectangle) && rectangleRange(rectangle))
    .map((rectangle, index) => {
      const id = rectangleId(rectangle, index);
      return {
        ...rectangle,
        clientRegionId: id,
        draftRegionId: id,
        sourceDocumentId: rectangle.sourceDocumentId,
        sheetName: rectangleSheet(rectangle),
        range: rectangleRange(rectangle),
        description: rectangle.label || rectangle.description || "Analysis input",
        selectionMethod: "accepted_analysis_plan",
        status: "reviewed_input",
      };
    });
}

function revisionStatus(status) {
  if (status === "awaiting_review") return "Needs review";
  if (status === "accepted") return "Accepted";
  if (status === "superseded") return "Superseded";
  return status || "Draft";
}

function coverageValueLabel(value) {
  if (Array.isArray(value)) {
    return value.map((item) => coverageValueLabel(item)).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    const name = value.displayName || value.fieldKey || value.label || value.id;
    if (name) return value.unit ? `${name} (${value.unit})` : String(name);
    const entries = Object.entries(value);
    if (entries.length && entries.every(([, item]) => item && typeof item === "object")) {
      return entries.map(([key, item]) => {
        const fieldName = item.displayName
          || item.fieldKey
          || (key.startsWith("analysis_field:") ? key.split(":")[1] : key);
        if (Number.isFinite(item.available)) {
          const total = Number.isFinite(item.totalExperiments) ? item.totalExperiments : item.available;
          return `${fieldName}: ${item.available}/${total} available`;
        }
        return `${fieldName}: ${coverageValueLabel(item)}`;
      }).join(", ");
    }
    return JSON.stringify(value);
  }
  return String(value ?? "");
}

function acceptanceKey(revision) {
  const randomPart = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `accept_analysis_${revision.id}_${randomPart}`;
}

export function AnalysisReviewWorkspace({
  projectId,
  thread: initialThread,
  revision: initialRevision,
  planRevisions: initialPlanRevisions = null,
  selection: controlledSelection = null,
  WorkbookWorkspaceComponent = null,
  loadThread = getAnalysisThread,
  loadSelection = getAnalysisPlanSelection,
  createRevision = createAnalysisPlanRevision,
  acceptPlan = acceptAnalysisPlanRevision,
  onClose,
  onAccepted,
}) {
  const [thread, setThread] = useState(initialThread || null);
  const [revisions, setRevisions] = useState(() => (
    initialPlanRevisions || (initialRevision ? [initialRevision] : [])
  ));
  const [revision, setRevision] = useState(initialRevision || null);
  const [selectionState, setSelectionState] = useState({
    loading: !controlledSelection,
    error: "",
    value: controlledSelection,
  });
  const [activeRectangleId, setActiveRectangleId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [acceptedRun, setAcceptedRun] = useState(null);

  useEffect(() => {
    setThread(initialThread || null);
    setRevision(initialRevision || null);
    setRevisions(initialPlanRevisions || (initialRevision ? [initialRevision] : []));
    setAcceptedRun(null);
    setActionError("");
  }, [initialThread?.id, initialRevision?.id]);

  useEffect(() => {
    if (initialPlanRevisions || !initialThread?.id) return undefined;
    let cancelled = false;
    loadThread(initialThread.id)
      .then((body) => {
        if (cancelled) return;
        const loadedRevisions = asArray(body?.planRevisions);
        setThread(body?.analysisThread || initialThread);
        setRevisions(loadedRevisions);
        setRevision((current) => (
          loadedRevisions.findLast((item) => (
            item.status === "awaiting_review" || item.status === "accepted"
          ))
          || loadedRevisions.find((item) => item.id === current?.id)
          || loadedRevisions.at(-1)
          || current
        ));
      })
      .catch((error) => {
        if (!cancelled) setActionError(error?.message || String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [initialThread?.id, initialPlanRevisions, loadThread]);

  useEffect(() => {
    if (controlledSelection) {
      setSelectionState({ loading: false, error: "", value: controlledSelection });
      return undefined;
    }
    if (!revision?.id) {
      setSelectionState({ loading: false, error: "", value: null });
      return undefined;
    }
    let cancelled = false;
    setSelectionState((current) => ({ ...current, loading: true, error: "" }));
    loadSelection(revision.id, { offset: 0, limit: 100 })
      .then((value) => {
        if (!cancelled) setSelectionState({ loading: false, error: "", value });
      })
      .catch((error) => {
        if (!cancelled) {
          setSelectionState({ loading: false, error: error?.message || String(error), value: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [controlledSelection, loadSelection, revision?.id]);

  const rectangles = useMemo(
    () => sourceReviewRegions(selectionState.value?.sourceRectangles || revision?.sourceRectangles),
    [revision?.id, revision?.sourceRectangles, selectionState.value?.sourceRectangles],
  );
  const activeRectangle = rectangles.find((rectangle) => rectangle.draftRegionId === activeRectangleId)
    || rectangles[0]
    || null;
  const currentActiveId = activeRectangle?.draftRegionId || "";
  const focusSelection = activeRectangle ? {
    requestId: `${revision?.id || "revision"}:${currentActiveId}`,
    sourceDocumentId: activeRectangle.sourceDocumentId,
    sheetName: activeRectangle.sheetName,
    range: activeRectangle.range,
    focusOnly: true,
  } : null;
  const busy = Boolean(pendingAction);
  const awaitingReview = revision?.status === "awaiting_review" && !acceptedRun;

  const submitFeedback = async () => {
    const nextFeedback = feedback.trim();
    if (!nextFeedback || busy || !thread?.id || !awaitingReview) return;
    setPendingAction("revision");
    setActionError("");
    try {
      const response = await createRevision(thread.id, { feedback: nextFeedback });
      const nextRevision = response?.analysisPlanRevision;
      if (!nextRevision?.id) throw new Error("The backend did not return the revised analysis plan.");
      setRevisions((current) => [
        ...current.map((item) => (
          item.id === revision.id && item.status === "awaiting_review"
            ? { ...item, status: "superseded" }
            : item
        )),
        nextRevision,
      ]);
      setRevision(nextRevision);
      setFeedback("");
      setActiveRectangleId("");
    } catch (error) {
      setActionError(error?.message || String(error));
    } finally {
      setPendingAction("");
    }
  };

  const acceptVisiblePlan = async () => {
    if (!revision?.id || busy || !awaitingReview) return;
    setPendingAction("accept");
    setActionError("");
    try {
      const response = await acceptPlan(revision.id, {
        planHash: revision.planHash,
        selectionHash: revision.selectionHash,
        dependencyHash: revision.dependencyHash,
      }, {
        idempotencyKey: acceptanceKey(revision),
      });
      const acceptedRevision = response?.analysisPlanRevision || { ...revision, status: "accepted" };
      setRevision(acceptedRevision);
      setRevisions((current) => current.map((item) => (
        item.id === acceptedRevision.id ? acceptedRevision : item
      )));
      setAcceptedRun(response?.analysisRun || { status: "queued" });
      onAccepted?.(response);
    } catch (error) {
      setActionError(error?.message || String(error));
    } finally {
      setPendingAction("");
    }
  };

  return (
    <section className="analysis-review-workspace" aria-label="Analysis plan review">
      <header className="analysis-review-header">
        <div>
          <strong>Reviewed analysis</strong>
          <span>{thread?.originalRequest || revision?.requestSummary || "Analysis plan"}</span>
        </div>
        {onClose && <button type="button" aria-label="Close analysis review" onClick={onClose}>&times;</button>}
      </header>

      <div className="analysis-review-tabs" role="tablist" aria-label="Analysis review stages">
        <button type="button" role="tab" aria-selected="true">Source</button>
        <button type="button" role="tab" aria-selected="false" disabled>Result</button>
        <button type="button" role="tab" aria-selected="false" disabled>Chart</button>
      </div>

      <div className="analysis-review-split">
        <section className="analysis-review-source" aria-label="Selected source data">
          <div className="analysis-source-rectangles" aria-label="Analysis source ranges">
            {rectangles.map((rectangle, index) => (
              <button
                type="button"
                className={rectangle.draftRegionId === currentActiveId ? "active" : ""}
                key={rectangle.draftRegionId}
                onClick={() => setActiveRectangleId(rectangle.draftRegionId)}
              >
                <span>{rectangle.label || `Input ${index + 1}`}</span>
                <small>{rectangle.sheetName}!{rectangle.range}</small>
              </button>
            ))}
          </div>
          {selectionState.loading && <p className="analysis-review-state">Loading selected source data...</p>}
          {selectionState.error && <p className="analysis-review-error" role="alert">{selectionState.error}</p>}
          {WorkbookWorkspaceComponent && (
            <WorkbookWorkspaceComponent
              projectId={projectId || thread?.projectId}
              reviewState={{ regions: [] }}
              draftRegions={rectangles}
              activeDraftRegionId={currentActiveId}
              onDraftRegionsChange={() => {}}
              onActiveDraftRegionChange={setActiveRectangleId}
              focusSelection={focusSelection}
            />
          )}
        </section>

        <aside className="analysis-review-conversation" aria-label="LabRat analysis plan conversation">
          <header className="analysis-review-conversation-head">
            <div>
              <strong>the lab rat</strong>
              <span>{revision ? `Analysis plan revision ${revision.revision}` : "Planning"}</span>
            </div>
            <span>{revisionStatus(revision?.status)}</span>
          </header>

          <div className="analysis-review-messages">
            {asArray(thread?.messages).map((message, index) => (
              <article className={`analysis-review-message ${message.role || "assistant"}`} key={message.id || index}>
                <span>{message.role === "user" ? "You" : "the lab rat"}</span>
                <p>{messageText(message)}</p>
              </article>
            ))}

            {revision && (
              <article className="analysis-plan-card">
                <header>
                  <strong>Analysis plan revision {revision.revision}</strong>
                  <span>{revisionStatus(revision.status)}</span>
                </header>
                <p>{revision.requestSummary}</p>
                <ol>
                  {asArray(revision.processingSummary).map((step, index) => (
                    <li key={`${step}-${index}`}>{step}</li>
                  ))}
                </ol>
                {selectionState.value?.coverage && (
                  <dl className="analysis-plan-coverage">
                    {Object.entries(selectionState.value.coverage).map(([key, value]) => (
                      <div key={key}><dt>{key}</dt><dd>{coverageValueLabel(value)}</dd></div>
                    ))}
                  </dl>
                )}
                {!!asArray(revision.warnings).length && (
                  <div className="analysis-plan-warnings">
                    {asArray(revision.warnings).map((warning, index) => (
                      <p key={`${warning.code || "warning"}-${index}`}>{warning.message || warning.code || String(warning)}</p>
                    ))}
                  </div>
                )}
                <details>
                  <summary>Exact Python</summary>
                  <pre>{revision.pythonProgram?.source || "No Python source was provided."}</pre>
                  {revision.pythonProgram?.sourceHash && <small>{revision.pythonProgram.sourceHash}</small>}
                </details>
              </article>
            )}

            <section className="analysis-revision-history" aria-label="Analysis revision history">
              {revisions.map((item) => (
                <button
                  type="button"
                  className={item.id === revision?.id ? "active" : ""}
                  key={item.id}
                  onClick={() => {
                    setRevision(item);
                    setAcceptedRun(null);
                    setActiveRectangleId("");
                  }}
                >
                  <span>Revision {item.revision}</span>
                  <small>{revisionStatus(item.status)}</small>
                </button>
              ))}
            </section>

            {acceptedRun && (
              <div className="analysis-review-queued" role="status">
                <strong>Queued for calculation</strong>
                <span>The accepted plan is frozen. No result or chart has been created yet.</span>
              </div>
            )}
            {actionError && <p className="analysis-review-error" role="alert">{actionError}</p>}
          </div>

          <div className="analysis-review-composer">
            <button
              type="button"
              className="accept-plan"
              onClick={acceptVisiblePlan}
              disabled={!awaitingReview || busy}
            >
              {pendingAction === "accept" ? "Accepting..." : "Accept plan"}
            </button>
            <div className="analysis-review-modification">
              <textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitFeedback();
                  }
                }}
                placeholder="Describe a modification"
                disabled={!awaitingReview || busy}
              />
              <button
                type="button"
                aria-label="Send modification"
                onClick={submitFeedback}
                disabled={!feedback.trim() || !awaitingReview || busy}
              >
                {pendingAction === "revision" ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
