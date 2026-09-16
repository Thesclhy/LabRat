import { Injectable } from "@nestjs/common";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import type { ProjectProfileDto } from "./workspace.dto.js";
import { WorkspaceRepository } from "./workspace.repository.js";

const PROFILE_VERSION = "labrat.projectProfile.v1";
const PROFILE_TEXT_FIELDS = [
  "researchGoal",
  "experimentBackground",
  "materials",
  "methods",
  "instruments",
  "analysisNotes",
] as const;

type ProjectRow = Awaited<ReturnType<WorkspaceRepository["updateProject"]>> & {};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function projectProfile(project: { metadata: Record<string, unknown> }) {
  const profile = objectValue(project.metadata.projectProfile);
  return {
    schemaVersion: PROFILE_VERSION,
    ...Object.fromEntries(PROFILE_TEXT_FIELDS.map((field) => [field, String(profile[field] || "")])),
    tags: Array.isArray(profile.tags) ? profile.tags.map(String) : [],
  };
}

function mergeProjectProfile(
  metadata: Record<string, unknown>,
  input: ProjectProfileDto,
  actorUserId: string,
) {
  const previous = objectValue(metadata.projectProfile);
  const next: Record<string, unknown> = { schemaVersion: PROFILE_VERSION };
  for (const field of PROFILE_TEXT_FIELDS) {
    next[field] = input[field] !== undefined ? input[field] : String(previous[field] || "");
  }
  next.tags = input.tags !== undefined
    ? [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))]
    : Array.isArray(previous.tags) ? previous.tags.map(String) : [];
  next.updatedAt = new Date().toISOString();
  next.updatedBy = actorUserId;
  return { ...metadata, projectProfile: next };
}

function publicProject(project: NonNullable<ProjectRow>, access: {
  shellOnly: boolean;
  capabilities: string[];
}, workflowSummary: Record<string, number> | null = null) {
  return {
    id: project.id,
    labId: project.labId,
    name: project.name,
    description: project.description || "",
    status: project.status,
    shellOnly: access.shellOnly,
    capabilities: access.capabilities,
    ...(!access.shellOnly ? { projectProfile: projectProfile(project) } : {}),
    ...(!access.shellOnly && workflowSummary ? { workflowSummary } : {}),
  };
}

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly identityRepository: IdentityRepository,
  ) {}

  async listProjects(auth: AuthContext, requestedLabId?: string) {
    const labId = requestedLabId || auth.memberships[0]?.labId;
    if (!labId) return [];
    const projectIds = await this.authorizationService.listAccessibleProjectIds(auth, labId);
    const projects = await this.repository.listProjectsByIds(projectIds);
    const visible = [];
    for (const project of projects) {
      const resolved = await this.authorizationService.resolveProjectAccess(auth, project.id);
      if (resolved?.access?.capabilities.includes("read")) {
        const workflowSummary = resolved.access.shellOnly
          ? null
          : await this.repository.projectWorkflowSummary(project.id);
        visible.push(publicProject(project, resolved.access, workflowSummary));
      }
    }
    return visible;
  }

  async getProject(auth: AuthContext, projectId: string) {
    const { project, access } = await this.authorizationService.requireProjectCapability(
      auth,
      projectId,
      "read",
    );
    const workflowSummary = access!.shellOnly
      ? null
      : await this.repository.projectWorkflowSummary(project.id);
    return publicProject(project, access!, workflowSummary);
  }

  async createProject(auth: AuthContext, input: {
    labId: string;
    name: string;
    description?: string;
    projectProfile?: ProjectProfileDto;
  }) {
    this.authorizationService.requireLabAdministration(auth, input.labId);
    const metadata = input.projectProfile
      ? mergeProjectProfile({}, input.projectProfile, auth.user.id)
      : {};
    const project = await this.repository.createProject({
      labId: input.labId,
      name: input.name.trim(),
      description: String(input.description || "").trim(),
      metadata,
      actorUserId: auth.user.id,
    });
    await this.identityRepository.recordAudit({
      labId: project.labId,
      projectId: project.id,
      actorUserId: auth.user.id,
      action: "project.create",
      targetType: "project",
      targetId: project.id,
      summary: `Created project ${project.name}.`,
    });
    const resolved = await this.authorizationService.resolveProjectAccess(auth, project.id);
    if (!resolved?.access) {
      throw new ApiError(500, "project_access_failed", "Created project access could not be resolved.");
    }
    return publicProject(
      project,
      resolved.access,
      resolved.access.shellOnly ? null : await this.repository.projectWorkflowSummary(project.id),
    );
  }

  async updateProject(auth: AuthContext, projectId: string, input: {
    name?: string;
    description?: string;
    status?: "active" | "archived";
  }) {
    const { project, access } = await this.authorizationService.requireFullProjectCapability(
      auth,
      projectId,
      "propose",
    );
    const updated = await this.repository.updateProject(project.id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      actorUserId: auth.user.id,
    });
    if (!updated) throw new ApiError(404, "project_not_found", "Project not found.");
    await this.auditProject(auth, updated, "project.update", Object.keys(input));
    if (updated.status === "archived") {
      return publicProject(
        updated,
        access!,
        access!.shellOnly ? null : await this.repository.projectWorkflowSummary(updated.id),
      );
    }
    const resolved = await this.authorizationService.resolveProjectAccess(auth, updated.id);
    if (!resolved?.access) throw new ApiError(404, "project_not_found", "Project not found.");
    return publicProject(
      updated,
      resolved.access,
      resolved.access.shellOnly ? null : await this.repository.projectWorkflowSummary(updated.id),
    );
  }

  async updateProjectProfile(auth: AuthContext, projectId: string, input: ProjectProfileDto) {
    const { project } = await this.authorizationService.requireFullProjectCapability(
      auth,
      projectId,
      "propose",
    );
    const updated = await this.repository.updateProject(project.id, {
      metadata: mergeProjectProfile(project.metadata, input, auth.user.id),
      actorUserId: auth.user.id,
    });
    if (!updated) throw new ApiError(404, "project_not_found", "Project not found.");
    await this.auditProject(auth, updated, "project.profile.update", ["projectProfile"]);
    const resolved = await this.authorizationService.resolveProjectAccess(auth, updated.id);
    if (!resolved?.access) throw new ApiError(404, "project_not_found", "Project not found.");
    return publicProject(
      updated,
      resolved.access,
      resolved.access.shellOnly ? null : await this.repository.projectWorkflowSummary(updated.id),
    );
  }

  private async auditProject(
    auth: AuthContext,
    project: NonNullable<ProjectRow>,
    action: string,
    changed: string[],
  ) {
    await this.identityRepository.recordAudit({
      labId: project.labId,
      projectId: project.id,
      actorUserId: auth.user.id,
      action,
      targetType: "project",
      targetId: project.id,
      summary: `Updated project ${project.name}.`,
      metadata: { changed },
    });
  }
}
