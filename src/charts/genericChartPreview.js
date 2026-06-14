import { plotLayout } from "./chartLayout.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function indexGenericData(genericImports) {
  const measurements = new Map();
  const experiments = new Map();
  asArray(genericImports).forEach((genericImport) => {
    asArray(genericImport.experiments).forEach((experiment) => {
      if (experiment?.experimentId) experiments.set(experiment.experimentId, experiment);
    });
    asArray(genericImport.measurements).forEach((measurement) => {
      if (measurement?.measurementId) measurements.set(measurement.measurementId, measurement);
    });
  });
  return { measurements, experiments };
}

function groupNameFor(measurement, experiments) {
  const experiment = experiments.get(measurement.experimentId);
  return experiment?.name || measurement.experimentId || "Series";
}

function pairKey(measurement) {
  return `${measurement.experimentId || ""}|${measurement.rowIndex ?? ""}`;
}

function makeScatterTraces(proposal, genericImports) {
  const { measurements, experiments } = indexGenericData(genericImports);
  const xIds = new Set(asArray(proposal.x?.measurementIds));
  const yIds = new Set(asArray(proposal.y?.measurementIds));
  const xByKey = new Map();
  xIds.forEach((id) => {
    const measurement = measurements.get(id);
    if (measurement) xByKey.set(pairKey(measurement), measurement);
  });

  const groups = new Map();
  yIds.forEach((id) => {
    const yMeasurement = measurements.get(id);
    if (!yMeasurement) return;
    const xMeasurement = xByKey.get(pairKey(yMeasurement));
    const x = numericValue(xMeasurement?.value ?? xMeasurement?.rawValue);
    const y = numericValue(yMeasurement.value ?? yMeasurement.rawValue);
    if (x == null || y == null) return;
    const name = groupNameFor(yMeasurement, experiments);
    if (!groups.has(name)) groups.set(name, { x: [], y: [], text: [] });
    groups.get(name).x.push(x);
    groups.get(name).y.push(y);
    groups.get(name).text.push(name);
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

function makeBarTraces(proposal, genericImports) {
  const { measurements, experiments } = indexGenericData(genericImports);
  const xIds = new Set(asArray(proposal.x?.measurementIds));
  const yIds = new Set(asArray(proposal.y?.measurementIds));
  const xByKey = new Map();
  xIds.forEach((id) => {
    const measurement = measurements.get(id);
    if (measurement) xByKey.set(pairKey(measurement), measurement);
  });

  const x = [];
  const y = [];
  yIds.forEach((id) => {
    const yMeasurement = measurements.get(id);
    if (!yMeasurement) return;
    const xMeasurement = xByKey.get(pairKey(yMeasurement));
    const yValue = numericValue(yMeasurement.value ?? yMeasurement.rawValue);
    if (yValue == null) return;
    x.push(String(xMeasurement?.rawValue ?? xMeasurement?.value ?? groupNameFor(yMeasurement, experiments)));
    y.push(yValue);
  });

  return x.length ? [{
    type: "bar",
    name: proposal.y?.label || "Value",
    x,
    y,
    marker: { color: "#6aa9ff" },
  }] : [];
}

export function makeGenericChartPreview(proposal, genericImports) {
  const traces = proposal?.chartType === "bar"
    ? makeBarTraces(proposal, genericImports)
    : makeScatterTraces(proposal, genericImports);
  const xTitle = [proposal?.x?.label, proposal?.x?.unit ? `(${proposal.x.unit})` : ""].filter(Boolean).join(" ");
  const yTitle = [proposal?.y?.label, proposal?.y?.unit ? `(${proposal.y.unit})` : ""].filter(Boolean).join(" ");
  return {
    traces,
    layout: plotLayout({
      title: { text: proposal?.title || "Chart proposal", font: { size: 14 } },
      margin: { l: 48, r: 20, t: 44, b: 44 },
      height: 220,
      xaxis: { title: xTitle, zeroline: false, showgrid: false, linecolor: "#111", mirror: true, ticks: "outside" },
      yaxis: { title: yTitle, zeroline: false, gridcolor: "#e5e7eb", linecolor: "#111", mirror: true, ticks: "outside" },
      legend: { orientation: "h", y: 1.08, x: 0.5, xanchor: "center", yanchor: "bottom" },
    }),
  };
}
