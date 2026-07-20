import path from "node:path";
import { sendJson } from "../../http/json.js";
import { readRequestBody } from "../../http/body.js";
import { shapeChartInterpretResponse } from "../../charts/schemas/chartInterpretSchemas.js";
import { parseChartEvidenceIntent } from "../../charts/services/chartEvidenceIntent.js";
import { parseMultipartFormData } from "../../http/multipart.js";
import { runImportScan } from "../../import/services/importPipeline.js";
import { getAuthContext, publicUser, requireAuth, requireLabRole, requireSuperAdmin } from "../authz.js";
import { clearSessionCookie, setSessionCookie } from "../cookies.js";
import { deleteUploadedFile, persistUploadedFile, readFileObjectBuffer } from "../fileStorage.js";
import { makeId, makeSessionToken, sha256Hex } from "../ids.js";
import { isJsonContentType, readJsonBody, routeUrl, sendError } from "../http.js";
import { verifyPassword } from "../passwords.js";
import { createProjectAgentPlan } from "../projectAgentPlanner.js";
import { runEvidenceRetrievalAgent } from "../evidenceAgentRetrieval.js";
import {
  loadExperimentDataPlanReview,
  publishExperimentBrowserData,
} from "../experimentBrowserPublish.js";
import {
  buildExperimentProjection,
  getExperimentProjectionDetail,
} from "../experimentProjection.js";
import {
  SOURCE_DOCUMENT_LIST_SCHEMA_VERSION,
  SOURCE_REGION_LIST_SCHEMA_VERSION,
  persistSourceIndexForImportRun,
  publicScanResult,
  querySourceDocument,
  readSourceDocumentRange,
  sourceDocumentSummary,
  sourceRegionSummary,
} from "../sourceDocuments.js";
import {
  buildSourceExtractPreview,
  chartProposalFromSourceExtract,
  sourceExtractProposalSummary,
} from "../sourceExtracts.js";
import {
  applyWorkbookReviewRevision,
  buildWorkbookUnderstandingForConfirmation,
  buildWorkbookReviewSessionDraft,
  workbookUnderstandingSummary,
  workbookReviewSessionSummary,
} from "../workbookReviewSessions.js";
import {
  agentRunSummary,
  buildAgentRunDraft,
  executeAgentRunAction,
  markActionCompleted,
} from "../agentRuns.js";
import {
  acceptAnalysisPlanRevision,
  analysisPlanRevisionSummary,
  analysisResultSummary,
  analysisRunSummary,
  analysisThreadSummary,
  createAnalysisPlanRevision,
  createAnalysisThread,
  draftAnalysisPlanRevision,
  getAnalysisPlanSelectionPage,
  getAnalysisResultPreview,
  getAnalysisRunDetail,
  listAnalysisThreads,
  executeAnalysisRun,
  reviseAnalysisRun,
} from "../analysisThreads.js";
import { validateChartSpecProposal } from "../chartSpecValidation.js";
import {
  createSourceExtractProposalFromEvidence,
  resolveChartEvidenceIntent,
} from "../chartEvidenceResolver.js";

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
    scanResult: publicScanResult(run.scanResult),
    normalizePreview: run.normalizePreview,
    reviewDecisions: run.reviewDecisions || {},
    warnings: run.warnings || [],
    error: run.error,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function dataPlanSummary(plan) {
  return {
    id: plan.id,
    labId: plan.labId,
    projectId: plan.projectId,
    schemaVersion: plan.schemaVersion,
    status: plan.status,
    task: plan.task,
    outputShape: plan.outputShape,
    dependencyHash: plan.dependencyHash,
    warnings: plan.warnings || [],
    acceptedAt: plan.acceptedAt || null,
    acceptedBy: plan.acceptedBy || null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function dataSnapshotSummary(snapshot) {
  return {
    id: snapshot.id,
    labId: snapshot.labId,
    projectId: snapshot.projectId,
    dataPlanId: snapshot.dataPlanId,
    schemaVersion: snapshot.schemaVersion,
    status: snapshot.status,
    outputShape: snapshot.outputShape,
    contentHash: snapshot.contentHash,
    dependencyHash: snapshot.dependencyHash,
    experimentRecordCount: Number(snapshot.summary?.experimentRecordCount) || asArray(snapshot.experimentRecords).length,
    includedRowCount: Number(snapshot.summary?.includedRowCount) || 0,
    skippedRowCount: Number(snapshot.summary?.skippedRowCount) || 0,
    warningCount: asArray(snapshot.warnings).length,
    acceptedAt: snapshot.acceptedAt,
    acceptedBy: snapshot.acceptedBy,
    createdAt: snapshot.createdAt,
  };
}

function chartProposalSetSummary(set) {
  return {
    id: set.id,
    labId: set.labId,
    projectId: set.projectId,
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
    seriesScope: proposal.seriesScope || draft.seriesScope || null,
    compatibleExperimentIds: asArray(proposal.compatibleExperimentIds).length ? proposal.compatibleExperimentIds : asArray(draft.compatibleExperimentIds),
    selectedExperimentIds: asArray(proposal.selectedExperimentIds).length ? proposal.selectedExperimentIds : asArray(draft.selectedExperimentIds),
    seriesKind: proposal.seriesKind || draft.seriesKind || proposal.seriesScope?.seriesKind || draft.seriesScope?.seriesKind || null,
    axisOptions: isObject(proposal.axisOptions) && Object.keys(proposal.axisOptions).length ? proposal.axisOptions : draft.axisOptions || {},
    renderStyle: isObject(proposal.renderStyle) && Object.keys(proposal.renderStyle).length ? proposal.renderStyle : draft.renderStyle || {},
    calculationWarnings: asArray(proposal.calculationWarnings).length ? proposal.calculationWarnings : asArray(draft.calculationWarnings),
    sourceRefs: asArray(proposal.sourceRefs).length ? proposal.sourceRefs : asArray(draft.sourceRefs),
    warnings: asArray(proposal.warnings).length ? proposal.warnings : asArray(draft.warnings),
    confidence: proposal.confidence ?? draft.confidence ?? null,
    rationale: proposal.rationale || draft.rationale || "Interpreted from user prompt.",
  };
}

function isSourceBackedChartProposal(proposal = {}) {
  const draft = isObject(proposal.chartSpecDraft) ? proposal.chartSpecDraft : {};
  return proposal.origin === "source_extract"
    || draft.origin === "source_extract"
    || isObject(proposal.sourceSnapshot)
    || isObject(draft.sourceSnapshot);
}

function isSourceBackedChartSpec(chartSpec = {}) {
  const spec = isObject(chartSpec.spec) ? chartSpec.spec : chartSpec;
  return spec.origin === "source_extract" || isObject(spec.sourceSnapshot);
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

async function sourceDocumentAuth(req, context, sourceDocumentId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const sourceDocument = await context.store.findSourceDocumentById?.(sourceDocumentId);
  if (!sourceDocument) {
    throw Object.assign(new Error("Source document not found."), {
      statusCode: 404,
      code: "source_document_not_found",
    });
  }
  requireLabRole(auth, sourceDocument.labId, role);
  return { auth, sourceDocument };
}

async function sourceRegionAuth(req, context, sourceRegionId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const sourceRegion = await context.store.findSourceRegionById?.(sourceRegionId);
  if (!sourceRegion) {
    throw Object.assign(new Error("Source region not found."), {
      statusCode: 404,
      code: "source_region_not_found",
    });
  }
  requireLabRole(auth, sourceRegion.labId, role);
  return { auth, sourceRegion };
}

async function sourceExtractProposalAuth(req, context, proposalId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const sourceExtractProposal = await context.store.findSourceExtractProposalById?.(proposalId);
  if (!sourceExtractProposal) {
    throw Object.assign(new Error("Source extract proposal not found."), {
      statusCode: 404,
      code: "source_extract_proposal_not_found",
    });
  }
  requireLabRole(auth, sourceExtractProposal.labId, role);
  return { auth, sourceExtractProposal };
}

async function workbookReviewSessionAuth(req, context, sessionId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const workbookReviewSession = await context.store.findWorkbookReviewSessionById?.(sessionId);
  if (!workbookReviewSession) {
    throw Object.assign(new Error("Workbook review session not found."), {
      statusCode: 404,
      code: "workbook_review_session_not_found",
    });
  }
  requireLabRole(auth, workbookReviewSession.labId, role);
  return { auth, workbookReviewSession };
}

async function agentRunAuth(req, context, agentRunId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const agentRun = await context.store.findAgentRunById?.(agentRunId);
  if (!agentRun) {
    throw Object.assign(new Error("AgentRun not found."), {
      statusCode: 404,
      code: "agent_run_not_found",
    });
  }
  requireLabRole(auth, agentRun.labId, role);
  return { auth, agentRun };
}

async function analysisThreadAuth(req, context, analysisThreadId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const analysisThread = await context.store.findAnalysisThreadById?.(analysisThreadId);
  if (!analysisThread) {
    throw Object.assign(new Error("Analysis thread not found."), {
      statusCode: 404,
      code: "analysis_thread_not_found",
    });
  }
  requireLabRole(auth, analysisThread.labId, role);
  return { auth, analysisThread };
}

async function analysisPlanRevisionAuth(req, context, planRevisionId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const analysisPlanRevision = await context.store.findAnalysisPlanRevisionById?.(planRevisionId);
  if (!analysisPlanRevision) {
    throw Object.assign(new Error("Analysis plan revision not found."), {
      statusCode: 404,
      code: "analysis_plan_revision_not_found",
    });
  }
  requireLabRole(auth, analysisPlanRevision.labId, role);
  return { auth, analysisPlanRevision };
}

async function analysisRunAuth(req, context, analysisRunId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const analysisRun = await context.store.findAnalysisRunById?.(analysisRunId);
  if (!analysisRun) {
    throw Object.assign(new Error("Analysis run not found."), {
      statusCode: 404,
      code: "analysis_run_not_found",
    });
  }
  requireLabRole(auth, analysisRun.labId, role);
  return { auth, analysisRun };
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
    sendJson(res, 200, { project: projectSummary(project) });
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
  const { auth, project } = await projectAuth(req, context, projectId, "viewer");
  const [
    fileObjects,
    importRuns,
    chartProposalSets,
    chartSpecs,
    manuscripts,
    workbookReviewSessions,
    workbookUnderstandings,
    agentRuns,
    analysisThreads,
    dataPlans,
    dataSnapshots,
    experimentSnapshotHeads,
    browserViews,
    sourceDocuments,
  ] = await Promise.all([
    context.store.listFileObjects({ projectId }),
    context.store.listImportRuns({ projectId }),
    context.store.listChartProposalSets({ projectId }),
    context.store.listChartSpecs({ projectId }),
    context.store.listManuscripts({ projectId }),
    context.store.listWorkbookReviewSessions ? context.store.listWorkbookReviewSessions({ projectId }) : [],
    context.store.listWorkbookUnderstandings ? context.store.listWorkbookUnderstandings({ projectId }) : [],
    context.store.listAgentRuns ? context.store.listAgentRuns({ projectId }) : [],
    context.store.listAnalysisThreads ? context.store.listAnalysisThreads({ projectId }) : [],
    context.store.listDataPlans ? context.store.listDataPlans({ projectId }) : [],
    context.store.listDataSnapshots ? context.store.listDataSnapshots({ projectId }) : [],
    context.store.listExperimentSnapshotHeads ? context.store.listExperimentSnapshotHeads({ projectId }) : [],
    context.store.listBrowserViews ? context.store.listBrowserViews({ projectId, ownerUserId: auth.user.id }) : [],
    context.store.listSourceDocuments ? context.store.listSourceDocuments({ projectId }) : [],
  ]);
  const sourceBackedChartSpecs = chartSpecs.filter(isSourceBackedChartSpec);
  sendJson(res, 200, {
    project: projectSummary(project),
    projectProfile: projectProfileFor(project),
    fileObjects: fileObjects.map(fileObjectSummary),
    importRuns: importRuns.map(importRunSummary),
    chartProposalSets: chartProposalSets.map(chartProposalSetSummary),
    chartSpecs: sourceBackedChartSpecs,
    manuscripts,
    workbookReviewSessions: workbookReviewSessions.map(workbookReviewSessionSummary),
    workbookUnderstandings: workbookUnderstandings.map(workbookUnderstandingSummary),
    agentRuns: agentRuns.map(agentRunSummary),
    analysisThreads: analysisThreads.slice(0, 100).map(analysisThreadSummary),
    dataPlans: dataPlans.map(dataPlanSummary),
    dataSnapshots: dataSnapshots.map(dataSnapshotSummary),
    experimentSnapshotHeads,
    browserViews,
    sourceDocuments: sourceDocuments.map(sourceDocumentSummary),
  });
}

async function readProjectSourceRangePreview(context, project, { sourceDocumentId, sheetName, range, maxCells = 240 }) {
  const sourceDocument = await context.store.findSourceDocumentById?.(sourceDocumentId);
  if (!sourceDocument || sourceDocument.projectId !== project.id) {
    return null;
  }
  const indexBlobs = context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  return readSourceDocumentRange({
    sourceDocument,
    indexBlobs,
    sheetName,
    range,
    maxCells,
  });
}

async function handleProjectEvidenceRetrieve(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const body = await readJsonBody(req);
  const [
    workbookUnderstandings,
    sourceDocuments,
  ] = await Promise.all([
    context.store.listWorkbookUnderstandings ? context.store.listWorkbookUnderstandings({ projectId: project.id }) : [],
    context.store.listSourceDocuments ? context.store.listSourceDocuments({ projectId: project.id }) : [],
  ]);
  const sourceRegions = (await Promise.all(sourceDocuments.map((sourceDocument) => (
    context.store.listSourceRegions
      ? context.store.listSourceRegions({ sourceDocumentId: sourceDocument.id })
      : []
  )))).flat();
  const acceptedUnderstandings = workbookUnderstandings.filter((understanding) => (
    understanding.status === "accepted"
    || understanding.understanding?.status === "accepted"
  ));
  const response = await runEvidenceRetrievalAgent({
    project,
    query: body.query || body.prompt || "",
    acceptedUnderstandings,
    sourceDocuments,
    sourceRegions,
    includePreview: body.includePreview !== false,
    includeUnconfirmedSuggestions: body.includeUnconfirmedSuggestions === true,
    readRangePreview: (request) => readProjectSourceRangePreview(context, project, {
      ...request,
      maxCells: 240,
    }),
  });
  sendJson(res, 200, response);
}

async function handleProjectDataPlanDraft(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "editor");
  const body = await readJsonBody(req);
  if (body.intent !== "experiment_browser_publish") {
    sendJson(res, 200, {
      projectId: project.id,
      resultKind: "clarification",
      clarification: {
        code: "invalid_data_plan_intent",
        message: "This endpoint drafts only experiment_browser_publish DataPlans from accepted workbook understanding.",
      },
    });
    return;
  }
  const response = await loadExperimentDataPlanReview({
    store: context.store,
    project,
    workbookUnderstandingIds: body.workbookUnderstandingIds,
    identityDecisions: body.identityDecisions,
  });
  sendJson(res, 200, {
    ...response,
    projectId: project.id,
  });
}

async function handleProjectDataPlanPublish(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  const body = await readJsonBody(req);
  const response = await publishExperimentBrowserData({
    store: context.store,
    project,
    actorUserId: auth.user.id,
    dataPlan: body.dataPlan,
    identityDecisions: body.identityDecisions,
    expectedPreviewHash: body.expectedPreviewHash,
    expectedDependencyHash: body.expectedDependencyHash,
    idempotencyKey: body.idempotencyKey,
    ipAddress: clientIp(req),
    userAgent: userAgent(req),
  });
  sendJson(res, response.idempotentReplay ? 200 : 201, response);
}

async function handleProjectDataPlans(req, res, context, projectId) {
  await projectAuth(req, context, projectId, "viewer");
  const dataPlans = context.store.listDataPlans
    ? await context.store.listDataPlans({ projectId })
    : [];
  sendJson(res, 200, { dataPlans: dataPlans.map(dataPlanSummary) });
}

async function handleProjectDataSnapshots(req, res, context, projectId) {
  await projectAuth(req, context, projectId, "viewer");
  const dataSnapshots = context.store.listDataSnapshots
    ? await context.store.listDataSnapshots({ projectId })
    : [];
  sendJson(res, 200, { dataSnapshots: dataSnapshots.map(dataSnapshotSummary) });
}

function parseBrowserQueryList(url, name) {
  const raw = url.searchParams.get(name);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("Expected an array.");
    return value;
  } catch {
    throw Object.assign(new Error(`Experiment Browser query parameter ${name} must be a JSON array.`), {
      statusCode: 400,
      code: "invalid_browser_query",
      details: { parameter: name },
    });
  }
}

async function loadExperimentProjectionState(context, projectId) {
  const [dataSnapshots, experimentIdentities, experimentSnapshotHeads] = await Promise.all([
    context.store.listDataSnapshots ? context.store.listDataSnapshots({ projectId }) : [],
    context.store.listExperimentIdentities ? context.store.listExperimentIdentities({ projectId }) : [],
    context.store.listExperimentSnapshotHeads ? context.store.listExperimentSnapshotHeads({ projectId }) : [],
  ]);
  return { dataSnapshots, experimentIdentities, experimentSnapshotHeads };
}

async function handleProjectExperimentBrowser(req, res, context, projectId, url) {
  await projectAuth(req, context, projectId, "viewer");
  const state = await loadExperimentProjectionState(context, projectId);
  const projection = buildExperimentProjection({
    projectId,
    ...state,
    search: url.searchParams.get("search") || "",
    filters: parseBrowserQueryList(url, "filters"),
    sort: parseBrowserQueryList(url, "sort"),
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  });
  sendJson(res, 200, projection);
}

async function handleProjectExperimentDetail(req, res, context, projectId, experimentId) {
  await projectAuth(req, context, projectId, "viewer");
  const state = await loadExperimentProjectionState(context, projectId);
  const detail = getExperimentProjectionDetail({ projectId, experimentId, ...state });
  if (!detail) {
    sendError(res, 404, "experiment_not_found", "Experiment was not found in this project's active snapshots.");
    return;
  }
  sendJson(res, 200, detail);
}

const BROWSER_VIEW_PAYLOAD_KEYS = new Set(["columns", "filters", "sort", "groupBy", "selectedExperimentIds"]);
const BROWSER_VIEW_FILTER_OPERATORS = new Set(["contains", "eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "not_empty"]);

function browserViewText(value) {
  return String(value ?? "").trim();
}

function invalidBrowserView(message, details = undefined) {
  throw Object.assign(new Error(message), { statusCode: 400, code: "invalid_browser_view", details });
}

function normalizeBrowserViewPayload(value) {
  if (!isObject(value)) invalidBrowserView("BrowserView payload must be an object.");
  const unknownKeys = Object.keys(value).filter((key) => !BROWSER_VIEW_PAYLOAD_KEYS.has(key));
  if (unknownKeys.length) invalidBrowserView("BrowserView payload contains unsupported keys.", { unknownKeys });
  const rawColumns = value.columns ?? [];
  const rawFilters = value.filters ?? [];
  const rawSort = value.sort ?? [];
  const rawSelectedIds = value.selectedExperimentIds ?? [];
  if (!Array.isArray(rawColumns) || rawColumns.length > 100) invalidBrowserView("BrowserView columns must be an array of at most 100 items.");
  if (!Array.isArray(rawFilters) || rawFilters.length > 20) invalidBrowserView("BrowserView filters must be an array of at most 20 items.");
  if (!Array.isArray(rawSort) || rawSort.length > 3) invalidBrowserView("BrowserView sort must be an array of at most 3 items.");
  if (!Array.isArray(rawSelectedIds) || rawSelectedIds.length > 500) invalidBrowserView("BrowserView selectedExperimentIds must be an array of at most 500 ids.");

  const columns = rawColumns.map((column, index) => {
    if (!isObject(column) || !browserViewText(column.columnId)) invalidBrowserView("Every BrowserView column requires columnId.");
    const width = column.width == null ? null : Number(column.width);
    if (width != null && (!Number.isFinite(width) || width < 60 || width > 800)) {
      invalidBrowserView("BrowserView column widths must be between 60 and 800 pixels.");
    }
    return {
      columnId: browserViewText(column.columnId),
      order: Number.isInteger(Number(column.order)) ? Number(column.order) : index,
      width,
      hidden: Boolean(column.hidden),
    };
  });
  if (new Set(columns.map((column) => column.columnId)).size !== columns.length) {
    invalidBrowserView("BrowserView columns cannot contain duplicate column ids.");
  }

  const filters = rawFilters.map((filter) => {
    if (!isObject(filter) || !browserViewText(filter.columnId)) invalidBrowserView("Every BrowserView filter requires columnId.");
    const operator = browserViewText(filter.operator).toLowerCase();
    if (!BROWSER_VIEW_FILTER_OPERATORS.has(operator)) invalidBrowserView("BrowserView filter operator is unsupported.");
    return { columnId: browserViewText(filter.columnId), operator, value: filter.value ?? null };
  });
  const sort = rawSort.map((item) => {
    if (!isObject(item) || !browserViewText(item.columnId)) invalidBrowserView("Every BrowserView sort item requires columnId.");
    return { columnId: browserViewText(item.columnId), direction: browserViewText(item.direction).toLowerCase() === "desc" ? "desc" : "asc" };
  });
  const selectedExperimentIds = [...new Set(rawSelectedIds.map(browserViewText).filter(Boolean))];
  return {
    columns,
    filters,
    sort,
    groupBy: value.groupBy == null ? null : browserViewText(value.groupBy) || null,
    selectedExperimentIds,
  };
}

function normalizeBrowserViewRequest(body, { partial = false } = {}) {
  if (!isObject(body)) invalidBrowserView("BrowserView request must be an object.");
  const result = {};
  if (!partial || body.name !== undefined) {
    const name = browserViewText(body.name);
    if (!name || name.length > 80) invalidBrowserView("BrowserView name must contain 1 to 80 characters.");
    result.name = name;
  }
  if (!partial || body.payload !== undefined) result.payload = normalizeBrowserViewPayload(body.payload ?? {});
  if (!partial || body.isDefault !== undefined) {
    if (body.isDefault !== undefined && typeof body.isDefault !== "boolean") invalidBrowserView("BrowserView isDefault must be boolean.");
    result.isDefault = Boolean(body.isDefault);
  }
  return result;
}

async function clearOtherDefaultBrowserViews(context, projectId, ownerUserId, exceptId = null) {
  const views = await context.store.listBrowserViews({ projectId, ownerUserId });
  await Promise.all(views
    .filter((view) => view.isDefault && view.id !== exceptId)
    .map((view) => context.store.updateBrowserView(view.id, { isDefault: false })));
}

async function handleProjectBrowserViews(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "viewer");
  if (req.method === "GET") {
    const browserViews = await context.store.listBrowserViews({ projectId, ownerUserId: auth.user.id });
    sendJson(res, 200, { browserViews });
    return;
  }
  const body = normalizeBrowserViewRequest(await readJsonBody(req));
  if (body.isDefault) await clearOtherDefaultBrowserViews(context, projectId, auth.user.id);
  const browserView = await context.store.createBrowserView({
    ...body,
    labId: project.labId,
    projectId,
    ownerUserId: auth.user.id,
  });
  sendJson(res, 201, { browserView });
}

async function handleProjectBrowserViewById(req, res, context, projectId, browserViewId) {
  const { auth } = await projectAuth(req, context, projectId, "viewer");
  const browserView = await context.store.findBrowserViewById(browserViewId);
  if (!browserView || browserView.projectId !== projectId || browserView.ownerUserId !== auth.user.id) {
    sendError(res, 404, "browser_view_not_found", "Browser view was not found.");
    return;
  }
  if (req.method === "DELETE") {
    const deleted = await context.store.deleteBrowserView(browserView.id);
    sendJson(res, 200, { deleted });
    return;
  }
  const changes = normalizeBrowserViewRequest(await readJsonBody(req), { partial: true });
  if (changes.isDefault) await clearOtherDefaultBrowserViews(context, projectId, auth.user.id, browserView.id);
  const updated = await context.store.updateBrowserView(browserView.id, changes);
  sendJson(res, 200, { browserView: updated });
}

async function handleProjectAgentPlan(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const body = await readJsonBody(req);
  const [
    fileObjects,
    chartProposalSets,
    chartSpecs,
    manuscripts,
    experimentSnapshotHeads,
    sourceDocuments,
  ] = await Promise.all([
    context.store.listFileObjects({ projectId: project.id }),
    context.store.listChartProposalSets({ projectId: project.id }),
    context.store.listChartSpecs({ projectId: project.id }),
    context.store.listManuscripts({ projectId: project.id }),
    context.store.listExperimentSnapshotHeads({ projectId: project.id }),
    context.store.listSourceDocuments({ projectId: project.id }),
  ]);
  const plan = createProjectAgentPlan({
    project,
    projectProfile: projectProfileFor(project),
    fileObjects: fileObjects.map(fileObjectSummary),
    chartProposalSets: chartProposalSets.map(chartProposalSetSummary),
    chartSpecs: chartSpecs.filter(isSourceBackedChartSpec),
    manuscripts,
    experimentSnapshotHeads,
    sourceDocuments: sourceDocuments.map(sourceDocumentSummary),
    message: body.message || "",
    conversation: Array.isArray(body.conversation) ? body.conversation : [],
    selectedContext: isObject(body.selectedContext) ? body.selectedContext : {},
  });
  sendJson(res, 200, plan);
}

async function handleProjectAgentRuns(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "viewer");
  if (req.method === "GET") {
    const agentRuns = context.store.listAgentRuns
      ? await context.store.listAgentRuns({ projectId: project.id })
      : [];
    sendJson(res, 200, {
      schemaVersion: "labrat.agentRunList.v1",
      projectId: project.id,
      agentRuns: agentRuns.map(agentRunSummary),
    });
    return;
  }

  const body = await readJsonBody(req);
  const [
    fileObjects,
    chartProposalSets,
    chartSpecs,
    manuscripts,
    experimentSnapshotHeads,
    sourceDocuments,
  ] = await Promise.all([
    context.store.listFileObjects({ projectId: project.id }),
    context.store.listChartProposalSets({ projectId: project.id }),
    context.store.listChartSpecs({ projectId: project.id }),
    context.store.listManuscripts({ projectId: project.id }),
    context.store.listExperimentSnapshotHeads({ projectId: project.id }),
    context.store.listSourceDocuments({ projectId: project.id }),
  ]);
  const draft = await buildAgentRunDraft({
    context,
    project,
    projectProfile: projectProfileFor(project),
    fileObjects: fileObjects.map(fileObjectSummary),
    chartProposalSets: chartProposalSets.map(chartProposalSetSummary),
    chartSpecs: chartSpecs.filter(isSourceBackedChartSpec),
    manuscripts,
    experimentSnapshotHeads,
    sourceDocuments: sourceDocuments.map(sourceDocumentSummary),
    message: body.message || "",
    conversation: Array.isArray(body.conversation) ? body.conversation : [],
    selectedContext: isObject(body.selectedContext) ? body.selectedContext : {},
  });
  let agentRun = await context.store.createAgentRun({
    labId: project.labId,
    projectId: project.id,
    status: draft.status || "waiting_for_user",
    mode: draft.mode || null,
    userMessage: body.message || "",
    selectedContext: isObject(body.selectedContext) ? body.selectedContext : {},
    visibleSteps: draft.visibleSteps || [],
    toolTrace: draft.toolTrace || [],
    proposalRefs: draft.proposalRefs || [],
    actions: draft.actions || [],
    usage: draft.usage || {},
    warnings: draft.warnings || [],
    createdBy: auth.user.id,
  });
  let analysisThread = null;
  let currentPlanRevision = null;
  let reply = draft.reply || "";
  if (draft.mode === "analysis_planning") {
    analysisThread = await createAnalysisThread({
      store: context.store,
      project,
      actorUserId: auth.user.id,
      originalRequest: body.message || "",
      messages: [{
        id: makeId("analysis_message"),
        role: "user",
        content: String(body.message || ""),
        createdAt: agentRun.createdAt,
        agentRunId: agentRun.id,
      }],
    });
    const planningWarnings = [...asArray(agentRun.warnings)];
    if (experimentSnapshotHeads.length) {
      try {
        currentPlanRevision = await draftAnalysisPlanRevision({
          store: context.store,
          project,
          analysisThreadId: analysisThread.id,
          actorUserId: auth.user.id,
          modelProvider: context.modelProvider,
          analysisToolRegistry: context.analysisToolRegistry,
        });
      } catch (error) {
        planningWarnings.push({
          code: error.code || "analysis_plan_draft_failed",
          message: error.message || "The reviewed analysis plan could not be drafted.",
          severity: "warning",
        });
        reply = "I created an analysis thread, but the backend could not draft a reviewable plan. The request is preserved and can be retried after the provider or accepted data is corrected.";
      }
    } else {
      planningWarnings.push({
        code: "analysis_evidence_required",
        message: "Publish accepted experiment data before drafting an analysis plan.",
        severity: "info",
      });
      reply = "I created an analysis thread, but accepted published experiment data is required before I can draft the reviewed analysis plan.";
    }
    const draftMetadata = currentPlanRevision?.draftMetadata || {};
    const existingUsage = agentRun.usage || {};
    agentRun = await context.store.updateAgentRun(agentRun.id, {
      visibleSteps: [
        ...asArray(agentRun.visibleSteps),
        {
          stepId: makeId("agent_step"),
          label: currentPlanRevision
            ? "Drafted reviewable analysis plan"
            : "Created analysis thread",
          details: {
            analysisThreadId: analysisThread.id,
            planRevisionId: currentPlanRevision?.id || null,
            planHash: currentPlanRevision?.planHash || null,
            selectionHash: currentPlanRevision?.selectionHash || null,
          },
          createdAt: new Date().toISOString(),
        },
      ],
      toolTrace: currentPlanRevision ? [
        ...asArray(agentRun.toolTrace),
        {
          tool: "list_analysis_fields",
          observation: { projectId: project.id },
        },
        {
          tool: "preview_analysis_selection",
          observation: {
            projectId: project.id,
            selectionId: currentPlanRevision.selection?.selectionId || null,
            experimentCount: asArray(currentPlanRevision.selection?.experimentIds).length,
            fieldCount: asArray(currentPlanRevision.selection?.fieldIds).length,
          },
        },
        {
          tool: "validate_analysis_plan",
          observation: {
            projectId: project.id,
            planRevisionId: currentPlanRevision.id,
            ok: true,
          },
        },
      ] : agentRun.toolTrace,
      proposalRefs: [
        ...asArray(agentRun.proposalRefs),
        { type: "analysis_thread", id: analysisThread.id },
        ...(currentPlanRevision ? [{
          type: "analysis_plan_revision",
          id: currentPlanRevision.id,
        }] : []),
      ],
      usage: {
        ...existingUsage,
        provider: draftMetadata.provider || existingUsage.provider,
        model: draftMetadata.model || existingUsage.model,
        inputTokens: (Number(existingUsage.inputTokens) || 0)
          + (Number(draftMetadata.usage?.inputTokens) || 0),
        outputTokens: (Number(existingUsage.outputTokens) || 0)
          + (Number(draftMetadata.usage?.outputTokens) || 0),
        latencyMs: (Number(existingUsage.latencyMs) || 0)
          + (Number(draftMetadata.latencyMs) || 0),
      },
      warnings: planningWarnings,
      updatedBy: auth.user.id,
    });
    analysisThread = await context.store.findAnalysisThreadById(analysisThread.id);
    await context.store.recordAuditEvent({
      labId: project.labId,
      projectId: project.id,
      actorUserId: auth.user.id,
      action: "analysis_thread.create",
      targetType: "analysis_thread",
      targetId: analysisThread.id,
      summary: `Created analysis thread ${analysisThread.id} from AgentRun.`,
      metadata: {
        agentRunId: agentRun.id,
        currentPlanRevisionId: currentPlanRevision?.id || null,
      },
    });
    if (currentPlanRevision) {
      await context.store.recordAuditEvent({
        labId: project.labId,
        projectId: project.id,
        actorUserId: auth.user.id,
        action: "analysis_plan_revision.create",
        targetType: "analysis_plan_revision",
        targetId: currentPlanRevision.id,
        summary: `Created analysis plan revision ${currentPlanRevision.revision} from AgentRun.`,
        metadata: {
          agentRunId: agentRun.id,
          analysisThreadId: analysisThread.id,
          planHash: currentPlanRevision.planHash,
          selectionHash: currentPlanRevision.selectionHash,
          dependencyHash: currentPlanRevision.dependencyHash,
        },
      });
    }
  }
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "agent_run.create",
    targetType: "agent_run",
    targetId: agentRun.id,
    summary: `Created AgentRun ${agentRun.id}.`,
    metadata: { mode: agentRun.mode, actionCount: asArray(agentRun.actions).length },
  });
  sendJson(res, 201, {
    agentRun: agentRunSummary(agentRun),
    reply,
    analysisThread: analysisThread ? analysisThreadSummary(analysisThread) : null,
    currentPlanRevision: currentPlanRevision
      ? analysisPlanRevisionSummary(currentPlanRevision)
      : null,
  });
}

