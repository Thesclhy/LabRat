import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { applyChartLayout, resolveChartLayout, defaultFontFamily } from "../charts/chartLayout.js";
import { chartSpecToProposal, makeGenericChartPreview } from "../charts/genericChartPreview.js";
import { defineLabRatDefaultSlideMasters, LABRAT_FIGURE_MASTER } from "./pptxTemplate.js";

const SLIDE_WIDTH_IN = 13.333333;
const TEXT_PADDING_PX = 16;
const DEFAULT_TEXT_COLOR = "1E293B";
const DEFAULT_TEMPLATE_URL = `${import.meta.env?.BASE_URL || ""}pptx/labrat-default-template.pptx`;
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

let plotlyLoader = null;

function loadPlotly() {
  plotlyLoader ||= import("plotly.js-dist-min").then((mod) => mod.default || mod);
  return plotlyLoader;
}

export async function exportManuscriptPagesToPptx({ pages, blocks, experiments, genericImports = [], chartSpecs = [], startPage, endPage, filename = "labrat-manuscript-pages.pptx" }) {
  const buffer = await buildManuscriptPagesPptxBuffer({ pages, blocks, experiments, genericImports, chartSpecs, startPage, endPage });
  savePptxBuffer(buffer, filename);
}

export async function buildManuscriptPagesPptxBuffer({ pages, blocks, experiments, genericImports = [], chartSpecs = [], startPage, endPage }) {
  const { pptx, slideWidth, slideHeight } = await buildManuscriptPresentation({ pages, blocks, experiments, genericImports, chartSpecs, startPage, endPage });
  const generatedBuffer = await pptx.write({ outputType: "arraybuffer", compression: true });
  try {
    return await applyDefaultTemplateToGeneratedDeck(generatedBuffer, { slideWidth, slideHeight });
  } catch (err) {
    console.warn("LabRat PowerPoint export could not apply the default slide template; using generated fallback deck.", err);
    return generatedBuffer;
  }
}

async function buildManuscriptPresentation({ pages, blocks, experiments, genericImports = [], chartSpecs = [], startPage, endPage }) {
  const selectedPages = selectedPageRange(pages, startPage, endPage);
  if (!selectedPages.length) throw new Error("Select at least one manuscript page to export.");

  const firstPage = selectedPages[0];
  const slideWidth = SLIDE_WIDTH_IN;
  const slideHeight = slideWidth * ((firstPage.height || 900) / Math.max(1, firstPage.width || 1600));
  const scale = slideWidth / Math.max(1, firstPage.width || 1600);
  const pptx = new PptxGenJS();
  pptx.author = "LabRat";
  pptx.subject = "LabRat manuscript export";
  pptx.title = "LabRat manuscript export";
  pptx.company = "LabRat";
  pptx.lang = "en-US";
  pptx.defineLayout({ name: "LABRAT_MANUSCRIPT", width: slideWidth, height: slideHeight });
  pptx.layout = "LABRAT_MANUSCRIPT";
  defineLabRatDefaultSlideMasters(pptx);

  for (const page of selectedPages) {
    const slide = pptx.addSlide({ masterName: LABRAT_FIGURE_MASTER });
    slide.background = { color: "FFFFFF" };
    const pageBlocks = (Array.isArray(blocks) ? blocks : [])
      .filter((block) => blockIntersectsPage(block, page))
      .sort((a, b) => (a.y || 0) - (b.y || 0));

    for (const block of pageBlocks) {
      const box = blockBoxOnPage(block, page, scale);
      validateBox(box, slideWidth, slideHeight);
      if (block.kind === "text") {
        addTextBlock(slide, box, block);
      } else if (block.kind === "image" && block.dataUrl) {
        slide.addImage({ data: block.dataUrl, ...box, sizingCrop: false });
      } else if (block.kind === "chart") {
        await addChartBlock(slide, box, block, genericImports, chartSpecs);
      }
    }
  }

  return { pptx, slideWidth, slideHeight };
}

function selectedPageRange(pages, startPage, endPage) {
  const safePages = Array.isArray(pages) ? pages : [];
  const first = Math.max(1, Number(startPage) || 1);
  const last = Math.max(first, Number(endPage) || first);
  return safePages.slice(first - 1, last);
}

