import { describe, expect, test, vi } from "vitest";
import { sha256Hex } from "../../saas/ids.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { ReusableChartsService } from "./reusable-charts.service.js";

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

function fixture() {
  const project = { id: "project_1", projectId: "project_1", labId: "lab_1" };
  const version = {
    id: "template_version_1",
    projectId: project.id,
    reusableChartTemplateId: "template_1",
    contentHash: "sha256_template",
  };
  const template = {
    id: "template_1",
    projectId: project.id,
    labId: project.labId,
    status: "active",
    name: "Yield comparison",
  };
  const repository = {
    listChartStyleProfiles: vi.fn(async () => []),
    findChartStyleProfileVersionById: vi.fn(async () => null),
    findReusableChartTemplateById: vi.fn(async () => template),
    findReusableChartTemplateVersionById: vi.fn(async () => version),
    findReusableChartTemplateApplicationByIdempotencyKey: vi.fn(async () => null),
    findAnalysisThreadById: vi.fn(async () => null),
    findAnalysisPlanRevisionById: vi.fn(async () => null),
    findAnalysisRunById: vi.fn(async () => null),
    createReusableChartTemplateApplication: vi.fn(),
  };
  const authorization = {
    requireFullProjectCapability: vi.fn(async () => ({
      project,
      access: { allExperiments: true, capabilities: ["read", "propose", "approve"] },
    })),
    resolveProjectAccess: vi.fn(async () => ({
      project,
      access: { allExperiments: true, capabilities: ["read", "propose", "approve"] },
    })),
  };
  const identityRepository = { recordAudit: vi.fn(async () => undefined) };
  return {
    authorization,
    project,
    repository,
    service: new ReusableChartsService(
      repository as never,
      authorization as never,
      identityRepository as never,
    ),
    template,
    version,
  };
}

describe("ReusableChartsService authorization and idempotency", () => {
  test("requires full-project read before enumerating style profiles", async () => {
    const testFixture = fixture();
    testFixture.authorization.requireFullProjectCapability.mockRejectedValueOnce(
      new ApiError(403, "forbidden", "Full project required."),
    );

    await expect(testFixture.service.listStyleProfiles(auth, "project_1", {}))
      .rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
    expect(testFixture.repository.listChartStyleProfiles).not.toHaveBeenCalled();
  });

  test("conceals direct template ids from selected-experiment shells", async () => {
    const testFixture = fixture();
    testFixture.authorization.resolveProjectAccess.mockResolvedValueOnce({
      project: testFixture.project,
      access: { allExperiments: false, capabilities: ["read"] },
    });

    await expect(testFixture.service.templateDetail(auth, "template_1"))
      .rejects.toMatchObject({ statusCode: 404, code: "reusable_chart_template_not_found" });
  });

  test("returns 200 for an exact application replay without entering the write transaction", async () => {
    const testFixture = fixture();
    const experimentIds = ["experiment_1"];
    const bindings: unknown[] = [];
    const requestHash = sha256Hex(JSON.stringify({
      reusableChartTemplateVersionId: testFixture.version.id,
      contentHash: testFixture.version.contentHash,
      experimentIds,
      bindings,
    }));
    testFixture.repository.findReusableChartTemplateApplicationByIdempotencyKey.mockResolvedValueOnce({
      id: "application_1",
      projectId: "project_1",
      requestHash,
      compatibility: { status: "ready" },
      analysisThreadId: null,
      analysisPlanRevisionId: null,
      analysisRunId: null,
    });

    const result = await testFixture.service.applyTemplate(
      auth,
      testFixture.version.id,
      { experimentIds, bindings: [] },
      "application_key_1",
      {},
    );

    expect(result).toMatchObject({
      statusCode: 200,
      replayed: true,
      application: { id: "application_1" },
    });
    expect(testFixture.repository.createReusableChartTemplateApplication).not.toHaveBeenCalled();
  });

  test("rejects reuse of an application key for different inputs", async () => {
    const testFixture = fixture();
    testFixture.repository.findReusableChartTemplateApplicationByIdempotencyKey.mockResolvedValueOnce({
      id: "application_1",
      projectId: "project_1",
      requestHash: "sha256_different",
      compatibility: {},
    });

    await expect(testFixture.service.applyTemplate(
      auth,
      testFixture.version.id,
      { experimentIds: ["experiment_1"], bindings: [] },
      "application_key_1",
      {},
    )).rejects.toMatchObject({
      statusCode: 409,
      code: "chart_template_idempotency_conflict",
    });
    expect(testFixture.repository.createReusableChartTemplateApplication).not.toHaveBeenCalled();
  });
});
