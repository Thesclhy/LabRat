import { describe, expect, test, vi } from "vitest";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { AnalysisService } from "./analysis.service.js";

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
  const project = { id: "project_1", labId: "lab_1", metadata: {} };
  const repository = {
    listAnalysisThreads: vi.fn(async () => []),
    createAnalysisThread: vi.fn(async (input: Record<string, any>) => ({
      id: "analysis_thread_1",
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      ...input,
    })),
    findAnalysisThreadById: vi.fn(async (): Promise<any> => null),
    findAnalysisPlanRevisionById: vi.fn(async (): Promise<any> => null),
    findAnalysisRunById: vi.fn(async (): Promise<any> => null),
    listDataSnapshots: vi.fn(async () => []),
    listExperimentSnapshotHeads: vi.fn(async () => []),
    listAcceptedRegionUnderstandings: vi.fn(async () => []),
    listChartSpecs: vi.fn(async () => []),
    listManuscripts: vi.fn(async () => []),
    listSourceDocuments: vi.fn(async () => []),
    createAgentRun: vi.fn(async (input: Record<string, any>) => ({
      id: "agent_run_1",
      schemaVersion: "labrat.agentRun.v1",
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
      updatedBy: input.createdBy,
      ...input,
    })),
    acceptAnalysisPlan: vi.fn(),
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
  const identityRepository = { recordAudit: vi.fn(async () => undefined), findUserById: vi.fn(async () => ({...auth.user})) };
  const modelProvider = { publicConfig: vi.fn(() => ({ provider: "test", model: "test-model", configured: true })) };
  const executor = { publicConfig: vi.fn(() => ({ mode: "disabled", adapter: "disabled", configured: false })) };
  const service = new AnalysisService(
    repository as never,
    authorization as never,
    identityRepository as never,
    modelProvider as never,
    executor as never,
  );
  return { authorization, executor, identityRepository, modelProvider, project, repository, service };
}

