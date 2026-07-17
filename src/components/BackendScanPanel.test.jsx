import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BackendScanPanel, ChartReviewPanel } from "./BackendScanPanel";

vi.mock("../charts/Plot.jsx", () => ({ Plot: () => null }));

function scanResult() {
  return {
    schemaVersion: "labrat.importScan.v1",
    summary: { sheetCount: 2, blockCount: 1, warningCount: 2 },
    file: { name: "runs.xlsx" },
    sheets: [{
      sheetId: "sheet_1",
      name: "Runs",
      usedRange: "A1:C3",
      rowCount: 3,
      columnCount: 3,
      layout: { type: "standard_table", confidence: 0.86 },
      candidateHeaders: [{
        range: "A1:C1",
        confidence: 0.9,
        columns: [
          { rawName: "Experiment" },
          { rawName: "Time", unit: "min" },
          { rawName: "Conversion", unit: "%" },
        ],
      }],
      candidateMetadata: [{
        rawKey: "Temperature",
        rawValue: "80 C",
        unit: "C",
        source: { sheet: "Runs", range: "A2" },
      }],
      blocks: [{
        blockId: "sheet_1_table_1",
        type: "standard_table",
        range: "A1:C3",
        confidence: 0.86,
        source: { sheet: "Runs", range: "A1:C3" },
        table: { rows: [{ rowIndex: 2 }, { rowIndex: 3 }] },
        warnings: [{ code: "no_data_rows", message: "No rows." }],
      }],
      warnings: [{ code: "unknown_layout", message: "Check layout.", range: "A1:C3" }],
    }],
    warnings: [],
  };
}

function chartProposalResult() {
  return {
    schemaVersion: "labrat.chartProposalResponse.v1",
    proposalSet: {
      proposalSetId: "chart_set_1",
      schemaVersion: "labrat.chartProposalSet.v1",
      proposals: [{
        proposalId: "chart_1",
        status: "proposed",
        origin: "source_extract",
        chartType: "scatter",
        title: "Conversion vs Time",
        x: { field: "time", label: "Time", unit: "min" },
        y: { field: "conversion", label: "Conversion", unit: "%" },
        sourceSnapshot: { rows: [{ values: { time: 0, conversion: 12 } }] },
        rationale: "Resolved from accepted workbook source evidence.",
        confidence: 0.88,
        warnings: [],
      }],
      warnings: [],
    },
    summary: { proposalCount: 1, warningCount: 0 },
    warnings: [],
  };
}

function chartInterpretResult() {
  return {
    schemaVersion: "labrat.chartInterpretResponse.v1",
    chartSpecDraft: {
      schemaVersion: "labrat.chartSpec.v1.4",
      status: "proposed",
      origin: "source_extract",
      chartType: "scatter",
      title: "Conversion vs Time",
      x: { field: "time", label: "Time", unit: "min" },
      y: { field: "conversion", label: "Conversion", unit: "%" },
      sourceSnapshot: { rows: [{ values: { time: 0, conversion: 12 } }] },
      rationale: "Resolved from accepted workbook source evidence.",
      confidence: 0.88,
      warnings: [],
      filters: [],
      sourceRefs: [],
    },
    clarification: null,
    warnings: [],
  };
}

function persistedChartInterpretResult(status = "proposed") {
  const result = chartInterpretResult();
  const proposal = {
    ...result.chartSpecDraft,
    schemaVersion: "labrat.chartProposal.v1",
    proposalId: "chart_interpret_1",
    status,
  };
  return {
    ...result,
    chartProposalSet: {
      id: "chart_proposal_set_interpret_1",
      payload: {
        proposalSetId: "chart_proposal_set_interpret_1",
        schemaVersion: "labrat.chartProposalSet.v1",
        proposals: [proposal],
        warnings: [],
      },
    },
  };
}

function chartProposalStateFromInterpret(result) {
  return {
    result: {
      ...result,
      proposalSet: {
        ...result.chartProposalSet.payload,
        serverId: result.chartProposalSet.id,
      },
    },
  };
}

