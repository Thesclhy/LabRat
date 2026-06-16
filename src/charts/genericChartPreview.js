import { plotLayout } from "./chartLayout.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").trim().replace(/,/g, "").replace(/\s*%\s*$/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function indexGenericData(genericImports) {
  const measurements = new Map();
  const experiments = new Map();
  asArray(genericImports).forEach((genericImport) => {
    asArray(genericImport.experiments).forEach((experiment) => {
      if (experiment?.experimentId) experiments.set(experiment.experimentId, experiment);
    });
    const values = asArray(genericImport.fields).length ? asArray(genericImport.fields) : asArray(genericImport.measurements);
    values.forEach((measurement) => {
      if (measurement?.measurementId) measurements.set(measurement.measurementId, measurement);
      if (measurement?.fieldValueId) measurements.set(measurement.fieldValueId, measurement);
    });
  });
  return { measurements, experiments };
}

function normalizeIdList(value) {
  return new Set(asArray(value).map((item) => String(item || "").trim()).filter(Boolean));
}

function matchesChartView(measurement, chartView = {}) {
  const experimentId = measurement?.experimentId ? String(measurement.experimentId) : "";
  const selected = normalizeIdList(chartView.selectedExperimentIds);
  const excluded = normalizeIdList(chartView.excludedExperimentIds);
  if (selected.size && !selected.has(experimentId)) return false;
  if (excluded.size && excluded.has(experimentId)) return false;
  return true;
}

function groupNameFor(measurement, experiments) {
  const experiment = experiments.get(measurement.experimentId);
  return experiment?.name || measurement.experimentId || "Series";
}

function pairKey(measurement) {
  return `${measurement.experimentId || ""}|${measurement.rowIndex ?? ""}`;
}

function axisIds(axis) {
  return asArray(axis?.measurementIds).length ? asArray(axis.measurementIds) : asArray(axis?.sourceIds);
}

function yAxesFor(proposal) {
  return asArray(proposal?.yFields).length ? asArray(proposal.yFields) : [proposal?.y].filter(Boolean);
}

function renderChartType(type) {
  return type === "point" ? "scatter" : type;
}

function hasTransform(proposal, type) {
  return asArray(proposal?.transforms).some((transform) => transform?.type === type);
}

function componentSortValue(axis) {
  if (Number.isFinite(Number(axis?.componentOrder))) return Number(axis.componentOrder);
  const match = String(axis?.measurementComponent || axis?.label || axis?.field || "").match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function proposalSourceIds(proposal) {
  return [
    ...axisIds(proposal?.x),
    ...yAxesFor(proposal).flatMap((axis) => axisIds(axis)),
    ...axisIds(proposal?.groupBy),
  ].map((id) => String(id || "").trim()).filter(Boolean);
}

export function chartSpecToProposal(chartSpecOrProposal) {
  const value = chartSpecOrProposal || {};
  const spec = value.spec && typeof value.spec === "object" ? value.spec : value;
  return {
    ...spec,
    chartType: value.chartType || spec.chartType || "scatter",
    title: value.title || spec.title || "Chart",
    layout: value.layout || spec.layout || {},
    warnings: asArray(value.warnings).length ? asArray(value.warnings) : asArray(spec.warnings),
    sourceRefs: asArray(value.sourceRefs).length ? asArray(value.sourceRefs) : asArray(spec.sourceRefs),
    sourceImportIds: asArray(value.sourceImportIds).length ? asArray(value.sourceImportIds) : asArray(spec.sourceImportIds),
  };
}

export function experimentOptionsForChartSpec(chartSpecOrProposal, genericImports) {
  const proposal = chartSpecToProposal(chartSpecOrProposal);
  const { measurements, experiments } = indexGenericData(genericImports);
  const sourceIds = proposalSourceIds(proposal);
  const candidateMeasurements = sourceIds.length
    ? sourceIds.map((id) => measurements.get(id)).filter(Boolean)
    : [...measurements.values()];
  const options = new Map();
  candidateMeasurements.forEach((measurement) => {
    const experimentId = measurement?.experimentId ? String(measurement.experimentId) : "";
    if (!experimentId || options.has(experimentId)) return;
    const experiment = experiments.get(experimentId);
    options.set(experimentId, {
      id: experimentId,
      label: experiment?.name || experiment?.label || experimentId,
      detail: [experiment?.label, experiment?.date].filter(Boolean).join(" | "),
    });
  });
  return [...options.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: "base" }));
}

