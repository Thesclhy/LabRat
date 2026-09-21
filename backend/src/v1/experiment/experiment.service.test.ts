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
    listManualExperiments: vi.fn(async () => [] as Array<Record<string, unknown>>),
    findManualExperiment: vi.fn(async () => null as Record<string, unknown> | null),
    createManualExperiment: vi.fn(),
    updateManualExperiment: vi.fn(),
    deleteManualExperiment: vi.fn(async () => true),
    listManualValues: vi.fn(async () => [] as Array<Record<string, unknown>>),
    saveManualValue: vi.fn(),
    findCustomColumn: vi.fn(async () => ({ id: "column_1" })),
    saveCustomValue: vi.fn(async (input) => ({ id: "value_1", ...input })),
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
  test("detail requests linked evidence only with full-project access", async () => {
    const fixture = serviceFixture();
    await fixture.service.getExperiment(auth, "project_1", "experiment_1");
    expect(fixture.repository.loadProjectionState).toHaveBeenLastCalledWith("project_1", ["experiment_1"], false);
    fixture.authorization.requireExperimentCapability.mockResolvedValueOnce({
      project: { id: "project_1", labId: "lab_1" }, access: { ...selectedAccess(), allExperiments: true, shellOnly: false },
    });
    await fixture.service.getExperiment(auth, "project_1", "experiment_1");
    expect(fixture.repository.loadProjectionState).toHaveBeenLastCalledWith("project_1", ["experiment_1"], true);
  });

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
    expect(fixture.repository.listManualExperiments).toHaveBeenCalledWith("project_1", ["experiment_1"]);
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