function chartClarificationResult() {
  return {
    schemaVersion: "labrat.chartInterpretResponse.v1",
    chartSpecDraft: null,
    clarification: {
      message: "Which measurement should be plotted?",
      options: [{ fieldId: "field_1", label: "Conversion", role: "measurement" }],
    },
    warnings: [],
  };
}

function sourceDocumentsResult() {
  return {
    sourceDocuments: [
      {
        id: "source_doc_other",
        metadata: {
          workbookName: "other.xlsx",
          sheetNames: ["Other"],
          sheets: [{ name: "Other", usedRange: "A1:A1", rowCount: 1, columnCount: 1 }],
        },
        summary: { sheetCount: 1, regionCount: 0, nonEmptyCellCount: 1 },
        warnings: [],
      },
      {
        id: "source_doc_runs",
        metadata: {
          workbookName: "runs.xlsx",
          sheetNames: ["Runs"],
          sheets: [{ name: "Runs", usedRange: "A1:B2", rowCount: 2, columnCount: 2 }],
        },
        summary: { sheetCount: 1, regionCount: 1, nonEmptyCellCount: 4 },
        warnings: [],
      },
    ],
  };
}

function sourceRegionsResult() {
  return {
    regions: [{
      id: "source_region_1",
      kind: "standard_table",
      label: "Runs table",
      sheetName: "Runs",
      rangeRef: "A1:B2",
      confidence: 0.91,
      candidateFields: [{ displayName: "Experiment" }, { displayName: "Temperature" }],
      warnings: [{ code: "review_units", message: "Confirm units before applying." }],
    }],
  };
}

function sourceRangeResult(range = "A1:B2") {
  return {
    schemaVersion: "labrat.sourceRange.v1",
    sourceDocumentId: "source_doc_runs",
    sheetName: "Runs",
    range,
    rowCount: 2,
    columnCount: 2,
    rows: [
      [
        { address: "A1", row: 0, col: 0, rawValue: "Label", formattedValue: "Label" },
        { address: "B1", row: 0, col: 1, rawValue: "Temperature", formattedValue: "Temperature" },
      ],
      [
        { address: "A2", row: 1, col: 0, rawValue: "Exp30", formattedValue: "Exp30" },
        { address: "B2", row: 1, col: 1, rawValue: 250, formattedValue: "250" },
      ],
    ],
    cells: [],
    warnings: [],
  };
}

function testColumnLabelToIndex(label) {
  return String(label || "").toUpperCase().split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function testIndexToColumnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function testParseRange(range) {
  const [startText, endText = startText] = String(range).split(":");
  const start = startText.match(/^([A-Z]+)(\d+)$/i);
  const end = endText.match(/^([A-Z]+)(\d+)$/i);
  return {
    startRow: Number(start[2]) - 1,
    endRow: Number(end[2]) - 1,
    startCol: testColumnLabelToIndex(start[1]),
    endCol: testColumnLabelToIndex(end[1]),
  };
}

function testRangeCellCount(range) {
  const bounds = testParseRange(range);
  return (bounds.endRow - bounds.startRow + 1) * (bounds.endCol - bounds.startCol + 1);
}

function sourceRangeWindowResult(range = "A1:B2") {
  const bounds = testParseRange(range);
  const rows = [];
  for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
    const cells = [];
    for (let col = bounds.startCol; col <= bounds.endCol; col += 1) {
      cells.push({
        address: `${testIndexToColumnLabel(col)}${row + 1}`,
        row,
        col,
        rawValue: `R${row + 1}C${col + 1}`,
        formattedValue: `R${row + 1}C${col + 1}`,
      });
    }
    rows.push(cells);
  }
  return {
    schemaVersion: "labrat.sourceRange.v1",
    sourceDocumentId: "source_doc_runs",
    sheetName: "Runs",
    range,
    rowCount: bounds.endRow - bounds.startRow + 1,
    columnCount: bounds.endCol - bounds.startCol + 1,
    cellCount: testRangeCellCount(range),
    rows,
    cells: [],
    warnings: [],
  };
}

function largeSourceDocumentsResult() {
  return {
    sourceDocuments: [{
      id: "source_doc_runs",
      metadata: {
        workbookName: "runs.xlsx",
        sheetNames: ["Runs"],
        sheets: [{ name: "Runs", usedRange: "A1:Y63", rowCount: 63, columnCount: 25 }],
      },
      summary: { sheetCount: 1, regionCount: 1, nonEmptyCellCount: 1575 },
      warnings: [],
    }],
  };
}

