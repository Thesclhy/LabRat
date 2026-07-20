import React, { useEffect, useMemo, useRef, useState } from "react";

import { Plot } from "../charts/Plot.jsx";
import { plotLayout } from "../charts/chartLayout.js";
import {
  acceptAnalysisPlanRevision,
  createAnalysisPlanRevision,
  executeAnalysisRun,
  getAnalysisPlanSelection,
  getAnalysisResultPreview,
  getAnalysisRun,
  getAnalysisThread,
  reviseAnalysisRun,
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

function resultValidation(run, result, preview) {
  return preview?.validation || result?.validation || run?.validation || {};
}

function validationErrors(validation) {
  return asArray(validation?.errors).map((error) => ({
    code: error?.code || "analysis_validation_failed",
    message: error?.message || error?.code || String(error),
  }));
}

function resultSummary(result, preview) {
  return preview?.summary || result?.summary || {};
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
    && preview.analysisResultId === result.id
    && preview.contentHash === result.contentHash
    && preview.resultPreviewHash === result.resultPreviewHash;
}

function previewIdentityError(run, result, preview) {
  if (!preview || !run || !result || previewIdentityMatches(run, result, preview)) return null;
  return {
    code: "analysis_preview_identity_mismatch",
    message: "The loaded preview does not match the visible analysis result.",
  };
}

function resultTabsAvailable(run, result, preview) {
  return Boolean(
    result
    || preview
    || ["awaiting_result_review", "validation_failed", "failed"].includes(run?.status)
  );
}

function resultColumnLabel(key) {
  if (String(key).startsWith("input::")) {
    return `Input ${String(key).slice(7).replaceAll("_", " ")}`;
  }
  if (key === "__experiment_id") return "Experiment id";
  if (key === "__snapshot_id") return "Snapshot id";
  if (key === "__record_index") return "Record";
  return String(key || "").replace(/^__/, "").replaceAll("_", " ");
}

function resultColumns(rows) {
  const keys = [];
  const seen = new Set();
  asArray(rows).forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (key === "__result_id" || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });
  });
  return keys;
}

function rowsWithInputValues(rows, records) {
  const byIdentity = new Map(asArray(records).map((record) => [
    `${record.snapshotId}:${record.recordIndex}:${record.experimentId}`,
    record,
  ]));
  return asArray(rows).map((row) => {
    const record = byIdentity.get(
      `${row.__snapshot_id}:${row.__record_index}:${row.__experiment_id}`,
    );
    const inputValues = Object.fromEntries(asArray(record?.fields).map((field) => [
      `input::${field.displayName || field.fieldKey || field.fieldId || "value"}`,
      field.value,
    ]));
    return {
      ...inputValues,
      ...row,
    };
  });
}

function displayResultValue(value) {
  if (value == null || value === "") return "Missing";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(10)));
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function invariantLabel(invariant) {
  if (invariant?.type === "row_sum") {
    return `Row sum = ${invariant.target} +/- ${invariant.absoluteTolerance}`;
  }
  return invariant?.message || invariant?.type || "Validation invariant";
}

function sourceRefLabel(sourceRef, index) {
  const sheetName = sourceRef?.sheetName || sourceRef?.sheet || "Sheet";
  const range = sourceRef?.range || sourceRef?.rangeRef || sourceRef?.cell || sourceRef?.cellRef || "";
  return range ? `${sheetName}!${range}` : sourceRef?.sourceRecordId || `Source ${index + 1}`;
}

function recordSourceRefs(record) {
  return [
    ...asArray(record?.sourceRefs),
    ...asArray(record?.fields).flatMap((field) => asArray(field?.sourceRefs)),
    ...asArray(record?.series).flatMap((series) => [
      ...asArray(series?.sourceRefs),
      ...asArray(series?.points).flatMap((point) => asArray(point?.sourceRefs)),
    ]),
  ];
}

function inputRecordForResultRow(row, records) {
  return asArray(records).find((record) => (
    record.snapshotId === row.__snapshot_id
    && Number(record.recordIndex) === Number(row.__record_index)
    && record.experimentId === row.__experiment_id
  )) || null;
}

function traceName(trace, index) {
  return trace?.name
    || trace?.experimentLabel
    || trace?.experimentId
    || trace?.traceId
    || `Trace ${index + 1}`;
}