async function applyDefaultTemplateToGeneratedDeck(generatedBuffer, { slideWidth, slideHeight }) {
  if (!isWideTemplateCompatible(slideWidth, slideHeight)) {
    throw new Error("Default PowerPoint template is 16:9 and cannot be applied to this manuscript orientation.");
  }
  const [generatedZip, templateZip] = await Promise.all([
    JSZip.loadAsync(generatedBuffer),
    loadDefaultTemplateZip(),
  ]);
  const figureLayoutIndex = await findSlideLayoutIndexByName(templateZip, LABRAT_FIGURE_MASTER);
  if (!figureLayoutIndex) throw new Error(`Default PowerPoint template is missing the "${LABRAT_FIGURE_MASTER}" layout.`);

  await copyTemplateParts(templateZip, generatedZip, [
    /^ppt\/slideMasters\/.*\.xml$/,
    /^ppt\/slideMasters\/_rels\/.*\.xml\.rels$/,
    /^ppt\/slideLayouts\/.*\.xml$/,
    /^ppt\/slideLayouts\/_rels\/.*\.xml\.rels$/,
    /^ppt\/theme\/.*\.xml$/,
    /^ppt\/theme\/_rels\/.*\.xml\.rels$/,
    /^ppt\/tableStyles\.xml$/,
  ]);
  await rebindSlidesToTemplateLayout(generatedZip, figureLayoutIndex);
  await assertPptxPackageLinks(generatedZip);
  return generatedZip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

function isWideTemplateCompatible(slideWidth, slideHeight) {
  const ratio = Number(slideWidth) / Math.max(0.001, Number(slideHeight));
  return Math.abs(ratio - (16 / 9)) < 0.03;
}

async function loadDefaultTemplateZip() {
  if (typeof fetch !== "function") throw new Error("PowerPoint template fetch is not available in this environment.");
  const response = await fetch(DEFAULT_TEMPLATE_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Default PowerPoint template request failed with ${response.status}.`);
  return JSZip.loadAsync(await response.arrayBuffer());
}

async function copyTemplateParts(sourceZip, targetZip, patterns) {
  const files = Object.values(sourceZip.files).filter((file) => !file.dir && patterns.some((pattern) => pattern.test(file.name)));
  await Promise.all(files.map(async (file) => {
    targetZip.file(file.name, await file.async("arraybuffer"));
  }));
}

async function findSlideLayoutIndexByName(zip, layoutName) {
  const layoutFiles = Object.values(zip.files)
    .filter((file) => !file.dir && /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(file.name))
    .sort((a, b) => slideLayoutNumber(a.name) - slideLayoutNumber(b.name));
  for (const file of layoutFiles) {
    const xml = await file.async("string");
    const name = xml.match(/<p:cSld\b[^>]*\bname="([^"]*)"/)?.[1];
    if (name === layoutName) return slideLayoutNumber(file.name);
  }
  return null;
}

function slideLayoutNumber(path) {
  return Number(path.match(/slideLayout(\d+)\.xml$/)?.[1]) || 0;
}

async function rebindSlidesToTemplateLayout(zip, layoutIndex) {
  const relFiles = Object.values(zip.files)
    .filter((file) => !file.dir && /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(file.name));
  await Promise.all(relFiles.map(async (file) => {
    const xml = await file.async("string");
    const nextXml = xml.replace(
      /(<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/slideLayout"[^>]*Target=")\.\.\/slideLayouts\/slideLayout\d+\.xml("[^>]*\/>)/,
      `$1../slideLayouts/slideLayout${layoutIndex}.xml$2`,
    );
    zip.file(file.name, nextXml);
  }));
}

async function assertPptxPackageLinks(zip) {
  const xmlFiles = Object.values(zip.files).filter((file) => !file.dir && /\.(xml|rels)$/.test(file.name));
  await Promise.all(xmlFiles.map((file) => file.async("string").then((xml) => {
    if (!xml.trim().startsWith("<?xml") && !xml.includes("<")) throw new Error(`Malformed PowerPoint XML part: ${file.name}`);
  })));
  const relFiles = Object.values(zip.files).filter((file) => !file.dir && file.name.endsWith(".rels"));
  for (const file of relFiles) {
    const xml = await file.async("string");
    const base = relationshipsBasePath(file.name);
    for (const target of [...xml.matchAll(/\bTarget="([^"]+)"/g)].map((match) => match[1])) {
      if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
      const resolved = normalizeZipPath(`${base}/${target}`);
      if (!zip.file(resolved)) throw new Error(`Missing PowerPoint relationship target: ${file.name} -> ${target}`);
    }
  }
}

function relationshipsBasePath(relsPath) {
  const normalized = relsPath.replace(/\\/g, "/");
  if (normalized === "_rels/.rels") return "";
  return normalized.replace(/\/_rels\/[^/]+\.rels$/, "");
}

function normalizeZipPath(path) {
  const stack = [];
  path.replace(/\\/g, "/").split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") stack.pop();
    else stack.push(part);
  });
  return stack.join("/");
}

function savePptxBuffer(buffer, filename) {
  if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    throw new Error("PowerPoint export download is not available in this environment.");
  }
  const blob = buffer instanceof Blob ? buffer : new Blob([buffer], { type: PPTX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function addTextBlock(slide, box, block) {
  const richText = pptxTextRuns(block);
  slide.addText(richText.length ? richText : String(block.html || ""), {
    ...box,
    fontFace: fontFamilyName(block.fontFamily || defaultFontFamily),
    fontSize: Math.max(1, Number(block.fontSize) || 15),
    color: DEFAULT_TEXT_COLOR,
    align: firstParagraphAlign(block),
    margin: pxToIn(TEXT_PADDING_PX),
    breakLine: false,
    fit: "shrink",
    valign: "top",
    ...(block.noFill ? {} : { fill: { color: colorToHex(block.fillColor || "#ffffff") } }),
    line: block.noBorder || Number(block.borderWidth) <= 0
      ? { color: "FFFFFF", transparency: 100 }
      : { color: colorToHex(block.borderColor || "#cbd5e1"), width: pxToPt(Number(block.borderWidth) || 1) },
  });
}

function pptxTextRuns(block) {
  const paragraphs = Array.isArray(block?.textRuns?.paragraphs) ? block.textRuns.paragraphs : [];
  const runs = [];
  paragraphs.forEach((paragraph, pIndex) => {
    (Array.isArray(paragraph?.runs) ? paragraph.runs : []).forEach((run, rIndex) => {
      runs.push({
        text: String(run?.text || ""),
        options: {
          fontFace: fontFamilyName(run?.fontFamily || block.fontFamily || defaultFontFamily),
          fontSize: Math.max(1, Number(run?.fontSize) || Number(block.fontSize) || 15),
          color: colorToHex(run?.color || DEFAULT_TEXT_COLOR),
          bold: !!run?.bold,
          italic: !!run?.italic,
          ...(run?.underline ? { underline: { style: "sng" } } : {}),
          breakLine: pIndex > 0 && rIndex === 0,
        },
      });
    });
  });
  return runs.filter((run) => run.text.length || run.options.breakLine);
}

function firstParagraphAlign(block) {
  const align = block?.textRuns?.paragraphs?.[0]?.align;
  return ["left", "center", "right"].includes(align) ? align : "left";
}

async function addChartBlock(slide, box, block, genericImports, chartSpecs) {
  const chartSpec = resolveBlockChartSpec(block, chartSpecs);
  if (!chartSpec) return;
  const chartLayout = resolveExportChartLayout(block, chartSpec);
  const plotArea = chartLayout.plotArea || {};
  const plot = makeGenericChartPreview(chartSpec, genericImports, {
    width: Math.max(1, Math.round(Number(plotArea.width) || Number(block.w) || 580)),
    height: Math.max(1, Math.round(Number(plotArea.height) || Number(block.h) || 380)),
    chartView: normalizeChartView(block.chartView),
    config: { displayModeBar: false, staticPlot: true, responsive: false },
  });
  const image = await renderChartBlockImage(block, chartLayout, applyChartLayout(plot, chartLayout));
  slide.addImage({ data: image, ...box, sizingCrop: false });
}

function resolveBlockChartSpec(block, chartSpecs) {
  return (Array.isArray(chartSpecs) ? chartSpecs : []).find((spec) => spec?.id === block?.chartSpecId)
    || block?.chartSpecSnapshot
    || null;
}

function normalizeChartView(value) {
  const safe = value && typeof value === "object" ? value : {};
  const idList = (items) => (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return {
    selectedExperimentIds: idList(safe.selectedExperimentIds),
    excludedExperimentIds: idList(safe.excludedExperimentIds),
    filters: Array.isArray(safe.filters) ? safe.filters : [],
    groupBy: safe.groupBy || null,
  };
}

function chartSpecAxisTitle(axis, fallback) {
  const label = axis?.label || axis?.field || fallback;
  const unit = axis?.unit ? ` (${axis.unit})` : "";
  return `${label || fallback || ""}${unit}`;
}

function chartSpecLayoutOpts(chartSpec) {
  const proposal = chartSpecToProposal(chartSpec);
  const yFields = Array.isArray(proposal.yFields) && proposal.yFields.length ? proposal.yFields : [proposal.y].filter(Boolean);
  return {
    title: proposal.title || chartSpec?.title || "Chart",
    xLabel: chartSpecAxisTitle(proposal.x, "Experiment"),
    yLabel: yFields.length > 1 ? "Value" : chartSpecAxisTitle(yFields[0], "Value"),
  };
}

function resolveExportChartLayout(block, chartSpec) {
  const proposal = chartSpecToProposal(chartSpec);
  const layout = resolveChartLayout({
    ...block,
    chartKind: proposal.chartType || chartSpec?.chartType || "scatter",
    opts: chartSpecLayoutOpts(chartSpec),
  });
  if (!block?.chartLayout?.xAxisTitle) {
    layout.xAxisTitle = { ...layout.xAxisTitle, visible: true };
  }
  return layout;
}

async function renderPlotImage(plot, width, height) {
  const Plotly = await loadPlotly();
  const node = document.createElement("div");
  node.style.position = "fixed";
  node.style.left = "-10000px";
  node.style.top = "0";
  node.style.width = `${width}px`;
  node.style.height = `${height}px`;
  document.body.appendChild(node);
  try {
    await Plotly.newPlot(node, plot.traces || [], { ...(plot.layout || {}), width, height, autosize: false }, {
      ...(plot.config || {}),
      displayModeBar: false,
      staticPlot: true,
      responsive: false,
    });
    return await Plotly.toImage(node, { format: "png", width, height, scale: 2 });
  } finally {
    Plotly.purge(node);
    node.remove();
  }
}

async function renderChartBlockImage(block, chartLayout, plot) {
  const width = Math.max(1, Math.round(Number(block.w) || 580));
  const height = Math.max(1, Math.round(Number(block.h) || 380));
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const plotArea = chartLayout.plotArea || {};
  const plotWidth = Math.max(160, Math.round(Number(plotArea.width) || 320));
  const plotHeight = Math.max(110, Math.round(Number(plotArea.height) || 220));
  const plotImage = await loadImage(await renderPlotImage(plot, plotWidth, plotHeight));
  ctx.drawImage(
    plotImage,
    Number(plotArea.x) || 0,
    Number(plotArea.y) || 0,
    Number(plotArea.width) || plotWidth,
    Number(plotArea.height) || plotHeight,
  );

  drawChartTextLayer(ctx, chartLayout.title, chartLayout.title?.text);
  drawChartTextLayer(ctx, chartLayout.xAxisTitle, chartLayout.xAxisTitle?.text);
  drawChartTextLayer(ctx, chartLayout.yAxisTitle, chartLayout.yAxisTitle?.text);
  drawLegendLayer(ctx, chartLayout.legend, plot);

  return canvas.toDataURL("image/png");
}

function drawChartTextLayer(ctx, layer, text) {
  if (!layer?.visible || !String(text || "").trim()) return;
  const box = layerBox(layer);
  const rotation = Number(layer.rotation) || 0;
  const fontSize = Math.max(1, Number(layer.fontSize) || 14);
  const fontFamily = canvasFontFamily(layer.fontFamily || defaultFontFamily);
  const rotated = Math.abs(rotation % 180) === 90;
  const availableLength = rotated ? box.h : box.w;
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);
  ctx.fillStyle = "#1e293b";
  ctx.textAlign = normalizeCanvasAlign(layer.align || "center");
  ctx.textBaseline = "middle";
  const alignOffset = ctx.textAlign === "left" ? -availableLength / 2 : ctx.textAlign === "right" ? availableLength / 2 : 0;
  drawFittedSingleLineText(ctx, String(text || ""), alignOffset, 0, availableLength, fontSize, fontFamily);
  ctx.restore();
}

function drawLegendLayer(ctx, legend, plot) {
  if (!legend?.visible) return;
  const traces = plot.traces || [];
  const items = traces.map((trace, index) => ({
    name: trace.name || `Series ${index + 1}`,
    color: traceColor(trace, index),
  }));
  if (!items.length) return;
  const box = layerBox(legend);
  const horizontal = legend.orientation !== "v";
  const count = Math.max(1, items.length);
  const itemWidth = horizontal ? box.w / count : box.w;
  const itemHeight = horizontal ? box.h : box.h / count;
  ctx.save();
  ctx.font = `${Math.max(1, Number(legend.fontSize) || 14)}px ${canvasFontFamily(legend.fontFamily || defaultFontFamily)}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  items.forEach((item, index) => {
    const x = horizontal ? box.x + itemWidth * index : box.x;
    const y = horizontal ? box.y : box.y + itemHeight * index;
    const swatchSize = Math.max(6, Math.min(12, itemHeight * 0.45, itemWidth * 0.16));
    const swatchX = x;
    const swatchY = y + Math.max(0, (itemHeight - swatchSize) / 2);
    ctx.fillStyle = item.color || fallbackColor(index);
    ctx.fillRect(swatchX, swatchY, swatchSize, swatchSize);
    ctx.fillStyle = "#1e293b";
    drawEllipsizedSingleLineText(ctx, item.name, swatchX + swatchSize + 4, y + itemHeight / 2, Math.max(1, itemWidth - swatchSize - 4));
  });
  ctx.restore();
}

function blockIntersectsPage(block, page) {
  const top = Number(block?.y) || 0;
  const bottom = top + (Number(block?.h) || 0);
  const pageTop = Number(page?.y) || 0;
  const pageBottom = pageTop + (Number(page?.height) || 0);
  return bottom > pageTop && top < pageBottom;
}

function blockBoxOnPage(block, page, scale) {
  return {
    x: (Number(block.x) || 0) * scale,
    y: ((Number(block.y) || 0) - (Number(page.y) || 0)) * scale,
    w: (Number(block.w) || 1) * scale,
    h: (Number(block.h) || 1) * scale,
  };
}

function validateBox(box, slideWidth, slideHeight) {
  const margin = Math.max(slideWidth, slideHeight) * 0.25;
  const invalid = [box.x, box.y, box.w, box.h].some((value) => !Number.isFinite(value))
    || Math.abs(box.x) > slideWidth + margin
    || Math.abs(box.y) > slideHeight + margin
    || box.w <= 0
    || box.h <= 0
    || box.w > slideWidth + margin
    || box.h > slideHeight + margin;
  if (invalid) throw new Error("PowerPoint export has out-of-range slide geometry.");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not render chart image for PowerPoint export."));
    image.src = src;
  });
}

