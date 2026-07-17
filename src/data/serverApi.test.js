import { describe, expect, it, vi } from "vitest";
import {
  ServerApiError,
  cancelServerAgentRun,
  confirmServerAgentRun,
  confirmServerWorkbookReviewSession,
  createServerAgentRun,
  createServerChartSpecFromProposal,
  createServerManuscript,
  createServerProject,
  createServerWorkbookReviewSession,
  deleteServerProject,
  draftServerProjectDataPlan,
  publishServerProjectDataPlan,
  getServerAgentRun,
  getServerProjectState,
  getServerSession,
  getServerWorkbookReviewSession,
  interpretServerProjectChartIntent,
  listServerSourceDocumentRegions,
  listServerSourceDocuments,
  listServerWorkbookUnderstandings,
  listServerWorkbookReviewSessions,
  listServerProjects,
  loginToServer,
  patchServerChartProposalSet,
  patchServerManuscript,
  patchServerProjectProfile,
  patchServerSourceExtractProposal,
  planServerProjectAgent,
  previewServerSourceDocumentExtract,
  previewServerSourceRegionExtract,
  readServerSourceDocumentRange,
  reviseServerWorkbookReviewSession,
  retrieveProjectEvidence,
  createServerSourceExtractChartProposal,
  uploadServerProjectFile,
} from "./serverApi.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}

function lastCall(fetchImpl) {
  const [url, options] = fetchImpl.mock.calls.at(-1);
  return { url, options };
}

