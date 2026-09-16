import { Injectable } from "@nestjs/common";
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
} from "../../saas/reusableChartTemplates.js";
import {
  buildReusableChartTemplateApplicationArtifacts,
  prepareReusableChartTemplateApplication,
} from "../../saas/reusableChartTemplateApplications.js";
import { makeId, sha256Hex } from "../../saas/ids.js";
import {
  analysisPlanRevisionSummary,
  analysisRunSummary,
  analysisThreadSummary,
} from "../../saas/analysisThreads.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { Capability } from "../authorization/authorization.policy.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import type {
  ApplyReusableChartTemplateDto,
  CreateChartStyleProfileDto,
  CreateChartStyleProfileVersionDto,
  CreateReusableChartTemplateDto,
  CreateReusableChartTemplateVersionDto,
  ReusableChartPageQueryDto,
} from "./reusable-charts.dto.js";
import { ReusableChartsRepository } from "./reusable-charts.repository.js";

type DomainOperation = (input: Record<string, any>) => any;
type AsyncDomainOperation = (input: Record<string, any>) => Promise<any>;

const buildChartStyleProfileVersionCompat = buildChartStyleProfileVersion as DomainOperation;
const buildReusableChartTemplateVersionCompat = buildReusableChartTemplateVersion as DomainOperation;
const chartStyleProfileSummaryCompat = chartStyleProfileSummary as (
  profile: Record<string, any>,
  currentVersion?: Record<string, any> | null,
) => Record<string, any>;
const deriveReusableChartTemplateDefinitionCompat =
  deriveReusableChartTemplateDefinition as AsyncDomainOperation;
const inspectReusableChartTemplateEligibilityCompat =
  inspectReusableChartTemplateEligibility as AsyncDomainOperation;
const reusableChartTemplateSummaryCompat = reusableChartTemplateSummary as (
  template: Record<string, any>,
  currentVersion?: Record<string, any> | null,
) => Record<string, any>;
const prepareReusableChartTemplateApplicationCompat =
  prepareReusableChartTemplateApplication as AsyncDomainOperation;
const buildReusableChartTemplateApplicationArtifactsCompat =
  buildReusableChartTemplateApplicationArtifacts as DomainOperation;

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isSafeInteger(value?.offset) || value.offset < 0) throw new Error("invalid");
    return value.offset;
  } catch {
    throw new ApiError(400, "invalid_cursor", "The pagination cursor is invalid.");
  }
}

function page<T>(items: T[], query: ReusableChartPageQueryDto) {
  const offset = decodeCursor(query.cursor);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const visible = items.slice(0, limit);
  const nextOffset = offset + visible.length;
  return { items: visible, nextCursor: items.length > limit ? encodeCursor(nextOffset) : null };
}

function requiredIdempotencyKey(raw: string | string[] | undefined): string {
  const key = String(Array.isArray(raw) ? raw[0] || "" : raw || "").trim();
  if (!key) {
    throw new ApiError(400, "idempotency_key_required", "A valid Idempotency-Key is required to apply a reusable chart template.");
  }
  if (key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key must use 1-200 letters, numbers, dots, underscores, colons, or hyphens.");
  }
  return key;
}

@Injectable()
export class ReusableChartsService {
  constructor(
    private readonly repository: ReusableChartsRepository,
    private readonly authorization: AuthorizationService,
    private readonly identityRepository: IdentityRepository,
  ) {}

  async listStyleProfiles(auth: AuthContext, projectId: string, query: ReusableChartPageQueryDto) {
    await this.authorization.requireFullProjectCapability(auth, projectId, "read");
    const profiles = await this.repository.listChartStyleProfiles(
      projectId, query.includeArchived === "true", decodeCursor(query.cursor),
      Math.min(Math.max(Number(query.limit) || 50, 1), 100) + 1,
    );
    const items = await Promise.all(profiles.map(async (profile) => chartStyleProfileSummaryCompat(
      profile,
      profile.currentVersionId
        ? await this.repository.findChartStyleProfileVersionById(profile.currentVersionId)
        : null,
    )));
    return page(items, query);
  }