describe("ExperimentService manually logged rows", () => {
  const manual = {
    id: "manual_1", projectId: "project_1", experimentId: "experiment_manual",
    schemaVersion: "labrat.manualExperiment.v1", label: "Pilot run", aliases: ["Pilot run"], note: "",
    version: 1, createdAt: "2026-09-20T10:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z",
    createdBy: "user_1", createdByName: "Member",
  };
  function editorFixture() {
    const fixture = serviceFixture();
    fixture.authorization.requireFullProjectCapability.mockImplementation(async () => ({
      project: { id: "project_1", labId: "lab_1" },
      access: { ...selectedAccess(), allExperiments: true, shellOnly: false },
    }) as never);
    return fixture;
  }

  test("requires full-project propose access to log a row", async () => {
    const fixture = serviceFixture();
    await expect(fixture.service.createManualExperiment(auth, "project_1", { label: "Pilot run" }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(fixture.repository.createManualExperiment).not.toHaveBeenCalled();
  });

  test("creates a row with a normalized label and shows it in the Browser without a snapshot", async () => {
    const fixture = editorFixture();
    fixture.repository.createManualExperiment.mockResolvedValue({ manual });
    fixture.repository.findManualExperiment.mockResolvedValue(manual);
    const created = await fixture.service.createManualExperiment(auth, "project_1", { label: "  Pilot run ", note: " first try " });
    expect(fixture.authorization.requireFullProjectCapability).toHaveBeenCalledWith(auth, "project_1", "propose");
    expect(fixture.repository.createManualExperiment).toHaveBeenCalledWith(expect.objectContaining({
      label: "Pilot run", normalizedLabel: "pilotrun", note: "first try", actorUserId: "user_1",
    }));
    expect(created).toMatchObject({ experimentId: "experiment_manual", label: "Pilot run", version: 1 });

    fixture.repository.listManualExperiments.mockResolvedValue([manual]);
    const browser = await fixture.service.getBrowser(auth, "project_1", {}) as { rows: Array<Record<string, unknown>> };
    expect(browser.rows.find((row) => row.experimentId === "experiment_manual"))
      .toMatchObject({ origin: "manual", dataSnapshotId: null, headId: null });
  });

  test("rejects unusable names and names that already identify an experiment", async () => {
    const fixture = editorFixture();
    await expect(fixture.service.createManualExperiment(auth, "project_1", { label: "—" }))
      .rejects.toMatchObject({ statusCode: 400, code: "invalid_experiment_label" });
    fixture.repository.createManualExperiment.mockResolvedValue({ conflict: true });
    await expect(fixture.service.createManualExperiment(auth, "project_1", { label: "Exp1" }))
      .rejects.toMatchObject({ statusCode: 409, code: "experiment_label_conflict" });
  });

  test("reports stale edits, and refuses to edit or delete accepted-data rows", async () => {
    const fixture = editorFixture();
    fixture.repository.findManualExperiment.mockResolvedValue(manual);
    fixture.repository.updateManualExperiment.mockResolvedValue({ stale: true });
    await expect(fixture.service.updateManualExperiment(auth, "project_1", "experiment_manual", { note: "x", expectedVersion: 1 }))
      .rejects.toMatchObject({ statusCode: 409, code: "manual_experiment_conflict" });

    fixture.repository.findManualExperiment.mockResolvedValue(null);
    await expect(fixture.service.deleteManualExperiment(auth, "project_1", "experiment_1"))
      .rejects.toMatchObject({ statusCode: 409, code: "experiment_not_manual" });
    await expect(fixture.service.updateManualExperiment(auth, "project_1", "experiment_1", { label: "Renamed", expectedVersion: 1 }))
      .rejects.toMatchObject({ statusCode: 409, code: "experiment_not_manual" });
    expect(fixture.repository.deleteManualExperiment).not.toHaveBeenCalled();

    fixture.repository.loadProjectionState.mockResolvedValue({ dataSnapshots: [], experimentIdentities: [], experimentSnapshotHeads: [] } as never);
    await expect(fixture.service.deleteManualExperiment(auth, "project_1", "experiment_missing"))
      .rejects.toMatchObject({ statusCode: 404, code: "experiment_not_found" });
  });

  test("accepts documentation values on a manually logged row", async () => {
    const fixture = editorFixture();
    fixture.repository.loadProjectionState.mockResolvedValue({ dataSnapshots: [], experimentIdentities: [], experimentSnapshotHeads: [] } as never);
    fixture.repository.findManualExperiment.mockResolvedValue(manual);
    const value = await fixture.service.saveCustomValue(auth, "project_1", "column_1", "experiment_manual", { value: "Plan repeat" });
    expect(value).toMatchObject({ experimentId: "experiment_manual", value: "Plan repeat" });
  });
  test("types values only into accepted-data columns of a manual row", async () => {
    const fixture = editorFixture();
    const state = projectionState();
    (state.dataSnapshots[0]!.experimentRecords[0] as Record<string, unknown>).fields = [{
      fieldKey: "temperature", displayName: "Temperature", role: "condition", value: 250, formattedValue: "250",
      valueType: "number", unit: "degC", confidence: 0.9, warnings: [], sourceRefs: [],
    }];
    fixture.repository.loadProjectionState.mockResolvedValue(state as never);
    fixture.repository.findManualExperiment.mockResolvedValue(manual);
    fixture.repository.saveManualValue.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "manual_value_1", schemaVersion: "labrat.manualExperimentValue.v1", version: 1, updatedAt: "2026-09-21T10:00:00.000Z", ...input,
    }));
    const columnId = "field:temperature:degC:number";
    const saved = await fixture.service.saveManualValue(auth, "project_1", "experiment_manual", { columnId, value: "275" });
    expect(saved).toMatchObject({ experimentId: "experiment_manual", columnId, value: "275", version: 1 });
    expect(fixture.repository.saveManualValue).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 0, actorUserId: "user_1" }));

    for (const badColumn of ["experiment", "field:unknown", "custom:column_1"]) {
      await expect(fixture.service.saveManualValue(auth, "project_1", "experiment_manual", { columnId: badColumn, value: "x" }))
        .rejects.toMatchObject({ statusCode: 404, code: "experiment_column_not_found" });
    }
    fixture.repository.saveManualValue.mockResolvedValue(undefined);
    await expect(fixture.service.saveManualValue(auth, "project_1", "experiment_manual", { columnId, value: "280", expectedVersion: 4 }))
      .rejects.toMatchObject({ statusCode: 409, code: "manual_experiment_value_conflict" });

    fixture.repository.findManualExperiment.mockResolvedValue(null);
    await expect(fixture.service.saveManualValue(auth, "project_1", "experiment_1", { columnId, value: "1" }))
      .rejects.toMatchObject({ statusCode: 409, code: "experiment_not_manual" });
  });
});
