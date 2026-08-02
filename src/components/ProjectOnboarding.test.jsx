import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectOnboarding } from "./ProjectOnboarding.jsx";
import {
  INITIAL_PROJECT_ONBOARDING,
  projectOnboardingStorageKey,
  readProjectOnboarding,
  writeProjectOnboarding,
} from "../data/projectOnboardingState.js";

const baseProjectState = {
  project: { id: "project_1", name: "Catalyst Screening" },
  workbookReviewSessions: [],
  workbookReviewRegions: [],
  experimentSnapshotHeads: [],
};

describe("ProjectOnboarding", () => {
  beforeEach(() => {
    window.localStorage.removeItem(projectOnboardingStorageKey("project_1"));
  });

  it("reviews regions and asks context questions while the accepted plan executes", async () => {
    const onUploadWorkbook = vi.fn().mockResolvedValue({
      session: {
        id: "session_1",
        workbookSummary: { workbookName: "MasterTable.xlsx" },
      },
    });
    const onCreateExperimentPlan = vi.fn().mockResolvedValue({
      analysisThread: { id: "thread_1", outputTarget: "experiment_browser" },
      currentPlanRevision: { id: "revision_1", status: "awaiting_review", outputTarget: "experiment_browser" },
    });
    function FakeAnalysisReview({ thread, revision, onWorkflowStateChange }) {
      return (
        <div>
          <button type="button" onClick={() => onWorkflowStateChange({
            thread,
            revision: { ...revision, status: "accepted" },
            run: { id: "run_1", status: "running", outputTarget: "experiment_browser" },
          })}>Accept plan</button>
          <button type="button" onClick={() => onWorkflowStateChange({
            thread,
            revision: { ...revision, status: "accepted" },
            run: { id: "run_1", status: "awaiting_result_review", outputTarget: "experiment_browser" },
            result: { id: "result_1", status: "awaiting_review", outputTarget: "experiment_browser" },
            preview: { analysisResultId: "result_1" },
            previewReady: true,
          })}>Finish preview</button>
        </div>
      );
    }
    const reviewRegions = [{
      id: "region_1",
      sourceDocumentId: "source_1",
      sheetName: "Sheet1",
      rangeRef: "A1:D4",
      disposition: "active",
      reviewStatus: "accepted",
      version: 2,
      currentRevisionId: "understanding_1",
      acceptedRevisionId: "understanding_1",
      currentRevision: { id: "understanding_1", revisionNumber: 1, summary: ["Each row is one experiment."], validation: {} },
    }];
    const { container } = render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{
          ...baseProjectState,
          workbookReviewSessions: [{
            id: "session_1",
            workbookSummary: { workbookName: "MasterTable.xlsx" },
          }],
        }}
        onUploadWorkbook={onUploadWorkbook}
        reviewRegions={reviewRegions}
        onCreateExperimentPlan={onCreateExperimentPlan}
        AnalysisReviewComponent={FakeAnalysisReview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Let’s get started" }));
    expect(screen.getByRole("status", { name: "LabRat is thinking" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /We have an established workflow/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes" }));
    await screen.findByRole("button", { name: "Upload Excel workbook" });

    const fileInput = container.querySelector('input[type="file"]');
    const file = new File(["workbook"], "MasterTable.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(onUploadWorkbook).toHaveBeenCalledWith(file));
    fireEvent.click(screen.getByRole("button", { name: "Review extracted experiments" }));
    expect(onCreateExperimentPlan).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: "Accept plan" }));

    expect(screen.getByText("Generating your Experiment Browser preview…")).toBeTruthy();
    const workflowInput = screen.getByPlaceholderText("Describe your experimental workflow...");
    fireEvent.change(workflowInput, { target: { value: "We run batch reactions and record each experiment in one row." } });
    fireEvent.click(screen.getByRole("button", { name: "Send onboarding answer" }));

    const pendingWorkflow = screen.getByText("We run batch reactions and record each experiment in one row.");
    expect(pendingWorkflow.closest(".project-onboarding-message")?.classList.contains("user")).toBe(true);
    const analysisInput = await screen.findByPlaceholderText("Describe how you analyze your data...");
    fireEvent.change(analysisInput, { target: { value: "We calculate conversion and selectivity in Excel." } });
    fireEvent.click(screen.getByRole("button", { name: "Send onboarding answer" }));

    expect(await screen.findByText(/still validating the Experiment Browser preview/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish preview", hidden: true }));
    expect(screen.getByText("Preview ready")).toBeTruthy();
    expect(screen.getByText(/Perfect—the preview is ready/i)).toBeTruthy();

    const stored = readProjectOnboarding("project_1");
    expect(stored.projectStage).toBe("established");
    expect(stored.masterTableStatus).toBe("yes");
    expect(stored.experimentalWorkflow).toContain("batch reactions");
    expect(stored.dataAnalysisProcess).toContain("conversion");
    expect(stored.workbookReviewSessionId).toBe("session_1");
    expect(stored.analysisThreadId).toBe("thread_1");
    expect(stored.analysisRunId).toBe("run_1");
    expect(stored.analysisResultId).toBe("result_1");
  });

  it("shows real reviewed Browser rows and completes onboarding", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "preview",
      workbookStatus: "published",
    });
    const onComplete = vi.fn();
    const loadBrowserPreview = vi.fn().mockResolvedValue({
      columns: [
        { id: "experiment", label: "Experiment", pinned: true },
        { id: "temperature", label: "Temperature", unit: "C", recommended: true },
      ],
      rows: [
        {
          experimentId: "exp_1",
          label: "Exp1",
          cells: { temperature: { value: 250, formattedValue: "250" } },
        },
      ],
      totalCount: 1,
    });
    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{
          ...baseProjectState,
          experimentSnapshotHeads: [{ experimentIdentityId: "exp_1" }],
        }}
        loadBrowserPreview={loadBrowserPreview}
        onComplete={onComplete}
      />,
    );

    expect(await screen.findByText("Exp1")).toBeTruthy();
    expect(screen.getByText("250 C")).toBeTruthy();
    expect(loadBrowserPreview).toHaveBeenCalledWith(
      "project_1",
      { limit: 8 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Yes, this looks right" }));
    expect(onComplete).toHaveBeenCalled();
    expect(readProjectOnboarding("project_1").status).toBe("completed");
  });

  it("collects a correction and hands it to the reviewed data-change flow", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "preview",
      workbookStatus: "published",
    });
    const onRequestCorrection = vi.fn();
    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{
          ...baseProjectState,
          experimentSnapshotHeads: [{ experimentIdentityId: "exp_1" }],
        }}
        loadBrowserPreview={vi.fn().mockResolvedValue({
          columns: [{ id: "experiment", label: "Experiment", pinned: true }],
          rows: [{ experimentId: "exp_1", label: "Exp1", cells: {} }],
          totalCount: 1,
        })}
        onRequestCorrection={onRequestCorrection}
      />,
    );

    await screen.findByText("Exp1");
    fireEvent.click(screen.getByRole("button", { name: "No, something needs correcting" }));
    const correctionInput = screen.getByPlaceholderText("Describe what looks wrong and what should be corrected...");
    fireEvent.change(correctionInput, { target: { value: "Reaction time should be reported in minutes." } });
    fireEvent.click(screen.getByRole("button", { name: "Send onboarding answer" }));

    await waitFor(() => expect(onRequestCorrection).toHaveBeenCalledWith("Reaction time should be reported in minutes."));
    await waitFor(() => expect(readProjectOnboarding("project_1").correction).toContain("minutes"));
  });

  it("stops the spinner and offers a safe quit when generation fails", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      workbookStatus: "ready",
      workbookFileName: "MasterTable.xlsx",
      step: "region_review",
    });
    function FailedAnalysisReview({ thread, revision, onWorkflowStateChange }) {
      return (
        <button type="button" onClick={() => onWorkflowStateChange({
          thread,
          revision: { ...revision, status: "accepted" },
          run: { id: "run_failed", status: "failed", outputTarget: "experiment_browser" },
          error: "Claude's generated program was too long and was cut off before it could run.",
        })}>Report failed generation</button>
      );
    }
    const onExit = vi.fn();
    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{
          ...baseProjectState,
          workbookReviewSessions: [{ id: "session_failed", workbookSummary: { workbookName: "MasterTable.xlsx" } }],
        }}
        reviewRegions={[{
          id: "region_failed",
          disposition: "active",
          reviewStatus: "accepted",
          acceptedRevisionId: "understanding_failed",
          currentRevision: { id: "understanding_failed", summary: ["Each row is one experiment."], validation: {} },
        }]}
        onCreateExperimentPlan={vi.fn().mockResolvedValue({
          analysisThread: { id: "thread_failed", outputTarget: "experiment_browser" },
          currentPlanRevision: { id: "revision_failed", status: "awaiting_review", outputTarget: "experiment_browser" },
        })}
        loadAnalysisThread={vi.fn().mockResolvedValue({
          analysisThread: { id: "thread_failed", outputTarget: "experiment_browser" },
          planRevisions: [{ id: "revision_failed", status: "accepted", outputTarget: "experiment_browser" }],
        })}
        AnalysisReviewComponent={FailedAnalysisReview}
        onExit={onExit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review extracted experiments" }));
    fireEvent.click(await screen.findByRole("button", { name: "Report failed generation" }));
    expect(screen.getByText("Generation failed")).toBeTruthy();
    expect(screen.getByText(/too long and was cut off/i)).toBeTruthy();
    expect(screen.queryByText("Generating your Experiment Browser preview…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Quit for now" }));
    expect(onExit).toHaveBeenCalled();
    expect(readProjectOnboarding("project_1").status).toBe("paused");
  });
});
