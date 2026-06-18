import path from "node:path";
import { sendJson } from "../../http/json.js";
import { readRequestBody } from "../../http/body.js";
import { validateChartInterpretRequest } from "../../charts/schemas/chartInterpretSchemas.js";
import { validateChartProposalRequest } from "../../charts/schemas/chartProposalSchemas.js";
import { createChartInterpretResponse } from "../../charts/services/chartIntent.js";
import { createChartProposalResponse } from "../../charts/services/chartProposal.js";
import { parseMultipartFormData } from "../../http/multipart.js";
import { runImportScan } from "../../import/services/importPipeline.js";
import { normalizeApprovedScan } from "../../import/services/normalizer.js";
import { validateNormalizeRequest } from "../../import/schemas/normalizationSchemas.js";
import { getAuthContext, publicUser, requireAuth, requireLabRole, requireSuperAdmin } from "../authz.js";
import { activeChartSpecs, decorateChartSpecsStaleness } from "../chartSpecStaleness.js";
import { clearSessionCookie, setSessionCookie } from "../cookies.js";
import { deleteUploadedFile, persistUploadedFile, readFileObjectBuffer } from "../fileStorage.js";
import { makeId, makeSessionToken, sha256Hex } from "../ids.js";
import { isJsonContentType, readJsonBody, routeUrl, sendError } from "../http.js";
import { verifyPassword } from "../passwords.js";
import { buildProjectAiContext } from "../projectAiContext.js";
import { resolveProjectDataQuery } from "../dataResolveQuery.js";
import { createProjectAgentPlan } from "../projectAgentPlanner.js";
import {
  publicSupplementalImportBatch,
  startSupplementalImportBatchProcessing,
  subscribeSupplementalImportBatchEvents,
} from "../supplementalImportBatches.js";
import {
  decorateObservationSeriesStaleness,
  deriveObservationSeriesFromDatasetCommit,
  mergePersistedAndDerivedObservationSeries,
} from "../observationSeries.js";
import {
  ANALYSIS_VIEW_SCHEMA_VERSION,
  chartProposalFromAnalysisView,
  resolveSeriesCompareAnalysisView,
} from "../analysisViews.js";
import {
  annotateSupplementDatasetPatch,
  buildImportRelationshipPreview,
} from "../importRelationshipResolver.js";
import { validateChartSpecProposal } from "../chartSpecValidation.js";
import {
  assertExpectedParentDatasetCommit,
  buildDatasetCommitSummary,
  buildImportRefreshPreview,
  buildNextDatasetCommitPayload,
  buildRefreshDatasetCommitPayload,
} from "../datasetCommits.js";
import { assertCanApplyImportRun, assertCanNormalizeImportRun } from "../importRunLifecycle.js";

const PROJECT_PROFILE_SCHEMA_VERSION = "labrat.projectProfile.v1";
const PROJECT_PROFILE_TEXT_FIELDS = [
  "researchGoal",
  "experimentBackground",
  "materials",
  "methods",
  "instruments",
  "analysisNotes",
];
const FILE_OBJECT_DUPLICATE_CONSTRAINT = "file_objects_project_id_checksum_sha256_original_name_key";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasCommittedMasterImport(datasetPayload = {}) {
  return asArray(datasetPayload.genericImports).some((genericImport) => (
    genericImport?.relationship?.relationship !== "supplement"
  ));
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim() || null;
}

function userAgent(req) {
  return String(req.headers["user-agent"] || "") || null;
}

function isDuplicateFileObjectError(error) {
  return error?.code === "23505" && error?.constraint === FILE_OBJECT_DUPLICATE_CONSTRAINT;
}

async function authFor(req, context) {
  return getAuthContext(req, context);
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isActive: user.isActive,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    memberships: (user.memberships || []).map((membership) => ({
      labId: membership.labId,
      role: membership.role,
      status: membership.status,
    })),
  };
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeTags(value, fallback = []) {
  const tags = Array.isArray(value) ? value : fallback;
  return tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
}

function normalizeProjectProfile(input = {}, existing = {}, updatedBy = null) {
  const source = cleanObject(input);
  const prior = cleanObject(existing);
  const profile = {
    schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
  };
  PROJECT_PROFILE_TEXT_FIELDS.forEach((field) => {
    profile[field] = source[field] != null ? String(source[field]) : String(prior[field] || "");
  });
  profile.tags = normalizeTags(source.tags, normalizeTags(prior.tags));
  profile.updatedAt = new Date().toISOString();
  profile.updatedBy = updatedBy || prior.updatedBy || null;
  return profile;
}

function emptyProjectProfile() {
  return {
    schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
    researchGoal: "",
    experimentBackground: "",
    materials: "",
    methods: "",
    instruments: "",
    analysisNotes: "",
    tags: [],
    updatedAt: null,
    updatedBy: null,
  };
}

function projectProfileFor(project) {
  return cleanObject(project?.metadata).projectProfile || emptyProjectProfile();
}

function mergeProjectProfile(metadata, projectProfile, updatedBy) {
  const next = { ...cleanObject(metadata) };
  next.projectProfile = normalizeProjectProfile(projectProfile, next.projectProfile, updatedBy);
  return next;
}

