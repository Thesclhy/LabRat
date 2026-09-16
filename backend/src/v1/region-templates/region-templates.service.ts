import { Injectable } from "@nestjs/common";
import { makeId, sha256Hex } from "../../saas/ids.js";
import {
  buildRegionExtractionTemplateVersion, experimentLabelFromWorkbookName,
  matchTemplateVersionToDocument, regionExtractionTemplateDescription,
  regionExtractionTemplateName, regionExtractionTemplateSummary,
} from "../../saas/regionExtractionTemplates.js";
import { applyTemplateMatch, resolveExperimentLink } from "../../saas/regionTemplateApplications.js";
import { confirmWorkbookReviewRegion } from "../../saas/workbookReviewRegions.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { Capability } from "../authorization/authorization.policy.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { workbookReviewRegionSummary, regionUnderstandingRevisionSummary } from "../evidence/evidence.presenters.js";
import type { ApplyRegionTemplateDto, ConfirmRegionBatchDto, CreateRegionTemplateDto, MatchRegionTemplateDto, TemplateListQueryDto } from "./region-templates.dto.js";
import { RegionTemplatesRepository } from "./region-templates.repository.js";

type Value = Record<string, any>;
const buildVersion = buildRegionExtractionTemplateVersion as (input: Value) => any;
const matchDocument = matchTemplateVersionToDocument as (input: Value) => any;
const applyMatch = applyTemplateMatch as (input: Value) => Promise<any>;
const confirmRegion = confirmWorkbookReviewRegion as (input: Value) => Promise<any>;

@Injectable()
export class RegionTemplatesService {
  constructor(private readonly repository: RegionTemplatesRepository, private readonly authorization: AuthorizationService) {}

  private async owned(auth: AuthContext, record: { projectId: string } | null, capability: Capability) {
    if (!record) throw new ApiError(404, "region_extraction_template_not_found", "Region extraction template not found.");
    const resolved = await this.authorization.resolveProjectAccess(auth, record.projectId);
    if (!resolved?.access?.allExperiments) throw new ApiError(404, "region_extraction_template_not_found", "Region extraction template not found.");
    return this.authorization.requireFullProjectCapability(auth, record.projectId, capability);
  }

  private async detail(repository: RegionTemplatesRepository, template: Value) {
    return { regionExtractionTemplate: template, versions: await repository.listVersions(template.id) };
  }

