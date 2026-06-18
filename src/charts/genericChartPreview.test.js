import { describe, expect, it } from "vitest";
import { experimentOptionsForChartSpec, makeGenericChartPreview } from "./genericChartPreview.js";

function genericImports() {
  return [{
    importId: "import_1",
    experiments: [
      { experimentId: "exp_1", name: "Exp1" },
      { experimentId: "exp_2", name: "Exp1" },
    ],
    measurements: [
      { measurementId: "time_1", experimentId: "exp_1", rowIndex: 2, value: 0, rawValue: "0" },
      { measurementId: "conv_1", experimentId: "exp_1", rowIndex: 2, value: 0, rawValue: "0" },
      { measurementId: "time_2", experimentId: "exp_2", rowIndex: 3, value: 10, rawValue: "10" },
      { measurementId: "conv_2", experimentId: "exp_2", rowIndex: 3, value: 25, rawValue: "25" },
    ],
  }];
}

function familyImport() {
  return [{
    importId: "import_family",
    experiments: [
      { experimentId: "exp_1", name: "Exp1" },
      { experimentId: "exp_2", name: "Exp2" },
    ],
    fields: [
      { fieldValueId: "label_1", experimentId: "exp_1", rowIndex: 2, field: "label", role: "identifier", value: "Exp1", rawValue: "Exp1" },
      { fieldValueId: "label_2", experimentId: "exp_2", rowIndex: 3, field: "label", role: "identifier", value: "Exp2", rawValue: "Exp2" },
      { fieldValueId: "solid_1", experimentId: "exp_1", rowIndex: 2, field: "solid", role: "measurement", value: 50, rawValue: "50" },
      { fieldValueId: "liquid_1", experimentId: "exp_1", rowIndex: 2, field: "liquid", role: "measurement", value: 25, rawValue: "25" },
      { fieldValueId: "gas_1", experimentId: "exp_1", rowIndex: 2, field: "gas", role: "measurement", value: 25, rawValue: "25" },
      { fieldValueId: "solid_2", experimentId: "exp_2", rowIndex: 3, field: "solid", role: "measurement", value: 1, rawValue: "1" },
      { fieldValueId: "liquid_2", experimentId: "exp_2", rowIndex: 3, field: "liquid", role: "measurement", value: 1, rawValue: "1" },
      { fieldValueId: "gas_2", experimentId: "exp_2", rowIndex: 3, field: "gas", role: "measurement", value: 2, rawValue: "2" },
      { fieldValueId: "c7_1", experimentId: "exp_1", rowIndex: 2, field: "C7", role: "measurement", value: 9, rawValue: "9" },
      { fieldValueId: "c8_1", experimentId: "exp_1", rowIndex: 2, field: "C8", role: "measurement", value: 20, rawValue: "20" },
      { fieldValueId: "c10_1", experimentId: "exp_1", rowIndex: 2, field: "C10", role: "measurement", value: 18, rawValue: "18" },
      { fieldValueId: "c7_2", experimentId: "exp_2", rowIndex: 3, field: "C7", role: "measurement", value: 1, rawValue: "1" },
      { fieldValueId: "c8_2", experimentId: "exp_2", rowIndex: 3, field: "C8", role: "measurement", value: 3, rawValue: "3" },
      { fieldValueId: "c10_2", experimentId: "exp_2", rowIndex: 3, field: "C10", role: "measurement", value: 5, rawValue: "5" },
    ],
  }];
}