function projectSummary(project) {
  return {
    id: project.id,
    labId: project.labId,
    name: project.name,
    description: project.description || "",
    status: project.status,
    currentDatasetCommitId: project.currentDatasetCommitId || null,
    metadata: project.metadata || {},
    projectProfile: projectProfileFor(project),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function fileObjectSummary(fileObject) {
  return {
    id: fileObject.id,
    labId: fileObject.labId,
    projectId: fileObject.projectId,
    originalName: fileObject.originalName,
    mimeType: fileObject.mimeType,
    extension: fileObject.extension,
    sizeBytes: fileObject.sizeBytes,
    checksumSha256: fileObject.checksumSha256,
    storageProvider: fileObject.storageProvider,
    storageKey: fileObject.storageKey,
    createdAt: fileObject.createdAt,
    createdBy: fileObject.createdBy,
  };
}

function importRunSummary(run) {
  return {
    id: run.id,
    labId: run.labId,
    projectId: run.projectId,
    fileObjectId: run.fileObjectId,
    status: run.status,
    scanResult: run.scanResult,
    normalizePreview: run.normalizePreview,
    reviewDecisions: run.reviewDecisions || {},
    warnings: run.warnings || [],
    error: run.error,
    appliedDatasetCommitId: run.appliedDatasetCommitId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function supplementalImportBatchSummary(batch) {
  return publicSupplementalImportBatch(batch);
}

async function observationSeriesForProject(context, project, currentDatasetCommit = null) {
  const persisted = context.store.listObservationSeries
    ? await context.store.listObservationSeries({ projectId: project.id })
    : [];
  const derivedCurrent = currentDatasetCommit
    ? deriveObservationSeriesFromDatasetCommit({ project, datasetCommit: currentDatasetCommit })
    : [];
  const merged = mergePersistedAndDerivedObservationSeries(persisted, derivedCurrent);
  return decorateObservationSeriesStaleness(merged, project.currentDatasetCommitId);
}

async function rebuildObservationSeriesForDatasetCommit(context, project, datasetCommit, updatedBy) {
  if (!context.store.replaceObservationSeriesForDatasetCommit || !datasetCommit?.id) return [];
  const series = deriveObservationSeriesFromDatasetCommit({ project, datasetCommit });
  await context.store.replaceObservationSeriesForDatasetCommit({
    labId: datasetCommit.labId || project.labId,
    projectId: project.id,
    datasetCommitId: datasetCommit.id,
    series,
    updatedBy,
  });
  return series;
}

function mappingSetSummary(set) {
  return {
    id: set.id,
    labId: set.labId,
    projectId: set.projectId,
    importRunId: set.importRunId || null,
    datasetCommitId: set.datasetCommitId || null,
    schemaVersion: set.schemaVersion,
    status: set.status,
    payload: set.payload || {},
    decisionSummary: set.decisionSummary || {},
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
    createdBy: set.createdBy,
    updatedBy: set.updatedBy,
  };
}

function analysisViewSummary(view) {
  return {
    id: view.id,
    labId: view.labId,
    projectId: view.projectId,
    datasetCommitId: view.datasetCommitId || null,
    schemaVersion: view.schemaVersion || ANALYSIS_VIEW_SCHEMA_VERSION,
    viewType: view.viewType,
    status: view.status || "draft",
    title: view.title || null,
    spec: view.spec || {},
    sourceRefs: view.sourceRefs || [],
    warnings: view.warnings || [],
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    createdBy: view.createdBy,
    updatedBy: view.updatedBy,
  };
}

function chartProposalSetSummary(set) {
  return {
    id: set.id,
    labId: set.labId,
    projectId: set.projectId,
    datasetCommitId: set.datasetCommitId || null,
    mappingSetId: set.mappingSetId || null,
    schemaVersion: set.schemaVersion,
    status: set.status,
    payload: set.payload || {},
    decisionSummary: set.decisionSummary || {},
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
    createdBy: set.createdBy,
    updatedBy: set.updatedBy,
  };
}

function publicProjectAiContext(aiContext) {
  const { serviceInput, ...safeContext } = aiContext;
  return safeContext;
}

function datasetCommitRequired(res) {
  sendError(res, 409, "dataset_commit_required", "Project must have a current dataset commit before chart AI can use project data.");
}

async function readOptionalJsonBody(req) {
  const contentType = req.headers["content-type"] || "";
  const contentLength = Number(req.headers["content-length"] || 0);
  if (!contentType && !contentLength) return {};
  if (!isJsonContentType(contentType)) {
    const body = await readRequestBody(req);
    if (!body.length) return {};
    throw Object.assign(new Error("Expected application/json."), {
      statusCode: 415,
      code: "unsupported_media_type",
    });
  }
  const text = (await readRequestBody(req)).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      statusCode: 400,
      code: "invalid_json",
    });
  }
}

async function buildProjectAiContextForRequest(context, project, options = {}) {
  const [
    currentDatasetCommit,
    mappingSets,
    chartProposalSets,
    chartSpecs,
    manuscripts,
  ] = await Promise.all([
    project.currentDatasetCommitId ? context.store.findDatasetCommitById(project.currentDatasetCommitId) : null,
    context.store.listMappingSets({ projectId: project.id }),
    context.store.listChartProposalSets({ projectId: project.id }),
    context.store.listChartSpecs({ projectId: project.id }),
    context.store.listManuscripts({ projectId: project.id }),
  ]);
  const activeSpecs = activeChartSpecs(chartSpecs, project.currentDatasetCommitId);
  return buildProjectAiContext({
    project,
    projectProfile: projectProfileFor(project),
    currentDatasetCommit,
    mappingSets,
    chartProposalSets,
    chartSpecs: activeSpecs,
    manuscripts,
    selectedImportIds: options.selectedImportIds || [],
    selectedExperimentIds: options.selectedExperimentIds || [],
  });
}

function proposalFromChartSpecDraft(chartSpecDraft, prompt) {
  return {
    proposalId: `chart_interpret_${sha256Hex(prompt).slice(0, 16)}`,
    status: "proposed",
    chartType: chartSpecDraft.chartType || "scatter",
    title: chartSpecDraft.title || "Interpreted chart",
    x: chartSpecDraft.x || null,
    y: chartSpecDraft.y || null,
    yFields: chartSpecDraft.yFields || [],
    groupBy: chartSpecDraft.groupBy || null,
    filters: chartSpecDraft.filters || [],
    transforms: chartSpecDraft.transforms || [],
    series: chartSpecDraft.series || [],
    axisOptions: chartSpecDraft.axisOptions || {},
    renderStyle: chartSpecDraft.renderStyle || {},
    calculationWarnings: chartSpecDraft.calculationWarnings || [],
    sourceImportIds: chartSpecDraft.sourceImportIds || [],
    sourceRefs: chartSpecDraft.sourceRefs || [],
    confidence: chartSpecDraft.confidence || null,
    warnings: chartSpecDraft.warnings || [],
    rationale: chartSpecDraft.rationale || "Interpreted from user prompt.",
    prompt,
    chartSpecDraft,
    requiresReview: true,
  };
}

function chartSpecProposalPayload(proposal = {}) {
  const draft = isObject(proposal.chartSpecDraft) ? proposal.chartSpecDraft : {};
  return {
    ...draft,
    ...proposal,
    chartType: proposal.chartType || draft.chartType || "scatter",
    title: proposal.title || draft.title || "Interpreted chart",
    x: proposal.x || draft.x || null,
    y: proposal.y || draft.y || null,
    yFields: asArray(proposal.yFields).length ? proposal.yFields : asArray(draft.yFields),
    groupBy: proposal.groupBy || draft.groupBy || null,
    filters: asArray(proposal.filters).length ? proposal.filters : asArray(draft.filters),
    transforms: asArray(proposal.transforms).length ? proposal.transforms : asArray(draft.transforms),
    series: asArray(proposal.series).length ? proposal.series : asArray(draft.series),
    axisOptions: isObject(proposal.axisOptions) && Object.keys(proposal.axisOptions).length ? proposal.axisOptions : draft.axisOptions || {},
    renderStyle: isObject(proposal.renderStyle) && Object.keys(proposal.renderStyle).length ? proposal.renderStyle : draft.renderStyle || {},
    calculationWarnings: asArray(proposal.calculationWarnings).length ? proposal.calculationWarnings : asArray(draft.calculationWarnings),
    sourceImportIds: asArray(proposal.sourceImportIds).length ? proposal.sourceImportIds : asArray(draft.sourceImportIds),
    sourceRefs: asArray(proposal.sourceRefs).length ? proposal.sourceRefs : asArray(draft.sourceRefs),
    warnings: asArray(proposal.warnings).length ? proposal.warnings : asArray(draft.warnings),
    confidence: proposal.confidence ?? draft.confidence ?? null,
    rationale: proposal.rationale || draft.rationale || "Interpreted from user prompt.",
  };
}

async function projectAuth(req, context, projectId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const project = await context.store.findProjectById(projectId);
  if (!project) {
    throw Object.assign(new Error("Project not found."), { statusCode: 404, code: "project_not_found" });
  }
  requireLabRole(auth, project.labId, role);
  return { auth, project };
}

async function handleLogin(req, res, context) {
  const body = await readJsonBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) {
    sendError(res, 400, "invalid_login_request", "Username and password are required.");
    return;
  }
  const user = await context.store.findUserByUsername(username);
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    sendError(res, 401, "invalid_credentials", "Username or password is incorrect.");
    return;
  }
  const token = makeSessionToken();
  const expiresAt = new Date(Date.now() + context.config.sessionTtlMs);
  await context.store.createSession({
    userId: user.id,
    tokenHash: sha256Hex(token),
    expiresAt: expiresAt.toISOString(),
    ipAddress: clientIp(req),
    userAgent: userAgent(req),
  });
  setSessionCookie(res, context.config, token, expiresAt);
  const labs = await context.store.listLabsForUser(user.id);
  await context.store.recordAuditEvent({
    actorUserId: user.id,
    action: "auth.login",
    targetType: "user",
    targetId: user.id,
    summary: "User logged in.",
    ipAddress: clientIp(req),
    userAgent: userAgent(req),
  });
  sendJson(res, 200, { user: publicUser(user), labs });
}

async function handleLogout(req, res, context) {
  const auth = await authFor(req, context);
  if (auth?.session) {
    await context.store.revokeSession(auth.session.id);
    await context.store.recordAuditEvent({
      actorUserId: auth.user.id,
      action: "auth.logout",
      targetType: "user",
      targetId: auth.user.id,
      summary: "User logged out.",
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    });
  }
  clearSessionCookie(res, context.config);
  sendJson(res, 200, { ok: true });
}

async function handleMe(req, res, context) {
  const auth = requireAuth(await authFor(req, context));
  sendJson(res, 200, { user: auth.user, labs: auth.labs });
}

async function handleAdminLabs(req, res, context) {
  const auth = await authFor(req, context);
  requireSuperAdmin(auth);
  if (req.method === "GET") {
    sendJson(res, 200, { labs: await context.store.listLabs() });
    return;
  }
  const body = await readJsonBody(req);
  const name = String(body.name || "").trim();
  const slug = String(body.slug || "").trim();
  if (!name || !slug) {
    sendError(res, 400, "invalid_lab_request", "Lab name and slug are required.");
    return;
  }
  const lab = await context.store.createLab({ name, slug, createdBy: auth.user.id });
  await context.store.recordAuditEvent({
    labId: lab.id,
    actorUserId: auth.user.id,
    action: "admin.lab.create",
    targetType: "lab",
    targetId: lab.id,
    summary: `Created lab ${lab.name}.`,
  });
  sendJson(res, 201, { lab });
}

async function handleAdminUsers(req, res, context) {
  const auth = requireAuth(await authFor(req, context));
  const url = routeUrl(req);
  const labId = url.searchParams.get("labId");
  if (req.method === "GET") {
    if (!auth.isSuperAdmin && labId) requireLabRole(auth, labId, "lab_admin");
    if (!auth.isSuperAdmin && !labId) {
      sendError(res, 403, "forbidden", "Non-super admins must query users by labId.");
      return;
    }
    const users = await context.store.listUsers({ labId });
    sendJson(res, 200, { users: users.map(safeUser) });
    return;
  }

  const body = await readJsonBody(req);
  const username = String(body.username || "").trim();
  const displayName = String(body.displayName || username).trim();
  const temporaryPassword = String(body.temporaryPassword || "").trim();
  const role = body.role || null;
  const targetLabId = body.labId || labId || null;
  const isSuperAdmin = Boolean(body.isSuperAdmin);
  if (!username || !temporaryPassword) {
    sendError(res, 400, "invalid_user_request", "Username and temporaryPassword are required.");
    return;
  }
  if (!auth.isSuperAdmin) {
    if (isSuperAdmin) {
      sendError(res, 403, "forbidden", "Only super admins can create super admins.");
      return;
    }
    requireLabRole(auth, targetLabId, "lab_admin");
  }
  const created = await context.store.createUser({
    username,
    displayName,
    temporaryPassword,
    isSuperAdmin,
    labId: targetLabId,
    role,
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: targetLabId,
    actorUserId: auth.user.id,
    action: "admin.user.create",
    targetType: "user",
    targetId: created.user.id,
    summary: `Created user ${username}.`,
  });
  sendJson(res, 201, {
    user: safeUser({ ...created.user, memberships: created.membership ? [created.membership] : [] }),
    membership: created.membership,
  });
}

