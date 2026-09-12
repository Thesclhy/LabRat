import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartReviewPanel, LinkedDataComparisonReview, ReusableChartTemplateReview } from "./BackendScanPanel.jsx";

vi.mock("../charts/Plot.jsx", () => ({
  Plot: () => <div data-testid="plot" />,
}));

describe("ChartReviewPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits every chart prompt to the reviewed analysis entrypoint", () => {
    const onInterpretChart = vi.fn();
    render(
      <ChartReviewPanel
        allowAnalysisPrompt
        chartInterpretState={{ loading: false, error: "" }}
        onInterpretChart={onInterpretChart}
      />,
    );

    fireEvent.change(screen.getByLabelText("Describe the chart"), {
      target: { value: "Plot Sheet1!A1:Y63 for Exp31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan" }));

    expect(onInterpretChart).toHaveBeenCalledWith("Plot Sheet1!A1:Y63 for Exp31", {
      inputMode: "experiment_browser",
    });
  });

  it("submits workbook mode explicitly for a one-off source-range chart", () => {
    const onInterpretChart = vi.fn();
    render(
      <ChartReviewPanel
        allowAnalysisPrompt
        chartInterpretState={{ loading: false, error: "" }}
        onInterpretChart={onInterpretChart}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Workbook ranges/i }));
    fireEvent.change(screen.getByLabelText("Describe the chart"), {
      target: { value: "Plot Sheet1!A1:Y63" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan" }));

    expect(onInterpretChart).toHaveBeenCalledWith("Plot Sheet1!A1:Y63", { inputMode: "workbook" });
  });

  it("shows planning progress and backend errors", () => {
    render(
      <ChartReviewPanel
        allowAnalysisPrompt
        chartInterpretState={{ loading: true, error: "Planning failed" }}
      />,
    );

    expect(screen.getByText("Selecting evidence and drafting a reviewable plan...")).toBeTruthy();
    expect(screen.getByText("Planning failed")).toBeTruthy();
  });

  it("shows only published analysis ChartSpecs in approved mode", () => {
    render(<ChartReviewPanel viewMode="edit" chartSpecs={[]} />);

    expect(screen.getByText("No approved ChartSpecs yet.")).toBeTruthy();
  });
});

