import React, { useState } from "react";
import { summarizeWorkbookBatch } from "../data/workbookBatchUpload.js";
import { useWorkspacePermissions } from "./WorkspacePermissions.jsx";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export const WORKBOOK_BATCH_STATUS_LABELS = {
  pending: "Waiting",
  uploading: "Uploading",
  uploaded: "Indexed",
  failed: "Failed",
};

function workbookBatchSuggestionLabel(suggestion) {
  if (!suggestion) return "";
  switch (suggestion.status) {
    case "matched":
      return `Suggested: ${suggestion.match?.label || suggestion.label}`;
    case "unmatched":
      return `${suggestion.label} is not in Experiment Browser yet`;
    case "ambiguous":
      return `${suggestion.label} matches several experiments`;
    default:
      return "No experiment number in the file name";
  }
}

const TEMPLATE_MATCH_LABELS = {
  exact: "Exact match",
  shifted: "Shifted match",
  ambiguous: "Ambiguous",
  label_missing: "Label missing",
  formula_mismatch: "Formula mismatch",
  header_mismatch: "Header mismatch",
  no_match: "No match",
};

export function templateMatchDetail(result) {
  if (!result) return "";
  const parts = [];
  if (result.matchedRange) parts.push(`${result.sheetName ? `${result.sheetName}!` : ""}${result.matchedRange}`);
  if (result.status === "shifted" && result.offset) {
    const rows = result.offset.rows ? `${Math.abs(result.offset.rows)} row${Math.abs(result.offset.rows) === 1 ? "" : "s"} ${result.offset.rows > 0 ? "down" : "up"}` : "";
    const cols = result.offset.cols ? `${Math.abs(result.offset.cols)} column${Math.abs(result.offset.cols) === 1 ? "" : "s"} ${result.offset.cols > 0 ? "right" : "left"}` : "";
    parts.push(`moved ${[rows, cols].filter(Boolean).join(" and ")}`);
  }
  if (result.experimentLabel) parts.push(result.labelSource === "filename" ? `${result.experimentLabel} from file name` : result.experimentLabel);
  if (result.status === "ambiguous" && asArray(result.alternatives).length) {
    parts.push(`${result.alternatives.length} candidate blocks: ${result.alternatives.map((item) => item.matchedRange).join(", ")}`);
  }
  if (result.status === "formula_mismatch") {
    const mismatches = asArray(result.formulaMismatches);
    const text = mismatches.filter((item) => item.found === "other_value").map((item) => item.address);
    const other = mismatches.filter((item) => item.found !== "other_value").map((item) => item.address);
    if (text.length) parts.push(`text where values are expected at ${text.slice(0, 6).join(", ")}`);
    if (other.length) parts.push(`layout differs at ${other.slice(0, 6).join(", ")}`);
    const broken = asArray(result.brokenCells).map((item) => item.address);
    if (broken.length) parts.push(`typed over upstream: ${broken.slice(0, 6).join(", ")}`);
  }
  if (result.status === "header_mismatch") {
    const run = asArray(result.headerRuns).find((item) => !item.ok);
    if (run) parts.push(`${run.foundCount} of ${run.expectedCount} header cells found`);
  }
  if (result.status === "label_missing") parts.push("no experiment label in the sheet or file name");
  if (["exact", "shifted"].includes(result.status) && asArray(result.typedOverCells).length) {
    const groups = [["typed_number", "typed values at"], ["typed_upstream", "typed inputs at"], ["blank", "blank at"], ["different_formula", "different formulas at"]];
    for (const [found, label] of groups) {
      const addresses = asArray(result.typedOverCells).filter((item) => item.found === found).map((item) => item.address);
      if (addresses.length) parts.push(`${label} ${addresses.slice(0, 6).join(", ")}${addresses.length > 6 ? ` and ${addresses.length - 6} more` : ""}`);
    }
  }
  return parts.join(" · ");
}