async function handleAdminUserById(req, res, context, match) {
  const auth = requireAuth(await authFor(req, context));
  const userId = match[1];
  if (match[2] === "reset-password") {
    const body = await readJsonBody(req);
    const temporaryPassword = String(body.temporaryPassword || "").trim();
    if (!temporaryPassword) {
      sendError(res, 400, "invalid_password_reset", "temporaryPassword is required.");
      return;
    }
    if (!auth.isSuperAdmin) {
      const users = await context.store.listUsers({});
      const target = users.find((user) => user.id === userId);
      const allowed = target?.memberships?.some((membership) => {
        try {
          requireLabRole(auth, membership.labId, "lab_admin");
          return true;
        } catch {
          return false;
        }
      });
      if (!allowed) {
        sendError(res, 403, "forbidden", "You cannot reset this user.");
        return;
      }
    }
    const user = await context.store.resetPassword(userId, temporaryPassword);
    if (!user) {
      sendError(res, 404, "user_not_found", "User not found.");
      return;
    }
    await context.store.recordAuditEvent({
      actorUserId: auth.user.id,
      action: "admin.user.reset_password",
      targetType: "user",
      targetId: user.id,
      summary: `Reset password for ${user.username}.`,
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  const body = await readJsonBody(req);
  if (!auth.isSuperAdmin) {
    const memberships = Array.isArray(body.memberships) ? body.memberships : [];
    const allowed = memberships.length && memberships.every((membership) => {
      try {
        requireLabRole(auth, membership.labId, "lab_admin");
        return true;
      } catch {
        return false;
      }
    });
    if (!allowed || body.isSuperAdmin != null) {
      sendError(res, 403, "forbidden", "You cannot update this user.");
      return;
    }
  }
  const user = await context.store.updateUser(userId, { ...body, updatedBy: auth.user.id });
  if (!user) {
    sendError(res, 404, "user_not_found", "User not found.");
    return;
  }
  await context.store.recordAuditEvent({
    actorUserId: auth.user.id,
    action: "admin.user.update",
    targetType: "user",
    targetId: user.id,
    summary: `Updated user ${user.username}.`,
  });
  const users = await context.store.listUsers({});
  sendJson(res, 200, { user: safeUser(users.find((candidate) => candidate.id === userId) || user) });
}

async function handleLabs(req, res, context) {
  const auth = requireAuth(await authFor(req, context));
  sendJson(res, 200, { labs: auth.labs });
}

async function handleProjects(req, res, context) {
  const auth = requireAuth(await authFor(req, context));
  if (req.method === "GET") {
    const url = routeUrl(req);
    const labId = url.searchParams.get("labId") || auth.labs[0]?.labId;
    if (!labId) {
      sendJson(res, 200, { projects: [] });
      return;
    }
    requireLabRole(auth, labId, "viewer");
    const projects = await context.store.listProjects({ labId });
    sendJson(res, 200, { projects: projects.filter((project) => project.status !== "deleted").map(projectSummary) });
    return;
  }
  const body = await readJsonBody(req);
  const labId = body.labId;
  requireLabRole(auth, labId, "editor");
  const name = String(body.name || "").trim();
  if (!name) {
    sendError(res, 400, "invalid_project_request", "Project name is required.");
    return;
  }
  const project = await context.store.createProject({
    labId,
    name,
    description: body.description || "",
    metadata: body.projectProfile !== undefined
      ? mergeProjectProfile(cleanObject(body.metadata), body.projectProfile, auth.user.id)
      : cleanObject(body.metadata),
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "project.create",
    targetType: "project",
    targetId: project.id,
    summary: `Created project ${project.name}.`,
  });
  sendJson(res, 201, { project: projectSummary(project) });
}

async function handleProjectById(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "PATCH" ? "editor" : "viewer");
  if (req.method === "GET") {
    const currentDatasetCommit = project.currentDatasetCommitId
      ? await context.store.findDatasetCommitById(project.currentDatasetCommitId)
      : null;
    sendJson(res, 200, { project: projectSummary(project), currentDatasetCommit });
    return;
  }
  const body = await readJsonBody(req);
  const updated = await context.store.updateProject(project.id, {
    name: body.name,
    description: body.description,
    status: body.status,
    metadata: body.projectProfile !== undefined
      ? mergeProjectProfile(project.metadata, body.projectProfile, auth.user.id)
      : undefined,
    updatedBy: auth.user.id,
  });
  const deletingProject = body.status === "deleted" && project.status !== "deleted";
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: deletingProject ? "project.delete" : "project.update",
    targetType: "project",
    targetId: project.id,
    summary: deletingProject ? `Deleted project ${updated.name}.` : `Updated project ${updated.name}.`,
    metadata: {
      changed: [
        ...(body.name !== undefined ? ["name"] : []),
        ...(body.description !== undefined ? ["description"] : []),
        ...(body.status !== undefined ? ["status"] : []),
        ...(body.projectProfile !== undefined ? ["projectProfile"] : []),
      ],
    },
  });
  sendJson(res, 200, { project: projectSummary(updated) });
}

async function handleProjectProfile(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  const body = await readJsonBody(req);
  const updated = await context.store.updateProject(project.id, {
    metadata: mergeProjectProfile(project.metadata, body, auth.user.id),
    updatedBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "project.update",
    targetType: "project",
    targetId: project.id,
    summary: `Updated project profile for ${updated.name}.`,
    metadata: { changed: ["projectProfile"] },
  });
  sendJson(res, 200, {
    project: projectSummary(updated),
    projectProfile: projectProfileFor(updated),
  });
}

async function handleProjectState(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const [
    datasetCommits,
    fileObjects,
    importRuns,
    mappingSets,
    analysisViews,
    chartProposalSets,
    chartSpecs,
    manuscripts,
    supplementalImportBatches,
  ] = await Promise.all([
    context.store.listDatasetCommits({ projectId }),
    context.store.listFileObjects({ projectId }),
    context.store.listImportRuns({ projectId }),
    context.store.listMappingSets({ projectId }),
    context.store.listAnalysisViews ? context.store.listAnalysisViews({ projectId }) : [],
    context.store.listChartProposalSets({ projectId }),
    context.store.listChartSpecs({ projectId }),
    context.store.listManuscripts({ projectId }),
    context.store.listSupplementalImportBatches ? context.store.listSupplementalImportBatches({ projectId }) : [],
  ]);
  const currentDatasetCommit = project.currentDatasetCommitId
    ? await context.store.findDatasetCommitById(project.currentDatasetCommitId)
    : null;
  const decoratedChartSpecs = decorateChartSpecsStaleness(chartSpecs, project.currentDatasetCommitId);
  const observationSeries = await observationSeriesForProject(context, project, currentDatasetCommit);
  sendJson(res, 200, {
    project: projectSummary(project),
    projectProfile: projectProfileFor(project),
    currentDatasetCommit,
    datasetCommits,
    fileObjects: fileObjects.map(fileObjectSummary),
    importRuns: importRuns.map(importRunSummary),
    mappingSets: mappingSets.map(mappingSetSummary),
    analysisViews: analysisViews.map(analysisViewSummary),
    chartProposalSets: chartProposalSets.map(chartProposalSetSummary),
    chartSpecs: decoratedChartSpecs,
    observationSeries,
    manuscripts,
    supplementalImportBatches: supplementalImportBatches.map(supplementalImportBatchSummary),
  });
}

async function handleProjectAiContext(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const body = await readJsonBody(req);
  const aiContext = await buildProjectAiContextForRequest(context, project, {
    selectedImportIds: Array.isArray(body.selectedImportIds) ? body.selectedImportIds : [],
    selectedExperimentIds: Array.isArray(body.selectedExperimentIds) ? body.selectedExperimentIds : [],
  });
  sendJson(res, 200, publicProjectAiContext(aiContext));
}

async function handleProjectDataResolveQuery(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const body = await readJsonBody(req);
  const [
    currentDatasetCommit,
    mappingSets,
    chartSpecs,
  ] = await Promise.all([
    project.currentDatasetCommitId ? context.store.findDatasetCommitById(project.currentDatasetCommitId) : null,
    context.store.listMappingSets({ projectId: project.id }),
    context.store.listChartSpecs({ projectId: project.id }),
  ]);
  const response = resolveProjectDataQuery({
    project,
    datasetCommit: currentDatasetCommit,
    mappingSets,
    chartSpecs: activeChartSpecs(chartSpecs, project.currentDatasetCommitId),
    prompt: body.prompt || "",
    selectedImportIds: Array.isArray(body.selectedImportIds) ? body.selectedImportIds : [],
    selectedExperimentIds: Array.isArray(body.selectedExperimentIds) ? body.selectedExperimentIds : [],
    maxResults: Number.isFinite(Number(body.maxResults)) ? Number(body.maxResults) : 50,
  });
  sendJson(res, 200, response);
}

async function handleProjectAgentPlan(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const body = await readJsonBody(req);
  const [
    currentDatasetCommit,
    fileObjects,
    importRuns,
    mappingSets,
    chartProposalSets,
    chartSpecs,
    manuscripts,
  ] = await Promise.all([
    project.currentDatasetCommitId ? context.store.findDatasetCommitById(project.currentDatasetCommitId) : null,
    context.store.listFileObjects({ projectId: project.id }),
    context.store.listImportRuns({ projectId: project.id }),
    context.store.listMappingSets({ projectId: project.id }),
    context.store.listChartProposalSets({ projectId: project.id }),
    context.store.listChartSpecs({ projectId: project.id }),
    context.store.listManuscripts({ projectId: project.id }),
  ]);
  const plan = createProjectAgentPlan({
    project,
    projectProfile: projectProfileFor(project),
    currentDatasetCommit,
    fileObjects: fileObjects.map(fileObjectSummary),
    importRuns: importRuns.map(importRunSummary),
    mappingSets: mappingSets.map(mappingSetSummary),
    chartProposalSets: chartProposalSets.map(chartProposalSetSummary),
    chartSpecs: decorateChartSpecsStaleness(chartSpecs, project.currentDatasetCommitId),
    manuscripts,
    message: body.message || "",
    conversation: Array.isArray(body.conversation) ? body.conversation : [],
    selectedContext: isObject(body.selectedContext) ? body.selectedContext : {},
  });
  sendJson(res, 200, plan);
}