async function handleAgentRunById(req, res, context, agentRunId) {
  const { agentRun } = await agentRunAuth(req, context, agentRunId, "viewer");
  sendJson(res, 200, { agentRun: agentRunSummary(agentRun) });
}

async function handleAgentRunConfirm(req, res, context, agentRunId) {
  const { auth, agentRun } = await agentRunAuth(req, context, agentRunId, "editor");
  if (agentRun.status === "completed" || agentRun.status === "cancelled") {
    throw Object.assign(new Error(`AgentRun is already ${agentRun.status}.`), {
      statusCode: 409,
      code: "agent_run_closed",
    });
  }
  const body = await readJsonBody(req);
  const actionId = String(body.actionId || "");
  const requestedAction = asArray(agentRun.actions).find((candidate) => candidate.actionId === actionId);
  if (!requestedAction) {
    throw Object.assign(new Error("AgentRun action not found."), {
      statusCode: 404,
      code: "agent_run_action_not_found",
    });
  }
  if (requestedAction.status !== "requires_confirmation") {
    throw Object.assign(new Error("AgentRun action is not waiting for confirmation."), {
      statusCode: 409,
      code: "agent_run_action_not_confirmable",
    });
  }
  const result = await executeAgentRunAction({
    context,
    run: agentRun,
    action: requestedAction,
    actorUserId: auth.user.id,
  });
  const proposalRefs = [
    ...asArray(agentRun.proposalRefs),
    ...asArray(result.proposalRefs),
  ];
  const visibleSteps = [
    ...asArray(agentRun.visibleSteps),
    ...asArray(result.visibleSteps),
  ];
  const updated = await context.store.updateAgentRun(agentRun.id, {
    status: "completed",
    visibleSteps,
    actions: markActionCompleted(agentRun.actions, actionId, {
      chartProposalSetId: result.chartProposalSet?.id || null,
      sourceExtractProposalId: result.sourceExtractProposal?.id || null,
    }),
    proposalRefs,
    updatedBy: auth.user.id,
  });
  if (result.chartProposalSet) {
    await context.store.recordAuditEvent({
      labId: agentRun.labId,
      projectId: agentRun.projectId,
      actorUserId: auth.user.id,
      action: "chart_proposal_set.create",
      targetType: "chart_proposal_set",
      targetId: result.chartProposalSet.id,
      summary: "Created chart proposal set from AgentRun.",
      metadata: { agentRunId: agentRun.id },
    });
  }
  if (result.sourceExtractProposal) {
    await context.store.recordAuditEvent({
      labId: agentRun.labId,
      projectId: agentRun.projectId,
      actorUserId: auth.user.id,
      action: "source.extract.propose",
      targetType: "source_extract_proposal",
      targetId: result.sourceExtractProposal.id,
      summary: "Created source extract proposal from AgentRun.",
      metadata: { agentRunId: agentRun.id },
    });
  }
  await context.store.recordAuditEvent({
    labId: agentRun.labId,
    projectId: agentRun.projectId,
    actorUserId: auth.user.id,
    action: "agent_run.confirm",
    targetType: "agent_run",
    targetId: agentRun.id,
    summary: `Confirmed AgentRun action ${requestedAction.type}.`,
    metadata: { actionId, actionType: requestedAction.type },
  });
  sendJson(res, 200, {
    agentRun: agentRunSummary(updated),
    chartProposalSet: result.chartProposalSet ? chartProposalSetSummary(result.chartProposalSet) : null,
    sourceExtractProposal: result.sourceExtractProposal ? sourceExtractProposalSummary(result.sourceExtractProposal) : null,
  });
}