describe("AnalysisService contract and authorization boundaries", () => {
  test("rejects a deactivated initiator before saving an AgentRun", async () => {
    const testFixture = fixture();
    testFixture.identityRepository.findUserById.mockResolvedValueOnce({...auth.user,isActive:false});
    await expect(testFixture.service.createAgentRun(auth,"project_1",{message:"Upload a workbook",selectedContext:{}}))
      .rejects.toMatchObject({statusCode:403,code:"forbidden"});
    expect(testFixture.repository.createAgentRun).not.toHaveBeenCalled();
  });

  test("rejects shell-only access before listing project-wide analysis artifacts", async () => {
    const testFixture = fixture();
    testFixture.authorization.requireFullProjectCapability.mockRejectedValueOnce(
      new ApiError(403, "forbidden", "Full project required."),
    );

    await expect(testFixture.service.listThreads(auth, "project_1", {}))
      .rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
    expect(testFixture.repository.listAnalysisThreads).not.toHaveBeenCalled();
  });

  test("conceals a direct analysis-thread id from shell-only access", async () => {
    const testFixture = fixture();
    testFixture.repository.findAnalysisThreadById.mockResolvedValueOnce({
      id: "thread_1",
      projectId: "project_1",
    });
    testFixture.authorization.resolveProjectAccess.mockResolvedValueOnce({
      project: testFixture.project,
      access: { allExperiments: false, capabilities: ["read"] },
    });

    await expect(testFixture.service.threadDetail(auth, "thread_1"))
      .rejects.toMatchObject({ statusCode: 404, code: "analysis_thread_not_found" });
  });

  test("requires approve rather than propose before plan acceptance", async () => {
    const testFixture = fixture();
    testFixture.repository.findAnalysisPlanRevisionById.mockResolvedValueOnce({
      id: "revision_1",
      projectId: "project_1",
    });
    testFixture.authorization.resolveProjectAccess.mockResolvedValueOnce({
      project: testFixture.project,
      access: { allExperiments: true, capabilities: ["read", "propose"] },
    });

    await expect(testFixture.service.acceptPlan(auth, "revision_1", "accept_1", {}))
      .rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
    expect(testFixture.repository.acceptAnalysisPlan).not.toHaveBeenCalled();
  });

  test("rejects a missing idempotency key before entering the atomic acceptance transaction", async () => {
    const testFixture = fixture();
    testFixture.repository.findAnalysisPlanRevisionById.mockResolvedValueOnce({
      id: "revision_1",
      projectId: "project_1",
    });

    await expect(testFixture.service.acceptPlan(auth, "revision_1", undefined, {}))
      .rejects.toMatchObject({ statusCode: 400, code: "idempotency_key_required" });
    expect(testFixture.repository.acceptAnalysisPlan).not.toHaveBeenCalled();
  });

  test("returns only the public capability allowlist even if an adapter exposes extra fields", async () => {
    const testFixture = fixture();
    testFixture.modelProvider.publicConfig.mockReturnValueOnce({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      configured: true,
      apiKey: "model-secret",
    } as never);
    testFixture.executor.publicConfig.mockReturnValueOnce({
      mode: "worker",
      adapter: "hardened_worker",
      configured: true,
      productionSafe: true,
      endpoint: "https://secret-worker.example",
    } as never);

    const result = await testFixture.service.capabilities(auth, "project_1");
    expect(result).toMatchObject({
      model: { provider: "deepseek", model: "deepseek-v4-pro", configured: true },
      executor: { mode: "worker", adapter: "hardened_worker", configured: true, productionSafe: true },
    });
    expect(JSON.stringify(result)).not.toContain("model-secret");
    expect(JSON.stringify(result)).not.toContain("secret-worker");
  });

  test("creates a deterministic upload AgentRun without starting analysis or calling a model", async () => {
    const testFixture = fixture();

    const result = await testFixture.service.createAgentRun(auth, "project_1", {
      message: "Upload a workbook",
      selectedContext: {},
    });

    expect(result).toMatchObject({
      agentRun: { id: "agent_run_1", mode: "workbook_upload", status: "completed" },
      analysisThread: null,
      currentPlanRevision: null,
    });
    expect(testFixture.repository.createAgentRun).toHaveBeenCalledTimes(1);
    expect(testFixture.identityRepository.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "agent_run.create",
      targetId: "agent_run_1",
    }));
  });

  test("persists and exposes the requested chart input mode", async () => {
    const testFixture = fixture();

    const result = await testFixture.service.createThread(auth, "project_1", {
      originalRequest: "Chart accepted experiment yields.",
      outputTarget: "chart",
      inputMode: "experiment_browser",
    });

    expect(result).toMatchObject({
      outputTarget: "chart",
      inputMode: "experiment_browser",
    });
    expect(testFixture.repository.createAnalysisThread).toHaveBeenCalledWith(expect.objectContaining({
      inputMode: "experiment_browser",
    }));
  });

  test("rejects an unsupported selectedContext chart input mode before drafting", async () => {
    const testFixture = fixture();

    await expect(testFixture.service.createAgentRun(auth, "project_1", {
      message: "Chart accepted data.",
      selectedContext: { chartInputMode: "mixed" },
    })).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_chart_input_mode",
    });
    expect(testFixture.repository.createAgentRun).not.toHaveBeenCalled();
  });

  test("rejects a chart input mode on a data-publication thread", async () => {
    const testFixture = fixture();
    await expect(testFixture.service.createThread(auth, "project_1", {
      originalRequest: "Publish a data column.",
      outputTarget: "experiment_browser",
      inputMode: "workbook",
    })).rejects.toMatchObject({ statusCode: 400, code: "chart_input_mode_conflict" });
    expect(testFixture.repository.createAnalysisThread).not.toHaveBeenCalled();
  });
});