function resultPlot(traces, expectedOutput = {}) {
  const chartType = expectedOutput?.chartType || "scatter";
  const barChart = ["bar", "grouped_bar", "stacked_bar", "distribution_bar"].includes(chartType);
  const plotTraces = asArray(traces).map((trace, index) => ({
    type: barChart || trace?.type === "bar" ? "bar" : "scatter",
    ...(barChart ? {} : { mode: trace?.mode || "lines+markers" }),
    name: traceName(trace, index),
    x: asArray(trace?.x),
    y: asArray(trace?.y),
  }));
  const first = asArray(traces)[0] || {};
  return {
    traces: plotTraces,
    layout: plotLayout({
      title: { text: "Validated analysis preview", font: { size: 14 } },
      height: 340,
      margin: { l: 58, r: 20, t: 76, b: 48 },
      legend: {
        orientation: "h",
        y: 1.02,
        x: 0.5,
        xanchor: "center",
        yanchor: "bottom",
        bgcolor: "rgba(255,255,255,.9)",
      },
      xaxis: {
        ...plotLayout().xaxis,
        title: first.xUnit ? `X (${first.xUnit})` : "X",
      },
      yaxis: {
        ...plotLayout().yaxis,
        title: first.yUnit ? `Y (${first.yUnit})` : "Y",
      },
      ...(chartType === "stacked_bar" ? { barmode: "stack" } : {}),
      ...(["grouped_bar", "distribution_bar"].includes(chartType) ? { barmode: "group" } : {}),
      showlegend: plotTraces.length > 1,
    }),
    config: {
      displayModeBar: false,
      responsive: true,
      staticPlot: true,
    },
  };
}

async function loadCompleteResultPreview(loadResultPreview, runId, options = {}) {
  const traceLimit = 500;
  const firstPage = await loadResultPreview(runId, {
    offset: options.offset ?? 0,
    limit: options.limit ?? 50,
    traceOffset: 0,
    traceLimit,
    sourceOffset: options.sourceOffset ?? 0,
    sourceLimit: options.sourceLimit ?? 200,
  });
  const traceTotal = Number(firstPage?.tracePage?.totalCount || asArray(firstPage?.traces).length);
  const offsets = [];
  for (let offset = traceLimit; offset < traceTotal; offset += traceLimit) offsets.push(offset);
  if (!offsets.length) return firstPage;
  const extraPages = await Promise.all(offsets.map((traceOffset) => loadResultPreview(runId, {
    offset: 0,
    limit: 1,
    traceOffset,
    traceLimit,
    sourceOffset: 0,
    sourceLimit: 1,
  })));
  return {
    ...firstPage,
    traces: [
      ...asArray(firstPage?.traces),
      ...extraPages.flatMap((page) => asArray(page?.traces)),
    ],
    tracePage: {
      ...firstPage.tracePage,
      offset: 0,
      limit: traceTotal,
      totalCount: traceTotal,
    },
  };
}

