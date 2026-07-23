import { describe, expect, it } from "vitest";
import { chartPlotForExport } from "./pptxExport.js";

const analysisChartSpec = {
  id: "chart_spec_analysis",
  title: "Reaction rate",
  chartType: "scatter",
  spec: {
    schemaVersion: "labrat.chartSpec.v3",
    origin: "analysis_result",
    chartType: "scatter",
    title: "Reaction rate",
    plotly: {
      data: [
        {
          traceId: "trace_exp_1",
          name: "Exp-001",
          type: "scatter",
          x: [0, 10],
          y: [1, 2],
        },
        {
          traceId: "trace_exp_2",
          name: "Exp-002",
          type: "scatter",
          x: [0, 10],
          y: [3, 4],
        },
      ],
      layout: {
        xaxis: { title: "Time (min)" },
        yaxis: { title: "Rate (mmol/g/min)" },
      },
    },
    traceCatalog: [
      {
        traceId: "trace_exp_1",
        name: "Exp-001",
        type: "scatter",
        pointCount: 2,
      },
      {
        traceId: "trace_exp_2",
        name: "Exp-002",
        type: "scatter",
        pointCount: 2,
      },
    ],
    defaultChartView: { visibleTraceIds: ["trace_exp_1", "trace_exp_2"] },
  },
};

describe("PPTX chart export", () => {
  it("renders only the traces visible in this manuscript placement", () => {
    const plot = chartPlotForExport({
      id: "chart_block_1",
      kind: "chart",
      chartSpecId: analysisChartSpec.id,
      chartSpecSnapshot: analysisChartSpec,
      chartView: { visibleTraceIds: ["trace_exp_2"] },
      chartLayout: {},
      w: 640,
      h: 420,
    }, [analysisChartSpec]);

    expect(plot.traces.map((trace) => trace.name)).toEqual(["Exp-002"]);
  });
});
