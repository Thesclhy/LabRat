import { beforeEach, describe, expect, it } from "vitest";
import {
  INITIAL_PROJECT_ONBOARDING,
  projectOnboardingStorageKey,
  readProjectOnboarding,
  shouldShowProjectOnboarding,
  writeProjectOnboarding,
} from "./projectOnboardingState.js";

describe("project onboarding state", () => {
  beforeEach(() => {
    ["project_1", "project_alpha", "project_beta", "project alpha"].forEach((projectId) => {
      window.localStorage.removeItem(projectOnboardingStorageKey(projectId));
    });
  });

  it("offers onboarding only for a pristine or already-started project", () => {
    const emptyState = {
      project: { id: "project_1" },
      workbookReviewSessions: [],
      experimentSnapshotHeads: [],
    };
    expect(shouldShowProjectOnboarding("project_1", emptyState)).toBe(true);

    expect(shouldShowProjectOnboarding("project_1", {
      ...emptyState,
      workbookReviewSessions: [{ id: "session_1", status: "active" }],
    })).toBe(false);

    writeProjectOnboarding("project_1", { ...INITIAL_PROJECT_ONBOARDING, step: "review" });
    expect(shouldShowProjectOnboarding("project_1", {
      ...emptyState,
      workbookReviewSessions: [{ id: "session_1", status: "active" }],
    })).toBe(true);
  });

  it("stops showing after completion or skip", () => {
    const projectState = {
      project: { id: "project_1" },
      workbookReviewSessions: [],
      experimentSnapshotHeads: [],
    };
    writeProjectOnboarding("project_1", { status: "completed" });
    expect(shouldShowProjectOnboarding("project_1", projectState)).toBe(false);

    writeProjectOnboarding("project_1", { status: "skipped" });
    expect(shouldShowProjectOnboarding("project_1", projectState)).toBe(false);
  });

  it("migrates version 3 essay answers and steps onto the context questions", () => {
    window.localStorage.setItem(projectOnboardingStorageKey("project_1"), JSON.stringify({
      schemaVersion: 3,
      status: "in_progress",
      step: "workflow",
      experimentalWorkflow: "Batch reactor runs.",
      dataAnalysisProcess: "Peak areas to mol%.",
    }));

    const migrated = readProjectOnboarding("project_1");
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.step).toBe("context");
    expect(migrated.contextIndex).toBe(1);
    expect(migrated.contextAnswers).toEqual({
      project_focus: "Batch reactor runs.",
      instruments: "Peak areas to mol%.",
    });
    expect(migrated).not.toHaveProperty("experimentalWorkflow");
    expect(migrated.workbookRounds).toEqual([]);

    writeProjectOnboarding("project_1", { step: "analysis", dataAnalysisProcess: "" });
    const rewritten = readProjectOnboarding("project_1");
    expect(rewritten.step).toBe("context");
    expect(rewritten.contextIndex).toBe(3);
    expect(rewritten.contextAnswers).toEqual({});
  });

  it("stores independent progress for each project", () => {
    writeProjectOnboarding("project_alpha", { projectStage: "early", step: "master_table" });
    writeProjectOnboarding("project_beta", { projectStage: "mature", step: "upload" });

    expect(readProjectOnboarding("project_alpha").projectStage).toBe("early");
    expect(readProjectOnboarding("project_beta").projectStage).toBe("mature");
    expect(projectOnboardingStorageKey("project alpha")).toContain("project%20alpha");
  });
});
