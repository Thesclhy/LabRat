import React from "react";
import { makeGenericChartPreview } from "../charts/genericChartPreview.js";
import { Plot } from "../charts/Plot.jsx";
import { blockReviewDecision } from "../data/importBlockReviewState.js";

function warningCount(result) {
  return result?.summary?.warningCount ?? result?.warnings?.length ?? 0;
}

function formatConfidence(value) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a";
}

function sourceLabel(source) {
  if (!source) return "source n/a";
  return [source.sheet, source.range || source.cell].filter(Boolean).join(" ") || "source n/a";
}

function WarningList({ warnings }) {
  const items = Array.isArray(warnings) ? warnings : [];
  if (!items.length) return <span className="backend-scan-muted">No warnings</span>;
  return (
    <ul className="backend-scan-list">
      {items.map((warning, index) => (
        <li key={`${warning.code || "warning"}-${index}`}>
          <strong>{warning.code || "warning"}</strong>
          <span>{warning.message || ""}</span>
          {warning.range && <em>{warning.range}</em>}
        </li>
      ))}
    </ul>
  );
}

function WorkflowStepStrip({ steps }) {
  return (
    <ol className="backend-workflow-steps" aria-label="Import review workflow">
      {steps.map((step) => (
        <li className={`backend-workflow-step is-${step.status}`} key={step.label}>
          <span>{step.label}</span>
          <small>{step.detail}</small>
        </li>
      ))}
    </ol>
  );
}

function WorkflowPanelHeader({ title, detail, meta }) {
  return (
    <div className="workflow-panel-head">
      <div>
        <h4>{title}</h4>
        {detail && <p>{detail}</p>}
      </div>
      {meta && <span>{meta}</span>}
    </div>
  );
}

function StructureProposalList({ structureProposals }) {
  const proposals = Array.isArray(structureProposals) ? structureProposals : [];
  if (!proposals.length) return <span className="backend-scan-muted">No structure proposals</span>;
  return (
    <div className="backend-structure-list">
      {proposals.map((proposal) => (
        <article className="backend-structure-card" key={proposal.tableId || proposal.regionId}>
          <div className="backend-scan-block-head">
            <strong>{proposal.tableId || proposal.regionId}</strong>
            <span>{formatConfidence(proposal.confidence)}</span>
          </div>
          <p className="backend-scan-muted">
            Header rows: {(proposal.headerRows || []).join(", ") || "n/a"} - Data rows: {(proposal.dataRows || []).length || 0}
          </p>
          {proposal.observationSetPreview && (
            <p className="backend-scan-muted">
              Detected supplemental time series: {proposal.observationSetPreview.inferredExperimentLabel || "unknown experiment"} - {proposal.observationSetPreview.kind}
            </p>
          )}
          <div className="generic-field-list">
            {(proposal.columns || []).map((column) => (
              <div key={column.fieldId || column.columnId || column.displayName} className="generic-field-row">
                <span>{column.displayName || column.rawName || column.fieldId}</span>
                <strong>{column.role || "field"}{column.unit ? ` - ${column.unit}` : ""}</strong>
                <small>{formatConfidence(column.confidence)}</small>
              </div>
            ))}
          </div>
          <WarningList warnings={proposal.warnings} />
        </article>
      ))}
    </div>
  );
}