describe("ReusableChartTemplateReview", () => {
  const template = {
    id: "template_1",
    name: "Selectivity comparison",
    status: "active",
    currentVersionId: "version_1",
    currentVersion: 1,
    chartType: "bar",
  };
  const version = {
    id: "version_1",
    reusableChartTemplateId: "template_1",
    experimentCardinality: { minimum: 1, recommendedMaximum: 3, hardMaximum: 4 },
    inputSlots: [{
      slotId: "value",
      label: "Selectivity",
      identityContract: { preferredColumnId: "column_selectivity" },
      unitContract: { allowedUnits: ["%"] },
    }],
    encoding: { chartType: "bar", comparisonMode: "grouped" },
  };
  const experiments = {
    columns: [
      { id: "experiment", label: "Experiment" },
      { id: "column_selectivity", label: "Selectivity (%)" },
      { id: "column_alt", label: "Selectivity reviewed (%)" },
    ],
    rows: [
      { experimentId: "exp_1", label: "Exp1", cells: { column_selectivity: { value: 75 } }, warningCount: 0 },
      { experimentId: "exp_2", label: "Exp2", cells: { column_selectivity: { value: null } }, warningCount: 1 },
    ],
  };

  it("selects experiments, shows coverage, and opens a ready deterministic application", async () => {
    const onApplicationReady = vi.fn();
    const applyTemplate = vi.fn().mockResolvedValue({
      compatibility: { status: "ready", blockers: [] },
      analysisThread: { id: "thread_1" },
      analysisPlanRevision: { id: "revision_1" },
      analysisRun: { id: "run_1", status: "queued" },
    });
    render(
      <ReusableChartTemplateReview
        projectId="project_1"
        templates={[template]}
        loadTemplate={vi.fn().mockResolvedValue({ reusableChartTemplate: template, versions: [version] })}
        loadExperiments={vi.fn().mockResolvedValue(experiments)}
        applyTemplate={applyTemplate}
        onApplicationReady={onApplicationReady}
      />,
    );

    fireEvent.click(await screen.findByText("Exp1"));
    expect(screen.getByText("1/1 exact-field values")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview chart" }));

    await waitFor(() => expect(applyTemplate).toHaveBeenCalledWith("version_1", expect.objectContaining({
      experimentIds: ["exp_1"],
      bindings: [],
    })));
    await waitFor(() => expect(onApplicationReady).toHaveBeenCalledWith(expect.objectContaining({
      analysisRun: { id: "run_1", status: "queued" },
    })));
  });

  it("sorts accepted experiments by their natural numeric labels", async () => {
    render(
      <ReusableChartTemplateReview
        projectId="project_1"
        templates={[template]}
        loadTemplate={vi.fn().mockResolvedValue({ reusableChartTemplate: template, versions: [version] })}
        loadExperiments={vi.fn().mockResolvedValue({
          ...experiments,
          rows: [
            { experimentId: "exp_10", label: "Exp10", cells: {}, warningCount: 0 },
            { experimentId: "exp_2", label: "Exp2", cells: {}, warningCount: 0 },
            { experimentId: "exp_1", label: "Exp1", cells: {}, warningCount: 0 },
          ],
        })}
      />,
    );

    await screen.findByText("Exp1");
    const experimentTable = screen.getByRole("table", { name: "Template experiment Browser" });
    expect([...experimentTable.querySelectorAll("tbody .experiment-column strong")].map((label) => label.textContent)).toEqual([
      "Exp1",
      "Exp2",
      "Exp10",
    ]);
  });

  it("selects rows without confusing full-record inspection with selection", async () => {
    const loadExperimentDetail = vi.fn().mockResolvedValue({
      experiment: { id: "exp_1", canonicalLabel: "Exp1" },
      record: {
        fields: [{ displayName: "Temperature", value: 250, unit: "degC" }],
        series: [],
        warnings: [],
        sourceRefs: [],
      },
    });
    render(
      <ReusableChartTemplateReview
        projectId="project_1"
        templates={[template]}
        loadTemplate={vi.fn().mockResolvedValue({ reusableChartTemplate: template, versions: [version] })}
        loadExperiments={vi.fn().mockResolvedValue(experiments)}
        loadExperimentDetail={loadExperimentDetail}
      />,
    );

    const exp1Label = await screen.findByText("Exp1");
    const exp1Checkbox = screen.getByRole("checkbox", { name: "Select Exp1" });
    expect(exp1Checkbox.checked).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "View data" })[0]);

    await waitFor(() => expect(loadExperimentDetail).toHaveBeenCalledWith("project_1", "exp_1"));
    expect(screen.getByRole("heading", { name: "Exp1" })).toBeTruthy();
    expect(screen.getByText("250 degC")).toBeTruthy();
    expect(exp1Checkbox.checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Close experiment detail" }));
    fireEvent.click(exp1Label.closest("tr"));
    expect(exp1Checkbox.checked).toBe(true);
    expect(screen.getByText("Selection 1")).toBeTruthy();
  });

  it("preserves row selection order when table sorting changes", async () => {
    const applyTemplate = vi.fn().mockResolvedValue({ compatibility: { status: "blocked", blockers: [] } });
    render(
      <ReusableChartTemplateReview
        projectId="project_1"
        templates={[template]}
        loadTemplate={vi.fn().mockResolvedValue({ reusableChartTemplate: template, versions: [version] })}
        loadExperiments={vi.fn().mockResolvedValue(experiments)}
        applyTemplate={applyTemplate}
      />,
    );

    fireEvent.click((await screen.findByText("Exp2")).closest("tr"));
    fireEvent.click(screen.getByText("Exp1").closest("tr"));
    fireEvent.click(screen.getByRole("button", { name: /Experiment/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview chart" }));

    await waitFor(() => expect(applyTemplate).toHaveBeenCalledWith("version_1", expect.objectContaining({
      experimentIds: ["exp_2", "exp_1"],
    })));
  });

  it("shows missing inputs as blockers and requires explicit ambiguous bindings", async () => {
    const applyTemplate = vi.fn()
      .mockResolvedValueOnce({
        compatibility: {
          status: "blocked",
          blockers: [{
            code: "chart_template_input_ambiguous",
            slotId: "value",
            status: "confirmation_required",
            message: "Confirm the field binding for Selectivity.",
            candidates: ["column_alt"],
          }],
        },
      })
      .mockResolvedValueOnce({
        compatibility: { status: "ready", blockers: [] },
        analysisThread: { id: "thread_1" },
        analysisPlanRevision: { id: "revision_1" },
      });
    render(
      <ReusableChartTemplateReview
        projectId="project_1"
        templates={[template]}
        loadTemplate={vi.fn().mockResolvedValue({ reusableChartTemplate: template, versions: [version] })}
        loadExperiments={vi.fn().mockResolvedValue(experiments)}
        applyTemplate={applyTemplate}
      />,
    );

    fireEvent.click(await screen.findByText("Exp2"));
    expect(screen.getByText("0/1 exact-field values")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview chart" }));
    expect(await screen.findByText("Confirm the field binding for Selectivity.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm and preview" }).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Bind field"), { target: { value: "column_alt" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and preview" }));
    await waitFor(() => expect(applyTemplate).toHaveBeenLastCalledWith("version_1", expect.objectContaining({
      bindings: [{ slotId: "value", columnId: "column_alt" }],
    })));
  });
  it("binds workbook templates by data kind: coverage from linked regions, uncovered rows disabled, no field bindings", async () => {
    const linkedTemplate = { ...template, id: "template_linked", name: "Carbon distribution", currentVersionId: "version_linked", chartType: "bar" };
    const linkedVersion = {
      id: "version_linked",
      reusableChartTemplateId: "template_linked",
      experimentCardinality: { minimum: 1, recommendedMaximum: 8, hardMaximum: 24 },
      inputSlots: [{
        slotId: "series",
        label: "Overall carbon distribution",
        dataKind: "series",
        sourceKind: "linked_region",
        linkedDataKind: "Carbon distribution",
        identityContract: { preferredColumnId: "" },
        unitContract: { allowedUnits: ["% of feed carbon"] },
        seriesContract: { orientation: "header_row_categories", seriesSelector: { seriesKey: "carbon_distribution", label: "Overall carbon distribution" } },
      }],
      encoding: { chartType: "bar", comparisonMode: "grouped" },
    };
    const loadDataKinds = vi.fn().mockResolvedValue({
      dataKinds: [{
        dataKind: "Carbon distribution",
        experimentCount: 1,
        experiments: [{ experimentId: "exp_1", label: "Exp1", regions: [{ regionId: "region_1", revisionId: "rev_1", workbookName: "Calculation Exp1.xlsx", sheetName: "Sheet1", range: "P31:BA32" }] }],
      }],
      experiments: [{ experimentId: "exp_1", label: "Exp1" }, { experimentId: "exp_2", label: "Exp2" }],
    });
    const applyTemplate = vi.fn().mockResolvedValue({
      compatibility: {
        status: "ready",
        sourceKind: "linked_region",
        linkedDataKind: "Carbon distribution",
        blockers: [],
        experiments: [{ experimentId: "exp_1", label: "Exp1", region: { workbookName: "Calculation Exp1.xlsx", sheetName: "Sheet1", range: "P31:BA32" }, missingCount: 1 }],
        excludedExperiments: [{ experimentId: "exp_9", label: "Exp9", code: "chart_template_input_missing", message: "Exp9 has no confirmed Carbon distribution linked to it." }],
        warnings: [],
      },
      analysisThread: { id: "thread_linked" },
      analysisPlanRevision: { id: "revision_linked" },
      analysisRun: { id: "run_linked", status: "queued" },
    });
    const onApplicationReady = vi.fn();
    render(
      <ReusableChartTemplateReview
        projectId="project_1"
        templates={[linkedTemplate]}
        loadTemplate={vi.fn().mockResolvedValue({ reusableChartTemplate: linkedTemplate, versions: [linkedVersion] })}
        loadExperiments={vi.fn().mockResolvedValue(experiments)}
        loadDataKinds={loadDataKinds}
        applyTemplate={applyTemplate}
        onApplicationReady={onApplicationReady}
      />,
    );

    expect(await screen.findByText("Calculation Exp1.xlsx · Sheet1!P31:BA32")).toBeTruthy();
    expect(screen.getByText("no linked Carbon distribution")).toBeTruthy();
    expect(screen.getByLabelText("Select Exp2").disabled).toBe(true);
    expect(screen.queryByLabelText("Bind field")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Select all with data" }));
    expect(screen.getByText("1/1 linked regions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview chart" }));

    await waitFor(() => expect(applyTemplate).toHaveBeenCalledWith("version_linked", expect.objectContaining({ experimentIds: ["exp_1"], bindings: [] })));
    await waitFor(() => expect(onApplicationReady).toHaveBeenCalledWith(expect.objectContaining({ analysisRun: { id: "run_linked", status: "queued" } })));
    expect(await screen.findByText(/Reading 1 confirmed Carbon distribution region/)).toBeTruthy();
    expect(screen.getByText(/1 missing point/)).toBeTruthy();
    expect(screen.getByText(/Not included: Exp9 has no confirmed Carbon distribution linked to it\./)).toBeTruthy();
  });
});

