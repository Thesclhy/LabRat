import { describe, expect, it } from "vitest";
import { chartPlotForExport } from "./pptxExport.js";

const analysisChartSpec = {
  id: "chart_spec_analysis",
  title: "Reaction rate",
  chartType: "scatter",
  spec: {
    origin: "analysis_result",
    chartType: "scatter",
    title: "Reaction rate",
    traceCatalog: [
      {
        traceId: "trace_exp_1",
        experimentId: "exp_1",
        experimentLabel: "Exp-001",
        x: [0, 10],
        y: [1, 2],
        xUnit: "min",
        yUnit: "mmol/g/min",
      },
      {
        traceId: "trace_exp_2",
        experimentId: "exp_2",
        experimentLabel: "Exp-002",
        x: [0, 10],
        y: [3, 4],
        xUnit: "min",
        yUnit: "mmol/g/min",
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

  it("keeps legacy source experiment selection compatible during export", () => {
    const sourceChartSpec = {
      id: "chart_spec_source",
      title: "Source rates",
      chartType: "scatter",
      spec: {
        origin: "source_extract",
        chartType: "scatter",
        x: { field: "time", unit: "min" },
        y: { field: "rate", unit: "mmol/g/min" },
        series: [
          { seriesId: "series_1", experimentId: "exp_1", experimentLabel: "Exp-001" },
          { seriesId: "series_2", experimentId: "exp_2", experimentLabel: "Exp-002" },
        ],
        sourceSnapshot: {
          series: [
            {
              seriesId: "series_1",
              experimentId: "exp_1",
              experimentLabel: "Exp-001",
              rows: [{ values: { time: 0, rate: 1 } }, { values: { time: 10, rate: 2 } }],
            },
            {
              seriesId: "series_2",
              experimentId: "exp_2",
              experimentLabel: "Exp-002",
              rows: [{ values: { time: 0, rate: 3 } }, { values: { time: 10, rate: 4 } }],
            },
          ],
        },
      },
    };
    const plot = chartPlotForExport({
      id: "chart_block_source",
      kind: "chart",
      chartSpecId: sourceChartSpec.id,
      chartSpecSnapshot: sourceChartSpec,
      chartView: { selectedExperimentIds: ["exp_1"] },
      chartLayout: {},
      w: 640,
      h: 420,
    }, [sourceChartSpec]);

    expect(plot.traces.map((trace) => trace.name)).toEqual(["Exp-001"]);
  });
});
