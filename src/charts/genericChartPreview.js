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
  const observationSets = new Map();
  asArray(genericImports).forEach((genericImport) => {
    asArray(genericImport.experiments).forEach((experiment) => {
      if (experiment?.experimentId) experiments.set(experiment.experimentId, experiment);
    });
    asArray(genericImport.observationSets).forEach((observationSet) => {
      if (!observationSet?.observationSetId) return;
      observationSets.set(observationSet.observationSetId, observationSet);
      const relatedId = asArray(observationSet.targetExperimentIds)[0] || asArray(genericImport.relatedExperimentIds)[0] || observationSet.observationSetId;
      if (!experiments.has(relatedId)) {
        experiments.set(relatedId, {
          experimentId: relatedId,
          label: observationSet.inferredExperimentLabel || relatedId,
          name: observationSet.inferredExperimentLabel || relatedId,
          observationSetId: observationSet.observationSetId,
        });
      }
    });
    const values = asArray(genericImport.fields).length ? asArray(genericImport.fields) : asArray(genericImport.measurements);
    values.forEach((measurement) => {
      if (measurement?.measurementId) measurements.set(measurement.measurementId, measurement);
      if (measurement?.fieldValueId) measurements.set(measurement.fieldValueId, measurement);
    });
  });
  return { measurements, experiments, observationSets };
}

function normalizeIdList(value) {
  return new Set(asArray(value).map((item) => String(item || "").trim()).filter(Boolean));
}

function matchesChartView(measurement, chartView = {}) {
  const experimentId = effectiveExperimentId(measurement);
  const selected = normalizeIdList(chartView.selectedExperimentIds);
  const excluded = normalizeIdList(chartView.excludedExperimentIds);
  if (selected.size && !selected.has(experimentId)) return false;
  if (excluded.size && excluded.has(experimentId)) return false;
  return true;
}

function effectiveExperimentId(measurement) {
  return String(asArray(measurement?.relatedExperimentIds)[0] || measurement?.experimentId || "").trim();
}

function groupNameFor(measurement, experiments, observationSets = new Map()) {
  const experimentId = effectiveExperimentId(measurement);
  const experiment = experiments.get(experimentId);
  const observationSet = observationSets.get(measurement?.observationSetId);
  return experiment?.name || experiment?.label || measurement?.inferredExperimentLabel || observationSet?.inferredExperimentLabel || experimentId || "Series";
}

function pairKey(measurement) {
  if (measurement?.observationId) return String(measurement.observationId);
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

function renderStyleFor(proposal) {
  const source = proposal?.renderStyle && typeof proposal.renderStyle === "object" ? proposal.renderStyle : {};
  const excelLike = source.preset === "excel_like";
  return {
    preset: excelLike ? "excel_like" : "default",
    traceMode: source.traceMode || (excelLike ? "lines+markers" : null),
    showLegend: source.showLegend,
    legendPosition: source.legendPosition || "top",
    grid: {
      x: source.grid?.x ?? excelLike,
      y: source.grid?.y ?? true,
      color: source.grid?.color || (excelLike ? "#d9d9d9" : "#e5e7eb"),
    },
    traces: asArray(source.traces),
  };
}

function traceStyleFor(style, index = 0) {
  const trace = style.traces[index] || style.traces.find((item) => item?.target === "primary") || {};
  const excelLike = style.preset === "excel_like";
  return {
    line: {
      ...(excelLike ? { color: "#4472C4", width: 2 } : {}),
      ...(trace.line && typeof trace.line === "object" ? trace.line : {}),
    },
    marker: {
      ...(excelLike ? { color: "#4472C4", size: 6, symbol: "circle" } : {}),
      ...(trace.marker && typeof trace.marker === "object" ? trace.marker : {}),
    },
    name: trace.name || null,
  };
}

function axisOption(proposal, axis) {
  return proposal?.axisOptions?.[axis] && typeof proposal.axisOptions[axis] === "object" ? proposal.axisOptions[axis] : {};
}

function axisLayout({ title, option, showgrid, gridcolor, defaultShowgrid }) {
  return {
    title: option.title || title,
    zeroline: false,
    showgrid: showgrid ?? defaultShowgrid,
    gridcolor,
    linecolor: "#111",
    mirror: true,
    ticks: "outside",
    ...(option.scale === "log10" ? { type: "log" } : {}),
    ...(Array.isArray(option.range) && option.range.length === 2 ? { range: option.range } : {}),
    ...(option.tickFormat ? { tickformat: option.tickFormat } : {}),
  };
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
  const baseSpec = value.spec && typeof value.spec === "object" ? value.spec : value;
  const draftSpec = value.chartSpecDraft && typeof value.chartSpecDraft === "object" ? value.chartSpecDraft : {};
  const spec = { ...draftSpec, ...baseSpec };
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
    const experimentId = effectiveExperimentId(measurement);
    if (!experimentId || options.has(experimentId)) return;
    const experiment = experiments.get(experimentId);
    const label = experiment?.name || experiment?.label || measurement?.inferredExperimentLabel || experimentId;
    options.set(experimentId, {
      id: experimentId,
      label,
      detail: [
        experiment?.label && experiment.label !== label ? experiment.label : null,
        experiment?.date,
      ].filter(Boolean).join(" | "),
    });
  });
  return [...options.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: "base" }));
}