function makeScatterTraces(proposal, genericImports, chartView) {
  const { measurements, experiments } = indexGenericData(genericImports);
  const xIds = new Set(axisIds(proposal.x));
  const xByKey = new Map();
  xIds.forEach((id) => {
    const measurement = measurements.get(id);
    if (measurement) xByKey.set(pairKey(measurement), measurement);
  });

  const groups = new Map();
  yAxesFor(proposal).forEach((axis) => {
    axisIds(axis).forEach((id) => {
      const yMeasurement = measurements.get(id);
      if (!yMeasurement) return;
      if (!matchesChartView(yMeasurement, chartView)) return;
      const xMeasurement = xByKey.get(pairKey(yMeasurement));
      const x = numericValue(xMeasurement?.value ?? xMeasurement?.rawValue);
      const y = numericValue(yMeasurement.value ?? yMeasurement.rawValue);
      if (x == null || y == null) return;
      const baseName = groupNameFor(yMeasurement, experiments);
      const name = yAxesFor(proposal).length > 1 ? `${axis.label || axis.field} - ${baseName}` : baseName;
      if (!groups.has(name)) groups.set(name, { x: [], y: [], text: [] });
      groups.get(name).x.push(x);
      groups.get(name).y.push(y);
      groups.get(name).text.push(name);
    });
  });

  return [...groups.entries()].map(([name, values]) => ({
    type: "scatter",
    mode: values.x.length > 1 ? "lines+markers" : "markers",
    name,
    x: values.x,
    y: values.y,
    text: values.text,
    marker: { size: 8 },
  }));
}

function makeBarTraces(proposal, genericImports, chartView) {
  const { measurements, experiments } = indexGenericData(genericImports);
  const xIds = new Set(axisIds(proposal.x));
  const xByKey = new Map();
  xIds.forEach((id) => {
    const measurement = measurements.get(id);
    if (measurement) xByKey.set(pairKey(measurement), measurement);
  });

  const yAxes = yAxesFor(proposal);
  const normalize = hasTransform(proposal, "normalize_sum_to_percent") && yAxes.length > 1;
  const rowTotals = new Map();
  if (normalize) {
    yAxes.forEach((axis) => {
      axisIds(axis).forEach((id) => {
        const yMeasurement = measurements.get(id);
        if (!yMeasurement || !matchesChartView(yMeasurement, chartView)) return;
        const yValue = numericValue(yMeasurement.value ?? yMeasurement.rawValue);
        if (yValue == null || yValue < 0) return;
        const key = pairKey(yMeasurement);
        rowTotals.set(key, (rowTotals.get(key) || 0) + yValue);
      });
    });
  }

  return yAxes.map((axis, axisIndex) => {
    const x = [];
    const y = [];
    axisIds(axis).forEach((id) => {
      const yMeasurement = measurements.get(id);
      if (!yMeasurement) return;
      if (!matchesChartView(yMeasurement, chartView)) return;
      const xMeasurement = xByKey.get(pairKey(yMeasurement));
      const yValue = numericValue(yMeasurement.value ?? yMeasurement.rawValue);
      if (yValue == null) return;
      const total = rowTotals.get(pairKey(yMeasurement));
      x.push(String(xMeasurement?.rawValue ?? xMeasurement?.value ?? groupNameFor(yMeasurement, experiments)));
      y.push(normalize ? (total ? yValue / total * 100 : 0) : yValue);
    });
    return x.length ? {
      type: "bar",
      name: axis?.label || proposal.y?.label || `Value ${axisIndex + 1}`,
      x,
      y,
      marker: { color: ["#6aa9ff", "#5cc8a7", "#f5a25d", "#9b7df0"][axisIndex % 4] },
    } : null;
  }).filter(Boolean);
}

