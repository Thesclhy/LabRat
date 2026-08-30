import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Plot } from "../charts/Plot.jsx";
import { plotLayout } from "../charts/chartLayout.js";
import {
  acceptAnalysisPlanRevision,
  createAnalysisPlanRevision,
  executeAnalysisRun,
  getAnalysisPlanSelection,
  getProjectAnalysisCapabilities,
  getAnalysisResultPreview,
  getAnalysisRun,
  getAnalysisThread,
  retryAnalysisRun,
  reviseAnalysisRun,
} from "../data/analysisApi.js";
import { createServerReusableChartTemplate } from "../data/serverApi.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function messageText(message) {
  return message?.content || message?.text || "";
}

function chartTitle(preview, revision, chartSpec) {
  const plotlyTitle = preview?.plotly?.layout?.title;
  return String(
    chartSpec?.title
      || (typeof plotlyTitle === "string" ? plotlyTitle : plotlyTitle?.text)
      || revision?.reviewPlan?.chart?.title
      || "Reusable chart",
  ).trim();
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

function planFieldLabel(value, fallback = "Not specified") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^:+/, "")
    .replace(/^_+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return fallback;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function joinedPlanFieldLabels(values) {
  const labels = asArray(values).map((value) => planFieldLabel(value, "")).filter(Boolean);
  if (labels.length <= 1) return labels[0] || "Not specified";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function missingValuePlanStep(policy = {}) {
  const mode = String(policy?.mode || "").trim();
  if (!mode) return "";
  if (["exclude_record", "skip_record"].includes(mode)) {
    return "Exclude a record when a required input is missing.";
  }
  if (mode === "keep_null") return "Keep missing inputs as empty values.";
  return `Handle missing values using the reviewed ${planFieldLabel(mode).toLowerCase()} rule.`;
}

function calculationPlanSteps(revision) {
  const displayPlan = asArray(revision?.displayPlan).map(String).filter(Boolean);
  if (displayPlan.length) return displayPlan;
  const reviewPlan = revision?.reviewPlan || {};
  const steps = asArray(reviewPlan.processingSteps).map(String).filter(Boolean);
  if (reviewPlan.missingValueHandling) steps.push(String(reviewPlan.missingValueHandling));
  return [...new Set(steps)];
}

function acceptanceKey(revision) {
  const randomPart = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `accept_analysis_${revision.id}_${randomPart}`;
}

function generationRetryKey(run) {
  const randomPart = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `retry_generation_${run.id}_${randomPart}`;
}

const RUN_PROGRESS = Object.freeze({
  queued: 0,
  running: 1,
  awaiting_result_review: 2,
  validation_failed: 2,
  failed: 2,
  completed: 3,
});

function preferredRun(current, candidate) {
  if (!candidate) return current;
  if (!current || current.id !== candidate.id) return candidate;
  const currentProgress = RUN_PROGRESS[current.status] ?? -1;
  const candidateProgress = RUN_PROGRESS[candidate.status] ?? -1;
  return candidateProgress >= currentProgress ? candidate : current;
}

function persistedExecutionStrategy(run, fallback = "model_generated_python") {
  return run?.execution?.executionStrategy || fallback || "model_generated_python";
}

function runFailureMessage(run) {
  if (!["failed", "validation_failed"].includes(run?.status)) return "";
  const code = run?.execution?.error?.code || run?.validation?.errors?.[0]?.code || "";
  if (code === "analysis_program_draft_unavailable"
    && run?.execution?.error?.warning?.code === "ai_output_truncated") {
    return "Claude's generated program was too long and was cut off before it could run.";
  }
  if (run?.execution?.error?.warning?.code === "ai_output_truncated") {
    return "Claude's generated program was too long and was cut off before it could run.";
  }
  return run?.execution?.error?.message
    || run?.validation?.errors?.[0]?.message
    || "Experiment Browser generation failed before a reviewable preview was created.";
}

function resultValidation(run, result, preview) {
  return preview?.validation || result?.validation || run?.validation || {};
}

function validationErrors(validation) {
  return groupDiagnostics(asArray(validation?.errors).map((error) => ({
    code: error?.code || "analysis_validation_failed",
    message: error?.message || error?.code || String(error),
    path: error?.path || null,
    experimentLabel: error?.experimentLabel || null,
    fieldName: error?.fieldName || null,
    traceId: error?.traceId || null,
    traceIndex: Number.isInteger(error?.traceIndex) ? error.traceIndex : null,
    actualUnit: error?.actualUnit ?? null,
    expectedUnits: asArray(error?.expectedUnits),
    count: Number.isInteger(error?.count) && error.count > 0 ? error.count : undefined,
    examples: asArray(error?.examples),
  })));
}

function diagnosticKey(item) {
  return JSON.stringify([
    item?.code || "analysis_validation_failed",
    item?.message || "",
    item?.actualUnit ?? null,
    asArray(item?.expectedUnits),
  ]);
}

function groupDiagnostics(items) {
  const grouped = new Map();
  asArray(items).forEach((item) => {
    const normalized = typeof item === "string"
      ? { code: "analysis_validation_failed", message: item }
      : item || { code: "analysis_validation_failed", message: "Analysis validation failed." };
    const key = diagnosticKey(normalized);
    const current = grouped.get(key) || { ...normalized, count: 0, examples: [] };
    current.count += Number.isInteger(normalized.count) && normalized.count > 0
      ? normalized.count
      : 1;
    asArray(normalized.examples).forEach((example) => {
      if (current.examples.length < 3 && !current.examples.includes(example)) current.examples.push(example);
    });
    const example = [
      normalized.experimentLabel,
      normalized.fieldName,
    ].filter(Boolean).join(" / ")
      || normalized.traceId
      || (Number.isInteger(normalized.traceIndex) ? `trace ${normalized.traceIndex + 1}` : "")
      || normalized.path
      || "";
    if (example && current.examples.length < 3 && !current.examples.includes(example)) current.examples.push(example);
    grouped.set(key, current);
  });
  return [...grouped.values()];
}

function actionErrorDetails(error) {
  if (!error) return null;
  if (typeof error === "string") return { message: error, diagnostics: [] };
  const diagnostics = asArray(error?.details?.errors || error?.error?.details?.errors).map((item) => ({
    ...item,
    code: item?.code || "analysis_action_failed",
    message: item?.message || item?.code || "Analysis action failed.",
  }));
  return {
    message: error?.message || String(error),
    diagnostics: groupDiagnostics(diagnostics),
  };
}

function diagnosticSuffix(item) {
  const parts = [];
  if (item?.policy) parts.push(item.policy);
  if (item?.module) parts.push(`module ${item.module}`);
  if (item?.call) parts.push(`call ${item.call}`);
  if (item?.attribute) parts.push(`attribute ${item.attribute}`);
  if (Number.isInteger(item?.line)) parts.push(`line ${item.line}`);
  if (item?.count > 1) parts.push(`${item.count} occurrences`);
  if (asArray(item?.examples).length) parts.push(`examples: ${item.examples.join(", ")}`);
  return parts.join(" | ");
}

function AnalysisActionError({ error }) {
  const detail = actionErrorDetails(error);
  if (!detail) return null;
  return (
    <div className="analysis-review-error analysis-action-error" role="alert">
      <p>{detail.message}</p>
      {detail.diagnostics.map((item, index) => (
        <div key={`${item.code}-${index}`}>
          <strong>{item.code}</strong>
          <span>{item.message}</span>
          {diagnosticSuffix(item) && <small>{diagnosticSuffix(item)}</small>}
        </div>
      ))}
    </div>
  );
}

function resultSummary(run, result, preview) {
  const summary = preview?.changeSummary || preview?.summary || result?.summary;
  if (summary) return summary;
  const validation = resultValidation(run, result, preview);
  return {
    pointCount: validation?.pointCount,
    seriesCount: validation?.traceCount,
    excludedCount: validation?.excludedCount,
  };
}

function previewCellValue(row, column) {
  if (column.id === "experiment") return row.label;
  const cell = row.cells?.[column.id];
  if (!cell || cell.value == null || cell.value === "") return "-";
  return cell.formattedValue ?? cell.value;
}

function typeLabel(value) {
  const normalized = String(value || "string").trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Text";
}

function sourceValue(sourceRef) {
  if (!sourceRef) return "Not available";
  const value = sourceRef.rawValue ?? sourceRef.formattedValue;
  return value == null || value === "" ? "Blank" : String(value);
}

function sourceLocation(sourceRef) {
  if (!sourceRef) return "No source reference";
  const file = sourceRef.fileName || sourceRef.sourceDocumentId || "Workbook";
  const sheet = sourceRef.sheet || "Sheet";
  const cell = sourceRef.cell || sourceRef.range || "";
  return `${file} · ${sheet}${cell ? `!${cell}` : ""}`;
}

function sourceType(sourceRef) {
  const value = sourceRef?.rawValue ?? sourceRef?.formattedValue;
  if (value == null || value === "") return "Blank";
  if (typeof value === "number") return "Number";
  if (typeof value === "boolean") return "Boolean";
  return "Text";
}

function conversionLabel(cell, column) {
  const sourceRef = cell?.sourceRefs?.[0];
  const storedType = typeLabel(cell?.storedType || column?.valueType);
  const rawType = sourceType(sourceRef);
  if (!sourceRef || rawType === "Blank" || rawType === storedType) return "None";
  return `${rawType} → ${storedType}`;
}

function resultReady(run, result, preview) {
  const validation = resultValidation(run, result, preview);
  return Boolean(
    run?.status === "awaiting_result_review"
    && result?.status === "awaiting_review"
    && previewIdentityMatches(run, result, preview)
    && validation?.ok !== false
    && validationErrors(validation).length === 0
  );
}

function previewIdentityMatches(run, result, preview) {
  if (!run?.id || !result?.id || !preview) return false;
  return preview.analysisRunId === run.id
    && preview.analysisResultId === result.id;
}

function previewIdentityError(run, result, preview) {
  if (!preview || !run || !result || previewIdentityMatches(run, result, preview)) return null;
  return {
    code: "analysis_preview_identity_mismatch",
    message: "The loaded preview does not match the visible analysis result.",
  };
}

function traceName(trace, index) {
  return trace?.name
    || trace?.experimentLabel
    || trace?.experimentId
    || trace?.traceId
    || `Trace ${index + 1}`;
}

function traceIdentifier(trace, index) {
  return String(
    trace?.traceId
      || trace?.meta?.labrat?.traceId
      || `trace_${index + 1}`,
  ).trim();
}

function previewTraces(preview) {
  return asArray(preview?.plotly?.data).length
    ? asArray(preview.plotly.data)
    : asArray(preview?.traces);
}

function plotTitle(layout, reviewPlan) {
  const title = layout?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  if (typeof title?.text === "string" && title.text.trim()) return title.text.trim();
  return reviewPlan?.chart?.title || "Chart result";
}

function resultPlot(traces, plotlyLayout = {}) {
  return {
    traces: asArray(traces).map((trace) => structuredClone(trace)),
    layout: plotLayout({
      ...(plotlyLayout && typeof plotlyLayout === "object" ? structuredClone(plotlyLayout) : {}),
      height: 340,
    }),
    config: {
      displayModeBar: false,
      responsive: true,
      staticPlot: true,
    },
  };
}

async function loadCompleteResultPreview(loadResultPreview, runId, options = {}) {
  return Object.keys(options).length
    ? loadResultPreview(runId, options)
    : loadResultPreview(runId);
}

function ChartResultStage({
  run,
  result,
  preview,
  loading,
  error,
  deterministicTemplate = false,
  reviewErrors = [],
  defaultVisibleTraceIds,
  onDefaultVisibleTraceIdsChange,
  PlotComponent,
  reviewPlan,
}) {
  const [seriesSearch, setSeriesSearch] = useState("");
  const traces = previewTraces(preview);
  const selected = new Set(defaultVisibleTraceIds);
  const visibleTraces = traces.filter((trace, index) => (
    selected.has(traceIdentifier(trace, index))
  ));
  const summary = resultSummary(run, result, preview);
  const validation = resultValidation(run, result, preview);
  const errors = groupDiagnostics([...validationErrors(validation), ...reviewErrors]);
  const exclusions = asArray(preview?.exclusions);
  const normalizedSearch = seriesSearch.trim().toLowerCase();
  const filteredTraces = traces.filter((trace, index) => (
    !normalizedSearch || traceName(trace, index).toLowerCase().includes(normalizedSearch)
  ));
  const calculating = !error && (loading || ["queued", "running"].includes(run?.status));
  const failed = Boolean(error) || errors.length > 0 || ["failed", "validation_failed"].includes(run?.status);
  const ready = Boolean(result?.id && preview && !calculating && !failed);

  useEffect(() => {
    setSeriesSearch("");
  }, [preview?.analysisResultId]);

  return (
    <section className="analysis-chart-stage" aria-label="Analysis result">
      <header className="analysis-result-toolbar">
        <div>
          <strong>{plotTitle(preview?.plotly?.layout, reviewPlan)}</strong>
          <span>
            {ready
              ? `${summary.pointCount ?? 0} points · ${summary.seriesCount ?? traces.length} series`
              : calculating
                ? deterministicTemplate ? "Applying accepted template" : "Calculating accepted plan"
                : failed ? "Chart could not be generated" : "Waiting for result"}
          </span>
        </div>
        {traces.length > 1 && (
          <details className="analysis-series-menu">
            <summary>
              Series
              <span>{selected.size}/{traces.length}</span>
            </summary>
            <div className="analysis-series-popover">
              <input
                type="search"
                value={seriesSearch}
                placeholder="Search series"
                aria-label="Search chart series"
                onChange={(event) => setSeriesSearch(event.target.value)}
              />
              <div className="analysis-series-actions">
                <button
                  type="button"
                  onClick={() => onDefaultVisibleTraceIdsChange(
                    traces.map((trace, index) => traceIdentifier(trace, index)),
                  )}
                >
                  Select all
                </button>
                <button type="button" onClick={() => onDefaultVisibleTraceIdsChange([])}>Clear</button>
              </div>
              <div className="analysis-series-options">
                {filteredTraces.map((trace, index) => {
                  const name = traceName(trace, index);
                  const id = traceIdentifier(trace, index);
                  return (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        aria-label={`Show ${name} by default`}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          onDefaultVisibleTraceIdsChange([...next]);
                        }}
                      />
                      <span>{name}</span>
                      <small>{trace.type || "scatter"}</small>
                    </label>
                  );
                })}
                {!filteredTraces.length && <p>No series match this search.</p>}
              </div>
            </div>
          </details>
        )}
      </header>
      <div className="analysis-chart-preview">
        {calculating && (
          <div className="analysis-result-empty" role="status">
            <strong>{deterministicTemplate ? "Applying chart template" : "Calculating chart"}</strong>
            <span>
              {deterministicTemplate
                ? "LabRat is applying the accepted template to the selected experiments and validating its output."
                : "LabRat is running the accepted Python plan and validating its output."}
            </span>
          </div>
        )}
        {!calculating && (error || failed) && (
          <div className="analysis-result-empty failed" role="alert">
            <strong>Chart could not be generated</strong>
            <span>{error || errors[0]?.message || "The accepted calculation did not produce a valid chart result."}</span>
            {errors.slice(1, 4).map((item, index) => (
              <small key={`${item.code || "error"}-${index}`}>{item.message}</small>
            ))}
          </div>
        )}
        {ready && !traces.length && (
          <div className="analysis-result-empty failed" role="alert">
            <strong>No chart series were returned</strong>
            <span>Submit a modification so LabRat can revise the calculation plan.</span>
          </div>
        )}
        {ready && traces.length > 0 && !visibleTraces.length && (
          <div className="analysis-result-empty">
            <strong>No series selected</strong>
            <span>Select at least one series before accepting this chart.</span>
          </div>
        )}
        {ready && visibleTraces.length > 0 && (() => {
          const plot = resultPlot(visibleTraces, preview?.plotly?.layout);
          return <PlotComponent traces={plot.traces} layout={plot.layout} config={plot.config} />;
        })()}
      </div>
      {ready && (exclusions.length > 0 || asArray(preview?.warnings).length > 0) && (
        <div className="analysis-result-notices">
          {exclusions.map((excluded, index) => (
            <p key={`${excluded.label || "excluded"}-${index}`}>
              <strong>{excluded.label || `Excluded item ${index + 1}`}</strong>
              <span>{excluded.reason || "This item was excluded by the reviewed plan."}</span>
            </p>
          ))}
          {asArray(preview?.warnings).map((warning, index) => (
            <p key={`${warning.code || "warning"}-${index}`}>
              <strong>Warning</strong>
              <span>{warning.message || warning.code || String(warning)}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function BrowserResultStage({
  run,
  result,
  preview,
  loading,
  error,
  identityResolutions,
  onIdentityResolutionChange,
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [inspectedCell, setInspectedCell] = useState(null);
  const fullscreenButtonRef = useRef(null);
  const returnFocusRef = useRef(null);
  const shouldRestoreFocusRef = useRef(false);
  const columns = asArray(preview?.columns);
  const requestedColumns = asArray(preview?.browserView?.visibleColumnIds);
  const visibleIds = requestedColumns.length
    ? requestedColumns
    : columns.slice(0, 9).map((column) => column.id);
  const visibleColumns = columns.filter((column) => visibleIds.includes(column.id));
  const rows = asArray(preview?.rows);
  const changesByExperiment = new Map(asArray(preview?.rowChanges)
    .map((item) => [item.experimentId, item]));
  const conflicts = asArray(preview?.identityCandidates)
    .filter((candidate) => candidate.status === "conflict");
  const validation = resultValidation(run, result, preview);
  const errors = validationErrors(validation);
  const calculating = !error && (loading || ["queued", "running"].includes(run?.status));
  const failed = Boolean(error) || errors.length > 0 || ["failed", "validation_failed"].includes(run?.status);
  const ready = Boolean(result?.id && preview && !calculating && !failed);

  useEffect(() => {
    if (!fullscreen) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setFullscreen(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    shouldRestoreFocusRef.current = true;
    fullscreenButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [fullscreen]);

  useEffect(() => {
    if (fullscreen || !shouldRestoreFocusRef.current) return;
    shouldRestoreFocusRef.current = false;
    returnFocusRef.current?.focus();
  }, [fullscreen]);

  const browserStage = (
    <section
      className={`analysis-browser-stage${fullscreen ? " is-fullscreen" : ""}`}
      aria-label="Experiment Browser result"
      aria-modal={fullscreen ? "true" : undefined}
      role={fullscreen ? "dialog" : undefined}
    >
      <header className="analysis-result-toolbar">
        <div>
          <strong>Experiment Browser preview</strong>
          <span>
            {ready
              ? `${preview.totalCount ?? rows.length} experiments · ${columns.length} columns`
              : calculating
                ? "Preparing reviewed experiment records"
                : failed ? "Experiment data could not be prepared" : "Waiting for result"}
          </span>
          {ready && <span className="analysis-browser-preview-status">Validated preview · Not published</span>}
        </div>
        {ready && rows.length > 0 && (
          <button
            type="button"
            className="analysis-browser-fullscreen-button"
            ref={fullscreen ? fullscreenButtonRef : returnFocusRef}
            onClick={() => setFullscreen((current) => !current)}
          >
            {fullscreen ? "Exit full screen" : "View full screen"}
          </button>
        )}
      </header>
      <div className="analysis-browser-preview">
        {calculating && (
          <div className="analysis-result-empty" role="status">
            <strong>Preparing Experiment Browser data</strong>
            <span>LabRat is running the accepted Python plan, preserving existing fields, and validating source references.</span>
          </div>
        )}
        {!calculating && failed && (
          <div className="analysis-result-empty failed" role="alert">
            <strong>Experiment data could not be prepared</strong>
            <span>{error || errors[0]?.message || "The generated record patches did not pass backend validation."}</span>
          </div>
        )}
        {ready && !rows.length && (
          <div className="analysis-result-empty failed" role="alert">
            <strong>No experiment records were returned</strong>
            <span>Submit a modification so LabRat can revise the data plan.</span>
          </div>
        )}
        {ready && rows.length > 0 && (
          <div className="analysis-browser-table-wrap">
            <table className="analysis-browser-table">
              <thead>
                <tr>
                  {visibleColumns.map((column) => (
                    <th key={column.id}>
                      <span>{column.label}</span>
                      <small className="analysis-browser-type-badge">{typeLabel(column.valueType)}</small>
                    </th>
                  ))}
                  <th>Changes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const change = changesByExperiment.get(row.experimentId);
                  return (
                    <tr key={row.experimentId}>
                      {visibleColumns.map((column) => (
                        <td key={column.id}>
                          {column.id === "experiment" ? previewCellValue(row, column) : (
                            <button
                              type="button"
                              className="analysis-browser-cell-button"
                              onClick={() => setInspectedCell({ row, column, cell: row.cells?.[column.id] || null })}
                              aria-label={`Inspect ${column.label} for ${row.label}`}
                            >
                              {previewCellValue(row, column)}
                            </button>
                          )}
                        </td>
                      ))}
                      <td>
                        <div className="analysis-browser-change-list">
                          {asArray(change?.changes).slice(0, 4).map((item, index) => (
                            <span className={item.kind} key={`${item.kind}-${item.columnId || item.seriesKey}-${index}`}>
                              {item.kind === "new_field" || item.kind === "new_series" ? "New" : "Changed"}: {item.label}
                            </span>
                          ))}
                          {Number(change?.preservedFieldCount) > 0 && (
                            <span className="preserved">{change.preservedFieldCount} preserved</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {ready && inspectedCell && (
          <aside className="analysis-browser-cell-inspector" aria-label="Stored value details">
            <header>
              <div>
                <strong>{inspectedCell.column.label}</strong>
                <span>{inspectedCell.row.label}</span>
              </div>
              <button type="button" onClick={() => setInspectedCell(null)} aria-label="Close stored value details">×</button>
            </header>
            <dl>
              <div><dt>Proposed stored value</dt><dd>{previewCellValue(inspectedCell.row, inspectedCell.column)}</dd></div>
              <div><dt>Proposed stored type</dt><dd>{typeLabel(inspectedCell.cell?.storedType || inspectedCell.column.valueType)}</dd></div>
              <div><dt>Unit</dt><dd>{inspectedCell.cell?.unit || inspectedCell.column.unit || "None"}</dd></div>
              <div><dt>Numeric scale</dt><dd>{inspectedCell.cell?.numericScale || inspectedCell.column.numericScale || "Not applicable"}</dd></div>
              <div><dt>Source value</dt><dd>{sourceValue(inspectedCell.cell?.sourceRefs?.[0])}</dd></div>
              <div><dt>Source type</dt><dd>{sourceType(inspectedCell.cell?.sourceRefs?.[0])}</dd></div>
              <div><dt>Conversion</dt><dd>{conversionLabel(inspectedCell.cell, inspectedCell.column)}</dd></div>
              <div><dt>Source</dt><dd>{sourceLocation(inspectedCell.cell?.sourceRefs?.[0])}</dd></div>
              <div><dt>Status</dt><dd>{inspectedCell.cell?.missingReason ? `Missing · ${inspectedCell.cell.missingReason}` : "Validated"}</dd></div>
            </dl>
          </aside>
        )}
      </div>
      {ready && conflicts.length > 0 && (
        <section className="analysis-identity-conflicts" aria-label="Experiment identity conflicts">
          <header>
            <strong>Resolve experiment matches</strong>
            <span>{conflicts.length} require review</span>
          </header>
          {conflicts.map((candidate) => {
            const decision = identityResolutions[candidate.candidateId] || {};
            return (
              <div key={candidate.candidateId}>
                <strong>{candidate.sourceAlias}</strong>
                <select
                  aria-label={`Identity action for ${candidate.sourceAlias}`}
                  value={decision.action || ""}
                  onChange={(event) => onIdentityResolutionChange(candidate.candidateId, {
                    action: event.target.value,
                    experimentId: "",
                  })}
                >
                  <option value="">Choose...</option>
                  <option value="create">Create new</option>
                  <option value="reuse">Reuse existing</option>
                </select>
                {decision.action === "reuse" && (
                  <select
                    aria-label={`Existing experiment for ${candidate.sourceAlias}`}
                    value={decision.experimentId || ""}
                    onChange={(event) => onIdentityResolutionChange(candidate.candidateId, {
                      ...decision,
                      experimentId: event.target.value,
                    })}
                  >
                    <option value="">Choose experiment...</option>
                    {asArray(candidate.matches).map((match) => (
                      <option value={match.id} key={match.id}>{match.label}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </section>
      )}
      {ready && asArray(preview?.exclusions).length > 0 && (
        <div className="analysis-result-notices">
          {asArray(preview.exclusions).map((excluded, index) => (
            <p key={`${excluded.label}-${index}`}>
              <strong>{excluded.label}</strong>
              <span>{excluded.reason}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );

  return fullscreen ? createPortal(browserStage, document.body) : browserStage;
}

export function AnalysisReviewWorkspace({
  projectId,
  thread: initialThread,
  revision: initialRevision,
  planRevisions: initialPlanRevisions = null,
  selection: controlledSelection = null,
  run: initialRun = null,
  result: initialResult = null,
  resultPreview: initialResultPreview = null,
  WorkbookWorkspaceComponent = null,
  PlotComponent = Plot,
  loadThread = getAnalysisThread,
  loadSelection = getAnalysisPlanSelection,
  loadRun = getAnalysisRun,
  executeRun = executeAnalysisRun,
  retryRun = retryAnalysisRun,
  loadResultPreview = getAnalysisResultPreview,
  reviseRun = reviseAnalysisRun,
  createRevision = createAnalysisPlanRevision,
  acceptPlan = acceptAnalysisPlanRevision,
  analysisCapabilities = null,
  loadAnalysisCapabilities = getProjectAnalysisCapabilities,
  onAcceptResult = null,
  chartSpecs = [],
  saveTemplate = createServerReusableChartTemplate,
  loadTemplateEligibility = null,
  onTemplateSaved = null,
  onClose,
  onAccepted,
  embedded = false,
  onWorkflowStateChange = null,
  executionStrategy = "model_generated_python",
  runRefreshIntervalMs = 1000,
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
  const [actionError, setActionError] = useState(null);
  const [activeTab, setActiveTab] = useState(
    initialRun || initialResult || initialResultPreview ? "result" : "source",
  );
  const [run, setRun] = useState(initialRun);
  const [result, setResult] = useState(initialResult);
  const [resultState, setResultState] = useState({
    loading: false,
    error: "",
    value: initialResultPreview,
  });
  const [defaultVisibleTraceIds, setDefaultVisibleTraceIds] = useState(
    () => previewTraces(initialResultPreview).map(traceIdentifier),
  );
  const [identityResolutions, setIdentityResolutions] = useState({});
  const [acceptedChartSpec, setAcceptedChartSpec] = useState(null);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savedTemplate, setSavedTemplate] = useState(null);
  const [templateEligibility, setTemplateEligibility] = useState({ loading: false, value: null });
  const [runHistory, setRunHistory] = useState(() => (
    initialRun ? [{ run: initialRun, result: initialResult }] : []
  ));
  const [capabilityState, setCapabilityState] = useState({
    loading: !analysisCapabilities,
    value: analysisCapabilities,
  });
  const automaticExecutionRef = useRef(new Set());
  const executorCapabilityReady = !capabilityState.loading
    && capabilityState.value?.executor?.configured === true;
  const resolvedExecutionStrategy = persistedExecutionStrategy(run || initialRun, executionStrategy);
  const requiresPythonExecutor = resolvedExecutionStrategy === "model_generated_python";
  const previewRequestRef = useRef(0);
  const executeRunForStrategy = (analysisRunId, strategy = resolvedExecutionStrategy) => (
    strategy === "model_generated_python"
      ? executeRun(analysisRunId)
      : executeRun(analysisRunId, { executionStrategy: strategy })
  );

  useEffect(() => {
    previewRequestRef.current += 1;
    setThread(initialThread || null);
    setRevision(initialRevision || null);
    setRevisions(initialPlanRevisions || (initialRevision ? [initialRevision] : []));
    setRun(initialRun);
    setResult(initialResult);
    setResultState({ loading: false, error: "", value: initialResultPreview });
    setDefaultVisibleTraceIds(
      previewTraces(initialResultPreview).map(traceIdentifier),
    );
    setIdentityResolutions({});
    setAcceptedChartSpec(null);
    setTemplateFormOpen(false);
    setTemplateName("");
    setSavedTemplate(null);
    setTemplateEligibility({ loading: false, value: null });
    setRunHistory(initialRun ? [{ run: initialRun, result: initialResult }] : []);
    setActiveTab(initialRun || initialResult || initialResultPreview ? "result" : "source");
    setActionError("");
    automaticExecutionRef.current.clear();
    setCapabilityState({ loading: !analysisCapabilities, value: analysisCapabilities });
  }, [
    initialResult?.id,
    initialResultPreview?.analysisResultId,
    initialRevision?.id,
    initialRun?.id,
    initialThread?.id,
    analysisCapabilities,
  ]);

  useEffect(() => {
    if (!requiresPythonExecutor || analysisCapabilities || !projectId) return undefined;
    let cancelled = false;
    loadAnalysisCapabilities(projectId)
      .then((value) => {
        if (!cancelled) setCapabilityState({ loading: false, value });
      })
      .catch(() => {
        if (!cancelled) setCapabilityState({ loading: false, value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [analysisCapabilities, loadAnalysisCapabilities, projectId, requiresPythonExecutor]);

  useEffect(() => {
    const needsAcceptedRunDiscovery = !initialRun?.id && initialRevision?.status === "accepted";
    if (!initialThread?.id || (initialPlanRevisions && !needsAcceptedRunDiscovery)) return undefined;
    let cancelled = false;
    loadThread(initialThread.id)
      .then((body) => {
        if (cancelled) return;
        const loadedRevisions = asArray(body?.planRevisions);
        const loadedRuns = asArray(body?.analysisRuns);
        const activeRevision = loadedRevisions.findLast((item) => (
          item.status === "awaiting_review" || item.status === "accepted"
        ))
          || loadedRevisions.find((item) => item.id === initialRevision?.id)
          || loadedRevisions.at(-1)
          || initialRevision;
        setThread(body?.analysisThread || initialThread);
        setRevisions(loadedRevisions);
        setRevision(activeRevision);
        const latestRun = loadedRuns.findLast((item) => (
          item.acceptedPlanRevisionId === activeRevision?.id
        )) || null;
        setRunHistory(loadedRuns.map((item) => ({ run: item, result: null })));
        if (!latestRun?.id) return;
        setRun((current) => preferredRun(current, latestRun));
        setActiveTab("result");
      })
      .catch((error) => {
        if (!cancelled) setActionError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    initialPlanRevisions,
    initialRevision?.id,
    initialRevision?.status,
    initialRun?.id,
    initialThread?.id,
    loadThread,
  ]);

  useEffect(() => {
    if (!run?.id) return undefined;
    const needsResultHydration = ["awaiting_result_review", "completed"].includes(run.status)
      && (!result?.id || !previewIdentityMatches(run, result, resultState.value));
    if (!["queued", "running"].includes(run.status) && !needsResultHydration) return undefined;
    if (run.status === "queued" && requiresPythonExecutor && !executorCapabilityReady) return undefined;

    let cancelled = false;
    let refreshTimer = null;
    let requestInFlight = false;
    let consecutiveRefreshFailures = 0;
    const runId = run.id;
    const strategy = persistedExecutionStrategy(run, resolvedExecutionStrategy);

    const scheduleRefresh = () => {
      if (cancelled || refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshRun();
      }, runRefreshIntervalMs);
    };

    const applyRunResponse = async (response, fallbackRun = run) => {
      const refreshedRun = response?.analysisRun || fallbackRun;
      const refreshedResult = response?.analysisResult || null;
      let loadedPreview = null;
      let previewError = "";

      if (refreshedResult?.id) {
        try {
          const refreshedRevision = response?.analysisPlanRevision || revision;
          loadedPreview = refreshedRevision?.outputTarget === "experiment_browser"
            ? await loadCompleteResultPreview(loadResultPreview, refreshedRun.id, { offset: 0, limit: 100 })
            : await loadCompleteResultPreview(loadResultPreview, refreshedRun.id);
        } catch (error) {
          previewError = error?.message || String(error);
        }
      }
      if (cancelled) return refreshedRun;

      if (response?.analysisThread) setThread(response.analysisThread);
      if (response?.analysisPlanRevision) setRevision(response.analysisPlanRevision);
      setRun((current) => preferredRun(current, refreshedRun));
      if (refreshedResult?.id) setResult(refreshedResult);
      setRunHistory((current) => {
        const existing = current.find((item) => item.run.id === refreshedRun.id);
        if (!existing) return [...current, { run: refreshedRun, result: refreshedResult }];
        return current.map((item) => item.run.id === refreshedRun.id
          ? {
            run: preferredRun(item.run, refreshedRun),
            result: refreshedResult || item.result,
          }
          : item);
      });
      if (loadedPreview) {
        setResultState({ loading: false, error: "", value: loadedPreview });
        setDefaultVisibleTraceIds(previewTraces(loadedPreview).map(traceIdentifier));
      } else if (previewError) {
        setResultState((current) => ({ ...current, loading: false, error: previewError }));
      }
      setActionError(null);
      return refreshedRun;
    };

    const refreshRun = async () => {
      if (cancelled || requestInFlight) return;
      requestInFlight = true;
      let attemptedExecution = false;
      try {
        let response;
        if (run.status === "queued" && !automaticExecutionRef.current.has(runId)) {
          automaticExecutionRef.current.add(runId);
          attemptedExecution = true;
          response = await executeRunForStrategy(runId, strategy);
        } else {
          response = await loadRun(runId);
        }
        const refreshedRun = await applyRunResponse(response);
        consecutiveRefreshFailures = 0;
        if (["queued", "running"].includes(refreshedRun?.status)) scheduleRefresh();
      } catch (error) {
        if (cancelled) return;
        consecutiveRefreshFailures += 1;
        if (attemptedExecution) {
          try {
            const recoveryResponse = await loadRun(runId);
            const recoveredRun = await applyRunResponse(recoveryResponse);
            if (recoveredRun?.status === "queued") automaticExecutionRef.current.delete(runId);
            if (["queued", "running"].includes(recoveredRun?.status)) scheduleRefresh();
            return;
          } catch {
            automaticExecutionRef.current.delete(runId);
          }
        }
        if (consecutiveRefreshFailures >= 2) setActionError(error);
        scheduleRefresh();
      } finally {
        requestInFlight = false;
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshRun();
    };
    window.addEventListener("focus", refreshRun);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    refreshRun();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener("focus", refreshRun);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [
    executorCapabilityReady,
    executeRun,
    loadResultPreview,
    loadRun,
    requiresPythonExecutor,
    resolvedExecutionStrategy,
    result?.id,
    resultState.value,
    revision,
    run?.id,
    run?.status,
    runRefreshIntervalMs,
  ]);

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
  const experimentSelections = useMemo(
    () => asArray(selectionState.value?.experimentSelections || revision?.experimentSelections),
    [revision?.experimentSelections, revision?.id, selectionState.value?.experimentSelections],
  );
  const visibleCalculationSteps = useMemo(
    () => calculationPlanSteps(revision),
    [revision],
  );
  const activeRectangle = rectangles.find((rectangle) => rectangle.draftRegionId === activeRectangleId)
    || rectangles[0]
    || null;
  const currentActiveId = activeRectangle?.draftRegionId || "";
  const rectangleFocusSelection = activeRectangle ? {
    requestId: `${revision?.id || "revision"}:${currentActiveId}`,
    sourceDocumentId: activeRectangle.sourceDocumentId,
    sheetName: activeRectangle.sheetName,
    range: activeRectangle.range,
    focusOnly: true,
  } : null;
  const focusSelection = rectangleFocusSelection;
  const busy = Boolean(pendingAction);
  const awaitingReview = revision?.status === "awaiting_review" && !run;
  const executorReady = !requiresPythonExecutor || executorCapabilityReady;
  const executorUnavailable = !executorReady;
  const planAcceptanceDisabled = !awaitingReview || busy || !executorReady;
  const preview = resultState.value;
  const declaredOutputTargets = [
    thread?.outputTarget,
    revision?.outputTarget,
    run?.outputTarget,
    result?.outputTarget,
    preview?.outputTarget,
  ].filter(Boolean);
  const browserMode = declaredOutputTargets.includes("experiment_browser");
  const outputTarget = browserMode ? "experiment_browser" : declaredOutputTargets[0] || "chart";
  const validation = resultValidation(run, result, preview);
  const identityError = previewIdentityError(run, result, preview);
  const errors = [
    ...validationErrors(validation),
    ...(identityError ? [identityError] : []),
  ];
  const hasResultStage = Boolean(run || result || preview);
  const hasChartStage = previewTraces(preview).length > 0;
  const hasBrowserStage = asArray(preview?.rows).length > 0;
  const chartReady = resultReady(run, result, preview);
  const chartCalculating = ["queued", "running"].includes(run?.status) || pendingAction === "execute";
  const chartFinalized = result?.status === "accepted";
  const sourceChartSpec = acceptedChartSpec
    || asArray(chartSpecs).find((item) => item?.analysisResultId === result?.id)
    || asArray(chartSpecs).find((item) => asArray(thread?.chartSpecIds).includes(item?.id))
    || null;
  const templateEligibilityRequired = typeof loadTemplateEligibility === "function";
  const templateEligibilityStatus = templateEligibility.value?.status || (templateEligibilityRequired ? "checking" : "not_checked");
  const visibleResultSummary = resultSummary(run, result, preview);
  const browserPreviewUnavailable = browserMode
    && ["failed", "validation_failed"].includes(run?.status);
  const generationFailure = runFailureMessage(run);
  const revisionById = new Map(revisions.map((item) => [item.id, item]));
  const resultExclusions = asArray(preview?.exclusions);
  const unresolvedIdentityConflicts = asArray(preview?.identityCandidates)
    .filter((candidate) => candidate.status === "conflict")
    .filter((candidate) => {
      const resolution = identityResolutions[candidate.candidateId];
      return !resolution?.action
        || resolution.action === "reuse" && !resolution.experimentId;
    });
  const canAcceptResult = chartReady
    && (browserMode
      ? hasBrowserStage && unresolvedIdentityConflicts.length === 0
      : hasChartStage && defaultVisibleTraceIds.length > 0)
    && Boolean(onAcceptResult);
  const resultReviewMode = hasResultStage && revision?.status === "accepted";

  useEffect(() => {
    if (!chartFinalized || !sourceChartSpec?.id || typeof loadTemplateEligibility !== "function") {
      setTemplateEligibility({ loading: false, value: null });
      return undefined;
    }
    let active = true;
    setTemplateEligibility({ loading: true, value: null });
    loadTemplateEligibility(sourceChartSpec.id)
      .then((value) => {
        if (active) setTemplateEligibility({ loading: false, value });
      })
      .catch((error) => {
        if (active) {
          setTemplateEligibility({
            loading: false,
            value: {
              status: "unavailable",
              blockers: [{ message: error?.message || String(error) }],
            },
          });
        }
      });
    return () => { active = false; };
  }, [chartFinalized, loadTemplateEligibility, sourceChartSpec?.id]);

  useEffect(() => {
    onWorkflowStateChange?.({
      thread,
      revision,
      run,
      result,
      preview,
      pendingAction,
      previewReady: chartReady,
      published: chartFinalized,
      error: actionError || resultState.error || generationFailure || null,
      generationFailure,
    });
  }, [
    actionError,
    chartFinalized,
    chartReady,
    generationFailure,
    onWorkflowStateChange,
    pendingAction,
    preview,
    result,
    resultState.error,
    revision,
    run,
    thread,
  ]);

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
      setIdentityResolutions({});
      setActiveTab("source");
    } catch (error) {
      setActionError(error);
    } finally {
      setPendingAction("");
    }
  };

  const acceptVisiblePlan = async () => {
    if (!revision?.id || busy || !awaitingReview || executorUnavailable) return;
    setPendingAction("accept");
    setActionError("");
    try {
      const response = await acceptPlan(revision.id, {}, {
        idempotencyKey: acceptanceKey(revision),
      });
      const acceptedRevision = response?.analysisPlanRevision || { ...revision, status: "accepted" };
      setRevision(acceptedRevision);
      setRevisions((current) => current.map((item) => (
        item.id === acceptedRevision.id ? acceptedRevision : item
      )));
      const queuedRun = response?.analysisRun || { status: "queued" };
      setRun(queuedRun);
      setIdentityResolutions({});
      setRunHistory((current) => [...current, { run: queuedRun, result: null }]);
      setActiveTab("result");
      onAccepted?.(response);
    } catch (error) {
      setActionError(error);
    } finally {
      setPendingAction("");
    }
  };

  const submitResultFeedback = async () => {
    const nextFeedback = feedback.trim();
    if (!nextFeedback || busy || !run?.id || !resultReviewMode || chartFinalized) return;
    setPendingAction("result_revision");
    setActionError("");
    try {
      const response = await reviseRun(run.id, {
        feedback: nextFeedback,
      });
      const nextRevision = response?.analysisPlanRevision;
      if (!nextRevision?.id) throw new Error("The backend did not return the revised analysis plan.");
      setRunHistory((current) => {
        const exists = current.some((item) => item.run.id === run.id);
        return exists
          ? current.map((item) => item.run.id === run.id ? { run, result } : item)
          : [...current, { run, result }];
      });
      setRevisions((current) => [...current, nextRevision]);
      previewRequestRef.current += 1;
      setRevision(nextRevision);
      setRun(null);
      setResult(null);
      setResultState({ loading: false, error: "", value: null });
      setDefaultVisibleTraceIds([]);
      setIdentityResolutions({});
      setFeedback("");
      setActiveRectangleId("");
      setActiveTab("source");
    } catch (error) {
      setActionError(error);
    } finally {
      setPendingAction("");
    }
  };

  const retryFailedGeneration = async () => {
    if (!run?.id || busy || !["failed", "validation_failed"].includes(run.status)) return;
    setPendingAction("retry_generation");
    setActionError(null);
    setResult(null);
    setResultState({ loading: false, error: "", value: null });
    setIdentityResolutions({});
    try {
      const retryResponse = await retryRun(run.id, {
        idempotencyKey: generationRetryKey(run),
      });
      const queuedRun = retryResponse?.analysisRun;
      if (!queuedRun?.id) throw new Error("The backend did not return a new generation attempt.");
      setThread(retryResponse?.analysisThread || thread);
      setRun(queuedRun);
      setRunHistory((current) => [...current, { run: queuedRun, result: null }]);
    } catch (error) {
      setActionError(error);
    } finally {
      setPendingAction("");
    }
  };

  const acceptVisibleResult = async () => {
    if (!canAcceptResult || busy) return;
    setPendingAction("accept_result");
    setActionError("");
    try {
      const response = await onAcceptResult({
        runId: run.id,
        analysisResultId: result.id,
        defaultVisibleTraceIds,
        ...(browserMode ? {
          identityResolutions: Object.entries(identityResolutions).map(([candidateId, value]) => ({
            candidateId,
            ...value,
          })),
        } : {}),
      });
      if (response?.analysisRun) setRun(response.analysisRun);
      if (response?.analysisResult) setResult(response.analysisResult);
      if (response?.analysisThread) setThread(response.analysisThread);
      if (response?.chartSpec) setAcceptedChartSpec(response.chartSpec);
      onAccepted?.(response);
    } catch (error) {
      setActionError(error);
    } finally {
      setPendingAction("");
    }
  };

  const openTemplateForm = () => {
    if (!sourceChartSpec?.id || busy) return;
    setTemplateName(chartTitle(preview, revision, sourceChartSpec));
    setTemplateFormOpen(true);
    setActionError("");
  };

  const submitTemplate = async (event) => {
    event?.preventDefault?.();
    const name = templateName.trim();
    if (!name || !sourceChartSpec?.id || busy) return;
    setPendingAction("save_template");
    setActionError("");
    try {
      const response = await saveTemplate(projectId, {
        name,
        sourceChartSpecId: sourceChartSpec.id,
      });
      setSavedTemplate(response?.reusableChartTemplate || { name });
      setTemplateFormOpen(false);
      onTemplateSaved?.(response);
    } catch (error) {
      setActionError(error);
    } finally {
      setPendingAction("");
    }
  };

  const openRevision = async (item) => {
    previewRequestRef.current += 1;
    setRevision(item);
    const historyItem = runHistory.find((entry) => (
      entry.run.acceptedPlanRevisionId === item.id
    ));
    setRun(historyItem?.run || null);
    setResult(historyItem?.result || null);
    setResultState({ loading: false, error: "", value: null });
    setIdentityResolutions({});
    setActiveRectangleId("");
    setActiveTab(historyItem?.run ? "result" : "source");
    if (!historyItem?.run?.id) return;
    const requestToken = previewRequestRef.current;
    setPendingAction("load_history");
    setActionError("");
    try {
      const detail = await loadRun(historyItem.run.id);
      if (requestToken !== previewRequestRef.current) return;
      const historicalRun = detail?.analysisRun || historyItem.run;
      const historicalResult = detail?.analysisResult || null;
      setRun(historicalRun);
      setResult(historicalResult);
      setRunHistory((current) => current.map((entry) => (
        entry.run.id === historicalRun.id
          ? { run: historicalRun, result: historicalResult }
          : entry
      )));
      if (!historicalResult?.id) return;
      const historicalPreview = item?.outputTarget === "experiment_browser"
        ? await loadCompleteResultPreview(loadResultPreview, historicalRun.id, {
          offset: 0,
          limit: 100,
        })
        : await loadCompleteResultPreview(loadResultPreview, historicalRun.id);
      if (requestToken !== previewRequestRef.current) return;
      setResultState({ loading: false, error: "", value: historicalPreview });
      setDefaultVisibleTraceIds(
        previewTraces(historicalPreview).map(traceIdentifier),
      );
    } catch (error) {
      if (requestToken === previewRequestRef.current) {
        setActionError(error);
      }
    } finally {
      if (requestToken === previewRequestRef.current) setPendingAction("");
    }
  };

  return (
    <section className={`analysis-review-workspace${embedded ? " is-onboarding" : ""}${hasResultStage ? " has-result-stage" : ""}`} aria-label="Analysis review">
      <header className="analysis-review-header">
        <div>
          <strong>Reviewed analysis</strong>
          <span>{thread?.originalRequest || revision?.requestSummary || "Analysis plan"}</span>
        </div>
        {onClose && <button type="button" aria-label="Close analysis review" onClick={onClose}>&times;</button>}
      </header>

      <div className="analysis-review-tabs" role="tablist" aria-label="Analysis review stages">
        <button
          id="analysis-tab-source"
          type="button"
          role="tab"
          aria-controls="analysis-panel-source"
          aria-selected={activeTab === "source"}
          onClick={() => setActiveTab("source")}
        >
          Source
        </button>
        <button
          id="analysis-tab-result"
          type="button"
          role="tab"
          aria-controls="analysis-panel-result"
          aria-selected={activeTab === "result"}
          disabled={!hasResultStage}
          onClick={() => setActiveTab("result")}
        >
          Result
        </button>
      </div>

      <div className="analysis-review-split">
        <div
          id={`analysis-panel-${activeTab}`}
          className="analysis-review-stage"
          role="tabpanel"
          aria-labelledby={`analysis-tab-${activeTab}`}
        >
          {activeTab === "source" && (
            <section className="analysis-review-source" aria-label="Selected source data">
              {rectangles.length > 0 && (
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
              )}
              {experimentSelections.length > 0 && (
                <section className="analysis-experiment-selections" aria-label="Selected published experiment data">
                  <header>
                    <strong>Published experiment data</strong>
                    <span>{experimentSelections.length} selection{experimentSelections.length === 1 ? "" : "s"}</span>
                  </header>
                  {experimentSelections.map((selection, index) => (
                    <article key={selection.selectionId || `${selection.experimentId}-${index}`}>
                      <strong>{selection.experimentLabel || selection.label || selection.experimentId || `Experiment ${index + 1}`}</strong>
                      <span>
                        {asArray(selection.fieldLabels).length
                          ? selection.fieldLabels.join(", ")
                          : asArray(selection.columnIndexes).length
                            ? selection.columnIndexes.map((columnIndex) => `Column ${Number(columnIndex) + 1}`).join(", ")
                            : "Reviewed experiment fields"}
                      </span>
                    </article>
                  ))}
                </section>
              )}
              {selectionState.loading && <p className="analysis-review-state">Loading selected source data...</p>}
              {selectionState.error && <p className="analysis-review-error" role="alert">{selectionState.error}</p>}
              {WorkbookWorkspaceComponent && rectangles.length > 0 && (
                <WorkbookWorkspaceComponent
                  projectId={projectId || thread?.projectId}
                  reviewState={{
                    regions: [],
                    sourceDocument: activeRectangle?.sourceDocumentId
                      ? { id: activeRectangle.sourceDocumentId }
                      : null,
                  }}
                  draftRegions={rectangles}
                  activeDraftRegionId={currentActiveId}
                  onDraftRegionsChange={() => {}}
                  onActiveDraftRegionChange={setActiveRectangleId}
                  focusSelection={focusSelection}
                />
              )}
            </section>
          )}
          {activeTab === "result" && (
            browserMode ? (
              <BrowserResultStage
                run={run}
                result={result}
                preview={preview}
                loading={resultState.loading}
                error={resultState.error || (
                  run?.status === "queued" && executorUnavailable
                    ? "Python execution is unavailable. Configure an analysis executor before preparing experiment data."
                    : generationFailure
                )}
                identityResolutions={identityResolutions}
                onIdentityResolutionChange={(candidateId, value) => {
                  setIdentityResolutions((current) => ({ ...current, [candidateId]: value }));
                }}
              />
            ) : (
              <ChartResultStage
                run={run}
                result={result}
                preview={preview}
                loading={resultState.loading}
                deterministicTemplate={resolvedExecutionStrategy === "chart_template_v1"}
                error={resultState.error || (
                  run?.status === "queued" && executorUnavailable
                    ? "Python execution is unavailable. Configure an analysis executor before calculating this chart."
                    : ""
                )}
                reviewErrors={identityError ? [identityError] : []}
                defaultVisibleTraceIds={defaultVisibleTraceIds}
                onDefaultVisibleTraceIdsChange={setDefaultVisibleTraceIds}
                PlotComponent={PlotComponent}
                reviewPlan={revision?.reviewPlan}
              />
            )
          )}
        </div>

        <aside className="analysis-review-conversation" aria-label="LabRat analysis conversation">
          <header className="analysis-review-conversation-head">
            <div>
              <strong>the lab rat</strong>
              <span>{resultReviewMode ? "Result review" : revision ? "Plan review" : "Planning"}</span>
            </div>
            <span>
              {chartFinalized
                ? browserMode ? "Data published" : "Chart created"
                : chartReady
                  ? "Result ready"
                  : chartCalculating
                    ? "Calculating"
                    : errors.length || ["failed", "validation_failed"].includes(run?.status)
                      ? "Needs changes"
                      : revisionStatus(revision?.status)}
            </span>
          </header>

          <div className="analysis-review-messages">
            {asArray(thread?.messages).map((message, index) => (
              <article className={`analysis-review-message ${message.role || "assistant"}`} key={message.id || index}>
                <span>
                  {message.role === "user" ? "You" : "the lab rat"}
                  {message.planRevisionId && revisionById.has(message.planRevisionId)
                    ? ` · Revision ${revisionById.get(message.planRevisionId).revision}`
                    : ""}
                </span>
                <p>{messageText(message)}</p>
              </article>
            ))}

            {revision && (
              <article className="analysis-plan-card">
                <header>
                  <strong>{browserMode ? "Experiment data plan" : "Chart plan"}</strong>
                  {!browserMode && revision.inputMode && (
                    <span className="analysis-input-mode-badge">
                      {revision.inputMode === "experiment_browser" ? "Experiment Browser data" : "Workbook ranges"}
                    </span>
                  )}
                </header>
                {revision.requestSummary && <p>{revision.requestSummary}</p>}
                <section className="analysis-plan-section">
                  <strong>Processing and calculation</strong>
                  <ol>
                    {visibleCalculationSteps.map((step, index) => (
                      <li key={`${step}-${index}`}>{step}</li>
                    ))}
                  </ol>
                </section>
                {!!asArray(revision.warnings).length && (
                  <div className="analysis-plan-warnings">
                    {asArray(revision.warnings).map((warning, index) => (
                      <p key={`${warning.code || "warning"}-${index}`}>{warning.message || warning.code || String(warning)}</p>
                    ))}
                  </div>
                )}
              </article>
            )}

            {revisions.length > 1 && (
              <section className="analysis-revision-history" aria-label="Analysis revision history">
                {revisions.map((item) => (
                  <button
                    type="button"
                    className={item.id === revision?.id ? "active" : ""}
                    key={item.id}
                    onClick={() => openRevision(item)}
                  >
                    <span>Revision {item.revision}</span>
                    <small>{revisionStatus(item.status)}</small>
                  </button>
                ))}
              </section>
            )}

            {!!runHistory.length && (
              <section className="analysis-run-history" aria-label="Analysis run history">
                {runHistory.map((item, index) => (
                  <div key={item.run.id || index}>
                    <span>Run {index + 1}</span>
                    <small>{item.run.status || "queued"}</small>
                  </div>
                ))}
              </section>
            )}

            {run && !result && ["queued", "running"].includes(run.status) && (
              <div className="analysis-review-queued" role="status">
                <strong>{run.status === "running" ? "Calculating accepted plan" : "Queued for calculation"}</strong>
                <span>
                  {browserMode
                    ? "The Experiment Browser preview will appear after backend validation passes."
                    : "The chart will appear in Result after backend validation passes."}
                </span>
              </div>
            )}
            {hasResultStage && (
              <article className="analysis-result-conversation-card">
                <header>
                  <strong>
                    {browserMode
                      ? chartFinalized ? "Experiment data published" : chartReady ? "Browser preview ready" : "Experiment data result"
                      : chartFinalized ? "Chart created" : chartReady ? "Chart ready" : "Chart result"}
                  </strong>
                  <span>
                    {chartFinalized
                      ? "Created"
                      : errors.length || ["failed", "validation_failed"].includes(run?.status)
                        ? "Blocked"
                        : chartReady ? "Ready" : run?.status || "Pending"}
                  </span>
                </header>
                <p>
                  {browserPreviewUnavailable
                    ? "Preview was not created"
                    : browserMode
                    ? `${visibleResultSummary.experimentCount ?? preview?.totalCount ?? 0} experiments · ${
                      Number(visibleResultSummary.newFieldCount || 0) + Number(visibleResultSummary.newSeriesCount || 0)
                    } new · ${
                      Number(visibleResultSummary.changedFieldCount || 0) + Number(visibleResultSummary.changedSeriesCount || 0)
                    } changed · ${visibleResultSummary.preservedFieldCount ?? 0} preserved`
                    : `${visibleResultSummary.pointCount ?? 0} points · ${visibleResultSummary.seriesCount ?? previewTraces(preview).length} series · ${
                      (visibleResultSummary.excludedCount ?? resultExclusions.length) > 0
                        ? `${visibleResultSummary.excludedCount ?? resultExclusions.length} excluded`
                        : "no exclusions"
                    }`}
                </p>
                {browserMode
                  && !browserPreviewUnavailable
                  && Number(visibleResultSummary.missingValueCount || 0) > 0 && (
                    <p>
                      {visibleResultSummary.missingValueCount} missing values across{" "}
                      {visibleResultSummary.missingExperimentCount} experiments
                    </p>
                )}
                {resultExclusions.map((excluded, index) => (
                  <p className="analysis-result-exclusion-message" key={`${excluded.label || "excluded"}-${index}`}>
                    <strong>{excluded.label || `Excluded item ${index + 1}`}</strong>
                    <span>{excluded.reason || "Excluded by the reviewed plan."}</span>
                  </p>
                ))}
                {!browserMode && chartReady && !defaultVisibleTraceIds.length && (
                  <p className="analysis-review-error">Select at least one series before accepting this chart.</p>
                )}
                {browserMode && unresolvedIdentityConflicts.length > 0 && (
                  <p className="analysis-review-error">
                    Resolve {unresolvedIdentityConflicts.length} experiment identity conflict{unresolvedIdentityConflicts.length === 1 ? "" : "s"} before publishing.
                  </p>
                )}
                {errors.map((item, index) => (
                  <p className="analysis-review-error" key={`${item.code}-${index}`}>
                    {item.message}
                    {diagnosticSuffix(item) && <small>{diagnosticSuffix(item)}</small>}
                  </p>
                ))}
              </article>
            )}
            <AnalysisActionError error={actionError} />
            {browserMode && browserPreviewUnavailable && (
              <button
                type="button"
                className="analysis-retry-generation"
                onClick={retryFailedGeneration}
                disabled={busy}
              >
                {pendingAction === "retry_generation" || pendingAction === "execute"
                  ? "Retrying generation..."
                  : "Retry generation"}
              </button>
            )}
          </div>

          <div className="analysis-review-composer">
            <button
              type="button"
              className="accept-plan"
              onClick={resultReviewMode && chartFinalized && !browserMode
                ? openTemplateForm
                : resultReviewMode ? acceptVisibleResult : acceptVisiblePlan}
              disabled={resultReviewMode && chartFinalized && !browserMode
                ? (!sourceChartSpec?.id || Boolean(savedTemplate) || busy || templateEligibility.loading || (templateEligibilityRequired && templateEligibilityStatus !== "eligible"))
                : resultReviewMode ? (!canAcceptResult || busy) : planAcceptanceDisabled}
            >
              {resultReviewMode
                ? chartFinalized
                  ? browserMode
                    ? "Data published"
                    : savedTemplate
                      ? "Template saved"
                      : templateEligibility.loading ? "Checking template..."
                        : ["ineligible", "unavailable"].includes(templateEligibilityStatus) ? "Template unavailable"
                      : pendingAction === "save_template" ? "Saving..." : "Save as template"
                  : chartCalculating
                    ? "Calculating..."
                    : pendingAction === "accept_result"
                      ? browserMode ? "Publishing..." : "Creating..."
                      : browserMode ? "Publish to Browser" : "Accept chart"
                : pendingAction === "accept" || pendingAction === "execute" ? "Working..." : "Accept plan"}
            </button>
            {!resultReviewMode && executorUnavailable && requiresPythonExecutor && (
              <p className="analysis-review-blocker" role="status">
                {capabilityState.loading
                  ? "Checking Python execution availability before this plan can be accepted."
                  : "Python execution is unavailable. Configure an analysis executor before accepting this plan."}
              </p>
            )}
            {resultReviewMode && run?.status === "queued" && executorUnavailable && requiresPythonExecutor && (
              <p className="analysis-review-blocker" role="status">
                Python execution is unavailable. Configure an analysis executor before calculating this chart.
              </p>
            )}
            {resultReviewMode && chartFinalized && !browserMode ? (
              templateFormOpen ? (
                <form className="analysis-template-save" onSubmit={submitTemplate}>
                  <label htmlFor={`chart-template-name-${result?.id || "accepted"}`}>Template name</label>
                  <div>
                    <input
                      id={`chart-template-name-${result?.id || "accepted"}`}
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      maxLength={120}
                      autoFocus
                    />
                    <button type="submit" disabled={!templateName.trim() || busy}>Save</button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setTemplateFormOpen(false)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <p className="analysis-template-save-status" role="status">
                  {savedTemplate
                    ? `Saved as “${savedTemplate.name || templateName}”.`
                    : sourceChartSpec?.id
                      ? "Save this approved chart setup for future experiment comparisons."
                      : "Reload the approved chart before saving it as a template."}
                </p>
              )
            ) : (
              <div className="analysis-review-modification">
                <textarea
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (resultReviewMode) submitResultFeedback();
                      else submitFeedback();
                    }
                  }}
                  placeholder={resultReviewMode
                    ? browserMode ? "Describe a data modification" : "Describe a chart modification"
                    : "Describe a modification"}
                  disabled={resultReviewMode ? (!run?.id || busy || chartFinalized) : (!awaitingReview || busy)}
                />
                <button
                  type="button"
                  aria-label={resultReviewMode
                    ? browserMode ? "Send data modification" : "Send chart modification"
                    : "Send modification"}
                  onClick={resultReviewMode ? submitResultFeedback : submitFeedback}
                  disabled={!feedback.trim()
                    || (resultReviewMode ? (!run?.id || chartFinalized) : !awaitingReview)
                    || busy}
                >
                  {["revision", "result_revision"].includes(pendingAction) ? "Sending..." : "Send"}
                </button>
              </div>
            )}
            {resultReviewMode && chartFinalized && !browserMode && !templateFormOpen && ["ineligible", "unavailable"].includes(templateEligibilityStatus) && (
              <div className="analysis-template-save-status" role="status">
                <strong>Template unavailable</strong>
                <ul>
                  {(asArray(templateEligibility.value?.blockers).length
                    ? asArray(templateEligibility.value?.blockers)
                    : [{ message: "This chart is not eligible for deterministic template reuse." }]
                  ).map((blocker, index) => (
                    <li key={`${blocker.code || "blocker"}-${index}`}>{blocker.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