async function handleProjectChartInterpret(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "viewer");
  const body = await readJsonBody(req);
  if (body.persistAsProposal) requireLabRole(auth, project.labId, "editor");
  const aiContext = await buildProjectAiContextForRequest(context, project, {
    selectedImportIds: Array.isArray(body.selectedImportIds) ? body.selectedImportIds : [],
    selectedExperimentIds: Array.isArray(body.selectedExperimentIds) ? body.selectedExperimentIds : [],
  });
  if (!aiContext.currentDatasetCommitId || !aiContext.serviceInput.genericImports.length) {
    datasetCommitRequired(res);
    return;
  }
  const validation = validateChartInterpretRequest({
    prompt: body.prompt,
    genericImports: aiContext.serviceInput.genericImports,
    selectedImportIds: body.selectedImportIds || [],
    selectedExperimentIds: body.selectedExperimentIds || [],
    mappingSets: aiContext.serviceInput.mappingSets,
    chartConstraints: body.chartConstraints || {},
    priorDecisions: aiContext.serviceInput.priorDecisions,
  });
  if (!validation.ok) {
    sendError(res, 400, "invalid_chart_interpret_request", validation.errors.join(" "), validation.errors);
    return;
  }
  const response = await createChartInterpretResponse(validation.value);
  if (!body.persistAsProposal || !response.chartSpecDraft) {
    sendJson(res, 200, response);
    return;
  }
  const proposal = proposalFromChartSpecDraft(response.chartSpecDraft, validation.value.prompt);
  const chartProposalSet = await context.store.createChartProposalSet({
    labId: project.labId,
    projectId: project.id,
    datasetCommitId: aiContext.currentDatasetCommitId,
    mappingSetId: null,
    schemaVersion: "labrat.chartProposalSet.v1",
    status: "proposed",
    payload: {
      proposalSetId: `chart_proposal_set_interpret_${sha256Hex(`${project.id}:${validation.value.prompt}`).slice(0, 16)}`,
      schemaVersion: "labrat.chartProposalSet.v1",
      sourceImportIds: proposal.sourceImportIds,
      proposals: [proposal],
      warnings: response.chartSpecDraft.warnings || [],
      origin: "project_chart_interpret",
    },
    decisionSummary: { accepted: 0, rejected: 0 },
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "chart_proposal_set.create",
    targetType: "chart_proposal_set",
    targetId: chartProposalSet.id,
    summary: "Created chart proposal set from interpreted chart prompt.",
  });
  sendJson(res, 200, {
    ...response,
    chartProposalSet: chartProposalSetSummary(chartProposalSet),
  });
}

async function handleProjectChartPropose(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  const body = await readJsonBody(req);
  const aiContext = await buildProjectAiContextForRequest(context, project, {
    selectedImportIds: Array.isArray(body.selectedImportIds) ? body.selectedImportIds : [],
    selectedExperimentIds: Array.isArray(body.selectedExperimentIds) ? body.selectedExperimentIds : [],
  });
  if (!aiContext.currentDatasetCommitId || !aiContext.serviceInput.genericImports.length) {
    datasetCommitRequired(res);
    return;
  }
  const validation = validateChartProposalRequest({
    genericImports: aiContext.serviceInput.genericImports,
    selectedImportIds: body.selectedImportIds || [],
    mappingSets: aiContext.serviceInput.mappingSets,
    userGoal: body.userGoal || "",
    chartConstraints: body.chartConstraints || {},
    priorDecisions: aiContext.serviceInput.priorDecisions,
  });
  if (!validation.ok) {
    sendError(res, 400, "invalid_chart_proposal_request", validation.errors.join(" "), validation.errors);
    return;
  }
  const response = await createChartProposalResponse({
    ...validation.value,
    projectProfile: aiContext.projectProfile,
    existingCharts: aiContext.existingCharts,
    fieldInventory: aiContext.fieldInventory,
  });
  const chartProposalSet = await context.store.createChartProposalSet({
    labId: project.labId,
    projectId: project.id,
    datasetCommitId: aiContext.currentDatasetCommitId,
    mappingSetId: null,
    schemaVersion: response.proposalSet.schemaVersion || "labrat.chartProposalSet.v1",
    status: "proposed",
    payload: {
      ...response.proposalSet,
      origin: "project_chart_propose",
    },
    decisionSummary: {
      accepted: response.summary?.acceptedCount || 0,
      rejected: response.summary?.rejectedCount || 0,
      proposalCount: response.summary?.proposalCount || 0,
    },
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "chart_proposal_set.create",
    targetType: "chart_proposal_set",
    targetId: chartProposalSet.id,
    summary: "Created chart proposal set from project data.",
  });
  sendJson(res, 200, {
    chartProposalSet: chartProposalSetSummary(chartProposalSet),
    proposalSet: response.proposalSet,
    summary: response.summary,
    warnings: response.warnings,
  });
}

async function handleProjectFiles(req, res, context, projectId) {
  await projectAuth(req, context, projectId, "viewer");
  const files = await context.store.listFileObjects({ projectId });
  sendJson(res, 200, { fileObjects: files.map(fileObjectSummary) });
}

async function handleProjectImportRunsList(req, res, context, projectId) {
  await projectAuth(req, context, projectId, "viewer");
  const importRuns = await context.store.listImportRuns({ projectId });
  sendJson(res, 200, { importRuns: importRuns.map(importRunSummary) });
}

async function handleProjectDatasetCommits(req, res, context, projectId) {
  await projectAuth(req, context, projectId, "viewer");
  sendJson(res, 200, { datasetCommits: await context.store.listDatasetCommits({ projectId }) });
}

async function handleProjectObservationSeries(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const currentDatasetCommit = project.currentDatasetCommitId
    ? await context.store.findDatasetCommitById(project.currentDatasetCommitId)
    : null;
  const observationSeries = await observationSeriesForProject(context, project, currentDatasetCommit);
  sendJson(res, 200, {
    schemaVersion: "labrat.observationSeriesList.v1",
    projectId: project.id,
    currentDatasetCommitId: project.currentDatasetCommitId || null,
    observationSeries,
    summary: {
      total: observationSeries.length,
      active: observationSeries.filter((series) => !series.isStale && series.status !== "stale").length,
      stale: observationSeries.filter((series) => series.isStale || series.status === "stale").length,
    },
  });
}

async function handleProjectAnalysisViews(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "POST" ? "editor" : "viewer");
  if (req.method === "GET") {
    const analysisViews = context.store.listAnalysisViews
      ? await context.store.listAnalysisViews({ projectId })
      : [];
    sendJson(res, 200, { analysisViews: analysisViews.map(analysisViewSummary) });
    return;
  }
  const body = await readJsonBody(req);
  const currentDatasetCommit = project.currentDatasetCommitId
    ? await context.store.findDatasetCommitById(project.currentDatasetCommitId)
    : null;
  if (!currentDatasetCommit) {
    datasetCommitRequired(res);
    return;
  }
  const observationSeries = await observationSeriesForProject(context, project, currentDatasetCommit);
  const resolved = resolveSeriesCompareAnalysisView({
    project,
    datasetCommit: currentDatasetCommit,
    observationSeries,
    request: body,
  });
  if (resolved.error) {
    sendError(res, resolved.error.statusCode || 400, resolved.error.code, resolved.error.message, resolved.error);
    return;
  }
  if (resolved.clarification) {
    sendJson(res, 200, {
      schemaVersion: "labrat.analysisViewDraft.v1",
      clarification: resolved.clarification,
    });
    return;
  }
  const draft = resolved.analysisView;
  const analysisView = await context.store.createAnalysisView({
    labId: project.labId,
    projectId: project.id,
    datasetCommitId: currentDatasetCommit.id,
    schemaVersion: ANALYSIS_VIEW_SCHEMA_VERSION,
    viewType: draft.viewType,
    status: draft.status || "draft",
    title: draft.title,
    spec: draft.spec,
    sourceRefs: draft.sourceRefs,
    warnings: draft.warnings,
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "analysis_view.create",
    targetType: "analysis_view",
    targetId: analysisView.id,
    summary: `Created AnalysisView ${analysisView.title || analysisView.id}.`,
  });
  sendJson(res, 201, { analysisView: analysisViewSummary(analysisView) });
}