test("a standalone mean request cannot create an analysis thread or a plan", async () => {
  const { service, repository } = fixture();
  const result = await service.createAgentRun(auth, "project_1", { message: "Calculate the mean of Exp17's temperature series.", selectedContext: { activeSurface: "experiment_browser" } });
  expect(result.agentRun.mode).toBe("clarification");
  expect(result.analysisThread).toBeNull();
  expect(result.currentPlanRevision).toBeNull();
  expect(repository.createAnalysisThread).not.toHaveBeenCalled();
  expect(result.reply).toContain("standalone numeric answer");
});

test("manuscript chart commentary reads the selected chart's traces rather than its bounded list item", async () => {
  const base = fixture();
  const chartSpec = {
    id: "chart_1",
    projectId: "project_1",
    spec: {
      schemaVersion: "labrat.chartSpec.v3",
      origin: "analysis_result",
      status: "accepted",
      chartType: "grouped_bar",
      title: "Gas product distribution",
      plotly: {
        data: [
          { type: "bar", name: "Exp45", x: ["C1", "C2"], y: [40, 15] },
          { type: "bar", name: "Exp46", x: ["C1", "C2"], y: [300, 140] },
        ],
        layout: {},
      },
      traceCatalog: [
        { traceId: "trace_1", name: "Exp45", type: "bar", pointCount: 2 },
        { traceId: "trace_2", name: "Exp46", type: "bar", pointCount: 2 },
      ],
      defaultChartView: { visibleTraceIds: ["trace_1", "trace_2"] },
    },
  };
  base.repository.listChartSpecs.mockResolvedValue([chartSpec] as never);
  const answerChartCommentary = vi.fn(async () => ({ ok: true, answer: "Exp46 produces more C1." }));
  const service = new AnalysisService(base.repository as never, base.authorization as never, base.identityRepository as never, {
    ...base.modelProvider,
    answerChartCommentary,
  } as never, base.executor as never);

  const result = await service.createAgentRun(auth, "project_1", {
    message: "Write a manuscript-ready analysis of the selected chart.",
    selectedContext: {
      requestedWorkflow: "chart_commentary",
      selectedChartSpecId: "chart_1",
      selectedChartView: { visibleTraceIds: ["trace_1", "trace_2"] },
    },
  });

  expect(result.reply).toBe("Exp46 produces more C1.");
  expect(answerChartCommentary).toHaveBeenCalledTimes(1);
  expect((answerChartCommentary.mock.calls[0] as any)[0].chart.traces).toHaveLength(2);
});

test("missing series remains a durable clarification, not a provider failure or executable revision", async () => {
  const { temperaturePlanFixture } = await import("../../saas/testing/temperaturePlanFixture.js");
  const { store, project } = await temperaturePlanFixture();
  const base = fixture();
  base.authorization.requireFullProjectCapability.mockResolvedValue({ project, access: { allExperiments: true, capabilities: ["read", "propose", "approve"] } } as never);
  base.authorization.resolveProjectAccess.mockResolvedValue({ project, access: { allExperiments: true, capabilities: ["read", "propose", "approve"] } } as never);
  const service = new AnalysisService(store as never, base.authorization as never, base.identityRepository as never, {
    draftAnalysisPlan: async () => ({ ok: true, clarification: "Exp17 has no confirmed temperature series. Which series should I use?", reviewPlan: null }),
  } as never, base.executor as never);
  const result = await service.createAgentRun(auth, project.id, { message: "Calculate the mean of Exp17's temperature series and plot it.", selectedContext: {} });
  expect(result.agentRun).toMatchObject({ mode: "clarification", status: "waiting_for_user" });
  expect(result.currentPlanRevision).toBeNull();
  expect(result.reply).toContain("no confirmed temperature series");
  expect(result.reply).not.toContain("backend could not");
  const detail = await service.threadDetail(auth, result.analysisThread!.id);
  expect(detail.planFailure).toBeNull();
  expect(detail.analysisThread.status).toBe("planning");
  expect(detail.analysisThread.messages.at(-1)?.content).toBe(result.reply);
  expect(store.analysisRuns.size).toBe(0);
});
