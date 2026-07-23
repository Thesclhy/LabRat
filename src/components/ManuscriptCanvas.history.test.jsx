import React, { useMemo, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManuscriptCanvas } from "./ManuscriptCanvas";

vi.mock("../charts/Plot", () => ({
  Plot: ({ traces = [] }) => (
    <div
      data-testid="plotly-placeholder"
      data-traces={JSON.stringify(traces)}
    />
  ),
}));

vi.mock("../export/pptxExport", () => ({
  exportManuscriptPagesToPptx: vi.fn(),
}));

function createTextRuns(text, patch = {}) {
  return {
    paragraphs: [
      {
        align: "left",
        runs: [
          {
            text,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 15,
            color: "#1e293b",
            bold: false,
            italic: false,
            underline: false,
            ...patch,
          },
        ],
      },
    ],
  };
}

function createTextBlock(id, text, patch = {}) {
  return {
    id,
    kind: "text",
    x: 60,
    y: 50,
    w: 240,
    h: 120,
    html: text,
    textRuns: createTextRuns(text),
    fontSize: 15,
    fontFamily: "Arial, Helvetica, sans-serif",
    fillColor: "#ffffff",
    noFill: false,
    borderColor: "#cbd5e1",
    borderWidth: 1,
    noBorder: false,
    ...patch,
  };
}

function createPage(id, y = 0) {
  return {
    id,
    y,
    width: 1600,
    height: 900,
    orientation: "landscape",
  };
}

const scalarSourceSeries = [
  {
    seriesId: "series_exp1",
    experimentId: "exp_1",
    experimentLabel: "Run 1",
    rows: [{ values: { temperature: 250, selectivity: 82, conversion: 62 } }],
  },
  {
    seriesId: "series_exp2",
    experimentId: "exp_2",
    experimentLabel: "Run 2",
    rows: [{ values: { temperature: 275, selectivity: 88, conversion: 69 } }],
  },
];

const chartSpecFixture = {
  id: "chart_spec_1",
  title: "Selectivity vs Temperature",
  chartType: "scatter",
  origin: "analysis_result",
  spec: {
    schemaVersion: "labrat.chartSpec.v3",
    origin: "analysis_result",
    chartType: "scatter",
    title: "Selectivity vs Temperature",
    plotly: {
      data: scalarSourceSeries.map((series) => ({
        traceId: `${series.experimentId}:selectivity`,
        name: series.experimentLabel,
        type: "scatter",
        x: [series.rows[0].values.temperature],
        y: [series.rows[0].values.selectivity],
      })),
      layout: {
        xaxis: { title: "Temperature (C)" },
        yaxis: { title: "Selectivity (%)" },
      },
    },
    x: { field: "temperature", label: "Temperature", unit: "C" },
    y: { field: "selectivity", label: "Selectivity", unit: "%" },
    traceCatalog: scalarSourceSeries.map((series) => ({
      traceId: `${series.experimentId}:selectivity`,
      experimentId: series.experimentId,
      experimentLabel: series.experimentLabel,
      x: [series.rows[0].values.temperature],
      y: [series.rows[0].values.selectivity],
      xField: "temperature",
      yField: "selectivity",
      xUnit: "C",
      yUnit: "%",
      sourceRecordIds: [`snapshot:${series.experimentId}`],
    })),
    defaultChartView: { visibleTraceIds: ["exp_1:selectivity", "exp_2:selectivity"] },
    sourceRefs: [{ sourceDocumentId: "source_document_1", sheetName: "Summary", range: "A1:C3" }],
  },
};

const conversionChartSpecFixture = {
  ...chartSpecFixture,
  id: "chart_spec_2",
  title: "Conversion vs Temperature",
  spec: {
    ...chartSpecFixture.spec,
    title: "Conversion vs Temperature",
    y: { field: "conversion", label: "Conversion", unit: "%" },
    plotly: {
      data: scalarSourceSeries.map((series) => ({
        traceId: `${series.experimentId}:conversion`,
        name: series.experimentLabel,
        type: "scatter",
        x: [series.rows[0].values.temperature],
        y: [series.rows[0].values.conversion],
      })),
      layout: {
        xaxis: { title: "Temperature (C)" },
        yaxis: { title: "Conversion (%)" },
      },
    },
    traceCatalog: scalarSourceSeries.map((series) => ({
      traceId: `${series.experimentId}:conversion`,
      experimentId: series.experimentId,
      experimentLabel: series.experimentLabel,
      x: [series.rows[0].values.temperature],
      y: [series.rows[0].values.conversion],
      xField: "temperature",
      yField: "conversion",
      xUnit: "C",
      yUnit: "%",
      sourceRecordIds: [`snapshot:${series.experimentId}`],
    })),
    defaultChartView: { visibleTraceIds: ["exp_1:conversion", "exp_2:conversion"] },
  },
};

const seriesChartSpecFixture = {
  id: "chart_spec_series",
  title: "Reaction rate comparison",
  chartType: "scatter",
  origin: "analysis_result",
  spec: {
    schemaVersion: "labrat.chartSpec.v3",
    origin: "analysis_result",
    chartType: "scatter",
    title: "Reaction rate comparison",
    plotly: {
      data: [
        {
          traceId: "exp_1:reaction_rate_mol_g_h",
          name: "Run 1",
          type: "scatter",
          x: [0, 10],
          y: [1.1, 1.25],
        },
        {
          traceId: "exp_2:reaction_rate_mol_g_h",
          name: "Run 2",
          type: "scatter",
          x: [0, 10],
          y: [1.4, 1.55],
        },
      ],
      layout: {
        xaxis: { title: "Reaction Time (min)" },
        yaxis: { title: "Reaction Rate (mol/g/h)" },
      },
    },
    x: { field: "reaction_time_min", label: "Reaction Time", unit: "min" },
    y: { field: "reaction_rate_mol_g_h", label: "Reaction Rate", unit: "mol/g/h" },
    traceCatalog: [
      {
        traceId: "exp_1:reaction_rate_mol_g_h",
        experimentId: "exp_1",
        experimentLabel: "Run 1",
        x: [0, 10],
        y: [1.1, 1.25],
        xField: "reaction_time_min",
        yField: "reaction_rate_mol_g_h",
        xUnit: "min",
        yUnit: "mol/g/h",
        sourceRecordIds: ["snapshot:exp_1"],
      },
      {
        traceId: "exp_2:reaction_rate_mol_g_h",
        experimentId: "exp_2",
        experimentLabel: "Run 2",
        x: [0, 10],
        y: [1.4, 1.55],
        xField: "reaction_time_min",
        yField: "reaction_rate_mol_g_h",
        xUnit: "min",
        yUnit: "mol/g/h",
        sourceRecordIds: ["snapshot:exp_2"],
      },
    ],
    defaultChartView: { visibleTraceIds: ["exp_1:reaction_rate_mol_g_h", "exp_2:reaction_rate_mol_g_h"] },
  },
};

