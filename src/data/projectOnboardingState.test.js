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

  it("stores independent progress for each project", () => {
    writeProjectOnboarding("project_alpha", { projectStage: "early", step: "master_table" });
    writeProjectOnboarding("project_beta", { projectStage: "mature", step: "upload" });

    expect(readProjectOnboarding("project_alpha").projectStage).toBe("early");
    expect(readProjectOnboarding("project_beta").projectStage).toBe("mature");
    expect(projectOnboardingStorageKey("project alpha")).toContain("project%20alpha");
  });
});