async function handleAgentRunCancel(req, res, context, agentRunId) {
  const { auth, agentRun } = await agentRunAuth(req, context, agentRunId, "viewer");
  if (agentRun.status === "completed") {
    throw Object.assign(new Error("Completed AgentRuns cannot be cancelled."), {
      statusCode: 409,
      code: "agent_run_completed",
    });
  }
  const updated = await context.store.updateAgentRun(agentRun.id, {
    status: "cancelled",
    updatedBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: agentRun.labId,
    projectId: agentRun.projectId,
    actorUserId: auth.user.id,
    action: "agent_run.cancel",
    targetType: "agent_run",
    targetId: agentRun.id,
    summary: `Cancelled AgentRun ${agentRun.id}.`,
  });
  sendJson(res, 200, { agentRun: agentRunSummary(updated) });
}

async function handleProjectAnalysisThreads(req, res, context, projectId, url) {
  const { auth, project } = await projectAuth(
    req,
    context,
    projectId,
    req.method === "POST" ? "editor" : "viewer",
  );
  if (req.method === "GET") {
    const result = await listAnalysisThreads({
      store: context.store,
      projectId: project.id,
      offset: url.searchParams.get("offset"),
      limit: url.searchParams.get("limit"),
    });
    sendJson(res, 200, {
      schemaVersion: "labrat.analysisThreadList.v1",
      projectId: project.id,
      ...result,
    });
    return;
  }
  const body = await readJsonBody(req);
  const analysisThread = await createAnalysisThread({
    store: context.store,
    project,
    actorUserId: auth.user.id,
    originalRequest: body.originalRequest || body.request || body.message,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "analysis_thread.create",
    targetType: "analysis_thread",
    targetId: analysisThread.id,
    summary: `Created analysis thread ${analysisThread.id}.`,
  });
  sendJson(res, 201, { analysisThread: analysisThreadSummary(analysisThread) });
}

