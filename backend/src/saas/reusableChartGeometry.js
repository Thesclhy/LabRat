import { buildChartStyleProfileVersion } from "./reusableChartTemplates.js";

export const RESOLVED_CHART_GEOMETRY_SCHEMA_VERSION = "labrat.resolvedChartGeometry.v1";

const MARKER_SYMBOLS = ["circle", "square", "diamond", "cross", "triangle-up", "triangle-down"];
const LINE_DASHES = ["solid", "dash", "dot", "dashdot", "longdash", "longdashdot"];
const BAR_PATTERNS = ["", "/", "\\", "x", ".", "-"];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function geometryError(code, message, details = undefined) {
  throw Object.assign(new Error(message), {
    code,
    statusCode: 422,
    ...(details === undefined ? {} : { details }),
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function rounded(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function wrapText(value, charactersPerLine) {
  const source = text(value);
  if (!source || source.length <= charactersPerLine) return { text: source, lineCount: 1 };
  const words = source.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= charactersPerLine) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return { text: lines.join("<br>"), lineCount: Math.max(lines.length, 1) };
}

function style(styleVersion) {
  return buildChartStyleProfileVersion({ definition: styleVersion || {}, version: 1 });
}

export function allocateSelectionOrderStyles({ styleVersion = null, itemCount = 0 } = {}) {
  const resolvedStyle = style(styleVersion);
  const palette = resolvedStyle.palette.colors;
  const count = Math.max(Number(itemCount) || 0, 0);
  if (resolvedStyle.palette.assignment !== "selection_order") {
    geometryError(
      "chart_template_style_assignment_unsupported",
      "This renderer requires selection-order style assignment until a reviewed project mapping is available.",
    );
  }
  if (resolvedStyle.palette.overflow === "block" && count > palette.length) {
    geometryError(
      "chart_template_palette_exhausted",
      `The accepted palette distinguishes ${palette.length} series but this chart requires ${count}.`,
      { paletteSize: palette.length, requiredStyleCount: count },
    );
  }
  const variantCapacity = Math.min(MARKER_SYMBOLS.length, LINE_DASHES.length, BAR_PATTERNS.length);
  if (count > palette.length * variantCapacity) {
    geometryError(
      "chart_template_palette_exhausted",
      "The accepted palette and marker/dash overflow policy cannot keep every series distinguishable.",
      { paletteSize: palette.length, requiredStyleCount: count, supportedStyleCount: palette.length * variantCapacity },
    );
  }
  return Array.from({ length: count }, (_, index) => {
    const variant = Math.floor(index / palette.length);
    return {
      index,
      color: palette[index % palette.length],
      markerSymbol: MARKER_SYMBOLS[variant],
      lineDash: LINE_DASHES[variant],
      barPattern: BAR_PATTERNS[variant],
    };
  });
}

function legendLayout(position, { wrapped = false } = {}) {
  if (position === "bottom") {
    return { orientation: "h", x: 0.5, xanchor: "center", y: -0.2, yanchor: "top" };
  }
  if (position === "top") {
    return { orientation: "h", x: 0.5, xanchor: "center", y: 1.12, yanchor: "bottom" };
  }
  if (position === "left") {
    return { orientation: "v", x: -0.02, xanchor: "right", y: 1, yanchor: "top" };
  }
  if (position === "inside") {
    return { orientation: "v", x: 0.98, xanchor: "right", y: 0.98, yanchor: "top", bgcolor: "rgba(255,255,255,0.85)" };
  }
  return { orientation: wrapped ? "h" : "v", x: 1.02, xanchor: "left", y: 1, yanchor: "top" };
}

function marginDemand({
  position,
  preferred,
  maximum,
  legendLabels,
  legendSizePt,
  allowWrapping,
  width,
  longestXLabel,
  longLabelThreshold,
  tickSizePt,
  titleLineCount,
}) {
  const margin = { ...preferred };
  margin.top = clamp(preferred.top + Math.max(titleLineCount - 1, 0) * 22, preferred.top, maximum.top);
  const longLabelExtra = longestXLabel > longLabelThreshold
    ? Math.ceil((longestXLabel - longLabelThreshold) * tickSizePt * 0.42)
    : 0;
  margin.bottom = clamp(preferred.bottom + longLabelExtra, preferred.bottom, maximum.bottom);
  let wrapped = false;
  let legendRows = legendLabels.length ? 1 : 0;
  if (legendLabels.length && ["right", "left"].includes(position)) {
    const longestLegend = Math.max(...legendLabels.map((label) => label.length), 0);
    const demand = Math.ceil(longestLegend * legendSizePt * 0.62 + 42);
    const side = position === "right" ? "right" : "left";
    margin[side] = clamp(Math.max(preferred[side], demand), preferred[side], maximum[side]);
  } else if (legendLabels.length && ["bottom", "top"].includes(position)) {
    const totalDemand = legendLabels.reduce((sum, label) => sum + label.length * legendSizePt * 0.62 + 44, 0);
    legendRows = allowWrapping ? Math.max(1, Math.ceil(totalDemand / Math.max(width * 0.86, 1))) : 1;
    wrapped = legendRows > 1;
    const demand = Math.ceil(legendRows * legendSizePt * 1.8 + 24);
    const side = position === "bottom" ? "bottom" : "top";
    margin[side] = clamp(Math.max(margin[side], demand), margin[side], maximum[side]);
  }
  return { margin, wrapped, legendRows };
}

function facetGrid(experimentCount, policy) {
  const maxColumns = clamp(Number(policy?.maxColumns) || 3, 1, 6);
  const columns = Math.min(Math.max(Math.ceil(Math.sqrt(experimentCount)), 1), maxColumns, experimentCount);
  return { columns, rows: Math.ceil(experimentCount / columns) };
}

function facetAxes({ rows, columns, experimentLabels, sharedAxes }) {
  const layout = {};
  const refs = [];
  const annotations = [];
  const horizontalGap = columns > 1 ? Math.min(0.06, 0.16 / columns) : 0;
  const verticalGap = rows > 1 ? Math.min(0.1, 0.2 / rows) : 0;
  const domainWidth = (1 - horizontalGap * (columns - 1)) / columns;
  const domainHeight = (1 - verticalGap * (rows - 1)) / rows;
  experimentLabels.forEach((label, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x0 = column * (domainWidth + horizontalGap);
    const x1 = x0 + domainWidth;
    const y1 = 1 - row * (domainHeight + verticalGap);
    const y0 = y1 - domainHeight;
    const suffix = index === 0 ? "" : String(index + 1);
    const xaxisKey = `xaxis${suffix}`;
    const yaxisKey = `yaxis${suffix}`;
    layout[xaxisKey] = {
      domain: [rounded(x0), rounded(x1)],
      anchor: `y${suffix}`,
      ...(row === rows - 1 ? { title: { text: "Experiment" } } : {}),
    };
    layout[yaxisKey] = {
      domain: [rounded(y0), rounded(y1)],
      anchor: `x${suffix}`,
      ...(sharedAxes && index > 0 ? { matches: "y" } : {}),
    };
    refs.push({ xaxis: `x${suffix}`, yaxis: `y${suffix}` });
    annotations.push({
      text: text(label),
      x: rounded((x0 + x1) / 2),
      y: rounded(Math.min(y1 + 0.025, 1.08)),
      xref: "paper",
      yref: "paper",
      xanchor: "center",
      yanchor: "bottom",
      showarrow: false,
    });
  });
  return { layout, refs, annotations };
}

export function resolveReusableChartGeometry({
  styleVersion = null,
  templateVersion = null,
  comparisonMode,
  chartType,
  title,
  experimentLabels = [],
  legendLabels = [],
  showLegend = false,
  styleAssignments = [],
} = {}) {
  const resolvedStyle = style(styleVersion);
  const policy = templateVersion?.geometryPolicy || {};
  const labels = asArray(experimentLabels).map(text);
  const legends = showLegend ? asArray(legendLabels).map(text) : [];
  const longestXLabel = Math.max(...labels.map((label) => label.length), 0);
  const wrappedTitle = wrapText(title, Math.max(28, Math.floor(resolvedStyle.figure.preferredWidthPx / 18)));
  const facet = comparisonMode === "faceted"
    ? facetGrid(labels.length, policy.facet)
    : null;
  let width = resolvedStyle.figure.preferredWidthPx;
  let height = resolvedStyle.figure.preferredHeightPx;
  if (facet) {
    const panelWidthPx = clamp(Number(policy.facet?.panelWidthPx) || 420, 240, 2000);
    const panelHeightPx = clamp(Number(policy.facet?.panelHeightPx) || 320, 180, 1600);
    if (policy.facet?.allowFigureGrowth !== false) {
      width = Math.max(width, facet.columns * panelWidthPx + resolvedStyle.geometry.preferredMarginsPx.left + resolvedStyle.geometry.preferredMarginsPx.right);
      height = Math.max(height, facet.rows * panelHeightPx + resolvedStyle.geometry.preferredMarginsPx.top + resolvedStyle.geometry.preferredMarginsPx.bottom);
    }
    if (width > 8000 || height > 8000) {
      geometryError("chart_template_geometry_unreadable", "The accepted facet policy requires a figure larger than the supported maximum.", {
        widthPx: width,
        heightPx: height,
      });
    }
  }

  const positions = [
    resolvedStyle.legend.preferredPosition,
    ...resolvedStyle.legend.fallbackPositions,
  ].filter((position, index, values) => values.indexOf(position) === index);
  const candidates = legends.length ? positions : ["inside"];
  let selected = null;
  for (const position of candidates) {
    const demand = marginDemand({
      position,
      preferred: resolvedStyle.geometry.preferredMarginsPx,
      maximum: resolvedStyle.geometry.maximumMarginsPx,
      legendLabels: legends,
      legendSizePt: resolvedStyle.typography.legendSizePt,
      allowWrapping: resolvedStyle.legend.allowWrapping,
      width,
      longestXLabel,
      longLabelThreshold: Number(policy.longLabelThreshold) || 12,
      tickSizePt: resolvedStyle.typography.tickSizePt,
      titleLineCount: wrappedTitle.lineCount,
    });
    const widthRatio = (width - demand.margin.left - demand.margin.right) / width;
    const heightRatio = (height - demand.margin.top - demand.margin.bottom) / height;
    const candidate = { position, ...demand, widthRatio, heightRatio };
    if (
      widthRatio >= resolvedStyle.geometry.preferredPlotAreaWidthRatio
      && heightRatio >= resolvedStyle.geometry.preferredPlotAreaHeightRatio
    ) {
      selected = candidate;
      break;
    }
    if (!selected && widthRatio >= resolvedStyle.geometry.minimumPlotAreaWidthRatio && heightRatio >= resolvedStyle.geometry.minimumPlotAreaHeightRatio) {
      selected = candidate;
    }
  }
  if (!selected) {
    geometryError(
      "chart_template_geometry_unreadable",
      "Titles, labels, or legend demand would shrink the chart below its accepted minimum plot area.",
      {
        minimumPlotAreaWidthRatio: resolvedStyle.geometry.minimumPlotAreaWidthRatio,
        minimumPlotAreaHeightRatio: resolvedStyle.geometry.minimumPlotAreaHeightRatio,
      },
    );
  }

  const tickAngle = longestXLabel > (Number(policy.longLabelThreshold) || 12) ? -35 : 0;
  const facetPolicy = facet ? {
    ...facet,
    panelWidthPx: clamp(Number(policy.facet?.panelWidthPx) || 420, 240, 2000),
    panelHeightPx: clamp(Number(policy.facet?.panelHeightPx) || 320, 180, 1600),
    sharedAxes: policy.facet?.sharedAxes !== false,
  } : null;
  const facetLayout = facetPolicy
    ? facetAxes({ ...facetPolicy, experimentLabels: labels })
    : null;
  const resolvedGeometry = {
    schemaVersion: RESOLVED_CHART_GEOMETRY_SCHEMA_VERSION,
    comparisonMode,
    chartType,
    figure: {
      widthPx: Math.round(width),
      heightPx: Math.round(height),
      aspectRatio: rounded(width / height),
    },
    marginsPx: {
      top: selected.margin.top,
      right: selected.margin.right,
      bottom: selected.margin.bottom,
      left: selected.margin.left,
    },
    plotArea: {
      widthRatio: rounded(selected.widthRatio),
      heightRatio: rounded(selected.heightRatio),
      preferredWidthRatio: resolvedStyle.geometry.preferredPlotAreaWidthRatio,
      preferredHeightRatio: resolvedStyle.geometry.preferredPlotAreaHeightRatio,
      minimumWidthRatio: resolvedStyle.geometry.minimumPlotAreaWidthRatio,
      minimumHeightRatio: resolvedStyle.geometry.minimumPlotAreaHeightRatio,
    },
    legend: {
      visible: legends.length > 0,
      position: selected.position,
      orientation: legendLayout(selected.position, selected).orientation,
      wrapped: selected.wrapped,
      rowCount: selected.legendRows,
    },
    labels: {
      longestExperimentLabelCharacters: longestXLabel,
      xTickAngle: tickAngle,
      titleLineCount: wrappedTitle.lineCount,
    },
    facets: facetPolicy,
    styleAssignments: asArray(styleAssignments).slice(0, 64).map((assignment) => ({
      traceId: text(assignment.traceId),
      color: assignment.color,
      markerSymbol: assignment.markerSymbol,
      lineDash: assignment.lineDash,
      barPattern: assignment.barPattern,
    })),
  };
  return {
    layout: {
      width: resolvedGeometry.figure.widthPx,
      height: resolvedGeometry.figure.heightPx,
      margin: {
        t: resolvedGeometry.marginsPx.top,
        r: resolvedGeometry.marginsPx.right,
        b: resolvedGeometry.marginsPx.bottom,
        l: resolvedGeometry.marginsPx.left,
      },
      title: { text: wrappedTitle.text, font: { size: resolvedStyle.typography.titleSizePt } },
      font: { family: resolvedStyle.typography.fontFamily, size: resolvedStyle.typography.tickSizePt },
      legend: {
        ...legendLayout(selected.position, selected),
        font: { size: resolvedStyle.typography.legendSizePt },
      },
      ...(facetLayout ? { ...facetLayout.layout, annotations: facetLayout.annotations } : {}),
    },
    facetRefs: facetLayout?.refs || [],
    tickAngle,
    resolvedStyle,
    resolvedGeometry,
  };
}
