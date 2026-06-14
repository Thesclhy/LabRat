import { num } from "../utils/format.js";

export const defaultFontFamily = "Inter, Arial, sans-serif";

export function plotLayout(extra = {}) {
  return {
    paper_bgcolor: "#fff",
    plot_bgcolor: "#fff",
    margin: { l: 60, r: 30, t: 90, b: 60 },
    font: { family: defaultFontFamily, size: 12, color: "#1e293b" },
    xaxis: { zeroline: false, showgrid: false, linecolor: "#111", mirror: true, ticks: "outside" },
    yaxis: { zeroline: false, gridcolor: "#e5e7eb", linecolor: "#111", mirror: true, ticks: "outside" },
    legend: { orientation: "h", y: 1.08, x: 0.5, xanchor: "center", yanchor: "bottom", bgcolor: "rgba(255,255,255,.85)" },
    ...extra,
  };
}

function defaultAxisTitles(kind, opts = {}) {
  const x = opts.xLabel || (kind === "rate" ? "Reaction Time (min)" : kind === "distribution" ? "Carbon number" : "Experiment");
  const y = opts.yLabel || (kind === "rate" ? "Reaction Rate (M/s)" : kind === "distribution" ? "Carbon Distribution (%)" : "Percentage (%)");
  return { x, y };
}

export function defaultChartLayout(kind = "selectivity", opts = {}, block = {}) {
  const axis = defaultAxisTitles(kind, opts);
  const w = Math.max(260, block.w || 580);
  const h = Math.max(220, block.h || 380);
  const padding = Math.max(14, Math.min(24, Math.round(w * 0.04)));
  const titleHeight = 32;
  const legendHeight = 32;
  const xAxisTitleHeight = 28;
  const yAxisTitleWidth = 56;
  const titleY = 12;
  const legendY = titleY + titleHeight + 8;
  const plotX = padding + yAxisTitleWidth + 16;
  const plotY = legendY + legendHeight + 12;
  const bottomReserve = padding + xAxisTitleHeight + 8;
  const plotW = Math.max(180, w - plotX - padding);
  const plotH = Math.max(120, h - plotY - bottomReserve);
  return {
    title: {
      text: opts.title || `${kind} comparison`,
      visible: true,
      x: padding,
      y: titleY,
      width: Math.max(120, w - padding * 2),
      height: titleHeight,
      fontSize: 20,
      fontFamily: defaultFontFamily,
      align: "center",
    },
    legend: {
      visible: true,
      x: padding,
      y: legendY,
      width: Math.max(120, w - padding * 2),
      height: legendHeight,
      orientation: "h",
      fontSize: 14,
      fontFamily: defaultFontFamily,
    },
    plotArea: {
      x: plotX,
      y: plotY,
      width: plotW,
      height: plotH,
    },
    xAxisTitle: {
      title: axis.x,
      text: axis.x,
      visible: false,
      x: plotX,
      y: Math.min(h - xAxisTitleHeight - padding, plotY + plotH + 8),
      width: plotW,
      height: xAxisTitleHeight,
      fontSize: 14,
      fontFamily: defaultFontFamily,
      align: "center",
    },
    yAxisTitle: {
      title: axis.y,
      text: axis.y,
      visible: true,
      x: padding,
      y: plotY,
      width: yAxisTitleWidth,
      height: plotH,
      fontSize: 14,
      fontFamily: defaultFontFamily,
      rotation: -90,
      align: "center",
    },
    xAxis: {
      tickFontSize: 11,
      showGrid: false,
    },
    yAxis: {
      tickFontSize: 11,
      showGrid: true,
    },
    toolbar: {
      visible: false,
      mode: "hover",
    },
  };
}

