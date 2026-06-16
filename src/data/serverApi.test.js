import { describe, expect, it, vi } from "vitest";
import {
  ServerApiError,
  applyServerImportRun,
  createServerChartSpecFromProposal,
  createServerImportRun,
  createServerManuscript,
  createServerProject,
  createServerMappingSet,
  getServerProjectState,
  getServerSession,
  interpretServerProjectChart,
  listServerProjects,
  loginToServer,
  patchServerChartProposalSet,
  patchServerManuscript,
  patchServerMappingSet,
  patchServerProjectProfile,
  previewServerImportRefresh,
  previewServerImportRunNormalization,
  proposeServerProjectCharts,
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
      .mockResolvedValueOnce(jsonResponse({ projectProfile: { researchGoal: "Goal" } }));

    await createServerProject({ labId: "lab_1", name: "Project A", projectProfile: { researchGoal: "Goal" }, fetch: fetchImpl });
    await patchServerProjectProfile("project_1", { materials: "Ru/TiO2" }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      labId: "lab_1",
      name: "Project A",
      description: "",
      projectProfile: { researchGoal: "Goal" },
    });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/projects/project_1/profile");
    expect(fetchImpl.mock.calls[1][1].method).toBe("PATCH");
  });

  it("loads project state and routes import run operations", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ project: { id: "project_1" }, currentDatasetCommit: null }))
      .mockResolvedValueOnce(jsonResponse({ fileObject: { id: "file_1" } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ importRun: { id: "import_run_1" } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ importRun: { normalizePreview: {} } }))
      .mockResolvedValueOnce(jsonResponse({ schemaVersion: "labrat.importRefreshPreview.v1", hasChanges: true }))
      .mockResolvedValueOnce(jsonResponse({ datasetCommit: { id: "commit_1" } }));

    await getServerProjectState("project_1", { fetch: fetchImpl });
    await uploadServerProjectFile("project_1", new File(["x"], "runs.xlsx"), { fetch: fetchImpl });
    await createServerImportRun("project_1", "file_1", { fetch: fetchImpl });
    await previewServerImportRunNormalization("import_run_1", { approvedBlockIds: ["block_1"] }, { fetch: fetchImpl });
    await previewServerImportRefresh("import_run_1", { replaceImportId: "import_old", expectedParentDatasetCommitId: "commit_parent" }, { fetch: fetchImpl });
    await applyServerImportRun("import_run_1", { reviewNote: "Approved" }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/state");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/projects/project_1/files");
    expect(fetchImpl.mock.calls[1][1].body).toBeInstanceOf(FormData);
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/projects/project_1/import-runs");
    expect(fetchImpl.mock.calls[3][0]).toBe("/api/import-runs/import_run_1/normalize-preview");
    expect(fetchImpl.mock.calls[4][0]).toBe("/api/import-runs/import_run_1/refresh-preview");
    expect(JSON.parse(fetchImpl.mock.calls[4][1].body)).toEqual({
      replaceImportId: "import_old",
      expectedParentDatasetCommitId: "commit_parent",
    });
    expect(fetchImpl.mock.calls[5][0]).toBe("/api/import-runs/import_run_1/apply");
    expect(JSON.parse(fetchImpl.mock.calls[5][1].body)).toEqual({
      applyMode: "append",
      reviewNote: "Approved",
    });
  });

  it("applies a server import run as a replace refresh", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ datasetCommit: { id: "commit_2" } }));

    await applyServerImportRun("import_run_1", {
      applyMode: "replace_import",
      replaceImportId: "import_old",
      expectedParentDatasetCommitId: "commit_parent",
      reviewNote: "Applied workbook refresh.",
    }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/import-runs/import_run_1/apply");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      applyMode: "replace_import",
      replaceImportId: "import_old",
      expectedParentDatasetCommitId: "commit_parent",
      reviewNote: "Applied workbook refresh.",
    });
  });

  it("routes mapping and chart proposal persistence", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mappingSet: { id: "mapping_set_1" } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ mappingSet: { id: "mapping_set_1", status: "accepted" } }))
      .mockResolvedValueOnce(jsonResponse({ proposalSet: { proposals: [] } }))
      .mockResolvedValueOnce(jsonResponse({ chartSpecDraft: { title: "Draft" }, chartProposalSet: { id: "chart_set_1" } }))
      .mockResolvedValueOnce(jsonResponse({ chartProposalSet: { id: "chart_set_1", status: "accepted" } }))
      .mockResolvedValueOnce(jsonResponse({ chartSpec: { id: "chart_spec_1" } }, { status: 201 }));

    await createServerMappingSet("project_1", { datasetCommitId: "commit_1", payload: {} }, { fetch: fetchImpl });
    await patchServerMappingSet("mapping_set_1", { status: "accepted" }, { fetch: fetchImpl });
    await proposeServerProjectCharts("project_1", { userGoal: "screen selectivity" }, { fetch: fetchImpl });
    await interpretServerProjectChart("project_1", { prompt: "plot conversion vs time" }, { fetch: fetchImpl });
    await patchServerChartProposalSet("chart_set_1", { status: "accepted" }, { fetch: fetchImpl });
    await createServerChartSpecFromProposal("project_1", { chartProposalSetId: "chart_set_1", proposalId: "chart_1" }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project_1/mapping-sets",
      "/api/mapping-sets/mapping_set_1",
      "/api/projects/project_1/charts/propose",
      "/api/projects/project_1/charts/interpret",
      "/api/chart-proposal-sets/chart_set_1",
      "/api/projects/project_1/chart-specs/from-proposal",
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body).persistAsProposal).toBe(true);
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
