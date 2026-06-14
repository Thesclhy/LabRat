import { COLORS } from "./constants.js";
import { applyChartLayout, plotLayout } from "./chartLayout.js";
import { num } from "../utils/format.js";

function carbonNumberSortValue(d) {
  const source = typeof d === "object" ? d.n ?? d.carbon_number : d;
  const n = Number(source);
  if (Number.isFinite(n)) return n;
  const m = String(source || "").match(/\d+/);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
}

function carbonDistributionPct(d) {
  return num(d?.pct) ?? num(d?.fraction_pct) ?? 0;
}

function positivePct(value) {
  const n = num(value);
  return n != null && n > 0 ? n : 0;
}

export function normalizedSelectivity(e) {
  const solid = positivePct(e.selectivity_solid_pct);
  const liquid = positivePct(e.selectivity_liquid_pct);
  const gas = positivePct(e.selectivity_gas_pct);
  const total = solid + liquid + gas;
  if (!total) return { solid: 0, liquid: 0, gas: 0 };
  return {
    solid: solid / total * 100,
    liquid: liquid / total * 100,
    gas: gas / total * 100,
  };
}

export function classifyRateExperiment(experiment) {
  if (experiment?.sweep) return "sweep";
  if (Array.isArray(experiment?.sources) && experiment.sources.some((source) => source?.kind === "sweep_gc")) return "sweep";
  return "nonsweep";
}

function canonicalRateIndices(rateSource) {
  const columns = Array.isArray(rateSource?.columns) ? rateSource.columns : [];
  const timeIndex = columns.findIndex((column) => /time/i.test(column));
  const rateIndex = columns.findIndex((column) => /(reaction )?rate/i.test(column));
  return { timeIndex, rateIndex };
}

export function makePlot(kind, experiments, opts = {}, chartLayout = null) {
  const labels = experiments.map((e) => opts.seriesLabels?.[e.label] || e.label);
  const traceLabel = (key, fallback) => {
    const custom = opts.traceLabels?.[key];
    return custom?.trim() || fallback;
  };
  const finish = (plot) => chartLayout ? applyChartLayout(plot, chartLayout) : plot;
  if (kind === "conversion") {
    return finish({
      traces: [{ x: labels, y: experiments.map((e) => e.conversion_pct), name: traceLabel("conversion", "Conversion"), type: "bar", marker: { color: COLORS.conversion } }],
      layout: plotLayout({ yaxis: { ...plotLayout().yaxis, title: opts.yLabel || "Percentage (%)" } }),
    });
  }
  if (kind === "cbalance") {
    const values = experiments.map((e) => e.carbon_balance_pct);
    const yMax = Math.max(100, 95, ...values.filter((value) => Number.isFinite(value)));
    return finish({
      traces: [{
        x: labels,
        y: values,
        name: traceLabel("cbalance", "Carbon balance"),
        type: "bar",
        marker: { color: values.map((value) => value >= 95 ? COLORS.cbalancePass : COLORS.cbalanceFail) },
      }],
      layout: plotLayout({
        shapes: [{
          type: "line",
          xref: "paper",
          x0: 0,
          x1: 1,
          yref: "y",
          y0: 95,
          y1: 95,
          line: { color: COLORS.cbalanceThreshold, width: 2, dash: "dash" },
        }],
        yaxis: { ...plotLayout().yaxis, title: opts.yLabel || "Percentage (%)", range: [0, Math.ceil(yMax)] },
      }),
    });
  }
  if (kind === "rate") {
    const traces = experiments.flatMap((e, i) => {
      const src = e.rate_sources?.[0];
      if (!src) return [];
      const rateMode = classifyRateExperiment(e);
      const { timeIndex, rateIndex } = canonicalRateIndices(src);
      if (timeIndex < 0 || rateIndex < 0) return [];
      const x = [];
      const y = [];
      src.rows.forEach((r) => {
        if (r[timeIndex] != null && r[rateIndex] != null && r[rateIndex] >= 1e-10) {
          x.push(r[timeIndex]);
          y.push(r[rateIndex]);
        }
      });
      return [{
        x, y, name: traceLabel(e.label, labels[i]), type: "scatter", mode: "markers",
        meta: { rateMode, sourceContract: rateMode === "sweep" ? "F/H" : "F/D" },
        marker: { color: COLORS.pastel[i % COLORS.pastel.length], symbol: "circle-open", size: 9, line: { width: 2 } },
      }];
    });
    return finish({
      traces,
      layout: plotLayout({
        xaxis: { ...plotLayout().xaxis, title: opts.xLabel || "Reaction Time (min)", dtick: 60 },
        yaxis: {
          ...plotLayout().yaxis,
          title: opts.yLabel || "Reaction Rate (M/s)",
          type: "log",
          exponentformat: "e",
          showexponent: "all",
        },
      }),
    });
  }
  if (kind === "distribution") {
    const allC = [...new Set(experiments.flatMap((e) => (e.calculation?.liquid_carbon_distribution || []).map((d) => d.carbon_number)))]
      .sort((a, b) => carbonNumberSortValue(a) - carbonNumberSortValue(b));
    return finish({
      traces: experiments.map((e, i) => {
        const map = new Map((e.calculation?.liquid_carbon_distribution || []).map((d) => [d.carbon_number, carbonDistributionPct(d)]));
        return { x: allC, y: allC.map((c) => map.get(c) || 0), name: traceLabel(e.label, labels[i]), type: "bar", marker: { color: COLORS.pastel[i % COLORS.pastel.length] } };
      }),
      layout: plotLayout({
        barmode: "group",
        xaxis: { ...plotLayout().xaxis, title: opts.xLabel || "Carbon number" },
        yaxis: { ...plotLayout().yaxis, title: opts.yLabel || "Carbon Distribution (%)" },
      }),
    });
  }
  const selectivity = experiments.map(normalizedSelectivity);
  return finish({
    traces: [
      { x: labels, y: selectivity.map((e) => e.solid), name: traceLabel("solid", "Solid"), type: "bar", marker: { color: COLORS.solid } },
      { x: labels, y: selectivity.map((e) => e.liquid), name: traceLabel("liquid", "Liquid"), type: "bar", marker: { color: COLORS.liquid } },
      { x: labels, y: selectivity.map((e) => e.gas), name: traceLabel("gas", "Gas"), type: "bar", marker: { color: COLORS.gas } },
    ],
    layout: plotLayout({
      barmode: "stack",
      yaxis: { ...plotLayout().yaxis, title: opts.yLabel || "Percentage (%)" },
    }),
  });
}
