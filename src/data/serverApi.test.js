import { describe, expect, it, vi } from "vitest";
import {
  ServerApiError,
  cancelServerAgentRun,
  confirmServerWorkbookReviewRegion,
  createServerWorkbookReviewRegion,
  createServerAgentRun,
  createServerManuscript,
  createServerProject,
  createServerWorkbookReviewSession,
  deleteServerProject,
  deleteServerWorkbookReviewSession,
  getServerAgentRun,
  getServerChartSpec,
  getServerProjectState,
  getServerSession,
  getServerWorkbookReviewSession,
  interpretServerWorkbookReviewRegion,
  listServerSourceDocumentRegions,
  listServerSourceDocuments,
  listServerRegionUnderstandings,
  listServerWorkbookReviewRegionRevisions,
  listServerWorkbookReviewRegions,
  listServerWorkbookReviewSessions,
  listServerProjects,
  loginToServer,
  patchServerManuscript,
  patchServerProjectProfile,
  readServerSourceDocumentRange,
  reviseServerWorkbookReviewRegion,
  ignoreServerWorkbookReviewRegion,
  deleteServerWorkbookReviewRegion,
  retrieveProjectEvidence,
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

  it("routes independent workbook region lifecycle helpers", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValue(jsonResponse({ region: { id: "region_1" } }));

    await listServerWorkbookReviewRegions("session_1", { fetch: fetchImpl });
    await createServerWorkbookReviewRegion("session_1", {
      sourceDocumentId: "source_doc_1",
      sheetName: "Runs",
      range: "A1:D3",
      selectionMethod: "drag_select",
      deferInterpretation: true,
      idempotencyKey: "create_region_1",
    }, { fetch: fetchImpl });
    await listServerWorkbookReviewRegionRevisions("session_1", "region_1", { fetch: fetchImpl });
    await reviseServerWorkbookReviewRegion("session_1", "region_1", {
      feedback: "Temperature and selectivity are separate fields.",
      previousRevisionId: "revision_1",
      expectedRegionVersion: 2,
      idempotencyKey: "revise_region_1",
    }, { fetch: fetchImpl });
    await confirmServerWorkbookReviewRegion("session_1", "region_1", {
      revisionId: "revision_2",
      expectedRegionVersion: 3,
      idempotencyKey: "confirm_region_1",
    }, { fetch: fetchImpl });
    await ignoreServerWorkbookReviewRegion("session_1", "region_1", {
      expectedRegionVersion: 4,
      reason: "Not experiment data.",
    }, { fetch: fetchImpl });
    await deleteServerWorkbookReviewRegion("session_1", "region_1", {
      expectedRegionVersion: 5,
      reason: "Duplicate selection.",
    }, { fetch: fetchImpl });
    await listServerRegionUnderstandings("project_1", { status: "accepted", fetch: fetchImpl });
    await interpretServerWorkbookReviewRegion("session_1", "region_1", {
      expectedRegionVersion: 1,
      semanticType: "experiment_table",
      idempotencyKey: "interpret_region_1",
    }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/workbook-review-sessions/session_1/regions");
    expect(fetchImpl.mock.calls[0][1].method).toBe("GET");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/workbook-review-sessions/session_1/regions");
    expect(fetchImpl.mock.calls[1][1].method).toBe("POST");
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/workbook-review-sessions/session_1/regions/region_1/revisions");
    expect(fetchImpl.mock.calls[2][1].method).toBe("GET");
    expect(fetchImpl.mock.calls[3][0]).toBe("/api/workbook-review-sessions/session_1/regions/region_1/revisions");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      sourceDocumentId: "source_doc_1",
      sheetName: "Runs",
      range: "A1:D3",
      selectionMethod: "drag_select",
      description: "",
      semanticType: "generic_table",
      idempotencyKey: "create_region_1",
      deferInterpretation: true,
    });
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toEqual({
      feedback: "Temperature and selectivity are separate fields.",
      previousRevisionId: "revision_1",
      expectedRegionVersion: 2,
      idempotencyKey: "revise_region_1",
    });
    expect(fetchImpl.mock.calls[4][0]).toBe("/api/workbook-review-sessions/session_1/regions/region_1/confirm");
    expect(fetchImpl.mock.calls[5][0]).toBe("/api/workbook-review-sessions/session_1/regions/region_1/ignore");
    expect(fetchImpl.mock.calls[6][1].method).toBe("DELETE");
    expect(fetchImpl.mock.calls[7][0]).toBe("/api/projects/project_1/region-understandings?status=accepted");
    expect(fetchImpl.mock.calls[8][0]).toBe("/api/workbook-review-sessions/session_1/regions/region_1/interpret");
    expect(JSON.parse(fetchImpl.mock.calls[8][1].body)).toEqual({
      expectedRegionVersion: 1,
      semanticType: "experiment_table",
      idempotencyKey: "interpret_region_1",
    });
  });

  it("routes workbook review session deletion with its reviewed version", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      workbookReviewSession: { id: "session_1", status: "deleted" },
      deletedRegionCount: 2,
    }));

    await deleteServerWorkbookReviewSession("session_1", {
      expectedVersion: 3,
      reason: "Remove this workbook from review.",
    }, { fetch: fetchImpl });

    const { url, options } = lastCall(fetchImpl);
    expect(url).toBe("/api/workbook-review-sessions/session_1");
    expect(options.method).toBe("DELETE");
    expect(JSON.parse(options.body)).toEqual({
      expectedVersion: 3,
      reason: "Remove this workbook from review.",
    });
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

  it("routes AgentRun operations", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ agentRun: { id: "agent_run_1", actions: [] } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ agentRun: { id: "agent_run_1", status: "completed" } }))
      .mockResolvedValueOnce(jsonResponse({ agentRun: { id: "agent_run_2", status: "cancelled" } }));

    await createServerAgentRun("project_1", {
      message: "compare reaction rate for Exp1 and Exp2",
      conversation: [{ role: "user", text: "hello" }],
      selectedContext: { tab: "overview" },
    }, { fetch: fetchImpl });
    await getServerAgentRun("agent_run_1", { fetch: fetchImpl });
    await cancelServerAgentRun("agent_run_2", { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/agent/runs");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      message: "compare reaction rate for Exp1 and Exp2",
      conversation: [{ role: "user", text: "hello" }],
      selectedContext: { tab: "overview" },
      modeHint: "auto",
    });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/agent-runs/agent_run_1");
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/agent-runs/agent_run_2/cancel");
  });

  it("routes read-only source document inspection helpers", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ sourceDocuments: [{ id: "source_doc_1" }] }))
      .mockResolvedValueOnce(jsonResponse({ regions: [] }))
      .mockResolvedValueOnce(jsonResponse({ schemaVersion: "labrat.sourceRange.v1", rows: [] }));

    await listServerSourceDocuments("project_1", { fetch: fetchImpl });
    await listServerSourceDocumentRegions("source_doc_1", { fetch: fetchImpl });
    await readServerSourceDocumentRange("source_doc_1", { sheetName: "Runs", range: "A1:B2" }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/source-documents");
    expect(fetchImpl.mock.calls[0][1].method).toBe("GET");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/source-documents/source_doc_1/regions");
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/source-documents/source_doc_1/range");
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ sheetName: "Runs", range: "A1:B2" });
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
