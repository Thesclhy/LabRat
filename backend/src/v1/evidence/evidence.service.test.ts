import { describe, expect, test, vi } from "vitest";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { EvidenceService } from "./evidence.service.js";

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
  const project = { id: "project_1", labId: "lab_1" };
  const repository = {
    listFileObjects: vi.fn(async () => []),
    findFileObjectByProjectChecksumName: vi.fn(async (): Promise<any> => null),
    createFileObject: vi.fn(),
    findSourceDocumentById: vi.fn(async (): Promise<any> => null),
    listSourceRegions: vi.fn(async () => []),
    listSourceIndexBlobs: vi.fn(async () => []),
    findWorkbookReviewSessionById: vi.fn(async (): Promise<any> => null),
    findWorkbookReviewRegionById: vi.fn(async (): Promise<any> => null),
  };
  const authorization = {
    requireFullProjectCapability: vi.fn(async () => ({ project, access: { allExperiments: true } })),
    resolveProjectAccess: vi.fn(async () => ({
      project,
      access: {
        allExperiments: true,
        capabilities: ["read", "propose", "approve"],
      },
    })),
  };
  const identityRepository = { recordAudit: vi.fn(async () => undefined) };
  const service = new EvidenceService(
    repository as never,
    authorization as never,
    identityRepository as never,
    { fileStorageRoot: "unused" } as never,
    {} as never,
  );
  return { authorization, identityRepository, project, repository, service };
}

describe("EvidenceService authorization and evidence boundaries", () => {
  test("rejects selected-experiment access before reading project-wide evidence", async () => {
    const testFixture = fixture();
    testFixture.authorization.requireFullProjectCapability.mockRejectedValueOnce(
      new ApiError(403, "forbidden", "Full project required."),
    );

    await expect(testFixture.service.listFiles(auth, "project_1"))
      .rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
    expect(testFixture.repository.listFileObjects).not.toHaveBeenCalled();
  });

  test("does not load SourceDocument index blobs when full-project read is denied", async () => {
    const testFixture = fixture();
    testFixture.repository.findSourceDocumentById.mockResolvedValueOnce({
      id: "source_1",
      labId: "lab_1",
      projectId: "project_1",
    });
    testFixture.authorization.resolveProjectAccess.mockResolvedValueOnce({
      project: testFixture.project,
      access: { allExperiments: false, capabilities: ["read", "propose"] },
    });

    await expect(testFixture.service.readSourceDocumentRange(auth, "source_1", {
      sheetName: "Sheet1",
      range: "A1:B2",
    })).rejects.toMatchObject({ statusCode: 404, code: "source_document_not_found" });
    expect(testFixture.repository.listSourceIndexBlobs).not.toHaveBeenCalled();
  });

  test("requires exactly one source when creating a workbook review session", async () => {
    const testFixture = fixture();

    await expect(testFixture.service.createWorkbookReviewSession(auth, "project_1", {}))
      .rejects.toMatchObject({ statusCode: 400, code: "invalid_workbook_review_session_request" });
    await expect(testFixture.service.createWorkbookReviewSession(auth, "project_1", {
      fileObjectId: "file_1",
      sourceDocumentId: "source_1",
    })).rejects.toMatchObject({ statusCode: 400, code: "invalid_workbook_review_session_request" });
    expect(testFixture.repository.findSourceDocumentById).not.toHaveBeenCalled();
  });

  test("requires approve, not propose, before accepting a RegionUnderstandingRevision", async () => {
    const testFixture = fixture();
    testFixture.repository.findWorkbookReviewSessionById.mockResolvedValueOnce({
      id: "review_1",
      projectId: "project_1",
      status: "needs_user_review",
    });
    testFixture.authorization.resolveProjectAccess.mockResolvedValueOnce({
      project: testFixture.project,
      access: { allExperiments: true, capabilities: ["read", "propose"] },
    });

    await expect(testFixture.service.confirmWorkbookReviewRegion(
      auth,
      "review_1",
      "region_1",
      { revisionId: "revision_1", expectedRegionVersion: 1 },
    )).rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
    expect(testFixture.authorization.resolveProjectAccess)
      .toHaveBeenCalledWith(auth, "project_1");
    expect(testFixture.repository.findWorkbookReviewRegionById).not.toHaveBeenCalled();
  });

  test("reuses an identical multipart upload without writing a second file object", async () => {
    const testFixture = fixture();
    testFixture.repository.findFileObjectByProjectChecksumName.mockResolvedValueOnce({
      id: "file_1",
      labId: "lab_1",
      projectId: "project_1",
      originalName: "evidence.csv",
      mimeType: "text/csv",
      extension: "csv",
      sizeBytes: 8,
      checksumSha256: "known",
      storageProvider: "local",
      storageKey: "project_1/file_1.csv",
      createdAt: "2026-08-23T00:00:00.000Z",
      createdBy: "user_1",
    });
    const boundary = "labrat-test-boundary";
    const body = Buffer.from([
      `--${boundary}`,
      "Content-Disposition: form-data; name=\"file\"; filename=\"evidence.csv\"",
      "Content-Type: text/csv",
      "",
      "a,b\\r\\n1,2",
      `--${boundary}--`,
      "",
    ].join("\r\n"));

    const result = await testFixture.service.uploadFile(
      auth,
      "project_1",
      `multipart/form-data; boundary=${boundary}`,
      body,
    );
    expect(result).toMatchObject({ reused: true, statusCode: 200, fileObject: { id: "file_1" } });
    expect(testFixture.repository.createFileObject).not.toHaveBeenCalled();
    expect(testFixture.identityRepository.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "file.reuse",
      targetId: "file_1",
    }));
  });
});
