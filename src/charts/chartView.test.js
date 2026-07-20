import { describe, expect, it } from "vitest";
import { normalizeChartView, traceOptionsForChartSpec } from "./chartView.js";

function sourceSeriesSpec() {
  return {
    origin: "source_extract",
    chartType: "scatter",
    x: { field: "time", label: "Time", unit: "min" },
    y: { field: "rate", label: "Rate", unit: "mmol/g/min" },
    series: [
      { seriesId: "series_exp_1", experimentId: "exp_1", experimentLabel: "Exp-001" },
      { seriesId: "series_exp_2", experimentId: "exp_2", experimentLabel: "Exp-002" },
    ],
    sourceSnapshot: {
      series: [
        { seriesId: "series_exp_1", experimentId: "exp_1", experimentLabel: "Exp-001", rows: [] },
        { seriesId: "series_exp_2", experimentId: "exp_2", experimentLabel: "Exp-002", rows: [] },
      ],
    },
  };
}

function analysisSpec() {
  return {
    origin: "analysis_result",
    traceCatalog: [
      {
        traceId: "trace_exp_1",
        experimentId: "exp_1",
        experimentLabel: "Exp-001",
        xUnit: "min",
        yUnit: "mmol/g/min",
      },
      {
        traceId: "trace_exp_2",
        experimentId: "exp_2",
        experimentLabel: "Exp-002",
        xUnit: "min",
        yUnit: "mmol/g/min",
      },
    ],
    defaultChartView: { visibleTraceIds: ["trace_exp_2"] },
  };
}

describe("chartView", () => {
  it("normalizes legacy experiment selection into stable source trace ids", () => {
    expect(normalizeChartView(sourceSeriesSpec(), {
      selectedExperimentIds: ["exp_2"],
    })).toEqual({ visibleTraceIds: ["exp_2:rate"] });
  });

  it("uses the reviewed analysis default and preserves an explicit empty local view", () => {
    expect(normalizeChartView(analysisSpec(), null)).toEqual({
      visibleTraceIds: ["trace_exp_2"],
    });
    expect(normalizeChartView(analysisSpec(), { visibleTraceIds: [] })).toEqual({
      visibleTraceIds: [],
    });
  });

  it("returns complete bounded trace options without authoritative arrays", () => {
    expect(traceOptionsForChartSpec(analysisSpec())).toEqual([
      {
        id: "trace_exp_1",
        label: "Exp-001",
        detail: "min to mmol/g/min",
        experimentId: "exp_1",
      },
      {
        id: "trace_exp_2",
        label: "Exp-002",
        detail: "min to mmol/g/min",
        experimentId: "exp_2",
      },
    ]);
    expect(traceOptionsForChartSpec(sourceSeriesSpec()).map((option) => option.id)).toEqual([
      "exp_1:rate",
      "exp_2:rate",
    ]);
  });
});
