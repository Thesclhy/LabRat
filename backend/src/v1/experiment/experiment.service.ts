import { Injectable } from "@nestjs/common";
import {
  buildExperimentProjection,
  getExperimentProjectionDetail,
} from "../../saas/experimentProjection.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { hasExperimentCapability, type Capability } from "../authorization/authorization.policy.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import type {
  CreateBrowserViewDto,
  ExperimentAnnotationDto,
  ExperimentBrowserQueryDto,
  ProjectBrowserConfigDto,
  SaveExperimentCustomValueDto,
  UpdateBrowserViewDto,
} from "./experiment.dto.js";
import { ExperimentRepository } from "./experiment.repository.js";

const projectExperimentRows = buildExperimentProjection as unknown as (
  input: Record<string, unknown>,
) => Record<string, unknown>;
const projectExperimentDetail = getExperimentProjectionDetail as unknown as (
  input: Record<string, unknown>,
) => Record<string, unknown> | null;

const FILTER_OPERATORS = new Set([
  "contains", "eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "not_empty",
]);
const BROWSER_VIEW_KEYS = new Set(["columns", "filters", "sort", "groupBy", "selectedExperimentIds"]);
const BROWSER_CONFIG_KEYS = new Set(["columns", "filters", "sort"]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_browser_view", "Browser payload must be an object.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function parseArrayQuery(value: string | undefined, name: string, maxItems: number): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > maxItems) throw new Error("invalid array");
    return parsed;
  } catch {
    throw new ApiError(400, "invalid_browser_query", `Experiment Browser query parameter ${name} must be a bounded JSON array.`, {
      parameter: name,
      maxItems,
    });
  }
}

function normalizeViewPayload(value: unknown, allowedExperimentIds: string[] | null) {
  const source = record(value);
  const unknownKeys = Object.keys(source).filter((key) => !BROWSER_VIEW_KEYS.has(key));
  if (unknownKeys.length) {
    throw new ApiError(400, "invalid_browser_view", "Browser view contains unsupported fields.", { unknownKeys });
  }
  const rawColumns = source.columns ?? [];
  const rawFilters = source.filters ?? [];
  const rawSort = source.sort ?? [];
  const rawSelected = source.selectedExperimentIds ?? [];
  if (!Array.isArray(rawColumns) || rawColumns.length > 100) {
    throw new ApiError(400, "invalid_browser_view", "Browser view columns must be an array of at most 100 items.");
  }
  if (!Array.isArray(rawFilters) || rawFilters.length > 20) {
    throw new ApiError(400, "invalid_browser_view", "Browser view filters must be an array of at most 20 items.");
  }
  if (!Array.isArray(rawSort) || rawSort.length > 3) {
    throw new ApiError(400, "invalid_browser_view", "Browser view sort must be an array of at most 3 items.");
  }
  if (!Array.isArray(rawSelected) || rawSelected.length > 500) {
    throw new ApiError(400, "invalid_browser_view", "Browser view selected experiments must be an array of at most 500 ids.");
  }
  const columns = rawColumns.map((item, index) => {
    const column = record(item);
    const columnId = text(column.columnId);
    if (!columnId) throw new ApiError(400, "invalid_browser_view", "Every Browser view column requires columnId.");
    const width = column.width == null ? null : Number(column.width);
    if (width != null && (!Number.isFinite(width) || width < 60 || width > 800)) {
      throw new ApiError(400, "invalid_browser_view", "Browser view widths must be between 60 and 800 pixels.");
    }
    return {
      columnId,
      order: Number.isInteger(Number(column.order)) ? Number(column.order) : index,
      width,
      hidden: Boolean(column.hidden),
    };
  });
  if (new Set(columns.map((column) => column.columnId)).size !== columns.length) {
    throw new ApiError(400, "invalid_browser_view", "Browser view columns cannot contain duplicate ids.");
  }
  const filters = rawFilters.map((item) => {
    const filter = record(item);
    const columnId = text(filter.columnId);
    const operator = text(filter.operator).toLowerCase();
    if (!columnId || !FILTER_OPERATORS.has(operator)) {
      throw new ApiError(400, "invalid_browser_view", "Every Browser view filter requires a supported column and operator.");
    }
    return { columnId, operator, value: filter.value ?? null };
  });
  const sort = rawSort.map((item) => {
    const sortItem = record(item);
    const columnId = text(sortItem.columnId);
    if (!columnId) throw new ApiError(400, "invalid_browser_view", "Every Browser view sort item requires columnId.");
    return { columnId, direction: text(sortItem.direction).toLowerCase() === "desc" ? "desc" : "asc" };
  });
  const allowed = allowedExperimentIds ? new Set(allowedExperimentIds) : null;
  const selectedExperimentIds = [...new Set(rawSelected.map(text).filter((id) => id && (!allowed || allowed.has(id))))];
  return {
    columns,
    filters,
    sort,
    groupBy: source.groupBy == null ? null : text(source.groupBy) || null,
    selectedExperimentIds,
  };
}

