import { makeId, sha256Hex } from "./ids.js";
import { hashPassword } from "./passwords.js";

const DEV_LAB_NAME = "Hanqi Test Lab";
const DEV_LAB_SLUG = "hanqi-test-lab";

function nowIso() {
  return new Date().toISOString();
}

function copy(value) {
  if (value == null) return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(copy);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  }
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export class MemorySaasStore {
  constructor(options = {}) {
    this.users = new Map();
    this.labs = new Map();
    this.memberships = new Map();
    this.sessions = new Map();
    this.projects = new Map();
    this.fileObjects = new Map();
    this.importRuns = new Map();
    this.sourceDocuments = new Map();
    this.sourceRegions = new Map();
    this.sourceIndexBlobs = new Map();
    this.workbookReviewSessions = new Map();
    this.workbookReviewRegions = new Map();
    this.regionUnderstandingRevisions = new Map();
    this.dataPlans = new Map();
    this.dataSnapshots = new Map();
    this.experimentIdentities = new Map();
    this.experimentSnapshotHeads = new Map();
    this.experimentSnapshotPublishes = new Map();
    this.browserViews = new Map();
    this.projectBrowserConfigs = new Map();
    this.experimentAnnotations = new Map();
    this.experimentCustomColumns = new Map();
    this.experimentCustomValues = new Map();
    this.agentRuns = new Map();
    this.analysisThreads = new Map();
    this.analysisThreadRetryReceipts = new Map();
    this.analysisPlanRevisions = new Map();
    this.analysisRuns = new Map();
    this.analysisResults = new Map();
    this.analysisPublications = new Map();
    this.analysisExperimentPublications = new Map();
    this.chartSpecs = new Map();
    this.manuscripts = new Map();
    this.auditEvents = new Map();
    if (options.seedDevAccounts) this.seedDevAccounts();
  }

  seedDevAccounts() {
    if (this.users.size) return;
    const createdAt = nowIso();
    const lab = {
      id: "lab_hanqi_test",
      name: DEV_LAB_NAME,
      slug: DEV_LAB_SLUG,
      status: "active",
      settings: {},
      createdAt,
      updatedAt: createdAt,
      createdBy: null,
    };
    const admin = {
      id: "user_admin",
      username: "admin",
      displayName: "LabRat Super Admin",
      passwordHash: hashPassword("LabRatAdmin123!"),
      isActive: true,
      isSuperAdmin: true,
      createdAt,
      updatedAt: createdAt,
      createdBy: null,
    };
    const labUser = {
      id: "user_labuser",
      username: "labuser",
      displayName: "Hanqi Test Lab Owner",
      passwordHash: hashPassword("LabRatLab123!"),
      isActive: true,
      isSuperAdmin: false,
      createdAt,
      updatedAt: createdAt,
      createdBy: admin.id,
    };
    const membership = {
      id: "membership_hanqi_owner",
      labId: lab.id,
      userId: labUser.id,
      role: "lab_owner",
      status: "active",
      createdAt,
      updatedAt: createdAt,
      createdBy: admin.id,
    };
    this.labs.set(lab.id, lab);
    this.users.set(admin.id, admin);
    this.users.set(labUser.id, labUser);
    this.memberships.set(membership.id, membership);
  }

  async findUserByUsername(username) {
    const user = [...this.users.values()].find((candidate) => candidate.username === username);
    return copy(user || null);
  }

  async findUserById(userId) {
    return copy(this.users.get(userId) || null);
  }

  async createSession({ userId, tokenHash, expiresAt, ipAddress, userAgent }) {
    const session = {
      id: makeId("session"),
      userId,
      sessionTokenHash: tokenHash,
      expiresAt,
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      revokedAt: null,
    };
    this.sessions.set(session.id, session);
    return copy(session);
  }

  async findSessionByTokenHash(tokenHash) {
    const session = [...this.sessions.values()].find((candidate) => candidate.sessionTokenHash === tokenHash);
    if (!session || session.revokedAt) return null;
    session.lastSeenAt = nowIso();
    return copy(session);
  }

  async revokeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) session.revokedAt = nowIso();
  }

  async listLabsForUser(userId) {
    const user = this.users.get(userId);
    if (!user) return [];
    if (user.isSuperAdmin) {
      return [...this.labs.values()].map((lab) => ({
        labId: lab.id,
        name: lab.name,
        slug: lab.slug,
        role: "super_admin",
      }));
    }
    return [...this.memberships.values()]
      .filter((membership) => membership.userId === userId && membership.status === "active")
      .map((membership) => {
        const lab = this.labs.get(membership.labId);
        return lab ? {
          labId: lab.id,
          name: lab.name,
          slug: lab.slug,
          role: membership.role,
        } : null;
      })
      .filter(Boolean);
  }

  async listLabs() {
    return [...this.labs.values()].map(copy);
  }

  async createLab({ name, slug, createdBy }) {
    const existing = [...this.labs.values()].find((lab) => lab.slug === slug);
    if (existing) {
      throw Object.assign(new Error("Lab slug already exists."), { statusCode: 409, code: "duplicate_lab_slug" });
    }
    const createdAt = nowIso();
    const lab = {
      id: makeId("lab"),
      name,
      slug,
      status: "active",
      settings: {},
      createdAt,
      updatedAt: createdAt,
      createdBy,
    };
    this.labs.set(lab.id, lab);
    return copy(lab);
  }

  async listUsers(filter = {}) {
    const users = [...this.users.values()];
    return users
      .map((user) => ({
        ...copy(user),
        memberships: [...this.memberships.values()]
          .filter((membership) => membership.userId === user.id && (!filter.labId || membership.labId === filter.labId))
          .map(copy),
      }))
      .filter((user) => !filter.labId || user.memberships.length || user.isSuperAdmin);
  }

  async createUser({ username, displayName, temporaryPassword, isSuperAdmin = false, labId = null, role = null, createdBy = null }) {
    if ([...this.users.values()].some((user) => user.username === username)) {
      throw Object.assign(new Error("Username already exists."), { statusCode: 409, code: "duplicate_username" });
    }
    const createdAt = nowIso();
    const user = {
      id: makeId("user"),
      username,
      displayName,
      passwordHash: hashPassword(temporaryPassword),
      isActive: true,
      isSuperAdmin: Boolean(isSuperAdmin),
      createdAt,
      updatedAt: createdAt,
      createdBy,
    };
    this.users.set(user.id, user);
    let membership = null;
    if (labId && role) {
      membership = {
        id: makeId("membership"),
        labId,
        userId: user.id,
        role,
        status: "active",
        createdAt,
        updatedAt: createdAt,
        createdBy,
      };
      this.memberships.set(membership.id, membership);
    }
    return { user: copy(user), membership: copy(membership) };
  }

  async updateUser(userId, changes) {
    const user = this.users.get(userId);
    if (!user) return null;
    if (changes.displayName != null) user.displayName = String(changes.displayName);
    if (changes.isActive != null) user.isActive = Boolean(changes.isActive);
    if (changes.isSuperAdmin != null) user.isSuperAdmin = Boolean(changes.isSuperAdmin);
    if (Array.isArray(changes.memberships)) {
      changes.memberships.forEach((entry) => {
        const existing = [...this.memberships.values()].find((membership) => membership.userId === userId && membership.labId === entry.labId);
        if (existing) {
          existing.role = entry.role || existing.role;
          existing.status = entry.status || existing.status;
          existing.updatedAt = nowIso();
        } else if (entry.labId && entry.role) {
          const membership = {
            id: makeId("membership"),
            labId: entry.labId,
            userId,
            role: entry.role,
            status: entry.status || "active",
            createdAt: nowIso(),
            updatedAt: nowIso(),
            createdBy: changes.updatedBy || null,
          };
          this.memberships.set(membership.id, membership);
        }
      });
    }
    user.updatedAt = nowIso();
    return copy(user);
  }

  async resetPassword(userId, temporaryPassword) {
    const user = this.users.get(userId);
    if (!user) return null;
    user.passwordHash = hashPassword(temporaryPassword);
    user.updatedAt = nowIso();
    return copy(user);
  }

  async listProjects({ labId }) {
    return [...this.projects.values()].filter((project) => project.labId === labId).map(copy);
  }

  async createProject({ labId, name, description = "", metadata = {}, createdBy }) {
    const createdAt = nowIso();
    const project = {
      id: makeId("project"),
      labId,
      name,
      description,
      status: "active",
      metadata: copy(metadata) || {},
      createdAt,
      updatedAt: createdAt,
      createdBy,
      updatedBy: createdBy,
    };
    this.projects.set(project.id, project);
    return copy(project);
  }

  async findProjectById(projectId) {
    return copy(this.projects.get(projectId) || null);
  }

  async updateProject(projectId, changes) {
    const project = this.projects.get(projectId);
    if (!project) return null;
    if (changes.name != null) project.name = String(changes.name);
    if (changes.description != null) project.description = String(changes.description);
    if (changes.status != null) project.status = String(changes.status);
    if (changes.metadata != null) project.metadata = copy(changes.metadata) || {};
    project.updatedAt = nowIso();
    project.updatedBy = changes.updatedBy || project.updatedBy;
    return copy(project);
  }

  async createFileObject(input) {
    const createdAt = nowIso();
    const file = {
      id: input.id || makeId("file"),
      labId: input.labId,
      projectId: input.projectId,
      originalName: input.originalName,
      mimeType: input.mimeType || null,
      extension: input.extension || null,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      storageProvider: input.storageProvider || "memory",
      storageKey: input.storageKey || null,
      metadata: input.metadata || {},
      buffer: Buffer.isBuffer(input.buffer) ? Buffer.from(input.buffer) : null,
      createdAt,
      createdBy: input.createdBy,
    };
    this.fileObjects.set(file.id, file);
    return copy(file);
  }

  async findFileObjectById(fileObjectId) {
    return copy(this.fileObjects.get(fileObjectId) || null);
  }

  async findFileObjectByProjectChecksumName({ projectId, checksumSha256, originalName }) {
    const file = [...this.fileObjects.values()].find((candidate) => (
      candidate.projectId === projectId
      && candidate.checksumSha256 === checksumSha256
      && candidate.originalName === originalName
    ));
    return copy(file || null);
  }

  async listFileObjects({ projectId }) {
    return [...this.fileObjects.values()]
      .filter((file) => file.projectId === projectId)
      .map(copy);
  }

  async createImportRun(input) {
    const createdAt = nowIso();
    const run = {
      id: makeId("import_run"),
      labId: input.labId,
      projectId: input.projectId,
      fileObjectId: input.fileObjectId || null,
      status: input.status || "uploaded",
      scanResult: input.scanResult || null,
      normalizePreview: null,
      reviewDecisions: {},
      warnings: input.warnings || [],
      error: null,
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.importRuns.set(run.id, run);
    return copy(run);
  }

  async findImportRunById(importRunId) {
    return copy(this.importRuns.get(importRunId) || null);
  }

  async listImportRuns({ projectId }) {
    return [...this.importRuns.values()]
      .filter((run) => run.projectId === projectId)
      .map(copy);
  }

  async updateImportRun(importRunId, changes) {
    const run = this.importRuns.get(importRunId);
    if (!run) return null;
    Object.assign(run, copy(changes), { updatedAt: nowIso() });
    return copy(run);
  }

  async replaceSourceDocumentIndex(input) {
    const createdAt = nowIso();
    const existing = [...this.sourceDocuments.values()].find((document) => (
      document.projectId === input.projectId && document.fileObjectId === input.fileObjectId
    ));
    const id = existing?.id || input.id || makeId("source_doc");
    if (existing) {
      for (const [regionId, region] of this.sourceRegions.entries()) {
        if (region.sourceDocumentId === id) this.sourceRegions.delete(regionId);
      }
      for (const [blobId, blob] of this.sourceIndexBlobs.entries()) {
        if (blob.sourceDocumentId === id) this.sourceIndexBlobs.delete(blobId);
      }
    }
    const document = {
      id,
      labId: input.labId,
      projectId: input.projectId,
      fileObjectId: input.fileObjectId || null,
      importRunId: input.importRunId || null,
      documentType: input.documentType || "excel_workbook",
      indexVersion: input.indexVersion || "labrat.sourceIndex.v1",
      status: input.status || "indexed",
      metadata: copy(input.metadata) || {},
      summary: copy(input.summary) || {},
      warnings: copy(input.warnings) || [],
      createdAt: existing?.createdAt || createdAt,
      updatedAt: createdAt,
      createdBy: existing?.createdBy || input.createdBy || null,
      updatedBy: input.updatedBy || input.createdBy || null,
    };
    this.sourceDocuments.set(id, document);
    for (const regionInput of input.regions || []) {
      const region = {
        id: regionInput.id || makeId("source_region"),
        labId: input.labId,
        projectId: input.projectId,
        sourceDocumentId: id,
        importRunId: input.importRunId || null,
        regionKey: regionInput.regionKey || null,
        kind: regionInput.kind || "unknown_region",
        label: regionInput.label || "",
        sheetName: regionInput.sheetName || null,
        rangeRef: regionInput.rangeRef || null,
        startRow: regionInput.startRow ?? null,
        endRow: regionInput.endRow ?? null,
        startCol: regionInput.startCol ?? null,
        endCol: regionInput.endCol ?? null,
        confidence: regionInput.confidence ?? null,
        signals: copy(regionInput.signals) || {},
        candidateFields: copy(regionInput.candidateFields) || [],
        sourceRefs: copy(regionInput.sourceRefs) || [],
        warnings: copy(regionInput.warnings) || [],
        status: regionInput.status || "active",
        createdAt,
        updatedAt: createdAt,
        createdBy: input.updatedBy || input.createdBy || null,
        updatedBy: input.updatedBy || input.createdBy || null,
      };
      this.sourceRegions.set(region.id, region);
    }
    for (const blobInput of input.indexBlobs || []) {
      const blob = {
        id: blobInput.id || makeId("source_index_blob"),
        labId: input.labId,
        projectId: input.projectId,
        sourceDocumentId: id,
        blobKind: blobInput.blobKind || "excel_cell_grid_v1",
        storageProvider: blobInput.storageProvider || "memory",
        storageKey: blobInput.storageKey || null,
        payload: copy(blobInput.payload) || {},
        checksumSha256: blobInput.checksumSha256 || null,
        createdAt,
        createdBy: input.updatedBy || input.createdBy || null,
      };
      this.sourceIndexBlobs.set(blob.id, blob);
    }
    return copy(document);
  }

  async findSourceDocumentById(id) {
    return copy(this.sourceDocuments.get(id) || null);
  }

  async listSourceDocuments({ projectId }) {
    return [...this.sourceDocuments.values()]
      .filter((document) => document.projectId === projectId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(copy);
  }

  async listSourceRegions({ sourceDocumentId }) {
    return [...this.sourceRegions.values()]
      .filter((region) => region.sourceDocumentId === sourceDocumentId)
      .sort((a, b) => String(a.sheetName).localeCompare(String(b.sheetName)) || (a.startRow ?? 0) - (b.startRow ?? 0))
      .map(copy);
  }

  async findSourceRegionById(id) {
    return copy(this.sourceRegions.get(id) || null);
  }

  async listSourceIndexBlobs({ sourceDocumentId }) {
    return [...this.sourceIndexBlobs.values()]
      .filter((blob) => blob.sourceDocumentId === sourceDocumentId)
      .map(copy);
  }

  async createWorkbookReviewSession(input) {
    const createdAt = nowIso();
    const session = {
      id: input.id || makeId("workbook_review_session"),
      labId: input.labId,
      projectId: input.projectId,
      sourceDocumentId: input.sourceDocumentId,
      schemaVersion: input.schemaVersion || "labrat.workbookReviewSession.v1",
      status: input.status || "needs_user_review",
      version: input.version || 1,
      workbookSummary: copy(input.workbookSummary) || {},
      messages: copy(input.messages) || [],
      warnings: copy(input.warnings) || [],
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.workbookReviewSessions.set(session.id, session);
    return copy(session);
  }

  async findWorkbookReviewSessionById(id) {
    return copy(this.workbookReviewSessions.get(id) || null);
  }

  async updateWorkbookReviewSession(id, patch = {}) {
    const existing = this.workbookReviewSessions.get(id);
    if (!existing) return null;
    const updatedAt = nowIso();
    const next = {
      ...existing,
      status: patch.status ?? existing.status,
      version: patch.version ?? existing.version,
      workbookSummary: patch.workbookSummary === undefined ? existing.workbookSummary : copy(patch.workbookSummary),
      messages: patch.messages === undefined ? existing.messages : copy(patch.messages),
      warnings: patch.warnings === undefined ? existing.warnings : copy(patch.warnings),
      id: existing.id,
      labId: existing.labId,
      projectId: existing.projectId,
      sourceDocumentId: existing.sourceDocumentId,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt,
      updatedBy: patch.updatedBy || existing.updatedBy,
    };
    this.workbookReviewSessions.set(id, next);
    return copy(next);
  }

  async deleteWorkbookReviewSession(id, {
    expectedVersion,
    reason = "",
    actorUserId = null,
  } = {}) {
    const existing = this.workbookReviewSessions.get(id);
    if (!existing) return null;
    if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) !== Number(existing.version)) {
      throw Object.assign(new Error("Workbook review session changed; reload before deleting it."), {
        statusCode: 409,
        code: "workbook_review_session_version_conflict",
        details: {
          expectedVersion: Number.isInteger(Number(expectedVersion)) ? Number(expectedVersion) : null,
          currentVersion: Number(existing.version) || 1,
        },
      });
    }
    const deletedAt = nowIso();
    const deletedSession = {
      ...existing,
      status: "deleted",
      version: (Number(existing.version) || 1) + 1,
      updatedAt: deletedAt,
      updatedBy: actorUserId || existing.updatedBy,
    };
    this.workbookReviewSessions.set(id, deletedSession);

    let deletedRegionCount = 0;
    for (const [regionId, region] of this.workbookReviewRegions.entries()) {
      if (region.workbookReviewSessionId !== id || region.disposition !== "active") continue;
      this.workbookReviewRegions.set(regionId, {
        ...region,
        disposition: "deleted",
        deletedAt,
        deletedBy: actorUserId,
        deletedReason: String(reason || "").trim(),
        version: (Number(region.version) || 1) + 1,
        updatedAt: deletedAt,
        updatedBy: actorUserId || region.updatedBy,
      });
      deletedRegionCount += 1;
    }
    return { workbookReviewSession: copy(deletedSession), deletedRegionCount };
  }

  async listWorkbookReviewSessions({ projectId, includeDeleted = false }) {
    return [...this.workbookReviewSessions.values()]
      .filter((session) => session.projectId === projectId)
      .filter((session) => includeDeleted || session.status !== "deleted")
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(copy);
  }

  async createWorkbookReviewRegion(input) {
    const createdAt = nowIso();
    const region = {
      id: input.id || makeId("workbook_review_region"),
      labId: input.labId,
      projectId: input.projectId,
      workbookReviewSessionId: input.workbookReviewSessionId,
      sourceDocumentId: input.sourceDocumentId,
      sourceRegionId: input.sourceRegionId || null,
      sheetName: input.sheetName,
      rangeRef: input.rangeRef,
      selectionMethod: input.selectionMethod || "manual",
      interpretationHint: copy(input.interpretationHint) || {},
      disposition: input.disposition || "active",
      reviewStatus: input.reviewStatus || "interpreting",
      currentRevisionId: input.currentRevisionId || null,
      acceptedRevisionId: input.acceptedRevisionId || null,
      version: Number(input.version) || 1,
      warnings: copy(input.warnings) || [],
      acceptedAt: input.acceptedAt || null,
      acceptedBy: input.acceptedBy || null,
      ignoredAt: input.ignoredAt || null,
      ignoredBy: input.ignoredBy || null,
      ignoredReason: input.ignoredReason || "",
      deletedAt: input.deletedAt || null,
      deletedBy: input.deletedBy || null,
      deletedReason: input.deletedReason || "",
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy || null,
      updatedBy: input.createdBy || null,
    };
    this.workbookReviewRegions.set(region.id, region);
    return copy(region);
  }

  async findWorkbookReviewRegionById(id) {
    return copy(this.workbookReviewRegions.get(id) || null);
  }

  async listWorkbookReviewRegions({ projectId, workbookReviewSessionId, sourceDocumentId, includeDeleted = false } = {}) {
    return [...this.workbookReviewRegions.values()]
      .filter((region) => !projectId || region.projectId === projectId)
      .filter((region) => !workbookReviewSessionId || region.workbookReviewSessionId === workbookReviewSessionId)
      .filter((region) => !sourceDocumentId || region.sourceDocumentId === sourceDocumentId)
      .filter((region) => includeDeleted || region.disposition !== "deleted")
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(copy);
  }

  async updateWorkbookReviewRegion(id, patch = {}) {
    const existing = this.workbookReviewRegions.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      disposition: patch.disposition ?? existing.disposition,
      reviewStatus: patch.reviewStatus ?? existing.reviewStatus,
      currentRevisionId: patch.currentRevisionId ?? existing.currentRevisionId,
      acceptedRevisionId: patch.acceptedRevisionId ?? existing.acceptedRevisionId,
      warnings: patch.warnings === undefined ? existing.warnings : copy(patch.warnings),
      acceptedAt: patch.acceptedAt ?? existing.acceptedAt,
      acceptedBy: patch.acceptedBy ?? existing.acceptedBy,
      ignoredAt: patch.ignoredAt ?? existing.ignoredAt,
      ignoredBy: patch.ignoredBy ?? existing.ignoredBy,
      ignoredReason: patch.ignoredReason ?? existing.ignoredReason,
      deletedAt: patch.deletedAt ?? existing.deletedAt,
      deletedBy: patch.deletedBy ?? existing.deletedBy,
      deletedReason: patch.deletedReason ?? existing.deletedReason,
      version: (Number(existing.version) || 1) + 1,
      updatedAt: nowIso(),
      updatedBy: patch.updatedBy || existing.updatedBy,
    };
    this.workbookReviewRegions.set(id, updated);
    return copy(updated);
  }

  async createRegionUnderstandingRevision(input) {
    const duplicate = [...this.regionUnderstandingRevisions.values()].find((revision) => (
      revision.regionId === input.regionId
      && Number(revision.revisionNumber) === Number(input.revisionNumber)
    ));
    if (duplicate) throw new Error("Region understanding revision number already exists.");
    const revision = {
      id: input.id || makeId("region_understanding_revision"),
      labId: input.labId,
      projectId: input.projectId,
      workbookReviewSessionId: input.workbookReviewSessionId,
      sourceDocumentId: input.sourceDocumentId,
      regionId: input.regionId,
      revisionNumber: Number(input.revisionNumber) || 1,
      trigger: input.trigger || "initial",
      userFeedback: input.userFeedback || "",
      summary: copy(input.summary) || [],
      interpretation: copy(input.interpretation) || {},
      sourceRefs: copy(input.sourceRefs) || [],
      sourceContentHash: input.sourceContentHash,
      dependencyHash: input.dependencyHash,
      validation: copy(input.validation) || {},
      provider: copy(input.provider) || {},
      warnings: copy(input.warnings) || [],
      confidence: input.confidence ?? null,
      createdAt: nowIso(),
      createdBy: input.createdBy || null,
    };
    this.regionUnderstandingRevisions.set(revision.id, revision);
    return copy(revision);
  }

  async findRegionUnderstandingRevisionById(id) {
    return copy(this.regionUnderstandingRevisions.get(id) || null);
  }

  async listRegionUnderstandingRevisions({ regionId, projectId } = {}) {
    return [...this.regionUnderstandingRevisions.values()]
      .filter((revision) => !regionId || revision.regionId === regionId)
      .filter((revision) => !projectId || revision.projectId === projectId)
      .sort((a, b) => Number(a.revisionNumber) - Number(b.revisionNumber))
      .map(copy);
  }

  async listAcceptedRegionUnderstandings({ projectId, sourceDocumentId, workbookReviewSessionId } = {}) {
    const regions = await this.listWorkbookReviewRegions({
      projectId,
      sourceDocumentId,
      workbookReviewSessionId,
      includeDeleted: false,
    });
    return regions.flatMap((region) => {
      if (region.disposition !== "active" || !region.acceptedRevisionId) return [];
      const revision = this.regionUnderstandingRevisions.get(region.acceptedRevisionId);
      return revision ? [{ region: copy(region), revision: copy(revision) }] : [];
    });
  }

  async findDataPlanById(id) {
    return copy(this.dataPlans.get(id) || null);
  }

  async listDataPlans({ projectId }) {
    return [...this.dataPlans.values()]
      .filter((plan) => plan.projectId === projectId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(copy);
  }

  async findDataSnapshotById(id) {
    return copy(this.dataSnapshots.get(id) || null);
  }

  async listDataSnapshots({ projectId }) {
    return [...this.dataSnapshots.values()]
      .filter((snapshot) => snapshot.projectId === projectId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(copy);
  }

  async findExperimentIdentityById(id) {
    return copy(this.experimentIdentities.get(id) || null);
  }

  async listExperimentIdentities({ projectId }) {
    return [...this.experimentIdentities.values()]
      .filter((identity) => identity.projectId === projectId)
      .sort((a, b) => String(a.canonicalLabel).localeCompare(String(b.canonicalLabel)) || a.id.localeCompare(b.id))
      .map(copy);
  }

  async listExperimentSnapshotHeads({ projectId }) {
    return [...this.experimentSnapshotHeads.values()]
      .filter((head) => head.projectId === projectId)
      .sort((a, b) => a.experimentId.localeCompare(b.experimentId))
      .map(copy);
  }

  async findExperimentSnapshotPublish({ projectId, idempotencyKey }) {
    return copy(this.experimentSnapshotPublishes.get(`${projectId}:${idempotencyKey}`) || null);
  }

  async publishExperimentSnapshot(input) {
    const publishKey = `${input.projectId}:${input.idempotencyKey}`;
    const prior = this.experimentSnapshotPublishes.get(publishKey);
    if (prior) {
      if (prior.requestHash !== input.requestHash) {
        throw Object.assign(new Error("This idempotency key was already used for a different publish request."), {
          statusCode: 409,
          code: "idempotency_key_conflict",
        });
      }
      return { ...copy(prior.response), idempotentReplay: true };
    }

    const dataPlan = copy(input.dataPlan);
    const dataSnapshot = copy(input.dataSnapshot);
    const identities = copy(input.experimentIdentities) || [];
    const heads = copy(input.experimentSnapshotHeads) || [];
    const records = Array.isArray(dataSnapshot?.experimentRecords) ? dataSnapshot.experimentRecords : [];
    const invalid = (
      !input.idempotencyKey
      || !input.requestHash
      || !dataPlan?.id
      || !dataSnapshot?.id
      || dataPlan.projectId !== input.projectId
      || dataSnapshot.projectId !== input.projectId
      || dataSnapshot.dataPlanId !== dataPlan.id
      || this.dataPlans.has(dataPlan.id)
      || this.dataSnapshots.has(dataSnapshot.id)
      || identities.some((identity) => !identity?.id || identity.projectId !== input.projectId)
      || heads.some((head) => {
        const record = records[Number(head?.recordIndex)];
        return !head?.id
          || head.projectId !== input.projectId
          || head.dataSnapshotId !== dataSnapshot.id
          || !record
          || record.experimentId !== head.experimentId
          || !identities.some((identity) => identity.id === head.experimentId)
            && !this.experimentIdentities.has(head.experimentId);
      })
    );
    if (invalid) {
      throw Object.assign(new Error("The experiment snapshot publish package is invalid."), {
        statusCode: 400,
        code: "invalid_publish_package",
      });
    }

    const nextDataPlans = new Map(this.dataPlans);
    const nextDataSnapshots = new Map(this.dataSnapshots);
    const nextIdentities = new Map(this.experimentIdentities);
    const nextHeads = new Map(this.experimentSnapshotHeads);
    const nextPublishes = new Map(this.experimentSnapshotPublishes);
    const nextAuditEvents = new Map(this.auditEvents);
    nextDataPlans.set(dataPlan.id, dataPlan);
    nextDataSnapshots.set(dataSnapshot.id, dataSnapshot);
    identities.forEach((identity) => nextIdentities.set(identity.id, identity));
    heads.forEach((head) => {
      const existing = [...nextHeads.values()].find((candidate) => (
        candidate.projectId === input.projectId && candidate.experimentId === head.experimentId
      ));
      if (existing) nextHeads.delete(existing.id);
      nextHeads.set(head.id, head);
    });
    asArray(input.auditEvents).forEach((auditInput) => {
      const event = {
        id: auditInput.id || makeId("audit"),
        labId: auditInput.labId || input.labId || null,
        projectId: auditInput.projectId || input.projectId || null,
        actorUserId: auditInput.actorUserId || input.actorUserId || null,
        action: auditInput.action,
        targetType: auditInput.targetType || null,
        targetId: auditInput.targetId || null,
        summary: auditInput.summary || null,
        metadata: copy(auditInput.metadata) || {},
        createdAt: auditInput.createdAt || nowIso(),
        ipAddress: auditInput.ipAddress || null,
        userAgent: auditInput.userAgent || null,
      };
      nextAuditEvents.set(event.id, event);
    });
    const response = { ...copy(input.response), idempotentReplay: false };
    nextPublishes.set(publishKey, {
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      dataPlanId: dataPlan.id,
      dataSnapshotId: dataSnapshot.id,
      response,
      createdAt: nowIso(),
    });

    this.dataPlans = nextDataPlans;
    this.dataSnapshots = nextDataSnapshots;
    this.experimentIdentities = nextIdentities;
    this.experimentSnapshotHeads = nextHeads;
    this.experimentSnapshotPublishes = nextPublishes;
    this.auditEvents = nextAuditEvents;
    return copy(response);
  }

  async createBrowserView(input) {
    const createdAt = nowIso();
    const view = {
      id: input.id || makeId("browser_view"),
      labId: input.labId,
      projectId: input.projectId,
      ownerUserId: input.ownerUserId,
      schemaVersion: input.schemaVersion || "labrat.browserView.v1",
      name: String(input.name || "Untitled view"),
      payload: copy(input.payload) || {},
      isDefault: Boolean(input.isDefault),
      createdAt,
      updatedAt: createdAt,
    };
    this.browserViews.set(view.id, view);
    return copy(view);
  }

  async findBrowserViewById(id) {
    return copy(this.browserViews.get(id) || null);
  }

  async listBrowserViews({ projectId, ownerUserId = null }) {
    return [...this.browserViews.values()]
      .filter((view) => view.projectId === projectId)
      .filter((view) => !ownerUserId || view.ownerUserId === ownerUserId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(copy);
  }

  async updateBrowserView(id, changes = {}) {
    const existing = this.browserViews.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...(changes.name !== undefined ? { name: String(changes.name) } : {}),
      ...(changes.payload !== undefined ? { payload: copy(changes.payload) || {} } : {}),
      ...(changes.isDefault !== undefined ? { isDefault: Boolean(changes.isDefault) } : {}),
      updatedAt: nowIso(),
    };
    this.browserViews.set(id, updated);
    return copy(updated);
  }

  async deleteBrowserView(id) {
    return this.browserViews.delete(id);
  }

  async findProjectBrowserConfig({ projectId }) {
    return copy(this.projectBrowserConfigs.get(projectId) || null);
  }

  async saveProjectBrowserConfig(input) {
    const existing = this.projectBrowserConfigs.get(input.projectId);
    const expectedVersion = Number(input.expectedVersion) || 0;
    if (existing && existing.version !== expectedVersion) {
      throw Object.assign(new Error("The shared Experiment Browser configuration changed. Reload the latest configuration and try again."), {
        statusCode: 409,
        code: "project_browser_config_conflict",
      });
    }
    if (!existing && expectedVersion !== 0) {
      throw Object.assign(new Error("The shared Experiment Browser configuration changed. Reload the latest configuration and try again."), {
        statusCode: 409,
        code: "project_browser_config_conflict",
      });
    }
    const now = nowIso();
    const config = {
      id: existing?.id || input.id || makeId("project_browser_config"),
      labId: input.labId,
      projectId: input.projectId,
      schemaVersion: "labrat.projectBrowserConfig.v1",
      payload: copy(input.payload) || {},
      version: (existing?.version || 0) + 1,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      updatedBy: input.updatedBy || null,
    };
    this.projectBrowserConfigs.set(input.projectId, config);
    return copy(config);
  }

  async listExperimentAnnotations({ projectId, userId }) {
    return [...this.experimentAnnotations.values()]
      .filter((annotation) => annotation.projectId === projectId && annotation.userId === userId)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map(copy);
  }

  async findExperimentAnnotation({ projectId, userId, experimentId }) {
    const annotation = [...this.experimentAnnotations.values()].find((candidate) => (
      candidate.projectId === projectId
      && candidate.userId === userId
      && candidate.experimentId === experimentId
    ));
    return copy(annotation || null);
  }

  async saveExperimentAnnotation(input) {
    const existing = await this.findExperimentAnnotation(input);
    const now = nowIso();
    const annotation = {
      id: existing?.id || input.id || makeId("experiment_annotation"),
      labId: input.labId,
      projectId: input.projectId,
      userId: input.userId,
      experimentId: input.experimentId,
      schemaVersion: "labrat.experimentAnnotation.v1",
      note: String(input.note || ""),
      color: input.color || "amber",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.experimentAnnotations.set(annotation.id, annotation);
    return copy(annotation);
  }

  async deleteExperimentAnnotation({ projectId, userId, experimentId }) {
    const annotation = await this.findExperimentAnnotation({ projectId, userId, experimentId });
    return annotation ? this.experimentAnnotations.delete(annotation.id) : false;
  }

  async listExperimentCustomColumns({ projectId }) {
    return [...this.experimentCustomColumns.values()]
      .filter((column) => column.projectId === projectId)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.id.localeCompare(right.id))
      .map(copy);
  }

  async findExperimentCustomColumn({ projectId, customColumnId }) {
    const column = this.experimentCustomColumns.get(customColumnId);
    return copy(column?.projectId === projectId ? column : null);
  }

  async createExperimentCustomColumn(input) {
    const now = nowIso();
    const column = {
      id: input.id || makeId("experiment_custom_column"), labId: input.labId, projectId: input.projectId,
      schemaVersion: "labrat.experimentCustomColumn.v1", label: input.label, version: 1,
      createdAt: now, updatedAt: now, createdBy: input.actorUserId || null, updatedBy: input.actorUserId || null,
    };
    this.experimentCustomColumns.set(column.id, column);
    return copy(column);
  }

  async updateExperimentCustomColumn({ projectId, customColumnId, expectedVersion, label, actorUserId }) {
    const existing = this.experimentCustomColumns.get(customColumnId);
    if (!existing || existing.projectId !== projectId) return null;
    if (existing.version !== expectedVersion) throw Object.assign(new Error("The custom column changed. Reload and try again."), { statusCode: 409, code: "experiment_custom_column_conflict" });
    const updated = { ...existing, label, version: existing.version + 1, updatedAt: nowIso(), updatedBy: actorUserId || null };
    this.experimentCustomColumns.set(customColumnId, updated);
    return copy(updated);
  }

  async deleteExperimentCustomColumn({ projectId, customColumnId }) {
    const existing = this.experimentCustomColumns.get(customColumnId);
    if (!existing || existing.projectId !== projectId) return false;
    this.experimentCustomColumns.delete(customColumnId);
    [...this.experimentCustomValues.entries()].forEach(([id, value]) => { if (value.customColumnId === customColumnId) this.experimentCustomValues.delete(id); });
    return true;
  }

  async listExperimentCustomValues({ projectId }) {
    return [...this.experimentCustomValues.values()].filter((value) => value.projectId === projectId).map(copy);
  }

  async saveExperimentCustomValue(input) {
    const existing = [...this.experimentCustomValues.values()].find((value) => value.projectId === input.projectId && value.customColumnId === input.customColumnId && value.experimentId === input.experimentId);
    if (input.expectedVersion != null && (existing?.version || 0) !== input.expectedVersion) throw Object.assign(new Error("The custom cell changed. Reload and try again."), { statusCode: 409, code: "experiment_custom_value_conflict" });
    const now = nowIso();
    const value = {
      id: existing?.id || input.id || makeId("experiment_custom_value"), labId: input.labId, projectId: input.projectId,
      customColumnId: input.customColumnId, experimentId: input.experimentId, schemaVersion: "labrat.experimentCustomValue.v1",
      value: input.value, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || now, updatedAt: now,
      createdBy: existing?.createdBy || input.actorUserId || null, updatedBy: input.actorUserId || null,
    };
    this.experimentCustomValues.set(value.id, value);
    return copy(value);
  }

  async createAgentRun(input) {
    const createdAt = nowIso();
    const run = {
      id: input.id || makeId("agent_run"),
      labId: input.labId,
      projectId: input.projectId,
      schemaVersion: input.schemaVersion || "labrat.agentRun.v1",
      status: input.status || "waiting_for_user",
      mode: input.mode || null,
      userMessage: input.userMessage || "",
      selectedContext: copy(input.selectedContext) || {},
      visibleSteps: copy(input.visibleSteps) || [],
      toolTrace: copy(input.toolTrace) || [],
      proposalRefs: copy(input.proposalRefs) || [],
      actions: copy(input.actions) || [],
      usage: copy(input.usage) || {},
      warnings: copy(input.warnings) || [],
      error: copy(input.error) || null,
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.agentRuns.set(run.id, run);
    return copy(run);
  }

  async findAgentRunById(id) {
    return copy(this.agentRuns.get(id) || null);
  }

  async listAgentRuns({ projectId }) {
    return [...this.agentRuns.values()]
      .filter((run) => run.projectId === projectId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(copy);
  }

  async updateAgentRun(id, changes) {
    const run = this.agentRuns.get(id);
    if (!run) return null;
    if (changes.status != null) run.status = String(changes.status);
    if (changes.mode != null) run.mode = changes.mode;
    if (changes.selectedContext != null) run.selectedContext = copy(changes.selectedContext) || {};
    if (changes.visibleSteps != null) run.visibleSteps = copy(changes.visibleSteps) || [];
    if (changes.toolTrace != null) run.toolTrace = copy(changes.toolTrace) || [];
    if (changes.proposalRefs != null) run.proposalRefs = copy(changes.proposalRefs) || [];
    if (changes.actions != null) run.actions = copy(changes.actions) || [];
    if (changes.usage != null) run.usage = copy(changes.usage) || {};
    if (changes.warnings != null) run.warnings = copy(changes.warnings) || [];
    if (changes.error !== undefined) run.error = copy(changes.error) || null;
    run.updatedAt = nowIso();
    run.updatedBy = changes.updatedBy || run.updatedBy;
    return copy(run);
  }

  async createAnalysisThread(input) {
    const createdAt = input.createdAt || nowIso();
    const thread = {
      id: input.id || makeId("analysis_thread"),
      labId: input.labId,
      projectId: input.projectId,
      schemaVersion: input.schemaVersion || "labrat.analysisThread.v1",
      status: input.status || "planning",
      outputTarget: input.outputTarget || "chart",
      originalRequest: String(input.originalRequest || ""),
      messages: copy(input.messages) || [],
      planRevisionIds: copy(input.planRevisionIds) || [],
      analysisRunIds: copy(input.analysisRunIds) || [],
      acceptedAnalysisResultIds: copy(input.acceptedAnalysisResultIds) || [],
      chartSpecIds: copy(input.chartSpecIds) || [],
      dataSnapshotIds: copy(input.dataSnapshotIds) || [],
      browserViewIds: copy(input.browserViewIds) || [],
      createdAt,
      updatedAt: input.updatedAt || createdAt,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy || input.createdBy,
    };
    this.analysisThreads.set(thread.id, thread);
    return copy(thread);
  }

  async findAnalysisThreadById(id) {
    return copy(this.analysisThreads.get(id) || null);
  }

  async listAnalysisThreads({ projectId }) {
    return [...this.analysisThreads.values()]
      .filter((thread) => thread.projectId === projectId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || b.id.localeCompare(a.id))
      .map(copy);
  }

  async updateAnalysisThread(id, changes = {}) {
    const thread = this.analysisThreads.get(id);
    if (!thread) return null;
    if (changes.status != null) thread.status = String(changes.status);
    if (changes.outputTarget != null) thread.outputTarget = String(changes.outputTarget);
    if (changes.messages != null) thread.messages = copy(changes.messages) || [];
    if (changes.planRevisionIds != null) thread.planRevisionIds = copy(changes.planRevisionIds) || [];
    if (changes.analysisRunIds != null) thread.analysisRunIds = copy(changes.analysisRunIds) || [];
    if (changes.acceptedAnalysisResultIds != null) {
      thread.acceptedAnalysisResultIds = copy(changes.acceptedAnalysisResultIds) || [];
    }
    if (changes.chartSpecIds != null) thread.chartSpecIds = copy(changes.chartSpecIds) || [];
    if (changes.dataSnapshotIds != null) thread.dataSnapshotIds = copy(changes.dataSnapshotIds) || [];
    if (changes.browserViewIds != null) thread.browserViewIds = copy(changes.browserViewIds) || [];
    thread.updatedAt = changes.updatedAt || nowIso();
    thread.updatedBy = changes.updatedBy || thread.updatedBy;
    return copy(thread);
  }

  async claimAnalysisThreadRetry(input = {}) {
    const claimedAt = input.claimedAt || nowIso();
    const claimedAtMs = Date.parse(claimedAt);
    const leaseMs = Number.isFinite(Number(input.leaseMs)) && Number(input.leaseMs) > 0
      ? Number(input.leaseMs)
      : 6 * 60 * 1000;
    const required = [
      input.labId,
      input.projectId,
      input.analysisThreadId,
      input.actorUserId,
      input.idempotencyKey,
      input.requestHash,
    ];
    if (required.some((value) => !String(value || "").trim()) || !Number.isFinite(claimedAtMs)) {
      throw Object.assign(new Error("The analysis retry claim is invalid."), {
        statusCode: 400,
        code: "invalid_analysis_retry_claim",
      });
    }

    const receiptKey = `${input.projectId}:${input.idempotencyKey}`;
    let receipt = this.analysisThreadRetryReceipts.get(receiptKey) || null;
    if (receipt && (
      receipt.projectId !== input.projectId
      || receipt.analysisThreadId !== input.analysisThreadId
      || receipt.actorUserId !== input.actorUserId
      || receipt.requestHash !== input.requestHash
    )) {
      throw Object.assign(new Error("This idempotency key was already used for another analysis retry."), {
        statusCode: 409,
        code: "idempotency_key_conflict",
      });
    }
    const thread = this.analysisThreads.get(input.analysisThreadId);
    if (!thread || thread.projectId !== input.projectId || thread.labId !== input.labId) {
      return { claimStatus: "not_available", receipt: copy(receipt), analysisThread: copy(thread) };
    }
    if (
      receipt?.status === "drafting"
      && thread.status === "awaiting_plan_review"
      && thread.planRevisionIds?.length
    ) {
      receipt = {
        ...receipt,
        status: "completed",
        leaseExpiresAt: null,
        analysisPlanRevisionId: thread.planRevisionIds.at(-1),
        updatedAt: claimedAt,
      };
      this.analysisThreadRetryReceipts.set(receiptKey, receipt);
    }
    if (receipt?.status === "completed") {
      return { claimStatus: "replay", receipt: copy(receipt), analysisThread: copy(thread) };
    }
    if (receipt?.status === "drafting" && Date.parse(receipt.leaseExpiresAt) > claimedAtMs) {
      return { claimStatus: "in_progress", receipt: copy(receipt), analysisThread: copy(thread) };
    }

    const activeReceipt = [...this.analysisThreadRetryReceipts.values()].find((candidate) => (
      candidate.projectId === input.projectId
      && candidate.analysisThreadId === input.analysisThreadId
      && candidate.status === "drafting"
      && Date.parse(candidate.leaseExpiresAt) > claimedAtMs
    ));
    if (activeReceipt) {
      return { claimStatus: "in_progress", receipt: copy(activeReceipt), analysisThread: copy(thread) };
    }
    for (const [key, candidate] of this.analysisThreadRetryReceipts) {
      if (
        candidate.projectId === input.projectId
        && candidate.analysisThreadId === input.analysisThreadId
        && candidate.status === "drafting"
        && Date.parse(candidate.leaseExpiresAt) <= claimedAtMs
      ) {
        this.analysisThreadRetryReceipts.set(key, {
          ...candidate,
          status: "retryable",
          leaseExpiresAt: null,
          updatedAt: claimedAt,
        });
      }
    }
    if (!["planning", "retry_drafting"].includes(thread.status)) {
      return { claimStatus: "not_available", receipt: copy(receipt), analysisThread: copy(thread) };
    }

    const recovered = Boolean(receipt?.status === "drafting") || thread.status === "retry_drafting";
    const leaseExpiresAt = new Date(claimedAtMs + leaseMs).toISOString();
    receipt = {
      id: receipt?.id || makeId("analysis_retry_receipt"),
      labId: input.labId,
      projectId: input.projectId,
      analysisThreadId: input.analysisThreadId,
      actorUserId: input.actorUserId,
      schemaVersion: "labrat.analysisThreadRetryReceipt.v1",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      status: "drafting",
      leaseExpiresAt,
      attemptCount: Number(receipt?.attemptCount || 0) + 1,
      analysisPlanRevisionId: null,
      createdAt: receipt?.createdAt || claimedAt,
      updatedAt: claimedAt,
    };
    this.analysisThreadRetryReceipts.set(receiptKey, receipt);
    thread.status = "retry_drafting";
    thread.updatedAt = claimedAt;
    thread.updatedBy = input.actorUserId;
    return {
      claimStatus: "claimed",
      receipt: copy(receipt),
      analysisThread: copy(thread),
      recovered,
    };
  }

  async releaseAnalysisThreadRetry(input = {}) {
    const receiptKey = `${input.projectId}:${input.idempotencyKey}`;
    const receipt = this.analysisThreadRetryReceipts.get(receiptKey);
    const thread = this.analysisThreads.get(input.analysisThreadId);
    if (!receipt || !thread) return null;
    if (
      receipt.analysisThreadId !== input.analysisThreadId
      || receipt.actorUserId !== input.actorUserId
      || receipt.requestHash !== input.requestHash
    ) {
      throw Object.assign(new Error("This idempotency key was already used for another analysis retry."), {
        statusCode: 409,
        code: "idempotency_key_conflict",
      });
    }
    const releasedAt = input.releasedAt || nowIso();
    const releasedReceipt = receipt.status === "drafting" ? {
      ...receipt,
      status: "retryable",
      leaseExpiresAt: null,
      updatedAt: releasedAt,
    } : receipt;
    this.analysisThreadRetryReceipts.set(receiptKey, releasedReceipt);
    if (thread.status === "retry_drafting") {
      thread.status = "planning";
      thread.updatedAt = releasedAt;
      thread.updatedBy = input.actorUserId;
    }
    return { receipt: copy(releasedReceipt), analysisThread: copy(thread) };
  }

  async completeAnalysisThreadRetry(input = {}) {
    const receiptKey = `${input.projectId}:${input.idempotencyKey}`;
    const receipt = this.analysisThreadRetryReceipts.get(receiptKey);
    if (!receipt) return null;
    if (
      receipt.analysisThreadId !== input.analysisThreadId
      || receipt.actorUserId !== input.actorUserId
      || receipt.requestHash !== input.requestHash
    ) {
      throw Object.assign(new Error("This idempotency key was already used for another analysis retry."), {
        statusCode: 409,
        code: "idempotency_key_conflict",
      });
    }
    if (receipt.status === "completed") {
      if (receipt.analysisPlanRevisionId !== input.analysisPlanRevisionId) {
        throw Object.assign(new Error("The analysis retry receipt already references another revision."), {
          statusCode: 409,
          code: "analysis_retry_receipt_conflict",
        });
      }
      return copy(receipt);
    }
    const revision = this.analysisPlanRevisions.get(input.analysisPlanRevisionId);
    if (
      receipt.status !== "drafting"
      || !revision
      || revision.projectId !== input.projectId
      || revision.analysisThreadId !== input.analysisThreadId
    ) {
      throw Object.assign(new Error("The analysis retry receipt is not drafting."), {
        statusCode: 409,
        code: "analysis_retry_receipt_conflict",
      });
    }
    const completedReceipt = {
      ...receipt,
      status: "completed",
      leaseExpiresAt: null,
      analysisPlanRevisionId: input.analysisPlanRevisionId,
      updatedAt: input.completedAt || nowIso(),
    };
    this.analysisThreadRetryReceipts.set(receiptKey, completedReceipt);
    return copy(completedReceipt);
  }

  async createAnalysisPlanRevision(input) {
    if (this.analysisPlanRevisions.has(input.id)) {
      throw Object.assign(new Error("Analysis plan revision already exists."), {
        statusCode: 409,
        code: "analysis_plan_revision_exists",
      });
    }
    const revision = copy(input);
    this.analysisPlanRevisions.set(revision.id, revision);
    return copy(revision);
  }

  async findAnalysisPlanRevisionById(id) {
    return copy(this.analysisPlanRevisions.get(id) || null);
  }

  async listAnalysisPlanRevisions({ analysisThreadId }) {
    return [...this.analysisPlanRevisions.values()]
      .filter((revision) => revision.analysisThreadId === analysisThreadId)
      .sort((a, b) => Number(a.revision) - Number(b.revision))
      .map(copy);
  }

  async updateAnalysisPlanRevisionStatus(id, {
    status,
    acceptedAt,
    acceptedBy,
    updatedAt,
    updatedBy,
  } = {}) {
    const revision = this.analysisPlanRevisions.get(id);
    if (!revision) return null;
    if (status != null) revision.status = String(status);
    if (acceptedAt !== undefined) revision.acceptedAt = acceptedAt;
    if (acceptedBy !== undefined) revision.acceptedBy = acceptedBy;
    revision.updatedAt = updatedAt || nowIso();
    revision.updatedBy = updatedBy || revision.updatedBy;
    return copy(revision);
  }

  async appendAnalysisPlanRevision({
    threadId,
    priorRevisionId = null,
    revision,
    messages = [],
    actorUserId,
  }) {
    const thread = this.analysisThreads.get(threadId);
    const prior = priorRevisionId ? this.analysisPlanRevisions.get(priorRevisionId) : null;
    const duplicateNumber = [...this.analysisPlanRevisions.values()].some((item) => (
      item.analysisThreadId === threadId && Number(item.revision) === Number(revision?.revision)
    ));
    if (
      !thread
      || !revision?.id
      || revision.analysisThreadId !== threadId
      || revision.projectId !== thread.projectId
      || this.analysisPlanRevisions.has(revision.id)
      || duplicateNumber
      || priorRevisionId && (!prior || prior.analysisThreadId !== threadId || prior.status !== "awaiting_review")
    ) {
      throw Object.assign(new Error("The analysis plan revision package is invalid."), {
        statusCode: 409,
        code: "analysis_plan_revision_conflict",
      });
    }
    const nextThreads = new Map(this.analysisThreads);
    const nextRevisions = new Map(this.analysisPlanRevisions);
    const updatedAt = revision.createdAt || nowIso();
    if (prior) {
      nextRevisions.set(prior.id, {
        ...copy(prior),
        status: "superseded",
        updatedAt,
        updatedBy: actorUserId,
      });
    }
    nextRevisions.set(revision.id, copy(revision));
    const updatedThread = {
      ...copy(thread),
      status: "awaiting_plan_review",
      messages: [...asArray(thread.messages).map(copy), ...asArray(messages).map(copy)],
      planRevisionIds: [...asArray(thread.planRevisionIds), revision.id],
      updatedAt,
      updatedBy: actorUserId,
    };
    nextThreads.set(thread.id, updatedThread);
    this.analysisThreads = nextThreads;
    this.analysisPlanRevisions = nextRevisions;
    return copy(revision);
  }

  async createAnalysisRun(input) {
    if (this.analysisRuns.has(input.id)) {
      throw Object.assign(new Error("Analysis run already exists."), {
        statusCode: 409,
        code: "analysis_run_exists",
      });
    }
    const run = copy(input);
    this.analysisRuns.set(run.id, run);
    return copy(run);
  }

  async retryAnalysisRun(input) {
    const prior = await this.findAnalysisRunByIdempotencyKey({
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
    });
    if (prior) {
      if (prior.requestHash !== input.requestHash) {
        throw Object.assign(new Error("This idempotency key was already used for another generation retry."), {
          statusCode: 409,
          code: "idempotency_key_conflict",
        });
      }
      return {
        analysisThread: await this.findAnalysisThreadById(prior.analysisThreadId),
        analysisRun: prior,
      };
    }
    const failedRun = this.analysisRuns.get(input.failedAnalysisRunId);
    const thread = this.analysisThreads.get(input.analysisThreadId);
    const revision = this.analysisPlanRevisions.get(input.planRevisionId);
    if (
      !failedRun
      || !thread
      || !revision
      || failedRun.projectId !== input.projectId
      || !["failed", "validation_failed"].includes(failedRun.status)
      || revision.status !== "accepted"
      || revision.analysisThreadId !== thread.id
      || input.analysisRun?.analysisThreadId !== thread.id
      || input.analysisRun?.acceptedPlanRevisionId !== revision.id
      || this.analysisRuns.has(input.analysisRun?.id)
    ) {
      throw Object.assign(new Error("The analysis generation retry package is invalid."), {
        statusCode: 409,
        code: "analysis_run_retry_unavailable",
      });
    }
    const nextRuns = new Map(this.analysisRuns);
    const nextThreads = new Map(this.analysisThreads);
    const nextAuditEvents = new Map(this.auditEvents);
    nextRuns.set(input.analysisRun.id, copy(input.analysisRun));
    const updatedThread = {
      ...copy(thread),
      status: "executing",
      analysisRunIds: [...asArray(thread.analysisRunIds), input.analysisRun.id],
      updatedAt: input.analysisRun.createdAt,
      updatedBy: input.actorUserId,
    };
    nextThreads.set(thread.id, updatedThread);
    asArray(input.auditEvents).forEach((auditInput) => {
      const event = {
        id: auditInput.id || makeId("audit"),
        ...copy(auditInput),
      };
      nextAuditEvents.set(event.id, event);
    });
    this.analysisRuns = nextRuns;
    this.analysisThreads = nextThreads;
    this.auditEvents = nextAuditEvents;
    return { analysisThread: copy(updatedThread), analysisRun: copy(input.analysisRun) };
  }

  async findAnalysisRunById(id) {
    return copy(this.analysisRuns.get(id) || null);
  }

  async findAnalysisRunByIdempotencyKey({ projectId, idempotencyKey }) {
    const run = [...this.analysisRuns.values()].find((candidate) => (
      candidate.projectId === projectId && candidate.idempotencyKey === idempotencyKey
    ));
    return copy(run || null);
  }

  async listAnalysisRuns({ projectId, analysisThreadId = null }) {
    return [...this.analysisRuns.values()]
      .filter((run) => run.projectId === projectId)
      .filter((run) => !analysisThreadId || run.analysisThreadId === analysisThreadId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id))
      .map(copy);
  }

  async claimAnalysisRun({
    projectId,
    analysisRunId,
    actorUserId,
    expectedHeadRefs = [],
    staleValidation = {},
    staleAuditEvents = [],
    startedAt = nowIso(),
    staleAfterMs = 360_000,
  }) {
    const run = this.analysisRuns.get(analysisRunId);
    const thread = run ? this.analysisThreads.get(run.analysisThreadId) : null;
    const priorStartedAt = Date.parse(run?.payload?.startedAt || "");
    const claimStartedAt = Date.parse(startedAt);
    const expiredLease = run?.status === "running"
      && Number.isFinite(priorStartedAt)
      && Number.isFinite(claimStartedAt)
      && claimStartedAt - priorStartedAt >= Math.max(Number(staleAfterMs) || 0, 1);
    if (
      !run
      || run.projectId !== projectId
      || !thread
      || thread.projectId !== projectId
      || run.status !== "queued" && !expiredLease
    ) {
      throw Object.assign(new Error("Analysis run is not queued for execution."), {
        statusCode: 409,
        code: "analysis_run_state_conflict",
      });
    }
    const headMismatches = asArray(expectedHeadRefs).flatMap((expected) => {
      const current = [...this.experimentSnapshotHeads.values()].find((head) => (
        head.projectId === projectId && head.experimentId === expected.experimentId
      ));
      return (
        current
        && current.id === expected.headId
        && current.dataSnapshotId === expected.dataSnapshotId
        && Number(current.recordIndex) === Number(expected.recordIndex)
      ) ? [] : [{
        experimentId: expected.experimentId,
        expected,
        current: current ? {
          headId: current.id,
          dataSnapshotId: current.dataSnapshotId,
          recordIndex: Number(current.recordIndex),
        } : null,
      }];
    });
    if (headMismatches.length) {
      const completed = {
        ...copy(run),
        status: "validation_failed",
        payload: {
          ...copy(run.payload || {}),
          completedAt: startedAt,
          error: {
            code: "analysis_run_stale",
            message: "Active accepted experiment heads changed before execution claim.",
          },
          headMismatches,
        },
        validation: copy(staleValidation) || {},
        updatedAt: startedAt,
        updatedBy: actorUserId,
      };
      const failedThread = {
        ...copy(thread),
        status: "execution_failed",
        updatedAt: startedAt,
        updatedBy: actorUserId,
      };
      const nextRuns = new Map(this.analysisRuns);
      const nextThreads = new Map(this.analysisThreads);
      const nextAuditEvents = new Map(this.auditEvents);
      nextRuns.set(run.id, completed);
      nextThreads.set(thread.id, failedThread);
      asArray(staleAuditEvents).forEach((auditInput) => {
        const event = {
          id: auditInput.id || makeId("audit"),
          labId: auditInput.labId || run.labId || null,
          projectId: auditInput.projectId || projectId,
          actorUserId: auditInput.actorUserId || actorUserId || null,
          action: auditInput.action,
          targetType: auditInput.targetType || null,
          targetId: auditInput.targetId || null,
          summary: auditInput.summary || null,
          metadata: copy(auditInput.metadata) || {},
          createdAt: auditInput.createdAt || startedAt,
          ipAddress: auditInput.ipAddress || null,
          userAgent: auditInput.userAgent || null,
        };
        nextAuditEvents.set(event.id, event);
      });
      this.analysisRuns = nextRuns;
      this.analysisThreads = nextThreads;
      this.auditEvents = nextAuditEvents;
      return copy(completed);
    }
    const claimed = {
      ...copy(run),
      status: "running",
      payload: {
        ...copy(run.payload || {}),
        ...(expiredLease ? {
          recoveredFromStartedAt: run.payload?.startedAt || null,
          recoveryCount: (Number(run.payload?.recoveryCount) || 0) + 1,
        } : {}),
        claimToken: makeId("analysis_claim"),
        startedAt,
      },
      updatedAt: startedAt,
      updatedBy: actorUserId,
    };
    const nextRuns = new Map(this.analysisRuns);
    nextRuns.set(run.id, claimed);
    this.analysisRuns = nextRuns;
    return copy(claimed);
  }

  async finalizeAnalysisRun({
    projectId,
    analysisRunId,
    actorUserId,
    claimToken,
    status,
    resultPreviewHash = null,
    payload = {},
    warnings = [],
    validation = {},
    analysisResult = null,
    threadStatus,
    completedAt = nowIso(),
    auditEvents = [],
  }) {
    const run = this.analysisRuns.get(analysisRunId);
    const thread = run ? this.analysisThreads.get(run.analysisThreadId) : null;
    if (
      !run
      || run.projectId !== projectId
      || run.status !== "running"
      || !claimToken
      || claimToken !== run.payload?.claimToken
      || !thread
      || thread.projectId !== projectId
      || !["failed", "validation_failed", "awaiting_result_review"].includes(status)
      || analysisResult && (
        status !== "awaiting_result_review"
        || analysisResult.projectId !== projectId
        || analysisResult.analysisThreadId !== thread.id
        || analysisResult.analysisRunId !== run.id
        || this.analysisResults.has(analysisResult.id)
      )
    ) {
      throw Object.assign(new Error("The analysis run completion package is invalid."), {
        statusCode: 409,
        code: "analysis_run_state_conflict",
      });
    }
    const nextRuns = new Map(this.analysisRuns);
    const nextThreads = new Map(this.analysisThreads);
    const nextResults = new Map(this.analysisResults);
    const nextAuditEvents = new Map(this.auditEvents);
    const completedRun = {
      ...copy(run),
      status,
      resultPreviewHash,
      payload: copy(payload) || {},
      warnings: copy(warnings) || [],
      validation: copy(validation) || {},
      updatedAt: completedAt,
      updatedBy: actorUserId,
    };
    const updatedThread = {
      ...copy(thread),
      status: threadStatus || (
        status === "awaiting_result_review" ? "awaiting_result_review" : "execution_failed"
      ),
      updatedAt: completedAt,
      updatedBy: actorUserId,
    };
    nextRuns.set(run.id, completedRun);
    nextThreads.set(thread.id, updatedThread);
    if (analysisResult) nextResults.set(analysisResult.id, copy(analysisResult));
    asArray(auditEvents).forEach((auditInput) => {
      const event = {
        id: auditInput.id || makeId("audit"),
        labId: auditInput.labId || run.labId || null,
        projectId: auditInput.projectId || projectId,
        actorUserId: auditInput.actorUserId || actorUserId || null,
        action: auditInput.action,
        targetType: auditInput.targetType || null,
        targetId: auditInput.targetId || null,
        summary: auditInput.summary || null,
        metadata: copy(auditInput.metadata) || {},
        createdAt: auditInput.createdAt || completedAt,
        ipAddress: auditInput.ipAddress || null,
        userAgent: auditInput.userAgent || null,
      };
      nextAuditEvents.set(event.id, event);
    });
    this.analysisRuns = nextRuns;
    this.analysisThreads = nextThreads;
    this.analysisResults = nextResults;
    this.auditEvents = nextAuditEvents;
    return {
      analysisRun: copy(completedRun),
      analysisThread: copy(updatedThread),
      analysisResult: copy(analysisResult),
    };
  }

  async createAnalysisResult(input) {
    if (this.analysisResults.has(input.id)) {
      throw Object.assign(new Error("Analysis result already exists."), {
        statusCode: 409,
        code: "analysis_result_exists",
      });
    }
    const result = copy(input);
    this.analysisResults.set(result.id, result);
    return copy(result);
  }

  async findAnalysisResultById(id) {
    return copy(this.analysisResults.get(id) || null);
  }

  async listAnalysisResults({ projectId, analysisThreadId = null }) {
    return [...this.analysisResults.values()]
      .filter((result) => result.projectId === projectId)
      .filter((result) => !analysisThreadId || result.analysisThreadId === analysisThreadId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id))
      .map(copy);
  }

  async acceptAnalysisPlan(input) {
    const prior = await this.findAnalysisRunByIdempotencyKey({
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
    });
    if (prior) {
      if (prior.requestHash !== input.requestHash) {
        throw Object.assign(new Error("This idempotency key was already used for another plan acceptance."), {
          statusCode: 409,
          code: "idempotency_key_conflict",
        });
      }
      return {
        analysisThread: await this.findAnalysisThreadById(prior.analysisThreadId),
        analysisPlanRevision: await this.findAnalysisPlanRevisionById(prior.acceptedPlanRevisionId),
        analysisRun: prior,
      };
    }
    const thread = this.analysisThreads.get(input.analysisThreadId);
    const revision = this.analysisPlanRevisions.get(input.planRevisionId);
    if (
      !thread
      || !revision
      || thread.projectId !== input.projectId
      || revision.projectId !== input.projectId
      || revision.analysisThreadId !== thread.id
      || revision.status !== "awaiting_review"
      || !input.analysisRun?.id
      || input.analysisRun.projectId !== input.projectId
      || input.analysisRun.analysisThreadId !== thread.id
      || input.analysisRun.acceptedPlanRevisionId !== revision.id
      || input.analysisRun.idempotencyKey !== input.idempotencyKey
      || input.analysisRun.requestHash !== input.requestHash
      || this.analysisRuns.has(input.analysisRun?.id)
    ) {
      throw Object.assign(new Error("The analysis plan acceptance package is invalid."), {
        statusCode: 409,
        code: "analysis_plan_revision_mismatch",
      });
    }
    const nextThreads = new Map(this.analysisThreads);
    const nextRevisions = new Map(this.analysisPlanRevisions);
    const nextRuns = new Map(this.analysisRuns);
    const nextAuditEvents = new Map(this.auditEvents);
    const acceptedAt = input.analysisRun.createdAt || nowIso();
    const acceptedRevision = {
      ...copy(revision),
      status: "accepted",
      acceptedAt,
      acceptedBy: input.actorUserId,
      updatedAt: acceptedAt,
      updatedBy: input.actorUserId,
    };
    const updatedThread = {
      ...copy(thread),
      status: "executing",
      analysisRunIds: [...asArray(thread.analysisRunIds), input.analysisRun.id],
      updatedAt: acceptedAt,
      updatedBy: input.actorUserId,
    };
    nextRevisions.set(revision.id, acceptedRevision);
    nextThreads.set(thread.id, updatedThread);
    nextRuns.set(input.analysisRun.id, copy(input.analysisRun));
    asArray(input.auditEvents).forEach((auditInput) => {
      const event = {
        id: auditInput.id || makeId("audit"),
        labId: auditInput.labId || null,
        projectId: auditInput.projectId || input.projectId,
        actorUserId: auditInput.actorUserId || input.actorUserId || null,
        action: auditInput.action,
        targetType: auditInput.targetType || null,
        targetId: auditInput.targetId || null,
        summary: auditInput.summary || null,
        metadata: copy(auditInput.metadata) || {},
        createdAt: auditInput.createdAt || acceptedAt,
        ipAddress: auditInput.ipAddress || null,
        userAgent: auditInput.userAgent || null,
      };
      nextAuditEvents.set(event.id, event);
    });
    this.analysisThreads = nextThreads;
    this.analysisPlanRevisions = nextRevisions;
    this.analysisRuns = nextRuns;
    this.auditEvents = nextAuditEvents;
    return {
      analysisThread: copy(updatedThread),
      analysisPlanRevision: copy(acceptedRevision),
      analysisRun: copy(input.analysisRun),
    };
  }

  async findAnalysisPublication({ projectId, idempotencyKey }) {
    return copy(this.analysisPublications.get(`${projectId}:${idempotencyKey}`) || null);
  }

  async publishAnalysisResult(input) {
    const publicationKey = `${input.projectId}:${input.idempotencyKey}`;
    const prior = this.analysisPublications.get(publicationKey);
    if (prior) {
      if (prior.requestHash !== input.requestHash) {
        throw Object.assign(new Error("This idempotency key was already used for another analysis publication."), {
          statusCode: 409,
          code: "idempotency_key_conflict",
        });
      }
      return { ...copy(prior.response), idempotentReplay: true };
    }
    const thread = this.analysisThreads.get(input.analysisThreadId);
    const revision = this.analysisPlanRevisions.get(input.analysisPlanRevision?.id);
    const run = this.analysisRuns.get(input.analysisRun?.id);
    const storedResult = this.analysisResults.get(input.analysisResult?.id);
    const result = copy(input.analysisResult);
    const chartSpec = copy(input.chartSpec);
    if (
      !input.idempotencyKey
      || !input.requestHash
      || !thread
      || thread.projectId !== input.projectId
      || thread.status !== "awaiting_result_review"
      || !revision
      || revision.projectId !== input.projectId
      || revision.analysisThreadId !== thread.id
      || revision.status !== "accepted"
      || !run
      || run.projectId !== input.projectId
      || run.analysisThreadId !== thread.id
      || run.acceptedPlanRevisionId !== revision.id
      || run.status !== "awaiting_result_review"
      || run.resultPreviewHash !== storedResult?.resultPreviewHash
      || input.analysisRun.status !== "completed"
      || !result?.id
      || result.projectId !== input.projectId
      || result.analysisThreadId !== thread.id
      || result.analysisRunId !== run.id
      || result.status !== "accepted"
      || !storedResult
      || storedResult.projectId !== input.projectId
      || storedResult.analysisThreadId !== thread.id
      || storedResult.analysisRunId !== run.id
      || storedResult.status !== "awaiting_review"
      || storedResult.contentHash !== result.contentHash
      || storedResult.resultPreviewHash !== result.resultPreviewHash
      || storedResult.validation?.ok !== true
      || asArray(storedResult.validation?.errors).length
      || !chartSpec?.id
      || chartSpec.projectId !== input.projectId
      || chartSpec.analysisResultId !== result.id
      || chartSpec.spec?.origin !== "analysis_result"
      || chartSpec.spec?.schemaVersion !== "labrat.chartSpec.v3"
      || chartSpec.spec?.analysisThreadId !== thread.id
      || chartSpec.spec?.analysisPlanRevisionId !== revision.id
      || chartSpec.spec?.analysisRunId !== run.id
      || chartSpec.spec?.analysisResultId !== storedResult.id
      || !Array.isArray(input.expectedHeadRefs)
      || this.chartSpecs.has(chartSpec.id)
    ) {
      throw Object.assign(new Error("The analysis result publication package is invalid."), {
        statusCode: 400,
        code: "invalid_analysis_publication_package",
      });
    }
    const headMismatches = asArray(input.expectedHeadRefs).flatMap((expected) => {
      const current = [...this.experimentSnapshotHeads.values()].find((head) => (
        head.projectId === input.projectId && head.experimentId === expected.experimentId
      ));
      return (
        current
        && current.id === expected.headId
        && current.dataSnapshotId === expected.dataSnapshotId
        && Number(current.recordIndex) === Number(expected.recordIndex)
      ) ? [] : [{
        experimentId: expected.experimentId,
        expected: copy(expected),
        current: current ? {
          headId: current.id,
          dataSnapshotId: current.dataSnapshotId,
          recordIndex: Number(current.recordIndex),
        } : null,
      }];
    });
    if (headMismatches.length) {
      throw Object.assign(new Error("Accepted experiment snapshots changed before chart publication."), {
        statusCode: 409,
        code: "analysis_result_stale",
        details: { headMismatches },
      });
    }
    const nextThreads = new Map(this.analysisThreads);
    const nextRuns = new Map(this.analysisRuns);
    const nextResults = new Map(this.analysisResults);
    const nextChartSpecs = new Map(this.chartSpecs);
    const nextPublications = new Map(this.analysisPublications);
    const nextAuditEvents = new Map(this.auditEvents);
    const createdAt = result.acceptedAt || nowIso();
    const acceptedResult = {
      ...copy(storedResult),
      status: "accepted",
      acceptedAt: createdAt,
      acceptedBy: input.actorUserId,
      updatedAt: createdAt,
      updatedBy: input.actorUserId,
    };
    const completedRun = {
      ...copy(run),
      status: "completed",
      updatedAt: createdAt,
      updatedBy: input.actorUserId,
    };
    const updatedThread = {
      ...copy(thread),
      status: "completed",
      acceptedAnalysisResultIds: [
        ...asArray(thread.acceptedAnalysisResultIds).filter((id) => id !== result.id),
        result.id,
      ],
      chartSpecIds: [
        ...asArray(thread.chartSpecIds).filter((id) => id !== chartSpec.id),
        chartSpec.id,
      ],
      updatedAt: createdAt,
      updatedBy: input.actorUserId,
    };
    const response = { ...copy(input.response), idempotentReplay: false };
    const publication = {
      id: input.publicationId || makeId("analysis_publication"),
      labId: input.labId,
      projectId: input.projectId,
      analysisThreadId: thread.id,
      analysisResultId: result.id,
      chartSpecId: chartSpec.id,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      response,
      createdAt,
      createdBy: input.actorUserId,
    };
    nextThreads.set(thread.id, updatedThread);
    nextRuns.set(run.id, completedRun);
    nextResults.set(result.id, acceptedResult);
    nextChartSpecs.set(chartSpec.id, chartSpec);
    nextPublications.set(publicationKey, publication);
    asArray(input.auditEvents).forEach((auditInput) => {
      const event = {
        id: auditInput.id || makeId("audit"),
        labId: auditInput.labId || input.labId || null,
        projectId: auditInput.projectId || input.projectId,
        actorUserId: auditInput.actorUserId || input.actorUserId || null,
        action: auditInput.action,
        targetType: auditInput.targetType || null,
        targetId: auditInput.targetId || null,
        summary: auditInput.summary || null,
        metadata: copy(auditInput.metadata) || {},
        createdAt: auditInput.createdAt || createdAt,
        ipAddress: auditInput.ipAddress || null,
        userAgent: auditInput.userAgent || null,
      };
      nextAuditEvents.set(event.id, event);
    });
    this.analysisThreads = nextThreads;
    this.analysisRuns = nextRuns;
    this.analysisResults = nextResults;
    this.chartSpecs = nextChartSpecs;
    this.analysisPublications = nextPublications;
    this.auditEvents = nextAuditEvents;
    return copy(response);
  }

  async findExperimentAnalysisPublication({ projectId, idempotencyKey }) {
    return copy(this.analysisExperimentPublications.get(`${projectId}:${idempotencyKey}`) || null);
  }

  async publishExperimentAnalysis(input) {
    const publicationKey = `${input.projectId}:${input.idempotencyKey}`;
    const prior = this.analysisExperimentPublications.get(publicationKey);
    if (prior) {
      if (prior.requestHash !== input.requestHash) {
        throw Object.assign(new Error("This idempotency key was already used for another Experiment Browser publication."), {
          statusCode: 409,
          code: "idempotency_key_conflict",
        });
      }
      return { ...copy(prior.response), idempotentReplay: true };
    }
    const thread = this.analysisThreads.get(input.analysisThread?.id);
    const revision = this.analysisPlanRevisions.get(input.analysisPlanRevision?.id);
    const run = this.analysisRuns.get(input.analysisRun?.id);
    const storedResult = this.analysisResults.get(input.analysisResult?.id);
    const snapshot = copy(input.dataSnapshot);
    const browserView = copy(input.browserView);
    const identities = asArray(input.experimentIdentities).map(copy);
    const heads = asArray(input.experimentSnapshotHeads).map(copy);
    const records = asArray(snapshot?.experimentRecords);
    if (
      !input.idempotencyKey
      || !input.requestHash
      || !thread
      || thread.status !== "awaiting_result_review"
      || thread.outputTarget !== "experiment_browser"
      || !revision
      || revision.status !== "accepted"
      || revision.analysisThreadId !== thread.id
      || !run
      || run.status !== "awaiting_result_review"
      || run.outputTarget !== "experiment_browser"
      || run.acceptedPlanRevisionId !== revision.id
      || !storedResult
      || storedResult.status !== "awaiting_review"
      || storedResult.outputTarget !== "experiment_browser"
      || storedResult.validation?.ok !== true
      || input.analysisResult.status !== "accepted"
      || input.analysisRun.status !== "completed"
      || !snapshot?.id
      || snapshot.projectId !== input.projectId
      || snapshot.analysisResultId !== storedResult.id
      || !browserView?.id
      || browserView.projectId !== input.projectId
      || browserView.ownerUserId !== input.actorUserId
      || heads.some((head) => {
        const record = records[Number(head.recordIndex)];
        return !record
          || head.dataSnapshotId !== snapshot.id
          || record.experimentId !== head.experimentId;
      })
    ) {
      throw Object.assign(new Error("The Experiment Browser publication package is invalid."), {
        statusCode: 400,
        code: "invalid_experiment_analysis_publication_package",
      });
    }
    const headMismatches = asArray(input.expectedHeadRefs).flatMap((expected) => {
      const current = [...this.experimentSnapshotHeads.values()].find((head) => (
        head.projectId === input.projectId && head.experimentId === expected.experimentId
      ));
      return (
        current
        && current.id === expected.headId
        && current.dataSnapshotId === expected.dataSnapshotId
        && Number(current.recordIndex) === Number(expected.recordIndex)
      ) ? [] : [{ experimentId: expected.experimentId, expected: copy(expected), current: copy(current) }];
    });
    if (headMismatches.length) {
      throw Object.assign(new Error("Accepted experiment snapshots changed before publication."), {
        statusCode: 409,
        code: "analysis_result_stale",
        details: { headMismatches },
      });
    }
    const nextThreads = new Map(this.analysisThreads);
    const nextRuns = new Map(this.analysisRuns);
    const nextResults = new Map(this.analysisResults);
    const nextSnapshots = new Map(this.dataSnapshots);
    const nextIdentities = new Map(this.experimentIdentities);
    const nextHeads = new Map(this.experimentSnapshotHeads);
    const nextViews = new Map(this.browserViews);
    const nextPublications = new Map(this.analysisExperimentPublications);
    const nextAuditEvents = new Map(this.auditEvents);
    identities.forEach((identity) => {
      const existing = nextIdentities.get(identity.id);
      if (existing && existing.projectId !== input.projectId) {
        throw Object.assign(new Error("Experiment identity belongs to another project."), {
          statusCode: 422,
          code: "identity_reuse_not_found",
        });
      }
      nextIdentities.set(identity.id, identity);
    });
    nextSnapshots.set(snapshot.id, snapshot);
    heads.forEach((head) => nextHeads.set(head.id, head));
    if (browserView.isDefault) {
      for (const [id, view] of nextViews) {
        if (
          view.projectId === browserView.projectId
          && view.ownerUserId === browserView.ownerUserId
          && view.isDefault
        ) {
          nextViews.set(id, { ...view, isDefault: false, updatedAt: browserView.createdAt });
        }
      }
    }
    nextViews.set(browserView.id, browserView);
    nextThreads.set(thread.id, copy(input.analysisThread));
    nextRuns.set(run.id, copy(input.analysisRun));
    nextResults.set(storedResult.id, copy(input.analysisResult));
    const response = { ...copy(input.response), idempotentReplay: false };
    nextPublications.set(publicationKey, {
      id: input.publicationId || makeId("analysis_experiment_publication"),
      labId: input.labId,
      projectId: input.projectId,
      analysisThreadId: thread.id,
      analysisResultId: storedResult.id,
      dataSnapshotId: snapshot.id,
      browserViewId: browserView.id,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      response,
      createdAt: snapshot.createdAt,
      createdBy: input.actorUserId,
    });
    asArray(input.auditEvents).forEach((auditInput) => {
      const event = {
        id: auditInput.id || makeId("audit"),
        labId: auditInput.labId || input.labId || null,
        projectId: auditInput.projectId || input.projectId,
        actorUserId: auditInput.actorUserId || input.actorUserId || null,
        action: auditInput.action,
        targetType: auditInput.targetType || null,
        targetId: auditInput.targetId || null,
        summary: auditInput.summary || null,
        metadata: copy(auditInput.metadata) || {},
        createdAt: auditInput.createdAt || snapshot.createdAt,
        ipAddress: auditInput.ipAddress || null,
        userAgent: auditInput.userAgent || null,
      };
      nextAuditEvents.set(event.id, event);
    });
    this.analysisThreads = nextThreads;
    this.analysisRuns = nextRuns;
    this.analysisResults = nextResults;
    this.dataSnapshots = nextSnapshots;
    this.experimentIdentities = nextIdentities;
    this.experimentSnapshotHeads = nextHeads;
    this.browserViews = nextViews;
    this.analysisExperimentPublications = nextPublications;
    this.auditEvents = nextAuditEvents;
    return copy(response);
  }

  async createChartSpec(input) {
    const createdAt = nowIso();
    const spec = {
      id: makeId("chart_spec"),
      labId: input.labId,
      projectId: input.projectId,
      analysisResultId: input.analysisResultId || null,
      title: input.title || null,
      chartType: input.chartType,
      spec: input.spec || {},
      layout: input.layout || {},
      warnings: input.warnings || [],
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.chartSpecs.set(spec.id, spec);
    return copy(spec);
  }

  async findChartSpecById(id) {
    return copy(this.chartSpecs.get(id) || null);
  }

  async listChartSpecs({ projectId }) {
    return [...this.chartSpecs.values()].filter((spec) => spec.projectId === projectId).map(copy);
  }

  async listManuscripts({ projectId }) {
    return [...this.manuscripts.values()].filter((item) => item.projectId === projectId).map(copy);
  }

  async createManuscript(input) {
    const createdAt = nowIso();
    const manuscript = {
      id: makeId("manuscript"),
      labId: input.labId,
      projectId: input.projectId,
      title: input.title,
      status: input.status || "draft",
      blocks: input.blocks || [],
      pages: input.pages || [],
      canvasState: input.canvasState || {},
      references: input.references || [],
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.manuscripts.set(manuscript.id, manuscript);
    return copy(manuscript);
  }

  async findManuscriptById(id) {
    return copy(this.manuscripts.get(id) || null);
  }

  async updateManuscript(id, changes) {
    const manuscript = this.manuscripts.get(id);
    if (!manuscript) return null;
    if (changes.title != null) manuscript.title = changes.title;
    if (changes.blocks != null) manuscript.blocks = copy(changes.blocks);
    if (changes.pages != null) manuscript.pages = copy(changes.pages);
    if (changes.canvasState != null) manuscript.canvasState = copy(changes.canvasState);
    if (changes.references != null) manuscript.references = copy(changes.references);
    manuscript.updatedAt = nowIso();
    manuscript.updatedBy = changes.updatedBy || manuscript.updatedBy;
    return copy(manuscript);
  }

  async recordAuditEvent(input) {
    const event = {
      id: makeId("audit"),
      labId: input.labId || null,
      projectId: input.projectId || null,
      actorUserId: input.actorUserId || null,
      action: input.action,
      targetType: input.targetType || null,
      targetId: input.targetId || null,
      summary: input.summary || null,
      metadata: input.metadata || {},
      createdAt: nowIso(),
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    };
    this.auditEvents.set(event.id, event);
    return copy(event);
  }

  async listAuditEvents(filter = {}) {
    return [...this.auditEvents.values()]
      .filter((event) => !filter.labId || event.labId === filter.labId)
      .filter((event) => !filter.projectId || event.projectId === filter.projectId)
      .map(copy);
  }
}
