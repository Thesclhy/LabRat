import { describe, expect, test, vi } from "vitest";
import { WorkspaceService } from "./workspace.service.js";

describe("WorkspaceService", () => {
  test("archives a project without trying to resolve access after it leaves the active index", async () => {
    const project = {
      id: "project_1",
      labId: "lab_1",
      name: "Catalyst screening",
      description: "",
      status: "active",
      metadata: {},
      createdAt: "2026-08-23T12:00:00.000Z",
      updatedAt: "2026-08-23T12:00:00.000Z",
      createdBy: "user_1",
      updatedBy: "user_1",
    };
    const access = {
      shellOnly: false,
      allExperiments: true,
      experimentIds: [],
      capabilities: ["read", "propose"],
    };
    const repository = {
      updateProject: vi.fn().mockResolvedValue({ ...project, status: "archived" }),
      projectWorkflowSummary: vi.fn().mockResolvedValue({
        publishedExperimentCount: 0,
        chartSpecCount: 0,
        chartStyleProfileCount: 0,
        reusableChartTemplateCount: 0,
      }),
    };
    const authorization = {
      requireFullProjectCapability: vi.fn().mockResolvedValue({ project, access }),
      resolveProjectAccess: vi.fn(),
    };
    const identity = { recordAudit: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkspaceService(repository as any, authorization as any, identity as any);

    const result = await service.updateProject({ user: { id: "user_1" } } as any, project.id, {
      status: "archived",
    });

    expect(result).toMatchObject({ id: project.id, status: "archived" });
    expect(repository.updateProject).toHaveBeenCalledWith(project.id, expect.objectContaining({
      status: "archived",
      actorUserId: "user_1",
    }));
    expect(authorization.resolveProjectAccess).not.toHaveBeenCalled();
    expect(identity.recordAudit).toHaveBeenCalledOnce();
  });

  test("returns workflow counts only for a full-project view", async () => {
    const project = {
      id: "project_1",
      labId: "lab_1",
      name: "Catalyst screening",
      description: "",
      status: "active",
      metadata: {},
    };
    const summary = {
      publishedExperimentCount: 3,
      chartSpecCount: 2,
      chartStyleProfileCount: 1,
      reusableChartTemplateCount: 1,
    };
    const repository = {
      projectWorkflowSummary: vi.fn().mockResolvedValue(summary),
    };
    const authorization = {
      requireProjectCapability: vi.fn()
        .mockResolvedValueOnce({
          project,
          access: { shellOnly: false, allExperiments: true, capabilities: ["read"] },
        })
        .mockResolvedValueOnce({
          project,
          access: { shellOnly: true, allExperiments: false, capabilities: ["read"] },
        }),
    };
    const service = new WorkspaceService(repository as any, authorization as any, {} as any);

    await expect(service.getProject({} as any, project.id))
      .resolves.toMatchObject({ workflowSummary: summary });
    const shell = await service.getProject({} as any, project.id);
    expect(shell).not.toHaveProperty("workflowSummary");
    expect(repository.projectWorkflowSummary).toHaveBeenCalledOnce();
  });
});
