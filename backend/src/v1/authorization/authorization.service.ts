import { Injectable } from "@nestjs/common";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext, LabRole } from "../identity/identity.types.js";
import { normalizeLabRole } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import {
  hasExperimentCapability,
  hasProjectCapability,
  normalizeCapabilities,
  resolveEffectiveProjectAccess,
  type Capability,
  type EffectiveProjectAccess,
  type GrantScope,
} from "./authorization.policy.js";

function uniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function publicAccess(access: EffectiveProjectAccess) {
  return {
    projectId: access.projectId,
    shellOnly: access.shellOnly,
    capabilities: access.capabilities,
    allExperiments: access.allExperiments,
    experimentIds: access.experimentIds,
  };
}

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly repository: AuthorizationRepository,
    private readonly identityRepository: IdentityRepository,
  ) {}

  async resolveProjectAccess(auth: AuthContext, projectId: string) {
    const project = await this.repository.findProject(projectId);
    if (!project) return null;
    const membership = await this.repository.findLabMembership(auth.user.id, project.labId);
    if (!membership) return { project, access: null };
    const labRole = normalizeLabRole(membership.role);
    const grants = labRole === "lab_member"
      ? await this.repository.listEffectiveGrantRows(auth.user.id, project.id)
      : { projectGrants: [], experimentGrants: [] };
    const access = resolveEffectiveProjectAccess({
      projectId: project.id,
      labRole,
      projectGrants: grants.projectGrants.map((grant) => ({
        scope: grant.scope as GrantScope,
        capabilities: grant.capabilities,
      })),
      experimentGrants: grants.experimentGrants.map((grant) => ({
        experimentId: grant.experimentId,
        capabilities: grant.capabilities,
      })),
    });
    return { project, access };
  }

  async requireProjectCapability(
    auth: AuthContext,
    projectId: string,
    capability: Capability,
  ) {
    const resolved = await this.resolveProjectAccess(auth, projectId);
    if (!resolved?.access) {
      throw new ApiError(404, "project_not_found", "Project not found.");
    }
    if (!hasProjectCapability(resolved.access, capability)) {
      throw new ApiError(403, "forbidden", `Project capability ${capability} is required.`);
    }
    return resolved;
  }

  async requireFullProjectCapability(
    auth: AuthContext,
    projectId: string,
    capability: Capability,
  ) {
    const resolved = await this.requireProjectCapability(auth, projectId, capability);
    if (!resolved.access?.allExperiments) {
      throw new ApiError(403, "forbidden", `Full-project capability ${capability} is required.`);
    }
    return resolved;
  }

  async requireExperimentCapability(
    auth: AuthContext,
    projectId: string,
    experimentId: string,
    capability: Capability,
  ) {
    const resolved = await this.resolveProjectAccess(auth, projectId);
    if (!resolved?.access) {
      throw new ApiError(404, "experiment_not_found", "Experiment not found.");
    }
    if (!hasExperimentCapability(resolved.access, experimentId, capability)) {
      throw new ApiError(404, "experiment_not_found", "Experiment not found.");
    }
    return resolved;
  }

  async listAccessibleProjectIds(auth: AuthContext, labId: string): Promise<string[]> {
    if (!auth.memberships.some((membership) => membership.labId === labId)) return [];
    return this.repository.listAccessibleProjectIds(auth.user.id, labId);
  }

  requireLabAdministration(auth: AuthContext, labId: string): LabRole {
    return this.requireLabManager(auth, labId);
  }

  async getEffectiveAccess(auth: AuthContext, projectId: string) {
    const resolved = await this.resolveProjectAccess(auth, projectId);
    if (!resolved?.access || !hasProjectCapability(resolved.access, "read")) {
      throw new ApiError(404, "project_not_found", "Project not found.");
    }
    return publicAccess(resolved.access);
  }

  async listLabMembers(auth: AuthContext, labId: string) {
    this.requireLabManager(auth, labId);
    const rows = await this.repository.listLabMembers(labId);
    return rows.map(({ membership, user }) => ({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isActive: user.isActive,
        isSuperAdmin: user.isSuperAdmin,
      },
      role: normalizeLabRole(membership.role),
      status: membership.status,
    }));
  }

  async upsertLabMember(auth: AuthContext, labId: string, userId: string, role: "lab_admin" | "lab_member") {
    const actorRole = this.requireLabManager(auth, labId);
    if (role === "lab_admin" && actorRole !== "lab_owner") {
      throw new ApiError(403, "forbidden", "Only a Lab owner can appoint a Lab administrator.");
    }
    const result = await this.repository.upsertLabMember({
      labId,
      userId,
      role,
      actorUserId: auth.user.id,
    });
    if (!result) throw new ApiError(404, "member_target_not_found", "Lab or user not found.");
    if ("ownerProtected" in result) {
      throw new ApiError(409, "lab_owner_protected", "Lab ownership cannot be changed here.");
    }
    await this.identityRepository.recordAudit({
      labId,
      actorUserId: auth.user.id,
      action: "authorization.lab_member.upsert",
      targetType: "user",
      targetId: userId,
      summary: `Set Lab member role to ${role}.`,
      metadata: { role },
    });
    return { userId, role, status: "active" as const };
  }

  async deactivateLabMember(auth: AuthContext, labId: string, userId: string): Promise<void> {
    this.requireLabManager(auth, labId);
    const result = await this.repository.deactivateLabMember(labId, userId);
    if (!result) throw new ApiError(404, "lab_member_not_found", "Lab member not found.");
    if ("ownerProtected" in result) {
      throw new ApiError(409, "lab_owner_protected", "Lab owner cannot be deactivated here.");
    }
    await this.identityRepository.recordAudit({
      labId,
      actorUserId: auth.user.id,
      action: "authorization.lab_member.deactivate",
      targetType: "user",
      targetId: userId,
      summary: "Deactivated Lab membership.",
    });
  }

  async listGroups(auth: AuthContext, labId: string) {
    this.requireLabManager(auth, labId);
    return this.repository.listGroups(labId);
  }

  async createGroup(auth: AuthContext, labId: string, input: { name: string; description?: string }) {
    this.requireLabManager(auth, labId);
    try {
      const group = await this.repository.createGroup({
        labId,
        name: input.name.trim(),
        description: String(input.description || "").trim(),
        actorUserId: auth.user.id,
      });
      if (!group) throw new ApiError(500, "group_create_failed", "Group could not be created.");
      await this.auditGroup(auth, labId, group.id, "create", { name: group.name });
      return { ...group, memberUserIds: [] };
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new ApiError(409, "group_conflict", "An active group with this name already exists.");
      }
      throw error;
    }
  }

  async updateGroup(auth: AuthContext, labId: string, groupId: string, input: {
    name?: string;
    description?: string;
    status?: "active" | "inactive";
  }) {
    this.requireLabManager(auth, labId);
    try {
      const group = await this.repository.updateGroup(groupId, labId, {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        actorUserId: auth.user.id,
      });
      if (!group) throw new ApiError(404, "group_not_found", "Group not found.");
      await this.auditGroup(auth, labId, group.id, "update", input);
      const groups = await this.repository.listGroups(labId);
      return groups.find((candidate) => candidate.id === group.id) || { ...group, memberUserIds: [] };
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new ApiError(409, "group_conflict", "An active group with this name already exists.");
      }
      throw error;
    }
  }

  async deleteGroup(auth: AuthContext, labId: string, groupId: string): Promise<void> {
    this.requireLabManager(auth, labId);
    const group = await this.repository.disableGroup(groupId, labId, auth.user.id);
    if (!group) throw new ApiError(404, "group_not_found", "Group not found.");
    await this.auditGroup(auth, labId, group.id, "disable", {});
  }

  async addGroupMember(auth: AuthContext, labId: string, groupId: string, userId: string) {
    this.requireLabManager(auth, labId);
    const added = await this.repository.upsertGroupMember({
      groupId,
      labId,
      userId,
      actorUserId: auth.user.id,
    });
    if (!added) {
      throw new ApiError(404, "group_member_target_not_found", "Active group or Lab member not found.");
    }
    await this.auditGroup(auth, labId, groupId, "member_add", { userId });
    return this.groupById(labId, groupId);
  }

  async removeGroupMember(auth: AuthContext, labId: string, groupId: string, userId: string) {
    this.requireLabManager(auth, labId);
    const removed = await this.repository.removeGroupMember(groupId, labId, userId, auth.user.id);
    if (!removed) throw new ApiError(404, "group_member_not_found", "Group member not found.");
    await this.auditGroup(auth, labId, groupId, "member_remove", { userId });
    return this.groupById(labId, groupId);
  }

  async listAccessGrants(auth: AuthContext, projectId: string) {
    await this.requireProjectCapability(auth, projectId, "manage_access");
    const rows = await this.repository.listAccessGrants(projectId);
    return rows.map((grant) => this.publicGrant(grant));
  }

  async createAccessGrant(auth: AuthContext, projectId: string, input: {
    subject: { type: "user" | "group"; id: string };
    scope: GrantScope;
    capabilities: Capability[];
    experimentIds?: string[];
  }) {
    const { project } = await this.requireProjectCapability(auth, projectId, "manage_access");
    const capabilities = normalizeCapabilities(input.capabilities);
    if (!capabilities.length || !capabilities.includes("read")) {
      throw new ApiError(400, "invalid_access_grant", "Every access grant must include read.");
    }
    const experimentIds = [...new Set(input.experimentIds || [])].sort();
    if (input.scope === "selected_experiments" && !experimentIds.length) {
      throw new ApiError(400, "invalid_access_grant", "Selected-experiment access requires experiments.");
    }
    if (input.scope === "all_experiments" && experimentIds.length) {
      throw new ApiError(400, "invalid_access_grant", "All-experiment access must not list experiments.");
    }
    try {
      const result = await this.repository.createAccessGrant({
        project,
        subject: input.subject,
        scope: input.scope,
        capabilities,
        experimentIds,
        actorUserId: auth.user.id,
      });
      if ("invalidSubject" in result) {
        throw new ApiError(404, "access_subject_not_found", "Access subject not found in this Lab.");
      }
      if ("invalidExperiments" in result) {
        throw new ApiError(404, "experiment_not_found", "One or more experiments were not found.");
      }
      if (!result.projectGrant) {
        throw new ApiError(500, "access_grant_create_failed", "Access grant could not be created.");
      }
      const grant = this.publicGrant({ ...result.projectGrant, experimentIds });
      await this.identityRepository.recordAudit({
        labId: project.labId,
        projectId: project.id,
        actorUserId: auth.user.id,
        action: "authorization.project_grant.create",
        targetType: "project_access_grant",
        targetId: grant.id,
        summary: "Created project access grant.",
        metadata: {
          subject: grant.subject,
          scope: grant.scope,
          capabilities: grant.capabilities,
          experimentIds,
        },
      });
      return grant;
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new ApiError(409, "access_grant_conflict", "This subject already has an active grant.");
      }
      throw error;
    }
  }

  async deleteAccessGrant(auth: AuthContext, projectId: string, grantId: string): Promise<void> {
    const { project } = await this.requireProjectCapability(auth, projectId, "manage_access");
    const grant = await this.repository.disableAccessGrant(projectId, grantId, auth.user.id);
    if (!grant) throw new ApiError(404, "access_grant_not_found", "Access grant not found.");
    await this.identityRepository.recordAudit({
      labId: project.labId,
      projectId,
      actorUserId: auth.user.id,
      action: "authorization.project_grant.disable",
      targetType: "project_access_grant",
      targetId: grant.id,
      summary: "Disabled project access grant.",
    });
  }

  private requireLabManager(auth: AuthContext, labId: string): LabRole {
    const role = auth.memberships.find((membership) => membership.labId === labId)?.role;
    if (!role) throw new ApiError(404, "lab_not_found", "Lab not found.");
    if (role !== "lab_owner" && role !== "lab_admin") {
      throw new ApiError(403, "forbidden", "Lab access management is required.");
    }
    return role;
  }

  private publicGrant(grant: {
    id: string;
    labId: string;
    projectId: string;
    userId: string | null;
    groupId: string | null;
    scope: string;
    capabilities: string[];
    status: string;
    experimentIds: string[];
  }) {
    return {
      id: grant.id,
      labId: grant.labId,
      projectId: grant.projectId,
      subject: grant.userId
        ? { type: "user" as const, id: grant.userId }
        : { type: "group" as const, id: grant.groupId as string },
      scope: grant.scope as GrantScope,
      capabilities: normalizeCapabilities(grant.capabilities),
      experimentIds: grant.experimentIds,
      status: grant.status,
    };
  }

  private async groupById(labId: string, groupId: string) {
    const groups = await this.repository.listGroups(labId);
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) throw new ApiError(404, "group_not_found", "Group not found.");
    return group;
  }

  private async auditGroup(
    auth: AuthContext,
    labId: string,
    groupId: string,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    await this.identityRepository.recordAudit({
      labId,
      actorUserId: auth.user.id,
      action: `authorization.group.${action}`,
      targetType: "lab_group",
      targetId: groupId,
      summary: `Lab group ${action}.`,
      metadata,
    });
  }
}
