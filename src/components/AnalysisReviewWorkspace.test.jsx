import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../charts/Plot.jsx", () => ({
  Plot: ({ traces = [], layout = {} }) => (
    <div
      aria-label="Analysis chart preview"
      data-title={layout?.title?.text || ""}
      data-x-title={layout?.xaxis?.title?.text || ""}
      data-y-title={layout?.yaxis?.title?.text || ""}
      data-hover={traces[0]?.hovertemplate || ""}
    >
      {traces.map((trace) => trace.name).join(", ")}
    </div>
  ),
}));

import { AnalysisReviewWorkspace } from "./AnalysisReviewWorkspace.jsx";

const thread = {
  id: "analysis_thread_1",
  projectId: "project_1",
  originalRequest: "Normalize selectivity and compare every experiment.",
  status: "planning",
  messages: [
    { id: "message_1", role: "user", content: "Normalize selectivity and compare every experiment." },
    {
      id: "message_2",
      role: "assistant",
      content: "I drafted a reviewable plan.",
      planRevisionId: "analysis_plan_revision_1",
    },
  ],
};

const revision1 = {
  id: "analysis_plan_revision_1",
  analysisThreadId: thread.id,
  revision: 1,
  status: "superseded",
  requestSummary: "Compare selectivity.",
  displayPlan: ["Read the selected workbook cells."],
  reviewPlan: {
    processingSteps: ["Read the selected workbook cells."],
    chart: {
      title: "Selectivity",
      chartType: "bar",
      xDescription: "Experiment",
      yDescription: "Selectivity",
      seriesDescription: "Selectivity components",
    },
  },
  sourceRectangles: [],
  warnings: [],
};

const revision2 = {
  ...revision1,
  id: "analysis_plan_revision_2",
  revision: 2,
  status: "awaiting_review",
  requestSummary: "Normalize Solid, Liquid, and Gas to 100%, then compare experiments.",
  displayPlan: [
    "Select Solid, Liquid, and Gas from accepted experiment snapshots.",
    "Scale each experiment proportionally so the three values sum to 100%.",
  ],
  reviewPlan: {
    processingSteps: [
      "Select Solid, Liquid, and Gas from the red workbook ranges.",
      "Scale each experiment proportionally so the three values sum to 100%.",
    ],
    chart: {
      chartType: "stacked_bar",
      title: "Normalized selectivity by experiment",
      xDescription: "Experiment",
      yDescription: "Normalized selectivity (%)",
      seriesDescription: "Solid, Liquid, and Gas",
    },
  },
  sourceRectangles: [
    { sourceDocumentId: "source_1", sheetName: "Runs", range: "B2:D8", label: "Selectivity inputs" },
    { sourceDocumentId: "source_1", sheetName: "Runs", range: "F2:F8", label: "Experiment labels" },
  ],
};

const selection = {
  sourceRectangles: revision2.sourceRectangles,
  coverage: { selectedExperimentCount: 7, selectedFieldCount: 3 },
  records: [
    {
      experimentId: "experiment_1",
      experimentLabel: "Exp 1",
      snapshotId: "snapshot_1",
      recordIndex: 0,
      fields: [{
        fieldKey: "solid",
        displayName: "Solid",
        value: 92.8,
        sourceRefs: [{ sourceDocumentId: "source_1", sheet: "Runs", cell: "B2" }],
      }],
      series: [],
    },
    {
      experimentId: "experiment_2",
      experimentLabel: "Exp 2",
      snapshotId: "snapshot_2",
      recordIndex: 0,
      fields: [{
        fieldKey: "solid",
        displayName: "Solid",
        value: 92,
        sourceRefs: [{ sourceDocumentId: "source_1", sheet: "Runs", cell: "B3" }],
      }],
      series: [],
    },
  ],
  warnings: [],
};

const validatedRun = {
  id: "analysis_run_1",
  acceptedPlanRevisionId: revision2.id,
  status: "awaiting_result_review",
  execution: {
    adapter: "test",
    phase: "result_ready",
  },
  validation: { ok: true, errors: [] },
};

const validatedResult = {
  id: "analysis_result_1",
  analysisRunId: validatedRun.id,
  status: "awaiting_review",
  traceCount: 2,
  summary: {
    pointCount: 4,
    seriesCount: 2,
    excludedCount: 3,
  },
  validation: {
    ok: true,
    invariants: [{
      type: "row_sum",
      fieldKeys: ["solid", "liquid", "gas"],
      target: 100,
      absoluteTolerance: 0.000001,
      ok: true,
    }],
    errors: [],
  },
  warnings: [],
};

const resultPreview = {
  analysisRunId: validatedRun.id,
  analysisResultId: validatedResult.id,
  plotly: {
    data: [
      {
        traceId: "trace_exp_1",
        name: "Exp 1",
        type: "scatter",
        x: [1, 2],
        y: [10, 15],
        hovertemplate: "Experiment %{x}<br>Selectivity %{y}<extra></extra>",
      },
      {
        traceId: "trace_exp_2",
        name: "Exp 2",
        type: "scatter",
        x: [1, 2],
        y: [8, 12],
        hovertemplate: "Experiment %{x}<br>Selectivity %{y}<extra></extra>",
      },
    ],
    layout: {
      title: { text: "Normalized selectivity by experiment" },
      margin: { l: 60, r: 30, t: 76, b: 60 },
      legend: { y: 1.02 },
      xaxis: { title: { text: "Experiment" } },
      yaxis: { title: { text: "Normalized selectivity (%)" } },
    },
  },
  summary: validatedResult.summary,
  exclusions: [
    { label: "Exp 5", reason: "Liquid is missing." },
    { label: "Exp 6", reason: "Gas is missing." },
    { label: "Exp 7", reason: "All components are zero." },
  ],
  validation: validatedResult.validation,
  warnings: [{ code: "rounded_display", message: "Displayed values are rounded for review." }],
  sourceRefs: [
    {
      sourceDocumentId: "source_1",
      sheetName: "Runs",
      range: "B2:D2",
      sourceRecordId: "snapshot_1:0",
    },
    {
      sourceDocumentId: "source_1",
      sheetName: "Runs",
      range: "B3:D3",
      sourceRecordId: "snapshot_2:0",
    },
  ],
  tracePage: { offset: 0, limit: 500, totalCount: 2 },
};