async function handleAnalysisThreadById(req, res, context, analysisThreadId) {
  const { analysisThread } = await analysisThreadAuth(
    req,
    context,
    analysisThreadId,
    "viewer",
  );
  const [planRevisions, analysisRuns] = await Promise.all([
    context.store.listAnalysisPlanRevisions({ analysisThreadId: analysisThread.id }),
    context.store.listAnalysisRuns({
      projectId: analysisThread.projectId,
      analysisThreadId: analysisThread.id,
    }),
  ]);
  sendJson(res, 200, {
    analysisThread: {
      ...analysisThreadSummary(analysisThread),
      messages: analysisThread.messages || [],
    },
    planRevisions: planRevisions.map(analysisPlanRevisionSummary),
    analysisRuns: analysisRuns.map(analysisRunSummary),
  });
}

async function handleAnalysisPlanRevisions(req, res, context, analysisThreadId) {
  const { auth, analysisThread } = await analysisThreadAuth(
    req,
    context,
    analysisThreadId,
    "editor",
  );
  const project = await context.store.findProjectById(analysisThread.projectId);
  if (!project) {
    throw Object.assign(new Error("Project not found."), {
      statusCode: 404,
      code: "project_not_found",
    });
  }
  const body = await readJsonBody(req);
  const revision = body.plan
    ? await createAnalysisPlanRevision({
      store: context.store,
      project,
      analysisThreadId: analysisThread.id,
      actorUserId: auth.user.id,
      plan: body.plan,
      selectionRequest: body.selectionRequest,
      feedback: body.feedback,
    })
    : await draftAnalysisPlanRevision({
      store: context.store,
      project,
      analysisThreadId: analysisThread.id,
      actorUserId: auth.user.id,
      modelProvider: context.modelProvider,
      analysisToolRegistry: context.analysisToolRegistry,
      feedback: body.feedback,
    });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "analysis_plan_revision.create",
    targetType: "analysis_plan_revision",
    targetId: revision.id,
    summary: `Created analysis plan revision ${revision.revision}.`,
    metadata: {
      analysisThreadId: analysisThread.id,
      planHash: revision.planHash,
      selectionHash: revision.selectionHash,
      dependencyHash: revision.dependencyHash,
    },
  });
  sendJson(res, 201, { analysisPlanRevision: analysisPlanRevisionSummary(revision) });
}