function normalizeConfigPayload(value: unknown) {
  const source = record(value);
  const unknownKeys = Object.keys(source).filter((key) => !BROWSER_CONFIG_KEYS.has(key));
  if (unknownKeys.length) {
    throw new ApiError(400, "invalid_browser_view", "Project Browser configuration contains unsupported fields.", { unknownKeys });
  }
  const view = normalizeViewPayload({
    columns: source.columns ?? [],
    filters: source.filters ?? [],
    sort: source.sort ?? [],
    groupBy: null,
    selectedExperimentIds: [],
  }, null);
  return {
    columns: view.columns.map((column, index) => {
      const raw = (source.columns as unknown[] | undefined)?.[index];
      const labelOverride = raw && typeof raw === "object" && !Array.isArray(raw)
        ? text((raw as Record<string, unknown>).labelOverride).slice(0, 120)
        : "";
      return { ...column, ...(labelOverride ? { labelOverride } : {}) };
    }),
    filters: view.filters,
    sort: view.sort,
  };
}

@Injectable()
export class ExperimentService {
  constructor(
    private readonly repository: ExperimentRepository,
    private readonly authorization: AuthorizationService,
    private readonly identityRepository: IdentityRepository,
  ) {}

  async listDataPlans(auth: AuthContext, projectId: string) {
    await this.authorization.requireFullProjectCapability(auth, projectId, "read");
    const rows = await this.repository.listDataPlans(projectId);
    return rows.map((plan) => ({
      id: plan.id,
      projectId: plan.projectId,
      schemaVersion: plan.schemaVersion,
      status: plan.status,
      task: plan.task,
      outputShape: plan.outputShape,
      dependencyHash: plan.dependencyHash,
      warningCount: plan.warnings.length,
      acceptedAt: plan.acceptedAt,
      acceptedBy: plan.acceptedBy,
      createdAt: plan.createdAt,
    }));
  }

  async listDataSnapshots(auth: AuthContext, projectId: string) {
    const scope = await this.scope(auth, projectId, "read");
    const rows = await this.repository.listDataSnapshotSummaries(projectId, scope.experimentIds);
    return rows.map((snapshot) => ({
      id: snapshot.id,
      projectId,
      dataPlanId: snapshot.data_plan_id,
      analysisPlanRevisionId: snapshot.analysis_plan_revision_id,
      analysisRunId: snapshot.analysis_run_id,
      analysisResultId: snapshot.analysis_result_id,
      schemaVersion: snapshot.schema_version,
      status: snapshot.status,
      outputShape: snapshot.output_shape,
      contentHash: snapshot.content_hash,
      dependencyHash: snapshot.dependency_hash,
      acceptedAt: snapshot.accepted_at,
      acceptedBy: snapshot.accepted_by,
      createdAt: snapshot.created_at,
      authorizedExperimentCount: Number(snapshot.authorized_experiment_count),
      scope: scope.experimentIds === null ? "all_experiments" : "selected_experiments",
      ...(scope.experimentIds === null ? {
        summary: snapshot.summary || {},
        warningCount: Array.isArray(snapshot.warnings) ? snapshot.warnings.length : 0,
      } : {}),
    }));
  }

  async getBrowser(auth: AuthContext, projectId: string, query: ExperimentBrowserQueryDto) {
    const scope = await this.scope(auth, projectId, "read");
    const [state, annotations, customColumns, customValues] = await Promise.all([
      this.repository.loadProjectionState(projectId, scope.experimentIds),
      this.repository.listAnnotations(projectId, auth.user.id, scope.experimentIds),
      this.repository.listCustomColumns(projectId, scope.experimentIds),
      this.repository.listCustomValues(projectId, scope.experimentIds),
    ]);
    return projectExperimentRows({
      projectId,
      ...state,
      search: query.search || "",
      filters: parseArrayQuery(query.filters, "filters", 20),
      sort: parseArrayQuery(query.sort, "sort", 3),
      experimentAnnotations: annotations,
      experimentCustomColumns: customColumns,
      experimentCustomValues: customValues,
      starredOnly: query.starredOnly === "true",
      cursor: query.cursor || null,
      limit: query.limit,
    });
  }