export function defaultPlotAreaForLayout(block, chartLayout) {
  const base = defaultChartLayout(block.chartKind, block.opts, block);
  const titleBottom = chartLayout.title.visible ? chartLayout.title.y + chartLayout.title.height + 8 : 12;
  const legendBottom = chartLayout.legend.visible ? chartLayout.legend.y + chartLayout.legend.height + 12 : titleBottom;
  const top = Math.max(base.plotArea.y, titleBottom, legendBottom);
  const left = chartLayout.yAxisTitle.visible ? chartLayout.yAxisTitle.x + chartLayout.yAxisTitle.width + 16 : base.plotArea.x;
  const bottomReserve = chartLayout.xAxisTitle.visible ? (block.h - chartLayout.xAxisTitle.y + 8) : 60;
  return clampLayoutElement(block, {
    x: left,
    y: top,
    width: Math.max(180, (block.w || 580) - left - 24),
    height: Math.max(120, (block.h || 380) - top - bottomReserve),
  });
}

function normalizeLayoutElement(block, element, fallback) {
  return clampLayoutElement(block, migrateLegacyElementPosition(block, element, fallback));
}

function migrateLegacyElementPosition(block, element, fallback) {
  const merged = { ...fallback, ...(element || {}) };
  if (!element || element.width != null) return merged;
  const outerW = block?.w || 580;
  const outerH = block?.h || 380;
  const usesPaperX = typeof element.x === "number" && element.x >= -1 && element.x <= 1;
  const usesPaperY = typeof element.y === "number" && element.y >= -1.5 && element.y <= 1.5;
  if (usesPaperX) {
    const anchorOffset = element.xanchor === "center" ? merged.width / 2 : element.xanchor === "right" ? merged.width : 0;
    merged.x = Math.round(element.x * outerW - anchorOffset);
  }
  if (usesPaperY) {
    const anchorOffset = element.yanchor === "middle" ? merged.height / 2 : element.yanchor === "bottom" ? merged.height : 0;
    merged.y = Math.round((1 - element.y) * outerH - anchorOffset);
  }
  return merged;
}

export function resolveChartLayout(block) {
  const base = defaultChartLayout(block?.chartKind, block?.opts, block);
  const saved = block?.chartLayout || {};
  const legacyPlot = saved.plotArea
    ? (saved.plotArea.width == null && block?.chartBox ? block.chartBox : saved.plotArea)
    : block?.chartBox;
  const legacyXAxisTitle = saved.xAxisTitle || (saved.xAxis?.title ? { text: saved.xAxis.title } : {});
  const legacyYAxisTitle = saved.yAxisTitle || (saved.yAxis?.title ? { text: saved.yAxis.title } : {});
  return {
    title: normalizeLayoutElement(block, { ...(saved.title || {}), text: saved.title?.text ?? block?.opts?.title ?? base.title.text }, base.title),
    legend: normalizeLayoutElement(block, saved.legend, base.legend),
    plotArea: normalizeLayoutElement(block, legacyPlot, base.plotArea),
    xAxisTitle: normalizeLayoutElement(block, legacyXAxisTitle, base.xAxisTitle),
    yAxisTitle: normalizeLayoutElement(block, legacyYAxisTitle, base.yAxisTitle),
    xAxis: { ...base.xAxis, ...(saved.xAxis || {}) },
    yAxis: { ...base.yAxis, ...(saved.yAxis || {}) },
    toolbar: { ...base.toolbar, ...(saved.toolbar || {}) },
  };
}

export function patchChartLayout(block, section, patch) {
  const layout = resolveChartLayout(block);
  const nextSection = ["title", "legend", "plotArea", "xAxisTitle", "yAxisTitle"].includes(section)
    ? clampLayoutElement(block, { ...layout[section], ...patch })
    : { ...layout[section], ...patch };
  return { chartLayout: { ...layout, [section]: nextSection } };
}

const chartElementMinimums = {
  title: [60, 22],
  legend: [80, 24],
  plotArea: [160, 110],
  xAxisTitle: [60, 22],
  yAxisTitle: [40, 22],
};

