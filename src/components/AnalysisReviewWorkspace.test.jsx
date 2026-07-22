import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalysisReviewWorkspace } from "./AnalysisReviewWorkspace.jsx";

const thread = {
  id: "analysis_thread_1",
  projectId: "project_1",
  originalRequest: "Normalize selectivity and compare every experiment.",
  status: "planning",
  messages: [
    { id: "message_1", role: "user", content: "Normalize selectivity and compare every experiment." },
    { id: "message_2", role: "assistant", content: "I drafted a reviewable plan." },
  ],
};

const revision1 = {
  id: "analysis_plan_revision_1",
  analysisThreadId: thread.id,
  revision: 1,
  status: "superseded",
  requestSummary: "Compare selectivity.",
  processingSummary: ["Read accepted selectivity fields."],
  sourceRectangles: [],
  planHash: "sha256_plan_1",
  selectionHash: "sha256_selection_1",
  dependencyHash: "sha256_dependency_1",
  pythonProgram: { source: "def analyze(tables, labrat):\n    return {}", sourceHash: "sha256_python_1" },
  warnings: [],
};

const revision2 = {
  ...revision1,
  id: "analysis_plan_revision_2",
  revision: 2,
  status: "awaiting_review",
  requestSummary: "Normalize Solid, Liquid, and Gas to 100%, then compare experiments.",
  processingSummary: [
    "Select Solid, Liquid, and Gas from accepted experiment snapshots.",
    "Scale each experiment proportionally so the three values sum to 100%.",
  ],
  sourceRectangles: [
    { sourceDocumentId: "source_1", sheetName: "Runs", range: "B2:D8", label: "Selectivity inputs" },
    { sourceDocumentId: "source_1", sheetName: "Runs", range: "F2:F8", label: "Experiment labels" },
  ],
  planHash: "sha256_plan_2",
  selectionHash: "sha256_selection_2",
  dependencyHash: "sha256_dependency_2",
  pythonProgram: { source: "def analyze(tables, labrat):\n    return {'traces': []}", sourceHash: "sha256_python_2" },
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
  inputHash: revision2.selectionHash,
  programHash: revision2.programHash,
  runtimeVersion: "labrat-python-v1",
  execution: {
    adapter: "test",
    runtimeVersion: "labrat-python-v1",
  },
  validation: { ok: true, errors: [] },
};

