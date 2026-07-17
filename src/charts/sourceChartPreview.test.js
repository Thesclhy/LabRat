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
});
