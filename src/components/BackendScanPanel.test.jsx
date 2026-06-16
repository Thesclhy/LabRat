import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

function normalizeResult() {
  return {
    schemaVersion: "labrat.importNormalize.v1",
    datasetPatch: {
      genericImports: [{
        importId: "import_1",
        fileName: "runs.xlsx",
        approvedBlockIds: ["sheet_1_table_1"],
        experiments: [{ experimentId: "generic_exp_1" }],
        measurements: [{ measurementId: "measurement_1", displayName: "Conversion (%)" }],
        sources: [{ sourceRef: "src_1" }],
        files: [{ fileId: "upload_1" }],
        warnings: [],
      }],
    },
    summary: { genericImportCount: 1, createdExperiments: 1, createdMeasurements: 1, warningCount: 0 },
    warnings: [],
  };
}

function observationNormalizeResult() {
  return {
    schemaVersion: "labrat.importNormalize.v1",
    datasetPatch: {
      genericImports: [{
        importId: "import_reaction_rate",
        fileName: "Reaction_Rate_Exp30.xlsx",
        approvedBlockIds: ["sheet_1_table_1"],
        experiments: [],
        observationSets: [{
          observationSetId: "obsset_1",
          kind: "reaction_rate_time_series",
          inferredExperimentLabel: "Exp30",
          fields: [
            { displayName: "Reaction Time (min)" },
            { displayName: "Adjusted Rate (M/s)" },
          ],
          observations: [{ observationId: "obs_1" }, { observationId: "obs_2" }],
          summary: { observationCount: 2, timeMin: 0, timeMax: 10 },
        }],
        fields: [
          { fieldValueId: "time_1", displayName: "Reaction Time (min)", role: "condition", recordKind: "observation" },
          { fieldValueId: "rate_1", displayName: "Adjusted Rate (M/s)", role: "measurement", recordKind: "observation" },
        ],
        measurements: [{ measurementId: "rate_1", displayName: "Adjusted Rate (M/s)", recordKind: "observation" }],
        sources: [{ sourceRef: "src_1" }],
        files: [{ fileId: "upload_1" }],
        warnings: [],
      }],
    },
    summary: { genericImportCount: 1, createdExperiments: 0, createdFields: 2, createdMeasurements: 1, warningCount: 0 },
    warnings: [],
  };
}

function refreshPreviewResult(overrides = {}) {
  return {
    schemaVersion: "labrat.importRefreshPreview.v1",
    targetImportId: "import_old",
    replacementImportId: "import_1",
    parentDatasetCommitId: "commit_parent",
    hasChanges: true,
    summary: {
      experimentsAdded: 1,
      experimentsRemoved: 0,
      experimentsChanged: 2,
      fieldsAdded: 1,
      fieldsRemoved: 0,
      valuesChanged: 4,
      warningsChanged: 0,
    },
    warnings: [],
    ...overrides,
  };
}

function relationshipPreviewResult(overrides = {}) {
  return {
    schemaVersion: "labrat.importRelationshipPreview.v1",
    projectId: "project_1",
    parentDatasetCommitId: "commit_parent",
    importRunId: "import_run_1",
    proposals: [{
      relationshipProposalId: "relationship_1",
      importRunId: "import_run_1",
      importId: "import_1",
      proposedRelationship: "supplement",
      supplementType: "reaction_rate_time_series",
      targetExperimentIds: ["generic_exp_30"],
      evidence: ["Matched existing experiment Exp30.", "Filename contains an experiment-like label."],
      confidence: 0.91,
      warnings: [],
      status: "proposed",
    }],
    summary: { proposalCount: 1, supplementCount: 1, replaceCount: 0, standaloneCount: 0 },
    warnings: [],
    ...overrides,
  };
}

function mappingResult() {
  return {
    schemaVersion: "labrat.semanticMappingResponse.v1",
    mappingSet: {
      mappingSetId: "mapping_set_1",
      schemaVersion: "labrat.semanticMappingSet.v1",
      sourceImportIds: ["import_1"],
      mappings: [{
        mappingId: "mapping_1",
        status: "proposed",
        rawLabel: "Conversion",
        canonicalField: "conversion",
        semanticRole: "response",
        valueType: "numeric",
        unit: "%",
        confidence: 0.86,
        rationale: "Label appears to be a measured response.",
        warnings: [],
      }],
      warnings: [],
    },
    summary: { proposalCount: 1, warningCount: 0 },
    warnings: [],
  };
}