const validatedResult = {
  id: "analysis_result_1",
  analysisRunId: validatedRun.id,
  status: "awaiting_review",
  contentHash: "sha256_result_1",
  resultPreviewHash: "sha256_preview_1",
  rowCount: 4,
  traceCount: 2,
  sourceRefCount: 2,
  summary: {
    inputRecordCount: 7,
    outputRecordCount: 4,
    excludedRecordCount: 3,
    excludedRecords: [
      { sourceRecordId: "snapshot_5:0", reason: "Liquid is missing." },
      { sourceRecordId: "snapshot_6:0", reason: "Gas is missing." },
      { sourceRecordId: "snapshot_7:0", reason: "All components are zero." },
    ],
    missingValuePolicy: "exclude_record",
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
  contentHash: validatedResult.contentHash,
  resultPreviewHash: validatedResult.resultPreviewHash,
  rows: [
    {
      __result_id: "result_row_1",
      __experiment_id: "experiment_1",
      __snapshot_id: "snapshot_1",
      __record_index: 0,
      experiment_label: "Exp 1",
      solid: 60,
      liquid: 30,
      gas: 10,
    },
    {
      __result_id: "result_row_2",
      __experiment_id: "experiment_2",
      __snapshot_id: "snapshot_2",
      __record_index: 0,
      experiment_label: "Exp 2",
      solid: 50,
      liquid: 35,
      gas: 15,
    },
  ],
  traces: [
    {
      traceId: "trace_exp_1",
      experimentId: "experiment_1",
      name: "Exp 1",
      x: [1, 2],
      y: [10, 15],
      xUnit: "min",
      yUnit: "percent",
      sourceRecordIds: ["snapshot_1:0"],
    },
    {
      traceId: "trace_exp_2",
      experimentId: "experiment_2",
      name: "Exp 2",
      x: [1, 2],
      y: [8, 12],
      xUnit: "min",
      yUnit: "percent",
      sourceRecordIds: ["snapshot_2:0"],
    },
  ],
  lineage: {
    result_row_1: { sourceRecordIds: ["snapshot_1:0"] },
    result_row_2: { sourceRecordIds: ["snapshot_2:0"] },
    trace_exp_1: { sourceRecordIds: ["snapshot_1:0"] },
    trace_exp_2: { sourceRecordIds: ["snapshot_2:0"] },
  },
  summary: validatedResult.summary,
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
  rowPage: { offset: 0, limit: 50, totalCount: 4 },
  tracePage: { offset: 0, limit: 500, totalCount: 2 },
  sourcePage: { offset: 0, limit: 200, totalCount: 2 },
};

function WorkbookWorkspaceStub({ draftRegions, activeDraftRegionId }) {
  return (
    <div aria-label="Workbook source stub">
      <span>Active: {activeDraftRegionId}</span>
      {draftRegions.map((region) => (
        <span key={region.draftRegionId}>{`${region.sheetName}!${region.range}`}</span>
      ))}
    </div>
  );
}

describe("AnalysisReviewWorkspace", () => {
  it("accepts only the visible plan revision with its exact hashes", async () => {
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
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={acceptPlan}
        createRevision={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept plan" }));

    await waitFor(() => expect(acceptPlan).toHaveBeenCalledWith(
      revision2.id,
      {
        planHash: revision2.planHash,
        selectionHash: revision2.selectionHash,
        dependencyHash: revision2.dependencyHash,
      },
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
    expect(screen.getAllByText("Analysis plan revision 3").length).toBeGreaterThanOrEqual(1);
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

  it("passes every non-contiguous source rectangle to the workbook as a separate red box", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={revision2}
        planRevisions={[revision2]}
        selection={selection}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        acceptPlan={vi.fn()}
        createRevision={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Runs!B2:D8").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Runs!F2:F8").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("tab", { name: "Source" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Result" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("tab", { name: "Chart" }).hasAttribute("disabled")).toBe(true);
  });

  it("renders structured coverage values as readable field labels", () => {
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

    expect(screen.getByText("yield: 7/7 available, temperature: 6/7 available")).toBeTruthy();
    expect(screen.queryByText("[object Object]")).toBeNull();
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
      expect(screen.getAllByText("Analysis plan revision 2").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Accepted").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByRole("button", { name: "Accept plan" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows validated results, exclusions, invariants, and complete trace choices before acceptance", () => {
    const PlotStub = ({ traces, layout }) => (
      <div
        aria-label="Analysis chart preview"
        data-margin-top={layout?.margin?.t}
        data-legend-y={layout?.legend?.y}
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
        selection={selection}
        run={validatedRun}
        result={validatedResult}
        resultPreview={resultPreview}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        PlotComponent={PlotStub}
        onAcceptResult={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Result" }));
    expect(screen.getByText("3 records excluded")).toBeTruthy();
    expect(screen.getByText("Row sum = 100 +/- 0.000001")).toBeTruthy();
    expect(screen.getByText("Liquid is missing.")).toBeTruthy();
    expect(screen.getByText("Displayed values are rounded for review.")).toBeTruthy();
    expect(screen.getAllByText("exclude_record")).toHaveLength(2);
    expect(screen.getByText("snapshot_1:0")).toBeTruthy();
    expect(screen.getByText("Exp 1")).toBeTruthy();
    expect(screen.getByText("60")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open source for Exp 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept result and create chart" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Chart" }));
    expect(screen.getByLabelText("Analysis chart preview").textContent).toContain("Exp 1");
    expect(screen.getByLabelText("Analysis chart preview").textContent).toContain("Exp 2");
    expect(screen.getByLabelText("Analysis chart preview").dataset.marginTop).toBe("76");
    expect(screen.getByLabelText("Analysis chart preview").dataset.legendY).toBe("1.02");
    expect(screen.getByRole("checkbox", { name: "Show Exp 1 by default" }).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Exp 2 by default" }));
    expect(screen.getByRole("checkbox", { name: "Show Exp 2 by default" }).checked).toBe(false);
  });

  it("posts result feedback with the exact result hash and returns to plan review", async () => {
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
    fireEvent.change(screen.getByPlaceholderText("Describe a result modification"), {
      target: { value: "Use reaction time on x and preserve every experiment." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send result modification" }));

    await waitFor(() => expect(reviseRun).toHaveBeenCalledWith(
      validatedRun.id,
      {
        resultHash: validatedResult.contentHash,
        feedback: "Use reaction time on x and preserve every experiment.",
      },
    ));
    expect(screen.getAllByText("Analysis plan revision 3").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Prior result sha256_result_1")).toBeTruthy();
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
        loadResultPreview={loadResultPreview}
        createRevision={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept plan" }));

    await waitFor(() => expect(executeRun).toHaveBeenCalledWith(validatedRun.id));
    await waitFor(() => expect(loadResultPreview).toHaveBeenCalledWith(
      validatedRun.id,
      expect.objectContaining({ traceLimit: 500, sourceLimit: 200 }),
    ));
    expect(screen.getByRole("tab", { name: "Result" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("Ready for result review")).toBeTruthy();
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

    expect(screen.getByRole("button", { name: "Accept result and create chart" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Row sum validation failed.")).toBeTruthy();
  });

  it("publishes the exact result with the reviewed default trace subset", async () => {
    const onAcceptResult = vi.fn().mockResolvedValue({
      analysisRun: { ...validatedRun, status: "completed" },
      analysisResult: { ...validatedResult, status: "accepted" },
      chartSpec: { id: "chart_spec_1" },
    });
    const onAccepted = vi.fn();
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
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Chart" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Exp 2 by default" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept result and create chart" }));

    await waitFor(() => expect(onAcceptResult).toHaveBeenCalledWith({
      runId: validatedRun.id,
      resultHash: validatedResult.contentHash,
      defaultVisibleTraceIds: ["trace_exp_1"],
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Chart created" })).toBeTruthy());
    expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({
      chartSpec: { id: "chart_spec_1" },
    }));
  });

  it("loads the complete validated trace domain across backend preview pages", async () => {
    const acceptedRevision = { ...revision2, status: "accepted" };
    const allTraces = Array.from({ length: 1_200 }, (_, index) => ({
      traceId: `trace_${index + 1}`,
      experimentId: `experiment_${index + 1}`,
      name: `Exp ${index + 1}`,
      x: [0, 1],
      y: [index, index + 1],
      xUnit: "min",
      yUnit: "percent",
      sourceRecordIds: [`snapshot_${index + 1}:0`],
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
    const loadResultPreview = vi.fn().mockImplementation((runId, options) => Promise.resolve({
      ...resultPreview,
      traces: allTraces.slice(options.traceOffset, options.traceOffset + options.traceLimit),
      tracePage: {
        offset: options.traceOffset,
        limit: options.traceLimit,
        totalCount: allTraces.length,
      },
    }));
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

    await waitFor(() => expect(loadResultPreview).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("tab", { name: "Chart" }));
    expect(screen.getByTestId("complete-trace-plot").textContent).toBe("1200");
    expect(screen.getByRole("checkbox", { name: "Show Exp 1200 by default" }).checked).toBe(true);
  }, 15_000);

  it("rejects a preview that does not match the visible run and result hashes", () => {
    render(
      <AnalysisReviewWorkspace
        projectId="project_1"
        thread={thread}
        revision={{ ...revision2, status: "accepted" }}
        planRevisions={[{ ...revision2, status: "accepted" }]}
        selection={selection}
        run={validatedRun}
        result={validatedResult}
        resultPreview={{ ...resultPreview, contentHash: "sha256_other_result" }}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        onAcceptResult={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Accept result and create chart" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("The loaded preview does not match the visible analysis result.")).toBeTruthy();
  });

  it("loads later source-evidence pages without changing the reviewed result", async () => {
    const firstSourcePage = Array.from({ length: 200 }, (_, index) => ({
      sourceDocumentId: "source_1",
      sheet: "Runs",
      cell: `A${index + 1}`,
    }));
    const loadResultPreview = vi.fn().mockResolvedValue({
      ...resultPreview,
      sourceRefs: [{ sourceDocumentId: "source_1", sheet: "Runs", cell: "A201" }],
      sourcePage: { offset: 200, limit: 200, totalCount: 201 },
    });
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
          sourceRefs: firstSourcePage,
          sourcePage: { offset: 0, limit: 200, totalCount: 201 },
        }}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        loadResultPreview={loadResultPreview}
        onAcceptResult={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Result" }));
    fireEvent.click(screen.getByRole("button", { name: "Next source refs" }));

    await waitFor(() => expect(loadResultPreview).toHaveBeenCalledWith(
      validatedRun.id,
      expect.objectContaining({ sourceOffset: 200, sourceLimit: 200 }),
    ));
    expect(screen.getByRole("button", { name: "Runs!A201" })).toBeTruthy();
    expect(screen.getByText(validatedResult.contentHash)).toBeTruthy();
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
      contentHash: "sha256_historical_result",
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
      contentHash: historicalResult.contentHash,
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
    await waitFor(() => expect(screen.getByText("Ready for result review")).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Result" }).hasAttribute("disabled")).toBe(false);
  });

  it("renders incompatible trace units in separate chart panels", () => {
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
          traces: [
            resultPreview.traces[0],
            { ...resultPreview.traces[1], yUnit: "seconds" },
          ],
        }}
        WorkbookWorkspaceComponent={WorkbookWorkspaceStub}
        PlotComponent={PlotStub}
        onAcceptResult={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Chart" }));
    expect(screen.getAllByTestId("unit-plot")).toHaveLength(2);
  });
});