function observationImport(options = {}) {
  const prefix = options.prefix ? `${options.prefix}_` : "";
  const importId = options.importId || "import_reaction_rate";
  const experimentId = options.experimentId || "exp_30";
  const experimentLabel = options.experimentLabel || "Exp30";
  const observationSetId = options.observationSetId || "obsset_1";
  const points = options.points || [[0, 0.001], [10, 0.002]];
  return [{
    importId,
    relatedExperimentIds: [experimentId],
    observationSets: [{
      observationSetId,
      kind: "reaction_rate_time_series",
      inferredExperimentLabel: experimentLabel,
      targetExperimentIds: [experimentId],
      observations: points.map((point, index) => ({ observationId: `${prefix}obs_${index + 1}`, rowIndex: index + 3 })),
      summary: { observationCount: points.length },
    }],
    fields: points.flatMap(([time, rate], index) => {
      const observationId = `${prefix}obs_${index + 1}`;
      return [
        { fieldValueId: `${prefix}rt_${index + 1}`, recordKind: "observation", observationSetId, observationId, relatedExperimentIds: [experimentId], inferredExperimentLabel: experimentLabel, rowIndex: index + 3, field: "reaction_time_min", role: "condition", value: time, rawValue: String(time) },
        { fieldValueId: `${prefix}ar_${index + 1}`, recordKind: "observation", observationSetId, observationId, relatedExperimentIds: [experimentId], inferredExperimentLabel: experimentLabel, rowIndex: index + 3, field: "adjusted_rate_m_s", role: "measurement", value: rate, rawValue: String(rate) },
      ];
    }),
  }];
}