export function scaleChartLayout(chartLayout, prevSize, nextSize) {
  const prevW = Math.max(1, prevSize?.width || 1);
  const prevH = Math.max(1, prevSize?.height || 1);
  const nextW = Math.max(1, nextSize?.width || prevW);
  const nextH = Math.max(1, nextSize?.height || prevH);
  const scaleX = nextW / prevW;
  const scaleY = nextH / prevH;
  const fontScale = Math.min(scaleX, scaleY);
  const block = { w: nextW, h: nextH };
  const scaleElement = (section, font = true) => {
    const [minWidth, minHeight] = chartElementMinimums[section] || [24, 18];
    return clampLayoutElement(block, scaleBox(chartLayout[section], scaleX, scaleY, font ? fontScale : null, minWidth, minHeight));
  };
  return {
    ...chartLayout,
    title: scaleElement("title"),
    legend: scaleElement("legend"),
    plotArea: scaleElement("plotArea", false),
    xAxisTitle: scaleElement("xAxisTitle"),
    yAxisTitle: scaleElement("yAxisTitle"),
    xAxis: scaleAxisFonts(chartLayout.xAxis, fontScale),
    yAxis: scaleAxisFonts(chartLayout.yAxis, fontScale),
  };
}

function scaleBox(box = {}, scaleX, scaleY, fontScale, minWidth, minHeight) {
  const next = {
    ...box,
    x: Math.round((num(box.x) ?? 0) * scaleX),
    y: Math.round((num(box.y) ?? 0) * scaleY),
    width: Math.max(minWidth, Math.round((num(box.width) ?? minWidth) * scaleX)),
    height: Math.max(minHeight, Math.round((num(box.height) ?? minHeight) * scaleY)),
  };
  if (fontScale && box.fontSize != null) {
    next.fontSize = clampFontSize((num(box.fontSize) ?? 12) * fontScale);
  }
  return next;
}

function scaleAxisFonts(axis = {}, fontScale) {
  const next = { ...axis };
  if (next.tickFontSize != null) next.tickFontSize = clampFontSize((num(next.tickFontSize) ?? 11) * fontScale);
  if (next.titleFontSize != null) next.titleFontSize = clampFontSize((num(next.titleFontSize) ?? 12) * fontScale);
  return next;
}

function clampFontSize(value) {
  return Math.min(36, Math.max(8, Math.round(value)));
}

export function applyChartLayout(plot, chartLayout) {
  const l = chartLayout;
  const xaxis = plot.layout?.xaxis || {};
  const yaxis = plot.layout?.yaxis || {};
  return {
    ...plot,
    layout: {
      ...plot.layout,
      title: undefined,
      showlegend: false,
      margin: { l: 54, r: 18, t: 14, b: 42 },
      xaxis: {
        ...xaxis,
        showgrid: l.xAxis.showGrid,
        title: { text: "" },
        tickfont: { size: l.xAxis.tickFontSize },
      },
      yaxis: {
        ...yaxis,
        showgrid: l.yAxis.showGrid,
        title: { text: "" },
        tickfont: { size: l.yAxis.tickFontSize },
      },
    },
    config: {
      ...(plot.config || {}),
      ...plotlyConfigFromLayout(l),
    },
  };
}

function clampLayoutElement(block, element) {
  const outerW = Math.max(160, block?.w || 580);
  const outerH = Math.max(90, block?.h || 380);
  const minW = element?.minWidth || 24;
  const minH = element?.minHeight || 18;
  const width = Math.min(Math.max(minW, num(element.width) ?? minW), outerW);
  const height = Math.min(Math.max(minH, num(element.height) ?? minH), outerH);
  const x = Math.min(Math.max(0, num(element.x) ?? 0), Math.max(0, outerW - width));
  const y = Math.min(Math.max(0, num(element.y) ?? 0), Math.max(0, outerH - height));
  return { ...element, x, y, width, height };
}

function plotlyConfigFromLayout(chartLayout) {
  const showToolbar = chartLayout.toolbar.visible && chartLayout.toolbar.mode !== "hidden";
  return {
    responsive: true,
    displayModeBar: showToolbar ? (chartLayout.toolbar.mode === "always" ? true : "hover") : false,
    displaylogo: false,
    modeBarButtonsToRemove: [
      "zoom2d",
      "pan2d",
      "select2d",
      "lasso2d",
      "zoomIn2d",
      "zoomOut2d",
      "autoScale2d",
      "resetScale2d",
      "hoverClosestCartesian",
      "hoverCompareCartesian",
      "toggleSpikelines",
      "sendDataToCloud",
    ],
  };
}