async function handleAnalysisPlanSelection(req, res, context, planRevisionId, url) {
  await analysisPlanRevisionAuth(req, context, planRevisionId, "viewer");
  const selection = await getAnalysisPlanSelectionPage({
    store: context.store,
    planRevisionId,
    offset: url.searchParams.get("offset"),
    limit: url.searchParams.get("limit"),
  });
  sendJson(res, 200, selection);
}

async function handleAnalysisPlanAccept(req, res, context, planRevisionId) {
  const { auth, analysisPlanRevision } = await analysisPlanRevisionAuth(
    req,
    context,
    planRevisionId,
    "editor",
  );
  const project = await context.store.findProjectById(analysisPlanRevision.projectId);
  if (!project) {
    throw Object.assign(new Error("Project not found."), {
      statusCode: 404,
      code: "project_not_found",
    });
  }
  const body = await readJsonBody(req);
  const result = await acceptAnalysisPlanRevision({
    store: context.store,
    project,
    actorUserId: auth.user.id,
    planRevisionId: analysisPlanRevision.id,
    idempotencyKey: req.headers["idempotency-key"],
    planHash: body.planHash,
    selectionHash: body.selectionHash,
    dependencyHash: body.dependencyHash,
    ipAddress: clientIp(req),
    userAgent: userAgent(req),
  });
  sendJson(res, result.idempotentReplay ? 200 : 201, {
    analysisThread: analysisThreadSummary(result.analysisThread),
    analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
    analysisRun: analysisRunSummary(result.analysisRun),
    idempotentReplay: result.idempotentReplay,
  });
}

async function handleAnalysisRunById(req, res, context, analysisRunId) {
  await analysisRunAuth(req, context, analysisRunId, "viewer");
  const detail = await getAnalysisRunDetail({
    store: context.store,
    analysisRunId,
  });
  sendJson(res, 200, {
    analysisThread: analysisThreadSummary(detail.analysisThread),
    analysisPlanRevision: analysisPlanRevisionSummary(detail.analysisPlanRevision),
    analysisRun: analysisRunSummary(detail.analysisRun),
    analysisResult: analysisResultSummary(detail.analysisResult),
  });
}

async function handleAnalysisRunExecute(req, res, context, analysisRunId) {
  const { auth, analysisRun } = await analysisRunAuth(
    req,
    context,
    analysisRunId,
    "editor",
  );
  await readOptionalJsonBody(req);
  const project = await context.store.findProjectById(analysisRun.projectId);
  if (!project) {
    throw Object.assign(new Error("Project not found."), {
      statusCode: 404,
      code: "project_not_found",
    });
  }
  const result = await executeAnalysisRun({
    store: context.store,
    project,
    actorUserId: auth.user.id,
    analysisRunId,
    executor: context.analysisExecutor,
    ipAddress: clientIp(req),
    userAgent: userAgent(req),
  });
  sendJson(res, result.idempotentReplay ? 200 : 201, {
    analysisThread: analysisThreadSummary(result.analysisThread),
    analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
    analysisRun: analysisRunSummary(result.analysisRun),
    analysisResult: analysisResultSummary(result.analysisResult),
    idempotentReplay: result.idempotentReplay,
  });
}

async function handleAnalysisResultPreview(req, res, context, analysisRunId, url) {
  await analysisRunAuth(req, context, analysisRunId, "viewer");
  const preview = await getAnalysisResultPreview({
    store: context.store,
    analysisRunId,
    offset: url.searchParams.get("offset"),
    limit: url.searchParams.get("limit"),
    traceOffset: url.searchParams.get("traceOffset"),
    traceLimit: url.searchParams.get("traceLimit"),
    sourceOffset: url.searchParams.get("sourceOffset"),
    sourceLimit: url.searchParams.get("sourceLimit"),
  });
  sendJson(res, 200, preview);
}

async function handleAnalysisRunRevise(req, res, context, analysisRunId) {
  const { auth, analysisRun } = await analysisRunAuth(
    req,
    context,
    analysisRunId,
    "editor",
  );
  const project = await context.store.findProjectById(analysisRun.projectId);
  if (!project) {
    throw Object.assign(new Error("Project not found."), {
      statusCode: 404,
      code: "project_not_found",
    });
  }
  const body = await readJsonBody(req);
  const result = await reviseAnalysisRun({
    store: context.store,
    project,
    actorUserId: auth.user.id,
    analysisRunId,
    resultHash: body.resultHash,
    feedback: body.feedback,
    modelProvider: context.modelProvider,
    analysisToolRegistry: context.analysisToolRegistry,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "analysis_result.request_revision",
    targetType: "analysis_plan_revision",
    targetId: result.analysisPlanRevision.id,
    summary: `Requested analysis revision ${result.analysisPlanRevision.revision} from a prior run.`,
    metadata: {
      analysisThreadId: analysisRun.analysisThreadId,
      priorAnalysisRunId: analysisRun.id,
      priorAnalysisResultId: result.priorAnalysisResult?.id || null,
      priorResultHash: result.priorAnalysisResult?.contentHash || null,
    },
    ipAddress: clientIp(req),
    userAgent: userAgent(req),
  });
  sendJson(res, 201, {
    analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
    priorAnalysisRun: analysisRunSummary(result.priorAnalysisRun),
    priorAnalysisResult: analysisResultSummary(result.priorAnalysisResult),
  });
}

async function handleProjectChartInterpret(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, "viewer");
  const body = await readJsonBody(req);
  if (body.persistAsProposal) requireLabRole(auth, project.labId, "editor");
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    sendError(res, 400, "invalid_chart_interpret_request", "A chart prompt is required.", ["A chart prompt is required."]);
    return;
  }
  const evidenceIntent = parseChartEvidenceIntent(prompt);
  if (evidenceIntent) {
    const resolvedEvidence = await resolveChartEvidenceIntent({
      context,
      project,
      evidenceIntent,
    });
    const baseResponse = shapeChartInterpretResponse({
      chartSpecDraft: null,
      clarification: resolvedEvidence.clarification,
      warnings: resolvedEvidence.sourceExtractPreview?.warnings || [],
      evidenceIntent,
      evidenceResolution: resolvedEvidence.evidenceResolution,
      sourceExtractPreview: resolvedEvidence.sourceExtractPreview,
    });
    if (resolvedEvidence.clarification || !resolvedEvidence.sourceExtractPreview || !body.persistAsProposal) {
      sendJson(res, 200, {
        ...baseResponse,
        chartProposalSet: null,
      });
      return;
    }
    const sourceExtractProposal = await createSourceExtractProposalFromEvidence({
      context,
      project,
      sourceDocument: resolvedEvidence.sourceDocument,
      sourceRegion: resolvedEvidence.sourceRegion,
      sourceExtractPreview: resolvedEvidence.sourceExtractPreview,
      evidenceIntent,
      createdBy: auth.user.id,
    });
    sendJson(res, 200, {
      ...baseResponse,
      sourceExtractProposal,
      chartProposalSet: null,
    });
    return;
  }
  sendError(
    res,
    409,
    "data_snapshot_chart_not_implemented",
    "Charting accepted experiment snapshots is not implemented yet. Select explicit workbook source evidence for source-backed charting.",
  );
}

async function handleProjectImportRunsList(req, res, context, projectId) {
  await projectAuth(req, context, projectId, "viewer");
  const importRuns = await context.store.listImportRuns({ projectId });
  sendJson(res, 200, { importRuns: importRuns.map(importRunSummary) });
}

async function handleProjectSourceDocuments(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const sourceDocuments = context.store.listSourceDocuments
    ? await context.store.listSourceDocuments({ projectId: project.id })
    : [];
  sendJson(res, 200, {
    schemaVersion: SOURCE_DOCUMENT_LIST_SCHEMA_VERSION,
    projectId: project.id,
    sourceDocuments: sourceDocuments.map(sourceDocumentSummary),
    summary: { count: sourceDocuments.length },
  });
}

async function handleSourceDocumentRegions(req, res, context, sourceDocumentId) {
  const { sourceDocument } = await sourceDocumentAuth(req, context, sourceDocumentId, "viewer");
  const regions = context.store.listSourceRegions
    ? await context.store.listSourceRegions({ sourceDocumentId: sourceDocument.id })
    : [];
  sendJson(res, 200, {
    schemaVersion: SOURCE_REGION_LIST_SCHEMA_VERSION,
    sourceDocument: sourceDocumentSummary(sourceDocument),
    regions: regions.map(sourceRegionSummary),
    summary: { count: regions.length },
  });
}

async function handleSourceDocumentQuery(req, res, context, sourceDocumentId) {
  const { sourceDocument } = await sourceDocumentAuth(req, context, sourceDocumentId, "viewer");
  const body = await readJsonBody(req);
  const regions = context.store.listSourceRegions
    ? await context.store.listSourceRegions({ sourceDocumentId: sourceDocument.id })
    : [];
  const indexBlobs = context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  const result = querySourceDocument({
    sourceDocument,
    regions,
    indexBlobs,
    query: body.query,
    limit: body.limit,
  });
  sendJson(res, 200, result);
}