  async createStyleProfile(
    auth: AuthContext,
    projectId: string,
    input: CreateChartStyleProfileDto,
    requestMeta: Record<string, string | null>,
  ) {
    const { project } = await this.authorization.requireFullProjectCapability(auth, projectId, "propose");
    const name = reusableChartName(input.name, "name");
    const description = reusableChartDescription(input.description);
    const checked = buildChartStyleProfileVersionCompat({
      definition: input.style || input.definition || {},
      version: 1,
    });
    await this.validateStyleReference(project.id, checked);
    const createdAt = new Date().toISOString();
    const profileId = makeId("chart_style_profile");
    const versionId = makeId("chart_style_profile_version");
    const stored = await this.repository.createChartStyleProfile({
      profile: {
        id: profileId,
        labId: project.labId,
        projectId: project.id,
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
        projectId: project.id,
        chartStyleProfileId: profileId,
        ...checked,
        createdAt,
        createdBy: auth.user.id,
        acceptedAt: createdAt,
        acceptedBy: auth.user.id,
      },
    });
    await this.audit(auth, project, "chart_style_profile.create", "chart_style_profile", profileId,
      "Created chart style profile " + name + ".", {
        chartStyleProfileVersionId: versionId,
        contentHash: checked.contentHash,
      }, requestMeta);
    return this.styleProfileDetailPayload(stored.profile);
  }

  async styleProfileDetail(auth: AuthContext, profileId: string) {
    const profile = await this.styleProfile(auth, profileId, "read");
    return this.styleProfileDetailPayload(profile);
  }

  async createStyleProfileVersion(
    auth: AuthContext,
    profileId: string,
    input: CreateChartStyleProfileVersionDto,
    requestMeta: Record<string, string | null>,
  ) {
    const profile = await this.styleProfile(auth, profileId, "propose");
    if (profile.status === "archived") {
      throw new ApiError(409, "chart_style_profile_archived", "Archived chart style profiles cannot be versioned.");
    }
    const versions = await this.repository.listChartStyleProfileVersions(profile.id);
    const nextVersion = Math.max(0, ...versions.map((item: any) => Number(item.version) || 0)) + 1;
    const checked = buildChartStyleProfileVersionCompat({
      definition: input.style || input.definition || {},
      version: nextVersion,
    });
    await this.validateStyleReference(profile.projectId, checked);
    const createdAt = new Date().toISOString();
    const version = {
      id: makeId("chart_style_profile_version"),
      labId: profile.labId,
      projectId: profile.projectId,
      chartStyleProfileId: profile.id,
      ...checked,
      createdAt,
      createdBy: auth.user.id,
      acceptedAt: createdAt,
      acceptedBy: auth.user.id,
    };
    const stored = await this.repository.appendChartStyleProfileVersion({
      profileId: profile.id,
      version,
      actorUserId: auth.user.id,
      updatedAt: createdAt,
    });
    if (!stored) throw new ApiError(404, "chart_style_profile_not_found", "Chart style profile not found.");
    await this.audit(auth, profile, "chart_style_profile.version", "chart_style_profile", profile.id,
      "Created version " + nextVersion + " of chart style profile " + profile.name + ".", {
        chartStyleProfileVersionId: version.id,
        contentHash: version.contentHash,
      }, requestMeta);
    return this.styleProfileDetailPayload(stored.profile);
  }

  async archiveStyleProfile(
    auth: AuthContext,
    profileId: string,
    requestMeta: Record<string, string | null>,
  ) {
    const profile = await this.styleProfile(auth, profileId, "propose");
    const archived = await this.repository.archiveChartStyleProfile({
      profileId,
      actorUserId: auth.user.id,
      updatedAt: new Date().toISOString(),
    });
    await this.audit(auth, profile, "chart_style_profile.archive", "chart_style_profile", profile.id,
      "Archived chart style profile " + profile.name + ".", {}, requestMeta);
    return { chartStyleProfile: archived };
  }