async function handleAnalysisViewChartProposal(req, res, context, analysisViewId) {
  const auth = requireAuth(await authFor(req, context));
  const analysisView = context.store.findAnalysisViewById
    ? await context.store.findAnalysisViewById(analysisViewId)
    : null;
  if (!analysisView) {
    sendError(res, 404, "analysis_view_not_found", "AnalysisView was not found.");
    return;
  }
  requireLabRole(auth, analysisView.labId, "editor");
  const project = await context.store.findProjectById(analysisView.projectId);
  if (!project) {
    sendError(res, 404, "project_not_found", "Project not found.");
    return;
  }
  if (!project.currentDatasetCommitId || analysisView.datasetCommitId !== project.currentDatasetCommitId) {
    sendError(res, 409, "analysis_view_stale", "AnalysisView is not based on the current dataset commit.", {
      analysisViewDatasetCommitId: analysisView.datasetCommitId || null,
      currentDatasetCommitId: project.currentDatasetCommitId || null,
    });
    return;
  }
  const currentDatasetCommit = await context.store.findDatasetCommitById(project.currentDatasetCommitId);
  const observationSeries = await observationSeriesForProject(context, project, currentDatasetCommit);
  const proposal = chartProposalFromAnalysisView({
    analysisView,
    datasetCommit: currentDatasetCommit,
    observationSeries,
  });
  const chartProposalSet = await context.store.createChartProposalSet({
    labId: analysisView.labId,
    projectId: analysisView.projectId,
    datasetCommitId: analysisView.datasetCommitId,
    mappingSetId: null,
    schemaVersion: "labrat.chartProposalSet.v1",
    status: "proposed",
    payload: {
      proposalSetId: `chart_proposal_set_analysis_view_${sha256Hex(analysisView.id).slice(0, 16)}`,
      schemaVersion: "labrat.chartProposalSet.v1",
      sourceImportIds: proposal.sourceImportIds || [],
      proposals: [proposal],
      warnings: proposal.warnings || [],
      origin: "analysis_view",
      analysisViewId: analysisView.id,
      analysisViewType: analysisView.viewType,
    },
    decisionSummary: { accepted: 0, rejected: 0, proposalCount: 1 },
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: analysisView.labId,
    projectId: analysisView.projectId,
    actorUserId: auth.user.id,
    action: "chart_proposal_set.create",
    targetType: "chart_proposal_set",
    targetId: chartProposalSet.id,
    summary: "Created chart proposal set from AnalysisView.",
    metadata: { analysisViewId: analysisView.id },
  });
  sendJson(res, 201, {
    analysisView: analysisViewSummary(analysisView),
    chartProposalSet: chartProposalSetSummary(chartProposalSet),
  });
}

async function verifyProjectScopedRef(context, projectId, kind, id) {
  if (!id) return null;
  if (kind === "import_run") {
    const run = await context.store.findImportRunById(id);
    if (!run || run.projectId !== projectId) {
      throw Object.assign(new Error("Import run not found for this project."), { statusCode: 404, code: "import_run_not_found" });
    }
    return run;
  }
  if (kind === "dataset_commit") {
    const commit = await context.store.findDatasetCommitById(id);
    if (!commit || commit.projectId !== projectId) {
      throw Object.assign(new Error("Dataset commit not found for this project."), { statusCode: 404, code: "dataset_commit_not_found" });
    }
    return commit;
  }
  if (kind === "mapping_set") {
    const set = await context.store.findMappingSetById(id);
    if (!set || set.projectId !== projectId) {
      throw Object.assign(new Error("Mapping set not found for this project."), { statusCode: 404, code: "mapping_set_not_found" });
    }
    return set;
  }
  return null;
}

async function handleProjectMappingSets(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "POST" ? "editor" : "viewer");
  if (req.method === "GET") {
    const mappingSets = await context.store.listMappingSets({ projectId });
    sendJson(res, 200, { mappingSets: mappingSets.map(mappingSetSummary) });
    return;
  }
  const body = await readJsonBody(req);
  await verifyProjectScopedRef(context, projectId, "import_run", body.importRunId);
  await verifyProjectScopedRef(context, projectId, "dataset_commit", body.datasetCommitId);
  const mappingSet = await context.store.createMappingSet({
    labId: project.labId,
    projectId: project.id,
    importRunId: body.importRunId || null,
    datasetCommitId: body.datasetCommitId || null,
    schemaVersion: body.schemaVersion || "labrat.semanticMappingResponse.v1",
    status: body.status || "proposed",
    payload: body.payload || {},
    decisionSummary: body.decisionSummary || {},
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "mapping_set.create",
    targetType: "mapping_set",
    targetId: mappingSet.id,
    summary: "Created mapping set.",
  });
  sendJson(res, 201, { mappingSet: mappingSetSummary(mappingSet) });
}

async function handleMappingSetPatch(req, res, context, mappingSetId) {
  const auth = requireAuth(await authFor(req, context));
  const mappingSet = await context.store.findMappingSetById(mappingSetId);
  if (!mappingSet) {
    sendError(res, 404, "mapping_set_not_found", "Mapping set not found.");
    return;
  }
  requireLabRole(auth, mappingSet.labId, "editor");
  const body = await readJsonBody(req);
  const updated = await context.store.updateMappingSet(mappingSet.id, {
    status: body.status,
    payload: body.payload,
    decisionSummary: body.decisionSummary,
    updatedBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: mappingSet.labId,
    projectId: mappingSet.projectId,
    actorUserId: auth.user.id,
    action: "mapping_set.update_decision",
    targetType: "mapping_set",
    targetId: mappingSet.id,
    summary: "Updated mapping set.",
  });
  sendJson(res, 200, { mappingSet: mappingSetSummary(updated) });
}

async function handleProjectChartProposalSets(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "POST" ? "editor" : "viewer");
  if (req.method === "GET") {
    const chartProposalSets = await context.store.listChartProposalSets({ projectId });
    sendJson(res, 200, { chartProposalSets: chartProposalSets.map(chartProposalSetSummary) });
    return;
  }
  const body = await readJsonBody(req);
  await verifyProjectScopedRef(context, projectId, "dataset_commit", body.datasetCommitId);
  await verifyProjectScopedRef(context, projectId, "mapping_set", body.mappingSetId);
  const chartProposalSet = await context.store.createChartProposalSet({
    labId: project.labId,
    projectId: project.id,
    datasetCommitId: body.datasetCommitId || null,
    mappingSetId: body.mappingSetId || null,
    schemaVersion: body.schemaVersion || "labrat.chartProposalSet.v1",
    status: body.status || "proposed",
    payload: body.payload || {},
    decisionSummary: body.decisionSummary || {},
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "chart_proposal_set.create",
    targetType: "chart_proposal_set",
    targetId: chartProposalSet.id,
    summary: "Created chart proposal set.",
  });
  sendJson(res, 201, { chartProposalSet: chartProposalSetSummary(chartProposalSet) });
}

async function handleChartProposalSetPatch(req, res, context, chartProposalSetId) {
  const auth = requireAuth(await authFor(req, context));
  const chartProposalSet = await context.store.findChartProposalSetById(chartProposalSetId);
  if (!chartProposalSet) {
    sendError(res, 404, "chart_proposal_set_not_found", "Chart proposal set not found.");
    return;
  }
  requireLabRole(auth, chartProposalSet.labId, "editor");
  const body = await readJsonBody(req);
  const updated = await context.store.updateChartProposalSet(chartProposalSet.id, {
    status: body.status,
    payload: body.payload,
    decisionSummary: body.decisionSummary,
    updatedBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: chartProposalSet.labId,
    projectId: chartProposalSet.projectId,
    actorUserId: auth.user.id,
    action: "chart_proposal_set.update_decision",
    targetType: "chart_proposal_set",
    targetId: chartProposalSet.id,
    summary: "Updated chart proposal set.",
  });
  sendJson(res, 200, { chartProposalSet: chartProposalSetSummary(updated) });
}

async function handleProjectFileUpload(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  const form = parseMultipartFormData(req.headers["content-type"], await readRequestBody(req));
  const file = form.files.find((candidate) => candidate.fieldName === "file");
  if (!file || !file.filename) {
    sendError(res, 400, "missing_file", "Upload a file in multipart field \"file\".");
    return;
  }
  const originalName = file.filename;
  const checksumSha256 = sha256Hex(file.buffer);
  const existingFileObject = await context.store.findFileObjectByProjectChecksumName({
    projectId: project.id,
    checksumSha256,
    originalName,
  });
  if (existingFileObject) {
    await context.store.recordAuditEvent({
      labId: project.labId,
      projectId: project.id,
      actorUserId: auth.user.id,
      action: "file.reuse",
      targetType: "file_object",
      targetId: existingFileObject.id,
      summary: `Reused uploaded file ${existingFileObject.originalName}.`,
      metadata: { checksumSha256 },
    });
    sendJson(res, 200, { fileObject: fileObjectSummary(existingFileObject), reused: true });
    return;
  }

  const fileId = makeId("file");
  const storageKey = await persistUploadedFile(context.config, {
    fileId,
    projectId: project.id,
    originalName,
    buffer: file.buffer,
  });
  let fileObject;
  try {
    fileObject = await context.store.createFileObject({
      id: fileId,
      labId: project.labId,
      projectId: project.id,
      originalName,
      mimeType: file.contentType,
      extension: path.extname(originalName).replace(/^[.]/, "").toLowerCase(),
      sizeBytes: file.sizeBytes,
      checksumSha256,
      storageProvider: "local",
      storageKey,
      buffer: file.buffer,
      createdBy: auth.user.id,
    });
  } catch (error) {
    try {
      await deleteUploadedFile(context.config, storageKey);
    } catch {
      // Best-effort cleanup; preserve the original store error.
    }
    if (!isDuplicateFileObjectError(error)) throw error;
    const reusedFileObject = await context.store.findFileObjectByProjectChecksumName({
      projectId: project.id,
      checksumSha256,
      originalName,
    });
    if (!reusedFileObject) throw error;
    await context.store.recordAuditEvent({
      labId: project.labId,
      projectId: project.id,
      actorUserId: auth.user.id,
      action: "file.reuse",
      targetType: "file_object",
      targetId: reusedFileObject.id,
      summary: `Reused uploaded file ${reusedFileObject.originalName}.`,
      metadata: { checksumSha256, raceRecovered: true },
    });
    sendJson(res, 200, { fileObject: fileObjectSummary(reusedFileObject), reused: true });
    return;
  }
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "file.upload",
    targetType: "file_object",
    targetId: fileObject.id,
    summary: `Uploaded ${fileObject.originalName}.`,
    metadata: { checksumSha256 },
  });
  sendJson(res, 201, { fileObject: fileObjectSummary(fileObject), reused: false });
}