describe("serverApi", () => {
  it("logs in and includes credentials for session cookies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: { id: "user_1" }, labs: [] }));

    const body = await loginToServer({ username: "labuser", password: "pw", fetch: fetchImpl });

    expect(body.user.id).toBe("user_1");
    const { url, options } = lastCall(fetchImpl);
    expect(url).toBe("/api/auth/login");
    expect(options.credentials).toBe("include");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ username: "labuser", password: "pw" });
  });

  it("restores a server session and lists projects for a lab", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { id: "user_1" }, labs: [] }))
      .mockResolvedValueOnce(jsonResponse({ projects: [{ id: "project_1" }] }));

    await getServerSession({ fetch: fetchImpl });
    await listServerProjects({ labId: "lab_1", fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/auth/me");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/projects?labId=lab_1");
    expect(fetchImpl.mock.calls[1][1].credentials).toBe("include");
  });

  it("creates projects and saves project profile updates", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ project: { id: "project_1" } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ projectProfile: { researchGoal: "Goal" } }))
      .mockResolvedValueOnce(jsonResponse({ project: { id: "project_1", status: "deleted" } }));

    await createServerProject({ labId: "lab_1", name: "Project A", projectProfile: { researchGoal: "Goal" }, fetch: fetchImpl });
    await patchServerProjectProfile("project_1", { materials: "Ru/TiO2" }, { fetch: fetchImpl });
    await deleteServerProject("project_1", { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      labId: "lab_1",
      name: "Project A",
      description: "",
      projectProfile: { researchGoal: "Goal" },
    });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/projects/project_1/profile");
    expect(fetchImpl.mock.calls[1][1].method).toBe("PATCH");
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/projects/project_1");
    expect(fetchImpl.mock.calls[2][1].method).toBe("PATCH");
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ status: "deleted" });
  });

  it("loads project state, uploads files, and routes workbook review sessions", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ project: { id: "project_1" } }))
      .mockResolvedValueOnce(jsonResponse({ fileObject: { id: "file_1" } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ workbookReviewSession: { id: "session_1" }, sourceDocument: { id: "source_doc_1" }, regions: [] }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ workbookReviewSessions: [{ id: "session_1" }] }))
      .mockResolvedValueOnce(jsonResponse({ workbookReviewSession: { id: "session_1" }, sourceDocument: { id: "source_doc_1" }, regions: [] }));

    await getServerProjectState("project_1", { fetch: fetchImpl });
    await uploadServerProjectFile("project_1", new File(["x"], "runs.xlsx"), { fetch: fetchImpl });
    await createServerWorkbookReviewSession("project_1", { fileObjectId: "file_1" }, { fetch: fetchImpl });
    await listServerWorkbookReviewSessions("project_1", { fetch: fetchImpl });
    await getServerWorkbookReviewSession("session_1", { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/state");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/projects/project_1/files");
    expect(fetchImpl.mock.calls[1][1].body).toBeInstanceOf(FormData);
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/projects/project_1/workbook-review-sessions");
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({
      fileObjectId: "file_1",
      sourceDocumentId: null,
    });
    expect(fetchImpl.mock.calls[3][0]).toBe("/api/projects/project_1/workbook-review-sessions");
    expect(fetchImpl.mock.calls[3][1].method).toBe("GET");
    expect(fetchImpl.mock.calls[4][0]).toBe("/api/workbook-review-sessions/session_1");
  });

  it("routes workbook understanding revision and confirmation helpers", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ workbookReviewSession: { id: "session_1" }, workbookUnderstandingDraft: { id: "draft_1" } }))
      .mockResolvedValueOnce(jsonResponse({ workbookReviewSession: { id: "session_1", status: "accepted" }, workbookUnderstanding: { id: "understanding_1" } }))
      .mockResolvedValueOnce(jsonResponse({ workbookUnderstandings: [{ id: "understanding_1" }] }));

    await reviseServerWorkbookReviewSession("session_1", {
      message: "This is the experiment table.",
      previousUnderstandingId: "draft_previous",
      revisionMode: "replace_current",
      activeDraftRegionId: "draft_region_1",
      redBoxUpdates: [{
        clientRegionId: "draft_region_1",
        sourceDocumentId: "source_doc_1",
        sheetName: "Runs",
        range: "A1:D3",
      }],
      interpretationPatches: [{
        draftRegionId: "draft_region_1",
        experimentAxis: "rows",
        experimentIdColumn: "A",
      }],
    }, { fetch: fetchImpl });
    await confirmServerWorkbookReviewSession("session_1", {
      workbookUnderstandingId: "draft_1",
      decisionSummary: { acceptedByUser: true },
    }, { fetch: fetchImpl });
    await listServerWorkbookUnderstandings("project_1", { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/workbook-review-sessions/session_1/revisions");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      message: "This is the experiment table.",
      previousUnderstandingId: "draft_previous",
      revisionMode: "replace_current",
      activeDraftRegionId: "draft_region_1",
      redBoxUpdates: [{
        clientRegionId: "draft_region_1",
        sourceDocumentId: "source_doc_1",
        sheetName: "Runs",
        range: "A1:D3",
      }],
      interpretationPatches: [{
        draftRegionId: "draft_region_1",
        experimentAxis: "rows",
        experimentIdColumn: "A",
      }],
    });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/workbook-review-sessions/session_1/confirm");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      workbookUnderstandingId: "draft_1",
      decisionSummary: { acceptedByUser: true },
    });
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/projects/project_1/workbook-understandings");
  });

  it("routes project evidence retrieval helper", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      schemaVersion: "labrat.evidenceRetrieval.toolAgent.v1",
      results: [],
      suggestions: [],
    }));

    await retrieveProjectEvidence("project_1", {
      query: "experiment 33 reaction rate",
      mode: "tool_agent",
      includePreview: true,
      includeUnconfirmedSuggestions: true,
      maxResults: 5,
    }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/evidence/retrieve");
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      query: "experiment 33 reaction rate",
      mode: "tool_agent",
      includePreview: true,
      includeUnconfirmedSuggestions: true,
      maxResults: 5,
    });
    expect(() => retrieveProjectEvidence("", { query: "x" }, { fetch: fetchImpl }))
      .toThrow(/project/i);
  });

  it("routes project data plan draft helper", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      resultKind: "data_plan_review",
      dataPlan: { id: "data_plan_preview_1" },
    }));

    await draftServerProjectDataPlan("project_1", {
      intent: "experiment_browser_publish",
      workbookUnderstandingIds: ["workbook_understanding_1"],
      identityDecisions: [{ sourceAlias: "Exp1", action: "create" }],
    }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/data-plans/draft");
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      intent: "experiment_browser_publish",
      workbookUnderstandingIds: ["workbook_understanding_1"],
      identityDecisions: [{ sourceAlias: "Exp1", action: "create" }],
    });
    expect(() => draftServerProjectDataPlan("", { query: "x" }, { fetch: fetchImpl }))
      .toThrow(/project/i);

    const clarificationFetch = vi.fn().mockResolvedValue(jsonResponse({
      resultKind: "clarification",
      clarification: { code: "workbook_understanding_incomplete", message: "Review experiment identity first." },
    }));
    await expect(draftServerProjectDataPlan("project_1", {
      workbookUnderstandingIds: ["workbook_understanding_1"],
    }, { fetch: clarificationFetch })).rejects.toMatchObject({
      code: "workbook_understanding_incomplete",
      message: "Review experiment identity first.",
    });
  });

  it("publishes a reviewed data plan with stale-preview details intact", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        dataPlan: { id: "data_plan_accepted_1", status: "accepted" },
        dataSnapshot: { id: "data_snapshot_1", status: "accepted" },
        idempotentReplay: false,
      }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "preview_stale",
          message: "The preview changed.",
          details: {
            currentReview: {
              dataPlan: { id: "data_plan_preview_2" },
              snapshotPreview: { previewHash: "sha256_current" },
            },
          },
        },
      }, { status: 409 }));
    const request = {
      dataPlan: { id: "data_plan_preview_1", sourceEvidence: [{ workbookUnderstandingId: "wu_1" }] },
      identityDecisions: [{ sourceAlias: "Exp1", action: "create" }],
      expectedPreviewHash: "sha256_preview",
      expectedDependencyHash: "sha256_dependency",
      idempotencyKey: "publish_client_1",
    };

    const published = await publishServerProjectDataPlan("project_1", request, { fetch: fetchImpl });
    expect(published.dataSnapshot.id).toBe("data_snapshot_1");
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/data-plans/publish");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(request);
    expect(() => publishServerProjectDataPlan("", request, { fetch: fetchImpl })).toThrow(/project/i);

    await expect(publishServerProjectDataPlan("project_1", request, { fetch: fetchImpl })).rejects.toMatchObject({
      status: 409,
      code: "preview_stale",
      details: {
        currentReview: {
          snapshotPreview: { previewHash: "sha256_current" },
        },
      },
    });
  });

  it("routes AgentRun operations", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ schemaVersion: "labrat.agentPlan.v1", actions: [] }))
      .mockResolvedValueOnce(jsonResponse({ agentRun: { id: "agent_run_1", actions: [] } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ agentRun: { id: "agent_run_1", status: "completed" } }))
      .mockResolvedValueOnce(jsonResponse({ agentRun: { id: "agent_run_1", status: "completed" } }))
      .mockResolvedValueOnce(jsonResponse({ agentRun: { id: "agent_run_2", status: "cancelled" } }));

    await planServerProjectAgent("project_1", {
      message: "upload supplement for Exp30",
      conversation: [{ role: "user", text: "hello" }],
      selectedContext: { tab: "overview" },
    }, { fetch: fetchImpl });
    await createServerAgentRun("project_1", {
      message: "compare reaction rate for Exp1 and Exp2",
      conversation: [{ role: "user", text: "hello" }],
      selectedContext: { tab: "overview" },
    }, { fetch: fetchImpl });
    await getServerAgentRun("agent_run_1", { fetch: fetchImpl });
    await confirmServerAgentRun("agent_run_1", "agent_run_action_1", { fetch: fetchImpl });
    await cancelServerAgentRun("agent_run_2", { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/agent/plan");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      message: "upload supplement for Exp30",
      conversation: [{ role: "user", text: "hello" }],
      selectedContext: { tab: "overview" },
    });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/projects/project_1/agent/runs");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      message: "compare reaction rate for Exp1 and Exp2",
      conversation: [{ role: "user", text: "hello" }],
      selectedContext: { tab: "overview" },
      modeHint: "auto",
    });
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/agent-runs/agent_run_1");
    expect(fetchImpl.mock.calls[3][0]).toBe("/api/agent-runs/agent_run_1/confirm");
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toEqual({ actionId: "agent_run_action_1" });
    expect(fetchImpl.mock.calls[4][0]).toBe("/api/agent-runs/agent_run_2/cancel");
  });

  it("routes source chart proposal persistence", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ chartProposalSet: { id: "chart_set_1", status: "accepted" } }))
      .mockResolvedValueOnce(jsonResponse({ chartSpec: { id: "chart_spec_1" } }, { status: 201 }));

    await patchServerChartProposalSet("chart_set_1", { status: "accepted" }, { fetch: fetchImpl });
    await createServerChartSpecFromProposal("project_1", { chartProposalSetId: "chart_set_1", proposalId: "chart_1" }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "/api/chart-proposal-sets/chart_set_1",
      "/api/projects/project_1/chart-specs/from-proposal",
    ]);
  });

  it("routes project chart intent gateway requests with frontend entrypoint metadata", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ sourceExtractProposal: { id: "source_extract_1" } }));

    await interpretServerProjectChartIntent("project_1", {
      prompt: "draw carbon distribution from P31 to BA32",
      entrypoint: "chart_review",
      context: { selectedWorkbookId: "file_1" },
    }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/charts/interpret");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      prompt: "draw carbon distribution from P31 to BA32",
      persistAsProposal: true,
      entrypoint: "chart_review",
      context: { selectedWorkbookId: "file_1" },
    });
  });

  it("updates source extract proposals and creates chart proposals from accepted extracts", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ sourceExtractProposal: { id: "source_extract_1", status: "accepted" } }))
      .mockResolvedValueOnce(jsonResponse({ chartProposalSet: { id: "chart_set_source_1" } }, { status: 201 }));

    await patchServerSourceExtractProposal("source_extract_1", {
      status: "accepted",
      decisionSummary: { acceptedByUser: true },
    }, { fetch: fetchImpl });
    await createServerSourceExtractChartProposal("source_extract_1", { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/source-extract-proposals/source_extract_1");
    expect(fetchImpl.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      status: "accepted",
      decisionSummary: { acceptedByUser: true },
    });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/source-extract-proposals/source_extract_1/chart-proposal");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({});
  });

  it("routes read-only source document inspection helpers", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ sourceDocuments: [{ id: "source_doc_1" }] }))
      .mockResolvedValueOnce(jsonResponse({ regions: [] }))
      .mockResolvedValueOnce(jsonResponse({ schemaVersion: "labrat.sourceRange.v1", rows: [] }))
      .mockResolvedValueOnce(jsonResponse({ preview: { extractType: "table_range" } }))
      .mockResolvedValueOnce(jsonResponse({ preview: { extractType: "generic_table" } }));

    await listServerSourceDocuments("project_1", { fetch: fetchImpl });
    await listServerSourceDocumentRegions("source_doc_1", { fetch: fetchImpl });
    await readServerSourceDocumentRange("source_doc_1", { sheetName: "Runs", range: "A1:B2" }, { fetch: fetchImpl });
    await previewServerSourceDocumentExtract("source_doc_1", {
      sheetName: "Runs",
      range: "B2:C3",
      extractType: "table_range",
    }, { fetch: fetchImpl });
    await previewServerSourceRegionExtract("source_region_1", {
      extractType: "component_distribution",
      intent: { title: "Carbon distribution" },
    }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/source-documents");
    expect(fetchImpl.mock.calls[0][1].method).toBe("GET");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/source-documents/source_doc_1/regions");
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/source-documents/source_doc_1/range");
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ sheetName: "Runs", range: "A1:B2" });
    expect(fetchImpl.mock.calls[3][0]).toBe("/api/source-documents/source_doc_1/extract-preview");
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toEqual({
      sheetName: "Runs",
      range: "B2:C3",
      extractType: "table_range",
      intent: {},
    });
    expect(fetchImpl.mock.calls[4][0]).toBe("/api/source-regions/source_region_1/extract-preview");
    expect(JSON.parse(fetchImpl.mock.calls[4][1].body)).toEqual({
      extractType: "component_distribution",
      intent: { title: "Carbon distribution" },
    });
  });

  it("surfaces source range backend errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error: { code: "source_range_too_large", message: "Requested range contains too many cells." },
    }, { status: 400 }));

    await expect(readServerSourceDocumentRange("source_doc_1", {
      sheetName: "Runs",
      range: "A1:ZZ100",
    }, { fetch: fetchImpl })).rejects.toMatchObject({
      code: "source_range_too_large",
      status: 400,
    });
  });

  it("creates and patches project manuscripts", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ manuscript: { id: "manuscript_1" } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ manuscript: { id: "manuscript_1", title: "Updated" } }));

    await createServerManuscript("project_1", {
      title: "Draft",
      blocks: [{ id: "block_1", kind: "chart", chartSpecId: "chart_spec_1" }],
      pages: [],
      canvasState: { canvasHeight: 900 },
      references: [],
    }, { fetch: fetchImpl });
    await patchServerManuscript("manuscript_1", { title: "Updated", blocks: [] }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/manuscripts");
    expect(fetchImpl.mock.calls[0][1].credentials).toBe("include");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).blocks[0]).toEqual({
      id: "block_1",
      kind: "chart",
      chartSpecId: "chart_spec_1",
    });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/manuscripts/manuscript_1");
    expect(fetchImpl.mock.calls[1][1].method).toBe("PATCH");
  });

  it("surfaces backend error envelopes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error: { code: "forbidden", message: "You do not have access." },
    }, { status: 403 }));

    await expect(getServerSession({ fetch: fetchImpl })).rejects.toMatchObject({
      name: "ServerApiError",
      status: 403,
      code: "forbidden",
      message: "You do not have access.",
    });
  });

  it("validates required ids before requests", async () => {
    expect(() => getServerProjectState("")).toThrow(ServerApiError);
    await expect(uploadServerProjectFile("project_1", null)).rejects.toBeInstanceOf(ServerApiError);
  });
});