describe("makeGenericChartPreview", () => {
  it("builds read-only scatter traces from paired proposal measurements", () => {
    const preview = makeGenericChartPreview({
      chartType: "scatter",
      title: "Conversion vs Time",
      x: { label: "Time", unit: "min", measurementIds: ["time_1", "time_2"] },
      y: { label: "Conversion", unit: "%", measurementIds: ["conv_1", "conv_2"] },
    }, genericImports());

    expect(preview.traces).toHaveLength(1);
    expect(preview.traces[0].x).toEqual([0, 10]);
    expect(preview.traces[0].y).toEqual([0, 25]);
    expect(preview.layout.title.text).toBe("Conversion vs Time");
    expect(preview.layout.xaxis.title).toBe("Time (min)");
  });

  it("builds chart spec draft previews from source ids", () => {
    const preview = makeGenericChartPreview({
      chartType: "scatter",
      title: "Conversion vs Time",
      x: { label: "Time", unit: "min", sourceIds: ["time_1", "time_2"] },
      y: { label: "Conversion", unit: "%", sourceIds: ["conv_1", "conv_2"] },
    }, genericImports());

    expect(preview.traces).toHaveLength(1);
    expect(preview.traces[0].x).toEqual([0, 10]);
    expect(preview.traces[0].y).toEqual([0, 25]);
  });

  it("builds grouped bar previews for multi-y chart spec drafts", () => {
    const preview = makeGenericChartPreview({
      chartType: "grouped_bar",
      title: "Conversion and duplicate value vs Time",
      x: { label: "Time", unit: "min", sourceIds: ["time_1", "time_2"] },
      yFields: [
        { label: "Conversion", unit: "%", sourceIds: ["conv_1", "conv_2"] },
        { label: "Conversion copy", unit: "%", sourceIds: ["conv_1", "conv_2"] },
      ],
    }, genericImports());

    expect(preview.traces).toHaveLength(2);
    expect(preview.traces[0].type).toBe("bar");
    expect(preview.traces[1].name).toBe("Conversion copy");
    expect(preview.layout.barmode).toBe("group");
  });

  it("filters preview traces through chartView experiment selections", () => {
    const preview = makeGenericChartPreview({
      chartType: "scatter",
      title: "Conversion vs Time",
      x: { label: "Time", unit: "min", sourceIds: ["time_1", "time_2"] },
      y: { label: "Conversion", unit: "%", sourceIds: ["conv_1", "conv_2"] },
    }, genericImports(), {
      chartView: { selectedExperimentIds: ["exp_2"] },
    });

    expect(preview.traces).toHaveLength(1);
    expect(preview.traces[0].x).toEqual([10]);
    expect(preview.traces[0].y).toEqual([25]);
  });

  it("returns chart-specific experiment options from source ids", () => {
    const options = experimentOptionsForChartSpec({
      chartType: "scatter",
      x: { sourceIds: ["time_1", "time_2"] },
      y: { sourceIds: ["conv_1", "conv_2"] },
    }, genericImports());

    expect(options.map((option) => option.id)).toEqual(["exp_1", "exp_2"]);
  });

  it("builds scatter previews and experiment options from observation sets", () => {
    const proposal = {
      chartType: "scatter",
      title: "Adjusted rate vs reaction time",
      x: { label: "Reaction Time", unit: "min", sourceIds: ["rt_1", "rt_2"] },
      y: { label: "Adjusted Rate", unit: "M/s", sourceIds: ["ar_1", "ar_2"] },
    };
    const preview = makeGenericChartPreview(proposal, observationImport(), {
      chartView: { selectedExperimentIds: ["exp_30"] },
    });
    const options = experimentOptionsForChartSpec(proposal, observationImport());

    expect(preview.traces).toHaveLength(1);
    expect(preview.traces[0].name).toBe("Exp30");
    expect(preview.traces[0].x).toEqual([0, 10]);
    expect(preview.traces[0].y).toEqual([0.001, 0.002]);
    expect(options).toEqual([{ id: "exp_30", label: "Exp30", detail: "" }]);
  });

  it("uses source ids to preview the requested supplemental observation set when multiple Exp supplements exist", () => {
    const imports = [
      ...observationImport(),
      ...observationImport({
        importId: "import_reaction_rate_exp31",
        experimentId: "exp_31",
        experimentLabel: "Exp31",
        observationSetId: "obsset_31",
        prefix: "exp31",
        points: [[1, 0.01], [2, 0.02]],
      }),
    ];
    const preview = makeGenericChartPreview({
      chartType: "scatter",
      title: "Adjusted rate vs reaction time",
      x: { label: "Reaction Time", unit: "min", sourceIds: ["exp31_rt_1", "exp31_rt_2"] },
      y: { label: "Adjusted Rate", unit: "M/s", sourceIds: ["exp31_ar_1", "exp31_ar_2"] },
    }, imports);

    expect(preview.traces).toHaveLength(1);
    expect(preview.traces[0].name).toBe("Exp31");
    expect(preview.traces[0].x).toEqual([1, 2]);
    expect(preview.traces[0].y).toEqual([0.01, 0.02]);
  });

  it("projects ChartSpec v1.3 log axes and Excel-like trace style into Plotly preview", () => {
    const preview = makeGenericChartPreview({
      schemaVersion: "labrat.chartSpec.v1.3",
      chartType: "scatter",
      title: "Adjusted rate vs reaction time",
      x: { label: "Reaction Time", unit: "min", sourceIds: ["rt_1", "rt_2"] },
      y: { label: "Adjusted Rate", unit: "M/s", sourceIds: ["ar_1", "ar_2"] },
      axisOptions: {
        y: { scale: "log10", title: "Adjusted Rate (M/s)", tickFormat: ".1e" },
      },
      renderStyle: {
        preset: "excel_like",
        traceMode: "lines+markers",
        showLegend: false,
        grid: { x: true, y: true, color: "#d9d9d9" },
        traces: [{ target: "primary", line: { color: "#4472C4", width: 2 }, marker: { color: "#4472C4", size: 6 } }],
      },
    }, observationImport());

    expect(preview.layout.yaxis.type).toBe("log");
    expect(preview.layout.yaxis.title).toBe("Adjusted Rate (M/s)");
    expect(preview.layout.yaxis.tickformat).toBe(".1e");
    expect(preview.layout.xaxis.showgrid).toBe(true);
    expect(preview.layout.yaxis.gridcolor).toBe("#d9d9d9");
    expect(preview.layout.showlegend).toBe(false);
    expect(preview.traces[0].mode).toBe("lines+markers");
    expect(preview.traces[0].line.color).toBe("#4472C4");
    expect(preview.traces[0].marker.size).toBe(6);
  });

  it("projects ChartSpec v1.3 markers-only hollow scatter style into Plotly preview", () => {
    const preview = makeGenericChartPreview({
      schemaVersion: "labrat.chartSpec.v1.3",
      chartType: "scatter",
      title: "Adjusted rate vs reaction time",
      x: { label: "Reaction Time", unit: "min", sourceIds: ["rt_1", "rt_2"] },
      y: { label: "Adjusted Rate", unit: "M/s", sourceIds: ["ar_1", "ar_2"] },
      renderStyle: {
        traceMode: "markers",
        traces: [{ target: "primary", marker: { symbol: "circle-open", color: "#222222", size: 7 } }],
      },
    }, observationImport());

    expect(preview.traces[0].mode).toBe("markers");
    expect(preview.traces[0].marker.symbol).toBe("circle-open");
    expect(preview.traces[0].marker.color).toBe("#222222");
    expect(preview.traces[0].marker.size).toBe(7);
  });

  it("uses nested ChartSpec draft style when previewing older interpreted proposals", () => {
    const preview = makeGenericChartPreview({
      proposalId: "legacy_interpreted_proposal",
      chartType: "scatter",
      title: "Adjusted rate vs reaction time",
      x: { label: "Reaction Time", unit: "min", sourceIds: ["rt_1", "rt_2"] },
      y: { label: "Adjusted Rate", unit: "M/s", sourceIds: ["ar_1", "ar_2"] },
      chartSpecDraft: {
        renderStyle: {
          traceMode: "markers",
          traces: [{ target: "primary", marker: { symbol: "circle-open" } }],
        },
      },
    }, observationImport());

    expect(preview.traces[0].mode).toBe("markers");
    expect(preview.traces[0].marker.symbol).toBe("circle-open");
  });

  it("normalizes transformed stacked bars per experiment", () => {
    const preview = makeGenericChartPreview({
      chartType: "stacked_bar",
      title: "Normalized selectivity",
      x: { label: "Experiment", sourceIds: ["label_1", "label_2"] },
      yFields: [
        { label: "Solid", sourceIds: ["solid_1", "solid_2"] },
        { label: "Liquid", sourceIds: ["liquid_1", "liquid_2"] },
        { label: "Gas", sourceIds: ["gas_1", "gas_2"] },
      ],
      transforms: [{ type: "normalize_sum_to_percent" }],
    }, familyImport());

    expect(preview.traces).toHaveLength(3);
    expect(preview.traces[0].y).toEqual([50, 25]);
    expect(preview.traces[1].y).toEqual([25, 25]);
    expect(preview.traces[2].y).toEqual([25, 50]);
    expect(preview.layout.barmode).toBe("stack");
  });

  it("renders distribution_bar as one trace per experiment with numeric C sorting", () => {
    const preview = makeGenericChartPreview({
      chartType: "distribution_bar",
      title: "C-number distribution",
      yFields: [
        { label: "C10", measurementComponent: "C10", componentOrder: 10, sourceIds: ["c10_1", "c10_2"] },
        { label: "C7", measurementComponent: "C7", componentOrder: 7, sourceIds: ["c7_1", "c7_2"] },
        { label: "C8", measurementComponent: "C8", componentOrder: 8, sourceIds: ["c8_1", "c8_2"] },
      ],
      transforms: [{ type: "pivot_longer" }, { type: "sort_components" }],
    }, familyImport());

    expect(preview.traces).toHaveLength(2);
    expect(preview.traces[0].name).toBe("Exp1");
    expect(preview.traces[0].x).toEqual(["C7", "C8", "C10"]);
    expect(preview.traces[0].y).toEqual([9, 20, 18]);
    expect(preview.layout.barmode).toBe("group");
  });
});