async function handleProjectImportRuns(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  const body = await readJsonBody(req);
  const fileObject = await context.store.findFileObjectById(body.fileObjectId);
  if (!fileObject || fileObject.projectId !== project.id) {
    sendError(res, 404, "file_object_not_found", "File object not found.");
    return;
  }
  const buffer = await readFileObjectBuffer(context.config, fileObject);
  const scanFileId = fileObject.checksumSha256
    ? `upload_${String(fileObject.checksumSha256).slice(0, 16)}`
    : fileObject.id;
  const scanResult = runImportScan({
    fileId: scanFileId,
    checksumSha256: fileObject.checksumSha256,
    filename: fileObject.originalName,
    contentType: fileObject.mimeType,
    sizeBytes: fileObject.sizeBytes,
    buffer,
  });
  const importRun = await context.store.createImportRun({
    labId: project.labId,
    projectId: project.id,
    fileObjectId: fileObject.id,
    status: "review_ready",
    scanResult,
    warnings: scanResult.warnings || [],
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "import.scan",
    targetType: "import_run",
    targetId: importRun.id,
    summary: `Created import run for ${fileObject.originalName}.`,
  });
  sendJson(res, 201, { importRun: importRunSummary(importRun) });
}

async function handleProjectSupplementalImportBatches(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  if (req.method === "GET") {
    const batches = context.store.listSupplementalImportBatches
      ? await context.store.listSupplementalImportBatches({ projectId: project.id })
      : [];
    sendJson(res, 200, { batches: batches.map(supplementalImportBatchSummary) });
    return;
  }
  const body = await readJsonBody(req);
  const fileObjectIds = asArray(body.fileObjectIds).map((id) => String(id || "").trim()).filter(Boolean);
  if (!fileObjectIds.length) {
    sendError(res, 400, "invalid_supplemental_batch_request", "fileObjectIds must include at least one uploaded workbook.");
    return;
  }
  const uniqueFileObjectIds = [...new Set(fileObjectIds)];
  const fileObjects = [];
  for (const fileObjectId of uniqueFileObjectIds) {
    const fileObject = await context.store.findFileObjectById(fileObjectId);
    if (!fileObject || fileObject.projectId !== project.id) {
      sendError(res, 404, "file_object_not_found", `File object ${fileObjectId} was not found for this project.`);
      return;
    }
    fileObjects.push(fileObject);
  }
  if (!context.store.createSupplementalImportBatch) {
    sendError(res, 500, "supplemental_batch_unavailable", "Supplemental batch store is unavailable.");
    return;
  }
  const batch = await context.store.createSupplementalImportBatch({
    labId: project.labId,
    projectId: project.id,
    fileObjects,
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "import.supplement_batch_create",
    targetType: "supplemental_import_batch",
    targetId: batch.id,
    summary: `Created supplemental import batch with ${fileObjects.length} workbook(s).`,
    metadata: { fileObjectIds: uniqueFileObjectIds },
  });
  startSupplementalImportBatchProcessing(context, batch.id, auth.user.id);
  sendJson(res, 201, { batch: supplementalImportBatchSummary(batch) });
}

async function handleProjectSupplementalImportBatchById(req, res, context, projectId, batchId, eventStream = false) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  const batch = context.store.findSupplementalImportBatchById
    ? await context.store.findSupplementalImportBatchById(batchId)
    : null;
  if (!batch || batch.projectId !== project.id) {
    sendError(res, 404, "supplemental_batch_not_found", "Supplemental import batch was not found for this project.");
    return;
  }
  if (["queued", "processing"].includes(batch.status)) {
    startSupplementalImportBatchProcessing(context, batch.id, auth.user.id);
  }
  if (eventStream) {
    subscribeSupplementalImportBatchEvents(batch, res);
    return;
  }
  sendJson(res, 200, { batch: supplementalImportBatchSummary(batch) });
}

async function handleNormalizePreview(req, res, context, importRunId) {
  const auth = requireAuth(await authFor(req, context));
  const importRun = await context.store.findImportRunById(importRunId);
  if (!importRun) {
    sendError(res, 404, "import_run_not_found", "Import run not found.");
    return;
  }
  requireLabRole(auth, importRun.labId, "editor");
  assertCanNormalizeImportRun(importRun);
  const body = await readJsonBody(req);
  const request = {
    scanResult: importRun.scanResult,
    approvedBlockIds: body.approvedBlockIds || [],
    approvedStructures: body.approvedStructures || {},
    fieldRoleOverrides: body.fieldRoleOverrides || {},
    mappingOverrides: body.mappingOverrides || {},
    templateId: body.templateId || null,
  };
  const validation = validateNormalizeRequest(request);
  if (!validation.ok) {
    sendError(res, 400, "invalid_normalize_request", validation.errors.join(" "), validation.errors);
    return;
  }
  let normalizePreview;
  try {
    normalizePreview = normalizeApprovedScan(validation.value);
  } catch (error) {
    await context.store.updateImportRun(importRun.id, {
      status: "failed",
      error: {
        code: "normalize_preview_failed",
        message: error.message || "Normalize preview failed.",
      },
      updatedBy: auth.user.id,
    });
    await context.store.recordAuditEvent({
      labId: importRun.labId,
      projectId: importRun.projectId,
      actorUserId: auth.user.id,
      action: "import.failed",
      targetType: "import_run",
      targetId: importRun.id,
      summary: "Import normalize preview failed.",
      metadata: { code: "normalize_preview_failed" },
    });
    throw error;
  }
  const updated = await context.store.updateImportRun(importRun.id, {
    status: "normalized_preview",
    normalizePreview,
    reviewDecisions: {
      approvedBlockIds: request.approvedBlockIds,
      approvedStructures: request.approvedStructures,
      fieldRoleOverrides: request.fieldRoleOverrides,
      mappingOverrides: request.mappingOverrides,
      templateId: request.templateId,
    },
    warnings: normalizePreview.warnings || [],
    updatedBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: importRun.labId,
    projectId: importRun.projectId,
    actorUserId: auth.user.id,
    action: "import.normalize_preview",
    targetType: "import_run",
    targetId: importRun.id,
    summary: "Created normalized import preview.",
  });
  sendJson(res, 200, { importRun: importRunSummary(updated) });
}

async function handleRefreshPreview(req, res, context, importRunId) {
  const auth = requireAuth(await authFor(req, context));
  const importRun = await context.store.findImportRunById(importRunId);
  if (!importRun) {
    sendError(res, 404, "import_run_not_found", "Import run not found.");
    return;
  }
  requireLabRole(auth, importRun.labId, "editor");
  assertCanApplyImportRun(importRun);
  const body = await readJsonBody(req);
  const project = await context.store.findProjectById(importRun.projectId);
  const parentCommit = project?.currentDatasetCommitId
    ? await context.store.findDatasetCommitById(project.currentDatasetCommitId)
    : null;
  const refreshPreview = buildImportRefreshPreview({
    parentCommit,
    datasetPatch: importRun.normalizePreview.datasetPatch || {},
    replaceImportId: body.replaceImportId,
    expectedParentDatasetCommitId: body.expectedParentDatasetCommitId,
  });
  sendJson(res, 200, refreshPreview);
}

async function handleRelationshipPreview(req, res, context, importRunId) {
  const auth = requireAuth(await authFor(req, context));
  const importRun = await context.store.findImportRunById(importRunId);
  if (!importRun) {
    sendError(res, 404, "import_run_not_found", "Import run not found.");
    return;
  }
  requireLabRole(auth, importRun.labId, "editor");
  assertCanApplyImportRun(importRun);
  const project = await context.store.findProjectById(importRun.projectId);
  const parentCommit = project?.currentDatasetCommitId
    ? await context.store.findDatasetCommitById(project.currentDatasetCommitId)
    : null;
  const [mappingSets, chartSpecs] = await Promise.all([
    context.store.listMappingSets({ projectId: importRun.projectId }),
    context.store.listChartSpecs({ projectId: importRun.projectId }),
  ]);
  const relationshipPreview = buildImportRelationshipPreview({
    project,
    parentCommit,
    datasetPatch: importRun.normalizePreview.datasetPatch || {},
    importRunId: importRun.id,
    mappingSets,
    chartSpecs: activeChartSpecs(chartSpecs, project?.currentDatasetCommitId),
  });
  sendJson(res, 200, relationshipPreview);
}

