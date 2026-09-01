import { describe, expect, test, vi } from "vitest";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { ExperimentService } from "./experiment.service.js";

const auth: AuthContext = {
  sessionId: "session_1",
  user: {
    id: "user_1",
    username: "member",
    displayName: "Member",
    isActive: true,
    isSuperAdmin: false,
  },
  memberships: [{
    labId: "lab_1",
    labName: "Lab",
    labSlug: "lab",
    role: "lab_member",
    status: "active",
  }],
};

function selectedAccess(capabilities = ["read", "propose"]) {
  return {
    projectId: "project_1",
    shellOnly: true,
    capabilities,
    allExperiments: false,
    experimentIds: ["experiment_1"],
    experimentCapabilities: { experiment_1: capabilities },
  };
}

function projectionState() {
  return {
    dataSnapshots: [{
      id: "snapshot_1",
      projectId: "project_1",
      dataPlanId: "plan_1",
      status: "accepted",
      contentHash: "content_1",
      dependencyHash: "dependency_1",
      acceptedAt: "2026-08-23T12:00:00.000Z",
      acceptedBy: "user_owner",
      experimentRecords: [{
        experimentId: "experiment_1",
        label: "Exp1",
        aliases: ["Exp1"],
        fields: [],
        series: [],
        warnings: [],
        sourceRefs: [],
      }],
    }],
    experimentIdentities: [{
      id: "experiment_1",
      projectId: "project_1",
      canonicalLabel: "Exp1",
      aliases: ["Exp1"],
    }],
    experimentSnapshotHeads: [{
      id: "head_1",
      projectId: "project_1",
      experimentId: "experiment_1",
      dataSnapshotId: "snapshot_1",
      recordIndex: 0,
    }],
  };
}

function serviceFixture() {
  const project = { id: "project_1", labId: "lab_1" };
  const access = selectedAccess();
  const repository = {
    loadProjectionState: vi.fn(async () => projectionState()),
    listAnnotations: vi.fn(async () => []),
    listCustomColumns: vi.fn(async () => []),
    listCustomValues: vi.fn(async () => []),
    createBrowserView: vi.fn(async (input) => ({ id: "view_1", ...input })),
    listDataPlans: vi.fn(async () => []),
  };
  const authorization = {
    requireProjectCapability: vi.fn(async () => ({ project, access })),
    requireFullProjectCapability: vi.fn(async () => {
      throw new ApiError(403, "forbidden", "Full project required.");
    }),
    requireExperimentCapability: vi.fn(async () => ({ project, access })),
  };
  const identityRepository = { recordAudit: vi.fn(async () => undefined) };
  return {
    repository,
    authorization,
    service: new ExperimentService(repository as never, authorization as never, identityRepository as never),
  };
}

describe("ExperimentService authorization boundaries", () => {
  test("passes only selected experiment ids into every Browser repository read", async () => {
    const fixture = serviceFixture();
    const result = await fixture.service.getBrowser(auth, "project_1", {});
    expect(result).toMatchObject({
      totalCount: 1,
      rows: [{ experimentId: "experiment_1" }],
    });
    expect(fixture.repository.loadProjectionState).toHaveBeenCalledWith("project_1", ["experiment_1"]);
    expect(fixture.repository.listAnnotations).toHaveBeenCalledWith("project_1", "user_1", ["experiment_1"]);
    expect(fixture.repository.listCustomColumns).toHaveBeenCalledWith("project_1", ["experiment_1"]);
    expect(fixture.repository.listCustomValues).toHaveBeenCalledWith("project_1", ["experiment_1"]);
  });

  test("rejects project-wide DataPlan reads for a selected-experiment grant", async () => {
    const fixture = serviceFixture();
    await expect(fixture.service.listDataPlans(auth, "project_1")).rejects.toMatchObject({
      statusCode: 403,
      code: "forbidden",
    });
    expect(fixture.repository.listDataPlans).not.toHaveBeenCalled();
  });

  test("removes inaccessible experiment ids before persisting a personal Browser view", async () => {
    const fixture = serviceFixture();
    await fixture.service.createBrowserView(auth, "project_1", {
      name: "My view",
      payload: {
        columns: [],
        filters: [],
        sort: [],
        selectedExperimentIds: ["experiment_1", "experiment_hidden"],
      },
    });
    expect(fixture.repository.createBrowserView).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ selectedExperimentIds: ["experiment_1"] }),
    }));
  });

  test("rejects malformed JSON-array Browser query parameters before repository projection", async () => {
    const fixture = serviceFixture();
    await expect(fixture.service.getBrowser(auth, "project_1", { filters: "{}" }))
      .rejects.toMatchObject({ statusCode: 400, code: "invalid_browser_query" });
  });
});