function Harness({
  initialBlocks,
  initialPages,
  initialCanvasHeight = 900,
  initialOrientation = "landscape",
  chartSpecs = [],
  chartSpecInsertRequest = null,
  onChartSpecInsertRequestHandled = () => {},
  onLoadChartSpecDetail,
  onSelectedChartContextChange = () => {},
}) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [pages, setPages] = useState(initialPages);
  const [canvasHeight, setCanvasHeight] = useState(initialCanvasHeight);
  const [pageOrientationPreference, setPageOrientationPreference] = useState(initialOrientation);
  const [staged, setStaged] = useState([]);
  const [templates, setTemplates] = useState([]);

  return (
    <>
      <ManuscriptCanvas
        blocks={blocks}
        setBlocks={setBlocks}
        staged={staged}
        setStaged={setStaged}
        references={[]}
        chartTemplates={templates}
        setChartTemplates={setTemplates}
        chartSpecs={chartSpecs}
        pages={pages}
        setPages={setPages}
        canvasHeight={canvasHeight}
        setCanvasHeight={setCanvasHeight}
        pageOrientationPreference={pageOrientationPreference}
        setPageOrientationPreference={setPageOrientationPreference}
        chartSpecInsertRequest={chartSpecInsertRequest}
        onChartSpecInsertRequestHandled={onChartSpecInsertRequestHandled}
        onLoadChartSpecDetail={onLoadChartSpecDetail}
        onSelectedChartContextChange={onSelectedChartContextChange}
        onRequestChartAnalysis={() => {}}
        onSaveProject={() => {}}
      />
      <pre data-testid="doc-state">{JSON.stringify({ blocks, pages, canvasHeight, pageOrientationPreference })}</pre>
    </>
  );
}

function readDocState() {
  return JSON.parse(screen.getByTestId("doc-state").textContent);
}

function textFromRuns(textRuns) {
  return (textRuns?.paragraphs || []).map((paragraph) => (paragraph.runs || []).map((run) => run.text || "").join("")).join("\n");
}

function firstBlock(id = "text-1") {
  return readDocState().blocks.find((block) => block.id === id);
}

function canvasTextDisplay(text) {
  return Array.from(document.querySelectorAll(".canvas .text-box-display")).find((element) => element.textContent.trim() === text);
}

function blockFrameForText(text) {
  return canvasTextDisplay(text)?.closest(".selection-frame") || null;
}

function selectBlockFrame(frame) {
  fireEvent.mouseDown(frame, { button: 0, clientX: 120, clientY: 120 });
  fireEvent.mouseUp(window);
}

function dragFrame(frame, dx, dy, start = { x: 140, y: 120 }) {
  fireEvent.mouseDown(frame, { button: 0, clientX: start.x, clientY: start.y });
  fireEvent.mouseMove(window, { clientX: start.x + dx, clientY: start.y + dy });
  fireEvent.mouseUp(window);
}

function resizeFromHandle(frame, handleSelector, dx, dy, start = { x: 280, y: 170 }) {
  selectBlockFrame(frame);
  const handle = frame.querySelector(handleSelector);
  fireEvent.mouseDown(handle, { button: 0, clientX: start.x, clientY: start.y });
  fireEvent.mouseMove(window, { clientX: start.x + dx, clientY: start.y + dy });
  fireEvent.mouseUp(window);
}

function doubleClickLayer(target) {
  fireEvent.mouseDown(target, { button: 0, detail: 1, clientX: 160, clientY: 110 });
  fireEvent.mouseUp(window);
  fireEvent.mouseDown(target, { button: 0, detail: 2, clientX: 160, clientY: 110 });
  fireEvent.mouseUp(window);
  fireEvent.doubleClick(target, { detail: 2, clientX: 160, clientY: 110 });
}

function clickUndo() {
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
}

function clickRedo() {
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
}

function getFontSizeInput() {
  return document.querySelector(".manuscript-toolbar .toolbar-size-input");
}

function getFontSelect() {
  return document.querySelector(".manuscript-toolbar .toolbar-font-select");
}

function getColorInput() {
  return document.querySelector(".manuscript-toolbar .toolbar-color input[type='color']");
}

function clickFontSizeStep(direction) {
  const name = direction === "up" ? "Increase font size" : "Decrease font size";
  const button = screen.getByRole("button", { name });
  fireEvent.mouseDown(button);
  fireEvent.click(button);
  return button;
}

function inactiveSelectionPreviewText() {
  return Array.from(document.querySelectorAll(".rich-text-fragment.is-inactive-selection"))
    .map((node) => node.textContent)
    .join("");
}

function getCanvas() {
  return document.querySelector(".canvas");
}

function getEditor() {
  return document.querySelector(".rich-text-editor");
}

function allTextNodes(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes.filter((textNode) => textNode.textContent.length > 0);
}

