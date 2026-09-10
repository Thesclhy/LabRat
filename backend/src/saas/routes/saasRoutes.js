import path from "node:path";
import { sendJson } from "../../http/json.js";
import { readRequestBody } from "../../http/body.js";
import { parseMultipartFormData } from "../../http/multipart.js";
import { sourceCellClasses } from "../formulaGraph.js";
import { runImportScan } from "../../import/services/importPipeline.js";
import { getAuthContext, publicUser, requireAuth, requireLabRole, requireSuperAdmin } from "../authz.js";
import { clearSessionCookie, setSessionCookie } from "../cookies.js";
import { deleteUploadedFile, persistUploadedFile, readFileObjectBuffer } from "../fileStorage.js";
import { makeId, makeSessionToken, sha256Hex } from "../ids.js";
import { isJsonContentType, readJsonBody, routeUrl, sendError } from "../http.js";
import { verifyPassword } from "../passwords.js";
import { runEvidenceRetrievalAgent } from "../evidenceAgentRetrieval.js";
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
  SOURCE_RANGE_MAX_CELLS,
} from "../sourceDocuments.js";
import {
  buildWorkbookReviewSessionDraft,
  workbookReviewSessionSummary,
} from "../workbookReviewSessions.js";
import {
  confirmWorkbookReviewRegion,
  createWorkbookReviewRegionDraft,
  createWorkbookReviewRegionRecord,
  deleteWorkbookReviewRegion,
  ignoreWorkbookReviewRegion,
  interpretWorkbookReviewRegion,
  reviseWorkbookReviewRegion,
} from "../workbookReviewRegions.js";
import {
  agentRunSummary,
  buildAgentRunDraft,
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
  retryAnalysisRunGeneration,
  reviseAnalysisRun,
} from "../analysisThreads.js";
import { publishAcceptedAnalysisChart } from "../analysisChartPublisher.js";
import { publishAcceptedExperimentAnalysis } from "../analysisExperimentPublisher.js";
import {
  CHART_STYLE_PROFILE_SCHEMA_VERSION,
  REUSABLE_CHART_TEMPLATE_SCHEMA_VERSION,
  buildChartStyleProfileVersion,
  buildReusableChartTemplateVersion,
  chartStyleProfileSummary,
  deriveReusableChartTemplateDefinition,
  inspectReusableChartTemplateEligibility,
  reusableChartDescription,
  reusableChartName,
  reusableChartTemplateSummary,
} from "../reusableChartTemplates.js";
import {
  buildReusableChartTemplateApplicationArtifacts,
  prepareReusableChartTemplateApplication,
} from "../reusableChartTemplateApplications.js";

const PROJECT_PROFILE_SCHEMA_VERSION = "labrat.projectProfile.v1";
const ANALYSIS_RETRY_LEASE_MS = 6 * 60 * 1000;
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

function planningWarningFromError(error) {
  const errors = asArray(error?.details?.errors).slice(0, 8);
  const first = errors[0] || null;
  const providerWarning = error?.details?.warning || null;
  const providerMetadata = error?.details?.providerMetadata || null;
  const location = Number.isInteger(Number(first?.line)) ? ` at line ${Number(first.line)}` : "";
  const detailMessage = first?.message
    ? `${first.message}${location}.`
    : "";
  return {
    code: error?.code || "analysis_plan_draft_failed",
    message: [
      error?.message || "The reviewed analysis plan could not be drafted.",
      detailMessage,
    ].filter(Boolean).join(" "),
    severity: "warning",
    ...((errors.length || providerWarning) ? {
      details: {
        ...(errors.length ? { errors } : {}),
        ...(providerWarning ? {
          provider: {
            code: providerWarning.code || null,
            message: providerWarning.message || null,
            detail: providerWarning.detail || null,
            ...(providerMetadata ? {
              provider: providerMetadata.provider || null,
              model: providerMetadata.model || null,
              latencyMs: Number(providerMetadata.latencyMs) || 0,
              usage: {
                inputTokens: Number(providerMetadata.usage?.inputTokens) || 0,
                outputTokens: Number(providerMetadata.usage?.outputTokens) || 0,
                reasoningTokens: Number(providerMetadata.usage?.reasoningTokens) || 0,
              },
              repairAttempts: Number(providerMetadata.repairAttempts) || 0,
            } : {}),
          },
        } : {}),
      },
    } : {}),
  };
}

function analysisThreadPlanFailure(agentRuns, analysisThreadId) {
  const run = asArray(agentRuns).find((candidate) => (
    asArray(candidate?.proposalRefs).some((ref) => (
      ref?.type === "analysis_thread" && ref.id === analysisThreadId
    ))
    && asArray(candidate?.warnings).some((warning) => warning?.code !== "analysis_evidence_required")
  ));
  return run
    ? asArray(run.warnings).filter((warning) => warning?.code !== "analysis_evidence_required").at(-1) || null
    : null;
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

function projectSummary(project, workflowSummary = null) {
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
    ...(workflowSummary ? { workflowSummary } : {}),
  };
}