describe("LinkedDataComparisonReview", () => {
  const kinds = {
    schemaVersion: "labrat.linkedDataKinds.v1",
    dataKinds: [
      {
        dataKind: "Carbon distribution",
        experimentCount: 2,
        regionCount: 2,
        experiments: [
          { experimentId: "identity_31", label: "Exp31", regions: [{ regionId: "region_31", workbookName: "Calculation Exp31.xlsx", sheetName: "Sheet1", range: "P31:BA32", series: [] }] },
          { experimentId: "identity_32", label: "Exp32", regions: [{ regionId: "region_32", workbookName: "Calculation Exp32.xlsx", sheetName: "Sheet1", range: "P31:BA32", series: [] }] },
        ],
      },
      { dataKind: "Reaction rate data", experimentCount: 1, regionCount: 1, experiments: [{ experimentId: "identity_31", label: "Exp31", regions: [{ regionId: "region_31r", workbookName: "Rates Exp31.xlsx", sheetName: "Rates", range: "A1:B60", series: [] }] }] },
    ],
    experiments: [
      { experimentId: "identity_31", label: "Exp31" },
      { experimentId: "identity_32", label: "Exp32" },
      { experimentId: "identity_33", label: "Exp33" },
    ],
  };

  it("lists data kinds with coverage, previews deterministic selections, and hands a created plan to review", async () => {
    const loadDataKinds = vi.fn(async () => kinds);
    const createComparison = vi.fn(async (_projectId, request) => ({
      comparison: {
        dataKind: request.dataKind,
        chartType: request.chartType,
        requestSummary: `Compare ${request.dataKind} across 2 experiments: Exp31, Exp32.`,
        experiments: request.experimentIds.map((experimentId) => ({ experimentId, label: experimentId === "identity_31" ? "Exp31" : "Exp32", workbookName: `Calculation ${experimentId === "identity_31" ? "Exp31" : "Exp32"}.xlsx`, sheetName: "Sheet1", range: "P31:BA32" })),
        missingExperiments: [],
        warnings: [],
      },
      ...(request.dryRun ? { analysisThread: null, analysisPlanRevision: null } : { analysisThread: { id: "thread_1" }, analysisPlanRevision: { id: "revision_1" } }),
    }));
    const onComparisonReady = vi.fn();
    render(<LinkedDataComparisonReview projectId="project_1" loadDataKinds={loadDataKinds} createComparison={createComparison} onComparisonReady={onComparisonReady} />);

    const kindSelect = await screen.findByLabelText("Data kind");
    expect(within(kindSelect).getAllByRole("option").map((option) => option.textContent)).toEqual(["Carbon distribution (2 experiments)", "Reaction rate data (1 experiment)"]);
    const exp33 = screen.getByLabelText("Include Exp33");
    expect(exp33.disabled).toBe(true);
    expect(screen.getByText("no linked Carbon distribution")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create comparison plan (0)" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Select all with data" }));
    expect(screen.getByLabelText("Include Exp31").checked).toBe(true);
    expect(screen.getByLabelText("Include Exp32").checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Chart type"), { target: { value: "scatter" } });

    fireEvent.click(screen.getByRole("button", { name: "Preview selections" }));
    await waitFor(() => expect(createComparison).toHaveBeenCalledWith("project_1", { dataKind: "Carbon distribution", experimentIds: ["identity_31", "identity_32"], chartType: "scatter", dryRun: true }));
    expect(await screen.findByText("Compare Carbon distribution across 2 experiments: Exp31, Exp32.")).toBeTruthy();
    expect(onComparisonReady).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create comparison plan (2)" }));
    await waitFor(() => expect(onComparisonReady).toHaveBeenCalledWith(expect.objectContaining({ analysisThread: { id: "thread_1" }, analysisPlanRevision: { id: "revision_1" } })));
    expect(createComparison).toHaveBeenLastCalledWith("project_1", { dataKind: "Carbon distribution", experimentIds: ["identity_31", "identity_32"], chartType: "scatter" });

    fireEvent.change(kindSelect, { target: { value: "Reaction rate data" } });
    expect(screen.getByLabelText("Include Exp32").disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Create comparison plan (0)" }).disabled).toBe(true);
  });

  it("explains how to get linked data when none exists", async () => {
    render(<LinkedDataComparisonReview projectId="project_1" loadDataKinds={vi.fn(async () => ({ dataKinds: [], experiments: [] }))} createComparison={vi.fn()} />);
    expect(await screen.findByText("No linked workbook data is available in this project yet.")).toBeTruthy();
  });

  it("renders the linked comparison mode from the chart review panel", async () => {
    render(<ChartReviewPanel viewMode="linked" projectId="project_1" chartSpecs={[]} chartInterpretState={{}} />);
    expect(await screen.findByText("Compare linked data")).toBeTruthy();
  });
});
