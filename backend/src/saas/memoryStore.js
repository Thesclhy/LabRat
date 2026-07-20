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
    this.sourceExtractProposals = new Map();
    this.workbookReviewSessions = new Map();
    this.workbookUnderstandings = new Map();
    this.dataPlans = new Map();
    this.dataSnapshots = new Map();
    this.experimentIdentities = new Map();
    this.experimentSnapshotHeads = new Map();
    this.experimentSnapshotPublishes = new Map();
    this.browserViews = new Map();
    this.agentRuns = new Map();
    this.analysisThreads = new Map();
    this.analysisPlanRevisions = new Map();
    this.analysisRuns = new Map();
    this.analysisResults = new Map();
    this.analysisPublications = new Map();
    this.chartProposalSets = new Map();
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
      currentUnderstanding: copy(input.currentUnderstanding) || {},
      regions: copy(input.regions) || [],
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
      ...copy(patch),
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

  async listWorkbookReviewSessions({ projectId }) {
    return [...this.workbookReviewSessions.values()]
      .filter((session) => session.projectId === projectId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(copy);
  }

  async createWorkbookUnderstanding(input) {
    const createdAt = nowIso();
    const understanding = {
      id: input.id || makeId("workbook_understanding"),
      labId: input.labId,
      projectId: input.projectId,
      sourceDocumentId: input.sourceDocumentId,
      workbookReviewSessionId: input.workbookReviewSessionId,
      schemaVersion: input.schemaVersion || "labrat.workbookUnderstanding.v1",
      status: input.status || "accepted",
      version: input.version || 1,
      understanding: copy(input.understanding) || {},
      facts: copy(input.facts) || [],
      regionSummaries: copy(input.regionSummaries) || [],
      warnings: copy(input.warnings) || [],
      decisionSummary: copy(input.decisionSummary) || {},
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.workbookUnderstandings.set(understanding.id, understanding);
    return copy(understanding);
  }

  async listWorkbookUnderstandings({ projectId }) {
    return [...this.workbookUnderstandings.values()]
      .filter((understanding) => understanding.projectId === projectId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(copy);
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

  async createSourceExtractProposal(input) {
    const createdAt = nowIso();
    const proposal = {
      id: input.id || makeId("source_extract_proposal"),
      labId: input.labId,
      projectId: input.projectId,
      sourceDocumentId: input.sourceDocumentId || null,
      sourceRegionId: input.sourceRegionId || null,
      schemaVersion: input.schemaVersion || "labrat.sourceExtractProposal.v1",
      status: input.status || "proposed",
      purpose: input.purpose || null,
      extractType: input.extractType || null,
      intent: copy(input.intent) || {},
      preview: copy(input.preview) || {},
      warnings: copy(input.warnings) || [],
      decisionSummary: copy(input.decisionSummary) || {},
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.sourceExtractProposals.set(proposal.id, proposal);
    return copy(proposal);
  }

  async findSourceExtractProposalById(id) {
    return copy(this.sourceExtractProposals.get(id) || null);
  }

  async listSourceExtractProposals({ projectId }) {
    return [...this.sourceExtractProposals.values()]
      .filter((proposal) => proposal.projectId === projectId)
      .map(copy);
  }

  async updateSourceExtractProposal(id, changes) {
    const proposal = this.sourceExtractProposals.get(id);
    if (!proposal) return null;
    if (changes.status != null) proposal.status = String(changes.status);
    if (changes.intent != null) proposal.intent = copy(changes.intent) || {};
    if (changes.preview != null) proposal.preview = copy(changes.preview) || {};
    if (changes.warnings != null) proposal.warnings = copy(changes.warnings) || [];
    if (changes.decisionSummary != null) proposal.decisionSummary = copy(changes.decisionSummary) || {};
    proposal.updatedAt = nowIso();
    proposal.updatedBy = changes.updatedBy || proposal.updatedBy;
    return copy(proposal);
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
      originalRequest: String(input.originalRequest || ""),
      messages: copy(input.messages) || [],
      planRevisionIds: copy(input.planRevisionIds) || [],
      analysisRunIds: copy(input.analysisRunIds) || [],
      acceptedAnalysisResultIds: copy(input.acceptedAnalysisResultIds) || [],
      chartSpecIds: copy(input.chartSpecIds) || [],
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
    if (changes.messages != null) thread.messages = copy(changes.messages) || [];
    if (changes.planRevisionIds != null) thread.planRevisionIds = copy(changes.planRevisionIds) || [];
    if (changes.analysisRunIds != null) thread.analysisRunIds = copy(changes.analysisRunIds) || [];
    if (changes.acceptedAnalysisResultIds != null) {
      thread.acceptedAnalysisResultIds = copy(changes.acceptedAnalysisResultIds) || [];
    }
    if (changes.chartSpecIds != null) thread.chartSpecIds = copy(changes.chartSpecIds) || [];
    thread.updatedAt = changes.updatedAt || nowIso();
    thread.updatedBy = changes.updatedBy || thread.updatedBy;
    return copy(thread);
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
    const result = copy(input.analysisResult);
    const chartSpec = copy(input.chartSpec);
    const analysisRun = this.analysisRuns.get(result?.analysisRunId);
    if (
      !input.idempotencyKey
      || !input.requestHash
      || !thread
      || thread.projectId !== input.projectId
      || !result?.id
      || result.projectId !== input.projectId
      || result.analysisThreadId !== thread.id
      || !analysisRun
      || analysisRun.projectId !== input.projectId
      || analysisRun.analysisThreadId !== thread.id
      || !chartSpec?.id
      || chartSpec.projectId !== input.projectId
      || chartSpec.analysisResultId !== result.id
      || this.analysisResults.has(result.id)
      || this.chartSpecs.has(chartSpec.id)
    ) {
      throw Object.assign(new Error("The analysis result publication package is invalid."), {
        statusCode: 400,
        code: "invalid_analysis_publication_package",
      });
    }
    const nextThreads = new Map(this.analysisThreads);
    const nextResults = new Map(this.analysisResults);
    const nextChartSpecs = new Map(this.chartSpecs);
    const nextPublications = new Map(this.analysisPublications);
    const nextAuditEvents = new Map(this.auditEvents);
    const createdAt = result.acceptedAt || result.createdAt || nowIso();
    const updatedThread = {
      ...copy(thread),
      status: "completed",
      acceptedAnalysisResultIds: [
        ...asArray(thread.acceptedAnalysisResultIds),
        result.id,
      ],
      chartSpecIds: [...asArray(thread.chartSpecIds), chartSpec.id],
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
    nextResults.set(result.id, result);
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
    this.analysisResults = nextResults;
    this.chartSpecs = nextChartSpecs;
    this.analysisPublications = nextPublications;
    this.auditEvents = nextAuditEvents;
    return copy(response);
  }

  async createChartProposalSet(input) {
    const createdAt = nowIso();
    const set = {
      id: input.id || makeId("chart_proposal_set"),
      labId: input.labId,
      projectId: input.projectId,
      schemaVersion: input.schemaVersion || "labrat.chartProposalSet.v1",
      status: input.status || "proposed",
      payload: input.payload || {},
      decisionSummary: input.decisionSummary || {},
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.chartProposalSets.set(set.id, set);
    return copy(set);
  }

  async findChartProposalSetById(id) {
    return copy(this.chartProposalSets.get(id) || null);
  }

  async listChartProposalSets({ projectId }) {
    return [...this.chartProposalSets.values()]
      .filter((set) => set.projectId === projectId)
      .map(copy);
  }

  async updateChartProposalSet(id, changes) {
    const set = this.chartProposalSets.get(id);
    if (!set) return null;
    if (changes.status != null) set.status = String(changes.status);
    if (changes.payload != null) set.payload = copy(changes.payload) || {};
    if (changes.decisionSummary != null) set.decisionSummary = copy(changes.decisionSummary) || {};
    set.updatedAt = nowIso();
    set.updatedBy = changes.updatedBy || set.updatedBy;
    return copy(set);
  }

  async createChartSpec(input) {
    const createdAt = nowIso();
    const spec = {
      id: makeId("chart_spec"),
      labId: input.labId,
      projectId: input.projectId,
      sourceChartProposalSetId: input.sourceChartProposalSetId || null,
      sourceProposalId: input.sourceProposalId || null,
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