function workbookBatchInterpretationLabel(progress) {
  if (!progress || !progress.total) return "";
  const done = Math.max(0, progress.total - progress.pending);
  if (progress.pending) return `Understanding regions ${done}/${progress.total}`;
  if (progress.failed) return `${progress.failed} region${progress.failed === 1 ? "" : "s"} need${progress.failed === 1 ? "s" : ""} retry`;
  return "Regions understood";
}

export function WorkbookBatchCard({
  batch,
  interpretation = {},
  openingSessionId = "",
  canRetry = false,
  retrying = false,
  templates = [],
  matching = false,
  applying = false,
  confirming = false,
  experiments = [],
  onOpen,
  onRetry,
  onMatchTemplate,
  onApplyTemplate,
  onConfirmApplied,
}) {
  const { canApprove } = useWorkspacePermissions();
  const items = asArray(batch?.items);
  const summary = summarizeWorkbookBatch(items);
  const running = summary.pending > 0 || summary.uploading > 0;
  const match = batch?.match || null;
  const apply = batch?.apply || null;
  const appliedRows = asArray(apply?.items);
  const [selectionOverrides, setSelectionOverrides] = useState({});
  const [chosenLinks, setChosenLinks] = useState({});
  const eligibleMatches = asArray(match?.results).filter((result) => result.eligibleForBatchConfirm && !result.isTemplateSource);
  const confirmableRows = appliedRows.filter((row) => !row.confirmed && row.regionId && !row.needsIndividualConfirm);
  const individualRows = appliedRows.filter((row) => !row.confirmed && row.regionId && row.needsIndividualConfirm);
  const rowLink = (row) => (chosenLinks[row.regionId] !== undefined ? chosenLinks[row.regionId] : row.linkedExperimentId || "");
  // Rows that arrived already linked are selected by default; the user can
  // untick them, and rows that needed a manual link are ticked explicitly.
  const isRowSelected = (row) => (
    !row.confirmed
    && Boolean(rowLink(row))
    && (selectionOverrides[row.regionId] !== undefined ? selectionOverrides[row.regionId] : Boolean(row.linkedExperimentId) && !row.typedOver)
  );
  const toggleRow = (regionId, checked) => {
    setSelectionOverrides((current) => ({ ...current, [regionId]: checked }));
  };
  const selectAll = () => setSelectionOverrides(Object.fromEntries(confirmableRows.filter((row) => rowLink(row)).map((row) => [row.regionId, true])));
  const selectedRows = confirmableRows.filter(isRowSelected);
  const confirmSelected = () => {
    const selection = selectedRows
      .map((row) => ({
        regionId: row.regionId,
        revisionId: row.revisionId,
        expectedRegionVersion: row.regionVersion,
        ...(rowLink(row) !== (row.linkedExperimentId || "") ? { linkedExperimentId: rowLink(row) } : {}),
      }));
    if (canApprove && selection.length) onConfirmApplied?.(batch, selection);
  };
  const activeTemplates = asArray(templates).filter((template) => template?.status !== "archived" && template?.currentVersionId);
  const [selectedTemplateId, setSelectedTemplateId] = useState(match?.templateId || activeTemplates[0]?.id || "");
  const matchable = items.some((item) => item.status === "uploaded" && item.workbookReviewLink?.sourceDocumentId);
  const resultsByDocument = new Map(asArray(match?.results).map((result) => [result.sourceDocumentId, result]));
  const matchSummary = match?.summary || {};
  return (
    <div className="agent-workbook-batch" aria-label="Workbook batch upload">
      <div className="agent-workbook-batch-head">
        <strong>{summary.uploaded}/{summary.total} workbooks indexed</strong>
        {summary.failed > 0 && canRetry && !running && (
          <button type="button" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying failed files" : `Retry ${summary.failed} failed`}
          </button>
        )}
      </div>
      {matchable && !running && onMatchTemplate && (
        <div className="agent-workbook-batch-template" aria-label="Match an extraction template">
          {activeTemplates.length ? (
            <>
              <label htmlFor={`batch-template-${batch.batchId}`}>Extraction template</label>
              <select
                id={`batch-template-${batch.batchId}`}
                value={activeTemplates.some((template) => template.id === selectedTemplateId) ? selectedTemplateId : activeTemplates[0].id}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                disabled={matching}
              >
                {activeTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}{template.anchorRange ? ` (${template.sheetName ? `${template.sheetName}!` : ""}${template.anchorRange})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={matching}
                onClick={() => onMatchTemplate(batch, activeTemplates.find((template) => template.id === selectedTemplateId) || activeTemplates[0])}
              >
                {matching ? "Matching workbooks" : match ? "Match again" : "Match workbooks"}
              </button>
            </>
          ) : (
            <small>Confirm a region in one workbook and save it as an extraction template to match the others.</small>
          )}
          {match && (
            <small className="agent-workbook-batch-template-summary">
              {match.templateName} v{match.templateVersion}: {Object.entries(matchSummary).map(([status, count]) => `${count} ${(TEMPLATE_MATCH_LABELS[status] || status).toLowerCase()}`).join(", ")}
            </small>
          )}
          {match?.error && <small className="agent-workbook-batch-error">{match.error}</small>}
          {match && eligibleMatches.length > 0 && onApplyTemplate && (
            <button
              type="button"
              className="agent-workbook-batch-apply"
              disabled={applying || matching}
              onClick={() => onApplyTemplate(batch, eligibleMatches.map((result) => result.sourceDocumentId))}
            >
              {applying ? "Applying template" : `Apply to ${eligibleMatches.length} matched file${eligibleMatches.length === 1 ? "" : "s"}`}
            </button>
          )}
          {apply?.error && <small className="agent-workbook-batch-error">{apply.error}</small>}
        </div>
      )}
      {appliedRows.length > 0 && (
        <div className="agent-workbook-batch-confirm" aria-label="Confirm prefilled regions">
          <div className="agent-workbook-batch-confirm-head">
            <strong>
              {appliedRows.filter((row) => row.confirmed).length}/{appliedRows.length} prefilled regions confirmed
              {individualRows.length ? ` · ${individualRows.length} need${individualRows.length === 1 ? "s" : ""} individual confirmation` : ""}
              {confirmableRows.filter((row) => row.typedOver).length ? ` · ${confirmableRows.filter((row) => row.typedOver).length} with typed values to check` : ""}
            </strong>
            {canApprove && confirmableRows.length > 0 && (
              <>
                <button type="button" disabled={confirming} onClick={selectAll}>Select all linked</button>
                <button
                  type="button"
                  className="primary"
                  disabled={confirming || !selectedRows.length}
                  onClick={confirmSelected}
                >
                  {confirming ? "Confirming" : `Confirm selected (${selectedRows.length})`}
                </button>
              </>
            )}
          </div>
          <ul className="agent-workbook-batch-confirm-list">
            {appliedRows.map((row) => {
              const link = rowLink(row);
              const checkboxId = `confirm-${batch.batchId}-${row.regionId}`;
              return (
                <li key={row.regionId || row.sourceDocumentId} className={`agent-workbook-batch-confirm-item${row.confirmed ? " is-confirmed" : ""}${row.error ? " is-failed" : ""}`}>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    aria-label={`Select ${row.fileName} for confirmation`}
                    checked={isRowSelected(row)}
                    disabled={!canApprove || row.confirmed || confirming || !link || row.needsIndividualConfirm}
                    onChange={(event) => toggleRow(row.regionId, event.target.checked)}
                  />
                  <label htmlFor={checkboxId} className="agent-workbook-batch-confirm-file">
                    <button
                      type="button"
                      className="agent-workbook-batch-confirm-open"
                      onClick={() => onOpen?.({
                        workbookReviewSessionId: row.workbookReviewSessionId,
                        sourceDocumentId: row.sourceDocumentId,
                        workbookName: row.fileName,
                        regionCount: 0,
                        focusRange: { sheetName: row.sheetName, range: row.range },
                      })}
                    >
                      {row.fileName}
                    </button>
                    <span>{row.sheetName ? `${row.sheetName}!` : ""}{row.range}</span>
                  </label>
                  {row.confirmed ? (
                    <span className="agent-workbook-batch-confirm-status is-confirmed">Confirmed{row.experimentLabel ? ` · ${row.experimentLabel}` : ""}</span>
                  ) : row.needsIndividualConfirm ? (
                    <span className="agent-workbook-batch-confirm-status is-individual">Needs individual confirmation{row.experimentLabel ? ` · ${row.experimentLabel}` : ""}</span>
                  ) : row.linkStatus === "resolved" && row.linkedExperimentId && chosenLinks[row.regionId] === undefined ? (
                    <span className="agent-workbook-batch-confirm-status">{row.experimentLabel || "linked"}</span>
                  ) : (
                    <select
                      aria-label={`Experiment for ${row.fileName}`}
                      value={link}
                      disabled={!canApprove || confirming}
                      onChange={(event) => setChosenLinks((current) => ({ ...current, [row.regionId]: event.target.value }))}
                    >
                      <option value="">Choose experiment{row.experimentLabel ? ` for ${row.experimentLabel}` : ""}</option>
                      {asArray(experiments).map((experiment) => (
                        <option key={experiment.experimentId} value={experiment.experimentId}>{experiment.label}</option>
                      ))}
                    </select>
                  )}
                  {row.warning && !row.confirmed && <small className="agent-workbook-batch-warning">{row.warning}</small>}
                  {row.error && <small className="agent-workbook-batch-error">{row.error}</small>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <ul className="agent-workbook-batch-list">
        {items.map((item) => {
          const link = item.workbookReviewLink;
          const sessionId = link?.workbookReviewSessionId || "";
          const progressLabel = workbookBatchInterpretationLabel(interpretation?.[sessionId]);
          return (
            <li className={`agent-workbook-batch-item is-${item.status}`} key={`${item.index}-${item.fileName}`}>
              <div className="agent-workbook-batch-file">
                {link ? (
                  <button type="button" disabled={openingSessionId === sessionId} onClick={() => onOpen?.(link)}>
                    {item.fileName}
                  </button>
                ) : <span>{item.fileName}</span>}
                <span className={`agent-workbook-batch-status is-${item.status}`}>{WORKBOOK_BATCH_STATUS_LABELS[item.status] || item.status}</span>
              </div>
              <div className="agent-workbook-batch-meta">
                {item.status === "uploaded" && (
                  <span>{link?.regionCount || 0} {link?.regionCount === 1 ? "region" : "regions"}</span>
                )}
                {progressLabel && <span>{progressLabel}</span>}
                {item.suggestedExperiment && (
                  <span className={`agent-workbook-batch-suggestion is-${item.suggestedExperiment.status}`}>
                    {workbookBatchSuggestionLabel(item.suggestedExperiment)}
                  </span>
                )}
              </div>
              {(() => {
                const result = link?.sourceDocumentId ? resultsByDocument.get(link.sourceDocumentId) : null;
                if (!result) return null;
                return (
                  <div className="agent-workbook-batch-match" aria-label={`Template match for ${item.fileName}`}>
                    <span className={`agent-workbook-batch-match-status is-${result.status}`}>{TEMPLATE_MATCH_LABELS[result.status] || result.status}</span>
                    {result.isTemplateSource && <span className="agent-workbook-batch-match-source">template source</span>}
                    <span>{templateMatchDetail(result)}</span>
                    {result.status === "formula_mismatch" && (
                      <small className="agent-workbook-batch-match-note">
                        This file has text or labels where the template expects values, so the block is not treated as the same layout. Confirm it individually, or draw the block by hand and link it as this data kind.
                      </small>
                    )}
                    {!result.eligibleForBatchConfirm && result.matchedRange && link && (
                      <button
                        type="button"
                        className="agent-workbook-batch-match-open"
                        onClick={() => onOpen?.({ ...link, focusRange: { sheetName: result.sheetName, range: result.matchedRange } })}
                      >
                        Review in workbook
                      </button>
                    )}
                  </div>
                );
              })()}
              {item.error && <small className="agent-workbook-batch-error">{item.error}</small>}
            </li>
          );
        })}
      </ul>
      {summary.failed > 0 && !canRetry && (
        <small className="agent-workbook-batch-note">Re-attach the failed files to upload them again.</small>
      )}
    </div>
  );
}
