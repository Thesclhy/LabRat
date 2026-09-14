import React, { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    expect(onCreateExperimentPlan).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
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
      expect(screen.getByRole("button", { name: "Accept plan" })).toBeTruthy();
      expect(readProjectOnboarding("project_1")).toMatchObject({
        step: "plan_review",
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
    const acceptPlan = await screen.findByRole("button", { name: "Accept plan" });
    expect(loadAnalysisThread).not.toHaveBeenCalled();
    fireEvent.click(acceptPlan);

    expect(screen.getByText("Generating your Experiment Browser preview…")).toBeTruthy();
    expect(screen.getByText("In one sentence, what is the focus of this project?")).toBeTruthy();
    expect(screen.queryByText("What does a typical experiment routine look like?")).toBeNull();
    const focusInput = screen.getByRole("textbox", { name: "Your answer" });
    expect(focusInput.getAttribute("placeholder")).toBe("");
    fireEvent.change(focusInput, { target: { value: "We run batch reactions and record each experiment in one row." } });
    fireEvent.click(screen.getByRole("button", { name: "Send onboarding answer" }));

    const pendingFocus = screen.getByText("We run batch reactions and record each experiment in one row.");
    expect(pendingFocus.closest(".project-onboarding-message")?.classList.contains("user")).toBe(true);
    expect(await screen.findByText("Got it. What does a typical experiment routine look like?")).toBeTruthy();
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
