import React from "react";
import { makeSourceChartPreview } from "../charts/sourceChartPreview.js";
import { Plot } from "../charts/Plot.jsx";
import {
  listServerSourceDocumentRegions,
  listServerSourceDocuments,
  previewServerSourceDocumentExtract,
  previewServerSourceRegionExtract,
  readServerSourceDocumentRange,
} from "../data/serverApi.js";
import { ThinkingIndicator } from "./ThinkingIndicator.jsx";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}


function formatConfidence(value) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a";
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

function chartSpecMatchesProposal(chartSpec, chartProposalSetId, proposalId) {
  if (!chartSpec || chartSpec.sourceProposalId !== proposalId) return false;
  if (chartProposalSetId) return chartSpec.sourceChartProposalSetId === chartProposalSetId;
  return true;
}

function chartProposalStatus(proposal) {
  return proposal?.status || "proposed";
}

function chartProposalAxisSummary(proposal) {
  const xLabel = proposal?.x?.label || proposal?.x?.field || "n/a";
  const yLabel = proposal?.y?.label || proposal?.y?.field || "n/a";
  const xUnit = proposal?.x?.unit ? ` (${proposal.x.unit})` : "";
  const yUnit = proposal?.y?.unit ? ` (${proposal.y.unit})` : "";
  return `X: ${xLabel}${xUnit} - Y: ${yLabel}${yUnit}`;
}

function proposalMatchesStatusFilter(proposal, statusFilter) {
  if (statusFilter !== "active") return true;
  const status = chartProposalStatus(proposal);
  return status === "accepted" || status === "proposed";
}