  async list(auth: AuthContext, projectId: string, query: TemplateListQueryDto) {
    await this.authorization.requireFullProjectCapability(auth, projectId, "read");
    let offset = 0;
    if (query.cursor) {
      try {
        offset = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")).offset;
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error();
      } catch { throw new ApiError(400, "invalid_cursor", "The pagination cursor is invalid."); }
    }
    const limit = query.limit || 50;
    const rows = await this.repository.listTemplates(projectId, query.includeArchived === "true", offset, limit + 1);
    const items = await Promise.all(rows.slice(0, limit).map(async (template) =>
      (regionExtractionTemplateSummary as any)(template, template.currentVersionId ? await this.repository.findVersion(template.currentVersionId) : null)));
    return { items, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ offset: offset + limit })).toString("base64url") : null };
  }

  async get(auth: AuthContext, id: string) {
    const template = await this.repository.findTemplate(id);
    await this.owned(auth, template, "read");
    return this.detail(this.repository, template!);
  }

  async save(auth: AuthContext, projectId: string, input: CreateRegionTemplateDto | { regionId: string }, templateId?: string) {
    const { project } = templateId
      ? await this.owned(auth, await this.repository.findTemplate(templateId), "approve")
      : await this.authorization.requireFullProjectCapability(auth, projectId, "approve");
    try {
      return await this.repository.transaction(async (r) => {
        await r.authorize(auth, project, "approve");
        await r.lockProject(project.id);
        await this.authorization.requireFullProjectCapability(auth, project.id, "approve");
        let template = templateId ? await r.findTemplate(templateId, true) : null;
        if (templateId && (!template || template.projectId !== project.id)) throw new ApiError(404, "region_extraction_template_not_found", "Region extraction template not found.");
        if (template?.status === "archived") throw new ApiError(409, "region_extraction_template_archived", "Archived templates cannot be versioned.");
        const region = await r.lockRegion(input.regionId, project.id);
        if (!region || region.disposition !== "active" || !region.acceptedRevisionId) throw new ApiError(409, "region_extraction_template_requires_confirmed_region", "Confirm the region before saving an extraction template.");
        const revision = await r.evidence.findRegionUnderstandingRevisionById(region.acceptedRevisionId);
        const sourceDocument = await r.evidence.findSourceDocumentById(region.sourceDocumentId);
        if (!revision || revision.regionId !== region.id || !sourceDocument || sourceDocument.projectId !== project.id) throw new ApiError(409, "region_extraction_template_source_missing", "The accepted source is missing.");
        const prior = template ? await r.listVersions(template.id) : [];
        const checked = buildVersion({ sourceDocument, region, revision,
          indexBlobs: await r.evidence.listSourceIndexBlobs(sourceDocument.id),
          version: Math.max(0, ...prior.map((v) => v.version)) + 1 });
        const timestamp = new Date().toISOString();
        if (!template) {
          const create = input as CreateRegionTemplateDto;
          template = await r.createTemplate({
            id: makeId("region_extraction_template"), labId: project.labId, projectId: project.id,
            name: regionExtractionTemplateName(create.name), description: regionExtractionTemplateDescription(create.description),
            schemaVersion: "labrat.regionExtractionTemplate.v1", status: "active",
            createdAt: timestamp, updatedAt: timestamp, createdBy: auth.user.id, updatedBy: auth.user.id,
          });
        }
        const version = await r.insertVersion({ ...checked, id: makeId("region_extraction_template_version"),
          labId: project.labId, projectId: project.id, regionExtractionTemplateId: template.id,
          createdAt: timestamp, createdBy: auth.user.id });
        template = await r.updateTemplate(template.id, { currentVersionId: version.id, updatedAt: timestamp, updatedBy: auth.user.id });
        const experimentLabel = String(checked.signature?.experimentLabelRule?.exampleLabel || "").trim()
          || experimentLabelFromWorkbookName(checked.sourceWorkbookName);
        const link = (resolveExperimentLink as any)({ identities: await r.listIdentities(project.id), experimentLabel });
        const linkedExperimentId = region.linkedExperimentId || link.linkedExperimentId || null;
        const dataKind = region.dataKind || template.name;
        const changed = linkedExperimentId !== region.linkedExperimentId || dataKind !== region.dataKind;
        if (changed) await r.evidence.updateWorkbookReviewRegion(region.id, {
          linkedExperimentId, dataKind, expectedVersion: region.version, updatedBy: auth.user.id,
        });
        const sourceRegionLink = { regionId: region.id, linkedExperimentId, experimentLabel,
          linkStatus: region.linkedExperimentId ? "already_linked" : link.linkStatus, candidates: link.candidates, dataKind, changed };
        await r.audit(project, auth.user.id, templateId ? "region_extraction_template.version" : "region_extraction_template.create",
          "region_extraction_template", template.id, { regionExtractionTemplateVersionId: version.id,
            sourceRegionId: region.id, sourceRevisionId: revision.id, contentHash: version.contentHash, sourceRegionLink });
        return { ...await this.detail(r, template), sourceRegionLink };
      });
    } catch (error: any) {
      if ((error?.cause?.code || error?.code) === "23505") throw new ApiError(409, "region_extraction_template_conflict", "This template name or version already exists.");
      throw error;
    }
  }

  async archive(auth: AuthContext, id: string) {
    const { project } = await this.owned(auth, await this.repository.findTemplate(id), "propose");
    return this.repository.transaction(async (r) => {
      await r.authorize(auth, project, "propose");
      await r.lockProject(project.id);
      await this.authorization.requireFullProjectCapability(auth, project.id, "propose");
      const template = await r.updateTemplate(id, { status: "archived", updatedAt: new Date().toISOString(), updatedBy: auth.user.id });
      await r.audit(project, auth.user.id, "region_extraction_template.archive", "region_extraction_template", id);
      return { regionExtractionTemplate: template };
    });
  }

  async matches(auth: AuthContext, versionId: string, input: MatchRegionTemplateDto) {
    const version = await this.repository.findVersion(versionId);
    const { project } = await this.owned(auth, version, "read");
    const template = await this.repository.findTemplate(version!.regionExtractionTemplateId);
    const matches = [];
    for (const id of input.sourceDocumentIds) {
      const sourceDocument = await this.repository.evidence.findSourceDocumentById(id);
      if (!sourceDocument || sourceDocument.projectId !== project.id) {
        matches.push({ sourceDocumentId: id, status: "no_match", eligibleForBatchConfirm: false,
          warnings: [{ code: "source_document_not_found", message: "Source document was not found in this project." }] });
      } else matches.push(matchDocument({ templateVersion: version, sourceDocument,
        indexBlobs: await this.repository.evidence.listSourceIndexBlobs(id) }));
    }
    return { schemaVersion: "labrat.regionTemplateMatchList.v1", regionExtractionTemplateId: template?.id,
      templateName: template?.name, templateVersionId: versionId, templateVersion: version!.version, matches,
      summary: matches.reduce((counts: Value, m: Value) => ({ ...counts, [m.status]: (counts[m.status] || 0) + 1 }), {}) };
  }

  async apply(auth: AuthContext, versionId: string, input: ApplyRegionTemplateDto, rawKey: string | string[] | undefined) {
    const version = await this.repository.findVersion(versionId);
    const { project } = await this.owned(auth, version, "propose");
    if (typeof rawKey !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(rawKey)) throw new ApiError(400, "idempotency_key_required", "Provide a valid Idempotency-Key.");
    const requestHash = sha256Hex(JSON.stringify({ actorUserId: auth.user.id, versionId,
      contentHash: version!.contentHash, sourceDocumentIds: input.sourceDocumentIds, onlyStatuses: input.onlyStatuses || ["exact", "shifted"] }));
    return this.repository.transaction(async (r) => {
      await r.authorize(auth, project, "propose");
      await r.lockProject(project.id);
      await this.authorization.requireFullProjectCapability(auth, project.id, "propose");
      const prior = await r.findReceipt(project.id, rawKey);
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ApiError(409, "region_template_idempotency_conflict", "This key was already used for different inputs.");
        return prior.response;
      }
      const template = await r.findTemplate(version!.regionExtractionTemplateId, true);
      if (!template || template.status === "archived") throw new ApiError(409, "region_extraction_template_archived", "Archived templates cannot be applied.");
      // Lock sources in stable order before creating/reusing sessions and ranges.
      const sources = new Map<string, any>();
      for (const id of [...input.sourceDocumentIds].sort()) sources.set(id, await r.lockSource(id, project.id));
      const identities = await r.listIdentities(project.id);
      const applied = [], skipped = [];
      for (const id of input.sourceDocumentIds) {
        const sourceDocument = sources.get(id);
        if (!sourceDocument) { skipped.push({ sourceDocumentId: id, status: "no_match", reason: "source_document_not_found" }); continue; }
        const indexBlobs = await r.evidence.listSourceIndexBlobs(id);
        const report = matchDocument({ templateVersion: version, sourceDocument, indexBlobs });
        if (!(input.onlyStatuses || ["exact", "shifted"]).includes(report.status)) {
          skipped.push({ sourceDocumentId: id, workbookName: report.workbookName, status: report.status, reason: "not_eligible", matchedRange: report.matchedRange, sheetName: report.sheetName }); continue;
        }
        const outcome = await applyMatch({ store: r.domainStore(), project, actorUserId: auth.user.id,
          template, templateVersion: version, sourceDocument, indexBlobs, report, identities, idempotencyKey: rawKey });
        const entry = { sourceDocumentId: id, workbookName: report.workbookName, status: report.status,
          reason: outcome.reason, workbookReviewSessionId: outcome.session?.id || null,
          region: await workbookReviewRegionSummary(r.evidence, outcome.region),
          revision: regionUnderstandingRevisionSummary(outcome.revision),
          ...(outcome.warning ? { warning: outcome.warning } : {}) };
        if (outcome.skipped) skipped.push(entry); else applied.push({ ...entry, created: outcome.created });
        if (outcome.created) await r.audit(project, auth.user.id, "workbook_review_region.template_apply",
          "workbook_review_region", outcome.region.id, { regionExtractionTemplateVersionId: versionId, sourceDocumentId: id, matchStatus: report.status });
      }
      const response = { schemaVersion: "labrat.regionTemplateApplyResult.v1", regionExtractionTemplateId: template.id,
        templateName: template.name, templateVersionId: versionId, templateVersion: version!.version, applied, skipped };
      await r.saveReceipt({ projectId: project.id, labId: project.labId, actorUserId: auth.user.id,
        idempotencyKey: rawKey, requestHash, templateVersionId: versionId, response, createdAt: new Date().toISOString() });
      return response;
    });
  }

  async confirmBatch(auth: AuthContext, projectId: string, input: ConfirmRegionBatchDto) {
    const { project } = await this.authorization.requireFullProjectCapability(auth, projectId, "approve");
    const results: Value[] = [];
    for (const item of input.items) {
      try {
        results.push(await this.repository.transaction(async (r) => {
          await r.authorize(auth, project, "approve");
          const region = await r.lockRegion(item.regionId, projectId);
          await this.authorization.requireFullProjectCapability(auth, projectId, "approve");
          if (!region) throw new ApiError(404, "workbook_review_region_not_found", "Region not found.");
          if (region.selectionMethod !== "template_match" || !["exact", "shifted"].includes(String(region.templateMatch?.status))) throw new ApiError(409, "batch_confirm_requires_individual_review", "This region requires individual review.");
          if (region.version !== item.expectedRegionVersion) throw new ApiError(409, "stale_workbook_review_region", "Region changed; reload before confirming.");
          const linkedId = item.linkedExperimentId || region.linkedExperimentId;
          if (!linkedId || !(await r.listIdentities(projectId)).some((identity) => identity.id === linkedId)) throw new ApiError(409, "experiment_identity_required", "Choose an experiment from this project before confirming.");
          let current = region;
          if (linkedId !== region.linkedExperimentId) current = (await r.evidence.updateWorkbookReviewRegion(region.id, {
            linkedExperimentId: linkedId, expectedVersion: region.version,
            templateMatch: { ...region.templateMatch, linkStatus: "resolved", linkedBy: auth.user.id }, updatedBy: auth.user.id,
          }))!;
          const confirmed = await confirmRegion({ store: r.domainStore(), region: current, revisionId: item.revisionId,
            expectedRegionVersion: current.version, actorUserId: auth.user.id });
          await r.audit(project, auth.user.id, "workbook_review_region.confirm", "region_understanding_revision",
            confirmed.revision.id, { regionId: region.id, batch: true, linkedExperimentId: linkedId });
          return { regionId: region.id, ok: true, code: "confirmed",
            region: await workbookReviewRegionSummary(r.evidence, confirmed.region),
            acceptedRevision: regionUnderstandingRevisionSummary(confirmed.revision) };
        }));
      } catch (error: any) {
        const safe = Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500;
        results.push({ regionId: item.regionId, ok: false, code: safe ? error.code : "batch_confirm_failed",
          message: safe ? error.message : "Could not confirm this region; retry after reloading." });
      }
    }
    return { schemaVersion: "labrat.regionBatchConfirmResult.v1", projectId, results,
      confirmedCount: results.filter((result) => result.ok).length, rejectedCount: results.filter((result) => !result.ok).length };
  }
}