function largeSourceRegionsResult() {
  return {
    regions: [{
      id: "source_region_large",
      kind: "standard_table",
      label: "Large detected table",
      sheetName: "Runs",
      rangeRef: "A1:Y63",
      confidence: 0.87,
      candidateFields: [{ displayName: "Label" }, { displayName: "Date" }],
      warnings: [],
    }],
  };
}

function sourceExtractPreviewResult() {
  return {
    preview: {
      fields: [
        { fieldId: "component", label: "Component" },
        { fieldId: "percentage", label: "Percentage" },
      ],
      rows: [{
        rowId: "component_1",
        label: "C1",
        values: { component: "C1", percentage: 5 },
        cells: { component: "A1", percentage: "B2" },
      }],
      warnings: [],
    },
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}

function makeSourceWorkbookFetch() {
  return vi.fn(async (url, options = {}) => {
    if (url === "/api/projects/project_1/source-documents") {
      return jsonResponse(sourceDocumentsResult());
    }
    if (url === "/api/source-documents/source_doc_runs/regions") {
      return jsonResponse(sourceRegionsResult());
    }
    if (url === "/api/source-documents/source_doc_other/regions") {
      return jsonResponse({ regions: [] });
    }
    if (url === "/api/source-documents/source_doc_runs/range") {
      const request = JSON.parse(options.body || "{}");
      return jsonResponse(sourceRangeResult(request.range || "A1:B2"));
    }
    if (url === "/api/source-documents/source_doc_runs/extract-preview") {
      return jsonResponse(sourceExtractPreviewResult());
    }
    if (url === "/api/source-regions/source_region_1/extract-preview") {
      return jsonResponse(sourceExtractPreviewResult());
    }
    return jsonResponse({
      error: { code: "unexpected_test_request", message: `Unexpected request: ${url}` },
    }, { status: 404 });
  });
}

function makeLargeSourceWorkbookFetch() {
  return vi.fn(async (url, options = {}) => {
    if (url === "/api/projects/project_1/source-documents") {
      return jsonResponse(largeSourceDocumentsResult());
    }
    if (url === "/api/source-documents/source_doc_runs/regions") {
      return jsonResponse(largeSourceRegionsResult());
    }
    if (url === "/api/source-documents/source_doc_runs/range") {
      const request = JSON.parse(options.body || "{}");
      return jsonResponse(sourceRangeWindowResult(request.range || "A1:B2"));
    }
    if (url === "/api/source-documents/source_doc_runs/extract-preview") {
      return jsonResponse(sourceExtractPreviewResult());
    }
    return jsonResponse({
      error: { code: "unexpected_test_request", message: `Unexpected request: ${url}` },
    }, { status: 404 });
  });
}

function restoreFetch(originalFetch) {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }
}