function chartProposalResult() {
  return {
    schemaVersion: "labrat.chartProposalResponse.v1",
    proposalSet: {
      proposalSetId: "chart_set_1",
      schemaVersion: "labrat.chartProposalSet.v1",
      sourceImportIds: ["import_1"],
      proposals: [{
        proposalId: "chart_1",
        status: "proposed",
        chartType: "scatter",
        title: "Conversion vs Time",
        x: { label: "Time", unit: "min", measurementIds: ["time_1"] },
        y: { label: "Conversion", unit: "%", measurementIds: ["measurement_1"] },
        rationale: "Time and conversion are numeric fields.",
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
      schemaVersion: "labrat.chartSpecDraft.v1",
      status: "proposed",
      chartType: "scatter",
      title: "Conversion vs Time",
      x: { label: "Time", unit: "min", sourceIds: ["time_1"] },
      y: { label: "Conversion", unit: "%", sourceIds: ["measurement_1"] },
      yFields: [{ label: "Conversion", unit: "%", sourceIds: ["measurement_1"] }],
      groupBy: { label: "Catalyst Type", sourceIds: ["cat_1"] },
      rationale: "Resolved from prompt.",
      confidence: 0.88,
      warnings: [],
      filters: [],
      sourceRefs: [],
      sourceImportIds: ["import_1"],
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
    sourceImportIds: ["import_1"],
    x: { label: "Time", unit: "min", measurementIds: ["time_1"], sourceIds: ["time_1"] },
    y: { label: "Conversion", unit: "%", measurementIds: ["measurement_1"], sourceIds: ["measurement_1"] },
    yFields: [{ label: "Conversion", unit: "%", measurementIds: ["measurement_1"], sourceIds: ["measurement_1"] }],
  };
  return {
    ...result,
    chartProposalSet: {
      id: "chart_proposal_set_interpret_1",
      payload: {
        proposalSetId: "chart_proposal_set_interpret_1",
        schemaVersion: "labrat.chartProposalSet.v1",
        sourceImportIds: ["import_1"],
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

describe("BackendScanPanel", () => {
  it("calls onScanFile when a workbook is selected", () => {
    const onScanFile = vi.fn();
    render(<BackendScanPanel scanState={{}} onScanFile={onScanFile} />);
    const file = new File(["workbook"], "runs.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    fireEvent.change(screen.getByLabelText("Scan workbook"), { target: { files: [file] } });

    expect(onScanFile).toHaveBeenCalledWith(file);
  });

  it("shows loading state and disables the upload input", () => {
    render(<BackendScanPanel scanState={{ loading: true, fileName: "runs.xlsx" }} />);

    expect(screen.getByText("scanning")).toBeTruthy();
    expect(screen.getByLabelText("Scanning...").disabled).toBe(true);
    expect(screen.getByText("runs.xlsx")).toBeTruthy();
  });

  it("shows backend scan result summary and raw debug JSON", () => {
    render(<BackendScanPanel scanState={{ fileName: "runs.xlsx", result: scanResult() }} />);

    expect(screen.getByText("ready")).toBeTruthy();
    expect(screen.getAllByText("2 sheets").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 blocks").length).toBeGreaterThan(0);
    expect(screen.getByText("2 warnings")).toBeTruthy();
    expect(screen.getByText(/labrat\.importScan\.v1/)).toBeTruthy();
  });

  it("shows formatted sheet layout, headers, metadata, blocks, warnings, and ranges", () => {
    render(<BackendScanPanel scanState={{ fileName: "runs.xlsx", result: scanResult() }} />);

    expect(screen.getByText("Runs")).toBeTruthy();
    expect(screen.getAllByText("standard_table - 86%").length).toBeGreaterThan(0);
    expect(screen.getByText("3 rows")).toBeTruthy();
    expect(screen.getByText("3 columns")).toBeTruthy();
    expect(screen.getByText("A1:C1")).toBeTruthy();
    expect(screen.getByText("Experiment, Time [min], Conversion [%]")).toBeTruthy();
    expect(screen.getByText("Temperature")).toBeTruthy();
    expect(screen.getByText("80 C (C)")).toBeTruthy();
    expect(screen.getByText("sheet_1_table_1")).toBeTruthy();
    expect(screen.getAllByText("Runs A1:C3").length).toBeGreaterThan(0);
    expect(screen.getByText("unknown_layout")).toBeTruthy();
    expect(screen.getByText("no_data_rows")).toBeTruthy();
  });

  it("shows approve and ignore controls for detected blocks", () => {
    const onBlockReviewDecision = vi.fn();
    render(
      <BackendScanPanel
        scanState={{ fileName: "runs.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: [], ignoredBlockIds: [] }}
        onBlockReviewDecision={onBlockReviewDecision}
      />,
    );

    expect(screen.getByText("Review: pending")).toBeTruthy();
    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText("Ignore"));

    expect(onBlockReviewDecision).toHaveBeenCalledWith("sheet_1_table_1", "approved");
    expect(onBlockReviewDecision).toHaveBeenCalledWith("sheet_1_table_1", "ignored");
  });

  it("marks the active block review decision", () => {
    render(
      <BackendScanPanel
        scanState={{ fileName: "runs.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: ["sheet_1_table_1"], ignoredBlockIds: [] }}
      />,
    );

    expect(screen.getByText("Review: approved")).toBeTruthy();
    expect(screen.getByText("Approve").className).toContain("active");
  });

  it("previews normalized output for approved blocks", () => {
    const onPreviewNormalize = vi.fn();
    const onApplyNormalize = vi.fn();
    render(
      <BackendScanPanel
        scanState={{ fileName: "runs.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: ["sheet_1_table_1"], ignoredBlockIds: [] }}
        normalizeState={{ result: normalizeResult() }}
        onPreviewNormalize={onPreviewNormalize}
        onApplyNormalize={onApplyNormalize}
      />,
    );

    fireEvent.click(screen.getByText("Preview normalized output"));
    fireEvent.click(screen.getByText("Apply normalized data"));

    expect(onPreviewNormalize).toHaveBeenCalledTimes(1);
    expect(onApplyNormalize).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("1 approved blocks").length).toBeGreaterThan(0);
    expect(screen.getByText("1 generic imports")).toBeTruthy();
    expect(screen.getByText("1 experiments")).toBeTruthy();
    expect(screen.getByText("1 fields")).toBeTruthy();
    expect(screen.getByText("1 measurements")).toBeTruthy();
    expect(screen.getByText("Fields: Conversion (%)")).toBeTruthy();
    expect(screen.getByText(/labrat\.importNormalize\.v1/)).toBeTruthy();
    expect(screen.getByText("Propose mappings").disabled).toBe(false);
  });

  it("shows supplemental observation set summaries in normalized preview", () => {
    render(
      <BackendScanPanel
        mode="supplement"
        scanState={{ fileName: "Reaction_Rate_Exp30.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: ["sheet_1_table_1"], ignoredBlockIds: [] }}
        normalizeState={{ result: observationNormalizeResult() }}
        relationshipDraft={{ preview: relationshipPreviewResult(), selectedProposalId: "relationship_1", loading: false, error: "" }}
      />,
    );

    expect(screen.getByText("0 experiments")).toBeTruthy();
    expect(screen.getByText("1 observation sets")).toBeTruthy();
    expect(screen.getByText("2 observations")).toBeTruthy();
    expect(screen.getByText("reaction_rate_time_series")).toBeTruthy();
    expect(screen.getByText(/Exp30 - 2 observations - 0.00 to 10.00 min/)).toBeTruthy();
    expect(screen.getByText(/Reaction Time \(min\), Adjusted Rate \(M\/s\)/)).toBeTruthy();
  });

  it("shows supplemental relationship proposals and enables supplement apply", () => {
    const onRelationshipProposalSelect = vi.fn();
    const onApplyNormalize = vi.fn();
    render(
      <BackendScanPanel
        mode="supplement"
        scanState={{ fileName: "Reaction_Rate_Exp30.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: ["sheet_1_table_1"], ignoredBlockIds: [] }}
        normalizeState={{ result: normalizeResult() }}
        relationshipDraft={{ preview: relationshipPreviewResult(), selectedProposalId: "relationship_1", loading: false, error: "" }}
        onRelationshipProposalSelect={onRelationshipProposalSelect}
        onApplyNormalize={onApplyNormalize}
      />,
    );

    expect(screen.getByText("Supplement relationship")).toBeTruthy();
    expect(screen.getByText(/reaction_rate_time_series/)).toBeTruthy();
    expect(screen.getByText(/generic_exp_30/)).toBeTruthy();
    expect(screen.getByText("Matched existing experiment Exp30.")).toBeTruthy();

    fireEvent.click(screen.getByText("Selected"));
    fireEvent.click(screen.getByText("Apply supplemental import"));

    expect(onRelationshipProposalSelect).toHaveBeenCalledWith("relationship_1");
    expect(onApplyNormalize).toHaveBeenCalledTimes(1);
  });

  it("disables supplemental apply when no relationship target is available", () => {
    render(
      <BackendScanPanel
        mode="supplement"
        scanState={{ fileName: "unknown.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: ["sheet_1_table_1"], ignoredBlockIds: [] }}
        normalizeState={{ result: normalizeResult() }}
        relationshipDraft={{
          preview: relationshipPreviewResult({
            proposals: [{
              relationshipProposalId: "relationship_unknown",
              proposedRelationship: "standalone_import",
              targetExperimentIds: [],
              evidence: [],
              confidence: 0.52,
              warnings: [],
            }],
            summary: { proposalCount: 1, supplementCount: 0, replaceCount: 0, standaloneCount: 1 },
          }),
          selectedProposalId: "",
          loading: false,
          error: "",
        }}
      />,
    );

    expect(screen.getByText(/No existing experiment target/)).toBeTruthy();
    expect(screen.getByText("Apply supplemental import").disabled).toBe(true);
  });

  it("shows mapping proposals and review actions", () => {
    const onProposeMappings = vi.fn();
    const onMappingDecision = vi.fn();
    render(
      <BackendScanPanel
        scanState={{ fileName: "runs.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: ["sheet_1_table_1"], ignoredBlockIds: [] }}
        normalizeState={{ result: normalizeResult() }}
        mappingState={{ result: mappingResult() }}
        onProposeMappings={onProposeMappings}
        onMappingDecision={onMappingDecision}
      />,
    );

    fireEvent.click(screen.getByText("Propose mappings"));
    fireEvent.click(screen.getByText("Accept"));
    fireEvent.click(screen.getByText("Reject"));

    expect(onProposeMappings).toHaveBeenCalledTimes(1);
    expect(onMappingDecision).toHaveBeenCalledWith("mapping_1", "accepted");
    expect(onMappingDecision).toHaveBeenCalledWith("mapping_1", "rejected");
    expect(screen.getByText("Conversion")).toBeTruthy();
    expect(screen.getByText("conversion - numeric - %")).toBeTruthy();
  });

  it("shows chart proposals as review-only cards", () => {
    const onProposeCharts = vi.fn();
    const onChartProposalDecision = vi.fn();
    render(
      <ChartReviewPanel
        genericImports={normalizeResult().datasetPatch.genericImports}
        mappingState={{ result: mappingResult() }}
        chartProposalState={{ result: chartProposalResult() }}
        onProposeCharts={onProposeCharts}
        onChartProposalDecision={onChartProposalDecision}
      />,
    );

    fireEvent.click(screen.getByText("Propose charts"));
    const buttons = screen.getAllByText("Accept");
    fireEvent.click(buttons[buttons.length - 1]);
    const rejectButtons = screen.getAllByText("Reject");
    fireEvent.click(rejectButtons[rejectButtons.length - 1]);

    expect(onProposeCharts).toHaveBeenCalledTimes(1);
    expect(onChartProposalDecision).toHaveBeenCalledWith("chart_1", "accepted");
    expect(onChartProposalDecision).toHaveBeenCalledWith("chart_1", "rejected");
    expect(screen.getByText("Conversion vs Time")).toBeTruthy();
    expect(screen.getByText("X: Time (min) - Y: Conversion (%)")).toBeTruthy();
  });

  it("sends one-sentence chart prompts and shows ChartSpec drafts", () => {
    const onInterpretChart = vi.fn();
    render(
      <ChartReviewPanel
        genericImports={normalizeResult().datasetPatch.genericImports}
        chartInterpretState={{ result: chartInterpretResult() }}
        onInterpretChart={onInterpretChart}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. plot gas selectivity vs temperature grouped by catalyst"), {
      target: { value: "plot conversion vs time grouped by catalyst" },
    });
    fireEvent.click(screen.getByText("Draft chart proposal"));

    expect(onInterpretChart).toHaveBeenCalledWith("plot conversion vs time grouped by catalyst");
    expect(screen.getAllByText("Conversion vs Time").length).toBeGreaterThan(0);
    expect(screen.getByText("Group by: Catalyst Type")).toBeTruthy();
    expect(screen.getByText("Resolved from prompt.")).toBeTruthy();
    expect(screen.getByText(/Preview-only draft/)).toBeTruthy();
  });

  it("renders project-scoped interpreted chart proposals in the proposal review", () => {
    const onChartProposalDecision = vi.fn();
    const interpretedResult = persistedChartInterpretResult();
    render(
      <ChartReviewPanel
        genericImports={normalizeResult().datasetPatch.genericImports}
        chartInterpretState={{ result: interpretedResult }}
        chartProposalState={chartProposalStateFromInterpret(interpretedResult)}
        onChartProposalDecision={onChartProposalDecision}
      />,
    );

    expect(screen.getByText("Chart proposal queued")).toBeTruthy();
    expect(screen.queryByText(/Preview-only draft/)).toBeNull();
    expect(screen.getAllByText("Conversion vs Time").length).toBeGreaterThan(0);
    expect(screen.getByText("Resolved from prompt.")).toBeTruthy();

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
        genericImports={normalizeResult().datasetPatch.genericImports}
        chartInterpretState={{ result: interpretedResult }}
        chartProposalState={chartProposalStateFromInterpret(interpretedResult)}
        onCreateChartSpec={onCreateChartSpec}
      />,
    );

    fireEvent.click(screen.getByText("Create chart spec"));

    expect(onCreateChartSpec).toHaveBeenCalledWith("chart_proposal_set_interpret_1", "chart_interpret_1");
  });

  it("shows chart intent clarification options", () => {
    render(
      <ChartReviewPanel
        genericImports={normalizeResult().datasetPatch.genericImports}
        chartInterpretState={{ result: chartClarificationResult() }}
      />,
    );

    expect(screen.getByText("Need clarification")).toBeTruthy();
    expect(screen.getByText("Which measurement should be plotted?")).toBeTruthy();
    expect(screen.getByText("Conversion")).toBeTruthy();
  });

  it("shows applied normalized data state", () => {
    render(
      <BackendScanPanel
        scanState={{ fileName: "runs.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: ["sheet_1_table_1"], ignoredBlockIds: [] }}
        normalizeState={{ result: normalizeResult(), applied: true }}
      />,
    );

    expect(screen.getByText("Normalized data applied to project")).toBeTruthy();
  });

  it("disables normalized preview when no blocks are approved", () => {
    render(
      <BackendScanPanel
        scanState={{ fileName: "runs.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: [], ignoredBlockIds: [] }}
      />,
    );

    expect(screen.getByText("Preview normalized output").disabled).toBe(true);
    expect(screen.getAllByText("0 approved blocks").length).toBeGreaterThan(0);
    expect(screen.getByText("No normalized preview yet.")).toBeTruthy();
    expect(screen.getAllByText("Scan workbook").length).toBeGreaterThan(0);
    expect(screen.getByText("Review blocks/fields")).toBeTruthy();
    expect(screen.getAllByText("Semantic mappings").length).toBeGreaterThan(0);
    expect(screen.queryByText("One-chart prompt")).toBeNull();
    expect(screen.queryByText("Chart proposals")).toBeNull();
    expect(screen.queryByText("ChartSpecs")).toBeNull();
    expect(screen.getByText("Propose mappings").disabled).toBe(true);
    expect(screen.queryByText("Propose charts")).toBeNull();
  });

  it("renders refresh diff and applies a changed workbook refresh", () => {
    const onApplyNormalize = vi.fn();
    render(
      <BackendScanPanel
        mode="refresh"
        refreshDraft={{ preview: refreshPreviewResult(), loading: false, error: "" }}
        scanState={{ fileName: "replacement.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: ["sheet_1_table_1"], ignoredBlockIds: [] }}
        normalizeState={{ result: normalizeResult() }}
        onApplyNormalize={onApplyNormalize}
      />,
    );

    expect(screen.getByText("Refresh diff")).toBeTruthy();
    expect(screen.getByText("1 experiments added")).toBeTruthy();
    expect(screen.getByText("4 values changed")).toBeTruthy();
    fireEvent.click(screen.getByText("Apply refresh"));

    expect(onApplyNormalize).toHaveBeenCalledTimes(1);
  });

  it("disables refresh apply when no changes are detected", () => {
    render(
      <BackendScanPanel
        mode="refresh"
        refreshDraft={{ preview: refreshPreviewResult({ hasChanges: false, summary: { experimentsAdded: 0, experimentsRemoved: 0, experimentsChanged: 0, fieldsAdded: 0, fieldsRemoved: 0, valuesChanged: 0, warningsChanged: 0 } }), loading: false, error: "" }}
        scanState={{ fileName: "replacement.xlsx", result: scanResult() }}
        blockReview={{ blockIds: ["sheet_1_table_1"], approvedBlockIds: ["sheet_1_table_1"], ignoredBlockIds: [] }}
        normalizeState={{ result: normalizeResult() }}
      />,
    );

    expect(screen.getByText("No changes detected. Apply refresh is disabled.")).toBeTruthy();
    expect(screen.getByText("Apply refresh").disabled).toBe(true);
  });

  it("shows backend scan errors without a result", () => {
    render(<BackendScanPanel scanState={{ error: "Backend scan failed." }} />);

    expect(screen.getByText("Backend scan failed.")).toBeTruthy();
    expect(screen.getByText("No backend scan yet.")).toBeTruthy();
  });
});