function layerBox(layer) {
  return {
    x: Number(layer?.x) || 0,
    y: Number(layer?.y) || 0,
    w: Math.max(1, Number(layer?.width) || 1),
    h: Math.max(1, Number(layer?.height) || 1),
  };
}

function normalizeCanvasAlign(value) {
  return value === "left" || value === "right" ? value : "center";
}

function drawFittedSingleLineText(ctx, text, x, y, maxWidth, fontSize, fontFamily) {
  const clean = String(text || "");
  if (!clean) return;
  const width = Math.max(1, Number(maxWidth) || 1);
  const minFontSize = Math.max(6, Math.min(fontSize, 10));
  let size = fontSize;
  ctx.font = `${size}px ${fontFamily}`;
  while (size > minFontSize && ctx.measureText(clean).width > width) {
    size -= 1;
    ctx.font = `${size}px ${fontFamily}`;
  }
  const measured = ctx.measureText(clean).width;
  if (measured <= width) {
    ctx.fillText(clean, x, y);
    return;
  }
  ctx.save();
  const scaleX = width / Math.max(1, measured);
  ctx.translate(x, y);
  ctx.scale(scaleX, 1);
  ctx.fillText(clean, 0, 0);
  ctx.restore();
}

function drawEllipsizedSingleLineText(ctx, text, x, y, maxWidth) {
  const clean = String(text || "");
  if (!clean) return;
  const width = Math.max(1, Number(maxWidth) || 1);
  if (ctx.measureText(clean).width <= width) {
    ctx.fillText(clean, x, y);
    return;
  }
  let clipped = clean;
  while (clipped.length > 1 && ctx.measureText(`${clipped}...`).width > width) {
    clipped = clipped.slice(0, -1);
  }
  ctx.fillText(`${clipped}...`, x, y);
}

function traceColor(trace, index) {
  const color = trace?.marker?.color || trace?.line?.color;
  if (Array.isArray(color)) return color[0] || fallbackColor(index);
  return color || fallbackColor(index);
}

function fallbackColor(index) {
  return ["#93c5fd", "#f9a8d4", "#86efac", "#fde68a", "#c4b5fd"][index % 5];
}

function fontFamilyName(value) {
  return String(value || "Arial").split(",")[0].replace(/['"]/g, "").trim() || "Arial";
}

function canvasFontFamily(value) {
  const family = fontFamilyName(value);
  return /\s/.test(family) ? `"${family}"` : family;
}

function colorToHex(value) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return text.slice(1).split("").map((c) => c + c).join("").toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
  return "FFFFFF";
}

function pxToIn(value) {
  return (Number(value) || 0) / 96;
}

function pxToPt(value) {
  return (Number(value) || 0) * 0.75;
}