  async listTemplates(auth: AuthContext, projectId: string, query: ReusableChartPageQueryDto) {
    await this.authorization.requireFullProjectCapability(auth, projectId, "read");
    const templates = await this.repository.listReusableChartTemplates(
      projectId, query.includeArchived === "true", decodeCursor(query.cursor),
      Math.min(Math.max(Number(query.limit) || 50, 1), 100) + 1,
    );
    const items = await Promise.all(templates.map(async (template) => reusableChartTemplateSummaryCompat(
      template,
      template.currentVersionId
        ? await this.repository.findReusableChartTemplateVersionById(template.currentVersionId)
        : null,
    )));
    return page(items, query);
  }

  async createTemplate(
    auth: AuthContext,
    projectId: string,
    input: CreateReusableChartTemplateDto,
    requestMeta: Record<string, string | null>,
  ) {
    const { project } = await this.authorization.requireFullProjectCapability(auth, projectId, "propose");
    const name = reusableChartName(input.name, "name");
    const description = reusableChartDescription(input.description);
    const checked = await this.templateVersionFromChart(
      project.id,
      input.sourceChartSpecId,
      input.chartStyleProfileVersionId,
      1,
    );
    const createdAt = new Date().toISOString();
    const templateId = makeId("reusable_chart_template");
    const versionId = makeId("reusable_chart_template_version");
    const stored = await this.repository.createReusableChartTemplate({
      template: {
        id: templateId,
        labId: project.labId,
        projectId: project.id,
        schemaVersion: REUSABLE_CHART_TEMPLATE_SCHEMA_VERSION,
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
        projectId: project.id,
        reusableChartTemplateId: templateId,
        ...checked,
        createdAt,
        createdBy: auth.user.id,
        acceptedAt: createdAt,
        acceptedBy: auth.user.id,
      },
    });
    await this.audit(auth, project, "reusable_chart_template.create", "reusable_chart_template", templateId,
      "Created reusable chart template " + name + ".", {
        reusableChartTemplateVersionId: versionId,
        sourceChartSpecId: checked.sourceChartSpecId,
        contentHash: checked.contentHash,
      }, requestMeta);
    return this.templateDetailPayload(stored.template);
  }

  async templateDetail(auth: AuthContext, templateId: string) {
    const template = await this.template(auth, templateId, "read");
    return this.templateDetailPayload(template);
  }

  async createTemplateVersion(
    auth: AuthContext,
    templateId: string,
    input: CreateReusableChartTemplateVersionDto,
    requestMeta: Record<string, string | null>,
  ) {
    const template = await this.template(auth, templateId, "propose");
    if (template.status === "archived") {
      throw new ApiError(409, "reusable_chart_template_archived", "Archived reusable chart templates cannot be versioned.");
    }
    const versions = await this.repository.listReusableChartTemplateVersions(template.id);
    const current = versions.find((item: any) => item.id === template.currentVersionId) || versions[0];
    const nextVersion = Math.max(0, ...versions.map((item: any) => Number(item.version) || 0)) + 1;
    const checked = await this.templateVersionFromChart(
      template.projectId,
      input.sourceChartSpecId || current?.sourceChartSpecId,
      Object.prototype.hasOwnProperty.call(input, "chartStyleProfileVersionId")
        ? input.chartStyleProfileVersionId
        : current?.chartStyleProfileVersionId,
      nextVersion,
    );
    const createdAt = new Date().toISOString();
    const version = {
      id: makeId("reusable_chart_template_version"),
      labId: template.labId,
      projectId: template.projectId,
      reusableChartTemplateId: template.id,
      ...checked,
      createdAt,
      createdBy: auth.user.id,
      acceptedAt: createdAt,
      acceptedBy: auth.user.id,
    };
    const stored = await this.repository.appendReusableChartTemplateVersion({
      templateId: template.id,
      version,
      actorUserId: auth.user.id,
      updatedAt: createdAt,
    });
    if (!stored) throw new ApiError(404, "reusable_chart_template_not_found", "Reusable chart template not found.");
    await this.audit(auth, template, "reusable_chart_template.version", "reusable_chart_template", template.id,
      "Created version " + nextVersion + " of reusable chart template " + template.name + ".", {
        reusableChartTemplateVersionId: version.id,
        sourceChartSpecId: version.sourceChartSpecId,
        contentHash: version.contentHash,
      }, requestMeta);
    return this.templateDetailPayload(stored.template);
  }

