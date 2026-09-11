import React from "react";
import { makeChartSpecPreview } from "../charts/chartSpecPreview.js";
import { Plot } from "../charts/Plot.jsx";
import {
  getExperimentBrowserDetail,
  listExperimentBrowserRows,
} from "../data/experimentBrowserApi.js";
import {
  applyServerReusableChartTemplate,
  getServerReusableChartTemplate,
  listServerLinkedDataKinds,
  createServerLinkedDataComparison,
} from "../data/serverApi.js";
import { ThinkingIndicator } from "./ThinkingIndicator.jsx";
import { ExperimentDetailDrawer } from "./ExperimentDetailDrawer.jsx";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const experimentLabelCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareExperimentRows(a, b) {
  const labelComparison = experimentLabelCollator.compare(
    String(a?.label || ""),
    String(b?.label || ""),
  );
  if (labelComparison) return labelComparison;
  return experimentLabelCollator.compare(
    String(a?.experimentId || ""),
    String(b?.experimentId || ""),
  );
}

function slotColumnId(slot, bindings) {
  return bindings?.[slot?.slotId] || slot?.identityContract?.preferredColumnId || "";
}

function templateCellValue(row, columnId) {
  const cell = row?.cells?.[columnId];
  if (!cell || cell.value == null || cell.value === "") return "—";
  return String(cell.formattedValue ?? cell.value);
}

function templateSlotHeader(slot, column) {
  const label = String(slot?.label || slot?.slotId || "Input");
  const unit = String(column?.unit || slot?.unitContract?.allowedUnits?.[0] || "").trim();
  if (!unit) return label;
  const normalizedLabel = label.toLowerCase();
  const normalizedUnit = unit.toLowerCase();
  const alreadyIncludesUnit = normalizedLabel.includes(`(${normalizedUnit})`)
    || (["percent", "%"].includes(normalizedUnit)
      && (normalizedLabel.includes("(%)") || normalizedLabel.includes("percent")));
  return alreadyIncludesUnit ? label : `${label} (${unit})`;
}

function compareTemplateValues(left, right) {
  const leftBlank = left == null || left === "";
  const rightBlank = right == null || right === "";
  if (leftBlank || rightBlank) return leftBlank === rightBlank ? 0 : leftBlank ? 1 : -1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return experimentLabelCollator.compare(String(left), String(right));
}

