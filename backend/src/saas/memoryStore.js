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

export class MemorySaasStore {
  constructor(options = {}) {
    this.users = new Map();
    this.labs = new Map();
    this.memberships = new Map();
    this.sessions = new Map();
    this.projects = new Map();
    this.fileObjects = new Map();
    this.importRuns = new Map();
    this.supplementalImportBatches = new Map();
    this.supplementalImportBatchItems = new Map();
    this.datasetCommits = new Map();
    this.observationSeries = new Map();
    this.mappingSets = new Map();
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
      currentDatasetCommitId: null,
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
    if (changes.currentDatasetCommitId !== undefined) project.currentDatasetCommitId = changes.currentDatasetCommitId;
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
      appliedDatasetCommitId: null,
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

  async createSupplementalImportBatch(input) {
    const createdAt = nowIso();
    const batch = {
      id: input.id || makeId("supplement_batch"),
      labId: input.labId,
      projectId: input.projectId,
      status: input.status || "queued",
      summary: copy(input.summary) || {},
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.supplementalImportBatches.set(batch.id, batch);
    for (const fileObject of input.fileObjects || []) {
      const item = {
        id: makeId("supplement_batch_item"),
        batchId: batch.id,
        labId: batch.labId,
        projectId: batch.projectId,
        fileObjectId: fileObject.id,
        importRunId: null,
        fileName: fileObject.originalName || fileObject.id,
        status: "queued",
        progressMessage: "Queued for supplemental relationship review.",
        summary: {},
        relationshipPreview: null,
        warnings: [],
        error: null,
        createdAt,
        updatedAt: createdAt,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      };
      this.supplementalImportBatchItems.set(item.id, item);
    }
    return this.findSupplementalImportBatchById(batch.id);
  }

  async findSupplementalImportBatchById(batchId) {
    const batch = this.supplementalImportBatches.get(batchId);
    if (!batch) return null;
    const items = [...this.supplementalImportBatchItems.values()]
      .filter((item) => item.batchId === batchId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(copy);
    return copy({ ...batch, items });
  }

  async listSupplementalImportBatches({ projectId }) {
    const batches = [...this.supplementalImportBatches.values()]
      .filter((batch) => batch.projectId === projectId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return Promise.all(batches.map((batch) => this.findSupplementalImportBatchById(batch.id)));
  }

  async updateSupplementalImportBatch(batchId, changes) {
    const batch = this.supplementalImportBatches.get(batchId);
    if (!batch) return null;
    if (changes.status != null) batch.status = String(changes.status);
    if (changes.summary != null) batch.summary = copy(changes.summary) || {};
    batch.updatedAt = nowIso();
    batch.updatedBy = changes.updatedBy || batch.updatedBy;
    return this.findSupplementalImportBatchById(batchId);
  }

  async updateSupplementalImportBatchItem(batchId, itemId, changes) {
    const item = this.supplementalImportBatchItems.get(itemId);
    if (!item || item.batchId !== batchId) return null;
    if (changes.importRunId !== undefined) item.importRunId = changes.importRunId || null;
    if (changes.status != null) item.status = String(changes.status);
    if (changes.progressMessage !== undefined) item.progressMessage = changes.progressMessage || null;
    if (changes.summary != null) item.summary = copy(changes.summary) || {};
    if (changes.relationshipPreview !== undefined) item.relationshipPreview = copy(changes.relationshipPreview) || null;
    if (changes.warnings != null) item.warnings = copy(changes.warnings) || [];
    if (changes.error !== undefined) item.error = copy(changes.error) || null;
    item.updatedAt = nowIso();
    item.updatedBy = changes.updatedBy || item.updatedBy;
    return copy(item);
  }

  async createDatasetCommit(input) {
    const commit = {
      id: makeId("commit"),
      labId: input.labId,
      projectId: input.projectId,
      parentCommitId: input.parentCommitId || null,
      sourceImportRunIds: input.sourceImportRunIds || [],
      sourceMappingSetIds: input.sourceMappingSetIds || [],
      datasetPayload: input.datasetPayload || {},
      summary: input.summary || {},
      warnings: input.warnings || [],
      createdAt: nowIso(),
      createdBy: input.createdBy,
    };
    this.datasetCommits.set(commit.id, commit);
    const project = this.projects.get(commit.projectId);
    if (project) {
      project.currentDatasetCommitId = commit.id;
      project.updatedAt = nowIso();
      project.updatedBy = input.createdBy;
    }
    return copy(commit);
  }

  async findDatasetCommitById(commitId) {
    return copy(this.datasetCommits.get(commitId) || null);
  }

  async listDatasetCommits({ projectId }) {
    return [...this.datasetCommits.values()]
      .filter((commit) => commit.projectId === projectId)
      .map(copy);
  }

  async replaceObservationSeriesForDatasetCommit(input) {
    const createdAt = nowIso();
    for (const [id, series] of this.observationSeries.entries()) {
      if (series.projectId === input.projectId && series.datasetCommitId === input.datasetCommitId) {
        this.observationSeries.delete(id);
      }
    }
    for (const item of input.series || []) {
      const id = item.id || makeId("observation_series");
      const series = {
        ...copy(item),
        id,
        seriesId: item.seriesId || id,
        labId: item.labId || input.labId,
        projectId: item.projectId || input.projectId,
        datasetCommitId: item.datasetCommitId || input.datasetCommitId,
        status: item.status || "active",
        createdAt,
        updatedAt: createdAt,
        createdBy: input.updatedBy,
        updatedBy: input.updatedBy,
      };
      this.observationSeries.set(id, series);
    }
    return this.listObservationSeries({ projectId: input.projectId });
  }

  async listObservationSeries({ projectId }) {
    return [...this.observationSeries.values()]
      .filter((series) => series.projectId === projectId)
      .map(copy);
  }

  async createMappingSet(input) {
    const createdAt = nowIso();
    const set = {
      id: input.id || makeId("mapping_set"),
      labId: input.labId,
      projectId: input.projectId,
      importRunId: input.importRunId || null,
      datasetCommitId: input.datasetCommitId || null,
      schemaVersion: input.schemaVersion || "labrat.semanticMappingResponse.v1",
      status: input.status || "proposed",
      payload: copy(input.payload) || {},
      decisionSummary: copy(input.decisionSummary) || {},
      createdAt,
      updatedAt: createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };
    this.mappingSets.set(set.id, set);
    return copy(set);
  }

  async findMappingSetById(id) {
    return copy(this.mappingSets.get(id) || null);
  }

  async listMappingSets({ projectId }) {
    return [...this.mappingSets.values()]
      .filter((set) => set.projectId === projectId)
      .map(copy);
  }

  async updateMappingSet(id, changes) {
    const set = this.mappingSets.get(id);
    if (!set) return null;
    if (changes.status != null) set.status = String(changes.status);
    if (changes.payload != null) set.payload = copy(changes.payload) || {};
    if (changes.decisionSummary != null) set.decisionSummary = copy(changes.decisionSummary) || {};
    set.updatedAt = nowIso();
    set.updatedBy = changes.updatedBy || set.updatedBy;
    return copy(set);
  }

  async createChartProposalSet(input) {
    const createdAt = nowIso();
    const set = {
      id: input.id || makeId("chart_proposal_set"),
      labId: input.labId,
      projectId: input.projectId,
      datasetCommitId: input.datasetCommitId || null,
      mappingSetId: input.mappingSetId || null,
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
      datasetCommitId: input.datasetCommitId || null,
      mappingSetId: input.mappingSetId || null,
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