function WorkbookWorkspaceStub({ reviewState, draftRegions, activeDraftRegionId }) {
  return (
    <div aria-label="Workbook source stub">
      <span>Source: {reviewState?.sourceDocument?.id || "none"}</span>
      <span>Active: {activeDraftRegionId}</span>
      {draftRegions.map((region) => (
        <span key={region.draftRegionId}>{`${region.sheetName}!${region.range}`}</span>
      ))}
    </div>
  );
}

const readyAnalysisCapabilities = {
  executor: { mode: "local", adapter: "local_non_production", configured: true, productionSafe: false },
};

describe("AnalysisReviewWorkspace", () => {
  it("accepts only the visible plan revision by id", async () => {
    const acceptPlan = vi.fn().mockResolvedValue({
      analysisPlanRevision: { ...revision2, status: "accepted" },
      analysisRun: { id: "analysis_run_1", status: "queued" },
    });
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        planRevisions={[revision1, revision2]}
        selection={selection}
        analysisCapabilities={readyAnalysisCapabilities}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={acceptPlan}
        createRevision={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept plan" }));

    await waitFor(() => expect(acceptPlan).toHaveBeenCalledWith(
      revision2.id,
      {},
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    ));
    expect(screen.getByText("Queued for calculation")).toBeTruthy();
  });

  it("sends modification feedback without accepting or executing", async () => {
    const acceptPlan = vi.fn();
    const createRevision = vi.fn().mockResolvedValue({
      analysisPlanRevision: {
        ...revision2,
        id: "analysis_plan_revision_3",
        revision: 3,
        feedback: "Treat missing Liquid as zero.",
      },
    });
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        planRevisions={[revision1, revision2]}
        selection={selection}
        analysisCapabilities={readyAnalysisCapabilities}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={acceptPlan}
        createRevision={createRevision}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Describe a modification"), {
      target: { value: "Treat missing Liquid as zero." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send modification" }));

    await waitFor(() => expect(createRevision).toHaveBeenCalledWith(
      thread.id,
      { feedback: "Treat missing Liquid as zero." },
    ));
    expect(acceptPlan).not.toHaveBeenCalled();
    expect(screen.getByText("Revision 3")).toBeTruthy();
    expect(screen.queryByText("Queued for calculation")).toBeNull();
  });

  it("blocks plan acceptance when Python execution is unavailable without blocking feedback", async () => {
    const createRevision = vi.fn().mockResolvedValue({
      analysisPlanRevision: { ...revision2, id: "analysis_plan_revision_3", revision: 3 },
    });
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        planRevisions={[revision1, revision2]}
        selection={selection}
        analysisCapabilities={{
          executor: { mode: "development", adapter: "disabled", configured: false, productionSafe: false },
        }}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={vi.fn()}
        createRevision={createRevision}
      />,
    );

    expect(screen.getByRole("button", { name: "Accept plan" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Python execution is unavailable. Configure an analysis executor before accepting this plan.")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Describe a modification"), {
      target: { value: "Use reaction time on the x-axis." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send modification" }));
    await waitFor(() => expect(createRevision).toHaveBeenCalledWith(
      thread.id,
      { feedback: "Use reaction time on the x-axis." },
    ));
  });

  it("fails closed while Python execution availability is still loading", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        planRevisions={[revision1, revision2]}
        selection={selection}
        loadAnalysisCapabilities={() => new Promise(() => {})}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={vi.fn()}
        createRevision={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Accept plan" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Checking Python execution availability before this plan can be accepted.")).toBeTruthy();
  });

  it("passes every non-contiguous source rectangle to the workbook as a separate red box", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        planRevisions={[revision2]}
        selection={selection}
        analysisCapabilities={readyAnalysisCapabilities}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={vi.fn()}
        createRevision={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Runs!B2:D8").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Runs!F2:F8").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Source: source_1")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Source" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Result" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("tab", { name: "Chart" })).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("switches the workbook source when the active plan rectangle belongs to another document", () => {
    const multiDocumentRevision = {
      ...revision2,
      sourceRectangles: [
        revision2.sourceRectangles[0],
        {
          sourceDocumentId: "source_2",
          sheetName: "Distribution",
          range: "Q69:AI69",
          label: "Exp33 carbon distribution",
        },
      ],
    };
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={multiDocumentRevision}
        planRevisions={[multiDocumentRevision]}
        selection={{ ...selection, sourceRectangles: multiDocumentRevision.sourceRectangles }}
        analysisCapabilities={readyAnalysisCapabilities}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={vi.fn()}
        createRevision={vi.fn()}
      />,
    );

    expect(screen.getByText("Source: source_1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Exp33 carbon distribution/i }));
    expect(screen.getByText("Source: source_2")).toBeTruthy();
  });

  it("presents only the readable processing plan without source or encoding metadata", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        planRevisions={[revision2]}
        selection={{
          ...selection,
          coverage: {
            fields: {
              "analysis_field:yield:percent:number": {
                available: 7,
                missing: 0,
                totalExperiments: 7,
              },
              "analysis_field:temperature:C:number": {
                available: 6,
                missing: 1,
                totalExperiments: 7,
              },
            },
            scalarCount: 14,
          },
        }}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={vi.fn()}
        createRevision={vi.fn()}
      />,
    );

    expect(screen.getByText("Chart plan")).toBeTruthy();
    expect(screen.getByText("Processing and calculation")).toBeTruthy();
    expect(screen.getByText("Select Solid, Liquid, and Gas from accepted experiment snapshots.")).toBeTruthy();
    expect(screen.getByText("Scale each experiment proportionally so the three values sum to 100%.")).toBeTruthy();
    expect(screen.queryByText("Selected data")).toBeNull();
    expect(screen.queryByText("Chart setup")).toBeNull();
    expect(screen.queryByText("X axis")).toBeNull();
    expect(screen.queryByText("Y axis")).toBeNull();
    expect(screen.queryByText("Exact Python")).toBeNull();
    expect(screen.queryByText("scalarCount")).toBeNull();
    expect(screen.queryByText(/yield: 7\/7 available/)).toBeNull();
  });

  it("opens the latest active server revision when a conversation card holds a stale revision", async () => {
    const acceptedRevision = {
      ...revision2,
      status: "accepted",
    };
    const loadThread = vi.fn().mockResolvedValue({
      analysisThread: thread,
      planRevisions: [revision1, acceptedRevision],
    });

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision1}
        selection={selection}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        loadThread={loadThread}
        acceptPlan={vi.fn()}
        createRevision={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Revision 2")).toBeTruthy();
      expect(screen.getAllByText("Accepted").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByRole("button", { name: "Accept plan" }).hasAttribute("disabled")).toBe(true);
  });

  it("hydrates a thread only once when a parent passes equivalent objects with the same ids", async () => {
    const acceptedRevision = { ...revision2, status: "accepted" };
    const readyThread = { ...thread, status: "executing" };
    const loadThread = vi.fn().mockResolvedValue({
      analysisThread: readyThread,
      planRevisions: [acceptedRevision],
      analysisRuns: [validatedRun],
    });
    const loadRun = vi.fn().mockResolvedValue({
      analysisRun: validatedRun,
      analysisPlanRevision: acceptedRevision,
      analysisResult: validatedResult,
    });
    const loadResultPreview = vi.fn().mockResolvedValue(resultPreview);
    const capabilities = { executor: { configured: true, adapter: "local" } };
    const sharedProps = {
      projectId: "project_1",
      selection,
      WorkbookWorkspaceComponent: WorkbookWorkspaceStub,
      loadThread,
      loadRun,
      loadResultPreview,
      executeRun: vi.fn(),
      analysisCapabilities: capabilities,
    };
    const { rerender } = render(
      <AnalysisReviewWorkspace
        {...sharedProps}
        thread={readyThread}
        revision={acceptedRevision}
      />,
    );

    await waitFor(() => expect(loadResultPreview).toHaveBeenCalledTimes(1));
    rerender(
      <AnalysisReviewWorkspace
        {...sharedProps}
        thread={{ ...readyThread }}
        revision={{ ...acceptedRevision }}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("Result ready").length).toBeGreaterThan(0));
    expect(loadThread).toHaveBeenCalledTimes(1);
    expect(loadRun).toHaveBeenCalledTimes(1);
    expect(loadResultPreview).toHaveBeenCalledTimes(1);
    expect(sharedProps.executeRun).not.toHaveBeenCalled();
  });

  it("does not auto-execute a rehydrated queued run when the executor is unavailable", async () => {
    const executeRun = vi.fn();
    const queuedRun = { ...validatedRun, status: "queued" };
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        selection={selection}
        loadThread={vi.fn().mockResolvedValue({
          analysisThread: thread,
          planRevisions: [{ ...revision2, status: "accepted" }],
          analysisRuns: [queuedRun],
        })}
        loadAnalysisCapabilities={vi.fn().mockResolvedValue({
          executor: { configured: false, adapter: "disabled" },
        })}
        executeRun={executeRun}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={vi.fn()}
        createRevision={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getAllByText(
      "Python execution is unavailable. Configure an analysis executor before calculating this chart.",
    ).length).toBeGreaterThan(0));
    expect(executeRun).not.toHaveBeenCalled();
  });

  it("executes chart_template_v1 without a configured Python executor", async () => {
    const queuedRun = { ...validatedRun, status: "queued" };
    const loadAnalysisCapabilities = vi.fn().mockResolvedValue({
      executor: { configured: false, adapter: "disabled" },
    });
    const executeRun = vi.fn().mockResolvedValue({
      analysisRun: validatedRun,
      analysisResult: validatedResult,
    });
    const loadResultPreview = vi.fn().mockResolvedValue(resultPreview);
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        loadThread={vi.fn().mockResolvedValue({
          analysisThread: thread,
          planRevisions: [{ ...revision2, status: "accepted" }],
          analysisRuns: [queuedRun],
        })}
        loadAnalysisCapabilities={loadAnalysisCapabilities}
        executeRun={executeRun}
        loadResultPreview={loadResultPreview}
        executionStrategy="chart_template_v1"
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
      />,
    );

    await waitFor(() => expect(executeRun).toHaveBeenCalledWith(queuedRun.id, {
      executionStrategy: "chart_template_v1",
    }));
    await waitFor(() => expect(loadResultPreview).toHaveBeenCalled());
    expect(loadAnalysisCapabilities).not.toHaveBeenCalled();
    expect(screen.queryByText(/Python execution is unavailable/)).toBeNull();
  });

  it("uses the persisted template strategy when the transient frontend strategy is absent", async () => {
    const queuedRun = {
      ...validatedRun,
      status: "queued",
      execution: {
        ...validatedRun.execution,
        executionStrategy: "chart_template_v1",
      },
    };
    const executeRun = vi.fn().mockResolvedValue({
      analysisRun: {
        ...validatedRun,
        execution: {
          ...validatedRun.execution,
          executionStrategy: "chart_template_v1",
        },
      },
      analysisResult: validatedResult,
    });
    const loadAnalysisCapabilities = vi.fn();

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={queuedRun}
        executeRun={executeRun}
        loadResultPreview={vi.fn().mockResolvedValue(resultPreview)}
        loadAnalysisCapabilities={loadAnalysisCapabilities}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
      />,
    );

    await waitFor(() => expect(executeRun).toHaveBeenCalledWith(queuedRun.id, {
      executionStrategy: "chart_template_v1",
    }));
    expect(loadAnalysisCapabilities).not.toHaveBeenCalled();
    expect(screen.queryByText(/accepted Python plan/)).toBeNull();
  });

  it("refreshes a running template execution until its completed result is available", async () => {
    const runningRun = { ...validatedRun, status: "running" };
    const loadRun = vi.fn()
      .mockResolvedValueOnce({ analysisRun: runningRun, analysisResult: null })
      .mockResolvedValueOnce({ analysisRun: validatedRun, analysisResult: validatedResult });
    const loadResultPreview = vi.fn().mockResolvedValue(resultPreview);

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        selection={selection}
        run={runningRun}
        loadRun={loadRun}
        loadResultPreview={loadResultPreview}
        executionStrategy="chart_template_v1"
        runRefreshIntervalMs={1}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
      />,
    );

    expect(screen.getByText("Applying chart template")).toBeTruthy();
    expect(screen.queryByText(/accepted Python plan/)).toBeNull();
    await waitFor(() => expect(loadRun).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadResultPreview).toHaveBeenCalledWith(validatedRun.id));
    expect(screen.getAllByText("Result ready").length).toBeGreaterThan(0);
  });

  it("recovers when a running-run refresh fails transiently", async () => {
    const runningRun = {
      ...validatedRun,
      status: "running",
      execution: {
        ...validatedRun.execution,
        executionStrategy: "chart_template_v1",
      },
    };
    const loadRun = vi.fn()
      .mockRejectedValueOnce(new Error("Temporary refresh failure"))
      .mockResolvedValueOnce({ analysisRun: validatedRun, analysisResult: validatedResult });
    const loadResultPreview = vi.fn().mockResolvedValue(resultPreview);

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        selection={selection}
        run={runningRun}
        loadRun={loadRun}
        loadResultPreview={loadResultPreview}
        runRefreshIntervalMs={1}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
      />,
    );

    await waitFor(() => expect(loadRun).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText("Result ready").length).toBeGreaterThan(0));
    expect(screen.queryByText("Temporary refresh failure")).toBeNull();
  });

  it("does not reset a completed local run when the same stale running prop is rendered again", async () => {
    const runningRun = {
      ...validatedRun,
      status: "running",
      execution: {
        ...validatedRun.execution,
        executionStrategy: "chart_template_v1",
      },
    };
    const loadRun = vi.fn().mockResolvedValue({
      analysisRun: validatedRun,
      analysisResult: validatedResult,
    });
    const loadResultPreview = vi.fn().mockResolvedValue(resultPreview);
    const props = {
      projectId: "project_1",
      thread,
      revision: { ...revision2, status: "accepted" },
      selection,
      run: runningRun,
      loadRun,
      loadResultPreview,
      WorkbookWorkspaceComponent: WorkbookWorkspaceStub,
    };
    const { rerender } = render(<AnalysisReviewWorkspace {...props} />);

    await waitFor(() => expect(screen.getAllByText("Result ready").length).toBeGreaterThan(0));
    rerender(<AnalysisReviewWorkspace {...props} run={{ ...runningRun }} />);

    expect(screen.getAllByText("Result ready").length).toBeGreaterThan(0);
    expect(screen.queryByText("Applying chart template")).toBeNull();
  });

  it("shows the validated chart, readable exclusions, and complete series choices before acceptance", () => {
    const PlotStub = ({ traces, layout }) => (
      <div
        aria-label="Analysis chart preview"
        data-margin-top={layout?.margin?.t}
        data-legend-y={layout?.legend?.y}
        data-title={layout?.title?.text}
        data-x-title={layout?.xaxis?.title?.text}
        data-y-title={layout?.yaxis?.title?.text}
        data-hover={traces[0]?.hovertemplate}
      >
        {traces.map((trace) => trace.name).join(", ")}
      </div>
    );
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[revision1, { ...revision2, status: "accepted" }]}
        selection={{
          ...selection,
          records: [
            ...selection.records,
            {
              experimentId: "experiment_5",
              experimentLabel: "Exp 5",
              snapshotId: "snapshot_5",
              recordIndex: 0,
              fields: [],
              series: [],
            },
          ],
        }}
        run={validatedRun}
        result={validatedResult}
        resultPreview={resultPreview}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        PlotComponent={PlotStub}
        onAcceptResult={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Result" }));
    const chart = screen.getByLabelText("Analysis chart preview");
    expect(chart.textContent).toContain("Exp 1");
    expect(chart.textContent).toContain("Exp 2");
    expect(chart.dataset.marginTop).toBe("76");
    expect(chart.dataset.legendY).toBe("1.02");
    expect(chart.dataset.title).toBe("Normalized selectivity by experiment");
    expect(chart.dataset.xTitle).toBe("Experiment");
    expect(chart.dataset.yTitle).toBe("Normalized selectivity (%)");
    expect(chart.dataset.hover).toContain("Experiment");
    expect(screen.getAllByText("Liquid is missing.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Exp 5").length).toBeGreaterThan(0);
    expect(screen.getByText("Displayed values are rounded for review.")).toBeTruthy();
    expect(screen.queryByText("exclude_record")).toBeNull();
    expect(screen.queryByText("snapshot_1:0")).toBeNull();
    expect(screen.queryByText("Input records")).toBeNull();
    expect(screen.queryByText("Run and result hashes")).toBeNull();
    expect(screen.getByRole("button", { name: "Accept chart" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Show Exp 1 by default" }).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Exp 2 by default" }));
    expect(screen.getByRole("checkbox", { name: "Show Exp 2 by default" }).checked).toBe(false);
  });

  it("posts result feedback and returns to plan review", async () => {
    const reviseRun = vi.fn().mockResolvedValue({
      analysisPlanRevision: {
        ...revision2,
        id: "analysis_plan_revision_3",
        revision: 3,
        status: "awaiting_review",
        requestSummary: "Use reaction time on x and preserve every experiment.",
      },
      priorAnalysisRun: validatedRun,
      priorAnalysisResult: validatedResult,
    });
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[revision1, { ...revision2, status: "accepted" }]}
        selection={selection}
        run={validatedRun}
        result={validatedResult}
        resultPreview={resultPreview}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        reviseRun={reviseRun}
        onAcceptResult={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Result" }));
    fireEvent.change(screen.getByPlaceholderText("Describe a chart modification"), {
      target: { value: "Use reaction time on x and preserve every experiment." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send chart modification" }));

    await waitFor(() => expect(reviseRun).toHaveBeenCalledWith(
      validatedRun.id,
      {
        feedback: "Use reaction time on x and preserve every experiment.",
      },
    ));
    expect(screen.getByText("Revision 3")).toBeTruthy();
    expect(screen.queryByText("Prior result sha256_result_1")).toBeNull();
    expect(screen.getByRole("tab", { name: "Source" }).getAttribute("aria-selected")).toBe("true");
  });

  it("executes the accepted plan and loads its validated result preview", async () => {
    const acceptPlan = vi.fn().mockResolvedValue({
      analysisPlanRevision: { ...revision2, status: "accepted" },
      analysisRun: { ...validatedRun, status: "queued" },
    });
    const executeRun = vi.fn().mockResolvedValue({
      analysisRun: validatedRun,
      analysisResult: validatedResult,
    });
    const loadResultPreview = vi.fn().mockResolvedValue(resultPreview);
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        planRevisions={[revision1, revision2]}
        selection={selection}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={acceptPlan}
        executeRun={executeRun}
        analysisCapabilities={readyAnalysisCapabilities}
        loadResultPreview={loadResultPreview}
        createRevision={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept plan" }));

    await waitFor(() => expect(executeRun).toHaveBeenCalledWith(validatedRun.id));
    await waitFor(() => expect(loadResultPreview).toHaveBeenCalledWith(validatedRun.id));
    expect(screen.getByRole("tab", { name: "Result" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("tab", { name: "Result" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByText("Result ready").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Analysis chart preview")).toBeTruthy();
  });

  it("keeps result acceptance disabled when backend validation failed", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={{ ...validatedRun, status: "validation_failed", validation: { ok: false } }}
        result={null}
        resultPreview={{
          ...resultPreview,
          validation: {
            ok: false,
            errors: [{ code: "analysis_invariant_failed", message: "Row sum validation failed." }],
          },
        }}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        onAcceptResult={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Accept chart" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Row sum validation failed.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chart could not be generated").length).toBeGreaterThan(0);
  });

  it("groups repeated backend validation failures instead of expanding every trace", () => {
    const repeatedErrors = Array.from({ length: 171 }, (_, index) => ({
      code: "analysis_trace_unit_mismatch",
      message: "Trace unit does not match the accepted calculation manifest.",
      traceId: `trace_${index + 1}`,
      actualUnit: null,
      expectedUnits: ["percent"],
    }));
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={{ ...validatedRun, status: "validation_failed", validation: { ok: false } }}
        result={null}
        resultPreview={{ ...resultPreview, validation: { ok: false, errors: repeatedErrors } }}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
      />,
    );

    expect(screen.getAllByText("Trace unit does not match the accepted calculation manifest.")).toHaveLength(2);
    expect(screen.getAllByText(/171 occurrences/).length).toBeGreaterThan(0);
  });

  it("shows a readable chart error without exposing technical result counts", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={{
          ...validatedRun,
          status: "validation_failed",
          validation: {
            ok: false,
            pointCount: 22,
            traceCount: 1,
            errors: [{ code: "analysis_test_failure", message: "Blocked test result." }],
          },
        }}
        result={null}
        resultPreview={null}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Result" }));
    expect(screen.getAllByText("Chart could not be generated").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocked test result.").length).toBeGreaterThan(0);
    expect(screen.getByText(/22 points/).textContent).toContain("1 series");
    expect(screen.queryByText("Input records")).toBeNull();
    expect(screen.queryByText("Output records")).toBeNull();
    expect(screen.queryByText("Missing policy")).toBeNull();
    expect(screen.queryByText("exclude_record")).toBeNull();
  });

  it("shows Python policy code, policy name, module, and line for a rejected revision", async () => {
    const policyError = Object.assign(new Error("The analysis Python program did not pass the backend runtime policy."), {
      details: {
        errors: [{
          code: "python_import_not_allowed",
          message: "Python import os is not allowed in labrat-python-v1.",
          policy: "labrat-python-v1-static-policy",
          module: "os",
          line: 2,
        }],
      },
    });
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        planRevisions={[revision1, revision2]}
        selection={selection}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        createRevision={vi.fn().mockRejectedValue(policyError)}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Describe a modification"), {
      target: { value: "Use the approved runtime only." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send modification" }));

    expect(await screen.findByText("python_import_not_allowed")).toBeTruthy();
    expect(screen.getByText(/labrat-python-v1-static-policy.*module os.*line 2/)).toBeTruthy();
  });

  it("renders the Exp33 carbon distribution as one readable 19-point chart", () => {
    const carbonRevision = {
      ...revision2,
      id: "analysis_plan_revision_exp33",
      status: "accepted",
      reviewPlan: {
        ...revision2.reviewPlan,
        chart: {
          chartType: "bar",
          title: "Carbon Number Distribution (Exp33)",
          xDescription: "Carbon number",
          yDescription: "Total amount (%)",
          seriesDescription: "Exp33",
        },
      },
    };
    const carbonRun = {
      ...validatedRun,
      id: "analysis_run_exp33",
      acceptedPlanRevisionId: carbonRevision.id,
    };
    const carbonResult = {
      ...validatedResult,
      id: "analysis_result_exp33",
      analysisRunId: carbonRun.id,
      traceCount: 1,
      summary: {
        pointCount: 19,
        seriesCount: 1,
        excludedCount: 0,
      },
    };
    const carbonValues = Array.from({ length: 19 }, (_, index) => index + 0.5);
    const carbonPreview = {
      ...resultPreview,
      analysisRunId: carbonRun.id,
      analysisResultId: carbonResult.id,
      plotly: {
        data: [{
          traceId: "trace_carbon_distribution",
          name: "Exp33 carbon distribution",
          type: "bar",
          x: Array.from({ length: 19 }, (_, index) => `C${index + 1}`),
          y: carbonValues,
          hovertemplate: "Carbon number %{x}<br>Total amount %{y}%<extra></extra>",
        }],
        layout: {
          title: { text: "Carbon Number Distribution (Exp33)" },
          xaxis: { title: { text: "Carbon number" } },
          yaxis: { title: { text: "Total amount (%)" } },
        },
      },
      summary: carbonResult.summary,
      exclusions: [],
      validation: { ok: true, errors: [] },
      warnings: [],
    };
    const renderedPlots = vi.fn();
    const PlotStub = (props) => {
      renderedPlots(props);
      return <div aria-label="Exp33 chart preview">{props.traces[0]?.name}</div>;
    };

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={carbonRevision}
        planRevisions={[carbonRevision]}
        selection={selection}
        run={carbonRun}
        result={carbonResult}
        resultPreview={carbonPreview}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        PlotComponent={PlotStub}
        onAcceptResult={vi.fn()}
      />,
    );

    const plotProps = renderedPlots.mock.calls.at(-1)[0];
    expect(plotProps.traces[0].x).toHaveLength(19);
    expect(plotProps.traces[0].y).toEqual(carbonValues);
    expect(plotProps.layout.title.text).toBe("Carbon Number Distribution (Exp33)");
    expect(plotProps.layout.xaxis.title.text).toBe("Carbon number");
    expect(plotProps.layout.yaxis.title.text).toBe("Total amount (%)");
    expect(plotProps.traces[0].hovertemplate).toContain("Carbon number");
    expect(screen.getByText("no exclusions", { exact: false }).textContent).toContain("no exclusions");
    expect(screen.queryByText("Input records")).toBeNull();
    expect(screen.queryByText("snapshot_exp33:0")).toBeNull();
  });

  it("requires at least one selected series and supports Clear and Select all", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={validatedRun}
        result={validatedResult}
        resultPreview={resultPreview}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        onAcceptResult={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Series", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("No series selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept chart" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.queryByText("No series selected")).toBeNull();
    expect(screen.getByRole("button", { name: "Accept chart" }).hasAttribute("disabled")).toBe(false);
  });

  it("publishes the exact result with the reviewed default trace subset", async () => {
    const onAcceptResult = vi.fn().mockResolvedValue({
      analysisRun: { ...validatedRun, status: "completed" },
      analysisResult: { ...validatedResult, status: "accepted" },
      chartSpec: { id: "chart_spec_1" },
    });
    const onAccepted = vi.fn();
    const onPlaceAcceptedChart = vi.fn();
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={validatedRun}
        result={validatedResult}
        resultPreview={resultPreview}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        PlotComponent={({ traces }) => <div>{traces.length}</div>}
        onAcceptResult={onAcceptResult}
        onAccepted={onAccepted}
        onPlaceAcceptedChart={onPlaceAcceptedChart}
      />,
    );

    fireEvent.click(screen.getByText("Series", { selector: "summary" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Exp 2 by default" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept chart" }));

    await waitFor(() => expect(onAcceptResult).toHaveBeenCalledWith({
      runId: validatedRun.id,
      analysisResultId: validatedResult.id,
      defaultVisibleTraceIds: ["trace_exp_1"],
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save as template" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Place in manuscript" }));
    expect(onPlaceAcceptedChart).toHaveBeenCalledWith({ id: "chart_spec_1" });
    expect(screen.getAllByText("Chart created").length).toBeGreaterThan(0);
    expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({
      chartSpec: { id: "chart_spec_1" },
    }));
  });

  it("keeps the created ribbon and saves the accepted chart as a named template", async () => {
    const saveTemplate = vi.fn().mockResolvedValue({
      reusableChartTemplate: { id: "reusable_chart_template_1", name: "Approved selectivity" },
      versions: [{ id: "reusable_chart_template_version_1", sourceChartSpecId: "chart_spec_1" }],
    });
    const onTemplateSaved = vi.fn();
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={{ ...thread, chartSpecIds: ["chart_spec_1"] }}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={{ ...validatedRun, status: "completed" }}
        result={{ ...validatedResult, status: "accepted" }}
        resultPreview={resultPreview}
        chartSpecs={[{
          id: "chart_spec_1",
          analysisResultId: validatedResult.id,
          title: "Normalized selectivity by experiment",
        }]}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        saveTemplate={saveTemplate}
        onTemplateSaved={onTemplateSaved}
      />,
    );

    expect(screen.getAllByText("Chart created").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Save as template" }));
    const nameInput = screen.getByLabelText("Template name");
    expect(nameInput.value).toBe("Normalized selectivity by experiment");
    fireEvent.change(nameInput, { target: { value: "Approved selectivity" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith("project_1", {
      name: "Approved selectivity",
      sourceChartSpecId: "chart_spec_1",
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Template saved" })).toBeTruthy());
    expect(screen.getByText("Saved as “Approved selectivity”.")).toBeTruthy();
    expect(onTemplateSaved).toHaveBeenCalled();
  });

  it("can cancel template naming and surfaces backend eligibility errors", async () => {
    const saveTemplate = vi.fn().mockRejectedValue(new Error("This approved chart is not eligible for reusable templates."));
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={{ ...thread, chartSpecIds: ["chart_spec_1"] }}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={{ ...validatedRun, status: "completed" }}
        result={{ ...validatedResult, status: "accepted" }}
        resultPreview={resultPreview}
        chartSpecs={[{ id: "chart_spec_1", analysisResultId: validatedResult.id }]}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        saveTemplate={saveTemplate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save as template" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Template name")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save as template" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("This approved chart is not eligible for reusable templates.")).toBeTruthy());
    expect(screen.getByLabelText("Template name")).toBeTruthy();
  });

  it("checks template eligibility before offering the save form", async () => {
    const saveTemplate = vi.fn();
    const loadTemplateEligibility = vi.fn().mockResolvedValue({
      status: "ineligible",
      blockers: [{
        code: "reusable_chart_template_not_eligible",
        message: "This chart still contains direct workbook ranges.",
      }],
    });
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={{ ...thread, chartSpecIds: ["chart_spec_1"] }}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={{ ...validatedRun, status: "completed" }}
        result={{ ...validatedResult, status: "accepted" }}
        resultPreview={resultPreview}
        chartSpecs={[{ id: "chart_spec_1", analysisResultId: validatedResult.id }]}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        saveTemplate={saveTemplate}
        loadTemplateEligibility={loadTemplateEligibility}
      />,
    );

    expect(await screen.findByText("This chart still contains direct workbook ranges.")).toBeTruthy();
    const unavailable = screen.getByRole("button", { name: "Template unavailable" });
    expect(unavailable.disabled).toBe(true);
    fireEvent.click(unavailable);
    expect(saveTemplate).not.toHaveBeenCalled();
  });

  it("loads the complete validated Plotly trace domain in one result preview", async () => {
    const acceptedRevision = { ...revision2, status: "accepted" };
    const allTraces = Array.from({ length: 1_200 }, (_, index) => ({
      traceId: `trace_${index + 1}`,
      experimentId: `experiment_${index + 1}`,
      name: `Exp ${index + 1}`,
      x: [0, 1],
      y: [index, index + 1],
    }));
    const loadThread = vi.fn().mockResolvedValue({
      analysisThread: thread,
      planRevisions: [acceptedRevision],
      analysisRuns: [validatedRun],
    });
    const loadRun = vi.fn().mockResolvedValue({
      analysisRun: validatedRun,
      analysisPlanRevision: acceptedRevision,
      analysisResult: { ...validatedResult, traceCount: allTraces.length },
    });
    const loadResultPreview = vi.fn().mockResolvedValue({
      ...resultPreview,
      plotly: {
        data: allTraces,
        layout: resultPreview.plotly.layout,
      },
      summary: {
        pointCount: allTraces.length * 2,
        seriesCount: allTraces.length,
        excludedCount: 0,
      },
      tracePage: {
        offset: 0,
        limit: allTraces.length,
        totalCount: allTraces.length,
      },
    });
    const PlotStub = ({ traces }) => <div data-testid="complete-trace-plot">{traces.length}</div>;

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={acceptedRevision}
        selection={selection}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        PlotComponent={PlotStub}
        loadThread={loadThread}
        loadRun={loadRun}
        loadResultPreview={loadResultPreview}
        executeRun={vi.fn()}
      />,
    );

    await waitFor(() => expect(loadResultPreview).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("complete-trace-plot").textContent).toBe("1200");
    fireEvent.click(screen.getByText("Series", { selector: "summary" }));
    expect(screen.getByRole("checkbox", { name: "Show Exp 1200 by default" }).checked).toBe(true);
  }, 30_000);

  it("rejects a preview that does not match the visible run and result ids", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={validatedRun}
        result={validatedResult}
        resultPreview={{ ...resultPreview, analysisResultId: "analysis_result_other" }}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        onAcceptResult={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Accept chart" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("The loaded preview does not match the visible analysis result.").length).toBeGreaterThan(0);
  });

  it("does not expose result rows, source-ref pagination, or audit hashes", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={validatedRun}
        result={validatedResult}
        resultPreview={resultPreview}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        onAcceptResult={vi.fn()}
      />,
    );

    expect(screen.queryByText("Validated values")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next source refs" })).toBeNull();
    expect(screen.queryByText("Run and result hashes")).toBeNull();
    expect(screen.queryByText("snapshot_1:0")).toBeNull();
  });

  it("rehydrates an earlier run and result when reopening revision history", async () => {
    const oldAcceptedRevision = { ...revision1, status: "accepted" };
    const newPlanningRevision = { ...revision2, status: "awaiting_review" };
    const historicalRun = {
      ...validatedRun,
      id: "analysis_run_old",
      acceptedPlanRevisionId: oldAcceptedRevision.id,
    };
    const historicalResult = {
      ...validatedResult,
      id: "analysis_result_old",
      analysisRunId: historicalRun.id,
    };
    const loadThread = vi.fn().mockResolvedValue({
      analysisThread: thread,
      planRevisions: [oldAcceptedRevision, newPlanningRevision],
      analysisRuns: [historicalRun],
    });
    const loadRun = vi.fn().mockResolvedValue({
      analysisRun: historicalRun,
      analysisPlanRevision: oldAcceptedRevision,
      analysisResult: historicalResult,
    });
    const loadResultPreview = vi.fn().mockResolvedValue({
      ...resultPreview,
      analysisRunId: historicalRun.id,
      analysisResultId: historicalResult.id,
    });

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={newPlanningRevision}
        selection={selection}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        loadThread={loadThread}
        loadRun={loadRun}
        loadResultPreview={loadResultPreview}
        executeRun={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Revision 1")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Revision 1Accepted" }));

    await waitFor(() => expect(loadRun).toHaveBeenCalledWith(historicalRun.id));
    await waitFor(() => expect(screen.getAllByText("Result ready").length).toBeGreaterThan(0));
    expect(screen.getByRole("tab", { name: "Result" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("tab", { name: "Result" }).getAttribute("aria-selected")).toBe("true");
  });

  it("renders all selected curves in one authoritative Plotly chart", () => {
    const PlotStub = ({ traces }) => (
      <div data-testid="unit-plot">{traces.map((trace) => trace.name).join(", ")}</div>
    );
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={validatedRun}
        result={validatedResult}
        resultPreview={{
          ...resultPreview,
          plotly: {
            ...resultPreview.plotly,
            data: [
              resultPreview.plotly.data[0],
              { ...resultPreview.plotly.data[1], yaxis: "y2" },
            ],
            layout: {
              ...resultPreview.plotly.layout,
              yaxis2: { title: { text: "Seconds" }, overlaying: "y", side: "right" },
            },
          },
        }}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        PlotComponent={PlotStub}
        onAcceptResult={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("unit-plot")).toHaveLength(1);
    expect(screen.getByTestId("unit-plot").textContent).toBe("Exp 1, Exp 2");
  });

  it("reviews Experiment Browser patches, resolves identities, and publishes the visible result", async () => {
    const browserThread = {
      ...thread,
      outputTarget: "chart",
      originalRequest: "Add product yield to Exp31.",
    };
    const browserRevision = {
      ...revision2,
      outputTarget: "experiment_browser",
      status: "accepted",
      reviewPlan: {
        processingSteps: [
          "Read product yield from the confirmed supplemental range.",
          "Add Product yield to Exp31 and preserve every existing field.",
        ],
        experimentOutput: { summary: "Add Product yield to Exp31." },
        browserView: { summary: "Show Exp31, Temperature, and Product yield." },
      },
      experimentSelections: [{
        experimentSelectionId: "experiment_selection_1",
        experimentId: "experiment_31",
        label: "Exp31",
        columnIndexes: [0],
        fieldLabels: ["Temperature (degC)"],
      }],
    };
    const browserRun = { ...validatedRun, outputTarget: "experiment_browser" };
    const browserResult = {
      ...validatedResult,
      outputTarget: "experiment_browser",
      analysisRunId: browserRun.id,
      validation: { ok: true, errors: [] },
    };
    const browserPreview = {
      outputTarget: "experiment_browser",
      analysisRunId: browserRun.id,
      analysisResultId: browserResult.id,
      columns: [
        { id: "experiment", label: "Experiment", valueType: "string" },
        { id: "field:temperature:degC:number", label: "Temperature (degC)", valueType: "number", unit: "degC" },
        { id: "field:product_yield:percent:number", label: "Product yield (%)", valueType: "number", unit: "percent" },
      ],
      rows: [{
        experimentId: "experiment_candidate_1",
        label: "Exp31",
        cells: {
          "field:temperature:degC:number": { value: 250, formattedValue: "250" },
          "field:product_yield:percent:number": {
            value: null,
            formattedValue: null,
            missingReason: "source_placeholder",
            storedType: "number",
            unit: "percent",
            sourceRefs: [{
              sourceType: "excel_cell",
              fileName: "MasterTable.xlsx",
              sheet: "Runs",
              cell: "C4",
              rawValue: "—",
              formattedValue: "—",
            }],
          },
        },
      }],
      rowChanges: [{
        experimentId: "experiment_candidate_1",
        changes: [{
          kind: "new_field",
          columnId: "field:product_yield:percent:number",
          label: "Product yield",
        }],
        preservedFieldCount: 1,
      }],
      browserView: {
        visibleColumnIds: [
          "experiment",
          "field:temperature:degC:number",
          "field:product_yield:percent:number",
        ],
      },
      identityCandidates: [{
        candidateId: "experiment_candidate_1",
        sourceAlias: "Exp31",
        status: "conflict",
        matches: [
          { id: "experiment_31", label: "Exp31" },
          { id: "experiment_31_duplicate", label: "Experiment 31 duplicate" },
        ],
      }],
      changeSummary: {
        experimentCount: 1,
        newFieldCount: 1,
        newSeriesCount: 2,
        changedFieldCount: 0,
        changedSeriesCount: 0,
        preservedFieldCount: 1,
        missingValueCount: 1,
        missingExperimentCount: 1,
      },
      exclusions: [],
      validation: { ok: true, errors: [] },
    };
    const acceptResult = vi.fn().mockResolvedValue({
      analysisRun: { ...browserRun, status: "completed" },
      analysisResult: { ...browserResult, status: "accepted" },
      dataSnapshot: { id: "snapshot_new" },
      browserView: { id: "browser_view_new" },
    });

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={browserThread}
        revision={browserRevision}
        planRevisions={[browserRevision]}
        selection={{ sourceRectangles: [], experimentSelections: browserRevision.experimentSelections }}
        run={browserRun}
        result={browserResult}
        resultPreview={browserPreview}
        onAcceptResult={acceptResult}
      />,
    );

    expect(screen.getByText("Experiment data plan")).toBeTruthy();
    expect(screen.getByText("Experiment Browser preview")).toBeTruthy();
    expect(screen.getByText("Validated preview · Not published")).toBeTruthy();
    expect(screen.getByText("Product yield (%)")).toBeTruthy();
    expect(screen.getByText("1 experiments · 3 new · 0 changed · 1 preserved")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.getByText("1 missing values across 1 experiments")).toBeTruthy();
    expect(screen.getAllByText("Number").length > 0).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Inspect Product yield (%) for Exp31" }));
    expect(screen.getByRole("complementary", { name: "Stored value details" })).toBeTruthy();
    expect(screen.getByText("Proposed stored type")).toBeTruthy();
    expect(screen.getByText("MasterTable.xlsx · Runs!C4")).toBeTruthy();
    expect(screen.getByText("Text → Number")).toBeTruthy();
    expect(screen.getByText("Missing · source_placeholder")).toBeTruthy();
    expect(screen.getByText(browserRevision.requestSummary)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish to Browser" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "View full screen" }));
    expect(screen.getByRole("dialog", { name: "Experiment Browser result" }).classList.contains("is-fullscreen")).toBe(true);
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBe(document.activeElement);
    expect(document.body.style.overflow).toBe("hidden");
    expect(acceptResult).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Experiment Browser result" })).toBeNull();
    expect(screen.getByRole("button", { name: "View full screen" })).toBe(document.activeElement);
    expect(document.body.style.overflow).toBe("");
    fireEvent.change(screen.getByLabelText("Identity action for Exp31"), {
      target: { value: "reuse" },
    });
    fireEvent.change(screen.getByLabelText("Existing experiment for Exp31"), {
      target: { value: "experiment_31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish to Browser" }));

    await waitFor(() => expect(acceptResult).toHaveBeenCalledWith({
      runId: browserRun.id,
      analysisResultId: browserResult.id,
      defaultVisibleTraceIds: [],
      identityResolutions: [{
        candidateId: "experiment_candidate_1",
        action: "reuse",
        experimentId: "experiment_31",
      }],
    }));
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText("Published experiment data")).toBeTruthy();
    expect(screen.getAllByText("Exp31").length).toBeGreaterThan(0);
  });

  it("shows grouped Experiment Browser errors without misleading zero-value preview counts", () => {
    const browserRevision = {
      ...revision2,
      outputTarget: "experiment_browser",
      status: "accepted",
      reviewPlan: {
        processingSteps: ["Add source-backed selectivity fields."],
        experimentOutput: { summary: "Add selectivity fields." },
        browserView: { summary: "Show selectivity fields." },
      },
    };
    const errors = [{
      code: "experiment_patch_numeric_value_invalid",
      message: "A numeric Experiment Browser field requires one finite number.",
      count: 12,
      examples: ["Exp5 / Solid", "Exp5 / Liquid", "Exp5 / Gas"],
    }];

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={{ ...thread, outputTarget: "experiment_browser" }}
        revision={browserRevision}
        planRevisions={[browserRevision]}
        selection={{ sourceRectangles: [] }}
        run={{
          ...validatedRun,
          outputTarget: "experiment_browser",
          status: "validation_failed",
          validation: { ok: false, errors },
        }}
        result={null}
        resultPreview={null}
      />,
    );

    expect(screen.getByText("Preview was not created")).toBeTruthy();
    expect(screen.queryByText(/0 experiments/)).toBeNull();
    expect(screen.getAllByText("A numeric Experiment Browser field requires one finite number.")).toHaveLength(2);
    expect(screen.getAllByText(/12 occurrences/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Exp5 \/ Solid/).length).toBeGreaterThan(0);
  });

  it("retries failed Experiment Browser generation as a new run", async () => {
    const browserRevision = {
      ...revision2,
      outputTarget: "experiment_browser",
      status: "accepted",
      reviewPlan: {
        processingSteps: ["Import confirmed source fields."],
        experimentOutput: { summary: "Import confirmed source fields." },
        browserView: { summary: "Show imported fields." },
      },
    };
    const failedRun = {
      ...validatedRun,
      outputTarget: "experiment_browser",
      status: "failed",
      execution: {
        error: {
          code: "analysis_program_draft_unavailable",
          message: "Anthropic output reached the token limit.",
          warning: { code: "ai_output_truncated" },
        },
      },
      validation: { ok: false, errors: [] },
    };
    const retryRun = vi.fn().mockResolvedValue({
      analysisThread: { ...thread, outputTarget: "experiment_browser", status: "executing" },
      analysisRun: { ...failedRun, id: "analysis_run_retry", status: "queued" },
    });
    const executeRun = vi.fn().mockResolvedValue({
      analysisRun: { ...failedRun, id: "analysis_run_retry", status: "failed" },
      analysisResult: null,
    });

    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={{ ...thread, outputTarget: "experiment_browser" }}
        revision={browserRevision}
        planRevisions={[browserRevision]}
        selection={{ sourceRectangles: [] }}
        run={failedRun}
        retryRun={retryRun}
        executeRun={executeRun}
        analysisCapabilities={{ executor: { configured: true, adapter: "test" } }}
      />,
    );

    expect(screen.getByText(/too long and was cut off/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry generation" }));
    await waitFor(() => expect(retryRun).toHaveBeenCalledWith(
      failedRun.id,
      expect.objectContaining({ idempotencyKey: expect.stringContaining("retry_generation_") }),
    ));
    await waitFor(() => expect(executeRun).toHaveBeenCalledWith("analysis_run_retry"));
  });
});