function makeDistributionTraces(proposal, genericImports, chartView) {
  const { measurements, experiments } = indexGenericData(genericImports);
  const yAxes = yAxesFor(proposal)
    .slice()
    .sort((a, b) => componentSortValue(a) - componentSortValue(b) || String(a.label || a.field).localeCompare(String(b.label || b.field)));
  const normalize = hasTransform(proposal, "normalize_sum_to_percent");
  const byExperiment = new Map();

  yAxes.forEach((axis) => {
    const component = axis.measurementComponent || axis.label || axis.field;
    axisIds(axis).forEach((id) => {
      const measurement = measurements.get(id);
      if (!measurement || !matchesChartView(measurement, chartView)) return;
      const value = numericValue(measurement.value ?? measurement.rawValue);
      if (value == null) return;
      const experimentId = measurement.experimentId || "unknown";
      if (!byExperiment.has(experimentId)) {
        byExperiment.set(experimentId, {
          name: groupNameFor(measurement, experiments),
          values: new Map(),
        });
      }
      byExperiment.get(experimentId).values.set(component, value);
    });
  });

  return [...byExperiment.values()].map((series, index) => {
    const raw = yAxes.map((axis) => series.values.get(axis.measurementComponent || axis.label || axis.field) ?? 0);
    const total = raw.reduce((sum, value) => sum + (value > 0 ? value : 0), 0);
    const y = normalize && total
      ? raw.map((value) => value > 0 ? value / total * 100 : 0)
      : raw;
    return {
      type: "bar",
      name: series.name,
      x: yAxes.map((axis) => axis.measurementComponent || axis.label || axis.field),
      y,
      marker: { color: ["#cf8b8b", "#99be93", "#98add0", "#c09ac4", "#d8bc83", "#9fc7c2", "#b5a8dc"][index % 7] },
    };
  });
}

export function makeGenericChartPreview(proposal, genericImports, options = {}) {
  proposal = chartSpecToProposal(proposal);
  const chartType = renderChartType(proposal?.chartType || "scatter");
  const chartView = options.chartView && typeof options.chartView === "object" ? options.chartView : {};
  const traces = chartType === "distribution_bar"
    ? makeDistributionTraces(proposal, genericImports, chartView)
    : chartType === "bar" || chartType === "grouped_bar" || chartType === "stacked_bar"
      ? makeBarTraces(proposal, genericImports, chartView)
      : makeScatterTraces(proposal, genericImports, chartView);
  const xTitle = chartType === "distribution_bar"
    ? "Carbon number"
    : [proposal?.x?.label, proposal?.x?.unit ? `(${proposal.x.unit})` : ""].filter(Boolean).join(" ");
  const yTitle = yAxesFor(proposal).length > 1
    ? (chartType === "distribution_bar" ? "Carbon Distribution (%)" : hasTransform(proposal, "normalize_sum_to_percent") ? "Percentage (%)" : "Value")
    : [proposal?.y?.label, proposal?.y?.unit ? `(${proposal.y.unit})` : ""].filter(Boolean).join(" ");
  return {
    traces,
    layout: plotLayout({
      title: { text: proposal?.title || "Chart proposal", font: { size: 14 } },
      margin: { l: 48, r: 20, t: 44, b: 44 },
      height: Number(options.height) || Number(proposal?.layout?.height) || 220,
      ...(Number(options.width) ? { width: Number(options.width) } : {}),
      ...(chartType === "stacked_bar" ? { barmode: "stack" } : {}),
      ...(chartType === "grouped_bar" || chartType === "distribution_bar" ? { barmode: "group" } : {}),
      xaxis: { title: xTitle, zeroline: false, showgrid: false, linecolor: "#111", mirror: true, ticks: "outside" },
      yaxis: { title: yTitle, zeroline: false, gridcolor: "#e5e7eb", linecolor: "#111", mirror: true, ticks: "outside" },
      legend: { orientation: "h", y: 1.08, x: 0.5, xanchor: "center", yanchor: "bottom" },
      ...(proposal?.layout && typeof proposal.layout === "object" ? proposal.layout : {}),
      ...(options.layout && typeof options.layout === "object" ? options.layout : {}),
    }),
    config: {
      displayModeBar: false,
      staticPlot: true,
      responsive: true,
      ...(options.config || {}),
    },
  };
}