  async archiveTemplate(
    auth: AuthContext,
    templateId: string,
    requestMeta: Record<string, string | null>,
  ) {
    const template = await this.template(auth, templateId, "propose");
    const archived = await this.repository.archiveReusableChartTemplate({
      templateId,
      actorUserId: auth.user.id,
      updatedAt: new Date().toISOString(),
    });
    await this.audit(auth, template, "reusable_chart_template.archive", "reusable_chart_template", template.id,
      "Archived reusable chart template " + template.name + ".", {}, requestMeta);
    return { reusableChartTemplate: archived };
  }

  async eligibility(auth: AuthContext, chartSpecId: string) {
    const chartSpec = await this.repository.findChartSpecById(chartSpecId);
    if (!chartSpec || !this.supportedChartSpec(chartSpec)) {
      throw new ApiError(404, "chart_spec_not_found", "ChartSpec not found.");
    }
    await this.requireOwnedResource(auth, chartSpec.projectId, "read", "chart_spec_not_found", "ChartSpec not found.");
    const eligibility = await inspectReusableChartTemplateEligibilityCompat({
      store: this.repository,
      projectId: chartSpec.projectId,
      chartSpec,
    });
    if (eligibility.status !== "eligible") {
      return {
        schemaVersion: "labrat.reusableChartTemplateEligibility.v1",
        status: "ineligible",
        chartSpecId: chartSpec.id,
        blockers: eligibility.blockers,
      };
    }
    const definition = await deriveReusableChartTemplateDefinitionCompat({
      store: this.repository,
      projectId: chartSpec.projectId,
      chartSpec,
    });
    return {
      schemaVersion: "labrat.reusableChartTemplateEligibility.v1",
      status: "eligible",
      chartSpecId: chartSpec.id,
      experimentCardinality: definition.experimentCardinality,
      inputSlots: definition.inputSlots,
      encoding: definition.encoding,
      missingDataPolicy: definition.missingDataPolicy,
    };
  }