function makeScatterTraces(proposal, genericImports, chartView, style) {
  const { measurements, experiments, observationSets } = indexGenericData(genericImports);
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
      const baseName = groupNameFor(yMeasurement, experiments, observationSets);
      const name = yAxesFor(proposal).length > 1 ? `${axis.label || axis.field} - ${baseName}` : baseName;
      if (!groups.has(name)) groups.set(name, { x: [], y: [], text: [] });
      groups.get(name).x.push(x);
      groups.get(name).y.push(y);
      groups.get(name).text.push(name);
    });
  });

  return [...groups.entries()].map(([name, values], index) => {
    const traceStyle = traceStyleFor(style, index);
    return {
      type: "scatter",
      mode: style.traceMode || (values.x.length > 1 ? "lines+markers" : "markers"),
      name: traceStyle.name || name,
      x: values.x,
      y: values.y,
      text: values.text,
      line: traceStyle.line,
      marker: { size: 8, ...traceStyle.marker },
    };
  });
}

function makeBarTraces(proposal, genericImports, chartView, style) {
  const { measurements, experiments, observationSets } = indexGenericData(genericImports);
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
    const traceStyle = traceStyleFor(style, axisIndex);
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
      x.push(String(xMeasurement?.rawValue ?? xMeasurement?.value ?? groupNameFor(yMeasurement, experiments, observationSets)));
      y.push(normalize ? (total ? yValue / total * 100 : 0) : yValue);
    });
    return x.length ? {
      type: "bar",
      name: traceStyle.name || axis?.label || proposal.y?.label || `Value ${axisIndex + 1}`,
      x,
      y,
      marker: { color: ["#6aa9ff", "#5cc8a7", "#f5a25d", "#9b7df0"][axisIndex % 4], ...traceStyle.marker },
    } : null;
  }).filter(Boolean);
}

function makeDistributionTraces(proposal, genericImports, chartView, style) {
  const { measurements, experiments, observationSets } = indexGenericData(genericImports);
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
      const experimentId = effectiveExperimentId(measurement) || "unknown";
      if (!byExperiment.has(experimentId)) {
        byExperiment.set(experimentId, {
          name: groupNameFor(measurement, experiments, observationSets),
          values: new Map(),
        });
      }
      byExperiment.get(experimentId).values.set(component, value);
    });
  });

  return [...byExperiment.values()].map((series, index) => {
    const traceStyle = traceStyleFor(style, index);
    const raw = yAxes.map((axis) => series.values.get(axis.measurementComponent || axis.label || axis.field) ?? 0);
    const total = raw.reduce((sum, value) => sum + (value > 0 ? value : 0), 0);
    const y = normalize && total
      ? raw.map((value) => value > 0 ? value / total * 100 : 0)
      : raw;
    return {
      type: "bar",
      name: traceStyle.name || series.name,
      x: yAxes.map((axis) => axis.measurementComponent || axis.label || axis.field),
      y,
      marker: { color: ["#cf8b8b", "#99be93", "#98add0", "#c09ac4", "#d8bc83", "#9fc7c2", "#b5a8dc"][index % 7], ...traceStyle.marker },
    };
  });
}

export function makeGenericChartPreview(proposal, genericImports, options = {}) {
  proposal = chartSpecToProposal(proposal);
  const chartType = renderChartType(proposal?.chartType || "scatter");
  const chartView = options.chartView && typeof options.chartView === "object" ? options.chartView : {};
  const style = renderStyleFor(proposal);
  const traces = chartType === "distribution_bar"
    ? makeDistributionTraces(proposal, genericImports, chartView, style)
    : chartType === "bar" || chartType === "grouped_bar" || chartType === "stacked_bar"
      ? makeBarTraces(proposal, genericImports, chartView, style)
      : makeScatterTraces(proposal, genericImports, chartView, style);
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
      xaxis: axisLayout({
        title: xTitle,
        option: axisOption(proposal, "x"),
        showgrid: style.grid.x,
        gridcolor: style.grid.color,
        defaultShowgrid: false,
      }),
      yaxis: axisLayout({
        title: yTitle,
        option: axisOption(proposal, "y"),
        showgrid: style.grid.y,
        gridcolor: style.grid.color,
        defaultShowgrid: true,
      }),
      showlegend: style.showLegend == null ? true : Boolean(style.showLegend),
      legend: style.legendPosition === "right"
        ? { orientation: "v", y: 1, x: 1.02, xanchor: "left", yanchor: "top" }
        : { orientation: "h", y: 1.08, x: 0.5, xanchor: "center", yanchor: "bottom" },
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