async function projectWorkflowSummaryForStore(store, projectId) {
  const [experimentSnapshotHeads, chartSpecs, chartStyleProfiles, reusableChartTemplates] = await Promise.all([
    store.listExperimentSnapshotHeads({ projectId }),
    store.listChartSpecs({ projectId }),
    store.listChartStyleProfiles?.({ projectId }) || [],
    store.listReusableChartTemplates?.({ projectId }) || [],
  ]);
  return {
    publishedExperimentCount: asArray(experimentSnapshotHeads).length,
    chartSpecCount: asArray(chartSpecs).filter(isSupportedChartSpec).length,
    chartStyleProfileCount: asArray(chartStyleProfiles).length,
    reusableChartTemplateCount: asArray(reusableChartTemplates).length,
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

function isAnalysisResultChartSpec(chartSpec = {}) {
  const spec = isObject(chartSpec.spec) ? chartSpec.spec : chartSpec;
  return spec.origin === "analysis_result" && spec.schemaVersion === "labrat.chartSpec.v3";
}

function isSupportedChartSpec(chartSpec = {}) {
  return isAnalysisResultChartSpec(chartSpec);
}

function chartSpecListItem(chartSpec = {}) {
  if (!isAnalysisResultChartSpec(chartSpec)) return chartSpec;
  const spec = chartSpec.spec || {};
  const {
    plotly,
    traceCatalog,
    sourceSelections,
    sourceRefs,
    ...metadata
  } = spec;
  return {
    ...chartSpec,
    spec: {
      ...metadata,
      traceCatalog: asArray(traceCatalog).map((trace) => ({
        traceId: trace?.traceId || null,
        name: trace?.name || null,
        type: trace?.type || null,
        pointCount: Number(trace?.pointCount) || 0,
      })),
      sourceSelectionCount: asArray(sourceSelections).length,
      sourceRefCount: asArray(sourceRefs).length,
      plotlyTraceCount: asArray(plotly?.data).length,
      detailRequired: true,
    },
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

function publicAnalysisCapabilityConfig(config, fallback) {
  const value = typeof config?.publicConfig === "function" ? config.publicConfig() : {};
  return {
    ...fallback,
    ...(value && typeof value === "object" ? value : {}),
  };
}

function isEvidenceBlockedAnalysisThread(agentRuns, analysisThreadId) {
  return asArray(agentRuns).some((agentRun) => (
    asArray(agentRun.proposalRefs).some((proposalRef) => (
      proposalRef?.type === "analysis_thread" && proposalRef.id === analysisThreadId
    ))
    && asArray(agentRun.warnings).some((warning) => warning?.code === "analysis_evidence_required")
  ));
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

async function workbookReviewSessionAuth(req, context, sessionId, role = "viewer") {
  const auth = requireAuth(await authFor(req, context));
  const workbookReviewSession = await context.store.findWorkbookReviewSessionById?.(sessionId);
  if (!workbookReviewSession) {
    throw Object.assign(new Error("Workbook review session not found."), {
      statusCode: 404,
      code: "workbook_review_session_not_found",
    });
  }
  if (workbookReviewSession.status === "deleted") {
    throw Object.assign(new Error("Workbook review session not found."), {
      statusCode: 404,
      code: "workbook_review_session_not_found",
    });
  }
  requireLabRole(auth, workbookReviewSession.labId, role);
  return { auth, workbookReviewSession };
}

async function workbookReviewRegionAuth(req, context, sessionId, regionId, role = "viewer") {
  const { auth, workbookReviewSession } = await workbookReviewSessionAuth(req, context, sessionId, role);
  const region = await context.store.findWorkbookReviewRegionById?.(regionId);
  if (!region || region.workbookReviewSessionId !== workbookReviewSession.id) {
    throw Object.assign(new Error("Workbook review region not found."), {
      statusCode: 404,
      code: "workbook_review_region_not_found",
    });
  }
  return { auth, workbookReviewSession, region };
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
    const projects = (await context.store.listProjects({ labId }))
      .filter((project) => project.status !== "deleted");
    const summaries = await Promise.all(projects.map(async (project) => projectSummary(
      project,
      await projectWorkflowSummaryForStore(context.store, project.id),
    )));
    sendJson(res, 200, { projects: summaries });
    return;
  }
  const body = await readJsonBody(req);
  const labId = body.labId || auth.labs[0]?.labId || auth.labs[0]?.id || "";
  if (!labId) {
    sendError(res, 400, "invalid_project_request", "Create or select a lab before creating a project.");
    return;
  }
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
    chartSpecs,
    manuscripts,
    workbookReviewSessions,
    workbookReviewRegions,
    regionUnderstandings,
    agentRuns,
    analysisThreads,
    dataPlans,
    dataSnapshots,
    experimentSnapshotHeads,
    browserViews,
    projectBrowserConfig,
    sourceDocuments,
    chartStyleProfiles,
    reusableChartTemplates,
  ] = await Promise.all([
    context.store.listFileObjects({ projectId }),
    context.store.listImportRuns({ projectId }),
    context.store.listChartSpecs({ projectId }),
    context.store.listManuscripts({ projectId }),
    context.store.listWorkbookReviewSessions ? context.store.listWorkbookReviewSessions({ projectId }) : [],
    context.store.listWorkbookReviewRegions ? context.store.listWorkbookReviewRegions({ projectId }) : [],
    context.store.listAcceptedRegionUnderstandings ? context.store.listAcceptedRegionUnderstandings({ projectId }) : [],
    context.store.listAgentRuns ? context.store.listAgentRuns({ projectId }) : [],
    context.store.listAnalysisThreads ? context.store.listAnalysisThreads({ projectId }) : [],
    context.store.listDataPlans ? context.store.listDataPlans({ projectId }) : [],
    context.store.listDataSnapshots ? context.store.listDataSnapshots({ projectId }) : [],
    context.store.listExperimentSnapshotHeads ? context.store.listExperimentSnapshotHeads({ projectId }) : [],
    context.store.listBrowserViews ? context.store.listBrowserViews({ projectId, ownerUserId: auth.user.id }) : [],
    context.store.findProjectBrowserConfig ? context.store.findProjectBrowserConfig({ projectId }) : null,
    context.store.listSourceDocuments ? context.store.listSourceDocuments({ projectId }) : [],
    context.store.listChartStyleProfiles ? context.store.listChartStyleProfiles({ projectId }) : [],
    context.store.listReusableChartTemplates ? context.store.listReusableChartTemplates({ projectId }) : [],
  ]);
  const supportedChartSpecs = chartSpecs.filter(isSupportedChartSpec);
  const activeWorkbookReviewSessionIds = new Set(
    workbookReviewSessions.map((session) => session.id),
  );
  const activeWorkbookReviewRegions = workbookReviewRegions.filter(
    (region) => activeWorkbookReviewSessionIds.has(region.workbookReviewSessionId),
  );
  const activeRegionUnderstandings = regionUnderstandings.filter(
    ({ region }) => activeWorkbookReviewSessionIds.has(region.workbookReviewSessionId),
  );
  sendJson(res, 200, {
    project: projectSummary(project),
    projectProfile: projectProfileFor(project),
    fileObjects: fileObjects.map(fileObjectSummary),
    importRuns: importRuns.map(importRunSummary),
    chartSpecs: supportedChartSpecs.map(chartSpecListItem),
    manuscripts,
    workbookReviewSessions: workbookReviewSessions.map(workbookReviewSessionSummary),
    workbookReviewRegions: await Promise.all(activeWorkbookReviewRegions.map((region) => workbookReviewRegionSummary(context, region))),
    regionUnderstandings: activeRegionUnderstandings.map(({ region, revision }) => ({
      regionId: region.id,
      regionUnderstandingRevisionId: revision.id,
      workbookReviewSessionId: region.workbookReviewSessionId,
      sourceDocumentId: region.sourceDocumentId,
      sheetName: region.sheetName,
      rangeRef: region.rangeRef,
      summary: asArray(revision.summary),
      semanticType: revision.interpretation?.semanticType || "unknown_region",
      sourceContentHash: revision.sourceContentHash,
      dependencyHash: revision.dependencyHash,
      acceptedAt: region.acceptedAt || null,
      acceptedBy: region.acceptedBy || null,
    })),
    agentRuns: agentRuns.map(agentRunSummary),
    analysisThreads: analysisThreads.slice(0, 100).map(analysisThreadSummary),
    dataPlans: dataPlans.map(dataPlanSummary),
    dataSnapshots: dataSnapshots.map(dataSnapshotSummary),
    experimentSnapshotHeads,
    browserViews,
    projectBrowserConfig,
    chartStyleProfiles: await Promise.all(chartStyleProfiles.map(async (profile) => (
      chartStyleProfileSummary(profile, await context.store.findChartStyleProfileVersionById(profile.currentVersionId))
    ))),
    reusableChartTemplates: await Promise.all(reusableChartTemplates.map(async (template) => (
      reusableChartTemplateSummary(template, await context.store.findReusableChartTemplateVersionById(template.currentVersionId))
    ))),
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
    acceptedRegionUnderstandings,
    sourceDocuments,
  ] = await Promise.all([
    context.store.listAcceptedRegionUnderstandings
      ? context.store.listAcceptedRegionUnderstandings({ projectId: project.id })
      : [],
    context.store.listSourceDocuments ? context.store.listSourceDocuments({ projectId: project.id }) : [],
  ]);
  const sourceRegions = (await Promise.all(sourceDocuments.map((sourceDocument) => (
    context.store.listSourceRegions
      ? context.store.listSourceRegions({ sourceDocumentId: sourceDocument.id })
      : []
  )))).flat();
  const response = await runEvidenceRetrievalAgent({
    project,
    query: body.query || body.prompt || "",
    acceptedRegionUnderstandings,
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
  const { auth } = await projectAuth(req, context, projectId, "viewer");
  const [state, experimentAnnotations, experimentCustomColumns, experimentCustomValues] = await Promise.all([
    loadExperimentProjectionState(context, projectId),
    context.store.listExperimentAnnotations?.({ projectId, userId: auth.user.id }) || [],
    context.store.listExperimentCustomColumns?.({ projectId }) || [],
    context.store.listExperimentCustomValues?.({ projectId }) || [],
  ]);
  const projection = buildExperimentProjection({
    projectId,
    ...state,
    search: url.searchParams.get("search") || "",
    filters: parseBrowserQueryList(url, "filters"),
    sort: parseBrowserQueryList(url, "sort"),
    experimentAnnotations,
    experimentCustomColumns,
    experimentCustomValues,
    starredOnly: url.searchParams.get("starredOnly") === "true",
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  });
  sendJson(res, 200, projection);
}

function customColumnLabel(value) {
  const label = String(value ?? "").trim();
  if (!label || label.length > 120) throw Object.assign(new Error("Custom column labels must contain 1 to 120 characters."), { statusCode: 400, code: "invalid_experiment_custom_column" });
  return label;
}

async function handleProjectExperimentCustomColumns(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "POST" ? "editor" : "viewer");
  if (req.method === "GET") {
    const experimentCustomColumns = await context.store.listExperimentCustomColumns({ projectId });
    sendJson(res, 200, { experimentCustomColumns });
    return;
  }
  const body = await readJsonBody(req);
  const experimentCustomColumn = await context.store.createExperimentCustomColumn({ labId: project.labId, projectId, label: customColumnLabel(body.label || "Untitled column"), actorUserId: auth.user.id });
  sendJson(res, 201, { experimentCustomColumn });
}

async function handleProjectExperimentCustomColumn(req, res, context, projectId, customColumnId) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  const existing = await context.store.findExperimentCustomColumn({ projectId, customColumnId });
  if (!existing) { sendError(res, 404, "experiment_custom_column_not_found", "Custom column was not found in this project."); return; }
  if (req.method === "DELETE") {
    await context.store.deleteExperimentCustomColumn({ projectId, customColumnId });
    sendJson(res, 200, { deleted: true });
    return;
  }
  const body = await readJsonBody(req);
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw Object.assign(new Error("Custom column updates require expectedVersion."), { statusCode: 400, code: "invalid_experiment_custom_column" });
  const experimentCustomColumn = await context.store.updateExperimentCustomColumn({ projectId, customColumnId, expectedVersion, label: customColumnLabel(body.label), actorUserId: auth.user.id, labId: project.labId });
  sendJson(res, 200, { experimentCustomColumn });
}

async function handleProjectExperimentCustomValue(req, res, context, projectId, customColumnId, experimentId) {
  const { auth, project } = await projectAuth(req, context, projectId, "editor");
  const [column, state] = await Promise.all([context.store.findExperimentCustomColumn({ projectId, customColumnId }), loadExperimentProjectionState(context, projectId)]);
  if (!column) { sendError(res, 404, "experiment_custom_column_not_found", "Custom column was not found in this project."); return; }
  if (!getExperimentProjectionDetail({ projectId, experimentId, ...state })) { sendError(res, 404, "experiment_not_found", "Experiment was not found in this project's active snapshots."); return; }
  const body = await readJsonBody(req);
  const value = String(body.value ?? "");
  if (value.length > 2000) throw Object.assign(new Error("Custom cell values may contain at most 2,000 characters."), { statusCode: 400, code: "invalid_experiment_custom_value" });
  const expectedVersion = body.expectedVersion == null ? null : Number(body.expectedVersion);
  if (expectedVersion != null && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) throw Object.assign(new Error("Custom cell expectedVersion must be non-negative."), { statusCode: 400, code: "invalid_experiment_custom_value" });
  const experimentCustomValue = await context.store.saveExperimentCustomValue({ labId: project.labId, projectId, customColumnId, experimentId, value, expectedVersion, actorUserId: auth.user.id });
  sendJson(res, 200, { experimentCustomValue });
}

const EXPERIMENT_ANNOTATION_COLORS = new Set(["amber", "red", "green", "blue", "purple", "pink"]);

async function handleProjectExperimentAnnotations(req, res, context, projectId) {
  const { auth } = await projectAuth(req, context, projectId, "viewer");
  const experimentAnnotations = await context.store.listExperimentAnnotations({ projectId, userId: auth.user.id });
  sendJson(res, 200, { experimentAnnotations });
}

async function handleProjectExperimentAnnotation(req, res, context, projectId, experimentId) {
  const { auth, project } = await projectAuth(req, context, projectId, "viewer");
  const state = await loadExperimentProjectionState(context, projectId);
  const detail = getExperimentProjectionDetail({ projectId, experimentId, ...state });
  if (!detail) {
    sendError(res, 404, "experiment_not_found", "Experiment was not found in this project's active snapshots.");
    return;
  }
  if (req.method === "DELETE") {
    const deleted = await context.store.deleteExperimentAnnotation({ projectId, userId: auth.user.id, experimentId });
    sendJson(res, 200, { deleted });
    return;
  }
  const body = await readJsonBody(req);
  const note = String(body.note ?? "").trim();
  const color = String(body.color || "amber").trim().toLowerCase();
  if (note.length > 1000) {
    sendError(res, 400, "invalid_experiment_annotation", "Experiment annotation notes may contain at most 1,000 characters.");
    return;
  }
  if (!EXPERIMENT_ANNOTATION_COLORS.has(color)) {
    sendError(res, 400, "invalid_experiment_annotation", "Choose amber, red, green, blue, purple, or pink.");
    return;
  }
  const experimentAnnotation = await context.store.saveExperimentAnnotation({
    labId: project.labId,
    projectId,
    userId: auth.user.id,
    experimentId,
    note,
    color,
  });
  sendJson(res, 200, { experimentAnnotation });
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
const PROJECT_BROWSER_CONFIG_PAYLOAD_KEYS = new Set(["columns", "filters", "sort"]);
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

function normalizeProjectBrowserConfigPayload(value) {
  if (!isObject(value)) invalidBrowserView("Project Browser configuration payload must be an object.");
  const unknownKeys = Object.keys(value).filter((key) => !PROJECT_BROWSER_CONFIG_PAYLOAD_KEYS.has(key));
  if (unknownKeys.length) invalidBrowserView("Project Browser configuration contains unsupported keys.", { unknownKeys });
  const normalized = normalizeBrowserViewPayload({
    columns: value.columns ?? [],
    filters: value.filters ?? [],
    sort: value.sort ?? [],
    groupBy: null,
    selectedExperimentIds: [],
  });
  return {
    columns: normalized.columns.map((column, index) => {
      const source = value.columns?.[index] || {};
      const labelOverride = String(source.labelOverride ?? "").trim().slice(0, 120);
      return { ...column, ...(labelOverride ? { labelOverride } : {}) };
    }),
    filters: normalized.filters,
    sort: normalized.sort,
  };
}

async function handleProjectBrowserConfig(req, res, context, projectId) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "PATCH" ? "editor" : "viewer");
  if (req.method === "GET") {
    const config = await context.store.findProjectBrowserConfig?.({ projectId }) || null;
    let canEdit = true;
    try {
      requireLabRole(auth, project.labId, "editor");
    } catch {
      canEdit = false;
    }
    sendJson(res, 200, { projectBrowserConfig: config, canEdit });
    return;
  }
  const body = await readJsonBody(req);
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    invalidBrowserView("Project Browser configuration requires a non-negative expectedVersion.");
  }
  const projectBrowserConfig = await context.store.saveProjectBrowserConfig({
    labId: project.labId,
    projectId: project.id,
    payload: normalizeProjectBrowserConfigPayload(body.payload ?? {}),
    expectedVersion,
    updatedBy: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId: project.id,
    actorUserId: auth.user.id,
    action: "project_browser_config.update",
    targetType: "project_browser_config",
    targetId: projectBrowserConfig.id,
    summary: "Updated the shared Experiment Browser configuration.",
    metadata: { version: projectBrowserConfig.version },
  });
  sendJson(res, 200, { projectBrowserConfig, canEdit: true });
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
  const requestAbortController = new AbortController();
  const abortOnDisconnect = () => {
    if (!res.writableEnded) requestAbortController.abort();
  };
  res.once("close", abortOnDisconnect);
  const [
    chartSpecs,
    manuscripts,
    experimentSnapshotHeads,
    sourceDocuments,
    acceptedRegionUnderstandings,
  ] = await Promise.all([
    context.store.listChartSpecs({ projectId: project.id }),
    context.store.listManuscripts({ projectId: project.id }),
    context.store.listExperimentSnapshotHeads({ projectId: project.id }),
    context.store.listSourceDocuments({ projectId: project.id }),
    context.store.listAcceptedRegionUnderstandings({ projectId: project.id }),
  ]);
  const draft = await buildAgentRunDraft({
    context,
    project,
    projectProfile: projectProfileFor(project),
    chartSpecs: chartSpecs.filter(isSupportedChartSpec),
    manuscripts,
    experimentSnapshotHeads,
    sourceDocuments: sourceDocuments.map(sourceDocumentSummary),
    message: body.message || "",
    conversation: Array.isArray(body.conversation) ? body.conversation : [],
    selectedContext: isObject(body.selectedContext) ? body.selectedContext : {},
    signal: requestAbortController.signal,
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
    // Once the durable thread is created, plan drafting is server-owned. A
    // browser refresh or cancelled fetch must not abort the provider call.
    res.off("close", abortOnDisconnect);
    analysisThread = await createAnalysisThread({
      store: context.store,
      project,
      actorUserId: auth.user.id,
      originalRequest: body.message || "",
      outputTarget: draft.analysisRequest?.outputTarget || "chart",
      inputMode: draft.analysisRequest?.outputTarget === "chart"
        ? body.selectedContext?.chartInputMode || null
        : null,
      messages: [{
        id: makeId("analysis_message"),
        role: "user",
        content: String(body.message || ""),
        createdAt: agentRun.createdAt,
        agentRunId: agentRun.id,
      }],
    });
    const planningWarnings = [...asArray(agentRun.warnings)];
    let failedDraftMetadata = null;
    if (
      acceptedRegionUnderstandings.length
      || (
        draft.analysisRequest?.outputTarget === "experiment_browser"
        && experimentSnapshotHeads.length
      )
    ) {
      try {
        currentPlanRevision = await draftAnalysisPlanRevision({
          store: context.store,
          project,
          analysisThreadId: analysisThread.id,
          actorUserId: auth.user.id,
          modelProvider: context.modelProvider,
          signal: requestAbortController.signal,
        });
      } catch (error) {
        failedDraftMetadata = error?.details?.providerMetadata || null;
        const planningWarning = planningWarningFromError(error);
        planningWarnings.push(planningWarning);
        reply = `I created an analysis thread, but the backend could not draft a reviewable plan. ${planningWarning.message}`;
      }
    } else {
      planningWarnings.push({
        code: "analysis_evidence_required",
        message: draft.analysisRequest?.outputTarget === "experiment_browser"
          ? "Confirm workbook regions or publish experiment data before drafting an Experiment Browser plan."
          : "Confirm workbook regions before drafting an analysis plan.",
        severity: "info",
      });
      reply = draft.analysisRequest?.outputTarget === "experiment_browser"
        ? "I created an Experiment Browser data thread, but confirmed workbook regions or active experiment data are required before I can draft the reviewed plan."
        : "I created an analysis thread, but user-confirmed workbook regions are required before I can draft the reviewed analysis plan.";
    }
    const draftMetadata = currentPlanRevision?.draftMetadata || failedDraftMetadata || {};
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
          },
          createdAt: new Date().toISOString(),
        },
      ],
      toolTrace: currentPlanRevision ? [
        ...asArray(agentRun.toolTrace),
        {
          tool: "list_confirmed_analysis_regions",
          observation: {
            projectId: project.id,
            confirmedRegionCount: acceptedRegionUnderstandings.length,
          },
        },
        {
          tool: "select_confirmed_source_ranges",
          observation: {
            projectId: project.id,
            selectionCount: asArray(currentPlanRevision.sourceSelections).length,
            sourceSelections: asArray(currentPlanRevision.sourceSelections).map((selection) => ({
              sourceDocumentId: selection.sourceDocumentId,
              sheetName: selection.sheetName,
              range: selection.range,
            })),
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
        reasoningTokens: (Number(existingUsage.reasoningTokens) || 0)
          + (Number(draftMetadata.usage?.reasoningTokens) || 0),
        latencyMs: (Number(existingUsage.latencyMs) || 0)
          + (Number(draftMetadata.latencyMs) || 0),
      },
      warnings: planningWarnings,
      updatedBy: auth.user.id,
    });
    if (!currentPlanRevision && planningWarnings.some((warning) => warning.code !== "analysis_evidence_required")) {
      await context.store.updateAnalysisThread(analysisThread.id, {
        status: "plan_failed",
        updatedBy: auth.user.id,
      });
    }
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
  res.off("close", abortOnDisconnect);
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
    outputTarget: body.outputTarget || "chart",
    inputMode: body.inputMode || null,
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

async function handleProjectAnalysisCapabilities(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const [dataSnapshots, experimentSnapshotHeads, acceptedRegionUnderstandings] = await Promise.all([
    context.store.listDataSnapshots({ projectId: project.id }),
    context.store.listExperimentSnapshotHeads({ projectId: project.id }),
    context.store.listAcceptedRegionUnderstandings({ projectId: project.id }),
  ]);
  const model = publicAnalysisCapabilityConfig(context.modelProvider, {
    provider: null,
    model: null,
    configured: false,
  });
  const executor = publicAnalysisCapabilityConfig(context.analysisExecutor, {
    mode: "disabled",
    adapter: "disabled",
    configured: false,
    productionSafe: false,
  });
  sendJson(res, 200, {
    schemaVersion: "labrat.analysisCapabilities.v1",
    projectId: project.id,
    model: {
      provider: model.provider || null,
      model: model.model || null,
      configured: Boolean(model.configured),
    },
    executor: {
      mode: executor.mode || "disabled",
      adapter: executor.adapter || "disabled",
      configured: Boolean(executor.configured),
      productionSafe: Boolean(executor.productionSafe),
    },
    acceptedData: {
      acceptedSnapshotCount: dataSnapshots.filter((snapshot) => snapshot.status === "accepted").length,
      activeExperimentHeadCount: experimentSnapshotHeads.length,
      confirmedRegionCount: acceptedRegionUnderstandings.length,
    },
  });
}

async function handleAnalysisThreadById(req, res, context, analysisThreadId) {
  const { analysisThread } = await analysisThreadAuth(
    req,
    context,
    analysisThreadId,
    "viewer",
  );
  const [planRevisions, analysisRuns, agentRuns] = await Promise.all([
    context.store.listAnalysisPlanRevisions({ analysisThreadId: analysisThread.id }),
    context.store.listAnalysisRuns({
      projectId: analysisThread.projectId,
      analysisThreadId: analysisThread.id,
    }),
    context.store.listAgentRuns({ projectId: analysisThread.projectId }),
  ]);
  const planFailure = !planRevisions.length && !analysisRuns.length
    ? analysisThreadPlanFailure(agentRuns, analysisThread.id)
    : null;
  sendJson(res, 200, {
    analysisThread: {
      ...analysisThreadSummary(analysisThread),
      ...(planFailure ? { status: "plan_failed" } : {}),
      messages: analysisThread.messages || [],
    },
    planRevisions: planRevisions.map(analysisPlanRevisionSummary),
    analysisRuns: analysisRuns.map(analysisRunSummary),
    planFailure,
  });
}

async function handleAnalysisThreadRetry(req, res, context, analysisThreadId) {
  const { auth, analysisThread } = await analysisThreadAuth(req, context, analysisThreadId, "editor");
  const rawIdempotencyKey = req.headers["idempotency-key"];
  const idempotencyKey = Array.isArray(rawIdempotencyKey)
    ? String(rawIdempotencyKey[0] || "").trim()
    : String(rawIdempotencyKey || "").trim();
  if (!idempotencyKey) {
    throw Object.assign(new Error("A valid Idempotency-Key header is required to retry an analysis thread."), {
      statusCode: 400,
      code: "idempotency_key_required",
    });
  }
  if (idempotencyKey.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    throw Object.assign(new Error("Idempotency-Key must use 1-200 letters, numbers, dots, underscores, colons, or hyphens."), {
      statusCode: 400,
      code: "invalid_idempotency_key",
    });
  }
  const project = await context.store.findProjectById(analysisThread.projectId);
  if (!project) {
    throw Object.assign(new Error("Project not found."), {
      statusCode: 404,
      code: "project_not_found",
    });
  }
  const [analysisRuns, acceptedRegionUnderstandings, agentRuns] = await Promise.all([
    context.store.listAnalysisRuns({ projectId: project.id, analysisThreadId: analysisThread.id }),
    context.store.listAcceptedRegionUnderstandings({ projectId: project.id }),
    context.store.listAgentRuns({ projectId: project.id }),
  ]);
  if (!isEvidenceBlockedAnalysisThread(agentRuns, analysisThread.id)) {
    throw Object.assign(new Error("This analysis thread was not blocked by missing accepted evidence."), {
      statusCode: 409,
      code: "analysis_retry_not_available",
    });
  }
  if (analysisRuns.length) {
    throw Object.assign(new Error("This analysis thread is not awaiting published evidence."), {
      statusCode: 409,
      code: "analysis_retry_not_available",
    });
  }
  if (!acceptedRegionUnderstandings.length) {
    throw Object.assign(new Error("Confirm workbook regions before retrying this analysis plan."), {
      statusCode: 409,
      code: "analysis_evidence_required",
    });
  }

  const requestHash = sha256Hex(JSON.stringify({
    operation: "analysis_thread_retry_v1",
    projectId: project.id,
    analysisThreadId: analysisThread.id,
    actorUserId: auth.user.id,
  }));
  const claim = await context.store.claimAnalysisThreadRetry({
    labId: project.labId,
    projectId: project.id,
    analysisThreadId: analysisThread.id,
    actorUserId: auth.user.id,
    idempotencyKey,
    requestHash,
    leaseMs: ANALYSIS_RETRY_LEASE_MS,
  });
  if (claim?.claimStatus === "replay") {
    const replay = await context.store.findAnalysisPlanRevisionById(
      claim.receipt.analysisPlanRevisionId,
    );
    if (replay) {
      sendJson(res, 200, {
        analysisThread: analysisThreadSummary(claim.analysisThread || analysisThread),
        analysisPlanRevision: analysisPlanRevisionSummary(replay),
        idempotentReplay: true,
      });
      return;
    }
  }
  if (claim?.claimStatus === "in_progress") {
    throw Object.assign(new Error("This analysis retry is already drafting a reviewable plan."), {
      statusCode: 409,
      code: "analysis_retry_in_progress",
    });
  }
  if (claim?.claimStatus !== "claimed") {
    throw Object.assign(new Error("This analysis thread is not awaiting published evidence."), {
      statusCode: 409,
      code: "analysis_retry_not_available",
    });
  }

  let revision;
  let idempotentReplay = false;
  try {
    revision = await draftAnalysisPlanRevision({
      store: context.store,
      project,
      analysisThreadId: analysisThread.id,
      actorUserId: auth.user.id,
      modelProvider: context.modelProvider,
      allowRetryClaim: true,
    });
  } catch (error) {
    try {
      await context.store.releaseAnalysisThreadRetry({
        projectId: project.id,
        analysisThreadId: analysisThread.id,
        actorUserId: auth.user.id,
        idempotencyKey,
        requestHash,
      });
    } catch {
      // Preserve the draft failure while a future retry can surface any store issue.
    }
    if (error.code !== "analysis_plan_revision_conflict" && error.code !== "23505") throw error;
    const replay = (await context.store.listAnalysisPlanRevisions({ analysisThreadId: analysisThread.id }))
      .find((item) => item.status === "awaiting_review");
    if (!replay) throw error;
    revision = replay;
    idempotentReplay = true;
  }

  await context.store.completeAnalysisThreadRetry({
    projectId: project.id,
    analysisThreadId: analysisThread.id,
    actorUserId: auth.user.id,
    idempotencyKey,
    requestHash,
    analysisPlanRevisionId: revision.id,
  });

  const updatedThread = await context.store.findAnalysisThreadById(analysisThread.id);
  if (!idempotentReplay) {
    await context.store.recordAuditEvent({
      labId: project.labId,
      projectId: project.id,
      actorUserId: auth.user.id,
      action: "analysis_thread.retry",
      targetType: "analysis_plan_revision",
      targetId: revision.id,
      summary: `Retried analysis thread ${analysisThread.id} with published data.`,
      metadata: { analysisThreadId: analysisThread.id },
    });
  }
  sendJson(res, idempotentReplay ? 200 : 201, {
    analysisThread: analysisThreadSummary(updatedThread || analysisThread),
    analysisPlanRevision: analysisPlanRevisionSummary(revision),
    idempotentReplay,
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
      feedback: body.feedback,
    })
    : await draftAnalysisPlanRevision({
      store: context.store,
      project,
      analysisThreadId: analysisThread.id,
      actorUserId: auth.user.id,
      modelProvider: context.modelProvider,
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
    metadata: { analysisThreadId: analysisThread.id },
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
  await readOptionalJsonBody(req);
  const result = await acceptAnalysisPlanRevision({
    store: context.store,
    project,
    actorUserId: auth.user.id,
    planRevisionId: analysisPlanRevision.id,
    idempotencyKey: req.headers["idempotency-key"],
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
  const body = await readOptionalJsonBody(req);
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
    modelProvider: context.modelProvider,
    executionStrategy: body?.executionStrategy,
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

async function handleAnalysisRunRetry(req, res, context, analysisRunId) {
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
  const result = await retryAnalysisRunGeneration({
    store: context.store,
    project,
    actorUserId: auth.user.id,
    analysisRunId,
    idempotencyKey: req.headers["idempotency-key"],
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
    feedback: body.feedback,
    modelProvider: context.modelProvider,
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

async function handleAnalysisResultChartPublication(req, res, context, analysisRunId) {
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
  const result = await publishAcceptedAnalysisChart({
    store: context.store,
    project,
    actorUserId: auth.user.id,
    runId: analysisRun.id,
    analysisResultId: body.analysisResultId,
    defaultVisibleTraceIds: body.defaultVisibleTraceIds,
    idempotencyKey: req.headers["idempotency-key"],
    ipAddress: clientIp(req),
    userAgent: userAgent(req),
  });
  sendJson(res, result.idempotentReplay ? 200 : 201, {
    analysisThread: analysisThreadSummary(result.analysisThread),
    analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
    analysisRun: analysisRunSummary(result.analysisRun),
    analysisResult: analysisResultSummary(result.analysisResult),
    chartSpec: result.chartSpec,
    idempotentReplay: result.idempotentReplay,
  });
}

async function handleAnalysisResultExperimentPublication(req, res, context, analysisRunId) {
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
  const result = await publishAcceptedExperimentAnalysis({
    store: context.store,
    project,
    actorUserId: auth.user.id,
    analysisRunId: analysisRun.id,
    analysisResultId: body.analysisResultId,
    identityResolutions: body.identityResolutions,
    idempotencyKey: req.headers["idempotency-key"],
    ipAddress: clientIp(req),
    userAgent: userAgent(req),
  });
  sendJson(res, result.idempotentReplay ? 200 : 201, {
    analysisThread: analysisThreadSummary(result.analysisThread),
    analysisPlanRevision: analysisPlanRevisionSummary(result.analysisPlanRevision),
    analysisRun: analysisRunSummary(result.analysisRun),
    analysisResult: analysisResultSummary(result.analysisResult),
    dataSnapshot: result.dataSnapshot,
    browserView: result.browserView,
    experimentIdentities: result.experimentIdentities,
    experimentSnapshotHeads: result.experimentSnapshotHeads,
    changeSummary: result.changeSummary,
    idempotentReplay: result.idempotentReplay,
  });
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

async function handleSourceDocumentCellClasses(req, res, context, sourceDocumentId, url) {
  const { sourceDocument } = await sourceDocumentAuth(req, context, sourceDocumentId, "viewer");
  const indexBlobs = context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  const result = sourceCellClasses({
    sourceDocument,
    indexBlobs,
    sheetName: url.searchParams.get("sheetName") || "",
    range: url.searchParams.get("range") || "",
    maxCells: SOURCE_RANGE_MAX_CELLS,
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

function regionUnderstandingRevisionSummary(revision) {
  if (!revision) return null;
  return {
    id: revision.id,
    regionId: revision.regionId,
    revisionNumber: revision.revisionNumber,
    trigger: revision.trigger,
    userFeedback: revision.userFeedback || "",
    summary: asArray(revision.summary),
    interpretation: revision.interpretation || {},
    sourceRefs: asArray(revision.sourceRefs),
    sourceContentHash: revision.sourceContentHash,
    dependencyHash: revision.dependencyHash,
    validation: revision.validation || {},
    provider: revision.provider || {},
    warnings: asArray(revision.warnings),
    confidence: revision.confidence ?? null,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
  };
}

async function workbookReviewRegionSummary(context, region) {
  if (!region) return null;
  const [currentRevision, acceptedRevision] = await Promise.all([
    region.currentRevisionId
      ? context.store.findRegionUnderstandingRevisionById?.(region.currentRevisionId)
      : null,
    region.acceptedRevisionId && region.acceptedRevisionId !== region.currentRevisionId
      ? context.store.findRegionUnderstandingRevisionById?.(region.acceptedRevisionId)
      : null,
  ]);
  return {
    id: region.id,
    labId: region.labId,
    projectId: region.projectId,
    workbookReviewSessionId: region.workbookReviewSessionId,
    sourceDocumentId: region.sourceDocumentId,
    sourceRegionId: region.sourceRegionId,
    sheetName: region.sheetName,
    rangeRef: region.rangeRef,
    selectionMethod: region.selectionMethod,
    interpretationHint: region.interpretationHint || {},
    disposition: region.disposition,
    reviewStatus: region.reviewStatus,
    currentRevisionId: region.currentRevisionId,
    acceptedRevisionId: region.acceptedRevisionId,
    version: region.version,
    warnings: asArray(region.warnings),
    acceptedAt: region.acceptedAt || null,
    acceptedBy: region.acceptedBy || null,
    ignoredAt: region.ignoredAt || null,
    ignoredBy: region.ignoredBy || null,
    ignoredReason: region.ignoredReason || "",
    deletedAt: region.deletedAt || null,
    deletedBy: region.deletedBy || null,
    deletedReason: region.deletedReason || "",
    currentRevision: regionUnderstandingRevisionSummary(currentRevision),
    acceptedRevision: regionUnderstandingRevisionSummary(
      acceptedRevision || (region.acceptedRevisionId === region.currentRevisionId ? currentRevision : null),
    ),
    createdAt: region.createdAt,
    updatedAt: region.updatedAt,
    createdBy: region.createdBy,
    updatedBy: region.updatedBy,
  };
}

async function listWorkbookReviewRegionSummaries(context, sessionId, { includeDeleted = false } = {}) {
  const regions = context.store.listWorkbookReviewRegions
    ? await context.store.listWorkbookReviewRegions({ workbookReviewSessionId: sessionId, includeDeleted })
    : [];
  return Promise.all(regions.map((region) => workbookReviewRegionSummary(context, region)));
}

async function sourceContextForWorkbookReviewRegion(context, workbookReviewSession) {
  const sourceDocument = await context.store.findSourceDocumentById?.(workbookReviewSession.sourceDocumentId);
  if (!sourceDocument) {
    throw Object.assign(new Error("Source document not found for this workbook review session."), {
      statusCode: 404,
      code: "source_document_not_found",
    });
  }
  const indexBlobs = context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  return { sourceDocument, indexBlobs };
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
  const draft = buildWorkbookReviewSessionDraft({ sourceDocument, regions });
  const session = await context.store.createWorkbookReviewSession({
    labId: project.labId,
    projectId: project.id,
    sourceDocumentId: sourceDocument.id,
    ...draft,
    regions: regions.map(sourceRegionSummary),
    createdBy: auth.user.id,
  });
  for (const detectedRegion of asArray(draft.candidateRegions)) {
    await createWorkbookReviewRegionRecord({
      store: context.store,
      session,
      sourceDocument,
      actorUserId: auth.user.id,
      input: {
        sourceRegionId: detectedRegion.sourceRegionId,
        sheetName: detectedRegion.sheetName,
        range: detectedRegion.range,
        selectionMethod: "detected_region",
        semanticType: detectedRegion.semanticType,
        description: detectedRegion.description,
      },
    });
  }
  const reviewRegions = await listWorkbookReviewRegionSummaries(context, session.id);
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
    reviewRegions,
    interpretationDeferred: true,
    importRun: importRun ? importRunSummary(importRun) : null,
  });
}

async function handleProjectRegionUnderstandings(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const accepted = context.store.listAcceptedRegionUnderstandings
    ? await context.store.listAcceptedRegionUnderstandings({ projectId: project.id })
    : [];
  const regionUnderstandings = await Promise.all(accepted.map(async ({ region, revision }) => ({
    region: await workbookReviewRegionSummary(context, region),
    revision: regionUnderstandingRevisionSummary(revision),
  })));
  sendJson(res, 200, { regionUnderstandings });
}

async function handleWorkbookReviewSessionById(req, res, context, sessionId) {
  const { auth, workbookReviewSession } = await workbookReviewSessionAuth(
    req,
    context,
    sessionId,
    req.method === "DELETE" ? "editor" : "viewer",
  );
  if (req.method === "DELETE") {
    const body = await readOptionalJsonBody(req);
    const deleted = await context.store.deleteWorkbookReviewSession(workbookReviewSession.id, {
      expectedVersion: body.expectedVersion,
      reason: body.reason || "",
      actorUserId: auth.user.id,
    });
    if (!deleted) {
      throw Object.assign(new Error("Workbook review session not found."), {
        statusCode: 404,
        code: "workbook_review_session_not_found",
      });
    }
    await context.store.recordAuditEvent({
      labId: workbookReviewSession.labId,
      projectId: workbookReviewSession.projectId,
      actorUserId: auth.user.id,
      action: "workbook_review_session.delete",
      targetType: "workbook_review_session",
      targetId: workbookReviewSession.id,
      summary: `Deleted workbook review session for ${workbookReviewSession.workbookSummary?.workbookName || "workbook"}.`,
      metadata: {
        sourceDocumentId: workbookReviewSession.sourceDocumentId,
        deletedRegionCount: deleted.deletedRegionCount,
        reason: body.reason || "",
      },
    });
    sendJson(res, 200, {
      workbookReviewSession: workbookReviewSessionSummary(deleted.workbookReviewSession),
      deletedRegionCount: deleted.deletedRegionCount,
    });
    return;
  }
  const sourceDocument = await context.store.findSourceDocumentById?.(workbookReviewSession.sourceDocumentId);
  const regions = sourceDocument && context.store.listSourceRegions
    ? await context.store.listSourceRegions({ sourceDocumentId: sourceDocument.id })
    : [];
  sendJson(res, 200, {
    workbookReviewSession: workbookReviewSessionSummary(workbookReviewSession),
    session: workbookReviewSessionSummary(workbookReviewSession),
    sourceDocument: sourceDocument ? sourceDocumentSummary(sourceDocument) : null,
    regions: regions.map(sourceRegionSummary),
    reviewRegions: await listWorkbookReviewRegionSummaries(context, workbookReviewSession.id),
  });
}

async function handleWorkbookReviewSessionRegions(req, res, context, sessionId) {
  const { auth, workbookReviewSession } = await workbookReviewSessionAuth(
    req,
    context,
    sessionId,
    req.method === "POST" ? "editor" : "viewer",
  );
  if (req.method === "GET") {
    sendJson(res, 200, {
      workbookReviewSessionId: workbookReviewSession.id,
      regions: await listWorkbookReviewRegionSummaries(context, workbookReviewSession.id),
    });
    return;
  }
  const body = await readJsonBody(req);
  if (body.sourceDocumentId && body.sourceDocumentId !== workbookReviewSession.sourceDocumentId) {
    sendError(res, 409, "source_document_mismatch", "Region must target the workbook review session SourceDocument.");
    return;
  }
  const { sourceDocument, indexBlobs } = await sourceContextForWorkbookReviewRegion(context, workbookReviewSession);
  const deferInterpretation = body.deferInterpretation === true;
  const created = deferInterpretation
    ? {
      region: await createWorkbookReviewRegionRecord({
        store: context.store,
        session: workbookReviewSession,
        sourceDocument,
        actorUserId: auth.user.id,
        input: body,
      }),
      revision: null,
      warning: null,
    }
    : await createWorkbookReviewRegionDraft({
      store: context.store,
      session: workbookReviewSession,
      sourceDocument,
      indexBlobs,
      modelProvider: context.modelProvider,
      actorUserId: auth.user.id,
      input: body,
    });
  await context.store.recordAuditEvent({
    labId: workbookReviewSession.labId,
    projectId: workbookReviewSession.projectId,
    actorUserId: auth.user.id,
    action: "workbook_review_region.create",
    targetType: "workbook_review_region",
    targetId: created.region.id,
    summary: `Created workbook review region ${created.region.sheetName}!${created.region.rangeRef}.`,
    metadata: { sourceDocumentId: workbookReviewSession.sourceDocumentId },
  });
  sendJson(res, 201, {
    region: await workbookReviewRegionSummary(context, created.region),
    currentRevision: regionUnderstandingRevisionSummary(created.revision),
    warning: created.warning || null,
    interpretationDeferred: deferInterpretation,
  });
}

async function handleWorkbookReviewRegionInterpret(req, res, context, sessionId, regionId) {
  const { auth, workbookReviewSession, region } = await workbookReviewRegionAuth(
    req,
    context,
    sessionId,
    regionId,
    "editor",
  );
  const body = await readJsonBody(req);
  const { sourceDocument, indexBlobs } = await sourceContextForWorkbookReviewRegion(context, workbookReviewSession);
  const interpreted = await interpretWorkbookReviewRegion({
    store: context.store,
    region,
    sourceDocument,
    indexBlobs,
    modelProvider: context.modelProvider,
    actorUserId: auth.user.id,
    input: body,
  });
  await context.store.recordAuditEvent({
    labId: region.labId,
    projectId: region.projectId,
    actorUserId: auth.user.id,
    action: interpreted.cancelled ? "workbook_review_region.interpret_cancelled" : "workbook_review_region.interpret",
    targetType: interpreted.revision ? "region_understanding_revision" : "workbook_review_region",
    targetId: interpreted.revision?.id || region.id,
    summary: interpreted.cancelled
      ? `Skipped a stale interpretation for ${region.sheetName}!${region.rangeRef}.`
      : `Interpreted workbook review region ${region.sheetName}!${region.rangeRef}.`,
    metadata: { regionId: region.id, modelWarning: interpreted.warning?.code || null },
  });
  sendJson(res, interpreted.revision ? 201 : 200, {
    region: await workbookReviewRegionSummary(context, interpreted.region),
    currentRevision: regionUnderstandingRevisionSummary(interpreted.revision),
    warning: interpreted.warning || null,
    cancelled: interpreted.cancelled === true,
  });
}

async function handleWorkbookReviewRegionById(req, res, context, sessionId, regionId) {
  const { auth, region } = await workbookReviewRegionAuth(
    req,
    context,
    sessionId,
    regionId,
    req.method === "DELETE" ? "editor" : "viewer",
  );
  if (req.method === "GET") {
    sendJson(res, 200, { region: await workbookReviewRegionSummary(context, region) });
    return;
  }
  const body = await readJsonBody(req);
  const deleted = await deleteWorkbookReviewRegion({
    store: context.store,
    region,
    expectedRegionVersion: body.expectedRegionVersion,
    reason: body.reason,
    actorUserId: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: region.labId,
    projectId: region.projectId,
    actorUserId: auth.user.id,
    action: "workbook_review_region.delete",
    targetType: "workbook_review_region",
    targetId: region.id,
    summary: `Deleted workbook review region ${region.sheetName}!${region.rangeRef}.`,
    metadata: { reason: body.reason || "" },
  });
  sendJson(res, 200, { region: await workbookReviewRegionSummary(context, deleted.region) });
}

async function handleWorkbookReviewRegionRevisions(req, res, context, sessionId, regionId) {
  const { auth, workbookReviewSession, region } = await workbookReviewRegionAuth(
    req,
    context,
    sessionId,
    regionId,
    req.method === "POST" ? "editor" : "viewer",
  );
  if (req.method === "GET") {
    const revisions = context.store.listRegionUnderstandingRevisions
      ? await context.store.listRegionUnderstandingRevisions({ regionId: region.id })
      : [];
    sendJson(res, 200, { revisions: revisions.map(regionUnderstandingRevisionSummary) });
    return;
  }
  const body = await readJsonBody(req);
  const { sourceDocument, indexBlobs } = await sourceContextForWorkbookReviewRegion(context, workbookReviewSession);
  const revised = await reviseWorkbookReviewRegion({
    store: context.store,
    region,
    sourceDocument,
    indexBlobs,
    modelProvider: context.modelProvider,
    actorUserId: auth.user.id,
    input: body,
  });
  await context.store.recordAuditEvent({
    labId: region.labId,
    projectId: region.projectId,
    actorUserId: auth.user.id,
    action: "workbook_review_region.revise",
    targetType: "region_understanding_revision",
    targetId: revised.revision?.id || region.id,
    summary: `Revised workbook review region ${region.sheetName}!${region.rangeRef}.`,
    metadata: { regionId: region.id, modelWarning: revised.warning?.code || null },
  });
  sendJson(res, 201, {
    region: await workbookReviewRegionSummary(context, revised.region),
    currentRevision: regionUnderstandingRevisionSummary(revised.revision),
    warning: revised.warning || null,
  });
}

async function handleWorkbookReviewRegionConfirm(req, res, context, sessionId, regionId) {
  const { auth, region } = await workbookReviewRegionAuth(req, context, sessionId, regionId, "editor");
  const body = await readJsonBody(req);
  const confirmed = await confirmWorkbookReviewRegion({
    store: context.store,
    region,
    revisionId: body.revisionId,
    expectedRegionVersion: body.expectedRegionVersion,
    actorUserId: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: region.labId,
    projectId: region.projectId,
    actorUserId: auth.user.id,
    action: "workbook_review_region.confirm",
    targetType: "region_understanding_revision",
    targetId: confirmed.revision.id,
    summary: `Confirmed workbook review region ${region.sheetName}!${region.rangeRef}.`,
    metadata: { regionId: region.id },
  });
  sendJson(res, 200, {
    region: await workbookReviewRegionSummary(context, confirmed.region),
    acceptedRevision: regionUnderstandingRevisionSummary(confirmed.revision),
  });
}

async function handleWorkbookReviewRegionIgnore(req, res, context, sessionId, regionId) {
  const { auth, region } = await workbookReviewRegionAuth(req, context, sessionId, regionId, "editor");
  const body = await readJsonBody(req);
  const ignored = await ignoreWorkbookReviewRegion({
    store: context.store,
    region,
    expectedRegionVersion: body.expectedRegionVersion,
    reason: body.reason,
    actorUserId: auth.user.id,
  });
  await context.store.recordAuditEvent({
    labId: region.labId,
    projectId: region.projectId,
    actorUserId: auth.user.id,
    action: "workbook_review_region.ignore",
    targetType: "workbook_review_region",
    targetId: region.id,
    summary: `Ignored workbook review region ${region.sheetName}!${region.rangeRef}.`,
    metadata: { reason: body.reason || "" },
  });
  sendJson(res, 200, { region: await workbookReviewRegionSummary(context, ignored.region) });
}

async function styleProfileDetail(context, profile) {
  const versions = await context.store.listChartStyleProfileVersions({ chartStyleProfileId: profile.id });
  return { chartStyleProfile: profile, versions };
}

async function reusableTemplateDetail(context, template) {
  const versions = await context.store.listReusableChartTemplateVersions({ reusableChartTemplateId: template.id });
  return { reusableChartTemplate: template, versions };
}

async function acceptedStyleVersion(context, projectId, styleVersionId) {
  const id = String(styleVersionId || "").trim();
  if (!id) return null;
  const version = await context.store.findChartStyleProfileVersionById(id);
  if (!version || version.projectId !== projectId || version.status !== "accepted") {
    throw Object.assign(new Error("Accepted chart style profile version was not found in this project."), {
      statusCode: 404,
      code: "chart_style_profile_not_accepted",
    });
  }
  return version;
}

async function validateStyleReferenceFile(context, projectId, styleVersion) {
  const fileObjectId = String(styleVersion?.reference?.fileObjectId || "").trim();
  if (!fileObjectId) return;
  const fileObject = await context.store.findFileObjectById(fileObjectId);
  if (!fileObject || fileObject.projectId !== projectId) {
    throw Object.assign(new Error("Chart style reference file was not found in this project."), {
      statusCode: 404,
      code: "chart_style_reference_not_found",
    });
  }
}

async function handleProjectChartStyleProfiles(req, res, context, projectId, url) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "POST" ? "editor" : "viewer");
  if (req.method === "GET") {
    const profiles = await context.store.listChartStyleProfiles({
      projectId,
      includeArchived: url.searchParams.get("includeArchived") === "true",
    });
    const summaries = await Promise.all(profiles.map(async (profile) => (
      chartStyleProfileSummary(profile, await context.store.findChartStyleProfileVersionById(profile.currentVersionId))
    )));
    sendJson(res, 200, { schemaVersion: "labrat.chartStyleProfileList.v1", projectId, chartStyleProfiles: summaries });
    return;
  }
  const body = await readJsonBody(req);
  const name = reusableChartName(body.name, "name");
  const description = reusableChartDescription(body.description);
  const createdAt = new Date().toISOString();
  const checked = buildChartStyleProfileVersion({ definition: body.style || body.definition || {}, version: 1 });
  await validateStyleReferenceFile(context, projectId, checked);
  const profileId = makeId("chart_style_profile");
  const versionId = makeId("chart_style_profile_version");
  const stored = await context.store.createChartStyleProfile({
    profile: {
      id: profileId,
      labId: project.labId,
      projectId,
      schemaVersion: CHART_STYLE_PROFILE_SCHEMA_VERSION,
      name,
      description,
      status: "active",
      currentVersionId: null,
      createdAt,
      updatedAt: createdAt,
      createdBy: auth.user.id,
      updatedBy: auth.user.id,
    },
    version: {
      id: versionId,
      labId: project.labId,
      projectId,
      chartStyleProfileId: profileId,
      ...checked,
      createdAt,
      createdBy: auth.user.id,
      acceptedAt: createdAt,
      acceptedBy: auth.user.id,
    },
  });
  await context.store.recordAuditEvent({
    labId: project.labId,
    projectId,
    actorUserId: auth.user.id,
    action: "chart_style_profile.create",
    targetType: "chart_style_profile",
    targetId: profileId,
    summary: `Created chart style profile ${name}.`,
    metadata: { chartStyleProfileVersionId: versionId, contentHash: checked.contentHash },
    ipAddress: clientIp(req),
    userAgent: userAgent(req),
  });
  sendJson(res, 201, await styleProfileDetail(context, stored.profile));
}

async function handleChartStyleProfile(req, res, context, profileId, action = null) {
  const profile = await context.store.findChartStyleProfileById(profileId);
  if (!profile) throw Object.assign(new Error("Chart style profile was not found."), { statusCode: 404, code: "chart_style_profile_not_found" });
  const role = action ? "editor" : "viewer";
  const { auth } = await projectAuth(req, context, profile.projectId, role);
  if (!action && req.method === "GET") {
    sendJson(res, 200, await styleProfileDetail(context, profile));
    return;
  }
  if (action === "archive") {
    const updatedAt = new Date().toISOString();
    const archived = await context.store.archiveChartStyleProfile({ profileId, actorUserId: auth.user.id, updatedAt });
    await context.store.recordAuditEvent({
      labId: profile.labId, projectId: profile.projectId, actorUserId: auth.user.id,
      action: "chart_style_profile.archive", targetType: "chart_style_profile", targetId: profile.id,
      summary: `Archived chart style profile ${profile.name}.`, ipAddress: clientIp(req), userAgent: userAgent(req),
    });
    sendJson(res, 200, { chartStyleProfile: archived });
    return;
  }
  if (action === "versions") {
    if (profile.status === "archived") throw Object.assign(new Error("Archived chart style profiles cannot be versioned."), { statusCode: 409, code: "chart_style_profile_archived" });
    const body = await readJsonBody(req);
    const versions = await context.store.listChartStyleProfileVersions({ chartStyleProfileId: profile.id });
    const nextVersion = Math.max(0, ...versions.map((item) => Number(item.version) || 0)) + 1;
    const checked = buildChartStyleProfileVersion({ definition: body.style || body.definition || {}, version: nextVersion });
    await validateStyleReferenceFile(context, profile.projectId, checked);
    const createdAt = new Date().toISOString();
    const version = {
      id: makeId("chart_style_profile_version"), labId: profile.labId, projectId: profile.projectId,
      chartStyleProfileId: profile.id, ...checked, createdAt, createdBy: auth.user.id,
      acceptedAt: createdAt, acceptedBy: auth.user.id,
    };
    const stored = await context.store.appendChartStyleProfileVersion({ profileId: profile.id, version, actorUserId: auth.user.id, updatedAt: createdAt });
    await context.store.recordAuditEvent({
      labId: profile.labId, projectId: profile.projectId, actorUserId: auth.user.id,
      action: "chart_style_profile.version", targetType: "chart_style_profile", targetId: profile.id,
      summary: `Created version ${nextVersion} of chart style profile ${profile.name}.`,
      metadata: { chartStyleProfileVersionId: version.id, contentHash: version.contentHash },
      ipAddress: clientIp(req), userAgent: userAgent(req),
    });
    sendJson(res, 201, await styleProfileDetail(context, stored.profile));
  }
}

async function templateVersionFromChart({ context, projectId, sourceChartSpecId, chartStyleProfileVersionId, version }) {
  const chartSpec = await context.store.findChartSpecById(String(sourceChartSpecId || "").trim());
  if (!chartSpec || chartSpec.projectId !== projectId || !isSupportedChartSpec(chartSpec)) {
    throw Object.assign(new Error("Accepted source ChartSpec was not found in this project."), { statusCode: 404, code: "chart_spec_not_found" });
  }
  const styleVersion = await acceptedStyleVersion(context, projectId, chartStyleProfileVersionId);
  const definition = await deriveReusableChartTemplateDefinition({
    store: context.store,
    projectId,
    chartSpec,
    chartStyleProfileVersionId: styleVersion?.id || null,
  });
  return buildReusableChartTemplateVersion({ definition, version });
}

async function handleProjectReusableChartTemplates(req, res, context, projectId, url) {
  const { auth, project } = await projectAuth(req, context, projectId, req.method === "POST" ? "editor" : "viewer");
  if (req.method === "GET") {
    const templates = await context.store.listReusableChartTemplates({
      projectId,
      includeArchived: url.searchParams.get("includeArchived") === "true",
    });
    const summaries = await Promise.all(templates.map(async (template) => (
      reusableChartTemplateSummary(template, await context.store.findReusableChartTemplateVersionById(template.currentVersionId))
    )));
    sendJson(res, 200, { schemaVersion: "labrat.reusableChartTemplateList.v1", projectId, reusableChartTemplates: summaries });
    return;
  }
  const body = await readJsonBody(req);
  const name = reusableChartName(body.name, "name");
  const description = reusableChartDescription(body.description);
  const checked = await templateVersionFromChart({
    context,
    projectId,
    sourceChartSpecId: body.sourceChartSpecId,
    chartStyleProfileVersionId: body.chartStyleProfileVersionId,
    version: 1,
  });
  const createdAt = new Date().toISOString();
  const templateId = makeId("reusable_chart_template");
  const versionId = makeId("reusable_chart_template_version");
  const stored = await context.store.createReusableChartTemplate({
    template: {
      id: templateId, labId: project.labId, projectId, schemaVersion: REUSABLE_CHART_TEMPLATE_SCHEMA_VERSION,
      name, description, status: "active", currentVersionId: null,
      createdAt, updatedAt: createdAt, createdBy: auth.user.id, updatedBy: auth.user.id,
    },
    version: {
      id: versionId, labId: project.labId, projectId, reusableChartTemplateId: templateId,
      ...checked, createdAt, createdBy: auth.user.id, acceptedAt: createdAt, acceptedBy: auth.user.id,
    },
  });
  await context.store.recordAuditEvent({
    labId: project.labId, projectId, actorUserId: auth.user.id,
    action: "reusable_chart_template.create", targetType: "reusable_chart_template", targetId: templateId,
    summary: `Created reusable chart template ${name}.`,
    metadata: { reusableChartTemplateVersionId: versionId, sourceChartSpecId: checked.sourceChartSpecId, contentHash: checked.contentHash },
    ipAddress: clientIp(req), userAgent: userAgent(req),
  });
  sendJson(res, 201, await reusableTemplateDetail(context, stored.template));
}

async function handleReusableChartTemplate(req, res, context, templateId, action = null) {
  const template = await context.store.findReusableChartTemplateById(templateId);
  if (!template) throw Object.assign(new Error("Reusable chart template was not found."), { statusCode: 404, code: "reusable_chart_template_not_found" });
  const { auth } = await projectAuth(req, context, template.projectId, action ? "editor" : "viewer");
  if (!action && req.method === "GET") {
    sendJson(res, 200, await reusableTemplateDetail(context, template));
    return;
  }
  if (action === "archive") {
    const updatedAt = new Date().toISOString();
    const archived = await context.store.archiveReusableChartTemplate({ templateId, actorUserId: auth.user.id, updatedAt });
    await context.store.recordAuditEvent({
      labId: template.labId, projectId: template.projectId, actorUserId: auth.user.id,
      action: "reusable_chart_template.archive", targetType: "reusable_chart_template", targetId: template.id,
      summary: `Archived reusable chart template ${template.name}.`, ipAddress: clientIp(req), userAgent: userAgent(req),
    });
    sendJson(res, 200, { reusableChartTemplate: archived });
    return;
  }
  if (action === "versions") {
    if (template.status === "archived") throw Object.assign(new Error("Archived reusable chart templates cannot be versioned."), { statusCode: 409, code: "reusable_chart_template_archived" });
    const body = await readJsonBody(req);
    const versions = await context.store.listReusableChartTemplateVersions({ reusableChartTemplateId: template.id });
    const current = versions.find((item) => item.id === template.currentVersionId) || versions[0];
    const nextVersion = Math.max(0, ...versions.map((item) => Number(item.version) || 0)) + 1;
    const checked = await templateVersionFromChart({
      context,
      projectId: template.projectId,
      sourceChartSpecId: body.sourceChartSpecId || current?.sourceChartSpecId,
      chartStyleProfileVersionId: Object.prototype.hasOwnProperty.call(body, "chartStyleProfileVersionId")
        ? body.chartStyleProfileVersionId
        : current?.chartStyleProfileVersionId,
      version: nextVersion,
    });
    const createdAt = new Date().toISOString();
    const version = {
      id: makeId("reusable_chart_template_version"), labId: template.labId, projectId: template.projectId,
      reusableChartTemplateId: template.id, ...checked, createdAt, createdBy: auth.user.id,
      acceptedAt: createdAt, acceptedBy: auth.user.id,
    };
    const stored = await context.store.appendReusableChartTemplateVersion({ templateId: template.id, version, actorUserId: auth.user.id, updatedAt: createdAt });
    await context.store.recordAuditEvent({
      labId: template.labId, projectId: template.projectId, actorUserId: auth.user.id,
      action: "reusable_chart_template.version", targetType: "reusable_chart_template", targetId: template.id,
      summary: `Created version ${nextVersion} of reusable chart template ${template.name}.`,
      metadata: { reusableChartTemplateVersionId: version.id, sourceChartSpecId: version.sourceChartSpecId, contentHash: version.contentHash },
      ipAddress: clientIp(req), userAgent: userAgent(req),
    });
    sendJson(res, 201, await reusableTemplateDetail(context, stored.template));
  }
}

function requiredIdempotencyKey(req, purpose) {
  const raw = req.headers["idempotency-key"];
  const value = Array.isArray(raw) ? String(raw[0] || "").trim() : String(raw || "").trim();
  if (!value) {
    throw Object.assign(new Error(`A valid Idempotency-Key header is required to ${purpose}.`), {
      statusCode: 400,
      code: "idempotency_key_required",
    });
  }
  if (value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw Object.assign(new Error("Idempotency-Key must use 1-200 letters, numbers, dots, underscores, colons, or hyphens."), {
      statusCode: 400,
      code: "invalid_idempotency_key",
    });
  }
  return value;
}

async function handleReusableChartTemplateApplication(req, res, context, templateVersionId) {
  const version = await context.store.findReusableChartTemplateVersionById(templateVersionId);
  if (!version) {
    throw Object.assign(new Error("Reusable chart template version was not found."), {
      statusCode: 404,
      code: "reusable_chart_template_version_not_found",
    });
  }
  const template = await context.store.findReusableChartTemplateById(version.reusableChartTemplateId);
  if (!template || template.status === "archived") {
    throw Object.assign(new Error("Reusable chart template is not available."), {
      statusCode: 409,
      code: "reusable_chart_template_archived",
    });
  }
  const { auth, project } = await projectAuth(req, context, version.projectId, "editor");
  const idempotencyKey = requiredIdempotencyKey(req, "apply a reusable chart template");
  const body = await readJsonBody(req);
  const experimentIds = asArray(body.experimentIds).map((item) => String(item || "").trim()).filter(Boolean);
  const explicitBindings = asArray(body.bindings).map((binding) => ({
    slotId: String(binding?.slotId || "").trim(),
    columnId: String(binding?.columnId || "").trim(),
  }));
  const requestHash = sha256Hex(JSON.stringify({
    reusableChartTemplateVersionId: version.id,
    contentHash: version.contentHash,
    experimentIds,
    bindings: explicitBindings,
  }));
  const priorApplication = await context.store.findReusableChartTemplateApplicationByIdempotencyKey({
    projectId: project.id,
    idempotencyKey,
  });
  if (priorApplication) {
    if (priorApplication.requestHash !== requestHash) {
      throw Object.assign(new Error("This idempotency key was already used for different template inputs."), {
        statusCode: 409,
        code: "chart_template_idempotency_conflict",
      });
    }
    const [analysisThread, analysisPlanRevision, analysisRun] = await Promise.all([
      priorApplication.analysisThreadId
        ? context.store.findAnalysisThreadById(priorApplication.analysisThreadId)
        : null,
      priorApplication.analysisPlanRevisionId
        ? context.store.findAnalysisPlanRevisionById(priorApplication.analysisPlanRevisionId)
        : null,
      priorApplication.analysisRunId
        ? context.store.findAnalysisRunById(priorApplication.analysisRunId)
        : null,
    ]);
    sendJson(res, 200, {
      schemaVersion: "labrat.reusableChartTemplateApplicationResponse.v1",
      replayed: true,
      application: priorApplication,
      compatibility: priorApplication.compatibility,
      analysisThread: analysisThread ? analysisThreadSummary(analysisThread) : null,
      analysisPlanRevision: analysisPlanRevision ? analysisPlanRevisionSummary(analysisPlanRevision) : null,
      analysisRun: analysisRun ? analysisRunSummary(analysisRun) : null,
    });
    return;
  }
  const compatibility = await prepareReusableChartTemplateApplication({
    store: context.store,
    projectId: project.id,
    templateVersion: version,
    experimentIds,
    explicitBindings,
  });
  const artifacts = buildReusableChartTemplateApplicationArtifacts({
    project,
    actorUserId: auth.user.id,
    templateVersion: { ...version, templateName: template.name },
    compatibility,
    idempotencyKey,
    requestHash,
  });
  const stored = await context.store.createReusableChartTemplateApplication({
    ...artifacts,
    auditEvents: [{
      id: makeId("audit"),
      labId: project.labId,
      projectId: project.id,
      actorUserId: auth.user.id,
      action: "reusable_chart_template.apply",
      targetType: "reusable_chart_template_application",
      targetId: artifacts.application.id,
      summary: compatibility.status === "ready"
        ? `Queued reusable chart template ${template.name}.`
        : `Checked reusable chart template ${template.name}; input confirmation is required.`,
      metadata: { reusableChartTemplateVersionId: version.id, compatibilityStatus: compatibility.status },
      createdAt: artifacts.application.createdAt,
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    }],
  });
  sendJson(res, stored.replayed ? 200 : 201, {
    schemaVersion: "labrat.reusableChartTemplateApplicationResponse.v1",
    replayed: stored.replayed,
    application: stored.application,
    compatibility: stored.application.compatibility,
    analysisThread: stored.analysisThread ? analysisThreadSummary(stored.analysisThread) : null,
    analysisPlanRevision: stored.analysisPlanRevision ? analysisPlanRevisionSummary(stored.analysisPlanRevision) : null,
    analysisRun: stored.analysisRun ? analysisRunSummary(stored.analysisRun) : null,
  });
}

async function handleChartSpecs(req, res, context, projectId) {
  await projectAuth(req, context, projectId, "viewer");
  const chartSpecs = await context.store.listChartSpecs({ projectId });
  sendJson(res, 200, {
    chartSpecs: chartSpecs.filter(isSupportedChartSpec).map(chartSpecListItem),
  });
}

async function handleChartSpecById(req, res, context, chartSpecId) {
  const chartSpec = await context.store.findChartSpecById(chartSpecId);
  if (!chartSpec || !isSupportedChartSpec(chartSpec)) {
    throw Object.assign(new Error("ChartSpec was not found."), {
      statusCode: 404,
      code: "chart_spec_not_found",
    });
  }
  await projectAuth(req, context, chartSpec.projectId, "viewer");
  sendJson(res, 200, { chartSpec });
}

async function handleChartSpecTemplateEligibility(req, res, context, chartSpecId) {
  const chartSpec = await context.store.findChartSpecById(chartSpecId);
  if (!chartSpec || !isSupportedChartSpec(chartSpec)) {
    throw Object.assign(new Error("ChartSpec was not found."), {
      statusCode: 404,
      code: "chart_spec_not_found",
    });
  }
  await projectAuth(req, context, chartSpec.projectId, "viewer");
  const eligibility = await inspectReusableChartTemplateEligibility({
    store: context.store,
    projectId: chartSpec.projectId,
    chartSpec,
  });
  if (eligibility.status === "eligible") {
    const definition = await deriveReusableChartTemplateDefinition({ store: context.store, projectId: chartSpec.projectId, chartSpec });
    sendJson(res, 200, {
      schemaVersion: "labrat.reusableChartTemplateEligibility.v1",
      status: "eligible",
      chartSpecId: chartSpec.id,
      experimentCardinality: definition.experimentCardinality,
      inputSlots: definition.inputSlots,
      encoding: definition.encoding,
      missingDataPolicy: definition.missingDataPolicy,
    });
    return;
  }
  sendJson(res, 200, {
    schemaVersion: "labrat.reusableChartTemplateEligibility.v1",
    status: "ineligible",
    chartSpecId: chartSpec.id,
    blockers: eligibility.blockers,
  });
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
  const projectAnalysisCapabilitiesMatch = pathName.match(/^\/api\/projects\/([^/]+)\/analysis-capabilities$/);
  if (projectAnalysisCapabilitiesMatch && req.method === "GET") {
    return handleProjectAnalysisCapabilities(req, res, context, projectAnalysisCapabilitiesMatch[1]);
  }
  const projectEvidenceRetrieveMatch = pathName.match(/^\/api\/projects\/([^/]+)\/evidence\/retrieve$/);
  if (projectEvidenceRetrieveMatch && req.method === "POST") return handleProjectEvidenceRetrieve(req, res, context, projectEvidenceRetrieveMatch[1]);
  const projectDataPlansMatch = pathName.match(/^\/api\/projects\/([^/]+)\/data-plans$/);
  if (projectDataPlansMatch && req.method === "GET") return handleProjectDataPlans(req, res, context, projectDataPlansMatch[1]);
  const projectDataSnapshotsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/data-snapshots$/);
  if (projectDataSnapshotsMatch && req.method === "GET") return handleProjectDataSnapshots(req, res, context, projectDataSnapshotsMatch[1]);
  const projectExperimentBrowserMatch = pathName.match(/^\/api\/projects\/([^/]+)\/experiment-browser$/);
  if (projectExperimentBrowserMatch && req.method === "GET") {
    return handleProjectExperimentBrowser(req, res, context, projectExperimentBrowserMatch[1], url);
  }
  const projectExperimentCustomValueMatch = pathName.match(/^\/api\/projects\/([^/]+)\/experiment-custom-columns\/([^/]+)\/experiments\/([^/]+)$/);
  if (projectExperimentCustomValueMatch && req.method === "PUT") return handleProjectExperimentCustomValue(req, res, context, projectExperimentCustomValueMatch[1], projectExperimentCustomValueMatch[2], projectExperimentCustomValueMatch[3]);
  const projectExperimentCustomColumnMatch = pathName.match(/^\/api\/projects\/([^/]+)\/experiment-custom-columns\/([^/]+)$/);
  if (projectExperimentCustomColumnMatch && (req.method === "PATCH" || req.method === "DELETE")) return handleProjectExperimentCustomColumn(req, res, context, projectExperimentCustomColumnMatch[1], projectExperimentCustomColumnMatch[2]);
  const projectExperimentCustomColumnsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/experiment-custom-columns$/);
  if (projectExperimentCustomColumnsMatch && (req.method === "GET" || req.method === "POST")) return handleProjectExperimentCustomColumns(req, res, context, projectExperimentCustomColumnsMatch[1]);
  const projectExperimentDetailMatch = pathName.match(/^\/api\/projects\/([^/]+)\/experiments\/([^/]+)$/);
  if (projectExperimentDetailMatch && req.method === "GET") {
    return handleProjectExperimentDetail(req, res, context, projectExperimentDetailMatch[1], projectExperimentDetailMatch[2]);
  }
  const projectExperimentAnnotationMatch = pathName.match(/^\/api\/projects\/([^/]+)\/experiments\/([^/]+)\/annotation$/);
  if (projectExperimentAnnotationMatch && (req.method === "PUT" || req.method === "DELETE")) {
    return handleProjectExperimentAnnotation(req, res, context, projectExperimentAnnotationMatch[1], projectExperimentAnnotationMatch[2]);
  }
  const projectExperimentAnnotationsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/experiment-annotations$/);
  if (projectExperimentAnnotationsMatch && req.method === "GET") {
    return handleProjectExperimentAnnotations(req, res, context, projectExperimentAnnotationsMatch[1]);
  }
  const projectBrowserConfigMatch = pathName.match(/^\/api\/projects\/([^/]+)\/browser-config$/);
  if (projectBrowserConfigMatch && (req.method === "GET" || req.method === "PATCH")) {
    return handleProjectBrowserConfig(req, res, context, projectBrowserConfigMatch[1]);
  }
  const projectBrowserViewsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/browser-views$/);
  if (projectBrowserViewsMatch && (req.method === "GET" || req.method === "POST")) {
    return handleProjectBrowserViews(req, res, context, projectBrowserViewsMatch[1]);
  }
  const projectBrowserViewMatch = pathName.match(/^\/api\/projects\/([^/]+)\/browser-views\/([^/]+)$/);
  if (projectBrowserViewMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    return handleProjectBrowserViewById(req, res, context, projectBrowserViewMatch[1], projectBrowserViewMatch[2]);
  }
  const projectAgentRunsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/agent\/runs$/);
  if (projectAgentRunsMatch && (req.method === "GET" || req.method === "POST")) return handleProjectAgentRuns(req, res, context, projectAgentRunsMatch[1]);
  const projectAnalysisThreadsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/analysis-threads$/);
  if (projectAnalysisThreadsMatch && (req.method === "GET" || req.method === "POST")) {
    return handleProjectAnalysisThreads(req, res, context, projectAnalysisThreadsMatch[1], url);
  }
  const projectChartStyleProfilesMatch = pathName.match(/^\/api\/projects\/([^/]+)\/chart-style-profiles$/);
  if (projectChartStyleProfilesMatch && (req.method === "GET" || req.method === "POST")) {
    return handleProjectChartStyleProfiles(req, res, context, projectChartStyleProfilesMatch[1], url);
  }
  const projectReusableChartTemplatesMatch = pathName.match(/^\/api\/projects\/([^/]+)\/reusable-chart-templates$/);
  if (projectReusableChartTemplatesMatch && (req.method === "GET" || req.method === "POST")) {
    return handleProjectReusableChartTemplates(req, res, context, projectReusableChartTemplatesMatch[1], url);
  }
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
  const regionUnderstandingsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/region-understandings$/);
  if (regionUnderstandingsMatch && req.method === "GET") return handleProjectRegionUnderstandings(req, res, context, regionUnderstandingsMatch[1]);
  const sourceDocumentRegionsMatch = pathName.match(/^\/api\/source-documents\/([^/]+)\/regions$/);
  if (sourceDocumentRegionsMatch && req.method === "GET") return handleSourceDocumentRegions(req, res, context, sourceDocumentRegionsMatch[1]);
  const sourceDocumentQueryMatch = pathName.match(/^\/api\/source-documents\/([^/]+)\/query$/);
  if (sourceDocumentQueryMatch && req.method === "POST") return handleSourceDocumentQuery(req, res, context, sourceDocumentQueryMatch[1]);
  const sourceDocumentRangeMatch = pathName.match(/^\/api\/source-documents\/([^/]+)\/range$/);
  if (sourceDocumentRangeMatch && req.method === "POST") return handleSourceDocumentRange(req, res, context, sourceDocumentRangeMatch[1]);
  const sourceDocumentCellClassesMatch = pathName.match(/^\/api\/source-documents\/([^/]+)\/cell-classes$/);
  if (sourceDocumentCellClassesMatch && req.method === "GET") return handleSourceDocumentCellClasses(req, res, context, sourceDocumentCellClassesMatch[1], url);
  const workbookReviewRegionInterpretMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)\/regions\/([^/]+)\/interpret$/);
  if (workbookReviewRegionInterpretMatch && req.method === "POST") {
    return handleWorkbookReviewRegionInterpret(req, res, context, workbookReviewRegionInterpretMatch[1], workbookReviewRegionInterpretMatch[2]);
  }
  const workbookReviewRegionRevisionsMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)\/regions\/([^/]+)\/revisions$/);
  if (workbookReviewRegionRevisionsMatch && (req.method === "GET" || req.method === "POST")) {
    return handleWorkbookReviewRegionRevisions(req, res, context, workbookReviewRegionRevisionsMatch[1], workbookReviewRegionRevisionsMatch[2]);
  }
  const workbookReviewRegionConfirmMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)\/regions\/([^/]+)\/confirm$/);
  if (workbookReviewRegionConfirmMatch && req.method === "POST") {
    return handleWorkbookReviewRegionConfirm(req, res, context, workbookReviewRegionConfirmMatch[1], workbookReviewRegionConfirmMatch[2]);
  }
  const workbookReviewRegionIgnoreMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)\/regions\/([^/]+)\/ignore$/);
  if (workbookReviewRegionIgnoreMatch && req.method === "POST") {
    return handleWorkbookReviewRegionIgnore(req, res, context, workbookReviewRegionIgnoreMatch[1], workbookReviewRegionIgnoreMatch[2]);
  }
  const workbookReviewRegionMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)\/regions\/([^/]+)$/);
  if (workbookReviewRegionMatch && (req.method === "GET" || req.method === "DELETE")) {
    return handleWorkbookReviewRegionById(req, res, context, workbookReviewRegionMatch[1], workbookReviewRegionMatch[2]);
  }
  const workbookReviewSessionRegionsMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)\/regions$/);
  if (workbookReviewSessionRegionsMatch && (req.method === "GET" || req.method === "POST")) {
    return handleWorkbookReviewSessionRegions(req, res, context, workbookReviewSessionRegionsMatch[1]);
  }
  const workbookReviewSessionMatch = pathName.match(/^\/api\/workbook-review-sessions\/([^/]+)$/);
  if (workbookReviewSessionMatch && (req.method === "GET" || req.method === "DELETE")) {
    return handleWorkbookReviewSessionById(req, res, context, workbookReviewSessionMatch[1]);
  }
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
  const analysisRunRetryMatch = pathName.match(/^\/api\/analysis-runs\/([^/]+)\/retry$/);
  if (analysisRunRetryMatch && req.method === "POST") {
    return handleAnalysisRunRetry(req, res, context, analysisRunRetryMatch[1]);
  }
  const analysisRunReviseMatch = pathName.match(/^\/api\/analysis-runs\/([^/]+)\/revise$/);
  if (analysisRunReviseMatch && req.method === "POST") {
    return handleAnalysisRunRevise(req, res, context, analysisRunReviseMatch[1]);
  }
  const analysisRunPublishChartMatch = pathName.match(
    /^\/api\/analysis-runs\/([^/]+)\/accept-and-create-chart$/,
  );
  if (analysisRunPublishChartMatch && req.method === "POST") {
    return handleAnalysisResultChartPublication(
      req,
      res,
      context,
      analysisRunPublishChartMatch[1],
    );
  }
  const analysisRunPublishExperimentsMatch = pathName.match(
    /^\/api\/analysis-runs\/([^/]+)\/accept-and-publish-experiments$/,
  );
  if (analysisRunPublishExperimentsMatch && req.method === "POST") {
    return handleAnalysisResultExperimentPublication(
      req,
      res,
      context,
      analysisRunPublishExperimentsMatch[1],
    );
  }
  const analysisRunMatch = pathName.match(/^\/api\/analysis-runs\/([^/]+)$/);
  if (analysisRunMatch && req.method === "GET") {
    return handleAnalysisRunById(req, res, context, analysisRunMatch[1]);
  }
  const analysisThreadPlanRevisionsMatch = pathName.match(/^\/api\/analysis-threads\/([^/]+)\/plan-revisions$/);
  if (analysisThreadPlanRevisionsMatch && req.method === "POST") {
    return handleAnalysisPlanRevisions(req, res, context, analysisThreadPlanRevisionsMatch[1]);
  }
  const analysisThreadRetryMatch = pathName.match(/^\/api\/analysis-threads\/([^/]+)\/retry$/);
  if (analysisThreadRetryMatch && req.method === "POST") {
    return handleAnalysisThreadRetry(req, res, context, analysisThreadRetryMatch[1]);
  }
  const analysisThreadMatch = pathName.match(/^\/api\/analysis-threads\/([^/]+)$/);
  if (analysisThreadMatch && req.method === "GET") {
    return handleAnalysisThreadById(req, res, context, analysisThreadMatch[1]);
  }
  const chartSpecsMatch = pathName.match(/^\/api\/projects\/([^/]+)\/chart-specs$/);
  if (chartSpecsMatch && req.method === "GET") return handleChartSpecs(req, res, context, chartSpecsMatch[1]);
  const chartStyleProfileMatch = pathName.match(/^\/api\/chart-style-profiles\/([^/]+)(?:\/(versions|archive))?$/);
  if (chartStyleProfileMatch && (
    (!chartStyleProfileMatch[2] && req.method === "GET")
    || (chartStyleProfileMatch[2] && req.method === "POST")
  )) return handleChartStyleProfile(req, res, context, chartStyleProfileMatch[1], chartStyleProfileMatch[2] || null);
  const reusableChartTemplateMatch = pathName.match(/^\/api\/reusable-chart-templates\/([^/]+)(?:\/(versions|archive))?$/);
  if (reusableChartTemplateMatch && (
    (!reusableChartTemplateMatch[2] && req.method === "GET")
    || (reusableChartTemplateMatch[2] && req.method === "POST")
  )) return handleReusableChartTemplate(req, res, context, reusableChartTemplateMatch[1], reusableChartTemplateMatch[2] || null);
  const reusableChartTemplateApplicationMatch = pathName.match(/^\/api\/reusable-chart-template-versions\/([^/]+)\/applications$/);
  if (reusableChartTemplateApplicationMatch && req.method === "POST") {
    return handleReusableChartTemplateApplication(req, res, context, reusableChartTemplateApplicationMatch[1]);
  }
  const chartSpecTemplateEligibilityMatch = pathName.match(/^\/api\/chart-specs\/([^/]+)\/template-eligibility$/);
  if (chartSpecTemplateEligibilityMatch && req.method === "GET") {
    return handleChartSpecTemplateEligibility(req, res, context, chartSpecTemplateEligibilityMatch[1]);
  }
  const chartSpecMatch = pathName.match(/^\/api\/chart-specs\/([^/]+)$/);
  if (chartSpecMatch && req.method === "GET") return handleChartSpecById(req, res, context, chartSpecMatch[1]);
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
    && !req.url?.startsWith("/api/agent-runs")
    && !req.url?.startsWith("/api/analysis-threads")
    && !req.url?.startsWith("/api/analysis-plan-revisions")
    && !req.url?.startsWith("/api/analysis-runs")
    && !req.url?.startsWith("/api/import-runs")
    && !req.url?.startsWith("/api/chart-specs")
    && !req.url?.startsWith("/api/chart-style-profiles")
    && !req.url?.startsWith("/api/reusable-chart-templates")
    && !req.url?.startsWith("/api/reusable-chart-template-versions")
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
