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
  records: [],
  warnings: [],
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
});
