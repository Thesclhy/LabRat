import { describe, expect, test, vi } from "vitest";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { ChartService } from "./chart.service.js";

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

function chartSpec() {
  return {
    id: "chart_1",
    labId: "lab_1",
    projectId: "project_1",
    analysisResultId: "result_1",
    title: "Carbon distribution",
    chartType: "bar",
    spec: {
      schemaVersion: "labrat.chartSpec.v3",
      origin: "analysis_result",
      analysisThreadId: "thread_1",
      analysisPlanRevisionId: "revision_1",
      analysisRunId: "run_1",
      analysisResultId: "result_1",
      sourceSelections: [{ range: "A1:C2" }],
      sourceRefs: [{ cell: "B2" }],
      traceCatalog: [{ traceId: "trace_1", name: "Exp1", type: "bar", pointCount: 2 }],
      plotly: { data: [{ x: ["C1", "C2"], y: [1, 2] }], layout: {} },
      defaultChartView: { visibleTraceIds: ["trace_1"] },
    },
    layout: {},
    warnings: [],
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    createdBy: "user_1",
    updatedBy: "user_1",
  };
}

function fixture() {
  const repository = {
    listChartSpecs: vi.fn(async () => [
      chartSpec(),
      { ...chartSpec(), id: "legacy_chart", spec: { schemaVersion: "labrat.chartSpec.v2" } },
    ]),
    findChartSpecById: vi.fn(async (): Promise<any> => chartSpec()),
  };
  const authorization = {
    requireFullProjectCapability: vi.fn(async () => ({
      project: { id: "project_1", labId: "lab_1" },
      access: { allExperiments: true, capabilities: ["read"] },
    })),
    resolveProjectAccess: vi.fn(async () => ({
      project: { id: "project_1", labId: "lab_1" },
      access: { allExperiments: true, capabilities: ["read"] },
    })),
  };
  return {
    authorization,
    repository,
    service: new ChartService(repository as never, authorization as never),
  };
}

describe("ChartService artifact boundaries", () => {
  test("requires full-project access before enumerating ChartSpecs", async () => {
    const testFixture = fixture();
    testFixture.authorization.requireFullProjectCapability.mockRejectedValueOnce(
      new ApiError(403, "forbidden", "Full project required."),
    );
    await expect(testFixture.service.list(auth, "project_1", {}))
      .rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
    expect(testFixture.repository.listChartSpecs).not.toHaveBeenCalled();
  });

  test("lists only accepted v3 analysis charts and removes large scientific arrays", async () => {
    const result = await fixture().service.list(auth, "project_1", {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "chart_1",
      spec: {
        detailRequired: true,
        sourceSelectionCount: 1,
        sourceRefCount: 1,
        plotlyTraceCount: 1,
        traceCatalog: [{ traceId: "trace_1", pointCount: 2 }],
      },
    });
    expect(result.items[0]?.spec).not.toHaveProperty("plotly");
    expect(result.items[0]?.spec).not.toHaveProperty("sourceSelections");
    expect(result.items[0]?.spec).not.toHaveProperty("sourceRefs");
  });

  test("returns the complete immutable ChartSpec only from its detail route", async () => {
    const result = await fixture().service.detail(auth, "chart_1");
    expect((result.spec.plotly as { data: unknown[] }).data[0])
      .toEqual({ x: ["C1", "C2"], y: [1, 2] });
  });

  test("conceals direct ChartSpec ids from selected-experiment shells", async () => {
    const testFixture = fixture();
    testFixture.authorization.resolveProjectAccess.mockResolvedValueOnce({
      project: { id: "project_1", labId: "lab_1" },
      access: { allExperiments: false, capabilities: ["read"] },
    } as never);
    await expect(testFixture.service.detail(auth, "chart_1"))
      .rejects.toMatchObject({ statusCode: 404, code: "chart_spec_not_found" });
  });
});
