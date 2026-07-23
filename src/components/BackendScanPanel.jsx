import React from "react";
import { makeChartSpecPreview } from "../charts/chartSpecPreview.js";
import { Plot } from "../charts/Plot.jsx";
import { ThinkingIndicator } from "./ThinkingIndicator.jsx";

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
  const canSubmit = Boolean(prompt.trim()) && !state?.loading;
  return (
    <section className="backend-proposal-section">
      <WorkflowPanelHeader
        title="Create a chart"
        detail="LabRat selects from confirmed workbook regions or published experiment data. Review the exact ranges and processing plan before Python runs."
      />
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
          onClick={() => onSubmit?.(prompt.trim())}
        >
          {state?.loading ? "Preparing plan..." : "Prepare plan"}
        </button>
        {state?.loading && <ThinkingIndicator text="Selecting evidence and drafting a reviewable plan..." />}
      </div>
      {state?.error && <p className="import-review-error">{state.error}</p>}
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
  allowAnalysisPrompt = false,
}) {
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
  return (
    <div className="chart-review-panel">
      {allowAnalysisPrompt
        ? <ReviewedAnalysisRequest state={chartInterpretState} onSubmit={onInterpretChart} />
        : <div className="import-review-empty">Select a server project first.</div>}
    </div>
  );
}