  async getExperiment(auth: AuthContext, projectId: string, experimentId: string) {
    await this.authorization.requireExperimentCapability(auth, projectId, experimentId, "read");
    const state = await this.repository.loadProjectionState(projectId, [experimentId]);
    const detail = projectExperimentDetail({ projectId, experimentId, ...state });
    if (!detail) throw new ApiError(404, "experiment_not_found", "Experiment not found.");
    return detail;
  }

  async listAnnotations(auth: AuthContext, projectId: string) {
    const scope = await this.scope(auth, projectId, "read");
    return this.repository.listAnnotations(projectId, auth.user.id, scope.experimentIds);
  }

  async saveAnnotation(
    auth: AuthContext,
    projectId: string,
    experimentId: string,
    input: ExperimentAnnotationDto,
  ) {
    const { project } = await this.authorization.requireExperimentCapability(
      auth, projectId, experimentId, "read",
    );
    await this.requireActiveExperiment(projectId, experimentId);
    return this.repository.saveAnnotation({
      labId: project.labId,
      projectId,
      userId: auth.user.id,
      experimentId,
      note: text(input.note),
      color: input.color || "amber",
    });
  }

  async deleteAnnotation(auth: AuthContext, projectId: string, experimentId: string) {
    await this.authorization.requireExperimentCapability(auth, projectId, experimentId, "read");
    return this.repository.deleteAnnotation(projectId, auth.user.id, experimentId);
  }

  async listCustomColumns(auth: AuthContext, projectId: string) {
    const scope = await this.scope(auth, projectId, "read");
    return this.repository.listCustomColumns(projectId, scope.experimentIds);
  }

  async createCustomColumn(auth: AuthContext, projectId: string, label: string) {
    const { project } = await this.authorization.requireFullProjectCapability(auth, projectId, "propose");
    const column = await this.repository.createCustomColumn({
      labId: project.labId,
      projectId,
      label: text(label),
      actorUserId: auth.user.id,
    });
    await this.audit(auth, project.labId, projectId, "experiment_custom_column.create", column?.id || null);
    return column;
  }

  async updateCustomColumn(
    auth: AuthContext,
    projectId: string,
    columnId: string,
    input: { label: string; expectedVersion: number },
  ) {
    const { project } = await this.authorization.requireFullProjectCapability(auth, projectId, "propose");
    const column = await this.repository.updateCustomColumn({
      projectId,
      columnId,
      expectedVersion: input.expectedVersion,
      label: text(input.label),
      actorUserId: auth.user.id,
    });
    if (!column) {
      if (!await this.repository.findCustomColumn(projectId, columnId)) {
        throw new ApiError(404, "experiment_custom_column_not_found", "Experiment custom column not found.");
      }
      throw new ApiError(409, "experiment_custom_column_conflict", "The custom column changed. Reload and try again.");
    }
    await this.audit(auth, project.labId, projectId, "experiment_custom_column.update", column.id);
    return column;
  }

  async deleteCustomColumn(auth: AuthContext, projectId: string, columnId: string) {
    const { project } = await this.authorization.requireFullProjectCapability(auth, projectId, "propose");
    const deleted = await this.repository.deleteCustomColumn(projectId, columnId);
    if (!deleted) throw new ApiError(404, "experiment_custom_column_not_found", "Experiment custom column not found.");
    await this.audit(auth, project.labId, projectId, "experiment_custom_column.delete", columnId);
    return true;
  }

  async saveCustomValue(
    auth: AuthContext,
    projectId: string,
    columnId: string,
    experimentId: string,
    input: SaveExperimentCustomValueDto,
  ) {
    const { project } = await this.authorization.requireExperimentCapability(
      auth, projectId, experimentId, "propose",
    );
    if (!await this.repository.findCustomColumn(projectId, columnId)) {
      throw new ApiError(404, "experiment_custom_column_not_found", "Experiment custom column not found.");
    }
    await this.requireActiveExperiment(projectId, experimentId);
    const value = await this.repository.saveCustomValue({
      labId: project.labId,
      projectId,
      columnId,
      experimentId,
      value: input.value,
      expectedVersion: input.expectedVersion ?? 0,
      actorUserId: auth.user.id,
    });
    if (!value) {
      throw new ApiError(409, "experiment_custom_value_conflict", "The custom value changed. Reload and try again.");
    }
    await this.audit(auth, project.labId, projectId, "experiment_custom_value.update", value.id);
    return value;
  }

