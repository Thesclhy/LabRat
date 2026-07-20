import { describe, expect, it } from "vitest";
import { experimentOptionsForChartSpec, makeSourceChartPreview } from "./sourceChartPreview.js";

function seriesChartSpec(overrides = {}) {
  return {
    origin: "source_extract",
    chartType: "distribution_bar",
    title: "Carbon Balance Distribution Cross-Compare",
    x: { field: "carbon_number", label: "Carbon number" },
    y: { field: "percentage", label: "Percentage", unit: "%" },
    seriesScope: { xField: "carbon_number", yField: "percentage", groupBy: "experiment" },
    compatibleExperimentIds: ["exp_33", "exp_34"],
    series: [
      { seriesId: "series_exp33", experimentId: "exp_33", experimentLabel: "Exp33" },
      { seriesId: "series_exp34", experimentId: "exp_34", experimentLabel: "Exp34" },
    ],
    sourceSnapshot: {
      series: [
        {
          seriesId: "series_exp33",
          experimentId: "exp_33",
          experimentLabel: "Exp33",
          rows: [
            { values: { carbon_number: 1, percentage: 5 } },
            { values: { carbon_number: 2, percentage: 12.5 } },
          ],
        },
        {
          seriesId: "series_exp34",
          experimentId: "exp_34",
          experimentLabel: "Exp34",
          rows: [
            { values: { carbon_number: 1, percentage: 6 } },
            { values: { carbon_number: 2, percentage: 13 } },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function analysisResultChartSpec(overrides = {}) {
  return {
    id: "chart_spec_analysis_1",
    chartType: "scatter",
    title: "Reaction rate over time",
    spec: {
      schemaVersion: "labrat.chartSpec.v2",
      origin: "analysis_result",
      chartType: "scatter",
      title: "Reaction rate over time",
      x: { field: "reaction_time", label: "Reaction time", unit: "min" },
      y: { field: "reaction_rate", label: "Reaction rate", unit: "mmol/g/min" },
      traceCatalog: [
        {
          traceId: "trace_exp_1",
          experimentId: "experiment_1",
          experimentLabel: "Exp 1",
          x: [0, 10],
          y: [1, 2],
          xUnit: "min",
          yUnit: "mmol/g/min",
          sourceRecordIds: ["snapshot_1:0"],
        },
        {
          traceId: "trace_exp_2",
          experimentId: "experiment_2",
          experimentLabel: "Exp 2",
          x: [0, 10],
          y: [2, 4],
          xUnit: "min",
          yUnit: "mmol/g/min",
          sourceRecordIds: ["snapshot_2:0"],
        },
      ],
      defaultChartView: { visibleTraceIds: ["trace_exp_1"] },
    },
    ...overrides,
  };
}

describe("makeSourceChartPreview", () => {
  it("renders a single immutable source snapshot", () => {
    const preview = makeSourceChartPreview({
      origin: "source_extract",
      chartType: "bar",
      title: "Exp33 distribution",
      x: { field: "carbon_number", label: "Carbon number" },
      y: { field: "percentage", label: "Percentage", unit: "%" },
      sourceSnapshot: {
        rows: [
          { values: { carbon_number: 1, percentage: 5 } },
          { values: { carbon_number: 2, percentage: 12.5 } },
        ],
      },
    });

    expect(preview.traces).toHaveLength(1);
    expect(preview.traces[0].type).toBe("bar");
    expect(preview.traces[0].x).toEqual([1, 2]);
    expect(preview.traces[0].y).toEqual([5, 12.5]);
    expect(preview.layout.yaxis.title).toBe("Percentage (%)");
  });

  it("renders and filters source-backed experiment series", () => {
    const preview = makeSourceChartPreview(seriesChartSpec());
    const filtered = makeSourceChartPreview(seriesChartSpec(), {
      chartView: { selectedExperimentIds: ["exp_34"] },
    });

    expect(preview.traces.map((trace) => trace.name)).toEqual(["Exp33", "Exp34"]);
    expect(preview.traces.map((trace) => trace.marker.color)).toEqual(["#0072B2", "#D55E00"]);
    expect(preview.layout.barmode).toBe("group");
    expect(filtered.traces).toHaveLength(1);
    expect(filtered.traces[0].name).toBe("Exp34");
  });

  it("derives experiment options only from source-backed series", () => {
    expect(experimentOptionsForChartSpec(seriesChartSpec())).toEqual([
      { id: "exp_33", label: "Exp33", detail: "" },
      { id: "exp_34", label: "Exp34", detail: "" },
    ]);
  });

  it("projects source scatter style and axis settings", () => {
    const preview = makeSourceChartPreview({
      origin: "source_extract",
      chartType: "scatter",
      title: "Rate over time",
      x: { field: "time", label: "Time", unit: "min" },
      y: { field: "rate", label: "Rate", unit: "M/s" },
      axisOptions: { y: { scale: "log10", tickFormat: ".1e" } },
      renderStyle: {
        traceMode: "lines+markers",
        traces: [{ marker: { symbol: "circle-open", color: "#222222" } }],
      },
      sourceSnapshot: {
        rows: [
          { values: { time: 0, rate: 0.001 } },
          { values: { time: 10, rate: 0.002 } },
        ],
      },
    });

    expect(preview.traces[0].type).toBe("scatter");
    expect(preview.traces[0].mode).toBe("lines+markers");
    expect(preview.traces[0].marker.symbol).toBe("circle-open");
    expect(preview.layout.yaxis.type).toBe("log");
    expect(preview.layout.yaxis.tickformat).toBe(".1e");
  });

  it("renders immutable analysis-result traces without a sourceSnapshot", () => {
    const defaultPreview = makeSourceChartPreview(analysisResultChartSpec());
    const localView = makeSourceChartPreview(analysisResultChartSpec(), {
      chartView: { visibleTraceIds: ["trace_exp_2"] },
    });

    expect(defaultPreview.traces.map((trace) => trace.name)).toEqual(["Exp 1"]);
    expect(defaultPreview.traces[0].x).toEqual([0, 10]);
    expect(defaultPreview.traces[0].y).toEqual([1, 2]);
    expect(localView.traces.map((trace) => trace.name)).toEqual(["Exp 2"]);
    expect(localView.layout.xaxis.title).toBe("Reaction time (min)");
    expect(localView.layout.yaxis.title).toBe("Reaction rate (mmol/g/min)");
  });

  it("keeps incompatible analysis-result units on separate Plotly axes", () => {
    const chart = analysisResultChartSpec();
    chart.spec.traceCatalog[1] = {
      ...chart.spec.traceCatalog[1],
      yUnit: "percent",
    };
    chart.spec.defaultChartView.visibleTraceIds = ["trace_exp_1", "trace_exp_2"];

    const preview = makeSourceChartPreview(chart);

    expect(preview.traces.map((trace) => trace.yaxis)).toEqual(["y", "y2"]);
    expect(preview.layout.yaxis.title).toBe("Value (mmol/g/min)");
    expect(preview.layout.yaxis2.title).toBe("Value (percent)");
  });
});