async function handleSourceDocumentRange(req, res, context, sourceDocumentId) {
  const { sourceDocument } = await sourceDocumentAuth(req, context, sourceDocumentId, "viewer");
  const body = await readJsonBody(req);
  const indexBlobs = context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  const result = readSourceDocumentRange({
    sourceDocument,
    indexBlobs,
    sheetName: body.sheetName,
    range: body.range,
    maxCells: body.maxCells,
  });
  sendJson(res, 200, result);
}

async function sourceDocumentForRegion(context, sourceRegion) {
  const sourceDocument = await context.store.findSourceDocumentById?.(sourceRegion.sourceDocumentId);
  if (!sourceDocument) {
    throw Object.assign(new Error("Source document not found for source region."), {
      statusCode: 404,
      code: "source_document_not_found",
    });
  }
  return sourceDocument;
}

async function buildExtractPreviewForRoute(context, { sourceDocument, sourceRegion = null, body = {} }) {
  const indexBlobs = context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  return buildSourceExtractPreview({
    sourceDocument,
    sourceRegion,
    indexBlobs,
    body,
  });
}

async function handleSourceDocumentExtractPreview(req, res, context, sourceDocumentId) {
  const { sourceDocument } = await sourceDocumentAuth(req, context, sourceDocumentId, "viewer");
  const body = await readJsonBody(req);
  const preview = await buildExtractPreviewForRoute(context, { sourceDocument, body });
  sendJson(res, 200, { preview });
}

async function handleSourceRegionExtractPreview(req, res, context, sourceRegionId) {
  const { sourceRegion } = await sourceRegionAuth(req, context, sourceRegionId, "viewer");
  const sourceDocument = await sourceDocumentForRegion(context, sourceRegion);
  const body = await readJsonBody(req);
  const preview = await buildExtractPreviewForRoute(context, { sourceDocument, sourceRegion, body });
  sendJson(res, 200, { preview });
}

async function resolveSourceExtractTarget(context, project, body) {
  let sourceRegion = null;
  let sourceDocument = null;
  if (body.sourceRegionId) {
    sourceRegion = await context.store.findSourceRegionById?.(body.sourceRegionId);
    if (!sourceRegion || sourceRegion.projectId !== project.id) {
      throw Object.assign(new Error("Source region not found for this project."), {
        statusCode: 404,
        code: "source_region_not_found",
      });
    }
    sourceDocument = await sourceDocumentForRegion(context, sourceRegion);
  } else if (body.sourceDocumentId) {
    sourceDocument = await context.store.findSourceDocumentById?.(body.sourceDocumentId);
    if (!sourceDocument || sourceDocument.projectId !== project.id) {
      throw Object.assign(new Error("Source document not found for this project."), {
        statusCode: 404,
        code: "source_document_not_found",
      });
    }
  } else {
    throw Object.assign(new Error("sourceRegionId or sourceDocumentId is required."), {
      statusCode: 400,
      code: "invalid_source_extract_request",
    });
  }
  return { sourceDocument, sourceRegion };
}

async function handleProjectSourceExtractProposals(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "POST" ? "editor" : "viewer");
  if (req.method === "GET") {
    const proposals = context.store.listSourceExtractProposals
      ? await context.store.listSourceExtractProposals({ projectId: project.id })
      : [];
    sendJson(res, 200, {
      sourceExtractProposals: proposals.map(sourceExtractProposalSummary),
    });
    return;
  }
  const body = await readJsonBody(req);
  const { sourceDocument, sourceRegion } = await resolveSourceExtractTarget(context, project, body);
  const preview = await buildExtractPreviewForRoute(context, { sourceDocument, sourceRegion, body });
  const proposal = await context.store.createSourceExtractProposal({
    labId: project.labId,
    projectId: project.id,
    sourceDocumentId: sourceDocument.id,
    sourceRegionId: sourceRegion?.id || null,
    status: body.status || "proposed",
    purpose: body.purpose || preview.purpose || "chart_source",
    extractType: body.extractType || preview.extractType || "table_range",
    intent: body.intent || {},
    preview,
    warnings: preview.warnings || [],
    decisionSummary: body.decisionSummary || {},
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "source.extract.propose",
    targetType: "source_extract_proposal",
    targetId: proposal.id,
    summary: `Created source extract proposal ${proposal.extractType || proposal.id}.`,
    metadata: {
      sourceDocumentId: sourceDocument.id,
      sourceRegionId: sourceRegion?.id || null,
      extractType: proposal.extractType || null,
    },
  });
  sendJson(res, 201, { sourceExtractProposal: sourceExtractProposalSummary(proposal) });
}

async function handleSourceExtractProposalPatch(req, res, context, proposalId) {
  const { auth, sourceExtractProposal } = await sourceExtractProposalAuth(req, context, proposalId, "editor");
  const body = await readJsonBody(req);
  const allowedStatuses = new Set(["proposed", "accepted", "rejected"]);
  const nextStatus = body.status == null ? sourceExtractProposal.status : String(body.status);
  if (!allowedStatuses.has(nextStatus)) {
    sendError(res, 400, "invalid_source_extract_status", "Source extract status must be proposed, accepted, or rejected.");
    return;
  }
  const updated = await context.store.updateSourceExtractProposal(sourceExtractProposal.id, {
    status: nextStatus,
    decisionSummary: body.decisionSummary || sourceExtractProposal.decisionSummary || {},
    warnings: body.warnings || sourceExtractProposal.warnings || [],
    updatedBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: sourceExtractProposal.labId,
    projectId: sourceExtractProposal.projectId,
    actorUserId: auth.user.id,
    action: nextStatus === "accepted"
      ? "source.extract.accept"
      : nextStatus === "rejected"
        ? "source.extract.reject"
        : "source.extract.update_decision",
    targetType: "source_extract_proposal",
    targetId: sourceExtractProposal.id,
    summary: `Updated source extract proposal to ${nextStatus}.`,
  });
  sendJson(res, 200, { sourceExtractProposal: sourceExtractProposalSummary(updated) });
}

async function handleSourceExtractChartProposal(req, res, context, proposalId) {
  const { auth, sourceExtractProposal } = await sourceExtractProposalAuth(req, context, proposalId, "editor");
  if (sourceExtractProposal.status !== "accepted") {
    sendError(res, 409, "source_extract_not_accepted", "Accept the source extract proposal before drafting a chart proposal.");
    return;
  }
  const proposal = chartProposalFromSourceExtract(sourceExtractProposal);
  const chartProposalSet = await context.store.createChartProposalSet({
    labId: sourceExtractProposal.labId,
    projectId: sourceExtractProposal.projectId,
    schemaVersion: "labrat.chartProposalSet.v1",
    status: "proposed",
    payload: {
      proposalSetId: `chart_proposal_set_source_extract_${sha256Hex(sourceExtractProposal.id).slice(0, 16)}`,
      schemaVersion: "labrat.chartProposalSet.v1",
      proposals: [proposal],
      warnings: proposal.warnings || [],
      origin: "source_extract",
      sourceExtractProposalId: sourceExtractProposal.id,
    },
    decisionSummary: { accepted: 0, rejected: 0, proposalCount: 1 },
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: sourceExtractProposal.labId,
    projectId: sourceExtractProposal.projectId,
    actorUserId: auth.user.id,
    action: "chart_proposal_set.create",
    targetType: "chart_proposal_set",
    targetId: chartProposalSet.id,
    summary: "Created chart proposal set from source extract proposal.",
    metadata: { sourceExtractProposalId: sourceExtractProposal.id },
  });
  sendJson(res, 201, {
    sourceExtractProposal: sourceExtractProposalSummary(sourceExtractProposal),
    chartProposalSet: chartProposalSetSummary(chartProposalSet),
  });
}

async function handleProjectChartProposalSets(req, res, context, projectId) {
  await projectAuth(req, context, projectId, "viewer");
  const chartProposalSets = await context.store.listChartProposalSets({ projectId });
  sendJson(res, 200, { chartProposalSets: chartProposalSets.map(chartProposalSetSummary) });
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
  await persistSourceIndexForImportRun(context, {
    project,
    fileObject,
    importRun,
    scanResult,
    actorUserId: auth.user.id,
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

async function scanFileObjectForSourceReview(context, { auth, project, fileObject }) {
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
    status: "source_review_ready",
    scanResult,
    warnings: scanResult.warnings || [],
    createdBy: auth.user.id,
  });
  const sourceDocument = await persistSourceIndexForImportRun(context, {
    project,
    fileObject,
    importRun,
    scanResult,
    actorUserId: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "import.scan",
    targetType: "import_run",
    targetId: importRun.id,
    summary: `Created source review scan for ${fileObject.originalName}.`,
  });
  return { importRun, sourceDocument };
}

async function sourceDocumentFromWorkbookReviewRequest(context, { auth, project, body }) {
  if (body.sourceDocumentId) {
    const sourceDocument = await context.store.findSourceDocumentById?.(body.sourceDocumentId);
    if (!sourceDocument || sourceDocument.projectId !== project.id) {
      throw Object.assign(new Error("Source document not found for this project."), {
        statusCode: 404,
        code: "source_document_not_found",
      });
    }
    return { sourceDocument, importRun: null };
  }
  if (!body.fileObjectId) {
    throw Object.assign(new Error("fileObjectId or sourceDocumentId is required."), {
      statusCode: 400,
      code: "invalid_workbook_review_session_request",
    });
  }
  const fileObject = await context.store.findFileObjectById(body.fileObjectId);
  if (!fileObject || fileObject.projectId !== project.id) {
    throw Object.assign(new Error("File object not found."), {
      statusCode: 404,
      code: "file_object_not_found",
    });
  }
  const existingDocuments = context.store.listSourceDocuments
    ? await context.store.listSourceDocuments({ projectId: project.id })
    : [];
  const existing = existingDocuments.find((document) => document.fileObjectId === fileObject.id);
  if (existing) return { sourceDocument: existing, importRun: null };
  return scanFileObjectForSourceReview(context, { auth, project, fileObject });
}

async function handleProjectWorkbookReviewSessions(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "POST" ? "editor" : "viewer");
  if (req.method === "GET") {
    const sessions = context.store.listWorkbookReviewSessions
      ? await context.store.listWorkbookReviewSessions({ projectId: project.id })
      : [];
    sendJson(res, 200, { workbookReviewSessions: sessions.map(workbookReviewSessionSummary) });
    return;
  }
  const body = await readJsonBody(req);
  if (!context.store.createWorkbookReviewSession) {
    sendError(res, 500, "workbook_review_session_unavailable", "Workbook review session store is unavailable.");
    return;
  }
  const { sourceDocument, importRun } = await sourceDocumentFromWorkbookReviewRequest(context, {
    auth,
    project,
    body,
  });
  const regions = context.store.listSourceRegions
    ? await context.store.listSourceRegions({ sourceDocumentId: sourceDocument.id })
    : [];
  const indexBlobs = context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  const draft = buildWorkbookReviewSessionDraft({ sourceDocument, regions, indexBlobs });
  const session = await context.store.createWorkbookReviewSession({
    labId: project.labId,
    projectId: project.id,
    sourceDocumentId: sourceDocument.id,
    ...draft,
    regions: regions.map(sourceRegionSummary),
    createdBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "workbook_review_session.create",
    targetType: "workbook_review_session",
    targetId: session.id,
    summary: `Created workbook review session for ${draft.workbookSummary.workbookName}.`,
    metadata: { sourceDocumentId: sourceDocument.id, importRunId: importRun?.id || null },
  });
  sendJson(res, 201, {
    workbookReviewSession: workbookReviewSessionSummary(session),
    session: workbookReviewSessionSummary(session),
    sourceDocument: sourceDocumentSummary(sourceDocument),
    regions: regions.map(sourceRegionSummary),
    importRun: importRun ? importRunSummary(importRun) : null,
  });
}