function ChartProposalCard({ proposal, chartProposalSetId, chartSpecs, focusProposalId, viewMode = "review", onChartProposalDecision, onChartProposalDelete, onCreateChartSpec }) {
  const preview = makeSourceChartPreview(proposal);
  const existingSpec = (chartSpecs || []).find((spec) => chartSpecMatchesProposal(spec, chartProposalSetId, proposal.proposalId));
  const status = chartProposalStatus(proposal);
  const editMode = viewMode === "editSpecs";
  const focused = !!focusProposalId && focusProposalId === proposal.proposalId;
  const cardRef = React.useRef(null);
  React.useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [focused]);
  return (
    <article ref={cardRef} className={`backend-proposal-card backend-chart-proposal-card ${editMode ? "chart-spec-row-card" : ""} ${focused ? "is-focused-proposal" : ""}`}>
      <div className="backend-scan-block-head">
        <div>
          <strong>{proposal.title || proposal.proposalId}</strong>
          {editMode && <small>{chartProposalAxisSummary(proposal)}</small>}
        </div>
        <span>{proposal.chartType} - {formatConfidence(proposal.confidence)}{editMode ? ` - ${status}` : ""}</span>
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
        {chartProposalAxisSummary(proposal)}
      </p>
      <WarningList warnings={proposal.warnings} />
      <div className="import-review-actions">
        {status !== "accepted" && (
          <button
            type="button"
            onClick={() => onChartProposalDecision?.(proposal.proposalId, "accepted")}
          >
            Accept
          </button>
        )}
        <button
          type="button"
          className={status === "rejected" ? "primary" : ""}
          onClick={() => onChartProposalDecision?.(proposal.proposalId, "rejected")}
        >
          Reject
        </button>
        {status === "accepted" && (
          <button
            type="button"
            disabled={!!existingSpec || !chartProposalSetId}
            onClick={() => onCreateChartSpec?.(chartProposalSetId, proposal.proposalId)}
          >
            {existingSpec ? "Chart spec created" : "Create chart spec"}
          </button>
        )}
        {editMode && (
          <button
            type="button"
            className="danger"
            onClick={() => onChartProposalDelete?.(proposal.proposalId)}
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

function ChartProposalReview({ chartProposalState, chartSpecs, focusProposalId, statusFilter, viewMode = "review", onChartProposalDecision, onChartProposalDelete, onCreateChartSpec }) {
  const state = chartProposalState || {};
  const proposalSet = state.result?.proposalSet || null;
  const proposals = proposalSet?.proposals || [];
  const editMode = viewMode === "editSpecs";
  const visibleProposals = proposals.filter((proposal) => proposalMatchesStatusFilter(proposal, editMode ? "active" : statusFilter));
  const chartProposalSetId = state.result?.chartProposalSet?.id || proposalSet?.serverId || state.result?.chartProposalSetId || null;
  const acceptedCount = proposals.filter((proposal) => chartProposalStatus(proposal) === "accepted").length;
  const pendingCount = proposals.filter((proposal) => chartProposalStatus(proposal) === "proposed").length;
  const rejectedCount = proposals.filter((proposal) => chartProposalStatus(proposal) === "rejected").length;
  const activeOnly = statusFilter === "active";

  return (
    <section className="backend-proposal-section">
      <WorkflowPanelHeader
        title={editMode ? "Edit specs" : activeOnly ? "Accepted + pending charts" : "Chart proposals"}
        detail={editMode ? "Manage active chart proposals before creating durable ChartSpecs." : activeOnly ? "Review proposals that are still active for ChartSpec creation." : "Accept proposed charts, then create ChartSpecs for Manuscript insertion."}
        meta={editMode || activeOnly ? `${visibleProposals.length} active` : `${proposals.length} proposals`}
      />
      {state.loading && <ThinkingIndicator text="Loading chart proposals..." />}
      {state.error && <p className="import-review-error">{state.error}</p>}
      {!proposalSet && !state.loading && <div className="import-review-empty">No chart proposals yet.</div>}
      {proposalSet && (
        <div className={`backend-proposal-grid ${editMode ? "chart-spec-edit-list" : ""}`}>
          <div className="backend-scan-stats">
            <span>{editMode || activeOnly ? `${visibleProposals.length} active` : `${proposals.length} charts`}</span>
            <span>{acceptedCount} accepted</span>
            <span>{pendingCount} pending</span>
            {!activeOnly && !editMode && <span>{rejectedCount} rejected</span>}
            <span>{proposalSet.warnings?.length || 0} warnings</span>
          </div>
          {(editMode || activeOnly) && !visibleProposals.length && <div className="import-review-empty">No accepted or pending chart proposals.</div>}
          {visibleProposals.map((proposal) => (
            <ChartProposalCard
              key={proposal.proposalId}
              proposal={proposal}
              chartProposalSetId={chartProposalSetId}
              chartSpecs={chartSpecs}
              focusProposalId={focusProposalId}
              viewMode={editMode ? "editSpecs" : "review"}
              onChartProposalDecision={onChartProposalDecision}
              onChartProposalDelete={onChartProposalDelete}
              onCreateChartSpec={onCreateChartSpec}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function warningKey(warning) {
  if (!warning || typeof warning !== "object") return String(warning || "");
  return [warning.code, warning.message, warning.range].filter(Boolean).join("|");
}

function uniqueWarnings(...warningGroups) {
  const seen = new Set();
  return warningGroups.flatMap(asArray).filter((warning) => {
    const key = warningKey(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function valueText(value) {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sourceExtractFields(preview = {}) {
  const fields = asArray(preview.fields);
  const fieldIds = fields.map((field) => field.fieldId).filter(Boolean);
  const rows = asArray(preview.rows);
  rows.forEach((row) => {
    Object.keys(row?.values || {}).forEach((fieldId) => {
      if (!fieldIds.includes(fieldId)) fieldIds.push(fieldId);
    });
  });
  return fieldIds.map((fieldId) => fields.find((field) => field.fieldId === fieldId) || { fieldId, label: fieldId });
}

function SourceExtractRowsPreview({ proposal }) {
  const preview = proposal?.preview || {};
  const rows = asArray(preview.rows);
  const series = asArray(preview.series);
  if (!rows.length && !series.length) return <p className="backend-scan-muted">No extracted row preview available.</p>;
  if (series.length) {
    return (
      <div className="source-extract-preview-list">
        {series.map((item, index) => (
          <div className="source-extract-preview-row" key={item.seriesId || item.experimentId || item.experimentAlias || index}>
            <strong>{item.experimentLabel || item.experimentAlias || item.experimentId || `Series ${index + 1}`}</strong>
            <span>{asArray(item.rows).length} rows</span>
            <small>{[item.range?.sheetName, item.range?.range].filter(Boolean).join(" - ")}</small>
          </div>
        ))}
      </div>
    );
  }
  const fields = sourceExtractFields(preview);
  return (
    <div className="source-extract-preview-list">
      {rows.slice(0, 8).map((row, index) => {
        const label = row.label || row.values?.component || row.values?.carbon_label || row.rowId || `Row ${index + 1}`;
        const cells = Object.entries(row.cells || {})
          .map(([fieldId, cell]) => `${fieldId}: ${cell}`)
          .join(", ");
        return (
          <div className="source-extract-preview-row" key={row.rowId || label || index}>
            <strong>{label}</strong>
            <span>
              {fields.map((field) => `${field.label || field.fieldId}: ${valueText(row.values?.[field.fieldId])}${field.unit ? ` ${field.unit}` : ""}`).join(" / ")}
            </span>
            {cells && <small>Cells: {cells}</small>}
          </div>
        );
      })}
      {rows.length > 8 && <small className="backend-scan-muted">+{rows.length - 8} more rows</small>}
    </div>
  );
}

function SourceExtractReviewCard({
  sourceExtractProposal,
  warnings = [],
  busy = "",
  onSourceExtractDecision,
  onCreateChartProposalFromSourceExtract,
}) {
  if (!sourceExtractProposal) return null;
  const status = sourceExtractProposal.status || "proposed";
  const accepted = status === "accepted";
  const rejected = status === "rejected";
  const isBusy = !!busy;
  const allWarnings = uniqueWarnings(warnings, sourceExtractProposal.warnings, sourceExtractProposal.preview?.warnings);
  return (
    <article className="backend-inline-status source-extract-review-card">
      <div className="backend-scan-block-head">
        <strong>Source extract proposal created</strong>
        <span>{sourceExtractProposal.extractType || "source_extract"} - {status}</span>
      </div>
      <p className="backend-scan-muted">
        Review the extracted source data before charting. Accepted source extracts can then create chart proposals.
      </p>
      {sourceExtractProposal.preview?.range && (
        <p className="backend-scan-muted">
          Source: {[
            sourceExtractProposal.preview.range.sheetName,
            sourceExtractProposal.preview.range.range,
          ].filter(Boolean).join(" - ")}
        </p>
      )}
      <SourceExtractRowsPreview proposal={sourceExtractProposal} />
      <WarningList warnings={allWarnings} />
      <div className="import-review-actions">
        {!accepted && (
          <button
            type="button"
            disabled={isBusy || rejected}
            onClick={() => onSourceExtractDecision?.(sourceExtractProposal.id, "accepted")}
          >
            {busy === "accepting_source_extract" ? "Accepting..." : "Accept source extract"}
          </button>
        )}
        {!rejected && (
          <button
            type="button"
            disabled={isBusy || accepted}
            onClick={() => onSourceExtractDecision?.(sourceExtractProposal.id, "rejected")}
          >
            {busy === "rejecting_source_extract" ? "Rejecting..." : "Reject"}
          </button>
        )}
        {accepted && <span className="workflow-status is-applied">Source extract accepted</span>}
        {rejected && <span className="workflow-status">Source extract rejected</span>}
        <button
          type="button"
          className="primary"
          disabled={isBusy || !accepted}
          title={accepted ? "Create a reviewable chart proposal from this source extract" : "Accept the source extract before creating a chart proposal"}
          onClick={() => onCreateChartProposalFromSourceExtract?.(sourceExtractProposal.id)}
        >
          {busy === "creating_source_chart_proposal" ? "Creating..." : "Create chart proposal"}
        </button>
      </div>
    </article>
  );
}

function ChartInterpretReview({
  allowSourcePrompt = false,
  chartInterpretState,
  onInterpretChart,
  onSourceExtractDecision,
  onCreateChartProposalFromSourceExtract,
}) {
  const [prompt, setPrompt] = React.useState("");
  const state = chartInterpretState || {};
  const draft = state.result?.chartSpecDraft || null;
  const clarification = state.result?.clarification || null;
  const persistedProposalSet = state.result?.chartProposalSet || null;
  const sourceExtractProposal = state.result?.sourceExtractProposal || null;
  const canInterpret = allowSourcePrompt && prompt.trim() && !state.loading;
  const preview = draft && !persistedProposalSet ? makeSourceChartPreview(draft) : null;
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
            placeholder="e.g. plot carbon distribution from Sheet1!P31:BA32 in Calculation_Exp33.xlsx"
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
        {state.loading && <ThinkingIndicator text="Drafting chart proposal..." />}
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
      {sourceExtractProposal && (
        <SourceExtractReviewCard
          sourceExtractProposal={sourceExtractProposal}
          warnings={state.result?.warnings}
          busy={state.sourceExtractBusy}
          onSourceExtractDecision={onSourceExtractDecision}
          onCreateChartProposalFromSourceExtract={onCreateChartProposalFromSourceExtract}
        />
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
            Preview-only source draft. Confirm the source extract before creating a chart spec or inserting it into Manuscript.
          </p>
        </article>
      )}
    </section>
  );
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function workbookNameForDocument(document) {
  return document?.metadata?.workbookName || document?.fileName || document?.originalName || document?.id || "";
}

function sheetSummaries(document) {
  const sheets = asArray(document?.metadata?.sheets);
  if (sheets.length) return sheets;
  return asArray(document?.metadata?.sheetNames).map((name) => ({ name }));
}

function sourceDocumentMatchScore(document, fileName) {
  const target = normalizeName(fileName);
  const workbook = normalizeName(workbookNameForDocument(document));
  if (!target || !workbook) return 0;
  if (target === workbook) return 4;
  if (target.includes(workbook) || workbook.includes(target)) return 3;
  const targetStem = target.replace(/\.[^.]+$/, "");
  const workbookStem = workbook.replace(/\.[^.]+$/, "");
  if (targetStem && targetStem === workbookStem) return 2;
  if (targetStem && workbookStem && (targetStem.includes(workbookStem) || workbookStem.includes(targetStem))) return 1;
  return 0;
}

function pickSourceDocument(documents, fileName) {
  const items = asArray(documents);
  if (!items.length) return null;
  return [...items].sort((a, b) => (
    sourceDocumentMatchScore(b, fileName) - sourceDocumentMatchScore(a, fileName)
  ))[0] || null;
}

function sheetRangeFor(document, sheetName, regions = []) {
  const sheet = sheetSummaries(document).find((item) => item.name === sheetName) || sheetSummaries(document)[0] || null;
  return sheet?.usedRange || asArray(regions).find((region) => region.sheetName === sheetName)?.rangeRef || "";
}

const SOURCE_SHEET_CELL_WIDTH = 120;
const SOURCE_SHEET_ROW_HEIGHT = 30;
const SOURCE_SHEET_HEADER_WIDTH = 58;
const SOURCE_SHEET_HEADER_HEIGHT = 30;
const SOURCE_SHEET_MAX_WINDOW_CELLS = 480;
const SOURCE_EXTRACT_MAX_PREVIEW_CELLS = 500;
const SOURCE_SHEET_FALLBACK_WIDTH = 980;
const SOURCE_SHEET_FALLBACK_HEIGHT = 360;
const SOURCE_SHEET_OVERSCAN_ROWS = 4;
const SOURCE_SHEET_OVERSCAN_COLS = 2;

function columnLabelToIndex(label) {
  const text = String(label || "").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(text)) return null;
  let index = 0;
  for (let i = 0; i < text.length; i += 1) {
    index = index * 26 + (text.charCodeAt(i) - 64);
  }
  return index - 1;
}

function indexToColumnLabel(index) {
  let value = Number(index) + 1;
  if (!Number.isFinite(value) || value <= 0) return "";
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function parseCellAddress(address) {
  const match = String(address || "").trim().match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const col = columnLabelToIndex(match[1]);
  const row = Number(match[2]) - 1;
  if (col == null || !Number.isInteger(row) || row < 0) return null;
  return { row, col };
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  const startRow = Math.min(bounds.startRow, bounds.endRow);
  const endRow = Math.max(bounds.startRow, bounds.endRow);
  const startCol = Math.min(bounds.startCol, bounds.endCol);
  const endCol = Math.max(bounds.startCol, bounds.endCol);
  if ([startRow, endRow, startCol, endCol].some((value) => !Number.isInteger(value) || value < 0)) return null;
  return { startRow, endRow, startCol, endCol };
}

function parseA1Range(range) {
  const text = String(range || "").trim();
  if (!text) return null;
  const plainRange = text.includes("!") ? text.slice(text.lastIndexOf("!") + 1) : text;
  const [startText, endText = startText] = plainRange.split(":").map((part) => part.trim());
  const start = parseCellAddress(startText);
  const end = parseCellAddress(endText);
  if (!start || !end) return null;
  return normalizeBounds({
    startRow: start.row,
    endRow: end.row,
    startCol: start.col,
    endCol: end.col,
  });
}

function formatA1Range(bounds) {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return "";
  const start = `${indexToColumnLabel(normalized.startCol)}${normalized.startRow + 1}`;
  const end = `${indexToColumnLabel(normalized.endCol)}${normalized.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

function boundsCellCount(bounds) {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return 0;
  return (normalized.endRow - normalized.startRow + 1) * (normalized.endCol - normalized.startCol + 1);
}

function mergeBounds(...boundsList) {
  const validBounds = boundsList.map(normalizeBounds).filter(Boolean);
  if (!validBounds.length) return null;
  return validBounds.reduce((merged, bounds) => ({
    startRow: Math.min(merged.startRow, bounds.startRow),
    endRow: Math.max(merged.endRow, bounds.endRow),
    startCol: Math.min(merged.startCol, bounds.startCol),
    endCol: Math.max(merged.endCol, bounds.endCol),
  }));
}

function sheetBoundsFor(sheet, focusRange, regions = [], localDraft = null, sheetName = "") {
  const usedRangeBounds = parseA1Range(sheet?.usedRange);
  const rowCount = Number(sheet?.rowCount);
  const columnCount = Number(sheet?.columnCount);
  const dimensionBounds = Number.isFinite(rowCount) && rowCount > 0 && Number.isFinite(columnCount) && columnCount > 0
    ? {
      startRow: usedRangeBounds?.startRow || 0,
      endRow: (usedRangeBounds?.startRow || 0) + rowCount - 1,
      startCol: usedRangeBounds?.startCol || 0,
      endCol: (usedRangeBounds?.startCol || 0) + columnCount - 1,
    }
    : null;
  const focusBounds = parseA1Range(focusRange);
  const regionBounds = asArray(regions)
    .filter((region) => !sheetName || region.sheetName === sheetName)
    .map((region) => parseA1Range(region.rangeRef));
  const draftBounds = localDraft?.sheetName === sheetName ? parseA1Range(localDraft.range) : null;
  return mergeBounds(dimensionBounds, usedRangeBounds, focusBounds, draftBounds, ...regionBounds)
    || { startRow: 0, endRow: 24, startCol: 0, endCol: 7 };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sourceSheetWindowFromScroll(sheetBounds, scrollState) {
  const totalRows = sheetBounds.endRow - sheetBounds.startRow + 1;
  const totalCols = sheetBounds.endCol - sheetBounds.startCol + 1;
  const viewportRows = Math.max(1, Math.ceil((scrollState.height || SOURCE_SHEET_FALLBACK_HEIGHT) / SOURCE_SHEET_ROW_HEIGHT) + SOURCE_SHEET_OVERSCAN_ROWS);
  const viewportCols = Math.max(1, Math.ceil((scrollState.width || SOURCE_SHEET_FALLBACK_WIDTH) / SOURCE_SHEET_CELL_WIDTH) + SOURCE_SHEET_OVERSCAN_COLS);
  const startRowOffset = clamp(Math.floor(Math.max(0, (scrollState.top || 0) - SOURCE_SHEET_HEADER_HEIGHT) / SOURCE_SHEET_ROW_HEIGHT), 0, Math.max(totalRows - 1, 0));
  const startColOffset = clamp(Math.floor(Math.max(0, (scrollState.left || 0) - SOURCE_SHEET_HEADER_WIDTH) / SOURCE_SHEET_CELL_WIDTH), 0, Math.max(totalCols - 1, 0));
  let rowCount = Math.min(viewportRows, totalRows - startRowOffset);
  let colCount = Math.min(viewportCols, totalCols - startColOffset);
  if (rowCount * colCount > SOURCE_SHEET_MAX_WINDOW_CELLS) {
    rowCount = Math.max(1, Math.floor(SOURCE_SHEET_MAX_WINDOW_CELLS / Math.max(colCount, 1)));
  }
  return {
    startRow: sheetBounds.startRow + startRowOffset,
    endRow: sheetBounds.startRow + startRowOffset + rowCount - 1,
    startCol: sheetBounds.startCol + startColOffset,
    endCol: sheetBounds.startCol + startColOffset + colCount - 1,
  };
}

function sourceSheetBoundsStyle(bounds, sheetBounds, inset = 0) {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return {};
  return {
    left: SOURCE_SHEET_HEADER_WIDTH + (normalized.startCol - sheetBounds.startCol) * SOURCE_SHEET_CELL_WIDTH + inset,
    top: SOURCE_SHEET_HEADER_HEIGHT + (normalized.startRow - sheetBounds.startRow) * SOURCE_SHEET_ROW_HEIGHT + inset,
    width: (normalized.endCol - normalized.startCol + 1) * SOURCE_SHEET_CELL_WIDTH - inset * 2,
    height: (normalized.endRow - normalized.startRow + 1) * SOURCE_SHEET_ROW_HEIGHT - inset * 2,
  };
}

function flattenSourceRangeCells(rangeResult) {
  const fromRows = asArray(rangeResult?.rows).flatMap((row) => asArray(row));
  const fromCells = asArray(rangeResult?.cells);
  return [...fromRows, ...fromCells].filter((cell) => Number.isInteger(cell?.row) && Number.isInteger(cell?.col));
}

function SourceSheetWindowViewer({
  sourceDocumentId,
  sheet,
  sheetName,
  focusRange,
  regions = [],
  localDraft,
  onLocalDraftChange,
}) {
  const scrollRef = React.useRef(null);
  const dragSelectionRef = React.useRef(null);
  const [scrollState, setScrollState] = React.useState({
    top: 0,
    left: 0,
    width: SOURCE_SHEET_FALLBACK_WIDTH,
    height: SOURCE_SHEET_FALLBACK_HEIGHT,
  });
  const [windowState, setWindowState] = React.useState({ loading: false, error: "", result: null, range: "" });
  const [dragSelection, setDragSelection] = React.useState(null);
  const sheetBounds = React.useMemo(
    () => sheetBoundsFor(sheet, focusRange, regions, localDraft, sheetName),
    [sheet, focusRange, regions, localDraft, sheetName],
  );
  const focusBounds = parseA1Range(focusRange);
  const windowBounds = React.useMemo(() => sourceSheetWindowFromScroll(sheetBounds, scrollState), [sheetBounds, scrollState]);
  const windowRange = formatA1Range(windowBounds);
  const targetRangeLabel = focusBounds ? formatA1Range(focusBounds) : focusRange || sheet?.usedRange || "";
  const totalRows = sheetBounds.endRow - sheetBounds.startRow + 1;
  const totalCols = sheetBounds.endCol - sheetBounds.startCol + 1;

  const updateScrollState = React.useCallback((element) => {
    if (!element) return;
    setScrollState({
      top: element.scrollTop || 0,
      left: element.scrollLeft || 0,
      width: element.clientWidth || SOURCE_SHEET_FALLBACK_WIDTH,
      height: element.clientHeight || SOURCE_SHEET_FALLBACK_HEIGHT,
    });
  }, []);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element || !focusBounds) return;
    element.scrollTop = Math.max(0, SOURCE_SHEET_HEADER_HEIGHT + (focusBounds.startRow - sheetBounds.startRow) * SOURCE_SHEET_ROW_HEIGHT);
    element.scrollLeft = Math.max(0, SOURCE_SHEET_HEADER_WIDTH + (focusBounds.startCol - sheetBounds.startCol) * SOURCE_SHEET_CELL_WIDTH);
    updateScrollState(element);
  }, [sourceDocumentId, sheetName, targetRangeLabel, sheetBounds.startRow, sheetBounds.startCol, updateScrollState]);

  React.useEffect(() => {
    if (!sourceDocumentId || !sheetName || !windowRange) {
      setWindowState({ loading: false, error: "", result: null, range: "" });
      return undefined;
    }
    let cancelled = false;
    setWindowState((current) => ({ ...current, loading: true, error: "", range: windowRange }));
    readServerSourceDocumentRange(sourceDocumentId, { sheetName, range: windowRange })
      .then((result) => {
        if (cancelled) return;
        setWindowState({ loading: false, error: "", result, range: windowRange });
      })
      .catch((err) => {
        if (cancelled) return;
        setWindowState({ loading: false, error: err.message || String(err), result: null, range: windowRange });
      });
    return () => {
      cancelled = true;
    };
  }, [sourceDocumentId, sheetName, windowRange]);

  const cellFromPointerEvent = (event) => {
    const element = scrollRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left + element.scrollLeft - SOURCE_SHEET_HEADER_WIDTH;
    const y = event.clientY - rect.top + element.scrollTop - SOURCE_SHEET_HEADER_HEIGHT;
    if (x < 0 || y < 0) return null;
    const col = sheetBounds.startCol + Math.floor(x / SOURCE_SHEET_CELL_WIDTH);
    const row = sheetBounds.startRow + Math.floor(y / SOURCE_SHEET_ROW_HEIGHT);
    if (row < sheetBounds.startRow || row > sheetBounds.endRow || col < sheetBounds.startCol || col > sheetBounds.endCol) return null;
    return { row, col };
  };

  const autoScrollNearEdge = (event) => {
    const element = scrollRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const edge = 34;
    let dx = 0;
    let dy = 0;
    if (event.clientX > rect.right - edge) dx = 36;
    if (event.clientX < rect.left + edge) dx = -36;
    if (event.clientY > rect.bottom - edge) dy = 36;
    if (event.clientY < rect.top + edge) dy = -36;
    if (dx || dy) {
      element.scrollLeft += dx;
      element.scrollTop += dy;
      updateScrollState(element);
    }
  };

  const startDraftSelection = (event) => {
    if (event.button !== 2 && event.buttons !== 2) return;
    const cell = cellFromPointerEvent(event);
    if (!cell) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const nextSelection = { active: true, anchor: cell, current: cell };
    dragSelectionRef.current = nextSelection;
    setDragSelection(nextSelection);
  };

  const moveDraftSelection = (event) => {
    const currentSelection = dragSelectionRef.current;
    if (!currentSelection?.active) return;
    const cell = cellFromPointerEvent(event);
    autoScrollNearEdge(event);
    if (!cell) return;
    event.preventDefault();
    const nextSelection = { ...currentSelection, current: cell };
    dragSelectionRef.current = nextSelection;
    setDragSelection(nextSelection);
  };

  const finishDraftSelection = (event) => {
    const currentSelection = dragSelectionRef.current;
    if (!currentSelection?.active) return;
    event.preventDefault();
    const releaseCell = cellFromPointerEvent(event);
    const bounds = normalizeBounds({
      startRow: currentSelection.anchor.row,
      endRow: (releaseCell || currentSelection.current).row,
      startCol: currentSelection.anchor.col,
      endCol: (releaseCell || currentSelection.current).col,
    });
    const range = formatA1Range(bounds);
    if (range) onLocalDraftChange?.({ sheetName, range });
    dragSelectionRef.current = null;
    setDragSelection(null);
  };

  const cellMap = React.useMemo(() => {
    const map = new Map();
    flattenSourceRangeCells(windowState.result).forEach((cell) => {
      map.set(`${cell.row}:${cell.col}`, cell);
    });
    return map;
  }, [windowState.result]);

  const visibleRows = [];
  for (let row = windowBounds.startRow; row <= windowBounds.endRow; row += 1) visibleRows.push(row);
  const visibleCols = [];
  for (let col = windowBounds.startCol; col <= windowBounds.endCol; col += 1) visibleCols.push(col);

  const sameSheetRegions = asArray(regions).filter((region) => region.sheetName === sheetName);
  const dragBounds = dragSelection?.active ? normalizeBounds({
    startRow: dragSelection.anchor.row,
    endRow: dragSelection.current.row,
    startCol: dragSelection.anchor.col,
    endCol: dragSelection.current.col,
  }) : null;
  const localDraftBounds = localDraft?.sheetName === sheetName ? parseA1Range(localDraft.range) : null;
  const activeDraftBounds = dragBounds || localDraftBounds;

  return (
    <div className="source-sheet-viewer">
      <div className="source-sheet-viewer-head">
        <span>Selected range: {targetRangeLabel || "n/a"}</span>
        <span>{windowState.loading ? `Loading ${windowRange}...` : `Loaded window: ${windowState.range || windowRange}`}</span>
        <span>{totalRows} rows x {totalCols} columns</span>
      </div>
      {!focusBounds && focusRange && <p className="import-review-error">Enter a valid Excel range such as A1:D20.</p>}
      {windowState.error && <p className="import-review-error">{windowState.error}</p>}
      <div
        ref={scrollRef}
        className="source-sheet-scroll"
        aria-label="Source range grid"
        onScroll={(event) => updateScrollState(event.currentTarget)}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={startDraftSelection}
        onPointerMove={moveDraftSelection}
        onPointerUp={finishDraftSelection}
        onPointerCancel={() => {
          dragSelectionRef.current = null;
          setDragSelection(null);
        }}
        onMouseDown={startDraftSelection}
        onMouseMove={moveDraftSelection}
        onMouseUp={finishDraftSelection}
      >
        <div
          className="source-sheet-canvas"
          style={{
            width: SOURCE_SHEET_HEADER_WIDTH + totalCols * SOURCE_SHEET_CELL_WIDTH,
            height: SOURCE_SHEET_HEADER_HEIGHT + totalRows * SOURCE_SHEET_ROW_HEIGHT,
          }}
        >
          <div className="source-sheet-corner" style={{ width: SOURCE_SHEET_HEADER_WIDTH, height: SOURCE_SHEET_HEADER_HEIGHT }} />
          {sameSheetRegions.map((region) => {
            const bounds = parseA1Range(region.rangeRef);
            if (!bounds) return null;
            return (
              <div
                className="source-region-overlay"
                key={region.id || `${region.sheetName}-${region.rangeRef}`}
                style={sourceSheetBoundsStyle(bounds, sheetBounds, 2)}
                title={`${region.label || region.kind || "Detected source region"} ${region.rangeRef}`}
              />
            );
          })}
          {activeDraftBounds && (
            <div
              className="source-draft-overlay"
              style={sourceSheetBoundsStyle(activeDraftBounds, sheetBounds, 3)}
              title={`Local draft selection ${formatA1Range(activeDraftBounds)}`}
            />
          )}
          {visibleCols.map((col) => (
            <div
              className="source-sheet-cell source-sheet-col-header"
              key={`col-${col}`}
              style={{
                left: SOURCE_SHEET_HEADER_WIDTH + (col - sheetBounds.startCol) * SOURCE_SHEET_CELL_WIDTH,
                top: 0,
                width: SOURCE_SHEET_CELL_WIDTH,
                height: SOURCE_SHEET_HEADER_HEIGHT,
              }}
            >
              {indexToColumnLabel(col)}
            </div>
          ))}
          {visibleRows.map((row) => (
            <div
              className="source-sheet-cell source-sheet-row-header"
              key={`row-${row}`}
              style={{
                left: 0,
                top: SOURCE_SHEET_HEADER_HEIGHT + (row - sheetBounds.startRow) * SOURCE_SHEET_ROW_HEIGHT,
                width: SOURCE_SHEET_HEADER_WIDTH,
                height: SOURCE_SHEET_ROW_HEIGHT,
              }}
            >
              {row + 1}
            </div>
          ))}
          {visibleRows.flatMap((row) => visibleCols.map((col) => {
            const cell = cellMap.get(`${row}:${col}`);
            const text = valueText(cell?.formattedValue ?? cell?.rawValue);
            return (
              <div
                className={`source-sheet-cell source-sheet-data-cell ${text ? "" : "is-empty"}`}
                key={`${row}-${col}`}
                style={{
                  left: SOURCE_SHEET_HEADER_WIDTH + (col - sheetBounds.startCol) * SOURCE_SHEET_CELL_WIDTH,
                  top: SOURCE_SHEET_HEADER_HEIGHT + (row - sheetBounds.startRow) * SOURCE_SHEET_ROW_HEIGHT,
                  width: SOURCE_SHEET_CELL_WIDTH,
                  height: SOURCE_SHEET_ROW_HEIGHT,
                }}
                title={cell?.formula ? `Formula: ${cell.formula}` : `${indexToColumnLabel(col)}${row + 1}`}
              >
                {text}
              </div>
            );
          }))}
        </div>
      </div>
      <small className="source-sheet-help">Right-click and drag across cells to create a local draft red box. Drag near an edge to scroll while extending the selection.</small>
    </div>
  );
}

function SourceRegionCard({ region, active, busy, preview, onReadRange, onPreviewExtract }) {
  const confidence = typeof region.confidence === "number" ? region.confidence : 0;
  const highConfidence = confidence >= 0.75;
  const regionCellCount = boundsCellCount(parseA1Range(region.rangeRef));
  const extractDisabledReason = regionCellCount > SOURCE_EXTRACT_MAX_PREVIEW_CELLS
    ? `Detected source region has ${regionCellCount} cells; select a smaller local draft range before previewing extract.`
    : "";
  return (
    <article className={`source-region-card ${active ? "is-active" : ""}`}>
      <div className="backend-scan-block-head">
        <strong>{region.label || region.kind || "Source region"}</strong>
        <span>{highConfidence ? "detected source region" : "low-confidence source region"}</span>
      </div>
      <p className="backend-scan-muted">
        {[region.sheetName, region.rangeRef].filter(Boolean).join(" - ") || "range n/a"} - {region.kind || "unknown"} - {formatConfidence(region.confidence)}
      </p>
      {!!asArray(region.candidateFields).length && (
        <p className="backend-scan-muted">
          Fields: {asArray(region.candidateFields).slice(0, 5).map((field) => field.displayName || field.rawName || field.fieldId).join(", ")}
        </p>
      )}
      <WarningList warnings={region.warnings} />
      <div className="import-review-actions">
        <button type="button" onClick={() => onReadRange?.(region)} disabled={!region.sheetName || !region.rangeRef || busy}>
          {busy === "range" ? "Reading..." : "Read detected range"}
        </button>
        <button
          type="button"
          onClick={() => onPreviewExtract?.(region)}
          disabled={busy || !region.id || !!extractDisabledReason}
          title={extractDisabledReason || undefined}
        >
          {busy === "extract" ? "Previewing..." : "Preview extract"}
        </button>
      </div>
      {extractDisabledReason && <small className="backend-scan-muted">{extractDisabledReason}</small>}
      {preview && <SourceExtractRowsPreview proposal={{ preview }} />}
    </article>
  );
}

function makeClientDraftRegionId() {
  return `draft_region_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function SourceWorkbookReview({
  projectId,
  scanFileName,
  draftRegions = [],
  onDraftRegionsChange,
  focusSelection = null,
}) {
  const [documentsState, setDocumentsState] = React.useState({ loading: false, error: "", items: [] });
  const [selectedDocumentId, setSelectedDocumentId] = React.useState("");
  const [regionsState, setRegionsState] = React.useState({ loading: false, error: "", items: [] });
  const [activeSheetName, setActiveSheetName] = React.useState("");
  const [rangeInput, setRangeInput] = React.useState("");
  const [rangeState, setRangeState] = React.useState({ localDraft: null });
  const [extractState, setExtractState] = React.useState({ targetKey: "", loading: false, error: "", preview: null });
  const appliedFocusKeyRef = React.useRef("");
  const rangeInputDirtyRef = React.useRef(false);

  React.useEffect(() => {
    if (!projectId) {
      setDocumentsState({ loading: false, error: "", items: [] });
      setSelectedDocumentId("");
      return undefined;
    }
    let cancelled = false;
    setDocumentsState({ loading: true, error: "", items: [] });
    listServerSourceDocuments(projectId)
      .then((body) => {
        if (cancelled) return;
        const items = asArray(body?.sourceDocuments);
        const selected = pickSourceDocument(items, scanFileName) || items[0] || null;
        setDocumentsState({ loading: false, error: "", items });
        setSelectedDocumentId(selected?.id || "");
        onDraftRegionsChange?.([]);
      })
      .catch((err) => {
        if (cancelled) return;
        setDocumentsState({ loading: false, error: err.message || String(err), items: [] });
        setSelectedDocumentId("");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, scanFileName]);

  const selectedDocument = documentsState.items.find((document) => document.id === selectedDocumentId) || null;
  const sheets = sheetSummaries(selectedDocument);

  React.useEffect(() => {
    rangeInputDirtyRef.current = false;
    if (!selectedDocumentId) {
      setRegionsState({ loading: false, error: "", items: [] });
      setActiveSheetName("");
      setRangeInput("");
      return undefined;
    }
    let cancelled = false;
    setRegionsState({ loading: true, error: "", items: [] });
    setRangeState({ localDraft: null });
    setExtractState({ targetKey: "", loading: false, error: "", preview: null });
    listServerSourceDocumentRegions(selectedDocumentId)
      .then((body) => {
        if (cancelled) return;
        const items = asArray(body?.regions);
        const firstSheet = sheets[0]?.name || items[0]?.sheetName || "";
        const firstRange = sheetRangeFor(selectedDocument, firstSheet, items);
        setRegionsState({ loading: false, error: "", items });
        setActiveSheetName(firstSheet);
        if (!rangeInputDirtyRef.current) setRangeInput(firstRange);
      })
      .catch((err) => {
        if (cancelled) return;
        const firstSheet = sheets[0]?.name || "";
        setRegionsState({ loading: false, error: err.message || String(err), items: [] });
        setActiveSheetName(firstSheet);
        setRangeInput(sheetRangeFor(selectedDocument, firstSheet, []));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId]);

  if (!projectId) return null;

  const readRegionRange = (region) => {
    rangeInputDirtyRef.current = false;
    setActiveSheetName(region.sheetName || "");
    setRangeInput(region.rangeRef || "");
    setRangeState({ localDraft: null });
  };

  const previewLocalDraftRange = () => {
    if (!activeSheetName || !rangeInput) return;
    const bounds = parseA1Range(rangeInput);
    const normalizedRange = formatA1Range(bounds) || rangeInput;
    const draftRange = {
      sheetName: activeSheetName,
      range: normalizedRange,
      selectionMethod: "manual_range_input",
    };
    setRangeState({ localDraft: draftRange });
    upsertDraftRegion(draftRange);
  };

  const handleViewerDraftRange = (draftRange) => {
    if (!draftRange?.sheetName || !draftRange?.range) return;
    setActiveSheetName(draftRange.sheetName);
    setRangeInput(draftRange.range);
    setRangeState({ localDraft: draftRange });
    upsertDraftRegion({ ...draftRange, selectionMethod: "drag_select" });
  };

  const upsertDraftRegion = (draftRange) => {
    if (!selectedDocumentId || !draftRange?.sheetName || !draftRange?.range) return;
    const bounds = parseA1Range(draftRange.range);
    const normalizedRange = formatA1Range(bounds) || draftRange.range;
    const key = `${selectedDocumentId}:${draftRange.sheetName}:${normalizedRange}`;
    const existing = asArray(draftRegions).find((region) => (
      `${region.sourceDocumentId}:${region.sheetName}:${region.range}` === key
    ));
    const nextRegion = {
      clientRegionId: existing?.clientRegionId || makeClientDraftRegionId(),
      operation: "upsert",
      sourceDocumentId: selectedDocumentId,
      sheetName: draftRange.sheetName,
      range: normalizedRange,
      selectionMethod: draftRange.selectionMethod || "manual",
      description: draftRange.description || existing?.description || "",
    };
    const nextRegions = existing
      ? asArray(draftRegions).map((region) => (region.clientRegionId === existing.clientRegionId ? nextRegion : region))
      : [...asArray(draftRegions), nextRegion];
    onDraftRegionsChange?.(nextRegions);
  };

  React.useEffect(() => {
    if (!focusSelection?.sourceDocumentId || !focusSelection?.sheetName || !focusSelection?.range) return;
    if (documentsState.loading || regionsState.loading) return;
    const focusKey = `${focusSelection.requestId || ""}:${focusSelection.sourceDocumentId}:${focusSelection.sheetName}:${focusSelection.range}`;
    if (appliedFocusKeyRef.current === focusKey) return;
    const targetDocument = documentsState.items.find((document) => document.id === focusSelection.sourceDocumentId);
    if (!targetDocument) return;
    if (selectedDocumentId !== focusSelection.sourceDocumentId) {
      setSelectedDocumentId(focusSelection.sourceDocumentId);
      return;
    }
    const bounds = parseA1Range(focusSelection.range);
    const normalizedRange = formatA1Range(bounds) || focusSelection.range;
    const draftRange = {
      sheetName: focusSelection.sheetName,
      range: normalizedRange,
      selectionMethod: focusSelection.selectionMethod || "suggestion_click",
      description: focusSelection.description || focusSelection.label || "",
    };
    setActiveSheetName(focusSelection.sheetName);
    setRangeInput(normalizedRange);
    setRangeState({ localDraft: draftRange });
    upsertDraftRegion(draftRange);
    appliedFocusKeyRef.current = focusKey;
  }, [documentsState.items, documentsState.loading, regionsState.loading, selectedDocumentId, focusSelection]);

  const previewExtract = async (region) => {
    if (!region?.id) return;
    setExtractState({ targetKey: `region:${region.id}`, loading: true, error: "", preview: null });
    try {
      const body = await previewServerSourceRegionExtract(region.id, { extractType: region.kind || "generic_table" });
      setExtractState({ targetKey: `region:${region.id}`, loading: false, error: "", preview: body?.preview || null });
    } catch (err) {
      setExtractState({ targetKey: `region:${region.id}`, loading: false, error: err.message || String(err), preview: null });
    }
  };

  const previewSelectedRangeExtract = async () => {
    const selectedRange = rangeState.localDraft?.range || rangeInput;
    const selectedSheetName = rangeState.localDraft?.sheetName || activeSheetName;
    const bounds = parseA1Range(selectedRange);
    if (!selectedDocumentId || !selectedSheetName || !bounds) {
      setExtractState({ targetKey: "draft", loading: false, error: "Select a valid source range before previewing an extract.", preview: null });
      return;
    }
    const cellCount = boundsCellCount(bounds);
    if (cellCount > SOURCE_EXTRACT_MAX_PREVIEW_CELLS) {
      setExtractState({
        targetKey: "draft",
        loading: false,
        error: `Selected range has ${cellCount} cells; source extract preview is capped at ${SOURCE_EXTRACT_MAX_PREVIEW_CELLS}. Select a smaller range.`,
        preview: null,
      });
      return;
    }
    setExtractState({ targetKey: "draft", loading: true, error: "", preview: null });
    try {
      const body = await previewServerSourceDocumentExtract(selectedDocumentId, {
        sheetName: selectedSheetName,
        range: formatA1Range(bounds),
        extractType: activeRegion?.kind || "generic_table",
      });
      setExtractState({ targetKey: "draft", loading: false, error: "", preview: body?.preview || null });
    } catch (err) {
      setExtractState({ targetKey: "draft", loading: false, error: err.message || String(err), preview: null });
    }
  };

  const activeSheet = sheets.find((sheet) => sheet.name === activeSheetName) || sheets[0] || null;
  const activeRegion = regionsState.items.find((region) => (
    region.sheetName === activeSheetName && formatA1Range(parseA1Range(region.rangeRef)) === formatA1Range(parseA1Range(rangeInput))
  )) || null;

  return (
    <section className="source-workbook-review">
      <WorkflowPanelHeader
        title="Source workbook"
        detail="Inspect indexed workbook evidence before creating DataPlans or charting from source ranges."
        meta={documentsState.loading ? "loading" : `${documentsState.items.length} documents`}
      />
      {documentsState.loading && <div className="import-review-empty is-loading">Loading indexed source documents...</div>}
      {documentsState.error && <p className="import-review-error">{documentsState.error}</p>}
      {!documentsState.loading && !documentsState.items.length && !documentsState.error && (
        <div className="import-review-empty">No indexed source document is available for this project yet.</div>
      )}
      {!!documentsState.items.length && (
        <>
          <div className="source-workbook-toolbar workflow-action-row">
            <label>
              <span>Source document</span>
              <select value={selectedDocumentId} onChange={(event) => {
                rangeInputDirtyRef.current = false;
                setSelectedDocumentId(event.target.value);
                onDraftRegionsChange?.([]);
              }}>
                {documentsState.items.map((document) => (
                  <option value={document.id} key={document.id}>{workbookNameForDocument(document)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Sheet</span>
              <select value={activeSheetName} onChange={(event) => {
                const nextSheet = event.target.value;
                rangeInputDirtyRef.current = false;
                setActiveSheetName(nextSheet);
                setRangeInput(sheetRangeFor(selectedDocument, nextSheet, regionsState.items));
              }}>
                {sheets.map((sheet) => <option value={sheet.name} key={sheet.name}>{sheet.name}</option>)}
              </select>
            </label>
            <label>
              <span>Range</span>
              <input value={rangeInput} onChange={(event) => {
                rangeInputDirtyRef.current = true;
                setRangeInput(event.target.value);
              }} placeholder="A1:D20" />
            </label>
            <button
              type="button"
              onClick={previewLocalDraftRange}
              disabled={!selectedDocumentId || !activeSheetName || !rangeInput}
            >
              Preview local draft range
            </button>
          </div>
          {selectedDocument && (
            <div className="backend-scan-stats">
              <span>{selectedDocument.summary?.sheetCount ?? sheets.length} sheets</span>
              <span>{selectedDocument.summary?.regionCount ?? regionsState.items.length} regions</span>
              <span>{selectedDocument.summary?.nonEmptyCellCount ?? 0} non-empty cells</span>
            </div>
          )}
          {rangeState.localDraft && (
            <article className="source-draft-selection">
              <div>
                <strong>local draft selection</strong>
                <span>{rangeState.localDraft.sheetName} - {rangeState.localDraft.range}</span>
                <small>Draft red box. Describe it in the workbook review chat before confirming understanding.</small>
              </div>
              <button type="button" onClick={previewSelectedRangeExtract} disabled={extractState.loading}>
                {extractState.targetKey === "draft" && extractState.loading ? "Previewing..." : "Preview selected range extract"}
              </button>
              {extractState.targetKey === "draft" && extractState.error && <p className="import-review-error">{extractState.error}</p>}
              {extractState.targetKey === "draft" && extractState.preview && <SourceExtractRowsPreview proposal={{ preview: extractState.preview }} />}
            </article>
          )}
          <SourceSheetWindowViewer
            sourceDocumentId={selectedDocumentId}
            sheet={activeSheet}
            sheetName={activeSheetName}
            focusRange={rangeInput}
            regions={regionsState.items}
            localDraft={rangeState.localDraft}
            onLocalDraftChange={handleViewerDraftRange}
          />
          <div className="source-region-list">
            <div className="backend-scan-block-head">
              <strong>Detected source regions</strong>
              <span>{regionsState.loading ? "loading" : `${regionsState.items.length} regions`}</span>
            </div>
            {regionsState.error && <p className="import-review-error">{regionsState.error}</p>}
            {!regionsState.loading && !regionsState.items.length && !regionsState.error && (
              <div className="import-review-empty">No source regions were detected for this workbook.</div>
            )}
            {regionsState.items.map((region) => {
              const targetKey = `region:${region.id}`;
              const busy = extractState.targetKey === targetKey && extractState.loading ? "extract" : "";
              const preview = extractState.targetKey === targetKey ? extractState.preview : null;
              return (
                <SourceRegionCard
                  key={region.id}
                  region={region}
                  active={activeRegion?.id === region.id}
                  busy={busy}
                  preview={preview}
                  onReadRange={readRegionRange}
                  onPreviewExtract={previewExtract}
                />
              );
            })}
            {extractState.targetKey !== "draft" && extractState.error && <p className="import-review-error">{extractState.error}</p>}
          </div>
        </>
      )}
    </section>
  );
}

export function ChartReviewPanel({
  chartProposalState,
  chartInterpretState,
  chartSpecs,
  focusProposalId,
  statusFilter,
  viewMode = "review",
  onChartProposalDecision,
  onChartProposalDelete,
  onInterpretChart,
  onSourceExtractDecision,
  onCreateChartProposalFromSourceExtract,
  onCreateChartSpec,
  allowSourcePrompt = false,
}) {
  if (viewMode === "edit") {
    return (
      <div className="chart-review-panel">
        <ChartProposalReview
          chartProposalState={chartProposalState}
          chartSpecs={chartSpecs}
          focusProposalId={focusProposalId}
          statusFilter={statusFilter}
          viewMode="editSpecs"
          onChartProposalDecision={onChartProposalDecision}
          onChartProposalDelete={onChartProposalDelete}
          onCreateChartSpec={onCreateChartSpec}
        />
      </div>
    );
  }
  return (
    <div className="chart-review-panel">
      <ChartInterpretReview
        allowSourcePrompt={allowSourcePrompt}
        chartInterpretState={chartInterpretState}
        onInterpretChart={onInterpretChart}
        onSourceExtractDecision={onSourceExtractDecision}
        onCreateChartProposalFromSourceExtract={onCreateChartProposalFromSourceExtract}
      />
      <ChartProposalReview
        chartProposalState={chartProposalState}
        chartSpecs={chartSpecs}
        focusProposalId={focusProposalId}
        statusFilter={statusFilter}
        onChartProposalDecision={onChartProposalDecision}
        onChartProposalDelete={onChartProposalDelete}
        onCreateChartSpec={onCreateChartSpec}
      />
    </div>
  );
}

export function BackendScanPanel({
  projectId = "",
  scanState,
  draftRegions = [],
  onDraftRegionsChange,
  focusSelection = null,
}) {
  const state = scanState || {};
  const scanFileName = state.fileName || state.result?.file?.name || "";
  return (
    <section className="import-review-section backend-scan-panel source-only">
      <SourceWorkbookReview
        projectId={projectId}
        scanFileName={scanFileName}
        draftRegions={draftRegions}
        onDraftRegionsChange={onDraftRegionsChange}
        focusSelection={focusSelection}
      />
    </section>
  );
}
