import React, { useEffect, useMemo, useState } from "react";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function regionId(region) {
  return String(region?.draftRegionId || region?.clientRegionId || "").trim();
}

function regionLabel(region) {
  return `${region?.sheetName || "Sheet"}!${region?.range || "n/a"}`;
}

function copy(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function formatSkippedRows(skippedRows) {
  return asArray(skippedRows)
    .map((row) => `${row.rowNumber}: ${row.reason || "user_excluded"}`)
    .join("\n");
}

function parseSkippedRows(value) {
  return String(value || "").split(/[\n,]+/).flatMap((item) => {
    const match = item.trim().match(/^(\d+)(?:\s*:\s*(.+))?$/);
    return match ? [{ rowNumber: Number(match[1]), reason: match[2]?.trim() || "user_excluded" }] : [];
  });
}

function WorkbookInterpretationEditor({ region, fact, blockers = [], busy, readOnly = false, onApply }) {
  const serverInterpretation = fact?.interpretation || null;
  const [draft, setDraft] = useState(() => copy(serverInterpretation));
  const [skippedRowsText, setSkippedRowsText] = useState(() => formatSkippedRows(serverInterpretation?.inclusion?.skippedRows));

  useEffect(() => {
    setDraft(copy(serverInterpretation));
    setSkippedRowsText(formatSkippedRows(serverInterpretation?.inclusion?.skippedRows));
  }, [fact, serverInterpretation]);

  if (!region || !draft) return null;

  const updateField = (index, patch) => {
    setDraft((current) => ({
      ...current,
      fields: asArray(current.fields).map((field, fieldIndex) => (
        fieldIndex === index ? { ...field, ...patch } : field
      )),
    }));
  };
  const updateSeries = (index, patch) => {
    setDraft((current) => ({
      ...current,
      series: asArray(current.series).map((series, seriesIndex) => (
        seriesIndex === index ? { ...series, ...patch } : series
      )),
    }));
  };
  const sourceCells = [...new Set(asArray(draft.fields)
    .flatMap((field) => asArray(field.sourceRefs))
    .map((sourceRef) => sourceRef.cell)
    .filter(Boolean))];

  return (
    <section className="workbook-interpretation" aria-label="Structured interpretation">
      <header className="workbook-interpretation-head">
        <div>
          <strong>Structured interpretation</strong>
          <small>{regionLabel(region)}</small>
        </div>
        <span>{Math.round((Number(draft.confidence) || 0) * 100)}%</span>
      </header>

      <fieldset disabled={readOnly}>
        <legend>Experiments</legend>
        <label>
          <span>Axis</span>
          <select
            aria-label="Experiment axis"
            value={draft.experimentAxis || ""}
            onChange={(event) => setDraft((current) => ({
              ...current,
              experimentAxis: event.target.value || null,
              experimentIdColumn: event.target.value === "rows" ? current.experimentIdColumn : null,
              experimentLabel: event.target.value === "region" ? current.experimentLabel : null,
            }))}
          >
            <option value="">Choose...</option>
            <option value="rows">One experiment per row</option>
            <option value="region">One experiment in region</option>
          </select>
        </label>
        <label>
          <span>Header row</span>
          <input
            aria-label="Header row"
            type="number"
            min="1"
            value={draft.headerRow || ""}
            onChange={(event) => setDraft((current) => ({ ...current, headerRow: Number(event.target.value) || null }))}
          />
        </label>
        {draft.experimentAxis === "rows" && (
          <label>
            <span>Identity column</span>
            <input
              aria-label="Experiment identity column"
              value={draft.experimentIdColumn || ""}
              onChange={(event) => setDraft((current) => ({ ...current, experimentIdColumn: event.target.value.toUpperCase() }))}
            />
          </label>
        )}
        {draft.experimentAxis === "region" && (
          <label>
            <span>Experiment label</span>
            <input
              aria-label="Experiment label"
              value={draft.experimentLabel || ""}
              onChange={(event) => setDraft((current) => ({ ...current, experimentLabel: event.target.value }))}
            />
          </label>
        )}
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend>Fields and units</legend>
        <div className="workbook-interpretation-fields">
          {asArray(draft.fields).map((field, index) => (
            <div className="workbook-interpretation-field" key={`${field.column}-${index}`}>
              <strong>{field.column} · {field.displayName || field.semanticKey}</strong>
              <input
                aria-label={`Semantic key for ${field.displayName || field.column}`}
                value={field.semanticKey || ""}
                onChange={(event) => updateField(index, { semanticKey: event.target.value })}
              />
              <select
                aria-label={`Role for ${field.displayName || field.column}`}
                value={field.role || "other"}
                onChange={(event) => updateField(index, { role: event.target.value })}
              >
                <option value="identifier">Identifier</option>
                <option value="condition">Condition</option>
                <option value="outcome">Outcome</option>
                <option value="series_summary">Series summary</option>
                <option value="other">Other</option>
              </select>
              <select
                aria-label={`Value type for ${field.displayName || field.column}`}
                value={field.valueType || "string"}
                onChange={(event) => updateField(index, { valueType: event.target.value })}
              >
                <option value="number">Number</option>
                <option value="string">Text</option>
                <option value="date">Date</option>
                <option value="boolean">Boolean</option>
              </select>
              <input
                aria-label={`Unit for ${field.displayName || field.column}`}
                value={field.unit || ""}
                placeholder="No unit"
                onChange={(event) => updateField(index, { unit: event.target.value || null })}
              />
            </div>
          ))}
        </div>
        {!!sourceCells.length && <small>Header cells: {sourceCells.map((cell) => <span key={cell}>{cell}</span>)}</small>}
      </fieldset>

      {!!asArray(draft.series).length && (
        <fieldset disabled={readOnly}>
          <legend>Series</legend>
          {asArray(draft.series).map((series, index) => (
            <div className="workbook-interpretation-series" key={series.seriesKey || index}>
              <strong>{series.label || series.seriesKey}</strong>
              <label>
                <span>X column</span>
                <input aria-label={`X column for ${series.label}`} value={series.xColumn || ""} onChange={(event) => updateSeries(index, { xColumn: event.target.value.toUpperCase() })} />
              </label>
              <label>
                <span>Y column</span>
                <input aria-label={`Y column for ${series.label}`} value={series.yColumn || ""} onChange={(event) => updateSeries(index, { yColumn: event.target.value.toUpperCase() })} />
              </label>
            </div>
          ))}
        </fieldset>
      )}

      <fieldset disabled={readOnly}>
        <legend>Included rows</legend>
        <label>
          <span>Start</span>
          <input
            aria-label="Included start row"
            type="number"
            min="1"
            value={draft.inclusion?.startRow || ""}
            onChange={(event) => setDraft((current) => ({
              ...current,
              inclusion: { ...current.inclusion, startRow: Number(event.target.value) || null },
            }))}
          />
        </label>
        <label>
          <span>End</span>
          <input
            aria-label="Included end row"
            type="number"
            min="1"
            value={draft.inclusion?.endRow || ""}
            onChange={(event) => setDraft((current) => ({
              ...current,
              inclusion: { ...current.inclusion, endRow: Number(event.target.value) || null },
            }))}
          />
        </label>
        <label className="workbook-skipped-rows">
          <span>Skipped rows</span>
          <textarea
            aria-label="Skipped rows"
            value={skippedRowsText}
            placeholder="14: blank_identifier"
            onChange={(event) => setSkippedRowsText(event.target.value)}
          />
        </label>
      </fieldset>

      {!![...asArray(blockers), ...asArray(draft.warnings)].length && (
        <div className="workbook-interpretation-warnings" aria-label="Interpretation warnings">
          {[...asArray(blockers), ...asArray(draft.warnings)].map((warning, index) => (
            <p key={`${warning.code || "warning"}-${index}`}>{warning.message || warning.code}</p>
          ))}
        </div>
      )}

      {!readOnly && (
        <button
          type="button"
          onClick={() => onApply?.({
            ...draft,
            draftRegionId: regionId(region),
            experimentIdColumn: draft.experimentAxis === "rows" ? draft.experimentIdColumn || null : null,
            experimentLabel: draft.experimentAxis === "region" ? draft.experimentLabel || null : null,
            inclusion: {
              ...draft.inclusion,
              skippedRows: parseSkippedRows(skippedRowsText),
            },
            decisionSource: "user_patch",
          })}
          disabled={busy || !onApply}
        >
          Apply structured interpretation
        </button>
      )}
    </section>
  );
}

export function WorkbookReviewDock({
  reviewState = {},
  draftRegions = [],
  activeDraftRegionId = "",
  selectedDraftRegionIds = [],
  onActiveDraftRegionChange,
  onSelectedDraftRegionIdsChange,
  onSubmitRevision,
  onConfirmUnderstanding,
  onReviewExtractedExperiments,
}) {
  const session = reviewState.session || reviewState.workbookReviewSession || null;
  const understanding = session?.currentUnderstanding || reviewState.workbookUnderstanding || {};
  const regions = asArray(draftRegions);
  const fallbackRegionId = regionId(regions.at(-1));
  const activeRegionId = activeDraftRegionId || fallbackRegionId;
  const [revisionDraft, setRevisionDraft] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");

  const validSelectedIds = useMemo(() => {
    const available = new Set(regions.map(regionId).filter(Boolean));
    return selectedDraftRegionIds.filter((id) => available.has(id));
  }, [regions, selectedDraftRegionIds]);
  const selectedRegions = regions.filter((region) => validSelectedIds.includes(regionId(region)));
  const messages = asArray(session?.messages);
  const workbookName = reviewState.sourceDocument?.metadata?.workbookName
    || session?.workbookSummary?.workbookName
    || "Workbook review";
  const accepted = session?.status === "accepted";
  const validationBlockers = asArray(understanding?.validation?.blockers);
  const activeFact = asArray(understanding?.facts).find((fact) => fact?.draftRegionId === activeRegionId) || null;
  const activeRegion = regions.find((region) => regionId(region) === activeRegionId) || null;
  const activeBlockers = validationBlockers.filter((blocker) => !blocker.draftRegionId || blocker.draftRegionId === activeRegionId);
  const busy = Boolean(pendingAction || reviewState.revisionLoading || reviewState.confirmLoading);
  const displayedError = actionError || reviewState.revisionError || reviewState.clarification?.message || "";
  const canConfirm = !accepted
    && Boolean(onConfirmUnderstanding)
    && asArray(understanding?.facts).length > 0
    && validationBlockers.length === 0
    && !busy;

  const activateRegion = (region) => {
    const id = regionId(region);
    if (!id) return;
    onActiveDraftRegionChange?.(id);
  };

  const toggleRegion = (region) => {
    const id = regionId(region);
    if (!id) return;
    onSelectedDraftRegionIdsChange?.(
      validSelectedIds.includes(id)
        ? validSelectedIds.filter((selectedId) => selectedId !== id)
        : [...validSelectedIds, id],
    );
  };

  const submitRevision = async () => {
    const message = revisionDraft.trim();
    if (!message || !selectedRegions.length || busy || !onSubmitRevision) return;
    setPendingAction("revision");
    setActionError("");
    try {
      await onSubmitRevision({
        message,
        redBoxUpdates: selectedRegions.map((region) => ({
          ...region,
          description: message,
          semanticType: "",
        })),
        previousUnderstandingId: understanding?.id || null,
        revisionMode: selectedRegions.length > 1 ? "merge" : "replace_current",
        activeDraftRegionId: activeRegionId || regionId(selectedRegions[0]) || null,
      });
      setRevisionDraft("");
    } catch (error) {
      setActionError(error?.message || String(error));
    } finally {
      setPendingAction("");
    }
  };

  const confirmUnderstanding = async () => {
    if (!canConfirm) return;
    setPendingAction("confirm");
    setActionError("");
    try {
      await onConfirmUnderstanding({
        workbookUnderstandingId: understanding.id,
        decisionSummary: {
          acceptedByUser: true,
          note: "Confirmed from the docked workbook review.",
          acknowledgedLowConfidence: asArray(understanding?.facts).some((fact) => (
            fact?.interpretation && Number(fact.interpretation.confidence) < 0.6
          )),
        },
      });
    } catch (error) {
      setActionError(error?.message || String(error));
    } finally {
      setPendingAction("");
    }
  };

  const applyStructuredInterpretation = async (interpretationPatch) => {
    if (!activeRegion || busy || !onSubmitRevision) return;
    setPendingAction("structured");
    setActionError("");
    try {
      await onSubmitRevision({
        message: `Updated structured interpretation for ${regionLabel(activeRegion)}.`,
        redBoxUpdates: [activeRegion],
        interpretationPatches: [interpretationPatch],
        previousUnderstandingId: understanding?.id || null,
        revisionMode: "replace_current",
        activeDraftRegionId: activeRegionId,
      });
    } catch (error) {
      setActionError(error?.message || String(error));
    } finally {
      setPendingAction("");
    }
  };

  return (
    <aside className="workbook-review-chat" aria-label="Workbook review dock">
      <header className="workbook-review-chat-head">
        <div>
          <h3>{workbookName}</h3>
          <small>{regions.length} red boxes</small>
        </div>
        <span>{session?.status || "needs_review"}</span>
      </header>

      <div className="workbook-review-messages" aria-label="Workbook review conversation">
        {messages.map((message, index) => (
          <article className="chat-msg" key={message.id || `${message.role}-${index}`}>
            <span>{message.role === "user" ? "You" : "LabRat"}</span>
            <p>{message.content || message.text || ""}</p>
          </article>
        ))}
      </div>

      <section className="workbook-redbox-review" aria-label="Workbook red boxes">
        {regions.map((region) => {
          const id = regionId(region);
          const active = id === activeRegionId;
          const included = validSelectedIds.includes(id);
          return (
            <article className={`workbook-redbox-card ${active ? "is-active" : ""}`} key={id || regionLabel(region)}>
              <button type="button" className="workbook-redbox-activate" aria-label={`Activate ${regionLabel(region)}`} onClick={() => activateRegion(region)}>
                <span className={`workbook-redbox-range ${active ? "is-active" : ""}`}>{region.range || "n/a"}</span>
                <small>{region.sheetName || "Sheet"} / {region.semanticType || region.kind || "unclassified"}</small>
              </button>
              <label className="workbook-redbox-include">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => toggleRegion(region)}
                  aria-label={`Include ${regionLabel(region)} in revision`}
                />
                <span>Include in revision</span>
              </label>
              {!!asArray(region.warnings).length && <small>{asArray(region.warnings).length} warning(s)</small>}
            </article>
          );
        })}
      </section>

      <WorkbookInterpretationEditor
        region={activeRegion}
        fact={activeFact}
        blockers={activeBlockers}
        busy={busy}
        readOnly={accepted}
        onApply={!accepted && onSubmitRevision ? applyStructuredInterpretation : null}
      />

      {!!validationBlockers.length && !activeBlockers.length && (
        <div className="workbook-interpretation-warnings" aria-label="Workbook interpretation blockers">
          {validationBlockers.map((blocker, index) => <p key={`${blocker.code}-${index}`}>{blocker.message}</p>)}
        </div>
      )}

      {displayedError && <p className="workbook-review-clarification" role="alert">{displayedError}</p>}

      {accepted ? (
        <section className="workbook-review-next-step">
          <strong>Understanding accepted</strong>
          <button type="button" className="primary" onClick={onReviewExtractedExperiments}>
            Review extracted experiments
          </button>
        </section>
      ) : (
        <>
          <label className="workbook-review-input">
            <span>{selectedRegions.length > 1 ? `${selectedRegions.length} boxes selected` : "Active red box"}</span>
            <textarea
              value={revisionDraft}
              onChange={(event) => setRevisionDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submitRevision();
                }
              }}
              placeholder="Describe what should change about the selected red box..."
            />
          </label>
          <div className="workbook-review-actions">
            <button
              type="button"
              onClick={submitRevision}
              disabled={busy || !revisionDraft.trim() || !selectedRegions.length || !onSubmitRevision}
              aria-label={pendingAction === "revision" ? "Submitting revision" : "Submit revision"}
            >
              {pendingAction === "revision" ? "Submitting..." : "Submit revision"}
            </button>
            <button type="button" className="primary" onClick={confirmUnderstanding} disabled={!canConfirm}>
              {pendingAction === "confirm" ? "Confirming..." : "Confirm understanding"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
