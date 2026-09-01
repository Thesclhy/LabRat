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
});