function FieldReviewEditor({ scanResult, fieldRoleOverrides, onFieldRoleOverride }) {
  const proposals = (scanResult?.sheets || []).flatMap((sheet) => (
    (sheet.structureProposals || []).flatMap((proposal) => (
      (proposal.columns || []).map((column) => ({ sheet, proposal, column }))
    ))
  ));
  if (!proposals.length) return null;
  const overrideFor = (fieldId) => fieldRoleOverrides?.[fieldId] || {};
  return (
    <section className="backend-field-review">
      <div className="backend-scan-block-head">
        <strong>Field review</strong>
        <span>{proposals.length} proposed fields</span>
      </div>
      <div className="backend-field-review-grid">
        {proposals.map(({ sheet, proposal, column }) => {
          const fieldId = column.fieldId || column.columnId || `${proposal.tableId}-${column.displayName}`;
          const override = overrideFor(fieldId);
          return (
            <div className="backend-field-review-row" key={`${sheet.sheetId}-${proposal.tableId}-${fieldId}`}>
              <label>
                <span>Name</span>
                <input
                  value={override.displayName ?? column.displayName ?? column.rawName ?? ""}
                  onChange={(event) => onFieldRoleOverride?.(fieldId, { displayName: event.target.value })}
                />
              </label>
              <label>
                <span>Role</span>
                <select
                  value={override.role ?? column.role ?? "measurement"}
                  onChange={(event) => onFieldRoleOverride?.(fieldId, { role: event.target.value })}
                >
                  <option value="identifier">identifier</option>
                  <option value="material">material</option>
                  <option value="condition">condition</option>
                  <option value="measurement">measurement</option>
                  <option value="metadata">metadata</option>
                  <option value="note">note</option>
                </select>
              </label>
              <label>
                <span>Unit</span>
                <input
                  value={override.unit ?? column.unit ?? ""}
                  onChange={(event) => onFieldRoleOverride?.(fieldId, { unit: event.target.value })}
                />
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function refreshDiffStats(summary = {}) {
  return [
    ["Experiments added", summary.experimentsAdded || 0],
    ["Experiments removed", summary.experimentsRemoved || 0],
    ["Experiments changed", summary.experimentsChanged || 0],
    ["Fields added", summary.fieldsAdded || 0],
    ["Fields removed", summary.fieldsRemoved || 0],
    ["Values changed", summary.valuesChanged || 0],
    ["Warnings changed", summary.warningsChanged || 0],
  ];
}

function RefreshDiffPreview({ refreshDraft, onReloadProjectState }) {
  const draft = refreshDraft || {};
  if (draft.loading) return <div className="import-review-empty is-loading">Preparing refresh diff...</div>;
  if (draft.error) {
    const canReload = draft.error.includes("Project data changed");
    return (
      <div className="refresh-diff-error">
        <p className="import-review-error">{draft.error}</p>
        {canReload && <button type="button" onClick={() => onReloadProjectState?.()}>Reload project state</button>}
      </div>
    );
  }
  const preview = draft.preview || null;
  if (!preview) return <div className="import-review-empty">Refresh diff will appear after normalized preview.</div>;
  const stats = refreshDiffStats(preview.summary);
  return (
    <section className={`refresh-diff-panel ${preview.hasChanges ? "" : "no-changes"}`}>
      <WorkflowPanelHeader
        title="Refresh diff"
        detail={preview.hasChanges ? "Review the detected changes before replacing the committed import." : "No changes detected in the replacement workbook."}
        meta={preview.hasChanges ? "changes found" : "no changes"}
      />
      <div className="backend-scan-stats">
        {stats.map(([label, value]) => <span key={label}>{value} {label.toLowerCase()}</span>)}
      </div>
      <p className="backend-scan-muted">
        Target: {preview.targetImportId || "n/a"} - Replacement: {preview.replacementImportId || "n/a"} - Parent commit: {preview.parentDatasetCommitId || "n/a"}
      </p>
      {!preview.hasChanges && <p className="import-review-error">No changes detected. Apply refresh is disabled.</p>}
      <WarningList warnings={preview.warnings} />
    </section>
  );
}

function RelationshipPreview({ relationshipDraft, selectedProposalId, onRelationshipProposalSelect }) {
  const draft = relationshipDraft || {};
  if (draft.loading) return <div className="import-review-empty is-loading">Resolving supplemental workbook relationship...</div>;
  if (draft.error) return <p className="import-review-error">{draft.error}</p>;
  const preview = draft.preview || null;
  if (!preview) return <div className="import-review-empty">Supplement relationship preview will appear after normalized preview.</div>;
  const proposals = Array.isArray(preview.proposals) ? preview.proposals : [];
  const selectable = proposals.filter((proposal) => (
    proposal?.proposedRelationship === "supplement"
    && Array.isArray(proposal.targetExperimentIds)
    && proposal.targetExperimentIds.length
  ));
  return (
    <section className="refresh-diff-panel relationship-preview-panel">
      <WorkflowPanelHeader
        title="Supplement relationship"
        detail={selectable.length ? "Choose the detected relationship before attaching this workbook." : "No supplement target was confidently detected."}
        meta={`${proposals.length} proposals`}
      />
      <div className="backend-scan-stats">
        <span>{preview.summary?.supplementCount || 0} supplement</span>
        <span>{preview.summary?.standaloneCount || 0} standalone</span>
        <span>{preview.summary?.replaceCount || 0} replace-like</span>
      </div>
      {!selectable.length && <p className="import-review-error">No existing experiment target was found. Apply is disabled for supplemental mode.</p>}
      <div className="backend-proposal-grid">
        {proposals.map((proposal) => {
          const canSelect = proposal.proposedRelationship === "supplement"
            && Array.isArray(proposal.targetExperimentIds)
            && proposal.targetExperimentIds.length;
          const active = selectedProposalId === proposal.relationshipProposalId;
          return (
            <article className={`backend-proposal-card ${active ? "is-selected" : ""}`} key={proposal.relationshipProposalId || proposal.importId}>
              <div className="backend-scan-block-head">
                <strong>{proposal.proposedRelationship || "relationship"}</strong>
                <span>{formatConfidence(proposal.confidence)}</span>
              </div>
              <p className="backend-scan-muted">
                Type: {proposal.supplementType || "n/a"} - Targets: {(proposal.targetExperimentIds || []).join(", ") || "none"}
              </p>
              <ul className="backend-scan-list">
                {(proposal.evidence || []).map((item, index) => (
                  <li key={`${proposal.relationshipProposalId || "evidence"}-${index}`}>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <WarningList warnings={proposal.warnings} />
              <div className="import-review-actions">
                <button
                  type="button"
                  className={active ? "primary" : ""}
                  disabled={!canSelect}
                  onClick={() => onRelationshipProposalSelect?.(proposal.relationshipProposalId)}
                >
                  {active ? "Selected" : "Use this relationship"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <WarningList warnings={preview.warnings} />
    </section>
  );
}

function observationSetSummary(observationSet) {
  const summary = observationSet?.summary || {};
  const timeRange = summary.timeMin != null && summary.timeMax != null
    ? `${Number(summary.timeMin).toFixed(2)} to ${Number(summary.timeMax).toFixed(2)} min`
    : "time range n/a";
  return [
    observationSet?.inferredExperimentLabel || "unknown experiment",
    `${summary.observationCount ?? (observationSet?.observations || []).length} observations`,
    timeRange,
  ].join(" - ");
}

function ObservationSetList({ observationSets }) {
  const sets = Array.isArray(observationSets) ? observationSets : [];
  if (!sets.length) return null;
  return (
    <div className="observation-set-list">
      {sets.map((set) => (
        <article className="observation-set-card" key={set.observationSetId}>
          <div className="backend-scan-block-head">
            <strong>{set.kind || "observation_set"}</strong>
            <span>{set.inferredExperimentLabel || "target pending"}</span>
          </div>
          <p className="backend-scan-muted">{observationSetSummary(set)}</p>
          <p className="backend-scan-muted">
            Fields: {(set.fields || []).slice(0, 5).map((field) => field.displayName || field.field).join(", ") || "None"}
          </p>
        </article>
      ))}
    </div>
  );
}

function NormalizedPreview({ normalizeState, onApplyNormalize, mode = "append", refreshDraft, relationshipDraft, onRelationshipProposalSelect, onReloadProjectState }) {
  const state = normalizeState || {};
  const result = state.result || null;
  if (state.loading) return <div className="import-review-empty is-loading">Preparing normalized preview...</div>;
  if (state.error) return <p className="import-review-error">{state.error}</p>;
  if (!result) return <div className="import-review-empty">No normalized preview yet.</div>;

  const genericImports = result.datasetPatch?.genericImports || [];
  const experimentCount = result.summary?.createdExperiments ?? genericImports.reduce((total, item) => total + (item.experiments?.length || 0), 0);
  const fieldCount = result.summary?.createdFields ?? genericImports.reduce((total, item) => {
    const fields = item.fields?.length ? item.fields : item.measurements;
    return total + (fields?.length || 0);
  }, 0);
  const measurementCount = result.summary?.createdMeasurements ?? genericImports.reduce((total, item) => total + (item.measurements?.length || 0), 0);
  const observationSetCount = genericImports.reduce((total, item) => total + (item.observationSets?.length || 0), 0);
  const observationCount = genericImports.reduce((total, item) => (
    total + (item.observationSets || []).reduce((setTotal, set) => setTotal + (set.summary?.observationCount ?? (set.observations?.length || 0)), 0)
  ), 0);
  const warningCountValue = result.summary?.warningCount ?? genericImports.reduce((total, item) => total + (item.warnings?.length || 0), 0);
  const isRefreshMode = mode === "refresh";
  const isSupplementMode = mode === "supplement";
  const selectedRelationship = (relationshipDraft?.preview?.proposals || []).find((proposal) => (
    proposal.relationshipProposalId === relationshipDraft?.selectedProposalId
  ));
  const canApply = genericImports.length > 0
    && (!isRefreshMode || (!!refreshDraft?.preview?.hasChanges && !refreshDraft?.loading && !refreshDraft?.error))
    && (!isSupplementMode || (
      !!selectedRelationship
      && selectedRelationship.proposedRelationship === "supplement"
      && Array.isArray(selectedRelationship.targetExperimentIds)
      && selectedRelationship.targetExperimentIds.length > 0
      && !relationshipDraft?.loading
      && !relationshipDraft?.error
    ));
  const applyLabel = isRefreshMode ? "Apply refresh" : isSupplementMode ? "Apply supplemental import" : "Apply normalized data";

  return (
    <div className="backend-normalize-preview">
      <div className="backend-scan-stats">
        <span>{genericImports.length} generic imports</span>
        <span>{experimentCount} experiments</span>
        <span>{fieldCount} fields</span>
        <span>{measurementCount} measurements</span>
        {observationSetCount > 0 && <span>{observationSetCount} observation sets</span>}
        {observationCount > 0 && <span>{observationCount} observations</span>}
        <span>{warningCountValue} warnings</span>
      </div>
      <div className="backend-normalize-toolbar workflow-action-row">
        <button
          type="button"
          className="primary"
          disabled={!canApply}
          onClick={() => onApplyNormalize?.()}
        >
          {applyLabel}
        </button>
        {state.applied && <span className="workflow-status is-applied">{isRefreshMode ? "Refresh applied to project" : isSupplementMode ? "Supplemental import applied to project" : "Normalized data applied to project"}</span>}
      </div>
      {isRefreshMode && <RefreshDiffPreview refreshDraft={refreshDraft} onReloadProjectState={onReloadProjectState} />}
      {isSupplementMode && (
        <RelationshipPreview
          relationshipDraft={relationshipDraft}
          selectedProposalId={relationshipDraft?.selectedProposalId}
          onRelationshipProposalSelect={onRelationshipProposalSelect}
        />
      )}
      {genericImports.map((item) => (
        <article className="backend-normalize-card" key={item.importId}>
          <div className="backend-scan-block-head">
            <strong>{item.fileName || item.importId}</strong>
            <span>{item.approvedBlockIds?.length || 0} approved blocks</span>
          </div>
          <p className="backend-scan-muted">
            Sources: {item.sources?.length || 0} - Files: {item.files?.length || 0}
          </p>
          <ObservationSetList observationSets={item.observationSets} />
          <p className="backend-scan-muted">
            Fields: {((item.fields?.length ? item.fields : item.measurements) || []).slice(0, 4).map((field) => `${field.displayName}${field.role ? ` (${field.role})` : ""}`).join(", ") || "None"}
          </p>
        </article>
      ))}
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}

function MappingProposalReview({ genericImports, mappingState, onProposeMappings, onMappingDecision }) {
  const state = mappingState || {};
  const mappingSet = state.result?.mappingSet || null;
  const mappings = mappingSet?.mappings || [];
  const warningCountValue = mappingSet?.warnings?.length || 0;
  const canPropose = genericImports.length > 0 && !state.loading;

  return (
    <section className="backend-proposal-section">
      <WorkflowPanelHeader
        title="Semantic mappings"
        detail="Review accepted fields before they become Browser columns and chart inputs."
        meta={`${mappings.length} proposals`}
      />
      <div className="backend-normalize-toolbar">
        <button
          type="button"
          className="primary"
          disabled={!canPropose}
          onClick={() => onProposeMappings?.()}
        >
          {state.loading ? "Proposing mappings..." : "Propose mappings"}
        </button>
      </div>
      {state.error && <p className="import-review-error">{state.error}</p>}
      {!mappingSet && !state.loading && <div className="import-review-empty">No semantic mapping proposals yet.</div>}
      {mappingSet && (
        <div className="backend-proposal-grid">
          <div className="backend-scan-stats">
            <span>{mappings.length} mappings</span>
            <span>{mappings.filter((mapping) => mapping.status === "accepted").length} accepted</span>
            <span>{mappings.filter((mapping) => mapping.status === "rejected").length} rejected</span>
            <span>{warningCountValue} warnings</span>
          </div>
          {mappings.map((mapping) => (
            <article className="backend-proposal-card" key={mapping.mappingId}>
              <div className="backend-scan-block-head">
                <strong>{mapping.rawLabel || mapping.mappingId}</strong>
                <span>{mapping.semanticRole} - {formatConfidence(mapping.confidence)}</span>
              </div>
              <p className="backend-scan-muted">
                {mapping.canonicalField} - {mapping.valueType}{mapping.unit ? ` - ${mapping.unit}` : ""}
              </p>
              <p className="backend-scan-muted">{mapping.rationale}</p>
              <WarningList warnings={mapping.warnings} />
              <div className="import-review-actions decision-actions">
                <button
                  type="button"
                  className={mapping.status === "accepted" ? "primary" : ""}
                  onClick={() => onMappingDecision?.(mapping.mappingId, "accepted")}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className={mapping.status === "rejected" ? "primary" : ""}
                  onClick={() => onMappingDecision?.(mapping.mappingId, "rejected")}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ChartProposalCard({ proposal, genericImports, chartProposalSetId, chartSpecs, onChartProposalDecision, onCreateChartSpec }) {
  const preview = makeGenericChartPreview(proposal, genericImports);
  const existingSpec = (chartSpecs || []).find((spec) => spec.sourceProposalId === proposal.proposalId);
  return (
    <article className="backend-proposal-card backend-chart-proposal-card">
      <div className="backend-scan-block-head">
        <strong>{proposal.title || proposal.proposalId}</strong>
        <span>{proposal.chartType} - {formatConfidence(proposal.confidence)}</span>
      </div>
      <div className="generic-chart-preview">
        <Plot
          traces={preview.traces}
          layout={preview.layout}
          config={{ staticPlot: true, displayModeBar: false }}
          className="generic-chart-preview-plot"
        />
      </div>
      <p className="backend-scan-muted">{proposal.rationale || proposal.reason}</p>
      <p className="backend-scan-muted">
        X: {proposal.x?.label || proposal.x?.field || "n/a"}{proposal.x?.unit ? ` (${proposal.x.unit})` : ""}
        {" - "}
        Y: {proposal.y?.label || proposal.y?.field || "n/a"}{proposal.y?.unit ? ` (${proposal.y.unit})` : ""}
      </p>
      <WarningList warnings={proposal.warnings} />
      <div className="import-review-actions">
        <button
          type="button"
          className={proposal.status === "accepted" ? "primary" : ""}
          onClick={() => onChartProposalDecision?.(proposal.proposalId, "accepted")}
        >
          Accept
        </button>
        <button
          type="button"
          className={proposal.status === "rejected" ? "primary" : ""}
          onClick={() => onChartProposalDecision?.(proposal.proposalId, "rejected")}
        >
          Reject
        </button>
        {proposal.status === "accepted" && (
          <button
            type="button"
            disabled={!!existingSpec || !chartProposalSetId}
            onClick={() => onCreateChartSpec?.(chartProposalSetId, proposal.proposalId)}
          >
            {existingSpec ? "Chart spec created" : "Create chart spec"}
          </button>
        )}
      </div>
    </article>
  );
}

function ChartProposalReview({ genericImports, mappingState, chartProposalState, chartSpecs, onProposeCharts, onChartProposalDecision, onCreateChartSpec }) {
  const state = chartProposalState || {};
  const proposalSet = state.result?.proposalSet || null;
  const proposals = proposalSet?.proposals || [];
  const chartProposalSetId = state.result?.chartProposalSet?.id || proposalSet?.serverId || state.result?.chartProposalSetId || null;
  const canPropose = genericImports.length > 0 && !state.loading;

  return (
    <section className="backend-proposal-section">
      <WorkflowPanelHeader
        title="Chart proposals"
        detail="Accept proposed charts, then create ChartSpecs for Manuscript insertion."
        meta={`${proposals.length} proposals`}
      />
      <div className="backend-normalize-toolbar workflow-action-row">
        <button
          type="button"
          className="primary"
          disabled={!canPropose}
          onClick={() => onProposeCharts?.()}
        >
          {state.loading ? "Proposing charts..." : "Propose charts"}
        </button>
      </div>
      {state.error && <p className="import-review-error">{state.error}</p>}
      {!proposalSet && !state.loading && <div className="import-review-empty">No chart proposals yet.</div>}
      {proposalSet && (
        <div className="backend-proposal-grid">
          <div className="backend-scan-stats">
            <span>{proposals.length} charts</span>
            <span>{proposals.filter((proposal) => proposal.status === "accepted").length} accepted</span>
            <span>{proposals.filter((proposal) => proposal.status === "rejected").length} rejected</span>
            <span>{proposalSet.warnings?.length || 0} warnings</span>
          </div>
          {proposals.map((proposal) => (
            <ChartProposalCard
              key={proposal.proposalId}
              proposal={proposal}
              genericImports={genericImports}
              chartProposalSetId={chartProposalSetId}
              chartSpecs={chartSpecs}
              onChartProposalDecision={onChartProposalDecision}
              onCreateChartSpec={onCreateChartSpec}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ChartInterpretReview({ genericImports, chartInterpretState, onInterpretChart }) {
  const [prompt, setPrompt] = React.useState("");
  const state = chartInterpretState || {};
  const draft = state.result?.chartSpecDraft || null;
  const clarification = state.result?.clarification || null;
  const persistedProposalSet = state.result?.chartProposalSet || null;
  const canInterpret = genericImports.length > 0 && prompt.trim() && !state.loading;
  const preview = draft && !persistedProposalSet ? makeGenericChartPreview(draft, genericImports) : null;
  const persistedProposalCount = persistedProposalSet?.payload?.proposals?.length || 0;

  return (
    <section className="backend-proposal-section">
      <WorkflowPanelHeader
        title="One-chart prompt"
        detail="Draft one chart proposal from a natural-language request; final review stays in Chart proposals."
        meta={persistedProposalSet ? `${persistedProposalCount} queued` : ""}
      />
      <div className="backend-normalize-toolbar chart-intent-toolbar workflow-action-row">
        <label className="chart-intent-input">
          <span>Ask for one chart</span>
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="e.g. plot gas selectivity vs temperature grouped by catalyst"
          />
        </label>
        <button
          type="button"
          className="primary"
          disabled={!canInterpret}
          onClick={() => onInterpretChart?.(prompt)}
        >
          {state.loading ? "Drafting chart..." : "Draft chart proposal"}
        </button>
      </div>
      {state.error && <p className="import-review-error">{state.error}</p>}
      {!state.result && !state.loading && <div className="import-review-empty">No one-chart prompt yet.</div>}
      {clarification && (
        <article className="backend-proposal-card">
          <div className="backend-scan-block-head">
            <strong>Need clarification</strong>
            <span>{clarification.options?.length || 0} options</span>
          </div>
          <p className="backend-scan-muted">{clarification.message}</p>
          <div className="chips">
            {(clarification.options || []).map((option) => (
              <span className="chip" key={option.fieldId || option.label}>{option.label}</span>
            ))}
          </div>
        </article>
      )}
      {persistedProposalSet && (
        <article className="backend-inline-status">
          <div className="backend-scan-block-head">
            <strong>Chart proposal queued</strong>
            <span>{persistedProposalCount} proposals</span>
          </div>
          <p className="backend-scan-muted">
            Review it in Chart proposals to accept, reject, or create a ChartSpec for Manuscript.
          </p>
        </article>
      )}
      {draft && !persistedProposalSet && (
        <article className="backend-proposal-card backend-chart-proposal-card">
          <div className="backend-scan-block-head">
            <strong>{draft.title || "ChartSpec draft"}</strong>
            <span>{draft.chartType} - {formatConfidence(draft.confidence)}</span>
          </div>
          {preview && (
            <div className="generic-chart-preview">
              <Plot
                traces={preview.traces}
                layout={preview.layout}
                config={{ staticPlot: true, displayModeBar: false }}
                className="generic-chart-preview-plot"
              />
            </div>
          )}
          <p className="backend-scan-muted">{draft.rationale}</p>
          <p className="backend-scan-muted">
            X: {draft.x?.label || "n/a"}{draft.x?.unit ? ` (${draft.x.unit})` : ""}
            {" - "}
            Y: {(draft.yFields?.length ? draft.yFields : [draft.y]).filter(Boolean).map((axis) => axis.label || axis.field).join(", ") || "n/a"}
          </p>
          {draft.groupBy && <p className="backend-scan-muted">Group by: {draft.groupBy.label || draft.groupBy.field}</p>}
          <WarningList warnings={draft.warnings} />
          <p className="backend-scan-muted">
            Preview-only draft. Use a server project with a dataset commit to accept this chart, create a chart spec, and insert it into Manuscript.
          </p>
        </article>
      )}
    </section>
  );
}

function MetadataList({ metadata }) {
  const items = Array.isArray(metadata) ? metadata : [];
  if (!items.length) return <span className="backend-scan-muted">No metadata</span>;
  return (
    <ul className="backend-scan-list">
      {items.map((item, index) => (
        <li key={`${item.rawKey || "metadata"}-${index}`}>
          <strong>{item.rawKey || "Metadata"}</strong>
          <span>{item.rawValue ?? ""}{item.unit ? ` (${item.unit})` : ""}</span>
          <em>{sourceLabel(item.source)}</em>
        </li>
      ))}
    </ul>
  );
}

function HeaderList({ headers }) {
  const items = Array.isArray(headers) ? headers : [];
  if (!items.length) return <span className="backend-scan-muted">No headers</span>;
  return (
    <ul className="backend-scan-list">
      {items.map((header, index) => (
        <li key={`${header.range || "header"}-${index}`}>
          <strong>{header.range || `row ${header.row}`}</strong>
          <span>{(header.columns || []).map((column) => `${column.rawName || column.label || column.address}${column.unit ? ` [${column.unit}]` : ""}`).join(", ")}</span>
          <em>{formatConfidence(header.confidence)}</em>
        </li>
      ))}
    </ul>
  );
}

function BlockList({ blocks, blockReview, onBlockReviewDecision }) {
  const items = Array.isArray(blocks) ? blocks : [];
  if (!items.length) return <span className="backend-scan-muted">No blocks</span>;
  return (
    <div className="backend-scan-blocks">
      {items.map((block) => {
        const decision = blockReviewDecision(blockReview, block.blockId);
        return (
          <article className="backend-scan-block" key={block.blockId}>
            <div className="backend-scan-block-head">
              <strong>{block.blockId}</strong>
              <span>{block.type} - {formatConfidence(block.confidence)}</span>
            </div>
            <div className="backend-scan-review-actions decision-actions" aria-label={`Review ${block.blockId}`}>
              <span>Review: {decision}</span>
              <button
                type="button"
                className={decision === "approved" ? "active" : ""}
                onClick={() => onBlockReviewDecision?.(block.blockId, "approved")}
              >
                Approve
              </button>
              <button
                type="button"
                className={decision === "ignored" ? "active" : ""}
                onClick={() => onBlockReviewDecision?.(block.blockId, "ignored")}
              >
                Ignore
              </button>
            </div>
            <div className="backend-scan-kv">
              <span>Range</span><strong>{block.range || sourceLabel(block.source)}</strong>
              <span>Rows</span><strong>{block.table?.rows?.length ?? 0}</strong>
              <span>Source</span><strong>{sourceLabel(block.source)}</strong>
            </div>
            {block.observationSetPreview && (
              <p className="backend-scan-muted">
                Detected supplemental time series: {block.observationSetPreview.inferredExperimentLabel || "unknown experiment"} - {block.observationSetPreview.kind}
              </p>
            )}
            {block.title && <p className="backend-scan-muted">Title: {block.title.value || block.title.rawValue} - {sourceLabel(block.title.source)}</p>}
            <div className="backend-scan-subgrid">
              <div><h5>Metadata</h5><MetadataList metadata={block.metadata || block.candidateMetadata} /></div>
              <div><h5>Warnings</h5><WarningList warnings={block.warnings} /></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function ChartReviewPanel({
  genericImports = [],
  mappingState,
  chartProposalState,
  chartInterpretState,
  chartSpecs,
  onProposeCharts,
  onChartProposalDecision,
  onInterpretChart,
  onCreateChartSpec,
}) {
  return (
    <div className="chart-review-panel">
      <ChartInterpretReview
        genericImports={genericImports}
        chartInterpretState={chartInterpretState}
        onInterpretChart={onInterpretChart}
      />
      <ChartProposalReview
        genericImports={genericImports}
        mappingState={mappingState}
        chartProposalState={chartProposalState}
        chartSpecs={chartSpecs}
        onProposeCharts={onProposeCharts}
        onChartProposalDecision={onChartProposalDecision}
        onCreateChartSpec={onCreateChartSpec}
      />
    </div>
  );
}

function SheetDetails({ sheet, blockReview, onBlockReviewDecision }) {
  return (
    <article className="backend-scan-sheet">
      <div className="backend-scan-sheet-head">
        <div>
          <strong>{sheet.name || sheet.sheetId}</strong>
          <span>{sheet.usedRange || "no used range"}</span>
        </div>
        <span>{sheet.layout?.type || "unknown"} - {formatConfidence(sheet.layout?.confidence)}</span>
      </div>
      <div className="backend-scan-stats">
        <span>{sheet.rowCount ?? sheet.cellGrid?.rowCount ?? 0} rows</span>
        <span>{sheet.columnCount ?? sheet.cellGrid?.columnCount ?? 0} columns</span>
        <span>{sheet.blocks?.length || 0} blocks</span>
        <span>{sheet.warnings?.length || 0} warnings</span>
      </div>
      <div className="backend-scan-subgrid">
        <div><h5>Headers</h5><HeaderList headers={sheet.candidateHeaders} /></div>
        <div><h5>Metadata</h5><MetadataList metadata={sheet.candidateMetadata} /></div>
      </div>
      <div><h5>Structure proposals</h5><StructureProposalList structureProposals={sheet.structureProposals} /></div>
      <div className="backend-scan-subgrid">
        <div><h5>Blocks</h5><BlockList blocks={sheet.blocks} blockReview={blockReview} onBlockReviewDecision={onBlockReviewDecision} /></div>
        <div><h5>Warnings</h5><WarningList warnings={sheet.warnings} /></div>
      </div>
    </article>
  );
}

export function BackendScanPanel({
  mode = "append",
  refreshDraft,
  relationshipDraft,
  scanState,
  blockReview,
  normalizeState,
  mappingState,
  genericImports: genericImportsOverride,
  fieldRoleOverrides,
  onScanFile,
  onBlockReviewDecision,
  onFieldRoleOverride,
  onPreviewNormalize,
  onApplyNormalize,
  onRelationshipProposalSelect,
  onProposeMappings,
  onMappingDecision,
  onReloadProjectState,
}) {
  const state = scanState || {};
  const isRefreshMode = mode === "refresh";
  const isSupplementMode = mode === "supplement";
  const result = state.result || null;
  const sheetCount = result?.summary?.sheetCount ?? result?.sheets?.length ?? 0;
  const blockCount = result?.summary?.blockCount ?? result?.sheets?.reduce((total, sheet) => total + (sheet.blocks?.length || 0), 0) ?? 0;
  const approvedCount = blockReview?.approvedBlockIds?.length || 0;
  const previewImports = normalizeState?.result?.datasetPatch?.genericImports || [];
  const genericImports = previewImports.length ? previewImports : (genericImportsOverride || []);
  const mappingSet = mappingState?.result?.mappingSet || null;
  const workflowSteps = [
    {
      label: "Scan workbook",
      detail: result ? `${sheetCount} sheets` : "choose .xlsx",
      status: state.loading ? "active" : result ? "done" : "pending",
    },
    {
      label: "Review blocks/fields",
      detail: result ? `${approvedCount} approved` : "after scan",
      status: result ? (approvedCount ? "done" : "active") : "pending",
    },
    {
      label: "Preview/apply data",
      detail: normalizeState?.applied
        ? "applied"
        : isRefreshMode && refreshDraft?.preview
          ? "diff ready"
          : isSupplementMode && relationshipDraft?.preview
            ? "relationship ready"
            : normalizeState?.result ? "preview ready" : "review first",
      status: normalizeState?.loading ? "active" : normalizeState?.applied ? "done" : normalizeState?.result ? "active" : "pending",
    },
    {
      label: "Semantic mappings",
      detail: mappingSet ? `${mappingSet.mappings?.length || 0} proposals` : "after data",
      status: mappingState?.loading ? "active" : mappingSet ? "done" : "pending",
    },
  ];

  return (
    <section className="import-review-section backend-scan-panel">
      <div className="import-review-section-head">
        <h3>Backend scan</h3>
        <span>{state.loading ? "scanning" : result ? "ready" : "idle"}</span>
      </div>
      <WorkflowStepStrip steps={workflowSteps} />
      <div className="backend-scan-toolbar workflow-action-row">
        <label className={`folder-btn backend-scan-upload ${state.loading ? "disabled" : ""}`}>
          {state.loading ? "Scanning..." : isRefreshMode ? "Scan replacement workbook" : isSupplementMode ? "Scan supplemental workbook" : "Scan workbook"}
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={state.loading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onScanFile?.(file);
              event.target.value = "";
            }}
          />
        </label>
        {state.fileName && <span className="backend-scan-file">{state.fileName}</span>}
      </div>
      {state.error && <p className="import-review-error">{state.error}</p>}
      {result ? (
        <div className="backend-scan-debug">
          <div className="backend-scan-stats">
            <span>{sheetCount} sheets</span>
            <span>{blockCount} blocks</span>
            <span>{warningCount(result)} warnings</span>
          </div>
          <div className="backend-scan-sheets">
            {(result.sheets || []).map((sheet) => (
              <SheetDetails
                key={sheet.sheetId || sheet.name}
                sheet={sheet}
                blockReview={blockReview}
                onBlockReviewDecision={onBlockReviewDecision}
              />
            ))}
          </div>
          <FieldReviewEditor
            scanResult={result}
            fieldRoleOverrides={fieldRoleOverrides}
            onFieldRoleOverride={onFieldRoleOverride}
          />
          <div className="backend-normalize-toolbar">
            <button
              type="button"
              className="primary"
              disabled={!approvedCount || normalizeState?.loading}
              onClick={() => onPreviewNormalize?.()}
            >
              {normalizeState?.loading ? "Previewing..." : "Preview normalized output"}
            </button>
            <span>{approvedCount} approved blocks</span>
          </div>
          <NormalizedPreview
            normalizeState={normalizeState}
            onApplyNormalize={onApplyNormalize}
            mode={mode}
            refreshDraft={refreshDraft}
            relationshipDraft={relationshipDraft}
            onRelationshipProposalSelect={onRelationshipProposalSelect}
            onReloadProjectState={onReloadProjectState}
          />
          <MappingProposalReview
            genericImports={genericImports}
            mappingState={mappingState}
            onProposeMappings={onProposeMappings}
            onMappingDecision={onMappingDecision}
          />
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : (
        <div>
          <div className="import-review-empty">No backend scan yet.</div>
          {genericImports.length > 0 && (
            <>
              <MappingProposalReview
                genericImports={genericImports}
                mappingState={mappingState}
                onProposeMappings={onProposeMappings}
                onMappingDecision={onMappingDecision}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