  async applyTemplate(
    auth: AuthContext,
    templateVersionId: string,
    input: ApplyReusableChartTemplateDto,
    rawKey: string | string[] | undefined,
    requestMeta: Record<string, string | null>,
  ) {
    const version = await this.repository.findReusableChartTemplateVersionById(templateVersionId);
    if (!version) {
      throw new ApiError(
        404,
        "reusable_chart_template_version_not_found",
        "Reusable chart template version not found.",
      );
    }
    await this.requireOwnedResource(
      auth,
      version.projectId,
      "propose",
      "reusable_chart_template_version_not_found",
      "Reusable chart template version not found.",
    );
    const template = await this.repository.findReusableChartTemplateById(version.reusableChartTemplateId);
    if (!template || template.status === "archived") {
      throw new ApiError(
        409,
        "reusable_chart_template_archived",
        "Reusable chart template is not available.",
      );
    }
    const key = requiredIdempotencyKey(rawKey);
    const experimentIds = input.experimentIds.map((item) => item.trim()).filter(Boolean);
    const bindings = asArray<Record<string, unknown>>(input.bindings).map((binding) => ({
      slotId: String(binding.slotId || "").trim(),
      columnId: String(binding.columnId || "").trim(),
    }));
    const requestHash = sha256Hex(JSON.stringify({
      reusableChartTemplateVersionId: version.id,
      contentHash: version.contentHash,
      experimentIds,
      bindings,
    }));
    const prior = await this.repository.findReusableChartTemplateApplicationByIdempotencyKey(
      version.projectId,
      key,
    );
    if (prior) {
      if (prior.requestHash !== requestHash) {
        throw new ApiError(
          409,
          "chart_template_idempotency_conflict",
          "This idempotency key was already used for different template inputs.",
        );
      }
      return {
        statusCode: 200,
        ...(await this.applicationResponse(prior, true)),
      };
    }
    const compatibility = await prepareReusableChartTemplateApplicationCompat({
      store: this.repository,
      projectId: version.projectId,
      templateVersion: version,
      experimentIds,
      explicitBindings: bindings,
    });
    const resolved = await this.authorization.requireFullProjectCapability(
      auth,
      version.projectId,
      "propose",
    );
    const artifacts = buildReusableChartTemplateApplicationArtifactsCompat({
      project: resolved.project,
      actorUserId: auth.user.id,
      templateVersion: { ...version, templateName: template.name },
      compatibility,
      idempotencyKey: key,
      requestHash,
    });
    const stored = await this.repository.createReusableChartTemplateApplication({
      ...artifacts,
      auditEvents: [{
        id: makeId("audit"),
        labId: resolved.project.labId,
        projectId: resolved.project.id,
        actorUserId: auth.user.id,
        action: "reusable_chart_template.apply",
        targetType: "reusable_chart_template_application",
        targetId: artifacts.application.id,
        summary: compatibility.status === "ready"
          ? "Queued reusable chart template " + template.name + "."
          : "Checked reusable chart template " + template.name + "; input confirmation is required.",
        metadata: {
          reusableChartTemplateVersionId: version.id,
          compatibilityStatus: compatibility.status,
        },
        createdAt: artifacts.application.createdAt,
        ...requestMeta,
      }],
    });
    return {
      statusCode: stored.replayed ? 200 : 201,
      ...(await this.applicationResponse(stored.application, stored.replayed, stored)),
    };
  }

  private async styleProfileDetailPayload(profile: Record<string, any>) {
    return {
      chartStyleProfile: profile,
      versions: await this.repository.listChartStyleProfileVersions(profile.id),
    };
  }

  private async templateDetailPayload(template: Record<string, any>) {
    return {
      reusableChartTemplate: template,
      versions: await this.repository.listReusableChartTemplateVersions(template.id),
    };
  }

  private async styleProfile(auth: AuthContext, profileId: string, capability: Capability) {
    const profile = await this.repository.findChartStyleProfileById(profileId);
    if (!profile) {
      throw new ApiError(404, "chart_style_profile_not_found", "Chart style profile not found.");
    }
    await this.requireOwnedResource(
      auth,
      profile.projectId,
      capability,
      "chart_style_profile_not_found",
      "Chart style profile not found.",
    );
    return profile;
  }

  private async template(auth: AuthContext, templateId: string, capability: Capability) {
    const template = await this.repository.findReusableChartTemplateById(templateId);
    if (!template) {
      throw new ApiError(404, "reusable_chart_template_not_found", "Reusable chart template not found.");
    }
    await this.requireOwnedResource(
      auth,
      template.projectId,
      capability,
      "reusable_chart_template_not_found",
      "Reusable chart template not found.",
    );
    return template;
  }

  private async requireOwnedResource(
    auth: AuthContext,
    projectId: string,
    capability: Capability,
    notFoundCode: string,
    notFoundMessage: string,
  ) {
    const resolved = await this.authorization.resolveProjectAccess(auth, projectId);
    if (!resolved?.access?.allExperiments) {
      throw new ApiError(404, notFoundCode, notFoundMessage);
    }
    if (!resolved.access.capabilities.includes(capability)) {
      throw new ApiError(
        403,
        "forbidden",
        "Full-project capability " + capability + " is required.",
      );
    }
    return resolved;
  }

