import React, { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectOnboarding } from "./ProjectOnboarding.jsx";
import {
  applyServerRegionExtractionTemplate,
  confirmServerWorkbookReviewRegionsBatch,
  matchServerRegionExtractionTemplate,
} from "../data/serverApi.js";
import { listExperimentBrowserRows } from "../data/experimentBrowserApi.js";

vi.mock("../data/serverApi.js", async (importOriginal) => ({
  ...(await importOriginal()),
  matchServerRegionExtractionTemplate: vi.fn(),
  applyServerRegionExtractionTemplate: vi.fn(),
  confirmServerWorkbookReviewRegionsBatch: vi.fn(),
}));

vi.mock("../data/experimentBrowserApi.js", async (importOriginal) => ({
  ...(await importOriginal()),
  listExperimentBrowserRows: vi.fn(),
}));
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

  it("keeps the full-page stream as the only scroll owner", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const pageRule = css.match(/\.project-onboarding-page\s*\{([^}]*)\}/)?.[1] || "";
    const streamRule = css.match(/\.project-onboarding-stream\s*\{([^}]*)\}/)?.[1] || "";
    const embeddedDockRule = css.match(/\.project-onboarding-inline-review \.workbook-review-chat\s*\{([^}]*)\}/)?.[1] || "";
    const embeddedWorkspaceRule = css.match(/\.analysis-review-workspace\.is-onboarding\s*\{([^}]*)\}/)?.[1] || "";

    expect(pageRule).toMatch(/height:\s*100dvh/);
    expect(pageRule).toMatch(/flex-direction:\s*column/);
    expect(streamRule).toMatch(/min-height:\s*0/);
    expect(streamRule).toMatch(/overflow-y:\s*auto/);
    expect(embeddedDockRule).toMatch(/max-height:\s*none/);
    expect(embeddedDockRule).toMatch(/overflow:\s*visible/);
    expect(embeddedWorkspaceRule).toMatch(/display:\s*grid/);
    expect(embeddedWorkspaceRule).toMatch(/overflow:\s*hidden/);
  });

  it("renders a review surface as a wide block inside the stream", () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "plan_review",
      workbookStatus: "ready",
      analysisThreadId: "thread_saved",
      analysisPlanRevisionId: "revision_saved",
    });
    function FakeAnalysisReview() {
      return <button type="button">Accept plan</button>;
    }

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={baseProjectState}
        loadAnalysisThread={vi.fn().mockResolvedValue({
          analysisThread: { id: "thread_saved", outputTarget: "experiment_browser" },
          planRevisions: [{
            id: "revision_saved",
            status: "awaiting_review",
            outputTarget: "experiment_browser",
          }],
        })}
        AnalysisReviewComponent={FakeAnalysisReview}
      />,
    );

    return screen.findByRole("button", { name: "Accept plan" }).then((button) => {
      expect(button.closest(".project-onboarding-wide")).toBeTruthy();
      expect(button.closest(".project-onboarding-stream")).toBeTruthy();
    });
  });

  it("keeps the newest onboarding content in view as the conversation grows", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      render(
        <ProjectOnboarding
          projectId="project_1"
          projectState={baseProjectState}
        />,
      );

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      scrollIntoView.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Let’s get started" }));

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "nearest",
      }));
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("recovers a persisted plan-generating step that no longer has a live request", () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "plan_generating",
      workbookStatus: "ready",
      workbookFileName: "MasterTable.xlsx",
    });
    const onCreateExperimentPlan = vi.fn().mockResolvedValue({
      analysisThread: { id: "thread_recovered", outputTarget: "experiment_browser" },
      currentPlanRevision: { id: "revision_recovered", status: "awaiting_review", outputTarget: "experiment_browser" },
    });

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={baseProjectState}
        onCreateExperimentPlan={onCreateExperimentPlan}
      />,
    );

    expect(screen.getByText("Plan generation was interrupted.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try generating the plan again" }));
    expect(onCreateExperimentPlan).toHaveBeenCalledWith({ signal: expect.any(AbortSignal), request: expect.any(String) });
  });

  it("reopens a server-completed review plan after the onboarding request was interrupted", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "plan_generating",
      workbookStatus: "ready",
    });
    const onRecoverExperimentPlan = vi.fn().mockResolvedValue({
      analysisThread: { id: "thread_existing", outputTarget: "experiment_browser" },
      planRevisions: [{ id: "revision_existing", status: "awaiting_review", outputTarget: "experiment_browser" }],
    });
    const FakeAnalysisReview = () => <div>Recovered review plan</div>;

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={baseProjectState}
        onRecoverExperimentPlan={onRecoverExperimentPlan}
        AnalysisReviewComponent={FakeAnalysisReview}
      />,
    );

    expect(screen.getByText("Checking for your review plan…")).toBeTruthy();
    expect(await screen.findByText("Recovered review plan")).toBeTruthy();
    expect(onRecoverExperimentPlan).toHaveBeenCalledTimes(1);
    expect(readProjectOnboarding("project_1")).toMatchObject({
      step: "plan_review",
      analysisThreadId: "thread_existing",
      analysisPlanRevisionId: "revision_existing",
    });
  });

  it("keeps observing a server-owned plan after the original browser request is gone", async () => {
    vi.useFakeTimers();
    try {
      writeProjectOnboarding("project_1", {
        ...INITIAL_PROJECT_ONBOARDING,
        step: "plan_generating",
        workbookStatus: "ready",
      });
      const onRecoverExperimentPlan = vi.fn().mockResolvedValue({
        analysisThread: { id: "thread_drafting", status: "planning", outputTarget: "experiment_browser" },
        planRevisions: [],
      });
      const loadAnalysisThread = vi.fn()
        .mockResolvedValueOnce({
          analysisThread: { id: "thread_drafting", status: "planning", outputTarget: "experiment_browser" },
          planRevisions: [],
        })
        .mockResolvedValue({
          analysisThread: { id: "thread_drafting", status: "awaiting_plan_review", outputTarget: "experiment_browser" },
          planRevisions: [{ id: "revision_durable", status: "awaiting_review", outputTarget: "experiment_browser" }],
        });
      function FakeAnalysisReview() {
        return <button type="button">Accept plan</button>;
      }

      render(
        <ProjectOnboarding
          projectId="project_1"
          projectState={baseProjectState}
          onRecoverExperimentPlan={onRecoverExperimentPlan}
          loadAnalysisThread={loadAnalysisThread}
          AnalysisReviewComponent={FakeAnalysisReview}
        />,
      );

      await act(async () => { await Promise.resolve(); });
      expect(readProjectOnboarding("project_1")).toMatchObject({
        step: "plan_generating",
        analysisThreadId: "thread_drafting",
      });
      expect(screen.getByText("Drafting a plan for your Experiment Browser…")).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
      expect(screen.getByText("Plan ready")).toBeTruthy();
      expect(screen.getByText(/Your plan is ready\. Answer or skip/)).toBeTruthy();
      expect(readProjectOnboarding("project_1")).toMatchObject({
        step: "plan_generating",
        analysisThreadId: "thread_drafting",
        analysisPlanRevisionId: "revision_durable",
      });
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(screen.getByRole("button", { name: "Accept plan" })).toBeTruthy();
      expect(readProjectOnboarding("project_1")).toMatchObject({
        step: "plan_review",
        contextIndexAtPlanReview: 3,
        analysisThreadId: "thread_drafting",
        analysisPlanRevisionId: "revision_durable",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a persisted server plan failure instead of polling forever", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "plan_generating",
      workbookStatus: "ready",
    });
    const onRecoverExperimentPlan = vi.fn().mockResolvedValue({
      analysisThread: { id: "thread_failed", status: "plan_failed", outputTarget: "experiment_browser" },
      planRevisions: [],
      planFailure: {
        message: "The provider request failed.",
        details: { provider: { detail: "TypeError: ECONNRESET: fetch failed" } },
      },
    });

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={baseProjectState}
        onRecoverExperimentPlan={onRecoverExperimentPlan}
      />,
    );

    expect(await screen.findByText("TypeError: ECONNRESET: fetch failed")).toBeTruthy();
    expect(readProjectOnboarding("project_1")).toMatchObject({
      step: "region_review",
      analysisThreadId: "",
    });
    expect(screen.getByRole("button", { name: "Try generating the plan again" })).toBeTruthy();
  });

  it("shows a restoration state and then the Accept plan control for a persisted plan review", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "plan_review",
      workbookStatus: "ready",
      analysisThreadId: "thread_saved",
      analysisPlanRevisionId: "revision_saved",
    });
    let resolveThread;
    const loadAnalysisThread = vi.fn(() => new Promise((resolve) => {
      resolveThread = resolve;
    }));
    function FakeAnalysisReview() {
      return <button type="button">Accept plan</button>;
    }

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={baseProjectState}
        loadAnalysisThread={loadAnalysisThread}
        AnalysisReviewComponent={FakeAnalysisReview}
      />,
    );

    expect(screen.getByText("Restoring your review plan…")).toBeTruthy();
    await act(async () => {
      resolveThread({
        analysisThread: { id: "thread_saved", outputTarget: "experiment_browser" },
        planRevisions: [{
          id: "revision_saved",
          status: "awaiting_review",
          outputTarget: "experiment_browser",
        }],
      });
    });

    const acceptPlan = await screen.findByRole("button", { name: "Accept plan" });
    expect(acceptPlan.closest(".project-onboarding-analysis")).toBeTruthy();
    expect(screen.queryByText("Restoring your review plan…")).toBeNull();
    expect(loadAnalysisThread).toHaveBeenCalledWith("thread_saved");
  });

  it("recovers a missing plan id while already at the plan review step", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "plan_review",
      workbookStatus: "ready",
    });
    const onRecoverExperimentPlan = vi.fn().mockResolvedValue({
      analysisThread: { id: "thread_recovered_review", outputTarget: "experiment_browser" },
      currentPlanRevision: {
        id: "revision_recovered_review",
        status: "awaiting_review",
        outputTarget: "experiment_browser",
      },
    });
    function FakeAnalysisReview() {
      return <button type="button">Accept plan</button>;
    }

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={baseProjectState}
        onRecoverExperimentPlan={onRecoverExperimentPlan}
        AnalysisReviewComponent={FakeAnalysisReview}
      />,
    );

    expect(screen.getByText("Restoring your review plan…")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Accept plan" })).toBeTruthy();
    expect(onRecoverExperimentPlan).toHaveBeenCalledTimes(1);
    expect(readProjectOnboarding("project_1")).toMatchObject({
      step: "plan_review",
      analysisThreadId: "thread_recovered_review",
      analysisPlanRevisionId: "revision_recovered_review",
    });
  });

  it("reopens an existing reviewable plan before starting another provider request", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "region_review",
      workbookStatus: "ready",
    });
    const onRecoverExperimentPlan = vi.fn().mockResolvedValue({
      analysisThread: { id: "thread_existing_retry", outputTarget: "experiment_browser" },
      currentPlanRevision: {
        id: "revision_existing_retry",
        status: "awaiting_review",
        outputTarget: "experiment_browser",
      },
    });
    const onCreateExperimentPlan = vi.fn();
    function FakeAnalysisReview() {
      return <button type="button">Accept plan</button>;
    }

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={baseProjectState}
        reviewRegions={[{
          id: "region_existing_retry",
          disposition: "active",
          reviewStatus: "accepted",
          acceptedRevisionId: "understanding_existing_retry",
          currentRevision: { id: "understanding_existing_retry", validation: {} },
        }]}
        onCreateExperimentPlan={onCreateExperimentPlan}
        onRecoverExperimentPlan={onRecoverExperimentPlan}
        AnalysisReviewComponent={FakeAnalysisReview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Draft Experiment Browser plan" }));
    expect(await screen.findByRole("button", { name: "Accept plan" })).toBeTruthy();
    expect(onRecoverExperimentPlan).toHaveBeenCalledTimes(1);
    expect(onCreateExperimentPlan).not.toHaveBeenCalled();
  });

  it("lets the user cancel slow plan generation without losing confirmed interpretations", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "region_review",
      workbookStatus: "ready",
      workbookFileName: "MasterTable.xlsx",
    });
    const reviewRegions = [{
      id: "region_slow",
      sheetName: "Sheet1",
      rangeRef: "A1:D4",
      disposition: "active",
      reviewStatus: "accepted",
      version: 2,
      currentRevisionId: "understanding_slow",
      acceptedRevisionId: "understanding_slow",
      currentRevision: { id: "understanding_slow", summary: ["Each row is one experiment."], validation: {} },
    }];
    const onCreateExperimentPlan = vi.fn(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={baseProjectState}
        reviewRegions={reviewRegions}
        onCreateExperimentPlan={onCreateExperimentPlan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Draft Experiment Browser plan" }));
    expect(await screen.findByText("Drafting a plan for your Experiment Browser…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));

    expect(await screen.findByText(/This page stopped waiting/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try generating the plan again" })).toBeTruthy();
    expect(readProjectOnboarding("project_1").step).toBe("region_review");
  });

  it("stops plan generation after two minutes when the provider never returns", async () => {
    vi.useFakeTimers();
    try {
      writeProjectOnboarding("project_1", {
        ...INITIAL_PROJECT_ONBOARDING,
        step: "region_review",
        workbookStatus: "ready",
      });
      const reviewRegions = [{
        id: "region_timeout",
        sheetName: "Sheet1",
        rangeRef: "A1:D4",
        disposition: "active",
        reviewStatus: "accepted",
        version: 2,
        currentRevisionId: "understanding_timeout",
        acceptedRevisionId: "understanding_timeout",
        currentRevision: { id: "understanding_timeout", summary: ["Each row is one experiment."], validation: {} },
      }];
      const onCreateExperimentPlan = vi.fn(({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }));

      render(
        <ProjectOnboarding
          projectId="project_1"
          projectState={baseProjectState}
          reviewRegions={reviewRegions}
          onCreateExperimentPlan={onCreateExperimentPlan}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Draft Experiment Browser plan" }));
      expect(screen.getByText("Preparing review plan · 0s")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(screen.getByText(/stopped waiting after two minutes/i)).toBeTruthy();
      expect(readProjectOnboarding("project_1").step).toBe("region_review");
    } finally {
      vi.useRealTimers();
    }
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
    const loadAnalysisThread = vi.fn().mockRejectedValue(new Error("Redundant hydration should not run."));
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
        loadAnalysisThread={loadAnalysisThread}
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
    fireEvent.click(screen.getByRole("button", { name: "Draft Experiment Browser plan" }));
    expect(onCreateExperimentPlan).toHaveBeenCalledTimes(1);
    expect(screen.getByText("In one sentence, what is the focus of this project?")).toBeTruthy();
    expect(screen.queryByText("What does a typical experiment routine look like?")).toBeNull();
    expect(await screen.findByText("Plan ready")).toBeTruthy();
    expect(screen.getByText(/Your plan is ready\. Answer or skip/)).toBeTruthy();
    expect(readProjectOnboarding("project_1").step).toBe("plan_generating");
    const focusInput = screen.getByRole("textbox", { name: "Your answer" });
    expect(focusInput.getAttribute("placeholder")).toBe("");
    fireEvent.change(focusInput, { target: { value: "We run batch reactions and record each experiment in one row." } });
    fireEvent.click(screen.getByRole("button", { name: "Send onboarding answer" }));

    const pendingFocus = screen.getByText("We run batch reactions and record each experiment in one row.");
    expect(pendingFocus.closest(".project-onboarding-message")?.classList.contains("user")).toBe(true);
    await waitFor(() => expect(readProjectOnboarding("project_1").step).toBe("plan_review"));
    expect(readProjectOnboarding("project_1").contextIndexAtPlanReview).toBe(1);
    const acceptPlan = screen.getByRole("button", { name: "Accept plan" });
    expect(screen.queryByRole("textbox", { name: "Your answer" })).toBeNull();
    expect(loadAnalysisThread).not.toHaveBeenCalled();
    fireEvent.click(acceptPlan);

    expect(screen.getByText("Generating your Experiment Browser preview…")).toBeTruthy();
    expect(screen.getByText(/let’s finish the quick questions/)).toBeTruthy();
    expect(screen.getByText("Got it. What does a typical experiment routine look like?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByText("Which parameters do you measure, and which matter most?")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), { target: { value: "Conversion and selectivity." } });
    fireEvent.click(screen.getByRole("button", { name: "Send onboarding answer" }));
    expect(await screen.findByText("Got it. Which instruments collect your data?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(await screen.findByText(/still validating the Experiment Browser preview/i)).toBeTruthy();
    expect(screen.queryByText(/How do you turn the raw data/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finish preview", hidden: true }));
    expect(screen.getByText("Preview ready")).toBeTruthy();
    expect(screen.getByText(/Perfect—the preview is ready/i)).toBeTruthy();

    const stored = readProjectOnboarding("project_1");
    expect(stored.projectStage).toBe("established");
    expect(stored.masterTableStatus).toBe("yes");
    expect(stored.contextAnswers.project_focus).toContain("batch reactions");
    expect(stored.contextAnswers.experiment_routine).toBe("");
    expect(stored.contextAnswers.measured_parameters).toBe("Conversion and selectivity.");
    expect(stored.contextAnswers.instruments).toBe("");
    expect(stored.contextAnswers).not.toHaveProperty("raw_data_processing");
    expect(stored.workbookReviewSessionId).toBe("session_1");
    expect(stored.analysisThreadId).toBe("thread_1");
    expect(stored.analysisRunId).toBe("run_1");
    expect(stored.analysisResultId).toBe("result_1");
  });

  it("opens the result review after the current answer once the preview is ready mid-chain", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "context",
      contextIndex: 1,
      contextAnswers: { project_focus: "Catalyst screening." },
      workbookStatus: "ready",
      generationStatus: "ready",
    });

    render(<ProjectOnboarding projectId="project_1" projectState={baseProjectState} />);

    expect(screen.getByText("Got it. What does a typical experiment routine look like?")).toBeTruthy();
    expect(screen.getByText(/Your preview is ready\. Answer or skip/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), { target: { value: "Load, heat, sample." } });
    fireEvent.click(screen.getByRole("button", { name: "Send onboarding answer" }));

    expect(await screen.findByText(/Perfect—the preview is ready/i)).toBeTruthy();
    expect(screen.queryByText("Which parameters do you measure, and which matter most?")).toBeNull();
    const stored = readProjectOnboarding("project_1");
    expect(stored.step).toBe("result_review");
    expect(stored.contextAnswers.experiment_routine).toBe("Load, heat, sample.");
  });

  it("loads a version 3 session with essay answers into the question map", () => {
    window.localStorage.setItem(projectOnboardingStorageKey("project_1"), JSON.stringify({
      schemaVersion: 3,
      status: "in_progress",
      step: "analysis",
      projectStage: "established",
      masterTableStatus: "yes",
      experimentalWorkflow: "Batch reactor runs.",
      dataAnalysisProcess: "",
      workbookStatus: "ready",
      generationStatus: "working",
    }));

    render(<ProjectOnboarding projectId="project_1" projectState={baseProjectState} />);

    expect(screen.getByText("Batch reactor runs.")).toBeTruthy();
    expect(screen.getByText("Which instruments collect your data?")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Your answer" })).toBeTruthy();
  });

  it("asks for another master table after publication and starts a fresh round", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "waiting_result",
      projectStage: "established",
      masterTableStatus: "yes",
      workbookStatus: "ready",
      workbookFileName: "Master.xlsx",
      workbookReviewSessionId: "session_1",
      contextIndex: 5,
      contextAnswers: { project_focus: "Catalyst screening." },
      round: { number: 1, planRequest: "Use the confirmed regions in Master.xlsx to build reviewed Experiment Browser records." },
    });

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{ ...baseProjectState, experimentSnapshotHeads: [{ id: "a" }, { id: "b" }, { id: "c" }] }}
      />,
    );

    expect(await screen.findByText("Your 3 experiments are in the Experiment Browser.")).toBeTruthy();
    expect(screen.getByText("Do you have other workbooks to upload?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Another master table/ }));

    expect(await screen.findByRole("button", { name: "Upload Excel workbook" })).toBeTruthy();
    expect(screen.getByText("Published 3 experiments from Master.xlsx to the Experiment Browser.")).toBeTruthy();
    expect(screen.getByText("Upload the next master table and I’ll map its structure the same way.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /We have an established workflow/ })).toBeNull();
    expect(screen.queryByText("In one sentence, what is the focus of this project?")).toBeNull();

    const stored = readProjectOnboarding("project_1");
    expect(stored.step).toBe("upload");
    expect(stored.workbookRounds).toEqual([{
      number: 1,
      workbookFileName: "Master.xlsx",
      workbookReviewSessionId: "session_1",
      publishedCount: 3,
    }]);
    expect(stored.round).toBeNull();
    expect(stored.workbookFileName).toBe("");
    expect(stored.workbookReviewSessionId).toBe("");
    expect(stored.publishedCountAtRoundStart).toBe(3);
    expect(stored.projectStage).toBe("established");
    expect(stored.contextAnswers).toEqual({ project_focus: "Catalyst screening." });
  });

  it("does not reopen the publish step for round one's experiments during round two", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "upload",
      projectStage: "established",
      masterTableStatus: "yes",
      workbookRounds: [{ number: 1, workbookFileName: "Master.xlsx", workbookReviewSessionId: "session_1", publishedCount: 3 }],
      publishedCountAtRoundStart: 3,
    });
    const heads = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { rerender } = render(
      <ProjectOnboarding projectId="project_1" projectState={{ ...baseProjectState, experimentSnapshotHeads: heads }} />,
    );

    expect(screen.getByRole("button", { name: "Upload Excel workbook" })).toBeTruthy();
    expect(readProjectOnboarding("project_1").step).toBe("upload");

    rerender(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{ ...baseProjectState, experimentSnapshotHeads: [...heads, { id: "d" }, { id: "e" }] }}
      />,
    );
    expect(await screen.findByText("2 more experiments are in the Experiment Browser, 5 in total.")).toBeTruthy();
    expect(readProjectOnboarding("project_1").step).toBe("more_workbooks");
  });

  it("shows only the current session's regions when falling back to project regions", () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "region_review",
      projectStage: "established",
      masterTableStatus: "yes",
      workbookStatus: "ready",
      workbookFileName: "Second.xlsx",
      workbookReviewSessionId: "session_2",
      workbookRounds: [{ number: 1, workbookFileName: "Master.xlsx", workbookReviewSessionId: "session_1", publishedCount: 3 }],
      publishedCountAtRoundStart: 3,
    });
    const region = (id, sessionId, rangeRef) => ({
      id,
      workbookReviewSessionId: sessionId,
      sourceDocumentId: `source_${sessionId}`,
      sheetName: "Runs",
      rangeRef,
      disposition: "active",
      reviewStatus: "accepted",
      version: 1,
      currentRevisionId: `${id}_rev`,
      acceptedRevisionId: `${id}_rev`,
      currentRevision: { id: `${id}_rev`, summary: ["Each row is one experiment."], validation: {} },
    });

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{
          ...baseProjectState,
          workbookReviewSessions: [
            { id: "session_1", workbookSummary: { workbookName: "Master.xlsx" } },
            { id: "session_2", workbookSummary: { workbookName: "Second.xlsx" } },
          ],
          workbookReviewRegions: [region("region_1", "session_1", "A1:D3"), region("region_2", "session_2", "F1:H5")],
          experimentSnapshotHeads: [{ id: "a" }, { id: "b" }, { id: "c" }],
        }}
      />,
    );

    expect(screen.getByRole("article", { name: "Region Runs!F1:H5" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Region Runs!A1:D3" })).toBeNull();
    expect(readProjectOnboarding("project_1").step).toBe("region_review");
  });

  it("drafts a second-round plan with the round's request text and no context questions", async () => {
    const planRequest = "Use the confirmed regions in Second.xlsx to build reviewed Experiment Browser records.";
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "region_review",
      projectStage: "established",
      masterTableStatus: "yes",
      workbookStatus: "ready",
      workbookFileName: "Second.xlsx",
      workbookReviewSessionId: "session_2",
      workbookRounds: [{ number: 1, workbookFileName: "Master.xlsx", workbookReviewSessionId: "session_1", publishedCount: 3 }],
      round: { number: 2, planRequest },
      publishedCountAtRoundStart: 3,
    });
    const onRecoverExperimentPlan = vi.fn().mockResolvedValue(null);
    const onCreateExperimentPlan = vi.fn(() => new Promise(() => {}));

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{ ...baseProjectState, experimentSnapshotHeads: [{ id: "a" }, { id: "b" }, { id: "c" }] }}
        reviewRegions={[{
          id: "region_2",
          workbookReviewSessionId: "session_2",
          disposition: "active",
          reviewStatus: "accepted",
          acceptedRevisionId: "understanding_2",
          currentRevision: { id: "understanding_2", validation: {} },
        }]}
        onCreateExperimentPlan={onCreateExperimentPlan}
        onRecoverExperimentPlan={onRecoverExperimentPlan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Draft Experiment Browser plan" }));
    await waitFor(() => expect(onCreateExperimentPlan).toHaveBeenCalledWith({ signal: expect.any(AbortSignal), request: planRequest }));
    expect(onRecoverExperimentPlan).toHaveBeenCalledWith({ request: planRequest });
    expect(screen.getByText("Drafting a plan for your Experiment Browser…")).toBeTruthy();
    expect(screen.queryByText(/a few quick questions/)).toBeNull();
    expect(screen.queryByText("In one sentence, what is the focus of this project?")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Your answer" })).toBeNull();
  });

  it("moves to the per-experiment picker after publication instead of bouncing back to the question", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "more_workbooks",
      projectStage: "established",
      masterTableStatus: "yes",
      workbookStatus: "published",
      workbookFileName: "Master.xlsx",
      workbookReviewSessionId: "session_1",
      round: { number: 1, planRequest: "Use the confirmed regions in Master.xlsx to build reviewed Experiment Browser records." },
      publishedCountAtRoundStart: 0,
    });

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{ ...baseProjectState, experimentSnapshotHeads: [{ id: "a" }, { id: "b" }, { id: "c" }] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Per-experiment workbooks/ }));
    expect(await screen.findByRole("button", { name: "Choose workbook files" })).toBeTruthy();
    expect(screen.getByText(/Upload all files that share a layout together/)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readProjectOnboarding("project_1").step).toBe("batch_pick");
    expect(screen.queryByText("Do you have other workbooks to upload?")).toBeNull();
  });

  it("offers a saved template after a batch uploads and applies it without teaching", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "batch_pick",
      projectStage: "established",
      masterTableStatus: "yes",
      workbookRounds: [{ number: 1, workbookFileName: "Master.xlsx", workbookReviewSessionId: "session_master", publishedCount: 3 }],
      publishedCountAtRoundStart: 3,
    });
    const onUploadBatchFile = vi.fn(async (file) => {
      const n = file.name.includes("41") ? "41" : "42";
      return {
        response: { reviewRegions: [] },
        session: { id: `session_${n}`, sourceDocumentId: `sd_${n}` },
        sourceDocument: { id: `sd_${n}`, metadata: { workbookName: file.name } },
        workbookReviewLink: { workbookReviewSessionId: `session_${n}`, sourceDocumentId: `sd_${n}`, workbookName: file.name, regionCount: 0 },
      };
    });
    listExperimentBrowserRows.mockResolvedValue({ rows: [{ experimentId: "exp_41", label: "Exp41" }, { experimentId: "exp_42", label: "Exp42" }] });
    matchServerRegionExtractionTemplate.mockResolvedValue({
      templateName: "Reaction rate data",
      templateVersionId: "tplv_1",
      templateVersion: 1,
      summary: { exact: 2 },
      matches: [
        { sourceDocumentId: "sd_41", status: "exact", eligibleForBatchConfirm: true, experimentLabel: "Exp41", labelSource: "filename", sheetName: "Sheet1", matchedRange: "P31:BA32" },
        { sourceDocumentId: "sd_42", status: "exact", eligibleForBatchConfirm: true, experimentLabel: "Exp42", labelSource: "filename", sheetName: "Sheet1", matchedRange: "P31:BA32" },
      ],
    });
    const onHydrateWorkbookReview = vi.fn(async () => ({}));

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{ ...baseProjectState, experimentSnapshotHeads: [{ id: "a" }, { id: "b" }, { id: "c" }] }}
        onUploadBatchFile={onUploadBatchFile}
        onRefreshProject={vi.fn(async () => ({}))}
        onHydrateWorkbookReview={onHydrateWorkbookReview}
        extractionTemplates={[{ id: "tpl_1", name: "Reaction rate data", status: "active", currentVersionId: "tplv_1", currentVersion: 1, sheetName: "Sheet1", anchorRange: "P31:BA32" }]}
        renderWorkbookGrid={(dock) => <div data-testid="onboarding-grid">{dock}</div>}
      />,
    );

    const files = [
      new File(["a"], "Calculation Exp41.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      new File(["b"], "Calculation Exp42.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    ];
    fireEvent.change(screen.getByLabelText("Choose per-experiment workbook files"), { target: { files } });

    expect(await screen.findByText(/apply a saved template or teach a new one/)).toBeTruthy();
    expect(screen.queryByTestId("onboarding-grid")).toBeNull();
    expect(onHydrateWorkbookReview).not.toHaveBeenCalled();
    expect(readProjectOnboarding("project_1").step).toBe("batch_template_choice");
    expect(screen.getByRole("button", { name: /Teach a new template on one file/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Apply “Reaction rate data”/ }));
    await waitFor(() => expect(matchServerRegionExtractionTemplate).toHaveBeenCalledWith("tplv_1", { sourceDocumentIds: ["sd_41", "sd_42"] }));
    expect(await screen.findByText(/Using “Reaction rate data”\. I’ll look for its block in all 2 files\./)).toBeTruthy();
    expect(await screen.findByText(/2 files match\. Apply the template/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply to 2 matched files" })).toBeTruthy();
    expect(readProjectOnboarding("project_1")).toMatchObject({ step: "batch_apply", batch: { templateSource: "chosen", template: { id: "tpl_1" } } });
  });

  it("uploads per-experiment workbooks, teaches a template, applies it, and links the rest without leaving onboarding", async () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "batch_pick",
      projectStage: "established",
      masterTableStatus: "yes",
      workbookRounds: [{ number: 1, workbookFileName: "Master.xlsx", workbookReviewSessionId: "session_master", publishedCount: 3 }],
      publishedCountAtRoundStart: 3,
    });
    const sessionFor = (file) => (file.name.includes("31") ? "31" : "32");
    const onUploadBatchFile = vi.fn(async (file) => {
      const n = sessionFor(file);
      return {
        response: { reviewRegions: [] },
        session: { id: `session_${n}`, sourceDocumentId: `sd_${n}` },
        sourceDocument: { id: `sd_${n}`, metadata: { workbookName: file.name } },
        workbookReviewLink: { workbookReviewSessionId: `session_${n}`, sourceDocumentId: `sd_${n}`, workbookName: file.name, regionCount: 0 },
      };
    });
    listExperimentBrowserRows.mockResolvedValue({ rows: [{ experimentId: "exp_31", label: "Exp31" }, { experimentId: "exp_32", label: "Exp32" }] });
    matchServerRegionExtractionTemplate.mockResolvedValue({
      templateName: "Reaction rate data",
      templateVersionId: "tplv_1",
      templateVersion: 1,
      summary: { exact: 2 },
      matches: [
        { sourceDocumentId: "sd_31", status: "exact", isTemplateSource: true, eligibleForBatchConfirm: false },
        { sourceDocumentId: "sd_32", status: "exact", eligibleForBatchConfirm: true, experimentLabel: "Exp32", labelSource: "filename", sheetName: "Sheet1", matchedRange: "P31:BA32" },
      ],
    });
    applyServerRegionExtractionTemplate.mockResolvedValue({
      templateName: "Reaction rate data",
      applied: [{
        sourceDocumentId: "sd_32",
        workbookReviewSessionId: "session_32",
        status: "applied",
        region: {
          id: "region_32",
          version: 1,
          sheetName: "Sheet1",
          rangeRef: "P31:BA32",
          reviewStatus: "awaiting_review",
          linkedExperimentId: "exp_32",
          templateMatch: { linkStatus: "resolved", experimentLabel: "Exp32" },
        },
        revision: { id: "rev_32" },
      }],
      skipped: [],
    });
    confirmServerWorkbookReviewRegionsBatch.mockResolvedValue({
      results: [{ regionId: "region_32", ok: true, region: { version: 2, linkedExperimentId: "exp_32", templateMatch: { linkStatus: "resolved", experimentLabel: "Exp32" } } }],
    });
    const onHydrateWorkbookReview = vi.fn(async () => ({}));
    const onSaveExtractionTemplate = vi.fn(async () => ({
      regionExtractionTemplate: { id: "tpl_1", name: "Reaction rate data", currentVersionId: "tplv_1" },
      versions: [{ id: "tplv_1" }],
    }));
    const teachRegion = {
      id: "region_31",
      workbookReviewSessionId: "session_31",
      sourceDocumentId: "sd_31",
      sheetName: "Sheet1",
      rangeRef: "P31:BA32",
      disposition: "active",
      reviewStatus: "accepted",
      version: 2,
      currentRevisionId: "rev_31",
      acceptedRevisionId: "rev_31",
      currentRevision: { id: "rev_31", summary: ["Carbon distribution of the product."], validation: {} },
    };

    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{
          ...baseProjectState,
          workbookReviewSessions: [{ id: "session_master", workbookSummary: { workbookName: "Master.xlsx" } }],
          experimentSnapshotHeads: [{ id: "a" }, { id: "b" }, { id: "c" }],
        }}
        reviewState={{ session: { id: "session_31" }, sourceDocument: { id: "sd_31", metadata: { workbookName: "Calculation Exp31.xlsx" } } }}
        reviewRegions={[teachRegion]}
        activeRegionId="region_31"
        onUploadBatchFile={onUploadBatchFile}
        onRefreshProject={vi.fn(async () => ({}))}
        onHydrateWorkbookReview={onHydrateWorkbookReview}
        onSaveExtractionTemplate={onSaveExtractionTemplate}
        renderWorkbookGrid={(dock) => <div data-testid="onboarding-grid">{dock}</div>}
      />,
    );

    expect(screen.getByText(/Upload all files that share a layout together/)).toBeTruthy();
    const files = [
      new File(["a"], "Calculation Exp31.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      new File(["b"], "Calculation Exp32.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    ];
    fireEvent.change(screen.getByLabelText("Choose per-experiment workbook files"), { target: { files } });

    expect(await screen.findByText(/Let’s start with Calculation Exp31.xlsx/)).toBeTruthy();
    expect(onUploadBatchFile).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/I linked 2 to experiments from their file names\./)).toBeTruthy();
    // The teaching session is already the active review here, so no hydration request is made.
    expect(onHydrateWorkbookReview).not.toHaveBeenCalled();
    const grid = screen.getByTestId("onboarding-grid");
    expect(readProjectOnboarding("project_1")).toMatchObject({ step: "batch_teach", batch: { teach: { sessionId: "session_31" } } });

    const card = within(grid).getByRole("article", { name: "Region Sheet1!P31:BA32" });
    fireEvent.click(within(card).getByRole("button", { name: "Save Sheet1!P31:BA32 as extraction template" }));
    const nameInput = within(card).getByLabelText("Template name");
    fireEvent.change(nameInput, { target: { value: "Reaction rate data" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => expect(onSaveExtractionTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: "region_31" }), { name: "Reaction rate data" }));
    expect(await screen.findByText(/Saved as “Reaction rate data”/)).toBeTruthy();
    await waitFor(() => expect(matchServerRegionExtractionTemplate).toHaveBeenCalledWith("tplv_1", { sourceDocumentIds: ["sd_31", "sd_32"] }));
    expect(await screen.findByText(/1 file matches\. Apply the template/)).toBeTruthy();
    expect(screen.queryByTestId("onboarding-grid")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Apply to 1 matched file" }));
    await waitFor(() => expect(applyServerRegionExtractionTemplate).toHaveBeenCalledWith("tplv_1", expect.objectContaining({ sourceDocumentIds: ["sd_32"] })));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm selected (1)" }));
    await waitFor(() => expect(confirmServerWorkbookReviewRegionsBatch).toHaveBeenCalledWith("project_1", {
      items: [{ regionId: "region_32", revisionId: "rev_32", expectedRegionVersion: 1 }],
    }));
    expect(await screen.findByText(/Confirmed · Exp32/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/2 of 2 files are linked to experiments as “Reaction rate data”/)).toBeTruthy();
    expect(screen.getByText(/does not change the values in your master table/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^I’m done/ }));
    await waitFor(() => expect(readProjectOnboarding("project_1").step).toBe("preview"));
    expect(readProjectOnboarding("project_1").batchRounds).toEqual([
      { number: 1, fileCount: 2, linkedCount: 2, dataKind: "Reaction rate data" },
    ]);
    expect(readProjectOnboarding("project_1").batch).toBeNull();
    expect(screen.getByText("Linked 2 of 2 files to experiments as “Reaction rate data”.")).toBeTruthy();
  });

  it("offers the published Experiment Browser as an explicit destination", () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "preview",
      workbookStatus: "published",
    });
    const onComplete = vi.fn();
    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{
          ...baseProjectState,
          experimentSnapshotHeads: [{ experimentIdentityId: "exp_1" }],
        }}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByText("Your 1 experiment has been published to the Experiment Browser.")).toBeTruthy();
    expect(screen.queryByText(/Does this look right/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open Experiment Browser/i }));
    expect(onComplete).toHaveBeenCalledWith("browser");
    expect(readProjectOnboarding("project_1").status).toBe("completed");
  });

  it("finishes onboarding on the project Overview", () => {
    writeProjectOnboarding("project_1", {
      ...INITIAL_PROJECT_ONBOARDING,
      step: "preview",
      workbookStatus: "published",
    });
    const onComplete = vi.fn();
    render(
      <ProjectOnboarding
        projectId="project_1"
        projectState={{
          ...baseProjectState,
          experimentSnapshotHeads: [
            { experimentIdentityId: "exp_1" },
            { experimentIdentityId: "exp_2" },
          ],
        }}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByText("Your 2 experiments have been published to the Experiment Browser.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Finish onboarding/i }));
    expect(onComplete).toHaveBeenCalledWith("overview");
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
        onRequestCorrection={onRequestCorrection}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Request a correction/i }));
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
    fireEvent.click(screen.getByRole("button", { name: "Draft Experiment Browser plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Report failed generation" }));
    expect(screen.getByText("Generation failed")).toBeTruthy();
    expect(screen.getByText(/too long and was cut off/i)).toBeTruthy();
    expect(screen.queryByText("Generating your Experiment Browser preview…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Quit for now" }));
    expect(onExit).toHaveBeenCalled();
    expect(readProjectOnboarding("project_1").status).toBe("paused");
  });
});