function ResultStage({
  run,
  result,
  preview,
  inputRecords,
  loading,
  error,
  reviewErrors = [],
  onPreviousPage,
  onNextPage,
  onPreviousSourcePage,
  onNextSourcePage,
  onOpenSource,
}) {
  const [exclusionOffset, setExclusionOffset] = useState(0);
  const summary = resultSummary(result, preview);
  const validation = resultValidation(run, result, preview);
  const errors = [...validationErrors(validation), ...reviewErrors];
  const rows = rowsWithInputValues(preview?.rows, inputRecords);
  const columns = resultColumns(rows);
  const exclusions = asArray(summary.excludedRecords);
  const exclusionLimit = 50;
  const visibleExclusions = exclusions.slice(exclusionOffset, exclusionOffset + exclusionLimit);
  const invariants = asArray(validation?.invariants);
  const rowPage = preview?.rowPage || {};
  const sourcePage = preview?.sourcePage || {};
  const canPrevious = Number(rowPage.offset) > 0;
  const canNext = Number(rowPage.offset || 0) + rows.length < Number(rowPage.totalCount || 0);
  const canPreviousSources = Number(sourcePage.offset) > 0;
  const canNextSources = Number(sourcePage.offset || 0) + asArray(preview?.sourceRefs).length
    < Number(sourcePage.totalCount || 0);

  useEffect(() => {
    setExclusionOffset(0);
  }, [preview?.contentHash]);

  return (
    <section className="analysis-result-stage" aria-label="Validated analysis result">
      {loading && <p className="analysis-review-state">Loading validated result...</p>}
      {error && <p className="analysis-review-error" role="alert">{error}</p>}
      <div className="analysis-result-summary">
        <div><span>Input records</span><strong>{summary.inputRecordCount ?? "Unknown"}</strong></div>
        <div><span>Output records</span><strong>{summary.outputRecordCount ?? result?.rowCount ?? 0}</strong></div>
        <div><span>Traces</span><strong>{result?.traceCount ?? preview?.tracePage?.totalCount ?? 0}</strong></div>
        <div>
          <span>Excluded</span>
          <strong>{summary.excludedRecordCount ?? exclusions.length}</strong>
        </div>
        <div>
          <span>Missing policy</span>
          <strong className="analysis-result-policy">
            {summary.missingValuePolicy || validation?.missingValuePolicy || "Not declared"}
          </strong>
        </div>
      </div>

      {(Number(summary.excludedRecordCount) > 0 || exclusions.length > 0) && (
        <section className="analysis-result-section analysis-result-exclusions">
          <header>
            <strong>{summary.excludedRecordCount ?? exclusions.length} records excluded</strong>
            <span>{summary.missingValuePolicy || "Declared missing-value policy"}</span>
          </header>
          <ul>
            {visibleExclusions.map((excluded, index) => (
              <li key={`${excluded.sourceRecordId || "excluded"}-${exclusionOffset + index}`}>
                <span>{excluded.sourceRecordId || `Record ${exclusionOffset + index + 1}`}</span>
                <strong>{excluded.reason || "No reason supplied"}</strong>
              </li>
            ))}
          </ul>
          {exclusions.length > exclusionLimit && (
            <div className="analysis-result-pagination">
              <button
                type="button"
                disabled={exclusionOffset === 0}
                onClick={() => setExclusionOffset(Math.max(exclusionOffset - exclusionLimit, 0))}
              >
                Previous exclusions
              </button>
              <span>
                {exclusionOffset + 1}-{Math.min(exclusionOffset + exclusionLimit, exclusions.length)}
                {" of "}{exclusions.length}
              </span>
              <button
                type="button"
                disabled={exclusionOffset + exclusionLimit >= exclusions.length}
                onClick={() => setExclusionOffset(exclusionOffset + exclusionLimit)}
              >
                Next exclusions
              </button>
            </div>
          )}
        </section>
      )}

      {!!asArray(preview?.warnings).length && (
        <section className="analysis-result-section analysis-result-warnings">
          <header>
            <strong>Execution warnings</strong>
            <span>{preview.warnings.length}</span>
          </header>
          <ul>
            {preview.warnings.map((warning, index) => (
              <li key={`${warning.code || "warning"}-${index}`}>
                {warning.message || warning.code || String(warning)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="analysis-result-section">
        <header>
          <strong>Backend validation</strong>
          <span>{errors.length ? "Blocked" : "Passed"}</span>
        </header>
        {!!invariants.length && (
          <ul className="analysis-validation-list">
            {invariants.map((invariant, index) => (
              <li className={invariant.ok === false ? "failed" : "passed"} key={`${invariant.type || "invariant"}-${index}`}>
                <span>{invariantLabel(invariant)}</span>
                <strong>{invariant.ok === false ? "Failed" : "Passed"}</strong>
              </li>
            ))}
          </ul>
        )}
        {!!errors.length && (
          <div className="analysis-validation-errors" role="alert">
            {errors.map((item, index) => (
              <p key={`${item.code}-${index}`}>{item.message}</p>
            ))}
          </div>
        )}
      </section>

      {!!rows.length && (
        <section className="analysis-result-section analysis-result-table-section">
          <header>
            <strong>Validated values</strong>
            <span>{rowPage.totalCount ?? rows.length} rows</span>
          </header>
          <div className="analysis-result-table-wrap">
            <table className="analysis-result-table">
              <thead>
                <tr>
                  {columns.map((column) => <th key={column}>{resultColumnLabel(column)}</th>)}
                  <th>Lineage and source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const lineageIds = asArray(preview?.lineage?.[row.__result_id]?.sourceRecordIds);
                  const inputRecord = inputRecordForResultRow(row, inputRecords);
                  const sourceRef = recordSourceRefs(inputRecord)[0] || null;
                  const rowLabel = row.experiment_label || inputRecord?.experimentLabel || row.__experiment_id || `row ${index + 1}`;
                  return (
                    <tr key={row.__result_id || index}>
                      {columns.map((column) => (
                        <td key={column}>{displayResultValue(row[column])}</td>
                      ))}
                      <td className="analysis-result-lineage">
                        {sourceRef && (
                          <button
                            type="button"
                            aria-label={`Open source for ${rowLabel}`}
                            onClick={() => onOpenSource?.(sourceRef)}
                          >
                            Open source
                          </button>
                        )}
                        <small>{lineageIds.join(", ") || "No lineage returned"}</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="analysis-result-pagination">
            <button type="button" disabled={!canPrevious || loading} onClick={onPreviousPage}>Previous rows</button>
            <span>
              {rows.length ? Number(rowPage.offset || 0) + 1 : 0}
              {"-"}
              {Number(rowPage.offset || 0) + rows.length}
              {" of "}
              {rowPage.totalCount ?? rows.length}
            </span>
            <button type="button" disabled={!canNext || loading} onClick={onNextPage}>Next rows</button>
          </div>
        </section>
      )}

      {!!asArray(preview?.sourceRefs).length && (
        <section className="analysis-result-section">
          <header>
            <strong>Source evidence</strong>
            <span>{preview.sourcePage?.totalCount ?? preview.sourceRefs.length} refs</span>
          </header>
          <div className="analysis-result-source-links">
            {preview.sourceRefs.map((sourceRef, index) => (
              <button
                type="button"
                key={`${sourceRef.sourceRecordId || sourceRef.range || "source"}-${index}`}
                onClick={() => onOpenSource?.(sourceRef)}
              >
                {sourceRefLabel(sourceRef, index)}
              </button>
            ))}
          </div>
          <div className="analysis-result-pagination">
            <button
              type="button"
              disabled={!canPreviousSources || loading}
              onClick={onPreviousSourcePage}
            >
              Previous source refs
            </button>
            <span>
              {asArray(preview?.sourceRefs).length ? Number(sourcePage.offset || 0) + 1 : 0}
              {"-"}
              {Number(sourcePage.offset || 0) + asArray(preview?.sourceRefs).length}
              {" of "}
              {sourcePage.totalCount ?? asArray(preview?.sourceRefs).length}
            </span>
            <button
              type="button"
              disabled={!canNextSources || loading}
              onClick={onNextSourcePage}
            >
              Next source refs
            </button>
          </div>
        </section>
      )}

      <details className="analysis-result-hashes">
        <summary>Run and result hashes</summary>
        <dl>
          <div><dt>Input</dt><dd>{run?.inputHash || "Unavailable"}</dd></div>
          <div><dt>Program</dt><dd>{run?.programHash || "Unavailable"}</dd></div>
          <div><dt>Result</dt><dd>{result?.contentHash || preview?.contentHash || "Unavailable"}</dd></div>
          <div><dt>Preview</dt><dd>{result?.resultPreviewHash || preview?.resultPreviewHash || "Unavailable"}</dd></div>
          <div><dt>Runtime</dt><dd>{run?.runtimeVersion || "Unavailable"}</dd></div>
        </dl>
      </details>
    </section>
  );
}

function ChartStage({
  preview,
  defaultVisibleTraceIds,
  onDefaultVisibleTraceIdsChange,
  PlotComponent,
  expectedOutput,
}) {
  const traces = asArray(preview?.traces);
  const selected = new Set(defaultVisibleTraceIds);
  const visibleTraces = traces.filter((trace) => selected.has(trace.traceId));
  const traceGroups = [...visibleTraces.reduce((groups, trace) => {
    const key = `${trace.xUnit || ""}::${trace.yUnit || ""}`;
    const current = groups.get(key) || [];
    current.push(trace);
    groups.set(key, current);
    return groups;
  }, new Map()).values()];
  return (
    <section className="analysis-chart-stage" aria-label="Analysis chart review">
      <div className="analysis-chart-preview">
        {traceGroups.map((group, index) => {
          const plot = resultPlot(group, expectedOutput);
          return (
            <div className="analysis-chart-unit-panel" key={`${group[0]?.xUnit || "x"}:${group[0]?.yUnit || "y"}:${index}`}>
              <PlotComponent traces={plot.traces} layout={plot.layout} config={plot.config} />
            </div>
          );
        })}
      </div>
      <aside className="analysis-trace-selector" aria-label="Default chart traces">
        <header>
          <strong>Default visible experiments</strong>
          <span>{selected.size}/{traces.length} shown</span>
        </header>
        <div>
          {traces.map((trace, index) => {
            const name = traceName(trace, index);
            return (
              <label key={trace.traceId || index}>
                <input
                  type="checkbox"
                  checked={selected.has(trace.traceId)}
                  aria-label={`Show ${name} by default`}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(trace.traceId)) next.delete(trace.traceId);
                    else next.add(trace.traceId);
                    onDefaultVisibleTraceIdsChange([...next]);
                  }}
                />
                <span>{name}</span>
                <small>{trace.yUnit || "No unit"}</small>
              </label>
            );
          })}
        </div>
      </aside>
    </section>
  );
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
  loadResultPreview = getAnalysisResultPreview,
  reviseRun = reviseAnalysisRun,
  createRevision = createAnalysisPlanRevision,
  acceptPlan = acceptAnalysisPlanRevision,
  onAcceptResult = null,
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
  const [activeTab, setActiveTab] = useState("source");
  const [run, setRun] = useState(initialRun);
  const [result, setResult] = useState(initialResult);
  const [resultState, setResultState] = useState({
    loading: false,
    error: "",
    value: initialResultPreview,
  });
  const [defaultVisibleTraceIds, setDefaultVisibleTraceIds] = useState(
    () => asArray(initialResultPreview?.traces).map((trace) => trace.traceId).filter(Boolean),
  );
  const [runHistory, setRunHistory] = useState(() => (
    initialRun ? [{ run: initialRun, result: initialResult }] : []
  ));
  const [resultSourceFocus, setResultSourceFocus] = useState(null);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    previewRequestRef.current += 1;
    setThread(initialThread || null);
    setRevision(initialRevision || null);
    setRevisions(initialPlanRevisions || (initialRevision ? [initialRevision] : []));
    setRun(initialRun);
    setResult(initialResult);
    setResultState({ loading: false, error: "", value: initialResultPreview });
    setDefaultVisibleTraceIds(
      asArray(initialResultPreview?.traces).map((trace) => trace.traceId).filter(Boolean),
    );
    setRunHistory(initialRun ? [{ run: initialRun, result: initialResult }] : []);
    setResultSourceFocus(null);
    setActiveTab("source");
    setActionError("");
  }, [
    initialResult?.id,
    initialResultPreview?.resultPreviewHash,
    initialRevision?.id,
    initialRun?.id,
    initialThread?.id,
  ]);

  useEffect(() => {
    if (initialPlanRevisions || !initialThread?.id) return undefined;
    let cancelled = false;
    const requestToken = ++previewRequestRef.current;
    loadThread(initialThread.id)
      .then(async (body) => {
        if (cancelled || requestToken !== previewRequestRef.current) return;
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
        setRun(latestRun);
        const runResponse = latestRun.status === "queued"
          ? await executeRun(latestRun.id)
          : await loadRun(latestRun.id);
        if (cancelled || requestToken !== previewRequestRef.current) return;
        const hydratedRun = runResponse?.analysisRun || latestRun;
        const hydratedResult = runResponse?.analysisResult || null;
        setRun(hydratedRun);
        setResult(hydratedResult);
        setRunHistory((current) => current.map((item) => (
          item.run.id === hydratedRun.id
            ? { run: hydratedRun, result: hydratedResult }
            : item
        )));
        if (hydratedResult?.id) {
          const loadedPreview = await loadCompleteResultPreview(loadResultPreview, hydratedRun.id, {
            offset: 0,
            limit: 50,
            sourceOffset: 0,
            sourceLimit: 200,
          });
          if (cancelled || requestToken !== previewRequestRef.current) return;
          setResultState({ loading: false, error: "", value: loadedPreview });
          setDefaultVisibleTraceIds(
            asArray(loadedPreview?.traces).map((trace) => trace.traceId).filter(Boolean),
          );
        }
      })
      .catch((error) => {
        if (!cancelled) setActionError(error?.message || String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [
    executeRun,
    initialPlanRevisions,
    initialRevision,
    initialThread,
    loadResultPreview,
    loadRun,
    loadThread,
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
  const focusSelection = resultSourceFocus ? {
    requestId: `${run?.id || "run"}:${resultSourceFocus.sourceRecordId || resultSourceFocus.range || "source"}`,
    sourceDocumentId: resultSourceFocus.sourceDocumentId,
    sheetName: resultSourceFocus.sheetName || resultSourceFocus.sheet,
    range: resultSourceFocus.range
      || resultSourceFocus.rangeRef
      || resultSourceFocus.cell
      || resultSourceFocus.cellRef,
    focusOnly: true,
  } : rectangleFocusSelection;
  const busy = Boolean(pendingAction);
  const awaitingReview = revision?.status === "awaiting_review" && !run;
  const preview = resultState.value;
  const validation = resultValidation(run, result, preview);
  const identityError = previewIdentityError(run, result, preview);
  const errors = [
    ...validationErrors(validation),
    ...(identityError ? [identityError] : []),
  ];
  const hasResultStage = resultTabsAvailable(run, result, preview);
  const hasChartStage = asArray(preview?.traces).length > 0;
  const canAcceptResult = resultReady(run, result, preview)
    && hasChartStage
    && Boolean(onAcceptResult);
  const resultReviewMode = hasResultStage && revision?.status === "accepted";

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
      setActiveTab("source");
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
      const queuedRun = response?.analysisRun || { status: "queued" };
      const requestToken = ++previewRequestRef.current;
      setRun(queuedRun);
      setRunHistory((current) => [...current, { run: queuedRun, result: null }]);
      onAccepted?.(response);
      if (!queuedRun.id) return;
      setPendingAction("execute");
      const executionResponse = await executeRun(queuedRun.id);
      if (requestToken !== previewRequestRef.current) return;
      const executedRun = executionResponse?.analysisRun || queuedRun;
      const executedResult = executionResponse?.analysisResult || null;
      setRun(executedRun);
      setResult(executedResult);
      setRunHistory((current) => current.map((item) => (
        item.run.id === executedRun.id
          ? { run: executedRun, result: executedResult }
          : item
      )));
      if (executedResult?.id) {
        setResultState((current) => ({ ...current, loading: true, error: "" }));
        const loadedPreview = await loadCompleteResultPreview(loadResultPreview, executedRun.id, {
          offset: 0,
          limit: 50,
          sourceOffset: 0,
          sourceLimit: 200,
        });
        if (requestToken !== previewRequestRef.current) return;
        setResultState({ loading: false, error: "", value: loadedPreview });
        setDefaultVisibleTraceIds(
          asArray(loadedPreview?.traces).map((trace) => trace.traceId).filter(Boolean),
        );
        setActiveTab("result");
      }
      onAccepted?.(executionResponse);
    } catch (error) {
      setActionError(error?.message || String(error));
    } finally {
      setPendingAction("");
    }
  };

  const loadResultRows = async (offset) => {
    if (!run?.id || resultState.loading) return;
    const runId = run.id;
    const requestToken = ++previewRequestRef.current;
    setResultState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const loadedPreview = await loadCompleteResultPreview(loadResultPreview, runId, {
        offset,
        limit: preview?.rowPage?.limit || 50,
        sourceOffset: preview?.sourcePage?.offset || 0,
        sourceLimit: preview?.sourcePage?.limit || 200,
      });
      if (requestToken !== previewRequestRef.current) return;
      setResultState({ loading: false, error: "", value: loadedPreview });
    } catch (error) {
      if (requestToken !== previewRequestRef.current) return;
      setResultState((current) => ({
        ...current,
        loading: false,
        error: error?.message || String(error),
      }));
    }
  };

  const loadSourceRefs = async (sourceOffset) => {
    if (!run?.id || resultState.loading) return;
    const runId = run.id;
    const requestToken = ++previewRequestRef.current;
    setResultState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const sourcePreview = await loadResultPreview(runId, {
        offset: preview?.rowPage?.offset || 0,
        limit: preview?.rowPage?.limit || 50,
        traceOffset: 0,
        traceLimit: 1,
        sourceOffset,
        sourceLimit: preview?.sourcePage?.limit || 200,
      });
      if (requestToken !== previewRequestRef.current) return;
      setResultState({
        loading: false,
        error: "",
        value: {
          ...preview,
          sourceRefs: sourcePreview.sourceRefs,
          sourcePage: sourcePreview.sourcePage,
        },
      });
    } catch (error) {
      if (requestToken !== previewRequestRef.current) return;
      setResultState((current) => ({
        ...current,
        loading: false,
        error: error?.message || String(error),
      }));
    }
  };

  const submitResultFeedback = async () => {
    const nextFeedback = feedback.trim();
    if (!nextFeedback || busy || !run?.id || !resultReviewMode) return;
    setPendingAction("result_revision");
    setActionError("");
    try {
      const response = await reviseRun(run.id, {
        resultHash: result?.contentHash || preview?.contentHash || "",
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
      setFeedback("");
      setActiveRectangleId("");
      setResultSourceFocus(null);
      setActiveTab("source");
    } catch (error) {
      setActionError(error?.message || String(error));
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
        resultHash: result.contentHash,
        defaultVisibleTraceIds,
      });
      if (response?.analysisRun) setRun(response.analysisRun);
      if (response?.analysisResult) setResult(response.analysisResult);
      onAccepted?.(response);
    } catch (error) {
      setActionError(error?.message || String(error));
    } finally {
      setPendingAction("");
    }
  };

  const openResultSource = (sourceRef) => {
    if (!sourceRef?.sourceDocumentId) return;
    setResultSourceFocus(sourceRef);
    setActiveTab("source");
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
    setActiveRectangleId("");
    setResultSourceFocus(null);
    setActiveTab("source");
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
      const historicalPreview = await loadCompleteResultPreview(
        loadResultPreview,
        historicalRun.id,
        {
          offset: 0,
          limit: 50,
          sourceOffset: 0,
          sourceLimit: 200,
        },
      );
      if (requestToken !== previewRequestRef.current) return;
      setResultState({ loading: false, error: "", value: historicalPreview });
      setDefaultVisibleTraceIds(
        asArray(historicalPreview?.traces).map((trace) => trace.traceId).filter(Boolean),
      );
    } catch (error) {
      if (requestToken === previewRequestRef.current) {
        setActionError(error?.message || String(error));
      }
    } finally {
      if (requestToken === previewRequestRef.current) setPendingAction("");
    }
  };

  return (
    <section className="analysis-review-workspace" aria-label="Analysis review">
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
        <button
          id="analysis-tab-chart"
          type="button"
          role="tab"
          aria-controls="analysis-panel-chart"
          aria-selected={activeTab === "chart"}
          disabled={!hasChartStage}
          onClick={() => setActiveTab("chart")}
        >
          Chart
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
              <div className="analysis-source-rectangles" aria-label="Analysis source ranges">
                {rectangles.map((rectangle, index) => (
                  <button
                    type="button"
                    className={rectangle.draftRegionId === currentActiveId ? "active" : ""}
                    key={rectangle.draftRegionId}
                    onClick={() => {
                      setResultSourceFocus(null);
                      setActiveRectangleId(rectangle.draftRegionId);
                    }}
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
          )}
          {activeTab === "result" && (
            <ResultStage
              run={run}
              result={result}
              preview={preview}
              inputRecords={selectionState.value?.records}
              loading={resultState.loading}
              error={resultState.error}
              reviewErrors={identityError ? [identityError] : []}
              onPreviousPage={() => loadResultRows(Math.max(
                Number(preview?.rowPage?.offset || 0) - Number(preview?.rowPage?.limit || 50),
                0,
              ))}
              onNextPage={() => loadResultRows(
                Number(preview?.rowPage?.offset || 0) + Number(preview?.rowPage?.limit || 50),
              )}
              onPreviousSourcePage={() => loadSourceRefs(Math.max(
                Number(preview?.sourcePage?.offset || 0) - Number(preview?.sourcePage?.limit || 200),
                0,
              ))}
              onNextSourcePage={() => loadSourceRefs(
                Number(preview?.sourcePage?.offset || 0) + Number(preview?.sourcePage?.limit || 200),
              )}
              onOpenSource={openResultSource}
            />
          )}
          {activeTab === "chart" && (
            <ChartStage
              preview={preview}
              defaultVisibleTraceIds={defaultVisibleTraceIds}
              onDefaultVisibleTraceIdsChange={setDefaultVisibleTraceIds}
              PlotComponent={PlotComponent}
              expectedOutput={revision?.expectedOutput}
            />
          )}
        </div>

        <aside className="analysis-review-conversation" aria-label="LabRat analysis conversation">
          <header className="analysis-review-conversation-head">
            <div>
              <strong>the lab rat</strong>
              <span>{revision ? `Analysis plan revision ${revision.revision}` : "Planning"}</span>
            </div>
            <span>{resultReady(run, result, preview) ? "Result ready" : revisionStatus(revision?.status)}</span>
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
                  onClick={() => openRevision(item)}
                >
                  <span>Revision {item.revision}</span>
                  <small>{revisionStatus(item.status)}</small>
                </button>
              ))}
            </section>

            {!!runHistory.length && (
              <section className="analysis-run-history" aria-label="Analysis run history">
                {runHistory.map((item, index) => (
                  <div key={item.run.id || index}>
                    <span>Run {index + 1}</span>
                    <small>{item.run.status || "queued"}</small>
                    {item.result?.contentHash && <strong>Prior result {item.result.contentHash}</strong>}
                  </div>
                ))}
              </section>
            )}

            {run && !result && ["queued", "running"].includes(run.status) && (
              <div className="analysis-review-queued" role="status">
                <strong>{run.status === "running" ? "Calculating accepted plan" : "Queued for calculation"}</strong>
                <span>The exact accepted source, hashes, and Python are frozen.</span>
              </div>
            )}
            {resultReady(run, result, preview) && (
              <div className="analysis-review-queued analysis-result-ready" role="status">
                <strong>Ready for result review</strong>
                <span>
                  {result?.rowCount ?? preview?.rowPage?.totalCount ?? 0} rows and{" "}
                  {result?.traceCount ?? preview?.tracePage?.totalCount ?? 0} traces passed backend validation.
                </span>
              </div>
            )}
            {hasResultStage && (
              <article className="analysis-result-conversation-card">
                <header>
                  <strong>Execution validation</strong>
                  <span>{errors.length ? "Blocked" : result ? "Passed" : run?.status || "Pending"}</span>
                </header>
                <p>
                  {resultSummary(result, preview).inputRecordCount ?? "Unknown"} inputs,{" "}
                  {resultSummary(result, preview).outputRecordCount ?? result?.rowCount ?? 0} outputs,{" "}
                  {resultSummary(result, preview).excludedRecordCount ?? 0} exclusions.
                </p>
                {errors.map((item, index) => (
                  <p className="analysis-review-error" key={`${item.code}-${index}`}>{item.message}</p>
                ))}
              </article>
            )}
            {actionError && <p className="analysis-review-error" role="alert">{actionError}</p>}
          </div>

          <div className="analysis-review-composer">
            <button
              type="button"
              className="accept-plan"
              onClick={resultReviewMode ? acceptVisibleResult : acceptVisiblePlan}
              disabled={resultReviewMode ? (!canAcceptResult || busy) : (!awaitingReview || busy)}
            >
              {resultReviewMode
                ? result?.status === "accepted"
                  ? "Chart created"
                  : pendingAction === "accept_result" ? "Creating..." : "Accept result and create chart"
                : pendingAction === "accept" || pendingAction === "execute" ? "Working..." : "Accept plan"}
            </button>
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
                placeholder={resultReviewMode ? "Describe a result modification" : "Describe a modification"}
                disabled={resultReviewMode ? (!run?.id || busy) : (!awaitingReview || busy)}
              />
              <button
                type="button"
                aria-label={resultReviewMode ? "Send result modification" : "Send modification"}
                onClick={resultReviewMode ? submitResultFeedback : submitFeedback}
                disabled={!feedback.trim() || (resultReviewMode ? !run?.id : !awaitingReview) || busy}
              >
                {["revision", "result_revision"].includes(pendingAction) ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