  private async validateStyleReference(projectId: string, styleVersion: Record<string, any>) {
    const fileObjectId = String(styleVersion.reference?.fileObjectId || "").trim();
    if (!fileObjectId) return;
    const fileObject = await this.repository.findFileObjectById(fileObjectId);
    if (!fileObject || fileObject.projectId !== projectId) {
      throw new ApiError(
        404,
        "chart_style_reference_not_found",
        "Chart style reference file was not found in this project.",
      );
    }
  }

  private async acceptedStyleVersion(projectId: string, styleVersionId?: string | null) {
    const id = String(styleVersionId || "").trim();
    if (!id) return null;
    const version = await this.repository.findChartStyleProfileVersionById(id);
    if (!version || version.projectId !== projectId || version.status !== "accepted") {
      throw new ApiError(
        404,
        "chart_style_profile_not_accepted",
        "Accepted chart style profile version was not found in this project.",
      );
    }
    return version;
  }

  private async templateVersionFromChart(
    projectId: string,
    sourceChartSpecId: string | undefined,
    chartStyleProfileVersionId: string | null | undefined,
    version: number,
  ) {
    const chartSpec = await this.repository.findChartSpecById(
      String(sourceChartSpecId || "").trim(),
    );
    if (!chartSpec || chartSpec.projectId !== projectId || !this.supportedChartSpec(chartSpec)) {
      throw new ApiError(
        404,
        "chart_spec_not_found",
        "Accepted source ChartSpec was not found in this project.",
      );
    }
    const styleVersion = await this.acceptedStyleVersion(projectId, chartStyleProfileVersionId);
    const definition = await deriveReusableChartTemplateDefinitionCompat({
      store: this.repository,
      projectId,
      chartSpec,
      chartStyleProfileVersionId: styleVersion?.id || null,
    });
    return buildReusableChartTemplateVersionCompat({ definition, version });
  }

  private supportedChartSpec(chartSpec: Record<string, any>): boolean {
    return chartSpec.spec?.origin === "analysis_result"
      && chartSpec.spec?.schemaVersion === "labrat.chartSpec.v3";
  }

  private async applicationResponse(
    application: Record<string, any>,
    replayed: boolean,
    stored?: Record<string, any>,
  ) {
    const [thread, revision, run] = await Promise.all([
      stored?.analysisThread || (application.analysisThreadId
        ? this.repository.findAnalysisThreadById(application.analysisThreadId)
        : null),
      stored?.analysisPlanRevision || (application.analysisPlanRevisionId
        ? this.repository.findAnalysisPlanRevisionById(application.analysisPlanRevisionId)
        : null),
      stored?.analysisRun || (application.analysisRunId
        ? this.repository.findAnalysisRunById(application.analysisRunId)
        : null),
    ]);
    return {
      schemaVersion: "labrat.reusableChartTemplateApplicationResponse.v1",
      replayed,
      application,
      compatibility: application.compatibility,
      analysisThread: thread ? analysisThreadSummary(thread) : null,
      analysisPlanRevision: revision ? analysisPlanRevisionSummary(revision) : null,
      analysisRun: run ? analysisRunSummary(run) : null,
    };
  }

  private audit(
    auth: AuthContext,
    project: Record<string, any>,
    action: string,
    targetType: string,
    targetId: string,
    summary: string,
    metadata: Record<string, unknown>,
    requestMeta: Record<string, string | null>,
  ) {
    return this.identityRepository.recordAudit({
      labId: project.labId,
      projectId: project.projectId || project.id,
      actorUserId: auth.user.id,
      action,
      targetType,
      targetId,
      summary,
      metadata,
      ...(requestMeta.ipAddress ? { ipAddress: requestMeta.ipAddress } : {}),
      ...(requestMeta.userAgent ? { userAgent: requestMeta.userAgent } : {}),
    });
  }
}