async function handleProjectWorkbookUnderstandings(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const understandings = context.store.listWorkbookUnderstandings
    ? await context.store.listWorkbookUnderstandings({ projectId: project.id })
    : [];
  sendJson(res, 200, { workbookUnderstandings: understandings.map(workbookUnderstandingSummary) });
}

async function handleWorkbookReviewSessionById(req, res, context, sessionId) {
  const { workbookReviewSession } = await workbookReviewSessionAuth(req, context, sessionId, "viewer");
  const sourceDocument = await context.store.findSourceDocumentById?.(workbookReviewSession.sourceDocumentId);
  const regions = sourceDocument && context.store.listSourceRegions
    ? await context.store.listSourceRegions({ sourceDocumentId: sourceDocument.id })
    : [];
  sendJson(res, 200, {
    workbookReviewSession: workbookReviewSessionSummary(workbookReviewSession),
    session: workbookReviewSessionSummary(workbookReviewSession),
    sourceDocument: sourceDocument ? sourceDocumentSummary(sourceDocument) : null,
    regions: regions.map(sourceRegionSummary),
  });
}

function sendWorkbookReviewClarification(res, statusCode, error, workbookReviewSession) {
  sendJson(res, statusCode || 400, {
    workbookReviewSession: workbookReviewSessionSummary(workbookReviewSession),
    session: workbookReviewSessionSummary(workbookReviewSession),
    workbookUnderstandingDraft: workbookReviewSession?.currentUnderstanding || null,
    messages: [],
    clarification: error.details?.clarification || {
      code: error.code || "workbook_review_revision_failed",
      message: error.message || "Workbook review revision failed.",
    },
    validation: error.details?.validation || {
      status: "invalid",
      code: error.code || "workbook_review_revision_failed",
    },
  });
}

async function handleWorkbookReviewSessionRevision(req, res, context, sessionId) {
  const { auth, workbookReviewSession } = await workbookReviewSessionAuth(req, context, sessionId, "editor");
  const body = await readJsonBody(req);
  const sourceDocument = await context.store.findSourceDocumentById?.(workbookReviewSession.sourceDocumentId);
  const indexBlobs = sourceDocument && context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  if (!context.store.updateWorkbookReviewSession) {
    sendError(res, 500, "workbook_review_session_unavailable", "Workbook review session store is unavailable.");
    return;
  }
  let revision;
  try {
    revision = applyWorkbookReviewRevision({
      workbookReviewSession,
      sourceDocument,
      indexBlobs,
      body,
      actorUserId: auth.user.id,
    });
  } catch (error) {
    sendWorkbookReviewClarification(res, error.statusCode || 400, error, workbookReviewSession);
    return;
  }
  const updated = await context.store.updateWorkbookReviewSession(workbookReviewSession.id, revision.sessionPatch);
  await context.store.recordAuditEvent({
    labId: workbookReviewSession.labId,
    projectId: workbookReviewSession.projectId,
    actorUserId: auth.user.id,
    action: "workbook_review.revise",
    targetType: "workbook_review_session",
    targetId: workbookReviewSession.id,
    summary: "Updated workbook understanding draft from user correction.",
    metadata: {
      sourceDocumentId: workbookReviewSession.sourceDocumentId,
      redBoxUpdateCount: revision.validation.redBoxUpdateCount,
      understandingDraftId: revision.workbookUnderstandingDraft.id,
    },
  });
  sendJson(res, 200, {
    workbookReviewSession: workbookReviewSessionSummary(updated),
    session: workbookReviewSessionSummary(updated),
    workbookUnderstandingDraft: revision.workbookUnderstandingDraft,
    messages: revision.messages,
    clarification: null,
    validation: revision.validation,
    changedRegions: revision.changedRegions,
    revisionMode: revision.revisionMode,
    activeDraftRegionId: revision.activeDraftRegionId,
  });
}

