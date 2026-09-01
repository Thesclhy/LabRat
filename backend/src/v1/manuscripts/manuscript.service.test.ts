import { describe, expect, test, vi } from "vitest";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { ManuscriptService } from "./manuscript.service.js";

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

function manuscript() {
  return {
    id: "manuscript_1",
    labId: "lab_1",
    projectId: "project_1",
    title: "Draft",
    status: "draft",
    blocks: [{ id: "block_1", kind: "text", text: "Hello" }],
    pages: [],
    canvasState: { canvasHeight: 900 },
    references: [],
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    createdBy: "user_1",
    updatedBy: "user_1",
  };
}

function fixture() {
  const repository = {
    list: vi.fn(async () => [manuscript()]),
    findById: vi.fn(async (): Promise<any> => manuscript()),
    create: vi.fn(async (input: Record<string, any>) => ({ ...manuscript(), ...input, id: "manuscript_1" })),
    update: vi.fn(async (_id: string, input: Record<string, any>) => ({ ...manuscript(), ...input })),
  };
  const authorization = {
    requireFullProjectCapability: vi.fn(async () => ({
      project: { id: "project_1", labId: "lab_1" },
      access: { allExperiments: true, capabilities: ["read", "propose"] },
    })),
    resolveProjectAccess: vi.fn(async () => ({
      project: { id: "project_1", labId: "lab_1" },
      access: { allExperiments: true, capabilities: ["read", "propose"] },
    })),
  };
  const identityRepository = { recordAudit: vi.fn(async () => undefined) };
  return {
    authorization,
    identityRepository,
    repository,
    service: new ManuscriptService(repository as never, authorization as never, identityRepository as never),
  };
}

describe("ManuscriptService artifact boundaries", () => {
  test("requires full-project access before listing manuscripts", async () => {
    const testFixture = fixture();
    testFixture.authorization.requireFullProjectCapability.mockRejectedValueOnce(
      new ApiError(403, "forbidden", "Full project required."),
    );
    await expect(testFixture.service.list(auth, "project_1", {}))
      .rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
    expect(testFixture.repository.list).not.toHaveBeenCalled();
  });

  test("creates a bounded draft and records its audit event", async () => {
    const testFixture = fixture();
    const result = await testFixture.service.create(auth, "project_1", {
      blocks: [{ id: "block_1", kind: "text" }],
    });
    expect(result).toMatchObject({ id: "manuscript_1", title: "Untitled manuscript", status: "draft" });
    expect(testFixture.repository.create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1",
      title: "Untitled manuscript",
      actorUserId: "user_1",
    }));
    expect(testFixture.identityRepository.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "manuscript.create",
      targetId: "manuscript_1",
    }));
  });

  test("updates only supplied manuscript fields and audits the write", async () => {
    const testFixture = fixture();
    const result = await testFixture.service.update(auth, "manuscript_1", { title: " Updated " });
    expect(result.title).toBe("Updated");
    expect(testFixture.repository.update).toHaveBeenCalledWith("manuscript_1", {
      title: "Updated",
      actorUserId: "user_1",
    });
    expect(testFixture.identityRepository.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "manuscript.update",
    }));
  });

  test("rejects empty updates before writing", async () => {
    const testFixture = fixture();
    await expect(testFixture.service.update(auth, "manuscript_1", {}))
      .rejects.toMatchObject({ statusCode: 400, code: "manuscript_update_required" });
    expect(testFixture.repository.update).not.toHaveBeenCalled();
  });

  test("conceals direct manuscript ids from selected-experiment shells", async () => {
    const testFixture = fixture();
    testFixture.authorization.resolveProjectAccess.mockResolvedValueOnce({
      project: { id: "project_1", labId: "lab_1" },
      access: { allExperiments: false, capabilities: ["read", "propose"] },
    } as never);
    await expect(testFixture.service.update(auth, "manuscript_1", { title: "Hidden" }))
      .rejects.toMatchObject({ statusCode: 404, code: "manuscript_not_found" });
    expect(testFixture.repository.update).not.toHaveBeenCalled();
  });
});
