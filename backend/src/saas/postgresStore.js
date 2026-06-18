import { hashPassword } from "./passwords.js";
import { makeId } from "./ids.js";

function nowIso() {
  return new Date().toISOString();
}

function jsonb(value, fallback = {}) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function nullableJsonb(value) {
  return value == null ? null : JSON.stringify(value);
}

function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    isActive: row.is_active,
    isSuperAdmin: row.is_super_admin,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function labFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    settings: row.settings || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function membershipFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function projectFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    name: row.name,
    description: row.description,
    status: row.status,
    currentDatasetCommitId: row.current_dataset_commit_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function fileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    extension: row.extension,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function importRunFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    fileObjectId: row.file_object_id,
    status: row.status,
    scanResult: row.scan_result,
    normalizePreview: row.normalize_preview,
    reviewDecisions: row.review_decisions || {},
    warnings: row.warnings || [],
    error: row.error,
    appliedDatasetCommitId: row.applied_dataset_commit_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function supplementalImportBatchFromRow(row, items = []) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    status: row.status,
    summary: row.summary || {},
    items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function supplementalImportBatchItemFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id,
    labId: row.lab_id,
    projectId: row.project_id,
    fileObjectId: row.file_object_id,
    importRunId: row.import_run_id,
    fileName: row.file_name,
    status: row.status,
    progressMessage: row.progress_message,
    summary: row.summary || {},
    relationshipPreview: row.relationship_preview,
    warnings: row.warnings || [],
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function datasetCommitFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    parentCommitId: row.parent_commit_id,
    sourceImportRunIds: row.source_import_run_ids || [],
    sourceMappingSetIds: row.source_mapping_set_ids || [],
    datasetPayload: row.dataset_payload || {},
    summary: row.summary || {},
    warnings: row.warnings || [],
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mappingSetFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    importRunId: row.import_run_id,
    datasetCommitId: row.dataset_commit_id,
    schemaVersion: row.schema_version,
    status: row.status,
    payload: row.payload || {},
    decisionSummary: row.decision_summary || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function chartProposalSetFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    datasetCommitId: row.dataset_commit_id,
    mappingSetId: row.mapping_set_id,
    schemaVersion: row.schema_version,
    status: row.status,
    payload: row.payload || {},
    decisionSummary: row.decision_summary || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function chartSpecFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    datasetCommitId: row.dataset_commit_id,
    mappingSetId: row.mapping_set_id,
    sourceChartProposalSetId: row.source_chart_proposal_set_id,
    sourceProposalId: row.source_proposal_id,
    title: row.title,
    chartType: row.chart_type,
    spec: row.spec || {},
    layout: row.layout || {},
    warnings: row.warnings || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function manuscriptFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labId: row.lab_id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    blocks: row.blocks || [],
    pages: row.pages || [],
    canvasState: row.canvas_state || {},
    references: row.references_payload || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export class PostgresSaasStore {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  async initialize() {
    const { Pool } = await import("pg");
    this.pool = new Pool({ connectionString: this.config.databaseUrl });
    if (this.config.seedDevAccounts) {
      await this.seedDevAccounts();
    }
  }

  async query(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result;
  }

  async seedDevAccounts() {
    const existing = await this.query("select count(*)::int as count from users");
    if (existing.rows[0]?.count) return;
    const createdAt = nowIso();
    await this.query(
      `insert into labs (id, name, slug, status, settings, created_at, updated_at)
       values ($1, $2, $3, 'active', '{}', $4, $4)`,
      ["lab_hanqi_test", "Hanqi Test Lab", "hanqi-test-lab", createdAt],
    );
    await this.query(
      `insert into users (id, username, display_name, password_hash, is_active, is_super_admin, created_at, updated_at)
       values ($1, $2, $3, $4, true, true, $5, $5)`,
      ["user_admin", "admin", "LabRat Super Admin", hashPassword("LabRatAdmin123!"), createdAt],
    );
    await this.query(
      `insert into users (id, username, display_name, password_hash, is_active, is_super_admin, created_at, updated_at, created_by)
       values ($1, $2, $3, $4, true, false, $5, $5, $6)`,
      ["user_labuser", "labuser", "Hanqi Test Lab Owner", hashPassword("LabRatLab123!"), createdAt, "user_admin"],
    );
    await this.query(
      `insert into lab_memberships (id, lab_id, user_id, role, status, created_at, updated_at, created_by)
       values ($1, $2, $3, 'lab_owner', 'active', $4, $4, $5)`,
      ["membership_hanqi_owner", "lab_hanqi_test", "user_labuser", createdAt, "user_admin"],
    );
  }

  async findUserByUsername(username) {
    const result = await this.query("select * from users where username = $1", [username]);
    return userFromRow(result.rows[0]);
  }

  async findUserById(userId) {
    const result = await this.query("select * from users where id = $1", [userId]);
    return userFromRow(result.rows[0]);
  }

  async createSession({ userId, tokenHash, expiresAt, ipAddress, userAgent }) {
    const session = {
      id: makeId("session"),
      userId,
      tokenHash,
      expiresAt,
      createdAt: nowIso(),
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    };
    const result = await this.query(
      `insert into sessions (id, user_id, session_token_hash, expires_at, created_at, last_seen_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, $5, $6, $7)
       returning *`,
      [session.id, userId, tokenHash, expiresAt, session.createdAt, session.ipAddress, session.userAgent],
    );
    return {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      sessionTokenHash: result.rows[0].session_token_hash,
      expiresAt: result.rows[0].expires_at,
      createdAt: result.rows[0].created_at,
      revokedAt: result.rows[0].revoked_at,
    };
  }

  async findSessionByTokenHash(tokenHash) {
    const result = await this.query(
      `update sessions set last_seen_at = now()
       where session_token_hash = $1 and revoked_at is null
       returning *`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      userId: row.user_id,
      sessionTokenHash: row.session_token_hash,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    } : null;
  }

  async revokeSession(sessionId) {
    await this.query("update sessions set revoked_at = now() where id = $1", [sessionId]);
  }

  async listLabsForUser(userId) {
    const user = await this.findUserById(userId);
    if (!user) return [];
    if (user.isSuperAdmin) {
      const labs = await this.query("select * from labs where status = 'active' order by name");
      return labs.rows.map((lab) => ({ labId: lab.id, name: lab.name, slug: lab.slug, role: "super_admin" }));
    }
    const result = await this.query(
      `select l.id as lab_id, l.name, l.slug, m.role
       from lab_memberships m
       join labs l on l.id = m.lab_id
       where m.user_id = $1 and m.status = 'active' and l.status = 'active'
       order by l.name`,
      [userId],
    );
    return result.rows.map((row) => ({ labId: row.lab_id, name: row.name, slug: row.slug, role: row.role }));
  }

  async listLabs() {
    const result = await this.query("select * from labs order by name");
    return result.rows.map(labFromRow);
  }

  async createLab({ name, slug, createdBy }) {
    const result = await this.query(
      `insert into labs (id, name, slug, status, settings, created_at, updated_at, created_by)
       values ($1, $2, $3, 'active', '{}', now(), now(), $4)
       returning *`,
      [makeId("lab"), name, slug, createdBy],
    );
    return labFromRow(result.rows[0]);
  }

  async listUsers(filter = {}) {
    const result = filter.labId
      ? await this.query(
        `select u.* from users u
         left join lab_memberships m on m.user_id = u.id
         where m.lab_id = $1 or u.is_super_admin = true
         order by u.username`,
        [filter.labId],
      )
      : await this.query("select * from users order by username");
    return Promise.all(result.rows.map(async (row) => {
      const memberships = await this.query("select * from lab_memberships where user_id = $1", [row.id]);
      return {
        ...userFromRow(row),
        memberships: memberships.rows.map(membershipFromRow),
      };
    }));
  }

  async createUser({ username, displayName, temporaryPassword, isSuperAdmin = false, labId = null, role = null, createdBy = null }) {
    const id = makeId("user");
    const result = await this.query(
      `insert into users (id, username, display_name, password_hash, is_active, is_super_admin, created_at, updated_at, created_by)
       values ($1, $2, $3, $4, true, $5, now(), now(), $6)
       returning *`,
      [id, username, displayName, hashPassword(temporaryPassword), Boolean(isSuperAdmin), createdBy],
    );
    let membership = null;
    if (labId && role) {
      const memberResult = await this.query(
        `insert into lab_memberships (id, lab_id, user_id, role, status, created_at, updated_at, created_by)
         values ($1, $2, $3, $4, 'active', now(), now(), $5)
         returning *`,
        [makeId("membership"), labId, id, role, createdBy],
      );
      membership = membershipFromRow(memberResult.rows[0]);
    }
    return { user: userFromRow(result.rows[0]), membership };
  }

  async updateUser(userId, changes) {
    const result = await this.query(
      `update users
       set display_name = coalesce($2, display_name),
           is_active = coalesce($3, is_active),
           is_super_admin = coalesce($4, is_super_admin),
           updated_at = now()
       where id = $1
       returning *`,
      [userId, changes.displayName ?? null, changes.isActive ?? null, changes.isSuperAdmin ?? null],
    );
    if (Array.isArray(changes.memberships)) {
      for (const membership of changes.memberships) {
        await this.query(
          `insert into lab_memberships (id, lab_id, user_id, role, status, created_at, updated_at, created_by)
           values ($1, $2, $3, $4, coalesce($5, 'active'), now(), now(), $6)
           on conflict (lab_id, user_id)
           do update set role = excluded.role, status = excluded.status, updated_at = now()`,
          [makeId("membership"), membership.labId, userId, membership.role, membership.status || "active", changes.updatedBy || null],
        );
      }
    }
    return userFromRow(result.rows[0]);
  }

  async resetPassword(userId, temporaryPassword) {
    const result = await this.query(
      "update users set password_hash = $2, updated_at = now() where id = $1 returning *",
      [userId, hashPassword(temporaryPassword)],
    );
    return userFromRow(result.rows[0]);
  }

  async listProjects({ labId }) {
    const result = await this.query("select * from projects where lab_id = $1 order by updated_at desc", [labId]);
    return result.rows.map(projectFromRow);
  }

  async createProject({ labId, name, description = "", metadata = {}, createdBy }) {
    const result = await this.query(
      `insert into projects (id, lab_id, name, description, status, metadata, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, 'active', $5, now(), now(), $6, $6)
       returning *`,
      [makeId("project"), labId, name, description, jsonb(metadata || {}), createdBy],
    );
    return projectFromRow(result.rows[0]);
  }

  async findProjectById(projectId) {
    const result = await this.query("select * from projects where id = $1", [projectId]);
    return projectFromRow(result.rows[0]);
  }

  async updateProject(projectId, changes) {
    const current = await this.findProjectById(projectId);
    if (!current) return null;
    const result = await this.query(
      `update projects
       set name = $2,
           description = $3,
           status = $4,
           metadata = $5,
           current_dataset_commit_id = $6,
           updated_by = coalesce($7, updated_by),
           updated_at = now()
       where id = $1
       returning *`,
      [
        projectId,
        changes.name ?? current.name,
        changes.description ?? current.description,
        changes.status ?? current.status,
        jsonb(changes.metadata ?? current.metadata ?? {}),
        changes.currentDatasetCommitId !== undefined ? changes.currentDatasetCommitId : current.currentDatasetCommitId,
        changes.updatedBy ?? null,
      ],
    );
    return projectFromRow(result.rows[0]);
  }

  async createFileObject(input) {
    const result = await this.query(
      `insert into file_objects
       (id, lab_id, project_id, original_name, mime_type, extension, size_bytes, checksum_sha256, storage_provider, storage_key, metadata, created_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)
       returning *`,
      [
        input.id || makeId("file"),
        input.labId,
        input.projectId,
        input.originalName,
        input.mimeType || null,
        input.extension || null,
        input.sizeBytes,
        input.checksumSha256,
        input.storageProvider || "local",
        input.storageKey || null,
        jsonb(input.metadata || {}),
        input.createdBy,
      ],
    );
    return fileFromRow(result.rows[0]);
  }

  async findFileObjectById(fileObjectId) {
    const result = await this.query("select * from file_objects where id = $1", [fileObjectId]);
    return fileFromRow(result.rows[0]);
  }

  async findFileObjectByProjectChecksumName({ projectId, checksumSha256, originalName }) {
    const result = await this.query(
      `select * from file_objects
       where project_id = $1
         and checksum_sha256 = $2
         and original_name = $3
       limit 1`,
      [projectId, checksumSha256, originalName],
    );
    return fileFromRow(result.rows[0]);
  }

  async listFileObjects({ projectId }) {
    const result = await this.query("select * from file_objects where project_id = $1 order by created_at desc", [projectId]);
    return result.rows.map(fileFromRow);
  }

  async createImportRun(input) {
    const result = await this.query(
      `insert into import_runs
       (id, lab_id, project_id, file_object_id, status, scan_result, warnings, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8, $8)
       returning *`,
      [
        makeId("import_run"),
        input.labId,
        input.projectId,
        input.fileObjectId || null,
        input.status || "uploaded",
        nullableJsonb(input.scanResult),
        jsonb(input.warnings || [], []),
        input.createdBy,
      ],
    );
    return importRunFromRow(result.rows[0]);
  }

  async findImportRunById(importRunId) {
    const result = await this.query("select * from import_runs where id = $1", [importRunId]);
    return importRunFromRow(result.rows[0]);
  }

  async listImportRuns({ projectId }) {
    const result = await this.query("select * from import_runs where project_id = $1 order by updated_at desc", [projectId]);
    return result.rows.map(importRunFromRow);
  }

  async updateImportRun(importRunId, changes) {
    const current = await this.findImportRunById(importRunId);
    if (!current) return null;
    const result = await this.query(
      `update import_runs
       set status = $2, normalize_preview = $3, review_decisions = $4, warnings = $5,
           error = $6, applied_dataset_commit_id = $7, updated_by = coalesce($8, updated_by), updated_at = now()
       where id = $1
       returning *`,
      [
        importRunId,
        changes.status || current.status,
        nullableJsonb(changes.normalizePreview ?? current.normalizePreview),
        jsonb(changes.reviewDecisions ?? current.reviewDecisions ?? {}),
        jsonb(changes.warnings ?? current.warnings ?? [], []),
        nullableJsonb(changes.error ?? current.error),
        changes.appliedDatasetCommitId ?? current.appliedDatasetCommitId,
        changes.updatedBy || null,
      ],
    );
    return importRunFromRow(result.rows[0]);
  }

  async createSupplementalImportBatch(input) {
    const batchId = input.id || makeId("supplement_batch");
    await this.query(
      `insert into supplemental_import_batches
       (id, lab_id, project_id, status, summary, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, now(), now(), $6, $6)`,
      [
        batchId,
        input.labId,
        input.projectId,
        input.status || "queued",
        jsonb(input.summary || {}),
        input.createdBy,
      ],
    );
    for (const fileObject of input.fileObjects || []) {
      await this.query(
        `insert into supplemental_import_batch_items
         (id, batch_id, lab_id, project_id, file_object_id, import_run_id, file_name, status, progress_message, summary, relationship_preview, warnings, error, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, null, $6, 'queued', $7, '{}', null, '[]', null, now(), now(), $8, $8)`,
        [
          makeId("supplement_batch_item"),
          batchId,
          input.labId,
          input.projectId,
          fileObject.id,
          fileObject.originalName || fileObject.id,
          "Queued for supplemental relationship review.",
          input.createdBy,
        ],
      );
    }
    return this.findSupplementalImportBatchById(batchId);
  }

  async findSupplementalImportBatchById(batchId) {
    const batchResult = await this.query("select * from supplemental_import_batches where id = $1", [batchId]);
    const batch = batchResult.rows[0];
    if (!batch) return null;
    const itemResult = await this.query(
      "select * from supplemental_import_batch_items where batch_id = $1 order by created_at asc",
      [batchId],
    );
    return supplementalImportBatchFromRow(batch, itemResult.rows.map(supplementalImportBatchItemFromRow));
  }

  async listSupplementalImportBatches({ projectId }) {
    const result = await this.query(
      "select * from supplemental_import_batches where project_id = $1 order by updated_at desc",
      [projectId],
    );
    const batches = [];
    for (const row of result.rows) {
      batches.push(await this.findSupplementalImportBatchById(row.id));
    }
    return batches;
  }

  async updateSupplementalImportBatch(batchId, changes) {
    const current = await this.findSupplementalImportBatchById(batchId);
    if (!current) return null;
    const result = await this.query(
      `update supplemental_import_batches
       set status = $2,
           summary = $3,
           updated_by = coalesce($4, updated_by),
           updated_at = now()
       where id = $1
       returning *`,
      [
        batchId,
        changes.status ?? current.status,
        jsonb(changes.summary ?? current.summary ?? {}),
        changes.updatedBy || null,
      ],
    );
    return this.findSupplementalImportBatchById(result.rows[0].id);
  }

  async updateSupplementalImportBatchItem(batchId, itemId, changes) {
    const currentBatch = await this.findSupplementalImportBatchById(batchId);
    const current = currentBatch?.items?.find((item) => item.id === itemId);
    if (!current) return null;
    const result = await this.query(
      `update supplemental_import_batch_items
       set import_run_id = $3,
           status = $4,
           progress_message = $5,
           summary = $6,
           relationship_preview = $7,
           warnings = $8,
           error = $9,
           updated_by = coalesce($10, updated_by),
           updated_at = now()
       where batch_id = $1 and id = $2
       returning *`,
      [
        batchId,
        itemId,
        changes.importRunId !== undefined ? changes.importRunId || null : current.importRunId,
        changes.status ?? current.status,
        changes.progressMessage !== undefined ? changes.progressMessage || null : current.progressMessage,
        jsonb(changes.summary ?? current.summary ?? {}),
        nullableJsonb(changes.relationshipPreview !== undefined ? changes.relationshipPreview : current.relationshipPreview),
        jsonb(changes.warnings ?? current.warnings ?? [], []),
        nullableJsonb(changes.error !== undefined ? changes.error : current.error),
        changes.updatedBy || null,
      ],
    );
    return supplementalImportBatchItemFromRow(result.rows[0]);
  }

  async createDatasetCommit(input) {
    const result = await this.query(
      `insert into dataset_commits
       (id, lab_id, project_id, parent_commit_id, source_import_run_ids, source_mapping_set_ids, dataset_payload, summary, warnings, created_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
       returning *`,
      [
        makeId("commit"),
        input.labId,
        input.projectId,
        input.parentCommitId || null,
        jsonb(input.sourceImportRunIds || [], []),
        jsonb(input.sourceMappingSetIds || [], []),
        jsonb(input.datasetPayload || {}),
        jsonb(input.summary || {}),
        jsonb(input.warnings || [], []),
        input.createdBy,
      ],
    );
    await this.updateProject(input.projectId, { currentDatasetCommitId: result.rows[0].id, updatedBy: input.createdBy });
    return datasetCommitFromRow(result.rows[0]);
  }

  async findDatasetCommitById(commitId) {
    const result = await this.query("select * from dataset_commits where id = $1", [commitId]);
    return datasetCommitFromRow(result.rows[0]);
  }

  async listDatasetCommits({ projectId }) {
    const result = await this.query("select * from dataset_commits where project_id = $1 order by created_at desc", [projectId]);
    return result.rows.map(datasetCommitFromRow);
  }

  async createMappingSet(input) {
    const result = await this.query(
      `insert into mapping_sets
       (id, lab_id, project_id, import_run_id, dataset_commit_id, schema_version, status, payload, decision_summary, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10, $10)
       returning *`,
      [
        input.id || makeId("mapping_set"),
        input.labId,
        input.projectId,
        input.importRunId || null,
        input.datasetCommitId || null,
        input.schemaVersion || "labrat.semanticMappingResponse.v1",
        input.status || "proposed",
        jsonb(input.payload || {}),
        jsonb(input.decisionSummary || {}),
        input.createdBy,
      ],
    );
    return mappingSetFromRow(result.rows[0]);
  }

  async findMappingSetById(id) {
    const result = await this.query("select * from mapping_sets where id = $1", [id]);
    return mappingSetFromRow(result.rows[0]);
  }

  async listMappingSets({ projectId }) {
    const result = await this.query("select * from mapping_sets where project_id = $1 order by updated_at desc", [projectId]);
    return result.rows.map(mappingSetFromRow);
  }

  async updateMappingSet(id, changes) {
    const current = await this.findMappingSetById(id);
    if (!current) return null;
    const result = await this.query(
      `update mapping_sets
       set status = $2,
           payload = $3,
           decision_summary = $4,
           updated_by = coalesce($5, updated_by),
           updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        changes.status ?? current.status,
        jsonb(changes.payload ?? current.payload ?? {}),
        jsonb(changes.decisionSummary ?? current.decisionSummary ?? {}),
        changes.updatedBy || null,
      ],
    );
    return mappingSetFromRow(result.rows[0]);
  }

  async createChartProposalSet(input) {
    const result = await this.query(
      `insert into chart_proposal_sets
       (id, lab_id, project_id, dataset_commit_id, mapping_set_id, schema_version, status, payload, decision_summary, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10, $10)
       returning *`,
      [
        input.id || makeId("chart_proposal_set"),
        input.labId,
        input.projectId,
        input.datasetCommitId || null,
        input.mappingSetId || null,
        input.schemaVersion || "labrat.chartProposalSet.v1",
        input.status || "proposed",
        jsonb(input.payload || {}),
        jsonb(input.decisionSummary || {}),
        input.createdBy,
      ],
    );
    return chartProposalSetFromRow(result.rows[0]);
  }

  async findChartProposalSetById(id) {
    const result = await this.query("select * from chart_proposal_sets where id = $1", [id]);
    return chartProposalSetFromRow(result.rows[0]);
  }

  async listChartProposalSets({ projectId }) {
    const result = await this.query("select * from chart_proposal_sets where project_id = $1 order by updated_at desc", [projectId]);
    return result.rows.map(chartProposalSetFromRow);
  }

  async updateChartProposalSet(id, changes) {
    const current = await this.findChartProposalSetById(id);
    if (!current) return null;
    const result = await this.query(
      `update chart_proposal_sets
       set status = $2,
           payload = $3,
           decision_summary = $4,
           updated_by = coalesce($5, updated_by),
           updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        changes.status ?? current.status,
        jsonb(changes.payload ?? current.payload ?? {}),
        jsonb(changes.decisionSummary ?? current.decisionSummary ?? {}),
        changes.updatedBy || null,
      ],
    );
    return chartProposalSetFromRow(result.rows[0]);
  }

  async createChartSpec(input) {
    const result = await this.query(
      `insert into chart_specs
       (id, lab_id, project_id, dataset_commit_id, mapping_set_id, source_chart_proposal_set_id, source_proposal_id, title, chart_type, spec, layout, warnings, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now(), $13, $13)
       returning *`,
      [
        makeId("chart_spec"),
        input.labId,
        input.projectId,
        input.datasetCommitId || null,
        input.mappingSetId || null,
        input.sourceChartProposalSetId || null,
        input.sourceProposalId || null,
        input.title || null,
        input.chartType,
        jsonb(input.spec || {}),
        jsonb(input.layout || {}),
        jsonb(input.warnings || [], []),
        input.createdBy,
      ],
    );
    return chartSpecFromRow(result.rows[0]);
  }

  async listChartSpecs({ projectId }) {
    const result = await this.query("select * from chart_specs where project_id = $1 order by updated_at desc", [projectId]);
    return result.rows.map(chartSpecFromRow);
  }

  async listManuscripts({ projectId }) {
    const result = await this.query("select * from manuscripts where project_id = $1 order by updated_at desc", [projectId]);
    return result.rows.map(manuscriptFromRow);
  }

  async createManuscript(input) {
    const result = await this.query(
      `insert into manuscripts
       (id, lab_id, project_id, title, status, blocks, pages, canvas_state, references_payload, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, coalesce($5, 'draft'), $6, $7, $8, $9, now(), now(), $10, $10)
       returning *`,
      [
        makeId("manuscript"),
        input.labId,
        input.projectId,
        input.title,
        input.status || "draft",
        jsonb(input.blocks || [], []),
        jsonb(input.pages || [], []),
        jsonb(input.canvasState || {}),
        jsonb(input.references || [], []),
        input.createdBy,
      ],
    );
    return manuscriptFromRow(result.rows[0]);
  }

  async findManuscriptById(id) {
    const result = await this.query("select * from manuscripts where id = $1", [id]);
    return manuscriptFromRow(result.rows[0]);
  }

  async updateManuscript(id, changes) {
    const current = await this.findManuscriptById(id);
    if (!current) return null;
    const result = await this.query(
      `update manuscripts
       set title = coalesce($2, title),
           blocks = $3,
           pages = $4,
           canvas_state = $5,
           references_payload = $6,
           updated_by = coalesce($7, updated_by),
           updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        changes.title ?? null,
        jsonb(changes.blocks ?? current.blocks ?? [], []),
        jsonb(changes.pages ?? current.pages ?? [], []),
        jsonb(changes.canvasState ?? current.canvasState ?? {}),
        jsonb(changes.references ?? current.references ?? [], []),
        changes.updatedBy || null,
      ],
    );
    return manuscriptFromRow(result.rows[0]);
  }

  async recordAuditEvent(input) {
    const result = await this.query(
      `insert into audit_events
       (id, lab_id, project_id, actor_user_id, action, target_type, target_id, summary, metadata, created_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11)
       returning *`,
      [
        makeId("audit"),
        input.labId || null,
        input.projectId || null,
        input.actorUserId || null,
        input.action,
        input.targetType || null,
        input.targetId || null,
        input.summary || null,
        jsonb(input.metadata || {}),
        input.ipAddress || null,
        input.userAgent || null,
      ],
    );
    return result.rows[0];
  }

  async listAuditEvents(filter = {}) {
    const clauses = [];
    const params = [];
    if (filter.labId) {
      params.push(filter.labId);
      clauses.push(`lab_id = $${params.length}`);
    }
    if (filter.projectId) {
      params.push(filter.projectId);
      clauses.push(`project_id = $${params.length}`);
    }
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const result = await this.query(
      `select * from audit_events ${where} order by created_at desc`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      labId: row.lab_id,
      projectId: row.project_id,
      actorUserId: row.actor_user_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      summary: row.summary,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    }));
  }
}