async function handleWorkbookReviewSessionConfirm(req, res, context, sessionId) {
  const { auth, workbookReviewSession } = await workbookReviewSessionAuth(req, context, sessionId, "editor");
  const body = await readJsonBody(req);
  if (!context.store.createWorkbookUnderstanding || !context.store.updateWorkbookReviewSession) {
    sendError(res, 500, "workbook_understanding_unavailable", "Workbook understanding store is unavailable.");
    return;
  }
  let confirmation;
  try {
    confirmation = buildWorkbookUnderstandingForConfirmation({
      workbookReviewSession,
      body,
      actorUserId: auth.user.id,
    });
  } catch (error) {
    sendError(res, error.statusCode || 400, error.code || "workbook_understanding_confirm_failed", error.message, error.details);
    return;
  }
  const workbookUnderstanding = await context.store.createWorkbookUnderstanding(confirmation.understandingInput);
  const updated = await context.store.updateWorkbookReviewSession(workbookReviewSession.id, confirmation.sessionPatch);
  await context.store.recordAuditEvent({
    labId: workbookReviewSession.labId,
    projectId: workbookReviewSession.projectId,
    actorUserId: auth.user.id,
    action: "workbook_review.confirm_understanding",
    targetType: "workbook_understanding",
    targetId: workbookUnderstanding.id,
    summary: "Confirmed workbook understanding.",
    metadata: {
      sourceDocumentId: workbookReviewSession.sourceDocumentId,
      workbookReviewSessionId: workbookReviewSession.id,
      factCount: asArray(workbookUnderstanding.facts).length,
    },
  });
  sendJson(res, 200, {
    workbookReviewSession: workbookReviewSessionSummary(updated),
    session: workbookReviewSessionSummary(updated),
    workbookUnderstanding: workbookUnderstandingSummary(workbookUnderstanding),
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
  const sourceBacked = isSourceBackedChartProposal(proposal);
  if (!sourceBacked) {
    sendError(
      res,
      409,
      "data_snapshot_chart_not_implemented",
      "Only source-backed chart proposals can create ChartSpecs until accepted DataSnapshot charting is implemented.",
    );
    return;
  }
  const chartValidation = validateChartSpecProposal({ proposal: chartSpecProposalPayload(proposal) });
  const chartSpecPayload = chartValidation.chartSpec;
  const chartSpec = await context.store.createChartSpec({
    labId: project.labId,
    projectId: project.id,
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
  await projectAuth(req, context, projectId, "viewer");
  const chartSpecs = await context.store.listChartSpecs({ projectId });
  sendJson(res, 200, { chartSpecs: chartSpecs.filter(isSourceBackedChartSpec) });
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
  const projectEvidenceRetrieveMatch = pathName.match(/^\/api\/projects\/([^/]+)\/evidence\/retrieve$/);
  if (projectEvidenceRetrieveMatch && req.method === "POST") return handleProjectEvidenceRetrieve(req, res, context, projectEvidenceRetrieveMatch[1]);
  const projectDataPlanDraftMatch = pathName.match(/^\/api\/projects\/([^/]+)\/data-plans\/draft$/);
  if (projectDataPlanDraftMatch && req.method === "POST") return handleProjectDataPlanDraft(req, res, context, projectDataPlanDraftMatch[1]);
  const projectDataPlanPublishMatch = pathName.match(/^\/api\/projects\/([^/]+)\/data-plans\/publish$/);
  if (projectDataPlanPublishMatch && req.method === "POST") return handleProjectDataPlanPublish(req, res, context, projectDataPlanPublishMatch[1]);
  const projectDataPlansMatch = pathName.match(/^\/api\/projects\/([^/]+)\/data-plans$/);
  if (projectDataPlansMatch && req.method === "GET") return handleProjectDataPlans(req, res, context, projectDataPlansMatch[1]);
  const projectDataSnapshotsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/data-snapshots$/);
  if (projectDataSnapshotsMatch && req.method === "GET") return handleProjectDataSnapshots(req, res, context, projectDataSnapshotsMatch[1]);
  const projectExperimentBrowserMatch = pathName.match(/^\/api\/projects\/([^/]+)\/experiment-browser$/);
  if (projectExperimentBrowserMatch && req.method === "GET") {
    return handleProjectExperimentBrowser(req, res, context, projectExperimentBrowserMatch[1], url);
  }
  const projectExperimentDetailMatch = pathName.match(/^\/api\/projects\/([^/]+)\/experiments\/([^/]+)$/);
  if (projectExperimentDetailMatch && req.method === "GET") {
    return handleProjectExperimentDetail(req, res, context, projectExperimentDetailMatch[1], projectExperimentDetailMatch[2]);
  }
  const projectBrowserViewsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/browser-views$/);
  if (projectBrowserViewsMatch && (req.method === "GET" || req.method === "POST")) {
    return handleProjectBrowserViews(req, res, context, projectBrowserViewsMatch[1]);
  }
  const projectBrowserViewMatch = pathName.match(/^\/api\/projects\/([^/]+)\/browser-views\/([^/]+)$/);
  if (projectBrowserViewMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    return handleProjectBrowserViewById(req, res, context, projectBrowserViewMatch[1], projectBrowserViewMatch[2]);
  }
  const projectAgentPlanMatch = pathName.match(/^\/api\/projects\/([^/]+)\/agent\/plan$/);
  if (projectAgentPlanMatch && req.method === "POST") return handleProjectAgentPlan(req, res, context, projectAgentPlanMatch[1]);
  const projectAgentRunsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/agent\/runs$/);
  if (projectAgentRunsMatch && (req.method === "GET" || req.method === "POST")) return handleProjectAgentRuns(req, res, context, projectAgentRunsMatch[1]);
  const projectAnalysisThreadsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/analysis-threads$/);
  if (projectAnalysisThreadsMatch && (req.method === "GET" || req.method === "POST")) {
    return handleProjectAnalysisThreads(req, res, context, projectAnalysisThreadsMatch[1], url);
  }
  const projectChartInterpretMatch = pathName.match(/^\/api\/projects\/([^/]+)\/charts\/interpret$/);
  if (projectChartInterpretMatch && req.method === "POST") return handleProjectChartInterpret(req, res, context, projectChartInterpretMatch[1]);
  const projectMatch = pathName.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && (req.method === "GET" || req.method === "PATCH")) return handleProjectById(req, res, context, projectMatch[1]);
  const fileMatch = pathName.match(/^\/api\/projects\/([^/]+)\/files$/);
  if (fileMatch && req.method === "GET") return handleProjectFiles(req, res, context, fileMatch[1]);
  if (fileMatch && req.method === "POST") return handleProjectFileUpload(req, res, context, fileMatch[1]);
  const importRunsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/import-runs$/);
  if (importRunsMatch && req.method === "GET") return handleProjectImportRunsList(req, res, context, importRunsMatch[1]);
  if (importRunsMatch && req.method === "POST") return handleProjectImportRuns(req, res, context, importRunsMatch[1]);
  const sourceDocumentsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/source-documents$/);
  if (sourceDocumentsMatch && req.method === "GET") return handleProjectSourceDocuments(req, res, context, sourceDocumentsMatch[1]);
  const workbookReviewSessionsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/workbook-review-sessions$/);
  if (workbookReviewSessionsMatch && (req.method === "GET" || req.method === "POST")) {
    return handleProjectWorkbookReviewSessions(req, res, context, workbookReviewSessionsMatch[1]);
  }
  const workbookUnderstandingsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/workbook-understandings$/);
  if (workbookUnderstandingsMatch && req.method === "GET") return handleProjectWorkbookUnderstandings(req, res, context, workbookUnderstandingsMatch[1]);
  const sourceExtractProposalsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/source-extract-proposals$/);
  if (sourceExtractProposalsMatch && (req.method === "GET" || req.method === "POST")) {
    return handleProjectSourceExtractProposals(req, res, context, sourceExtractProposalsMatch[1]);
  }
  const sourceDocumentRegionsMatch = pathName.match(/^\/api\/source-documents\/([^/]+)\/regions$/);
  if (sourceDocumentRegionsMatch && req.method === "GET") return handleSourceDocumentRegions(req, res, context, sourceDocumentRegionsMatch[1]);
  const sourceDocumentQueryMatch = pathName.match(/^\/api\/source-documents\/([^/]+)\/query$/);
  if (sourceDocumentQueryMatch && req.method === "POST") return handleSourceDocumentQuery(req, res, context, sourceDocumentQueryMatch[1]);
  const sourceDocumentRangeMatch = pathName.match(/^\/api\/source-documents\/([^/]+)\/range$/);
  if (sourceDocumentRangeMatch && req.method === "POST") return handleSourceDocumentRange(req, res, context, sourceDocumentRangeMatch[1]);
  const sourceDocumentExtractPreviewMatch = pathName.match(/^\/api\/source-documents\/([^/]+)\/extract-preview$/);
  if (sourceDocumentExtractPreviewMatch && req.method === "POST") return handleSourceDocumentExtractPreview(req, res, context, sourceDocumentExtractPreviewMatch[1]);
  const sourceRegionExtractPreviewMatch = pathName.match(/^\/api\/source-regions\/([^/]+)\/extract-preview$/);
  if (sourceRegionExtractPreviewMatch && req.method === "POST") return handleSourceRegionExtractPreview(req, res, context, sourceRegionExtractPreviewMatch[1]);
  const workbookReviewSessionMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)$/);
  if (workbookReviewSessionMatch && req.method === "GET") return handleWorkbookReviewSessionById(req, res, context, workbookReviewSessionMatch[1]);
  const workbookReviewSessionRevisionMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)\/revisions$/);
  if (workbookReviewSessionRevisionMatch && req.method === "POST") return handleWorkbookReviewSessionRevision(req, res, context, workbookReviewSessionRevisionMatch[1]);
  const workbookReviewSessionConfirmMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)\/confirm$/);
  if (workbookReviewSessionConfirmMatch && req.method === "POST") return handleWorkbookReviewSessionConfirm(req, res, context, workbookReviewSessionConfirmMatch[1]);
  const sourceExtractProposalChartMatch = pathName.match(/^\/api\/source-extract-proposals\/([^/]+)\/chart-proposal$/);
  if (sourceExtractProposalChartMatch && req.method === "POST") return handleSourceExtractChartProposal(req, res, context, sourceExtractProposalChartMatch[1]);
  const sourceExtractProposalMatch = pathName.match(/^\/api\/source-extract-proposals\/([^/]+)$/);
  if (sourceExtractProposalMatch && req.method === "PATCH") return handleSourceExtractProposalPatch(req, res, context, sourceExtractProposalMatch[1]);
  const agentRunConfirmMatch = pathName.match(/^\/api\/agent-runs\/([^/]+)\/confirm$/);
  if (agentRunConfirmMatch && req.method === "POST") return handleAgentRunConfirm(req, res, context, agentRunConfirmMatch[1]);
  const agentRunCancelMatch = pathName.match(/^\/api\/agent-runs\/([^/]+)\/cancel$/);
  if (agentRunCancelMatch && req.method === "POST") return handleAgentRunCancel(req, res, context, agentRunCancelMatch[1]);
  const agentRunMatch = pathName.match(/^\/api\/agent-runs\/([^/]+)$/);
  if (agentRunMatch && req.method === "GET") return handleAgentRunById(req, res, context, agentRunMatch[1]);
  const analysisPlanRevisionSelectionMatch = pathName.match(/^\/api\/analysis-plan-revisions\/([^/]+)\/selection$/);
  if (analysisPlanRevisionSelectionMatch && req.method === "GET") {
    return handleAnalysisPlanSelection(req, res, context, analysisPlanRevisionSelectionMatch[1], url);
  }
  const analysisPlanRevisionAcceptMatch = pathName.match(/^\/api\/analysis-plan-revisions\/([^/]+)\/accept$/);
  if (analysisPlanRevisionAcceptMatch && req.method === "POST") {
    return handleAnalysisPlanAccept(req, res, context, analysisPlanRevisionAcceptMatch[1]);
  }
  const analysisRunResultPreviewMatch = pathName.match(/^\/api\/analysis-runs\/([^/]+)\/result-preview$/);
  if (analysisRunResultPreviewMatch && req.method === "GET") {
    return handleAnalysisResultPreview(req, res, context, analysisRunResultPreviewMatch[1], url);
  }
  const analysisRunExecuteMatch = pathName.match(/^\/api\/analysis-runs\/([^/]+)\/execute$/);
  if (analysisRunExecuteMatch && req.method === "POST") {
    return handleAnalysisRunExecute(req, res, context, analysisRunExecuteMatch[1]);
  }
  const analysisRunReviseMatch = pathName.match(/^\/api\/analysis-runs\/([^/]+)\/revise$/);
  if (analysisRunReviseMatch && req.method === "POST") {
    return handleAnalysisRunRevise(req, res, context, analysisRunReviseMatch[1]);
  }
  const analysisRunMatch = pathName.match(/^\/api\/analysis-runs\/([^/]+)$/);
  if (analysisRunMatch && req.method === "GET") {
    return handleAnalysisRunById(req, res, context, analysisRunMatch[1]);
  }
  const analysisThreadPlanRevisionsMatch = pathName.match(/^\/api\/analysis-threads\/([^/]+)\/plan-revisions$/);
  if (analysisThreadPlanRevisionsMatch && req.method === "POST") {
    return handleAnalysisPlanRevisions(req, res, context, analysisThreadPlanRevisionsMatch[1]);
  }
  const analysisThreadMatch = pathName.match(/^\/api\/analysis-threads\/([^/]+)$/);
  if (analysisThreadMatch && req.method === "GET") {
    return handleAnalysisThreadById(req, res, context, analysisThreadMatch[1]);
  }
  const chartProposalSetsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/chart-proposal-sets$/);
  if (chartProposalSetsMatch && req.method === "GET") return handleProjectChartProposalSets(req, res, context, chartProposalSetsMatch[1]);
  const chartProposalSetMatch = pathName.match(/^\/api\/chart-proposal-sets\/([^/]+)$/);
  if (chartProposalSetMatch && req.method === "PATCH") return handleChartProposalSetPatch(req, res, context, chartProposalSetMatch[1]);
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
    && !req.url?.startsWith("/api/source-documents")
    && !req.url?.startsWith("/api/source-regions")
    && !req.url?.startsWith("/api/workbook-review-sessions")
    && !req.url?.startsWith("/api/source-extract-proposals")
    && !req.url?.startsWith("/api/agent-runs")
    && !req.url?.startsWith("/api/analysis-threads")
    && !req.url?.startsWith("/api/analysis-plan-revisions")
    && !req.url?.startsWith("/api/analysis-runs")
    && !req.url?.startsWith("/api/import-runs")
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
