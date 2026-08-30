import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartReviewPanel, ReusableChartTemplateReview } from "./BackendScanPanel.jsx";

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
});