  async getBrowserConfig(auth: AuthContext, projectId: string) {
    const resolved = await this.authorization.requireFullProjectCapability(auth, projectId, "read");
    return {
      projectBrowserConfig: await this.repository.findBrowserConfig(projectId) || null,
      canEdit: Boolean(resolved.access?.capabilities.includes("propose")),
    };
  }

  async saveBrowserConfig(auth: AuthContext, projectId: string, input: ProjectBrowserConfigDto) {
    const { project } = await this.authorization.requireFullProjectCapability(auth, projectId, "propose");
    const config = await this.repository.saveBrowserConfig({
      labId: project.labId,
      projectId,
      payload: normalizeConfigPayload(input.payload),
      expectedVersion: input.expectedVersion,
      actorUserId: auth.user.id,
    });
    if (!config) {
      throw new ApiError(409, "project_browser_config_conflict", "The shared Browser configuration changed. Reload and try again.");
    }
    await this.audit(auth, project.labId, projectId, "project_browser_config.update", config.id);
    return { projectBrowserConfig: config, canEdit: true };
  }

  async listBrowserViews(auth: AuthContext, projectId: string) {
    const scope = await this.scope(auth, projectId, "read");
    const views = await this.repository.listBrowserViews(projectId, auth.user.id);
    return views.map((view) => ({
      ...view,
      payload: normalizeViewPayload(view.payload, scope.experimentIds),
    }));
  }

  async createBrowserView(auth: AuthContext, projectId: string, input: CreateBrowserViewDto) {
    const scope = await this.scope(auth, projectId, "propose");
    return this.repository.createBrowserView({
      labId: scope.project.labId,
      projectId,
      ownerUserId: auth.user.id,
      name: text(input.name),
      payload: normalizeViewPayload(input.payload, scope.experimentIds),
      isDefault: Boolean(input.isDefault),
    });
  }

  async updateBrowserView(
    auth: AuthContext,
    projectId: string,
    viewId: string,
    input: UpdateBrowserViewDto,
  ) {
    const scope = await this.scope(auth, projectId, "propose");
    if (!await this.repository.findBrowserView(projectId, auth.user.id, viewId)) {
      throw new ApiError(404, "browser_view_not_found", "Browser view not found.");
    }
    const updated = await this.repository.updateBrowserView({
      projectId,
      ownerUserId: auth.user.id,
      viewId,
      ...(input.name !== undefined ? { name: text(input.name) } : {}),
      ...(input.payload !== undefined ? { payload: normalizeViewPayload(input.payload, scope.experimentIds) } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    });
    if (!updated) throw new ApiError(404, "browser_view_not_found", "Browser view not found.");
    return updated;
  }

  async deleteBrowserView(auth: AuthContext, projectId: string, viewId: string) {
    await this.scope(auth, projectId, "propose");
    const deleted = await this.repository.deleteBrowserView(projectId, auth.user.id, viewId);
    if (!deleted) throw new ApiError(404, "browser_view_not_found", "Browser view not found.");
    return true;
  }

  private async scope(auth: AuthContext, projectId: string, capability: Capability) {
    const resolved = await this.authorization.requireProjectCapability(auth, projectId, capability);
    const access = resolved.access!;
    const experimentIds = access.allExperiments
      ? null
      : access.experimentIds.filter((experimentId) => hasExperimentCapability(access, experimentId, capability));
    return { ...resolved, experimentIds };
  }

  private async requireActiveExperiment(projectId: string, experimentId: string) {
    const state = await this.repository.loadProjectionState(projectId, [experimentId]);
    if (!state.experimentSnapshotHeads.length) {
      throw new ApiError(404, "experiment_not_found", "Experiment not found.");
    }
  }

  private async audit(
    auth: AuthContext,
    labId: string,
    projectId: string,
    action: string,
    targetId: string | null,
  ) {
    await this.identityRepository.recordAudit({
      labId,
      projectId,
      actorUserId: auth.user.id,
      action,
      targetType: action.split(".")[0] || "experiment",
      ...(targetId ? { targetId } : {}),
      summary: action,
    });
  }
}