describe("BackendScanPanel", () => {
  it("shows source workbook review with document picker and detected source regions", async () => {
    const fetchMock = makeSourceWorkbookFetch();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      render(<BackendScanPanel projectId="project_1" scanState={{ fileName: "runs.xlsx", result: scanResult() }} />);

      await waitFor(() => expect(screen.getByText("Source workbook")).toBeTruthy());
      await waitFor(() => expect(screen.getByText("Runs table")).toBeTruthy());

      expect(screen.getByLabelText("Source document").value).toBe("source_doc_runs");
      expect(screen.getAllByText("runs.xlsx").length).toBeGreaterThan(0);
      expect(screen.getByText("other.xlsx")).toBeTruthy();
      expect(screen.getByLabelText("Sheet").value).toBe("Runs");
      expect(screen.getByLabelText("Range").value).toBe("A1:B2");
      expect(screen.getByText("Detected source regions")).toBeTruthy();
      expect(screen.getByText("detected source region")).toBeTruthy();
      expect(screen.getByText(/Runs - A1:B2/)).toBeTruthy();
      expect(screen.getByText("Fields: Experiment, Temperature")).toBeTruthy();
      expect(screen.getByText("review_units")).toBeTruthy();
    } finally {
      restoreFetch(originalFetch);
    }
  });

  it("renders bounded source range cells from a detected region", async () => {
    const fetchMock = makeSourceWorkbookFetch();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      render(<BackendScanPanel projectId="project_1" scanState={{ fileName: "runs.xlsx", result: scanResult() }} />);

      await waitFor(() => expect(screen.getByRole("button", { name: "Read detected range" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Read detected range" }));

      await waitFor(() => expect(screen.getByLabelText("Source range grid")).toBeTruthy());
      expect(screen.getByText("Label")).toBeTruthy();
      expect(screen.getAllByText("Temperature").length).toBeGreaterThan(0);
      expect(screen.getByText("Exp30")).toBeTruthy();
      expect(screen.getByText("250")).toBeTruthy();

      const rangeCall = fetchMock.mock.calls.find(([url]) => url === "/api/source-documents/source_doc_runs/range");
      expect(JSON.parse(rangeCall[1].body)).toEqual({ sheetName: "Runs", range: "A1:B2" });
    } finally {
      restoreFetch(originalFetch);
    }
  });

  it("marks manual range reads as local draft selections without persistence mutations", async () => {
    const fetchMock = makeSourceWorkbookFetch();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      render(<BackendScanPanel projectId="project_1" scanState={{ fileName: "runs.xlsx", result: scanResult() }} />);

      await waitFor(() => expect(screen.getByLabelText("Range")).toBeTruthy());
      const rangeInput = screen.getByLabelText("Range");
      fireEvent.change(rangeInput, { target: { value: "B1:B2" } });
      await waitFor(() => expect(rangeInput.value).toBe("B1:B2"));
      fireEvent.click(screen.getByRole("button", { name: "Preview local draft range" }));

      await waitFor(() => expect(screen.getByText("local draft selection")).toBeTruthy());
      expect(screen.getByText("Runs - B1:B2")).toBeTruthy();
      expect(screen.getByText(/Draft red box/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Create source extract proposal/i })).toBeNull();
      const requestedUrls = fetchMock.mock.calls.map(([url]) => url).join("\n");
      expect(requestedUrls).not.toContain("import-review-sessions");
      expect(requestedUrls).not.toContain("source-extract-proposals");
      expect(requestedUrls).not.toContain("chart-specs");
      const rangeCall = fetchMock.mock.calls.find(([url, options]) => (
        url === "/api/source-documents/source_doc_runs/range"
        && JSON.parse(options.body || "{}").range === "B1:B2"
      ));
      expect(rangeCall).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Preview selected range extract" }));
      await waitFor(() => expect(screen.getByText("Component: C1 / Percentage: 5")).toBeTruthy());
      const extractCall = fetchMock.mock.calls.find(([url, options]) => (
        url === "/api/source-documents/source_doc_runs/extract-preview"
        && JSON.parse(options.body || "{}").range === "B1:B2"
      ));
      expect(extractCall).toBeTruthy();
    } finally {
      restoreFetch(originalFetch);
    }
  });

  it("preserves a manual range entered while detected regions are still loading", async () => {
    let resolveRegions;
    const regionsResponse = new Promise((resolve) => {
      resolveRegions = resolve;
    });
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === "/api/projects/project_1/source-documents") {
        return jsonResponse(sourceDocumentsResult());
      }
      if (url === "/api/source-documents/source_doc_runs/regions") {
        return regionsResponse;
      }
      if (url === "/api/source-documents/source_doc_runs/range") {
        const request = JSON.parse(options.body || "{}");
        return jsonResponse(sourceRangeResult(request.range || "A1:B2"));
      }
      return jsonResponse({ regions: [] });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      render(<BackendScanPanel projectId="project_1" scanState={{ fileName: "runs.xlsx", result: scanResult() }} />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        "/api/source-documents/source_doc_runs/regions",
        expect.anything(),
      ));
      const rangeInput = screen.getByLabelText("Range");
      fireEvent.change(rangeInput, { target: { value: "B1:B2" } });
      expect(rangeInput.value).toBe("B1:B2");

      resolveRegions(jsonResponse(sourceRegionsResult()));

      await waitFor(() => expect(screen.getByText("Runs table")).toBeTruthy());
      expect(rangeInput.value).toBe("B1:B2");
    } finally {
      restoreFetch(originalFetch);
    }
  });

  it("previews source region extracts as inspectable rows", async () => {
    const fetchMock = makeSourceWorkbookFetch();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      render(<BackendScanPanel projectId="project_1" scanState={{ fileName: "runs.xlsx", result: scanResult() }} />);

      await waitFor(() => expect(screen.getByRole("button", { name: "Preview extract" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Preview extract" }));

      await waitFor(() => expect(screen.getByText("Component: C1 / Percentage: 5")).toBeTruthy());
      expect(screen.getByText("Cells: component: A1, percentage: B2")).toBeTruthy();
      const requestedUrls = fetchMock.mock.calls.map(([url]) => url).join("\n");
      expect(requestedUrls).toContain("/api/source-regions/source_region_1/extract-preview");
      expect(requestedUrls).not.toContain("source-extract-proposals");
      expect(requestedUrls).not.toContain("chart-specs");
    } finally {
      restoreFetch(originalFetch);
    }
  });

  it("loads large detected source regions through bounded sheet windows", async () => {
    const fetchMock = makeLargeSourceWorkbookFetch();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      render(<BackendScanPanel projectId="project_1" scanState={{ fileName: "runs.xlsx", result: scanResult() }} />);

      await waitFor(() => expect(screen.getByText("Large detected table")).toBeTruthy());
      await waitFor(() => expect(screen.getByText(/Loaded window:/)).toBeTruthy());

      expect(screen.getByText("Selected range: A1:Y63")).toBeTruthy();
      expect(screen.getByText("63 rows x 25 columns")).toBeTruthy();
      expect(screen.queryByText(/maximum is 500/)).toBeNull();
      expect(screen.getByRole("button", { name: "Preview extract" }).disabled).toBe(true);
      expect(screen.getByText(/select a smaller local draft range/i)).toBeTruthy();
      const rangeBodies = fetchMock.mock.calls
        .filter(([url]) => url === "/api/source-documents/source_doc_runs/range")
        .map(([, options]) => JSON.parse(options.body || "{}"));
      expect(rangeBodies.length).toBeGreaterThan(0);
      expect(rangeBodies.some((body) => body.range === "A1:Y63")).toBe(false);
      expect(rangeBodies.every((body) => testRangeCellCount(body.range) <= 480)).toBe(true);
      expect(screen.getByText("R1C1")).toBeTruthy();
    } finally {
      restoreFetch(originalFetch);
    }
  });

  it("focuses later sheet ranges by requesting a later bounded window", async () => {
    const fetchMock = makeLargeSourceWorkbookFetch();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      render(<BackendScanPanel projectId="project_1" scanState={{ fileName: "runs.xlsx", result: scanResult() }} />);

      await waitFor(() => expect(screen.getByText(/Loaded window: A1/)).toBeTruthy());
      const rangeInput = screen.getByLabelText("Range");
      fireEvent.change(rangeInput, { target: { value: "L32:Y63" } });
      await waitFor(() => expect(rangeInput.value).toBe("L32:Y63"));

      await waitFor(() => {
        const rangeBodies = fetchMock.mock.calls
          .filter(([url]) => url === "/api/source-documents/source_doc_runs/range")
          .map(([, options]) => JSON.parse(options.body || "{}"));
        expect(rangeBodies.some((body) => {
          const bounds = testParseRange(body.range);
          return bounds.startRow > 0 && bounds.startCol > 0 && testRangeCellCount(body.range) <= 480;
        })).toBe(true);
      });
    } finally {
      restoreFetch(originalFetch);
    }
  });

  it("shows chart proposals as review-only cards", () => {
    const onChartProposalDecision = vi.fn();
    render(
      <ChartReviewPanel
        chartProposalState={{ result: chartProposalResult() }}
        onChartProposalDecision={onChartProposalDecision}
      />,
    );

    const buttons = screen.getAllByText("Accept");
    fireEvent.click(buttons[buttons.length - 1]);
    const rejectButtons = screen.getAllByText("Reject");
    fireEvent.click(rejectButtons[rejectButtons.length - 1]);

    expect(onChartProposalDecision).toHaveBeenCalledWith("chart_1", "accepted");
    expect(onChartProposalDecision).toHaveBeenCalledWith("chart_1", "rejected");
    expect(screen.getByText("Conversion vs Time")).toBeTruthy();
    expect(screen.getByText("X: Time (min) - Y: Conversion (%)")).toBeTruthy();
  });

  it("marks the focused chart proposal card for edit review", () => {
    render(
      <ChartReviewPanel
        chartProposalState={{ result: chartProposalResult() }}
        focusProposalId="chart_1"
      />,
    );

    const proposalCard = screen.getByText("Conversion vs Time").closest(".backend-chart-proposal-card");
    expect(proposalCard?.className).toContain("is-focused-proposal");
  });

  it("filters chart proposals to accepted and pending in active review mode", () => {
    const result = chartProposalResult();
    result.proposalSet.proposals = [
      result.proposalSet.proposals[0],
      {
        ...result.proposalSet.proposals[0],
        proposalId: "chart_accepted",
        status: "accepted",
        title: "Accepted Chart",
      },
      {
        ...result.proposalSet.proposals[0],
        proposalId: "chart_rejected",
        status: "rejected",
        title: "Rejected Chart",
      },
    ];

    render(
      <ChartReviewPanel
        chartProposalState={{ result }}
        statusFilter="active"
      />,
    );

    expect(screen.getByText("Accepted + pending charts")).toBeTruthy();
    expect(screen.getAllByText("2 active").length).toBeGreaterThan(0);
    expect(screen.getByText("Conversion vs Time")).toBeTruthy();
    expect(screen.getByText("Accepted Chart")).toBeTruthy();
    expect(screen.queryByText("Rejected Chart")).toBeNull();
  });

  it("shows active proposals in Edit specs mode with review and delete actions", () => {
    const onChartProposalDecision = vi.fn();
    const onChartProposalDelete = vi.fn();
    const onCreateChartSpec = vi.fn();
    const result = chartProposalResult();
    result.proposalSet.serverId = "chart_set_server_1";
    result.proposalSet.proposals = [
      result.proposalSet.proposals[0],
      {
        ...result.proposalSet.proposals[0],
        proposalId: "chart_accepted",
        status: "accepted",
        title: "Accepted Chart",
      },
      {
        ...result.proposalSet.proposals[0],
        proposalId: "chart_accepted_new",
        status: "accepted",
        title: "Accepted New Chart",
      },
      {
        ...result.proposalSet.proposals[0],
        proposalId: "chart_rejected",
        status: "rejected",
        title: "Rejected Chart",
      },
    ];

    render(
      <ChartReviewPanel
        chartProposalState={{ result }}
        chartSpecs={[{
          id: "chart_spec_accepted",
          sourceChartProposalSetId: "chart_set_server_1",
          sourceProposalId: "chart_accepted",
        }]}
        viewMode="edit"
        onChartProposalDecision={onChartProposalDecision}
        onChartProposalDelete={onChartProposalDelete}
        onCreateChartSpec={onCreateChartSpec}
      />,
    );

    expect(screen.getByText("Edit specs")).toBeTruthy();
    expect(screen.getAllByText("3 active").length).toBeGreaterThan(0);
    expect(screen.getByText("Conversion vs Time")).toBeTruthy();
    expect(screen.getByText("Accepted Chart")).toBeTruthy();
    expect(screen.getByText("Accepted New Chart")).toBeTruthy();
    expect(screen.queryByText("Rejected Chart")).toBeNull();

    const pendingRow = screen.getByText("Conversion vs Time").closest(".chart-spec-row-card");
    fireEvent.click(within(pendingRow).getByRole("button", { name: "Accept" }));
    fireEvent.click(within(pendingRow).getByRole("button", { name: "Reject" }));
    fireEvent.click(within(pendingRow).getByRole("button", { name: "Delete" }));

    const acceptedRow = screen.getByText("Accepted Chart").closest(".chart-spec-row-card");
    expect(within(acceptedRow).queryByRole("button", { name: "Accept" })).toBeNull();
    expect(within(acceptedRow).getByRole("button", { name: "Chart spec created" }).disabled).toBe(true);
    expect(within(acceptedRow).getByRole("button", { name: "Delete" })).toBeTruthy();
    fireEvent.click(within(acceptedRow).getByRole("button", { name: "Reject" }));

    const acceptedNewRow = screen.getByText("Accepted New Chart").closest(".chart-spec-row-card");
    fireEvent.click(within(acceptedNewRow).getByRole("button", { name: "Create chart spec" }));

    expect(onChartProposalDecision).toHaveBeenCalledWith("chart_1", "accepted");
    expect(onChartProposalDecision).toHaveBeenCalledWith("chart_1", "rejected");
    expect(onChartProposalDecision).toHaveBeenCalledWith("chart_accepted", "rejected");
    expect(onChartProposalDelete).toHaveBeenCalledWith("chart_1");
    expect(onCreateChartSpec).toHaveBeenCalledWith("chart_set_server_1", "chart_accepted_new");
  });

  it("sends explicit source chart prompts and shows ChartSpec drafts", () => {
    const onInterpretChart = vi.fn();
    render(
      <ChartReviewPanel
        allowSourcePrompt
        chartInterpretState={{ result: chartInterpretResult() }}
        onInterpretChart={onInterpretChart}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. plot carbon distribution from Sheet1!P31:BA32 in Calculation_Exp33.xlsx"), {
      target: { value: "plot conversion vs time from Runs!A1:B3 in runs.xlsx" },
    });
    fireEvent.click(screen.getByText("Draft chart proposal"));

    expect(onInterpretChart).toHaveBeenCalledWith("plot conversion vs time from Runs!A1:B3 in runs.xlsx");
    expect(screen.getAllByText("Conversion vs Time").length).toBeGreaterThan(0);
    expect(screen.getByText("Resolved from accepted workbook source evidence.")).toBeTruthy();
    expect(screen.getByText(/Preview-only source draft/)).toBeTruthy();
  });

  it("renders project-scoped interpreted chart proposals in the proposal review", () => {
    const onChartProposalDecision = vi.fn();
    const interpretedResult = persistedChartInterpretResult();
    render(
      <ChartReviewPanel
        chartInterpretState={{ result: interpretedResult }}
        chartProposalState={chartProposalStateFromInterpret(interpretedResult)}
        onChartProposalDecision={onChartProposalDecision}
      />,
    );

    expect(screen.getByText("Chart proposal queued")).toBeTruthy();
    expect(screen.queryByText(/Preview-only draft/)).toBeNull();
    expect(screen.getAllByText("Conversion vs Time").length).toBeGreaterThan(0);
    expect(screen.getByText("Resolved from accepted workbook source evidence.")).toBeTruthy();

    const acceptButtons = screen.getAllByText("Accept");
    fireEvent.click(acceptButtons[acceptButtons.length - 1]);
    const rejectButtons = screen.getAllByText("Reject");
    fireEvent.click(rejectButtons[rejectButtons.length - 1]);

    expect(onChartProposalDecision).toHaveBeenCalledWith("chart_interpret_1", "accepted");
    expect(onChartProposalDecision).toHaveBeenCalledWith("chart_interpret_1", "rejected");
  });

  it("creates chart specs from accepted interpreted chart proposals", () => {
    const onCreateChartSpec = vi.fn();
    const interpretedResult = persistedChartInterpretResult("accepted");
    render(
      <ChartReviewPanel
        chartInterpretState={{ result: interpretedResult }}
        chartProposalState={chartProposalStateFromInterpret(interpretedResult)}
        onCreateChartSpec={onCreateChartSpec}
      />,
    );

    fireEvent.click(screen.getByText("Create chart spec"));

    expect(onCreateChartSpec).toHaveBeenCalledWith("chart_proposal_set_interpret_1", "chart_interpret_1");
  });

  it("does not treat the same proposal id from another proposal set as an existing chart spec", () => {
    const onCreateChartSpec = vi.fn();
    const interpretedResult = persistedChartInterpretResult("accepted");
    render(
      <ChartReviewPanel
        chartInterpretState={{ result: interpretedResult }}
        chartProposalState={chartProposalStateFromInterpret(interpretedResult)}
        chartSpecs={[{
          id: "chart_spec_old",
          sourceChartProposalSetId: "chart_proposal_set_interpret_old",
          sourceProposalId: "chart_interpret_1",
        }]}
        onCreateChartSpec={onCreateChartSpec}
      />,
    );

    const createButton = screen.getByText("Create chart spec");
    expect(createButton.disabled).toBe(false);
    fireEvent.click(createButton);

    expect(onCreateChartSpec).toHaveBeenCalledWith("chart_proposal_set_interpret_1", "chart_interpret_1");
  });

  it("shows chart intent clarification options", () => {
    render(
      <ChartReviewPanel
        chartInterpretState={{ result: chartClarificationResult() }}
      />,
    );

    expect(screen.getByText("Need clarification")).toBeTruthy();
    expect(screen.getByText("Which measurement should be plotted?")).toBeTruthy();
    expect(screen.getByText("Conversion")).toBeTruthy();
  });

  it("shows source extract proposal results from the unified chart intent path", () => {
    const onSourceExtractDecision = vi.fn();
    const onCreateChartProposalFromSourceExtract = vi.fn();
    render(
      <ChartReviewPanel
        allowSourcePrompt
        chartInterpretState={{
          result: {
            schemaVersion: "labrat.chartInterpretResponse.v1",
            chartSpecDraft: null,
            chartProposalSet: null,
            sourceExtractProposal: {
              id: "source_extract_33",
              extractType: "component_distribution",
              status: "accepted",
              preview: {
                fields: [
                  { fieldId: "carbon_number", label: "Carbon number" },
                  { fieldId: "percentage", label: "Percentage" },
                ],
                range: { sheetName: "Sheet1", range: "P31:BA32" },
                rows: [{
                  rowId: "component_1",
                  label: "C1",
                  values: { carbon_number: 1, percentage: 5 },
                  cells: { carbon_number: "Q31", percentage: "Q32" },
                }],
              },
              warnings: [{ code: "review_units", message: "Review units before charting." }],
            },
            warnings: [{ code: "review_units", message: "Review units before charting." }],
          },
        }}
        onSourceExtractDecision={onSourceExtractDecision}
        onCreateChartProposalFromSourceExtract={onCreateChartProposalFromSourceExtract}
      />,
    );

    expect(screen.getByText("Source extract proposal created")).toBeTruthy();
    expect(screen.getByText("component_distribution - accepted")).toBeTruthy();
    expect(screen.getByText(/Review the extracted source data before charting/)).toBeTruthy();
    expect(screen.getByText("Source: Sheet1 - P31:BA32")).toBeTruthy();
    expect(screen.getByText("C1")).toBeTruthy();
    expect(screen.getByText("Carbon number: 1 / Percentage: 5")).toBeTruthy();
    expect(screen.getByText("Cells: carbon_number: Q31, percentage: Q32")).toBeTruthy();
    expect(screen.getAllByText("review_units")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Create chart proposal" }));
    expect(onCreateChartProposalFromSourceExtract).toHaveBeenCalledWith("source_extract_33");
    expect(screen.queryByRole("button", { name: "Accept source extract" })).toBeNull();
  });

  it("can accept or reject proposed source extract proposals before charting", () => {
    const onSourceExtractDecision = vi.fn();
    render(
      <ChartReviewPanel
        allowSourcePrompt
        chartInterpretState={{
          result: {
            schemaVersion: "labrat.chartInterpretResponse.v1",
            sourceExtractProposal: {
              id: "source_extract_33",
              extractType: "component_distribution",
              status: "proposed",
              preview: {
                range: { sheetName: "Sheet1", range: "P31:BA32" },
                rows: [{ rowId: "component_1", label: "C1", values: { percentage: 5 }, cells: { percentage: "Q32" } }],
              },
              warnings: [],
            },
            warnings: [],
          },
        }}
        onSourceExtractDecision={onSourceExtractDecision}
      />,
    );

    const createButton = screen.getByRole("button", { name: "Create chart proposal" });
    expect(createButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Accept source extract" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onSourceExtractDecision).toHaveBeenCalledWith("source_extract_33", "accepted");
    expect(onSourceExtractDecision).toHaveBeenCalledWith("source_extract_33", "rejected");
  });
});
