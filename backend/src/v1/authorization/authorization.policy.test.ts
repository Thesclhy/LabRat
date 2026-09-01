import { describe, expect, test } from "vitest";
import {
  hasExperimentCapability,
  hasProjectCapability,
  resolveEffectiveProjectAccess,
} from "./authorization.policy.js";

describe("authorization v1 policy", () => {
  test("Lab owners and administrators receive every project capability", () => {
    for (const labRole of ["lab_owner", "lab_admin"] as const) {
      const access = resolveEffectiveProjectAccess({
        projectId: "project_1",
        labRole,
        projectGrants: [],
        experimentGrants: [],
      });
      expect(access).toMatchObject({ shellOnly: false, allExperiments: true });
      expect(hasProjectCapability(access, "manage_access")).toBe(true);
      expect(hasExperimentCapability(access, "experiment_1", "approve")).toBe(true);
    }
  });

  test("platform status is not a Lab role and cannot create scientific access", () => {
    const access = resolveEffectiveProjectAccess({
      projectId: "project_1",
      labRole: null,
      projectGrants: [{ scope: "all_experiments", capabilities: ["read"] }],
      experimentGrants: [],
    });
    expect(access).toBeNull();
  });

  test("ordinary members are denied by default", () => {
    expect(resolveEffectiveProjectAccess({
      projectId: "project_1",
      labRole: "lab_member",
      projectGrants: [],
      experimentGrants: [],
    })).toBeNull();
  });

  test("one experiment grant exposes a shell and only that experiment", () => {
    const access = resolveEffectiveProjectAccess({
      projectId: "project_1",
      labRole: "lab_member",
      projectGrants: [{ scope: "selected_experiments", capabilities: ["read"] }],
      experimentGrants: [{ experimentId: "experiment_2", capabilities: ["read", "propose"] }],
    });
    expect(access).toMatchObject({
      shellOnly: true,
      allExperiments: false,
      experimentIds: ["experiment_2"],
    });
    expect(hasExperimentCapability(access, "experiment_2", "read")).toBe(true);
    expect(hasExperimentCapability(access, "experiment_1", "read")).toBe(false);
  });

  test("all-experiment grants apply only their declared capabilities", () => {
    const access = resolveEffectiveProjectAccess({
      projectId: "project_1",
      labRole: "lab_member",
      projectGrants: [{ scope: "all_experiments", capabilities: ["read", "export", "unknown"] }],
      experimentGrants: [],
    });
    expect(access?.capabilities).toEqual(["read", "export"]);
    expect(hasExperimentCapability(access, "experiment_1", "read")).toBe(true);
    expect(hasExperimentCapability(access, "experiment_1", "approve")).toBe(false);
  });
});