async function handleApplyImportRun(req, res, context, importRunId) {
  const auth = requireAuth(await authFor(req, context));
  const importRun = await context.store.findImportRunById(importRunId);
  if (!importRun) {
    sendError(res, 404, "import_run_not_found", "Import run not found.");
    return;
  }
  requireLabRole(auth, importRun.labId, "editor");
  assertCanApplyImportRun(importRun);
  const project = await context.store.findProjectById(importRun.projectId);
  const parentCommit = project?.currentDatasetCommitId
    ? await context.store.findDatasetCommitById(project.currentDatasetCommitId)
    : null;
  const body = await readOptionalJsonBody(req);
  const applyMode = body.applyMode || "append";
  if (!["append", "replace_import", "supplement_import"].includes(applyMode)) {
    sendError(res, 400, "invalid_import_apply_request", "applyMode must be append, replace_import, or supplement_import.");
    return;
  }
  const datasetPatch = importRun.normalizePreview.datasetPatch || {};
  const reviewNote = body.reviewNote != null ? String(body.reviewNote) : null;
  let datasetPayload;
  let summary;
  let refreshDecision = null;
  let auditAction = "import.apply";
  let auditSummary = "Applied import run.";
  if (applyMode === "replace_import") {
    assertExpectedParentDatasetCommit(parentCommit, body.expectedParentDatasetCommitId);
    const appliedAt = new Date().toISOString();
    const refreshed = buildRefreshDatasetCommitPayload({
      parentCommit,
      datasetPatch,
      replaceImportId: body.replaceImportId,
      importRunId: importRun.id,
      appliedAt,
    });
    datasetPayload = refreshed.datasetPayload;
    refreshDecision = {
      applyMode,
      replaceImportId: refreshed.replacedImportId,
      replacementImportId: refreshed.replacementImportId,
      expectedParentDatasetCommitId: body.expectedParentDatasetCommitId,
      refreshSummary: refreshed.refreshSummary,
      reviewNote,
      appliedAt,
    };
    summary = {
      ...(importRun.normalizePreview.summary || {}),
      applyMode,
      parentCommitId: parentCommit?.id || null,
      sourceImportRunIds: [importRun.id],
      replacedImportId: refreshed.replacedImportId,
      replacementImportId: refreshed.replacementImportId,
      refreshSummary: refreshed.refreshSummary,
      reviewNote,
      addedImportIds: [],
      addedGenericImportCount: 0,
      addedExperimentCount: 0,
      addedFieldCount: 0,
      addedMeasurementCount: 0,
      totalGenericImportCount: refreshed.counts.genericImportCount,
      totalExperimentCount: refreshed.counts.experimentCount,
      totalFieldCount: refreshed.counts.fieldCount,
      totalMeasurementCount: refreshed.counts.measurementCount,
      warningCount: refreshed.counts.warningCount,
    };
    auditAction = "import.refresh_apply";
    auditSummary = "Applied import refresh.";
  } else if (applyMode === "supplement_import") {
    const relationshipDecision = body.relationshipDecision || {};
    const targetExperimentIds = Array.isArray(relationshipDecision.targetExperimentIds)
      ? relationshipDecision.targetExperimentIds
      : Array.isArray(body.targetExperimentIds) ? body.targetExperimentIds : [];
    if (!targetExperimentIds.length) {
      sendError(res, 400, "invalid_import_apply_request", "supplement_import requires targetExperimentIds.");
      return;
    }
    const annotatedPatch = annotateSupplementDatasetPatch(datasetPatch, {
      ...relationshipDecision,
      targetExperimentIds,
    });
    const nextDataset = buildNextDatasetCommitPayload({
      parentDatasetPayload: parentCommit?.datasetPayload || {},
      datasetPatch: annotatedPatch,
    });
    datasetPayload = nextDataset.datasetPayload;
    summary = {
      ...buildDatasetCommitSummary({
        parentCommit,
        datasetPatch: annotatedPatch,
        datasetPayload,
        normalizeSummary: importRun.normalizePreview.summary || {},
        sourceImportRunIds: [importRun.id],
      }),
      applyMode,
      relationship: "supplement",
      supplementType: relationshipDecision.supplementType || "supplemental_data",
      targetExperimentIds,
      relationshipProposalId: relationshipDecision.relationshipProposalId || null,
      reviewNote,
    };
    auditAction = "import.supplement_apply";
    auditSummary = "Applied supplemental import.";
  } else {
    if (hasCommittedMasterImport(parentCommit?.datasetPayload)) {
      sendError(
        res,
        409,
        "master_table_already_exists",
        "This project already has an active master table. Use refresh for the master table or supplement_import for extra workbooks.",
      );
      return;
    }
    const nextDataset = buildNextDatasetCommitPayload({
      parentDatasetPayload: parentCommit?.datasetPayload || {},
      datasetPatch,
    });
    datasetPayload = nextDataset.datasetPayload;
    summary = {
      ...buildDatasetCommitSummary({
        parentCommit,
        datasetPatch,
        datasetPayload,
        normalizeSummary: importRun.normalizePreview.summary || {},
        sourceImportRunIds: [importRun.id],
      }),
      applyMode,
      reviewNote,
    };
  }
  const datasetCommit = await context.store.createDatasetCommit({
    labId: importRun.labId,
    projectId: importRun.projectId,
    parentCommitId: parentCommit?.id || null,
    sourceImportRunIds: [importRun.id],
    datasetPayload,
    summary,
    warnings: importRun.normalizePreview.warnings || [],
    createdBy: auth.user.id,
  });
  await rebuildObservationSeriesForDatasetCommit(context, project, datasetCommit, auth.user.id);
  await context.store.updateImportRun(importRun.id, {
    status: "applied",
    appliedDatasetCommitId: datasetCommit.id,
    reviewDecisions: {
      ...(importRun.reviewDecisions || {}),
      applyMode,
      reviewNote,
      ...(refreshDecision || {}),
    },
    updatedBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: importRun.labId,
    projectId: importRun.projectId,
    actorUserId: auth.user.id,
    action: auditAction,
    targetType: "import_run",
    targetId: importRun.id,
    summary: auditSummary,
    metadata: refreshDecision || { applyMode, reviewNote },
  });
  await context.store.recordAuditEvent({
    labId: importRun.labId,
    projectId: importRun.projectId,
    actorUserId: auth.user.id,
    action: "dataset_commit.create",
    targetType: "dataset_commit",
    targetId: datasetCommit.id,
    summary: "Created dataset commit from import run.",
  });
  sendJson(res, 200, {
    datasetCommit,
    project: projectSummary(await context.store.findProjectById(importRun.projectId)),
  });
}

async function handleChartSpecFromProposal(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  const body = await readJsonBody(req);
  const proposalSet = body.chartProposalSetId
    ? await context.store.findChartProposalSetById(body.chartProposalSetId)
    : null;
  if (body.chartProposalSetId && (!proposalSet || proposalSet.projectId !== project.id)) {
    sendError(res, 404, "chart_proposal_set_not_found", "Chart proposal set was not found for this project.");
    return;
  }
  const proposal = proposalSet?.payload?.proposals?.find((candidate) => candidate.proposalId === body.proposalId)
    || body.proposal;
  if (!proposal) {
    sendError(res, 404, "chart_proposal_not_found", "Chart proposal was not found.");
    return;
  }
  const datasetCommitId = body.datasetCommitId || proposalSet?.datasetCommitId || project.currentDatasetCommitId || null;
  if (!datasetCommitId) {
    datasetCommitRequired(res);
    return;
  }
  if (proposalSet?.datasetCommitId && body.datasetCommitId && proposalSet.datasetCommitId !== body.datasetCommitId) {
    sendError(res, 400, "invalid_chart_spec", "Chart proposal set and requested dataset commit do not match.", {
      chartProposalSetDatasetCommitId: proposalSet.datasetCommitId,
      datasetCommitId: body.datasetCommitId,
    });
    return;
  }
  const datasetCommit = await verifyProjectScopedRef(context, projectId, "dataset_commit", datasetCommitId);
  const chartValidation = validateChartSpecProposal({ proposal: chartSpecProposalPayload(proposal), datasetCommit });
  const chartSpecPayload = chartValidation.chartSpec;
  const chartSpec = await context.store.createChartSpec({
    labId: project.labId,
    projectId: project.id,
    datasetCommitId,
    mappingSetId: proposalSet?.mappingSetId || null,
    sourceChartProposalSetId: body.chartProposalSetId || null,
    sourceProposalId: body.proposalId || proposal.proposalId || null,
    title: chartSpecPayload.title || "Untitled chart",
    chartType: chartSpecPayload.chartType || "scatter",
    spec: chartSpecPayload,
    layout: body.layout || {},
    warnings: chartSpecPayload.warnings || [],
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "chart_spec.create",
    targetType: "chart_spec",
    targetId: chartSpec.id,
    summary: `Created chart spec ${chartSpec.title || chartSpec.id}.`,
  });
  sendJson(res, 201, { chartSpec });
}

async function handleChartSpecs(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const chartSpecs = await context.store.listChartSpecs({ projectId });
  sendJson(res, 200, { chartSpecs: decorateChartSpecsStaleness(chartSpecs, project.currentDatasetCommitId) });
}

async function handleManuscripts(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "POST" ? "editor" : "viewer");
  if (req.method === "GET") {
    const manuscripts = await context.store.listManuscripts({ projectId });
    sendJson(res, 200, { manuscripts });
    return;
  }
  const body = await readJsonBody(req);
  const manuscript = await context.store.createManuscript({
    labId: project.labId,
    projectId: project.id,
    title: String(body.title || "Untitled manuscript"),
    blocks: Array.isArray(body.blocks) ? body.blocks : [],
    pages: Array.isArray(body.pages) ? body.pages : [],
    canvasState: body.canvasState || {},
    references: Array.isArray(body.references) ? body.references : [],
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "manuscript.create",
    targetType: "manuscript",
    targetId: manuscript.id,
    summary: `Created manuscript ${manuscript.title}.`,
  });
  sendJson(res, 201, { manuscript });
}

async function handleManuscriptPatch(req, res, context, manuscriptId) {
  const auth = requireAuth(await authFor(req, context));
  const manuscript = await context.store.findManuscriptById(manuscriptId);
  if (!manuscript) {
    sendError(res, 404, "manuscript_not_found", "Manuscript not found.");
    return;
  }
  requireLabRole(auth, manuscript.labId, "editor");
  const body = await readJsonBody(req);
  const updated = await context.store.updateManuscript(manuscript.id, { ...body, updatedBy: auth.user.id });
  await context.store.recordAuditEvent({
    labId: manuscript.labId,
    projectId: manuscript.projectId,
    actorUserId: auth.user.id,
    action: "manuscript.update",
    targetType: "manuscript",
    targetId: manuscript.id,
    summary: `Updated manuscript ${updated.title}.`,
  });
  sendJson(res, 200, { manuscript: updated });
}

