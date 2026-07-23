import { describe, expect, it } from "vitest";
import { makeChartSpecPreview } from "./chartSpecPreview.js";

function analysisResultChartSpec() {
  return {
    id: "chart_spec_analysis_1",
    chartType: "scatter",
    title: "Reaction rate over time",
    spec: {
      schemaVersion: "labrat.chartSpec.v3",
      origin: "analysis_result",
      chartType: "scatter",
      title: "Reaction rate over time",
      plotly: {
        data: [
          {
            traceId: "trace_exp_1",
            name: "Exp 1",
            type: "scatter",
            x: [0, 10],
            y: [1, 2],
          },
          {
            traceId: "trace_exp_2",
            name: "Exp 2",
            type: "scatter",
            x: [0, 10],
            y: [2, 4],
          },
        ],
        layout: {
          xaxis: { title: "Reaction time (min)" },
          yaxis: { title: "Reaction rate (mmol/g/min)" },
        },
      },
      traceCatalog: [
        {
          traceId: "trace_exp_1",
          name: "Exp 1",
          type: "scatter",
          pointCount: 2,
        },
        {
          traceId: "trace_exp_2",
          name: "Exp 2",
          type: "scatter",
          pointCount: 2,
        },
      ],
      defaultChartView: { visibleTraceIds: ["trace_exp_1"] },
    },
  };
}

describe("makeChartSpecPreview", () => {
  it("renders and filters immutable analysis-result traces", () => {
    const chart = analysisResultChartSpec();
    const defaultPreview = makeChartSpecPreview(chart);
    const localView = makeChartSpecPreview(chart, {
      chartView: { visibleTraceIds: ["trace_exp_2"] },
    });

    expect(defaultPreview.traces.map((trace) => trace.name)).toEqual(["Exp 1"]);
    expect(defaultPreview.traces[0].x).toEqual([0, 10]);
    expect(defaultPreview.traces[0].y).toEqual([1, 2]);
    expect(localView.traces.map((trace) => trace.name)).toEqual(["Exp 2"]);
    expect(localView.layout.xaxis.title).toBe("Reaction time (min)");
    expect(localView.layout.yaxis.title).toBe("Reaction rate (mmol/g/min)");
  });

  it("preserves Python-authored Plotly layout without reconstructing axes", () => {
    const chart = analysisResultChartSpec();
    chart.spec.plotly.data[0].yaxis = "y";
    chart.spec.plotly.data[1].yaxis = "y2";
    chart.spec.plotly.layout.yaxis2 = { title: "Conversion (%)", overlaying: "y", side: "right" };
    chart.spec.defaultChartView.visibleTraceIds = ["trace_exp_1", "trace_exp_2"];

    const preview = makeChartSpecPreview(chart);

    expect(preview.traces.map((trace) => trace.yaxis)).toEqual(["y", "y2"]);
    expect(preview.layout.yaxis.title).toBe("Reaction rate (mmol/g/min)");
    expect(preview.layout.yaxis2.title).toBe("Conversion (%)");
  });

  it("fails closed for a retired chart origin", () => {
    const preview = makeChartSpecPreview({ origin: "retired", traceCatalog: [] });
    expect(preview.traces).toEqual([]);
  });
});