function setCaretToEnd(editor) {
  const nodes = allTextNodes(editor);
  const last = nodes[nodes.length - 1];
  const range = document.createRange();
  range.setStart(last, last.textContent.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function setCaretAtOffset(editor, offset, nodeIndex = 0) {
  const nodes = allTextNodes(editor);
  const node = nodes[nodeIndex];
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function selectAllEditorText(editor) {
  const nodes = allTextNodes(editor);
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.textContent.length);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function selectEditorTextRange(editor, startOffset, endOffset) {
  const nodes = allTextNodes(editor);
  const first = nodes[0];
  const range = document.createRange();
  range.setStart(first, startOffset);
  range.setEnd(first, endOffset);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function selectEditorNodeRange(editor, startNodeIndex, startOffset, endNodeIndex, endOffset) {
  const nodes = allTextNodes(editor);
  const range = document.createRange();
  range.setStart(nodes[startNodeIndex], startOffset);
  range.setEnd(nodes[endNodeIndex], endOffset);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

async function openTextEditor(text = "Hello") {
  fireEvent.doubleClick(canvasTextDisplay(text));
  await waitFor(() => expect(getEditor()).not.toBeNull());
  const editor = getEditor();
  setCaretToEnd(editor);
  return editor;
}

describe("ManuscriptCanvas chart specs", () => {
  const analysisChartSpecFixture = {
    id: "chart_spec_analysis",
    title: "Reaction rate over time",
    chartType: "scatter",
    origin: "analysis_result",
    spec: {
      schemaVersion: "labrat.chartSpec.v3",
      origin: "analysis_result",
      chartType: "scatter",
      title: "Reaction rate over time",
      plotly: {
        data: [
          {
            traceId: "trace_exp_1",
            name: "Exp-001",
            type: "scatter",
            x: [0, 10],
            y: [1, 2],
          },
          {
            traceId: "trace_exp_2",
            name: "Exp-002",
            type: "scatter",
            x: [0, 10],
            y: [2, 3],
          },
        ],
        layout: {
          xaxis: { title: "Time (min)" },
          yaxis: { title: "Rate (mmol/g/min)" },
        },
      },
      x: { field: "time", label: "Time", unit: "min" },
      y: { field: "rate", label: "Rate", unit: "mmol/g/min" },
      traceCatalog: [
        {
          traceId: "trace_exp_1",
          experimentId: "exp_1",
          experimentLabel: "Exp-001",
          x: [0, 10],
          y: [1, 2],
          xUnit: "min",
          yUnit: "mmol/g/min",
        },
        {
          traceId: "trace_exp_2",
          experimentId: "exp_2",
          experimentLabel: "Exp-002",
          x: [0, 10],
          y: [2, 3],
          xUnit: "min",
          yUnit: "mmol/g/min",
        },
      ],
      defaultChartView: { visibleTraceIds: ["trace_exp_1", "trace_exp_2"] },
    },
  };

  it("loads complete analysis ChartSpec detail before preview and insertion", async () => {
    const summary = {
      ...analysisChartSpecFixture,
      spec: {
        ...analysisChartSpecFixture.spec,
        traceCatalog: analysisChartSpecFixture.spec.traceCatalog.map(({ x, y, ...trace }) => ({
          ...trace,
          pointCount: Math.max(x.length, y.length),
        })),
        detailRequired: true,
      },
    };
    const loadDetail = vi.fn().mockResolvedValue(analysisChartSpecFixture);

    render(
      <Harness
        initialBlocks={[]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[summary]}
        chartSpecInsertRequest={{ chartSpecId: summary.id, requestId: "insert-analysis-summary" }}
        onLoadChartSpecDetail={loadDetail}
      />,
    );

    expect(await screen.findByRole("dialog", { name: "Insert chart" })).toBeTruthy();
    expect(loadDetail).toHaveBeenCalledWith(summary.id);
    await waitFor(() => {
      const traces = JSON.parse(screen.getByTestId("plotly-placeholder").dataset.traces);
      expect(traces).toHaveLength(2);
      expect(traces[0].x).toEqual([0, 10]);
      expect(traces[0].y).toEqual([1, 2]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Insert chart" }));
    await waitFor(() => {
      const block = readDocState().blocks[0];
      expect(block.chartSpecSnapshot.spec.detailRequired).not.toBe(true);
      expect(block.chartSpecSnapshot.spec.traceCatalog[0].x).toEqual([0, 10]);
    });
    const chartFrame = document.querySelector(".canvas-block.chart");
    fireEvent.mouseDown(chartFrame, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window);
    expect(screen.getByText("Validated analysis result")).toBeTruthy();
    expect(screen.queryByText("Missing source snapshot")).toBeNull();
  });

  it("keeps trace visibility independent between two placements of one ChartSpec", async () => {
    const chartBlock = (id, x) => ({
      id,
      kind: "chart",
      chartSpecId: analysisChartSpecFixture.id,
      chartSpecSnapshot: analysisChartSpecFixture,
      chartView: { visibleTraceIds: ["trace_exp_1", "trace_exp_2"] },
      chartLayout: {},
      x,
      y: 80,
      w: 640,
      h: 420,
    });
    render(
      <Harness
        initialBlocks={[chartBlock("chart-block-1", 50), chartBlock("chart-block-2", 740)]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[analysisChartSpecFixture]}
      />,
    );

    const chartFrames = document.querySelectorAll(".canvas-block.chart");
    fireEvent.mouseDown(chartFrames[0], { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByLabelText("Hide Exp-002 in selected chart"));

    await waitFor(() => {
      const [first, second] = readDocState().blocks;
      expect(first.chartView).toEqual({ visibleTraceIds: ["trace_exp_1"] });
      expect(second.chartView).toEqual({ visibleTraceIds: ["trace_exp_1", "trace_exp_2"] });
    });

    clickUndo();
    await waitFor(() => {
      const [first, second] = readDocState().blocks;
      expect(first.chartView.visibleTraceIds).toEqual(["trace_exp_1", "trace_exp_2"]);
      expect(second.chartView.visibleTraceIds).toEqual(["trace_exp_1", "trace_exp_2"]);
    });
    clickRedo();
    await waitFor(() => {
      const [first, second] = readDocState().blocks;
      expect(first.chartView.visibleTraceIds).toEqual(["trace_exp_1"]);
      expect(second.chartView.visibleTraceIds).toEqual(["trace_exp_1", "trace_exp_2"]);
    });
  });

  it("does not republish unchanged selected-chart context when chart summaries are recreated", async () => {
    const onContext = vi.fn();
    function RerenderingParent() {
      const [, setContext] = useState(null);
      const contextUpdateCount = useRef(0);
      const handleContext = useMemo(() => (nextContext) => {
        if (!nextContext) return;
        onContext(nextContext);
        contextUpdateCount.current += 1;
        if (contextUpdateCount.current < 3) setContext(nextContext);
      }, []);
      return (
        <Harness
          initialBlocks={[{
            id: "chart-block-context-loop",
            kind: "chart",
            chartSpecId: analysisChartSpecFixture.id,
            chartSpecSnapshot: analysisChartSpecFixture,
            chartView: { visibleTraceIds: ["trace_exp_1", "trace_exp_2"] },
            chartLayout: {},
            x: 80,
            y: 80,
            w: 640,
            h: 420,
          }]}
          initialPages={[createPage("page-1")]}
          chartSpecs={[{ ...analysisChartSpecFixture }]}
          onSelectedChartContextChange={handleContext}
        />
      );
    }
    render(<RerenderingParent />);

    const chartFrame = document.querySelector(".canvas-block.chart");
    fireEvent.mouseDown(chartFrame, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window);

    await waitFor(() => expect(onContext).toHaveBeenCalled());
    expect(onContext).toHaveBeenCalledTimes(1);
  });

  it("loads complete ChartSpec detail before opening insertion and snapshots full traces", async () => {
    const summary = {
      ...analysisChartSpecFixture,
      detailRequired: true,
      spec: {
        ...analysisChartSpecFixture.spec,
        traceCatalog: analysisChartSpecFixture.spec.traceCatalog.map(({ x, y, ...trace }) => trace),
      },
    };
    const onLoadChartSpecDetail = vi.fn().mockResolvedValue(analysisChartSpecFixture);
    render(
      <Harness
        initialBlocks={[]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[summary]}
        chartSpecInsertRequest={{ chartSpecId: summary.id, requestId: "detail_request_1" }}
        onLoadChartSpecDetail={onLoadChartSpecDetail}
      />,
    );

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Insert chart" })).toBeTruthy());
    expect(onLoadChartSpecDetail).toHaveBeenCalledWith(summary.id);
    fireEvent.click(screen.getByRole("button", { name: "Insert chart" }));

    await waitFor(() => {
      const block = readDocState().blocks[0];
      expect(block.chartView).toEqual({ visibleTraceIds: ["trace_exp_1", "trace_exp_2"] });
      expect(block.chartSpecSnapshot.spec.traceCatalog[0].x).toEqual([0, 10]);
      expect(block.chartSpecSnapshot.detailRequired).not.toBe(true);
    });
  });

  it("renders a persisted analysis chart from its complete snapshot when the project list only has summary traces", () => {
    const summary = {
      ...analysisChartSpecFixture,
      detailRequired: true,
      spec: {
        ...analysisChartSpecFixture.spec,
        traceCatalog: analysisChartSpecFixture.spec.traceCatalog.map(({ x, y, ...trace }) => trace),
      },
    };
    render(
      <Harness
        initialBlocks={[{
          id: "chart-block-reloaded",
          kind: "chart",
          chartSpecId: analysisChartSpecFixture.id,
          chartSpecSnapshot: analysisChartSpecFixture,
          chartView: { visibleTraceIds: ["trace_exp_2"] },
          chartLayout: {},
          x: 80,
          y: 80,
          w: 640,
          h: 420,
        }]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[summary]}
      />,
    );

    const renderedPlots = screen.getAllByTestId("plotly-placeholder")
      .map((node) => JSON.parse(node.dataset.traces || "[]"));
    expect(renderedPlots.some((traces) => (
      traces.length === 1
      && traces[0].traceId === "trace_exp_2"
      && traces[0].x?.join(",") === "0,10"
      && traces[0].y?.join(",") === "2,3"
    ))).toBe(true);
  });

  it("reports a bounded complete trace catalog and placement view to LabRat context", async () => {
    const onSelectedChartContextChange = vi.fn();
    render(
      <Harness
        initialBlocks={[{
          id: "chart-block-context",
          kind: "chart",
          chartSpecId: analysisChartSpecFixture.id,
          chartSpecSnapshot: analysisChartSpecFixture,
          chartView: { visibleTraceIds: ["trace_exp_2"] },
          chartLayout: {},
          x: 80,
          y: 80,
          w: 640,
          h: 420,
        }]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[analysisChartSpecFixture]}
        onSelectedChartContextChange={onSelectedChartContextChange}
      />,
    );

    const chartFrame = document.querySelector(".canvas-block.chart");
    fireEvent.mouseDown(chartFrame, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      const context = onSelectedChartContextChange.mock.calls.at(-1)?.[0];
      expect(context.chartView).toEqual({ visibleTraceIds: ["trace_exp_2"] });
      expect(context.traceCatalog).toHaveLength(2);
      expect(context.traceCatalog[0]).not.toHaveProperty("x");
      expect(context.traceCatalog[0]).not.toHaveProperty("y");
    });
  });

  it("opens the insert modal from a chart spec insert request", async () => {
    const onHandled = vi.fn();
    render(
      <Harness
        initialBlocks={[]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[chartSpecFixture, conversionChartSpecFixture]}
        chartSpecInsertRequest={{ chartSpecId: "chart_spec_2", requestId: "insert_request_1" }}
        onChartSpecInsertRequestHandled={onHandled}
      />,
    );

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Insert chart" })).toBeTruthy());
    expect(onHandled).toHaveBeenCalledWith("insert_request_1");
    const conversionChoices = screen.getAllByRole("button", { name: /Conversion vs Temperature/i });
    expect(conversionChoices.some((button) => button.className.includes("active"))).toBe(true);
    expect(screen.getByText("2 of 2 traces visible")).toBeTruthy();
  });

  it("waits for chart specs before opening a requested insert modal", async () => {
    const onHandled = vi.fn();
    function DelayedInsertHarness() {
      const [chartSpecs, setChartSpecs] = useState([]);
      const [request, setRequest] = useState({ chartSpecId: "chart_spec_2", requestId: "delayed_request_1" });
      return (
        <>
          <button type="button" onClick={() => setChartSpecs([conversionChartSpecFixture])}>Load chart specs</button>
          <Harness
            initialBlocks={[]}
            initialPages={[createPage("page-1")]}
            chartSpecs={chartSpecs}
            chartSpecInsertRequest={request}
            onChartSpecInsertRequestHandled={(requestId) => {
              onHandled(requestId);
              setRequest(null);
            }}
          />
        </>
      );
    }

    render(<DelayedInsertHarness />);

    expect(screen.queryByRole("dialog", { name: "Insert chart" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load chart specs" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Insert chart" })).toBeTruthy());
    expect(onHandled).toHaveBeenCalledWith("delayed_request_1");
    const conversionChoices = screen.getAllByRole("button", { name: /Conversion vs Temperature/i });
    expect(conversionChoices.some((button) => button.className.includes("active"))).toBe(true);
  });

  it("hides stale chart specs from approved chart insertion choices", async () => {
    render(
      <Harness
        initialBlocks={[]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[
          chartSpecFixture,
          {
            ...chartSpecFixture,
            id: "chart_spec_stale",
            title: "Old Selectivity Chart",
            status: "stale",
            isStale: true,
            staleReason: "source_snapshot_replaced",
          },
        ]}
      />,
    );

    expect(screen.getByText("Selectivity vs Temperature")).toBeTruthy();
    expect(screen.queryByText("Old Selectivity Chart")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Selectivity vs Temperature/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Insert chart" })).not.toBeNull());
    expect(screen.queryByText("Old Selectivity Chart")).toBeNull();
  });

  it("renders existing stale chart blocks from their chartSpecSnapshot", () => {
    render(
      <Harness
        initialBlocks={[{
          id: "chart-block-1",
          kind: "chart",
          chartSpecId: "chart_spec_stale",
          chartSpecSnapshot: {
            ...chartSpecFixture,
            id: "chart_spec_stale",
            status: "stale",
            isStale: true,
          },
          chartView: { visibleTraceIds: ["exp_1:selectivity"] },
          chartLayout: {},
          x: 80,
          y: 80,
          w: 640,
          h: 420,
        }]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[]}
      />,
    );

    expect(screen.getAllByTestId("plotly-placeholder").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Missing chart spec/)).toBeNull();
  });

  it("configures chart view before inserting chartSpec-backed chart blocks", async () => {
    render(
      <Harness
        initialBlocks={[]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[chartSpecFixture]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Selectivity vs Temperature/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Insert chart" })).not.toBeNull());
    expect(screen.getByText("2 of 2 traces visible")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Insert chart" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("0 of 2 traces visible")).not.toBeNull();
    expect(screen.getByText("Select traces to preview this chart.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Insert chart" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Select traces" }));
    expect(screen.getByRole("dialog", { name: "Select traces" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Label" })).toBeTruthy();
    expect(screen.getByLabelText("Select Run 1")).toBeTruthy();
    expect(screen.getByLabelText("Select Run 2")).toBeTruthy();
    expect(screen.queryByLabelText("Select Run 3")).toBeNull();
    fireEvent.click(screen.getByLabelText("Select Run 1"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByText("1 of 2 traces visible")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Insert chart" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Insert chart" }));

    await waitFor(() => {
      const state = readDocState();
      expect(state.blocks).toHaveLength(1);
      expect(state.blocks[0]).toMatchObject({
        kind: "chart",
        chartSpecId: "chart_spec_1",
        chartView: {
          visibleTraceIds: ["exp_1:selectivity"],
        },
      });
      expect(state.blocks[0].chartSpecSnapshot.title).toBe("Selectivity vs Temperature");
      expect(state.blocks[0].chartLayout.title.text).toBe("Selectivity vs Temperature");
      expect(state.blocks[0].chartLayout.xAxisTitle.visible).toBe(true);
      expect(state.blocks[0].chartKind).toBeUndefined();
      expect(state.blocks[0].labels).toBeUndefined();
      expect(state.blocks[0].datasetCommitId).toBeUndefined();
    });
  });

  it("configures trace selection for multi-experiment ChartSpecs", async () => {
    render(
      <Harness
        initialBlocks={[]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[seriesChartSpecFixture]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reaction rate comparison/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Insert chart" })).not.toBeNull());
    expect(screen.getByText("2 of 2 traces visible")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Select traces" }));
    fireEvent.click(screen.getByLabelText("Select Run 2"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert chart" }));

    await waitFor(() => {
      const state = readDocState();
      expect(state.blocks).toHaveLength(1);
      expect(state.blocks[0]).toMatchObject({
        kind: "chart",
        chartSpecId: "chart_spec_series",
        chartView: {
          visibleTraceIds: ["exp_2:reaction_rate_mol_g_h"],
        },
      });
      expect(state.blocks[0].chartSpecSnapshot.spec.schemaVersion).toBe("labrat.chartSpec.v3");
      expect(state.blocks[0].chartSpecSnapshot.spec.traceCatalog).toHaveLength(2);
    });
  });

  it("resets draft trace visibility when switching chart specs", async () => {
    render(
      <Harness
        initialBlocks={[]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[chartSpecFixture, conversionChartSpecFixture]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Selectivity vs Temperature/i }));
    await waitFor(() => expect(screen.getByText("2 of 2 traces visible")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Select traces" }));
    fireEvent.click(screen.getByLabelText("Select Run 1"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("1 of 2 traces visible")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /Conversion vs Temperature/i }).at(-1));

    await waitFor(() => expect(screen.getByText("2 of 2 traces visible")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Insert chart" }).disabled).toBe(false);
  });

  it("requires whole-chart selection before selecting and editing chart components", async () => {
    render(
      <Harness
        initialBlocks={[]}
        initialPages={[createPage("page-1")]}
        chartSpecs={[chartSpecFixture]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Selectivity vs Temperature/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Insert chart" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Insert chart" }));

    await waitFor(() => expect(readDocState().blocks).toHaveLength(1));
    const chartFrame = document.querySelector(".canvas-block.chart");
    const titleFrame = document.querySelector(".chart-title-frame");
    const titleLayer = document.querySelector(".chart-title-layer");
    const plotFrame = document.querySelector(".chart-plot-layer");
    expect(chartFrame?.classList.contains("is-selected")).toBe(true);
    expect(titleFrame?.classList.contains("is-selected")).toBe(false);

    fireEvent.mouseDown(document.querySelector(".canvas"), { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseUp(window);
    expect(chartFrame.classList.contains("is-selected")).toBe(false);
    expect(titleFrame.classList.contains("is-selected")).toBe(false);

    fireEvent.mouseDown(titleLayer, { button: 0, detail: 1, clientX: 160, clientY: 110 });
    fireEvent.mouseUp(window);
    expect(chartFrame.classList.contains("is-selected")).toBe(true);
    expect(titleFrame.classList.contains("is-selected")).toBe(false);
    expect(document.querySelector(".chart-text-editor")).toBeNull();

    fireEvent.mouseDown(titleLayer, { button: 0, detail: 1, clientX: 160, clientY: 110 });
    fireEvent.mouseUp(window);
    expect(chartFrame.classList.contains("is-selected")).toBe(true);
    expect(titleFrame.classList.contains("is-selected")).toBe(false);
    expect(document.querySelector(".chart-text-editor")).toBeNull();

    doubleClickLayer(titleLayer);
    await waitFor(() => expect(titleFrame.classList.contains("is-selected")).toBe(true));
    expect(document.querySelector(".chart-text-editor")).toBeNull();

    doubleClickLayer(titleLayer);
    const editor = await waitFor(() => {
      const input = document.querySelector(".chart-text-editor");
      expect(input).toBeTruthy();
      return input;
    });
    fireEvent.change(editor, { target: { value: "Custom figure title" } });
    fireEvent.blur(editor);

    await waitFor(() => {
      expect(readDocState().blocks[0].chartLayout.title.text).toBe("Custom figure title");
    });

    doubleClickLayer(plotFrame);
    await waitFor(() => expect(plotFrame.classList.contains("is-selected")).toBe(true));
    expect(titleFrame.classList.contains("is-selected")).toBe(false);
  });
});

describe("ManuscriptCanvas undo/redo", () => {
  it("undoes a typed text batch and keeps text then move ordered as separate transactions", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    fireEvent.keyDown(editor, { key: "!" });
    fireEvent.keyDown(editor, { key: "?" });

    dragFrame(document.querySelector(".canvas-block"), 40, 30);
    await waitFor(() => {
      const block = firstBlock();
      expect(block.x).toBe(100);
      expect(textFromRuns(block.textRuns)).toBe("Hello!?");
    });

    clickUndo();
    await waitFor(() => {
      const block = firstBlock();
      expect(block.x).toBe(60);
      expect(textFromRuns(block.textRuns)).toBe("Hello!?");
    });

    clickUndo();
    await waitFor(() => expect(textFromRuns(firstBlock().textRuns)).toBe("Hello"));
  });

  it("treats paste as one undoable text step", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => " world",
      },
    });

    await waitFor(() => expect(textFromRuns(firstBlock().textRuns)).toBe("Hello world"));
    clickUndo();
    await waitFor(() => expect(textFromRuns(firstBlock().textRuns)).toBe("Hello"));
  });

  it("undoes formatting and redo restores the exact textRuns", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectAllEditorText(editor);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    let formattedRuns;
    await waitFor(() => {
      formattedRuns = firstBlock().textRuns;
      expect(formattedRuns.paragraphs[0].runs[0].bold).toBe(true);
    });

    clickUndo();
    await waitFor(() => expect(firstBlock().textRuns.paragraphs[0].runs[0].bold).toBe(false));

    clickRedo();
    await waitFor(() => expect(firstBlock().textRuns).toEqual(formattedRuns));
  });

  it("undoes italic formatting on selected text", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectAllEditorText(editor);
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));

    await waitFor(() => expect(firstBlock().textRuns.paragraphs[0].runs[0].italic).toBe(true));
    clickUndo();
    await waitFor(() => expect(firstBlock().textRuns.paragraphs[0].runs[0].italic).toBe(false));
  });

  it("undoes underline formatting on selected text", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectAllEditorText(editor);
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));

    await waitFor(() => expect(firstBlock().textRuns.paragraphs[0].runs[0].underline).toBe(true));
    clickUndo();
    await waitFor(() => expect(firstBlock().textRuns.paragraphs[0].runs[0].underline).toBe(false));
  });

  it("normalizes a mixed bold selection to fully bold with one click", async () => {
    render(
      <Harness
        initialBlocks={[createTextBlock("text-1", "Hello", {
          textRuns: {
            paragraphs: [
              {
                align: "left",
                runs: [
                  { text: "He", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 15, color: "#1e293b", bold: true, italic: false, underline: false },
                  { text: "llo", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 15, color: "#1e293b", bold: false, italic: false, underline: false },
                ],
              },
            ],
          },
        })]}
        initialPages={[createPage("page-1")]}
      />,
    );

    const editor = await openTextEditor();
    selectEditorNodeRange(editor, 0, 0, 1, 3);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    await waitFor(() => {
      const runs = firstBlock().textRuns.paragraphs[0].runs;
      expect(runs).toHaveLength(1);
      expect(runs[0].text).toBe("Hello");
      expect(runs[0].bold).toBe(true);
    });
  });

  it("keeps the same text selected after changing font size from the toolbar", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);
    expect(window.getSelection().toString()).toBe("ell");

    const fontSizeInput = getFontSizeInput();
    expect(fontSizeInput).not.toBeNull();
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "18" } });
    fireEvent.keyDown(fontSizeInput, { key: "Enter" });

    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      const runs = firstBlock().textRuns.paragraphs[0].runs;
      expect(runs.map((run) => run.text)).toEqual(["H", "ell", "o"]);
      expect(runs[1].fontSize).toBe(18);
    });

    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "20" } });
    fireEvent.blur(fontSizeInput, { relatedTarget: editor });

    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs[1].fontSize).toBe(20);
    });
  });

  it("shows an inactive gray preview when the font-size input takes focus", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);
    const fontSizeInput = getFontSizeInput();

    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);

    await waitFor(() => {
      expect(inactiveSelectionPreviewText()).toBe("ell");
      expect(window.getSelection().toString()).toBe("");
    });
  });

  it("keeps the same text selected when font size applies on blur", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    const fontSizeInput = getFontSizeInput();
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "22" } });
    fireEvent.blur(fontSizeInput, { relatedTarget: editor });

    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs[1].fontSize).toBe(22);
    });
  });

  it("restores the blue selection when font size applies after clicking empty canvas", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    const fontSizeInput = getFontSizeInput();
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "23" } });
    fireEvent.mouseDown(getCanvas(), { button: 0, clientX: 20, clientY: 20 });

    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs.some((run) => run.fontSize === 23)).toBe(true);
      expect(getEditor().closest(".selection-frame").classList.contains("is-selected")).toBe(true);
    });
  });

  it("uses the second empty canvas click to exit editing after restoring the selection", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    const fontSizeInput = getFontSizeInput();
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "24" } });

    fireEvent.mouseDown(getCanvas(), { button: 0, clientX: 20, clientY: 20 });
    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs.some((run) => run.fontSize === 24)).toBe(true);
    });

    fireEvent.mouseDown(getCanvas(), { button: 0, clientX: 30, clientY: 30 });
    await waitFor(() => {
      expect(getEditor()).toBeNull();
      expect(blockFrameForText("Hello").classList.contains("is-selected")).toBe(false);
    });
  });

  it("keeps the same text selected when stepping font size up repeatedly", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    clickFontSizeStep("up");
    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs[1].fontSize).toBe(16);
    });

    clickFontSizeStep("up");
    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs[1].fontSize).toBe(17);
    });
  });

  it("keeps the same text selected when stepping font size down", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    clickFontSizeStep("down");
    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs[1].fontSize).toBe(14);
    });
  });

  it("keeps the inactive gray preview when moving from font-size input to another toolbar control", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    const fontSizeInput = getFontSizeInput();
    const fontSelect = document.querySelector(".manuscript-toolbar .toolbar-font-select");
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "18" } });
    fireEvent.mouseDown(fontSelect);
    fireEvent.blur(fontSizeInput, { relatedTarget: fontSelect });
    fireEvent.focus(fontSelect);

    await waitFor(() => {
      expect(inactiveSelectionPreviewText()).toBe("ell");
      expect(window.getSelection().toString()).toBe("");
      expect(firstBlock().textRuns.paragraphs[0].runs[1].fontSize).toBe(18);
    });
  });

  it("keeps the selected range when changing font family from the toolbar", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);
    expect(window.getSelection().toString()).toBe("ell");

    const fontSelect = getFontSelect();
    expect(fontSelect).not.toBeNull();
    fireEvent.mouseDown(fontSelect);
    fireEvent.blur(editor, { relatedTarget: fontSelect });
    fireEvent.focus(fontSelect);
    fireEvent.change(fontSelect, { target: { value: "Georgia, 'Times New Roman', serif" } });

    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      const runs = firstBlock().textRuns.paragraphs[0].runs;
      expect(runs.map((run) => run.text)).toEqual(["H", "ell", "o"]);
      expect(runs[1].fontFamily).toBe("Georgia, 'Times New Roman', serif");
    });
  });

  it("keeps the selected range when changing text color from the toolbar", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    const colorInput = getColorInput();
    fireEvent.mouseDown(colorInput);
    fireEvent.blur(editor, { relatedTarget: colorInput });
    fireEvent.focus(colorInput);
    fireEvent.change(colorInput, { target: { value: "#ff0000" } });

    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      const runs = firstBlock().textRuns.paragraphs[0].runs;
      expect(runs.map((run) => run.text)).toEqual(["H", "ell", "o"]);
      expect(runs[1].color).toBe("#ff0000");
    });
  });

  it("keeps the selected range after bold, italic, underline, and alignment actions", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Bold" }));
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs[1].bold).toBe(true);
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Italic" }));
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs[1].italic).toBe(true);
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Underline" }));
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs[1].underline).toBe(true);
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Align center" }));
    fireEvent.click(screen.getByRole("button", { name: "Align center" }));
    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].align).toBe("center");
    });
  });

  it("undos and redos font-size changes", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    clickFontSizeStep("up");
    await waitFor(() => expect(firstBlock().textRuns.paragraphs[0].runs[1].fontSize).toBe(16));

    clickUndo();
    await waitFor(() => expect(firstBlock().textRuns.paragraphs[0].runs[0].fontSize).toBe(15));

    clickRedo();
    await waitFor(() => expect(firstBlock().textRuns.paragraphs[0].runs[1].fontSize).toBe(16));
  });

  it("does not create undo history for selection-only font-size toolbar interactions", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    const fontSizeInput = getFontSizeInput();
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.blur(fontSizeInput, { relatedTarget: editor });

    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" }).disabled).toBe(true));
  });

  it("cancels font-size draft on Escape without mutating text runs", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    const fontSizeInput = getFontSizeInput();
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "24" } });
    fireEvent.keyDown(fontSizeInput, { key: "Escape" });

    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs).toHaveLength(1);
      expect(firstBlock().textRuns.paragraphs[0].runs[0].fontSize).toBe(15);
      expect(screen.getByRole("button", { name: "Undo" }).disabled).toBe(true);
    });
  });

  it("ignores invalid or empty font-size drafts without creating history", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    const fontSizeInput = getFontSizeInput();
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "" } });
    fireEvent.blur(fontSizeInput, { relatedTarget: editor });

    await waitFor(() => {
      expect(window.getSelection().toString()).toBe("ell");
      expect(document.activeElement).toBe(getEditor());
      expect(firstBlock().textRuns.paragraphs[0].runs).toHaveLength(1);
      expect(firstBlock().textRuns.paragraphs[0].runs[0].fontSize).toBe(15);
      expect(screen.getByRole("button", { name: "Undo" }).disabled).toBe(true);
    });
  });

  it("allows another block click to win when the font-size input blurs", async () => {
    render(
      <Harness
        initialBlocks={[
          createTextBlock("text-1", "Hello"),
          createTextBlock("text-2", "World", { x: 360 }),
        ]}
        initialPages={[createPage("page-1")]}
      />,
    );

    const editor = await openTextEditor();
    selectEditorTextRange(editor, 1, 4);

    const fontSizeInput = getFontSizeInput();
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "21" } });

    const worldFrame = blockFrameForText("World");
    fireEvent.mouseDown(worldFrame, { button: 0, clientX: 380, clientY: 120 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(firstBlock().textRuns.paragraphs[0].runs.some((run) => run.fontSize === 21)).toBe(true);
      expect(blockFrameForText("World").classList.contains("is-selected")).toBe(true);
      expect(getEditor()).toBeNull();
    });
  });

  it("applies pending bold at a collapsed caret without creating history until typing", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    setCaretAtOffset(editor, 5);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(screen.getByRole("button", { name: "Undo" }).disabled).toBe(true);

    fireEvent.keyDown(editor, { key: "!" });

    await waitFor(() => {
      const runs = firstBlock().textRuns.paragraphs[0].runs;
      expect(textFromRuns(firstBlock().textRuns)).toBe("Hello!");
      expect(runs[runs.length - 1].text).toBe("!");
      expect(runs[runs.length - 1].bold).toBe(true);
    });
  });

  it("applies pending italic at a collapsed caret", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    setCaretAtOffset(editor, 5);
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    fireEvent.keyDown(editor, { key: "!" });

    await waitFor(() => {
      const runs = firstBlock().textRuns.paragraphs[0].runs;
      expect(runs[runs.length - 1].text).toBe("!");
      expect(runs[runs.length - 1].italic).toBe(true);
    });
  });

  it("applies pending underline at a collapsed caret", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    setCaretAtOffset(editor, 5);
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    fireEvent.keyDown(editor, { key: "!" });

    await waitFor(() => {
      const runs = firstBlock().textRuns.paragraphs[0].runs;
      expect(runs[runs.length - 1].text).toBe("!");
      expect(runs[runs.length - 1].underline).toBe(true);
    });
  });

  it("applies pending font size from the stepper at a collapsed caret", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    setCaretAtOffset(editor, 5);
    clickFontSizeStep("up");
    fireEvent.keyDown(editor, { key: "!" });

    await waitFor(() => {
      const runs = firstBlock().textRuns.paragraphs[0].runs;
      expect(runs[runs.length - 1].text).toBe("!");
      expect(runs[runs.length - 1].fontSize).toBe(16);
    });
  });

  it("applies pending typed font size at a collapsed caret", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const editor = await openTextEditor();
    setCaretAtOffset(editor, 5);

    const fontSizeInput = getFontSizeInput();
    fireEvent.mouseDown(fontSizeInput);
    fireEvent.blur(editor, { relatedTarget: fontSizeInput });
    fireEvent.focus(fontSizeInput);
    fireEvent.change(fontSizeInput, { target: { value: "19" } });
    fireEvent.keyDown(fontSizeInput, { key: "Enter" });
    fireEvent.keyDown(getEditor(), { key: "!" });

    await waitFor(() => {
      const runs = firstBlock().textRuns.paragraphs[0].runs;
      expect(runs[runs.length - 1].text).toBe("!");
      expect(runs[runs.length - 1].fontSize).toBe(19);
    });
  });

  it("undoes and redoes block drag", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const frame = blockFrameForText("Hello");
    dragFrame(frame, 50, 35);
    await waitFor(() => expect(firstBlock().x).toBe(110));

    clickUndo();
    await waitFor(() => expect(firstBlock().x).toBe(60));

    clickRedo();
    await waitFor(() => expect(firstBlock().x).toBe(110));
  });

  it("undoes and redoes block resize", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const frame = blockFrameForText("Hello");
    resizeFromHandle(frame, ".selection-handle.se", 40, 20);
    await waitFor(() => {
      const block = firstBlock();
      expect(block.w).toBe(280);
      expect(block.h).toBe(140);
    });

    clickUndo();
    await waitFor(() => {
      const block = firstBlock();
      expect(block.w).toBe(240);
      expect(block.h).toBe(120);
    });

    clickRedo();
    await waitFor(() => expect(firstBlock().w).toBe(280));
  });

  it("undoes and redoes block deletion", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const frame = blockFrameForText("Hello");
    selectBlockFrame(frame);
    fireEvent.keyDown(frame, { key: "Delete" });

    await waitFor(() => expect(readDocState().blocks).toHaveLength(0));
    clickUndo();
    await waitFor(() => expect(readDocState().blocks).toHaveLength(1));
    clickRedo();
    await waitFor(() => expect(readDocState().blocks).toHaveLength(0));
  });

  it("undoes and redoes page add, and a new edit after undo clears redo", async () => {
    render(<Harness initialBlocks={[]} initialPages={[createPage("page-1")]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    await waitFor(() => expect(readDocState().pages).toHaveLength(2));

    clickUndo();
    await waitFor(() => expect(readDocState().pages).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Redo" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    await waitFor(() => expect(readDocState().pages).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Redo" }).disabled).toBe(true);
  });

  it("undoes and redoes page deletion", async () => {
    render(<Harness initialBlocks={[]} initialPages={[createPage("page-1"), createPage("page-2", 900)]} initialCanvasHeight={1800} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "Page 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete page" }));

    await waitFor(() => expect(readDocState().pages).toHaveLength(1));
    clickUndo();
    await waitFor(() => expect(readDocState().pages).toHaveLength(2));
    clickRedo();
    await waitFor(() => expect(readDocState().pages).toHaveLength(1));
  });

  it("does not create history entries for selection-only changes", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello"), createTextBlock("text-2", "World", { x: 360 })]} initialPages={[createPage("page-1")]} />);

    selectBlockFrame(blockFrameForText("Hello"));
    selectBlockFrame(blockFrameForText("World"));

    expect(screen.getByRole("button", { name: "Undo" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Redo" }).disabled).toBe(true);
  });

  it("routes keyboard shortcuts through the manuscript history manager", async () => {
    render(<Harness initialBlocks={[createTextBlock("text-1", "Hello")]} initialPages={[createPage("page-1")]} />);

    const frame = blockFrameForText("Hello");
    dragFrame(frame, 30, 10);
    await waitFor(() => expect(firstBlock().x).toBe(90));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(firstBlock().x).toBe(60));

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() => expect(firstBlock().x).toBe(90));
  });
});