async function dispatch(req, res, context) {
  const url = routeUrl(req);
  const pathName = url.pathname;
  if (req.method === "POST" && pathName === "/api/auth/login") return handleLogin(req, res, context);
  if (req.method === "POST" && pathName === "/api/auth/logout") return handleLogout(req, res, context);
  if (req.method === "GET" && pathName === "/api/auth/me") return handleMe(req, res, context);
  if ((req.method === "GET" || req.method === "POST") && pathName === "/api/admin/labs") return handleAdminLabs(req, res, context);
  if ((req.method === "GET" || req.method === "POST") && pathName === "/api/admin/users") return handleAdminUsers(req, res, context);
  const adminUserMatch = pathName.match(/^\/api\/admin\/users\/([^/]+)(?:\/(reset-password))?$/);
  if (adminUserMatch && (req.method === "PATCH" || req.method === "POST")) return handleAdminUserById(req, res, context, adminUserMatch);
  if (req.method === "GET" && pathName === "/api/labs") return handleLabs(req, res, context);
  if ((req.method === "GET" || req.method === "POST") && pathName === "/api/projects") return handleProjects(req, res, context);
  const projectProfileMatch = pathName.match(/^\/api\/projects\/([^/]+)\/profile$/);
  if (projectProfileMatch && req.method === "PATCH") return handleProjectProfile(req, res, context, projectProfileMatch[1]);
  const projectStateMatch = pathName.match(/^\/api\/projects\/([^/]+)\/state$/);
  if (projectStateMatch && req.method === "GET") return handleProjectState(req, res, context, projectStateMatch[1]);
  const projectAiContextMatch = pathName.match(/^\/api\/projects\/([^/]+)\/ai\/context$/);
  if (projectAiContextMatch && req.method === "POST") return handleProjectAiContext(req, res, context, projectAiContextMatch[1]);
  const projectDataResolveQueryMatch = pathName.match(/^\/api\/projects\/([^/]+)\/data\/resolve-query$/);
  if (projectDataResolveQueryMatch && req.method === "POST") return handleProjectDataResolveQuery(req, res, context, projectDataResolveQueryMatch[1]);
  const projectAgentPlanMatch = pathName.match(/^\/api\/projects\/([^/]+)\/agent\/plan$/);
  if (projectAgentPlanMatch && req.method === "POST") return handleProjectAgentPlan(req, res, context, projectAgentPlanMatch[1]);
  const projectChartInterpretMatch = pathName.match(/^\/api\/projects\/([^/]+)\/charts\/interpret$/);
  if (projectChartInterpretMatch && req.method === "POST") return handleProjectChartInterpret(req, res, context, projectChartInterpretMatch[1]);
  const projectChartProposeMatch = pathName.match(/^\/api\/projects\/([^/]+)\/charts\/propose$/);
  if (projectChartProposeMatch && req.method === "POST") return handleProjectChartPropose(req, res, context, projectChartProposeMatch[1]);
  const projectMatch = pathName.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && (req.method === "GET" || req.method === "PATCH")) return handleProjectById(req, res, context, projectMatch[1]);
  const fileMatch = pathName.match(/^\/api\/projects\/([^/]+)\/files$/);
  if (fileMatch && req.method === "GET") return handleProjectFiles(req, res, context, fileMatch[1]);
  if (fileMatch && req.method === "POST") return handleProjectFileUpload(req, res, context, fileMatch[1]);
  const importRunsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/import-runs$/);
  if (importRunsMatch && req.method === "GET") return handleProjectImportRunsList(req, res, context, importRunsMatch[1]);
  if (importRunsMatch && req.method === "POST") return handleProjectImportRuns(req, res, context, importRunsMatch[1]);
  const supplementalBatchesMatch = pathName.match(/^\/api\/projects\/([^/]+)\/supplemental-import-batches$/);
  if (supplementalBatchesMatch && (req.method === "GET" || req.method === "POST")) return handleProjectSupplementalImportBatches(req, res, context, supplementalBatchesMatch[1]);
  const supplementalBatchEventsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/supplemental-import-batches\/([^/]+)\/events$/);
  if (supplementalBatchEventsMatch && req.method === "GET") return handleProjectSupplementalImportBatchById(req, res, context, supplementalBatchEventsMatch[1], supplementalBatchEventsMatch[2], true);
  const supplementalBatchMatch = pathName.match(/^\/api\/projects\/([^/]+)\/supplemental-import-batches\/([^/]+)$/);
  if (supplementalBatchMatch && req.method === "GET") return handleProjectSupplementalImportBatchById(req, res, context, supplementalBatchMatch[1], supplementalBatchMatch[2]);
  const datasetCommitsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/dataset-commits$/);
  if (datasetCommitsMatch && req.method === "GET") return handleProjectDatasetCommits(req, res, context, datasetCommitsMatch[1]);
  const observationSeriesMatch = pathName.match(/^\/api\/projects\/([^/]+)\/observation-series$/);
  if (observationSeriesMatch && req.method === "GET") return handleProjectObservationSeries(req, res, context, observationSeriesMatch[1]);
  const analysisViewsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/analysis-views$/);
  if (analysisViewsMatch && (req.method === "GET" || req.method === "POST")) return handleProjectAnalysisViews(req, res, context, analysisViewsMatch[1]);
  const analysisViewChartProposalMatch = pathName.match(/^\/api\/analysis-views\/([^/]+)\/chart-proposal$/);
  if (analysisViewChartProposalMatch && req.method === "POST") return handleAnalysisViewChartProposal(req, res, context, analysisViewChartProposalMatch[1]);
  const mappingSetsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/mapping-sets$/);
  if (mappingSetsMatch && (req.method === "GET" || req.method === "POST")) return handleProjectMappingSets(req, res, context, mappingSetsMatch[1]);
  const mappingSetMatch = pathName.match(/^\/api\/mapping-sets\/([^/]+)$/);
  if (mappingSetMatch && req.method === "PATCH") return handleMappingSetPatch(req, res, context, mappingSetMatch[1]);
  const chartProposalSetsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/chart-proposal-sets$/);
  if (chartProposalSetsMatch && (req.method === "GET" || req.method === "POST")) return handleProjectChartProposalSets(req, res, context, chartProposalSetsMatch[1]);
  const chartProposalSetMatch = pathName.match(/^\/api\/chart-proposal-sets\/([^/]+)$/);
  if (chartProposalSetMatch && req.method === "PATCH") return handleChartProposalSetPatch(req, res, context, chartProposalSetMatch[1]);
  const normalizeMatch = pathName.match(/^\/api\/import-runs\/([^/]+)\/normalize-preview$/);
  if (normalizeMatch && req.method === "POST") return handleNormalizePreview(req, res, context, normalizeMatch[1]);
  const refreshPreviewMatch = pathName.match(/^\/api\/import-runs\/([^/]+)\/refresh-preview$/);
  if (refreshPreviewMatch && req.method === "POST") return handleRefreshPreview(req, res, context, refreshPreviewMatch[1]);
  const relationshipPreviewMatch = pathName.match(/^\/api\/import-runs\/([^/]+)\/relationship-preview$/);
  if (relationshipPreviewMatch && req.method === "POST") return handleRelationshipPreview(req, res, context, relationshipPreviewMatch[1]);
  const applyMatch = pathName.match(/^\/api\/import-runs\/([^/]+)\/apply$/);
  if (applyMatch && req.method === "POST") return handleApplyImportRun(req, res, context, applyMatch[1]);
  const chartFromProposalMatch = pathName.match(/^\/api\/projects\/([^/]+)\/chart-specs\/from-proposal$/);
  if (chartFromProposalMatch && req.method === "POST") return handleChartSpecFromProposal(req, res, context, chartFromProposalMatch[1]);
  const chartSpecsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/chart-specs$/);
  if (chartSpecsMatch && req.method === "GET") return handleChartSpecs(req, res, context, chartSpecsMatch[1]);
  const manuscriptsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/manuscripts$/);
  if (manuscriptsMatch && (req.method === "GET" || req.method === "POST")) return handleManuscripts(req, res, context, manuscriptsMatch[1]);
  const manuscriptMatch = pathName.match(/^\/api\/manuscripts\/([^/]+)$/);
  if (manuscriptMatch && req.method === "PATCH") return handleManuscriptPatch(req, res, context, manuscriptMatch[1]);
  return false;
}

export async function handleSaasRoutes(req, res, context) {
  if (!req.url?.startsWith("/api/auth")
    && !req.url?.startsWith("/api/admin")
    && !req.url?.startsWith("/api/labs")
    && !req.url?.startsWith("/api/projects")
    && !req.url?.startsWith("/api/analysis-views")
    && !req.url?.startsWith("/api/import-runs")
    && !req.url?.startsWith("/api/mapping-sets")
    && !req.url?.startsWith("/api/chart-proposal-sets")
    && !req.url?.startsWith("/api/manuscripts")) {
    return false;
  }
  try {
    const handled = await dispatch(req, res, context);
    return handled !== false;
  } catch (error) {
    sendError(
      res,
      error.statusCode || 500,
      error.code || "internal_error",
      error.message || "Request failed.",
      error.details,
    );
    return true;
  }
}