function templateRowCompatibility(row, slots, bindings, columnsById) {
  const unresolved = [];
  const missing = [];
  const unitMismatches = [];
  asArray(slots).forEach((slot) => {
    const columnId = slotColumnId(slot, bindings);
    const column = columnsById.get(columnId);
    if (!columnId || !column) {
      unresolved.push(slot.label || slot.slotId);
      return;
    }
    const cell = row?.cells?.[columnId];
    if (!cell || cell.value == null || cell.value === "") missing.push(slot.label || slot.slotId);
    const allowedUnits = asArray(slot?.unitContract?.allowedUnits).map((unit) => String(unit).trim().toLowerCase());
    const actualUnit = String(cell?.unit || column?.unit || "").trim().toLowerCase();
    if (allowedUnits.length && actualUnit && !allowedUnits.includes(actualUnit)) unitMismatches.push(slot.label || slot.slotId);
  });
  if (unresolved.length) return { state: "binding", label: "Binding required", detail: unresolved.join(", ") };
  if (unitMismatches.length) return { state: "incompatible", label: "Unit mismatch", detail: unitMismatches.join(", ") };
  if (missing.length) return {
    state: "missing",
    label: `Missing ${missing.length} input${missing.length === 1 ? "" : "s"}`,
    detail: missing.join(", "),
  };
  return {
    state: "compatible",
    label: row?.warningCount ? `Ready · ${row.warningCount} warning${row.warningCount === 1 ? "" : "s"}` : "Ready",
    detail: "All required template inputs are available.",
  };
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

function chartSpecNeedsDetail(chartSpec) {
  return chartSpec?.detailRequired === true || chartSpec?.spec?.detailRequired === true;
}

function ApprovedChartSpecReview({ chartSpecs, onLoadChartSpecDetail, onInsertChartSpec }) {
  const specs = asArray(chartSpecs);
  const [selectedId, setSelectedId] = React.useState(specs[0]?.id || "");
  const [details, setDetails] = React.useState({});
  const [detailState, setDetailState] = React.useState({ loadingId: "", error: "" });
  const selectedSummary = specs.find((item) => item.id === selectedId) || specs[0] || null;
  const selected = selectedSummary ? details[selectedSummary.id] || selectedSummary : null;

  React.useEffect(() => {
    if (!selectedSummary || !chartSpecNeedsDetail(selectedSummary) || details[selectedSummary.id]) return undefined;
    if (typeof onLoadChartSpecDetail !== "function") {
      setDetailState({ loadingId: "", error: "Complete ChartSpec detail is unavailable." });
      return undefined;
    }
    let active = true;
    setDetailState({ loadingId: selectedSummary.id, error: "" });
    Promise.resolve(onLoadChartSpecDetail(selectedSummary.id))
      .then((response) => {
        if (!active) return;
        const detail = response?.chartSpec || response;
        if (!detail?.id || detail.id !== selectedSummary.id || chartSpecNeedsDetail(detail)) {
          throw new Error("The complete ChartSpec response is invalid.");
        }
        setDetails((current) => ({ ...current, [detail.id]: detail }));
        setDetailState({ loadingId: "", error: "" });
      })
      .catch((error) => {
        if (active) setDetailState({ loadingId: "", error: error?.message || String(error) });
      });
    return () => {
      active = false;
    };
  }, [selectedSummary, details, onLoadChartSpecDetail]);

  const preview = selected && !chartSpecNeedsDetail(selected)
    ? makeChartSpecPreview(selected)
    : null;
  const traceCount = asArray(selected?.spec?.traceCatalog).length;

  return (
    <section className="backend-proposal-section approved-chart-spec-review">
      <WorkflowPanelHeader
        title="Approved ChartSpecs"
        detail="Inspect charts published from accepted analysis results before inserting them into Manuscript."
        meta={`${specs.length} specs`}
      />
      {!specs.length && <div className="import-review-empty">No approved ChartSpecs yet.</div>}
      {specs.length > 0 && (
        <div className="approved-chart-spec-layout">
          <div className="approved-chart-list" role="list" aria-label="Approved ChartSpecs">
            {specs.map((chartSpec) => (
              <button
                type="button"
                role="listitem"
                className={chartSpec.id === selected?.id ? "active" : ""}
                key={chartSpec.id}
                onClick={() => setSelectedId(chartSpec.id)}
              >
                <span>{chartSpec.title || chartSpec.spec?.title || "Untitled chart"}</span>
                <small>{chartSpec.chartType || chartSpec.spec?.chartType || "ChartSpec"}</small>
              </button>
            ))}
          </div>
          {selected && (
            <article className="backend-proposal-card approved-chart-detail">
              <div className="backend-scan-block-head">
                <div>
                  <strong>{selected.title || selected.spec?.title || "Untitled chart"}</strong>
                  <small>Validated analysis result</small>
                </div>
                <span>{traceCount ? `${traceCount} traces` : selected.chartType || selected.spec?.chartType || "chart"}</span>
              </div>
              {detailState.loadingId === selected.id && <ThinkingIndicator text="Loading complete ChartSpec..." />}
              {detailState.error && <p className="import-review-error">{detailState.error}</p>}
              {preview?.traces?.length > 0 && (
                <div className="generic-chart-preview">
                  <Plot
                    traces={preview.traces}
                    layout={preview.layout}
                    config={{ staticPlot: true, displayModeBar: false }}
                    className="generic-chart-preview-plot"
                  />
                </div>
              )}
              {preview && !preview.traces.length && (
                <div className="import-review-empty">This ChartSpec contains no renderable traces.</div>
              )}
              <div className="import-review-actions">
                <button
                  type="button"
                  disabled={chartSpecNeedsDetail(selected) || detailState.loadingId === selected.id}
                  onClick={() => onInsertChartSpec?.(selected.id)}
                >
                  Insert in Manuscript
                </button>
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewedAnalysisRequest({ state, onSubmit }) {
  const [prompt, setPrompt] = React.useState("");
  const [inputMode, setInputMode] = React.useState("experiment_browser");
  const canSubmit = Boolean(prompt.trim()) && !state?.loading;
  return (
    <section className="backend-proposal-section">
      <WorkflowPanelHeader
        title="Create a chart"
        detail="Choose one reviewed data source, then review the exact inputs and processing plan before calculation."
      />
      <fieldset className="chart-input-mode">
        <legend>Chart data</legend>
        <label>
          <input
            type="radio"
            name="chart-input-mode"
            value="experiment_browser"
            checked={inputMode === "experiment_browser"}
            onChange={(event) => setInputMode(event.target.value)}
          />
          <span><strong>Experiment Browser</strong><small>Fast comparisons and reusable templates</small></span>
        </label>
        <label>
          <input
            type="radio"
            name="chart-input-mode"
            value="workbook"
            checked={inputMode === "workbook"}
            onChange={(event) => setInputMode(event.target.value)}
          />
          <span><strong>Workbook</strong><small>One-off analysis from confirmed workbook ranges</small></span>
        </label>
      </fieldset>
      <div className="backend-normalize-toolbar chart-intent-toolbar workflow-action-row">
        <label className="chart-intent-input">
          <span>Describe the chart</span>
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="e.g. chart the carbon number distribution for Exp31"
          />
        </label>
        <button
          type="button"
          className="primary"
          disabled={!canSubmit}
          onClick={() => onSubmit?.(prompt.trim(), { inputMode })}
        >
          {state?.loading ? "Preparing plan..." : "Prepare plan"}
        </button>
        {state?.loading && <ThinkingIndicator text="Selecting evidence and drafting a reviewable plan..." />}
      </div>
      {state?.error && <p className="import-review-error">{state.error}</p>}
    </section>
  );
}

function applicationKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `chart_template_${globalThis.crypto.randomUUID()}`;
  }
  return `chart_template_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function currentTemplateVersion(detail) {
  const template = detail?.reusableChartTemplate;
  return asArray(detail?.versions).find((version) => version.id === template?.currentVersionId)
    || asArray(detail?.versions)[0]
    || null;
}

function slotCoverage(slot, selectedRows) {
  const columnId = slot?.identityContract?.preferredColumnId;
  const cells = selectedRows.map((row) => row?.cells?.[columnId]);
  return {
    available: cells.filter((cell) => cell?.value != null && cell?.value !== "").length,
    total: selectedRows.length,
  };
}

export function ReusableChartTemplateReview({
  projectId,
  templates,
  onApplicationReady,
  loadTemplate = getServerReusableChartTemplate,
  loadExperiments = listExperimentBrowserRows,
  loadExperimentDetail = getExperimentBrowserDetail,
  applyTemplate = applyServerReusableChartTemplate,
}) {
  const activeTemplates = asArray(templates).filter((template) => template?.status !== "archived");
  const [selectedTemplateId, setSelectedTemplateId] = React.useState(activeTemplates[0]?.id || "");
  const [detailState, setDetailState] = React.useState({ loading: false, value: null, error: "" });
  const [experimentState, setExperimentState] = React.useState({ loading: false, rows: [], columns: [], error: "", nextCursor: null });
  const [selectedExperimentIds, setSelectedExperimentIds] = React.useState([]);
  const [search, setSearch] = React.useState("");
  const [selectedOnly, setSelectedOnly] = React.useState(false);
  const [sortState, setSortState] = React.useState({ columnId: "experiment", direction: "asc" });
  const [bindings, setBindings] = React.useState({});
  const [applicationState, setApplicationState] = React.useState({ loading: false, response: null, error: "" });
  const [experimentDetailState, setExperimentDetailState] = React.useState({ experimentId: "", loading: false, value: null, error: "" });
  const experimentDetailCacheRef = React.useRef(new Map());
  const experimentDetailRequestRef = React.useRef(0);

  React.useEffect(() => {
    if (!activeTemplates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(activeTemplates[0]?.id || "");
    }
  }, [activeTemplates, selectedTemplateId]);

  React.useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    setExperimentState((current) => ({ ...current, loading: true, error: "" }));
    loadExperiments(projectId, { limit: 1000 })
      .then((response) => {
        if (!active) return;
        setExperimentState({
          loading: false,
          rows: asArray(response?.rows),
          columns: asArray(response?.columns),
          error: "",
          nextCursor: response?.nextCursor || null,
        });
      })
      .catch((error) => {
        if (active) setExperimentState({ loading: false, rows: [], columns: [], error: error?.message || String(error), nextCursor: null });
      });
    return () => { active = false; };
  }, [loadExperiments, projectId]);

  React.useEffect(() => {
    setSelectedExperimentIds([]);
    setSelectedOnly(false);
    setSortState({ columnId: "experiment", direction: "asc" });
    setBindings({});
    setApplicationState({ loading: false, response: null, error: "" });
    setExperimentDetailState({ experimentId: "", loading: false, value: null, error: "" });
    if (!selectedTemplateId) {
      setDetailState({ loading: false, value: null, error: "" });
      return undefined;
    }
    let active = true;
    setDetailState({ loading: true, value: null, error: "" });
    loadTemplate(selectedTemplateId)
      .then((response) => {
        if (active) setDetailState({ loading: false, value: response, error: "" });
      })
      .catch((error) => {
        if (active) setDetailState({ loading: false, value: null, error: error?.message || String(error) });
      });
    return () => { active = false; };
  }, [loadTemplate, selectedTemplateId]);

  const version = currentTemplateVersion(detailState.value);
  const selectedRows = experimentState.rows.filter((row) => selectedExperimentIds.includes(row.experimentId));
  const normalizedSearch = search.trim().toLowerCase();
  const columnsById = new Map(experimentState.columns.map((column) => [column.id, column]));
  const templateSlots = asArray(version?.inputSlots);
  const rowCompatibility = new Map(experimentState.rows.map((row) => [
    row.experimentId,
    templateRowCompatibility(row, templateSlots, bindings, columnsById),
  ]));
  const visibleRows = experimentState.rows
    .filter((row) => (
      (!selectedOnly || selectedExperimentIds.includes(row.experimentId))
      && (!normalizedSearch
        || String(row.label || "").toLowerCase().includes(normalizedSearch)
        || asArray(row.aliases).some((alias) => String(alias).toLowerCase().includes(normalizedSearch)))
    ))
    .toSorted((left, right) => {
      let comparison = 0;
      if (sortState.columnId === "experiment") comparison = compareExperimentRows(left, right);
      else if (sortState.columnId === "status") {
        comparison = experimentLabelCollator.compare(
          rowCompatibility.get(left.experimentId)?.label || "",
          rowCompatibility.get(right.experimentId)?.label || "",
        );
      } else {
        const slot = templateSlots.find((item) => item.slotId === sortState.columnId);
        const columnId = slotColumnId(slot, bindings);
        comparison = compareTemplateValues(left?.cells?.[columnId]?.value, right?.cells?.[columnId]?.value);
      }
      if (!comparison) comparison = compareExperimentRows(left, right);
      return sortState.direction === "desc" ? -comparison : comparison;
    });
  const minimum = Number(version?.experimentCardinality?.minimum || 1);
  const recommendedMaximum = Number(version?.experimentCardinality?.recommendedMaximum || 6);
  const hardMaximum = Number(version?.experimentCardinality?.hardMaximum || 12);
  const compatibility = applicationState.response?.compatibility || null;
  const blockers = asArray(compatibility?.blockers);
  const candidateBlockers = blockers.filter((blocker) => asArray(blocker?.candidates).length);
  const hardBlockers = blockers.filter((blocker) => !asArray(blocker?.candidates).length);
  const unresolvedCandidates = candidateBlockers.filter((blocker) => !bindings[blocker.slotId]);
  const selectionCountValid = selectedExperimentIds.length >= minimum && selectedExperimentIds.length <= hardMaximum;
  const canPreview = Boolean(version?.id)
    && selectionCountValid
    && !applicationState.loading
    && (!compatibility || compatibility.status === "ready" || (!hardBlockers.length && !unresolvedCandidates.length));

  const toggleSort = (columnId) => {
    setSortState((current) => current.columnId === columnId
      ? { columnId, direction: current.direction === "asc" ? "desc" : "asc" }
      : { columnId, direction: "asc" });
  };

  const openExperimentDetail = async (row) => {
    if (!row?.experimentId) return;
    const requestToken = ++experimentDetailRequestRef.current;
    const cached = experimentDetailCacheRef.current.get(row.experimentId);
    if (cached) {
      setExperimentDetailState({ experimentId: row.experimentId, loading: false, value: cached, error: "" });
      return;
    }
    setExperimentDetailState({ experimentId: row.experimentId, loading: true, value: null, error: "" });
    try {
      const response = await loadExperimentDetail(projectId, row.experimentId);
      if (requestToken !== experimentDetailRequestRef.current) return;
      experimentDetailCacheRef.current.set(row.experimentId, response);
      setExperimentDetailState({ experimentId: row.experimentId, loading: false, value: response, error: "" });
    } catch (error) {
      if (requestToken !== experimentDetailRequestRef.current) return;
      setExperimentDetailState({ experimentId: row.experimentId, loading: false, value: null, error: error?.message || String(error) });
    }
  };

  const resetCompatibility = () => {
    setBindings({});
    setApplicationState({ loading: false, response: null, error: "" });
  };

  const toggleExperiment = (experimentId) => {
    setSelectedExperimentIds((current) => current.includes(experimentId)
      ? current.filter((id) => id !== experimentId)
      : current.length < hardMaximum ? [...current, experimentId] : current);
    resetCompatibility();
  };

  const previewTemplate = async () => {
    if (!canPreview) return;
    setApplicationState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await applyTemplate(version.id, {
        experimentIds: selectedExperimentIds,
        bindings: Object.entries(bindings).map(([slotId, columnId]) => ({ slotId, columnId })),
        idempotencyKey: applicationKey(),
      });
      setApplicationState({ loading: false, response, error: "" });
      if (response?.compatibility?.status === "ready" && response?.analysisThread?.id && response?.analysisPlanRevision?.id) {
        onApplicationReady?.(response);
      }
    } catch (error) {
      setApplicationState({ loading: false, response: null, error: error?.message || String(error) });
    }
  };

  const loadMoreExperiments = async () => {
    if (!experimentState.nextCursor || experimentState.loading) return;
    setExperimentState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await loadExperiments(projectId, { limit: 1000, cursor: experimentState.nextCursor });
      setExperimentState((current) => ({
        loading: false,
        rows: [...current.rows, ...asArray(response?.rows).filter((row) => !current.rows.some((item) => item.experimentId === row.experimentId))],
        columns: current.columns.length ? current.columns : asArray(response?.columns),
        error: "",
        nextCursor: response?.nextCursor || null,
      }));
    } catch (error) {
      setExperimentState((current) => ({ ...current, loading: false, error: error?.message || String(error) }));
    }
  };

  if (!activeTemplates.length) {
    return (
      <section className="backend-proposal-section reusable-chart-empty">
        <WorkflowPanelHeader
          title="Use a template"
          detail="Save an eligible approved chart as a reusable template before using this fast path."
        />
        <div className="import-review-empty">No reusable chart templates are available in this project.</div>
      </section>
    );
  }

  return (
    <section className="backend-proposal-section reusable-chart-review">
      <WorkflowPanelHeader
        title="Use a template"
        detail="Choose accepted experiments, confirm compatible inputs, then preview without an AI call or generated Python."
        meta={`${activeTemplates.length} template${activeTemplates.length === 1 ? "" : "s"}`}
      />
      <div className="reusable-chart-layout">
        <aside className="reusable-chart-template-list" aria-label="Reusable chart templates">
          {activeTemplates.map((template) => (
            <button
              type="button"
              key={template.id}
              className={template.id === selectedTemplateId ? "active" : ""}
              onClick={() => setSelectedTemplateId(template.id)}
            >
              <strong>{template.name}</strong>
              <span>{template.chartType || "Chart"} · version {template.currentVersion || 1}</span>
            </button>
          ))}
        </aside>
        <div className="reusable-chart-builder">
          {detailState.loading && <ThinkingIndicator text="Loading template contract..." />}
          {detailState.error && <p className="import-review-error">{detailState.error}</p>}
          {version && (
            <>
              <div className="reusable-chart-contract">
                <div>
                  <strong>{detailState.value?.reusableChartTemplate?.name}</strong>
                  <span>{version.encoding?.comparisonMode || "comparison"} · {minimum}–{hardMaximum} experiments</span>
                </div>
                <div className="reusable-chart-slot-chips" aria-label="Required template inputs">
                  {asArray(version.inputSlots).map((slot) => (
                    <span key={slot.slotId}>{slot.label}{slot.unitContract?.allowedUnits?.[0] ? ` (${slot.unitContract.allowedUnits[0]})` : ""}</span>
                  ))}
                </div>
              </div>

              <div className="reusable-chart-browser-toolbar">
                <label>
                  <span>Select experiments</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search experiments" />
                </label>
                <label className="reusable-chart-selected-only">
                  <input type="checkbox" checked={selectedOnly} onChange={(event) => setSelectedOnly(event.target.checked)} />
                  <span>Selected only</span>
                </label>
                <span className={selectedExperimentIds.length > recommendedMaximum ? "warning" : ""}>
                  {selectedExperimentIds.length}/{hardMaximum} selected
                </span>
              </div>
              {experimentState.loading && <ThinkingIndicator text="Loading accepted Experiment Browser records..." />}
              {experimentState.error && <p className="import-review-error">{experimentState.error}</p>}
              <div className="reusable-chart-browser-frame">
                <table className="reusable-chart-browser-table" aria-label="Template experiment Browser">
                  <thead>
                    <tr>
                      <th className="selection-column" aria-label="Select experiments" />
                      <th>
                        <button type="button" onClick={() => toggleSort("experiment")}>
                          Experiment {sortState.columnId === "experiment" ? sortState.direction === "asc" ? "↑" : "↓" : ""}
                        </button>
                      </th>
                      {templateSlots.map((slot) => {
                        const column = columnsById.get(slotColumnId(slot, bindings));
                        return (
                          <th key={slot.slotId}>
                            <button type="button" onClick={() => toggleSort(slot.slotId)}>
                              {templateSlotHeader(slot, column)} {sortState.columnId === slot.slotId ? sortState.direction === "asc" ? "↑" : "↓" : ""}
                            </button>
                          </th>
                        );
                      })}
                      <th>
                        <button type="button" onClick={() => toggleSort("status")}>
                          Status {sortState.columnId === "status" ? sortState.direction === "asc" ? "↑" : "↓" : ""}
                        </button>
                      </th>
                      <th className="inspect-column">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const selectedIndex = selectedExperimentIds.indexOf(row.experimentId);
                      const isSelected = selectedIndex >= 0;
                      const compatibilityStatus = rowCompatibility.get(row.experimentId);
                      return (
                        <tr
                          key={row.experimentId}
                          className={isSelected ? "selected" : ""}
                          tabIndex={0}
                          aria-selected={isSelected}
                          onClick={() => toggleExperiment(row.experimentId)}
                          onKeyDown={(event) => {
                            if (["Enter", " "].includes(event.key)) {
                              event.preventDefault();
                              toggleExperiment(row.experimentId);
                            }
                          }}
                        >
                          <td className="selection-column">
                            <input
                              type="checkbox"
                              aria-label={`Select ${row.label}`}
                              checked={isSelected}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleExperiment(row.experimentId)}
                              disabled={!isSelected && selectedExperimentIds.length >= hardMaximum}
                            />
                          </td>
                          <td className="experiment-column">
                            <strong>{row.label}</strong>
                            {isSelected && <small>Selection {selectedIndex + 1}</small>}
                          </td>
                          {templateSlots.map((slot) => {
                            const columnId = slotColumnId(slot, bindings);
                            const value = templateCellValue(row, columnId);
                            return <td key={slot.slotId} className={value === "—" ? "missing" : ""}>{value}</td>;
                          })}
                          <td>
                            <span className={`reusable-chart-row-status ${compatibilityStatus?.state || "binding"}`} title={compatibilityStatus?.detail}>
                              {compatibilityStatus?.label || "Review required"}
                            </span>
                          </td>
                          <td className="inspect-column">
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); openExperimentDetail(row); }}
                            >
                              View data
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!visibleRows.length && !experimentState.loading && <div className="import-review-empty">No accepted experiments match this search.</div>}
              </div>
              {experimentState.nextCursor && (
                <button type="button" className="reusable-chart-load-more" onClick={loadMoreExperiments} disabled={experimentState.loading}>
                  {experimentState.loading ? "Loading more..." : "Load more experiments"}
                </button>
              )}

              {selectedRows.length > 0 && (
                <div className="reusable-chart-coverage">
                  <strong>Input coverage</strong>
                  {asArray(version.inputSlots).map((slot) => {
                    const coverage = slotCoverage(slot, selectedRows);
                    return (
                      <div key={slot.slotId}>
                        <span>{slot.label}</span>
                        <span className={coverage.available === coverage.total ? "compatible" : "warning"}>
                          {coverage.available}/{coverage.total} exact-field values
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {blockers.length > 0 && (
                <div className="reusable-chart-compatibility" role="status">
                  <strong>Compatibility requires attention</strong>
                  {blockers.map((blocker, index) => (
                    <div key={`${blocker.code}-${blocker.slotId || index}`} className="reusable-chart-blocker">
                      <div>
                        <span>{blocker.message}</span>
                        {asArray(blocker.experimentIds).length > 0 && <small>Affected: {blocker.experimentIds.map((id) => experimentState.rows.find((row) => row.experimentId === id)?.label || id).join(", ")}</small>}
                      </div>
                      {asArray(blocker.candidates).length > 0 && (
                        <label>
                          <span>Bind field</span>
                          <select
                            value={bindings[blocker.slotId] || ""}
                            onChange={(event) => setBindings((current) => ({ ...current, [blocker.slotId]: event.target.value }))}
                          >
                            <option value="">Choose a field</option>
                            {blocker.candidates.map((columnId) => (
                              <option key={columnId} value={columnId}>{columnsById.get(columnId)?.label || columnId}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {applicationState.error && <p className="import-review-error">{applicationState.error}</p>}
              <div className="reusable-chart-actions">
                <span>{selectionCountValid ? "Preview creates a reviewable result, not an approved chart." : `Select ${minimum}–${hardMaximum} experiments.`}</span>
                <button type="button" className="primary" disabled={!canPreview} onClick={previewTemplate}>
                  {applicationState.loading ? "Checking inputs..." : blockers.length ? "Confirm and preview" : "Preview chart"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {experimentDetailState.experimentId && (
        <div className="template-experiment-detail-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            experimentDetailRequestRef.current += 1;
            setExperimentDetailState({ experimentId: "", loading: false, value: null, error: "" });
          }
        }}>
          <ExperimentDetailDrawer
            detail={experimentDetailState.value}
            loading={experimentDetailState.loading}
            error={experimentDetailState.error}
            onClose={() => {
              experimentDetailRequestRef.current += 1;
              setExperimentDetailState({ experimentId: "", loading: false, value: null, error: "" });
            }}
          />
        </div>
      )}
    </section>
  );
}

const LINKED_CHART_TYPE_OPTIONS = [
  { value: "grouped_bar", label: "Grouped bars (one bar per experiment per category)" },
  { value: "scatter", label: "Lines / points" },
  { value: "bar", label: "Bars" },
  { value: "stacked_bar", label: "Stacked bars" },
];

export function LinkedDataComparisonReview({
  projectId,
  onComparisonReady,
  loadDataKinds = listServerLinkedDataKinds,
  createComparison = createServerLinkedDataComparison,
}) {
  const [kindsState, setKindsState] = React.useState({ loading: false, value: null, error: "" });
  const [selectedKind, setSelectedKind] = React.useState("");
  const [chartType, setChartType] = React.useState("grouped_bar");
  const [selectedExperimentIds, setSelectedExperimentIds] = React.useState([]);
  const [previewState, setPreviewState] = React.useState({ loading: false, value: null, error: "" });
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    setKindsState({ loading: true, value: null, error: "" });
    loadDataKinds(projectId)
      .then((value) => {
        if (!active) return;
        setKindsState({ loading: false, value, error: "" });
        const firstKind = asArray(value?.dataKinds)[0]?.dataKind || "";
        setSelectedKind((current) => current || firstKind);
      })
      .catch((error) => {
        if (active) setKindsState({ loading: false, value: null, error: error?.message || String(error) });
      });
    return () => {
      active = false;
    };
  }, [projectId, loadDataKinds]);

  const dataKinds = asArray(kindsState.value?.dataKinds);
  const kind = dataKinds.find((item) => item.dataKind === selectedKind) || dataKinds[0] || null;
  const allExperiments = asArray(kindsState.value?.experiments);
  const linkedIds = new Set(asArray(kind?.experiments).map((item) => item.experimentId));
  const linkedById = new Map(asArray(kind?.experiments).map((item) => [item.experimentId, item]));
  const experimentRows = allExperiments.length
    ? allExperiments
    : asArray(kind?.experiments).map((item) => ({ experimentId: item.experimentId, label: item.label }));
  const selectedLinked = selectedExperimentIds.filter((id) => linkedIds.has(id));

  const changeKind = (nextKind) => {
    setSelectedKind(nextKind);
    setSelectedExperimentIds([]);
    setPreviewState({ loading: false, value: null, error: "" });
  };
  const toggleExperiment = (experimentId) => {
    setSelectedExperimentIds((current) => (current.includes(experimentId) ? current.filter((id) => id !== experimentId) : [...current, experimentId]));
    setPreviewState({ loading: false, value: null, error: "" });
  };
  const selectAllLinked = () => {
    setSelectedExperimentIds(asArray(kind?.experiments).map((item) => item.experimentId));
    setPreviewState({ loading: false, value: null, error: "" });
  };
  const preview = async () => {
    if (!kind || !selectedLinked.length) return;
    setPreviewState({ loading: true, value: null, error: "" });
    try {
      const response = await createComparison(projectId, { dataKind: kind.dataKind, experimentIds: selectedExperimentIds, chartType, dryRun: true });
      setPreviewState({ loading: false, value: response?.comparison || null, error: "" });
    } catch (error) {
      setPreviewState({ loading: false, value: null, error: error?.message || String(error) });
    }
  };
  const create = async () => {
    if (!kind || !selectedLinked.length || creating) return;
    setCreating(true);
    setPreviewState((current) => ({ ...current, error: "" }));
    try {
      const response = await createComparison(projectId, { dataKind: kind.dataKind, experimentIds: selectedExperimentIds, chartType });
      setPreviewState({ loading: false, value: response?.comparison || null, error: "" });
      if (response?.analysisThread?.id && response?.analysisPlanRevision?.id) onComparisonReady?.(response);
    } catch (error) {
      setPreviewState((current) => ({ ...current, loading: false, error: error?.message || String(error) }));
    } finally {
      setCreating(false);
    }
  };

  if (kindsState.loading) {
    return <section className="backend-proposal-section"><WorkflowPanelHeader title="Compare linked data" detail="Loading linked workbook data..." /></section>;
  }
  if (kindsState.error) {
    return <section className="backend-proposal-section"><WorkflowPanelHeader title="Compare linked data" detail={kindsState.error} /></section>;
  }
  if (!dataKinds.length) {
    return (
      <section className="backend-proposal-section reusable-chart-empty">
        <WorkflowPanelHeader
          title="Compare linked data"
          detail="Confirm workbook regions linked to experiments (for example from an extraction template batch) before comparing them here."
        />
        <div className="import-review-empty">No linked workbook data is available in this project yet.</div>
      </section>
    );
  }
  const comparison = previewState.value;
  return (
    <section className="backend-proposal-section linked-data-comparison" aria-label="Compare linked data">
      <WorkflowPanelHeader
        title="Compare linked data"
        detail="Pick a data kind and experiments. LabRat selects each experiment's confirmed workbook region deterministically, then the normal reviewed chart path takes over."
      />
      <div className="linked-data-controls">
        <label>
          <span>Data kind</span>
          <select aria-label="Data kind" value={kind?.dataKind || ""} onChange={(event) => changeKind(event.target.value)}>
            {dataKinds.map((item) => (
              <option key={item.dataKind} value={item.dataKind}>{item.dataKind} ({item.experimentCount} experiment{item.experimentCount === 1 ? "" : "s"})</option>
            ))}
          </select>
        </label>
        <label>
          <span>Chart type</span>
          <select aria-label="Chart type" value={chartType} onChange={(event) => setChartType(event.target.value)}>
            {LINKED_CHART_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={selectAllLinked} disabled={!linkedIds.size}>Select all with data</button>
      </div>
      <ul className="linked-data-experiments" aria-label="Experiments">
        {experimentRows.map((experiment) => {
          const linked = linkedById.get(experiment.experimentId) || null;
          const region = linked ? linked.regions[0] : null;
          const inputId = `linked-${kind?.dataKind || "kind"}-${experiment.experimentId}`;
          return (
            <li key={experiment.experimentId} className={linked ? "is-linked" : "is-missing"}>
              <input
                id={inputId}
                type="checkbox"
                aria-label={`Include ${experiment.label}`}
                checked={selectedExperimentIds.includes(experiment.experimentId)}
                disabled={!linked}
                onChange={() => toggleExperiment(experiment.experimentId)}
              />
              <label htmlFor={inputId}>
                <strong>{experiment.label}</strong>
                {region ? (
                  <span>{region.workbookName} · {region.sheetName}!{region.range}{linked.regions.length > 1 ? ` (+${linked.regions.length - 1} more)` : ""}</span>
                ) : <span className="browser-muted">no linked {kind?.dataKind || "data"}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="linked-data-actions">
        <button type="button" disabled={!selectedLinked.length || previewState.loading || creating} onClick={preview}>
          {previewState.loading ? "Previewing..." : "Preview selections"}
        </button>
        <button type="button" className="primary" disabled={!selectedLinked.length || creating} onClick={create}>
          {creating ? "Preparing plan..." : `Create comparison plan (${selectedLinked.length})`}
        </button>
      </div>
      {previewState.error && <p className="workbook-region-error" role="alert">{previewState.error}</p>}
      {comparison && (
        <div className="linked-data-preview" aria-label="Comparison preview">
          <p>{comparison.requestSummary}</p>
          <ul>
            {asArray(comparison.experiments).map((experiment) => (
              <li key={experiment.experimentId}><strong>{experiment.label}</strong> <span>{experiment.workbookName} · {experiment.sheetName}!{experiment.range}</span></li>
            ))}
          </ul>
          {!!asArray(comparison.missingExperiments).length && (
            <p className="browser-muted">Not included: {comparison.missingExperiments.map((item) => item.label).join(", ")}</p>
          )}
          {asArray(comparison.warnings).map((warning, index) => <p className="browser-muted" key={`${warning.code}-${index}`}>{warning.message}</p>)}
        </div>
      )}
    </section>
  );
}

export function ChartReviewPanel({
  chartInterpretState,
  chartSpecs,
  viewMode = "review",
  onInterpretChart,
  onLoadChartSpecDetail,
  onInsertChartSpec,
  projectId,
  reusableChartTemplates = [],
  onTemplateApplicationReady,
  onLinkedComparisonReady,
  allowAnalysisPrompt = false,
}) {
  if (viewMode === "linked") {
    return (
      <div className="chart-review-panel">
        <LinkedDataComparisonReview projectId={projectId} onComparisonReady={onLinkedComparisonReady} />
      </div>
    );
  }
  if (viewMode === "edit") {
    return (
      <div className="chart-review-panel">
        <ApprovedChartSpecReview
          chartSpecs={chartSpecs}
          onLoadChartSpecDetail={onLoadChartSpecDetail}
          onInsertChartSpec={onInsertChartSpec}
        />
      </div>
    );
  }
  if (viewMode === "template") {
    return (
      <div className="chart-review-panel">
        <ReusableChartTemplateReview
          projectId={projectId}
          templates={reusableChartTemplates}
          onApplicationReady={onTemplateApplicationReady}
        />
      </div>
    );
  }
  return (
    <div className="chart-review-panel">
      {allowAnalysisPrompt
        ? <ReviewedAnalysisRequest state={chartInterpretState} onSubmit={onInterpretChart} />
        : <div className="import-review-empty">Select a server project first.</div>}
    </div>
  );
}
