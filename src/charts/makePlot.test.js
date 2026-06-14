import { describe, expect, it } from "vitest";
import { classifyRateExperiment, makePlot, normalizedSelectivity } from "./makePlot";

function makeRateSource(rows) {
  return {
    columns: ["Time (min)", "Reaction Rate (M/s)", "Standard Deviation"],
    rows,
  };
}

function makeExperiment(label, patch = {}) {
  return {
    label,
    selectivity_solid_pct: 25,
    selectivity_liquid_pct: 50,
    selectivity_gas_pct: 25,
    rate_sources: [],
    sources: [],
    sweep: null,
    ...patch,
  };
}

describe("makePlot chart rules", () => {
  it("classifies sweep experiments from structured signals", () => {
    expect(classifyRateExperiment(makeExperiment("Exp29", { sweep: { rows: [] } }))).toBe("sweep");
    expect(classifyRateExperiment(makeExperiment("Exp30", { sources: [{ kind: "sweep_gc", file: "Exp30 - Sweep.xlsx" }] }))).toBe("sweep");
    expect(classifyRateExperiment(makeExperiment("Exp9"))).toBe("nonsweep");
  });

  it("renders Exp29-like sweep rate data as scatter with log y-axis", () => {
    const experiment = makeExperiment("Exp29", {
      sweep: { runs: [] },
      sources: [{ kind: "sweep_gc", file: "Exp29 - Sweep.xlsx" }],
      rate_sources: [makeRateSource([
        [-3.5, 8.41e-4, 7.1e-6],
        [1.28, 1.53e-3, 3.11e-5],
      ])],
    });
    const plot = makePlot("rate", [experiment]);

    expect(plot.traces).toHaveLength(1);
    expect(plot.traces[0].type).toBe("scatter");
    expect(plot.traces[0].mode).toBe("markers");
    expect(plot.traces[0].x).toEqual([-3.5, 1.28]);
    expect(plot.traces[0].y).toEqual([8.41e-4, 1.53e-3]);
    expect(plot.traces[0].meta).toEqual({ rateMode: "sweep", sourceContract: "F/H" });
    expect(plot.layout.xaxis.title).toBe("Reaction Time (min)");
    expect(plot.layout.yaxis.title).toBe("Reaction Rate (M/s)");
    expect(plot.layout.yaxis.type).toBe("log");
  });

  it("renders Exp9-like non-sweep rate data as scatter with log y-axis", () => {
    const experiment = makeExperiment("Exp9", {
      rate_sources: [makeRateSource([
        [19.24, 1.52e-4, 1.5e-6],
        [28.89, 1.30e-4, 1.64e-6],
      ])],
    });
    const plot = makePlot("rate", [experiment]);

    expect(plot.traces).toHaveLength(1);
    expect(plot.traces[0].x).toEqual([19.24, 28.89]);
    expect(plot.traces[0].y).toEqual([1.52e-4, 1.30e-4]);
    expect(plot.traces[0].meta).toEqual({ rateMode: "nonsweep", sourceContract: "F/D" });
    expect(plot.layout.yaxis.type).toBe("log");
  });

  it("allows mixed sweep and non-sweep rate charts with a generic y-axis label", () => {
    const sweepExp = makeExperiment("Exp29", {
      sweep: { runs: [] },
      sources: [{ kind: "sweep_gc", file: "Exp29 - Sweep.xlsx" }],
      rate_sources: [makeRateSource([[1.28, 8.41e-4, 7.1e-6]])],
    });
    const nonsweepExp = makeExperiment("Exp9", {
      rate_sources: [makeRateSource([[19.24, 1.52e-4, 1.5e-6]])],
    });
    const plot = makePlot("rate", [sweepExp, nonsweepExp]);

    expect(plot.traces).toHaveLength(2);
    expect(plot.traces[0].meta.rateMode).toBe("sweep");
    expect(plot.traces[1].meta.rateMode).toBe("nonsweep");
    expect(plot.layout.yaxis.title).toBe("Reaction Rate (M/s)");
    expect(plot.layout.yaxis.exponentformat).toBe("e");
    expect(plot.layout.yaxis.showexponent).toBe("all");
  });

  it("preserves negative reaction-time points in rate charts", () => {
    const experiment = makeExperiment("Exp57", {
      sweep: { runs: [] },
      sources: [{ kind: "sweep_gc", file: "Exp57 - Sweep.xlsx" }],
      rate_sources: [makeRateSource([
        [-8.13, 8.94e-4, 2.2e-6],
        [1.88, 1.41e-3, 3.0e-5],
      ])],
    });
    const plot = makePlot("rate", [experiment]);

    expect(plot.traces[0].x[0]).toBe(-8.13);
    expect(plot.traces[0].x[1]).toBe(1.88);
  });

  it("normalizes selectivity to a 100 percent basis", () => {
    const normalized = normalizedSelectivity(makeExperiment("Exp1", {
      selectivity_solid_pct: 90.08,
      selectivity_liquid_pct: 1,
      selectivity_gas_pct: 6.25,
    }));
    const plot = makePlot("selectivity", [makeExperiment("Exp1", {
      selectivity_solid_pct: 90.08,
      selectivity_liquid_pct: 1,
      selectivity_gas_pct: 6.25,
    })]);

    const total = normalized.solid + normalized.liquid + normalized.gas;
    expect(total).toBeCloseTo(100, 6);
    expect(plot.traces.map((trace) => trace.y[0]).reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 6);
  });
});
