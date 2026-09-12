import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { IsIn, IsString, MaxLength, ValidateIf } from "class-validator";
import { makeId } from "../../saas/ids.js";
import type { AuthContext } from "../identity/identity.types.js";
import { normalizeLabRole } from "../identity/identity.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { auditEvents, labMemberships, labs, projectAccessGrants, users } from "../platform/database/schema.js";
import { ApiError } from "../platform/http/api-error.js";
import { PageQueryDto, pageOffset, pageResult } from "../platform/http/page-query.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import { AuthorizationService } from "./authorization.service.js";
import { resolveEffectiveProjectAccess, type GrantScope } from "./authorization.policy.js";

export const ACCESS_PRESETS = {
  none: [], view: ["read", "export"], edit: ["read", "propose", "export"],
  approve: ["read", "propose", "approve", "export"],
} as const;
export class SetMemberAccessDto {
  @IsIn(["none", "view", "edit", "approve"])
  preset!: keyof typeof ACCESS_PRESETS;

  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(200)
  expectedGrantId!: string | null;
}

@Injectable()
export class MemberAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: AuthorizationRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  private async project(auth: AuthContext, projectId: string) {
    const project = await this.repository.findProject(projectId);
    if (!project) throw new ApiError(404, "project_not_found", "Project not found.");
    this.authorization.requireLabAdministration(auth, project.labId);
    return project;
  }

  private async member(projectId: string, row: {
    membership: typeof labMemberships.$inferSelect; user: typeof users.$inferSelect;
  }) {
    const grants = await this.repository.listEffectiveGrantRows(row.user.id, projectId);
    const direct = grants.projectGrants.find((grant) => grant.userId === row.user.id);
    const role = normalizeLabRole(row.membership.role);
    const preset = direct ? Object.entries(ACCESS_PRESETS).find(([, caps]) =>
      caps.length === direct.capabilities.length && caps.every((cap) => direct.capabilities.includes(cap)))?.[0] || "custom" : "none";
    const sources = [
      ...(role !== "lab_member" ? [{ type: "lab_role", id: role, scope: "all_experiments", capabilities: ["read", "propose", "approve", "export", "manage_access"] }] : []),
      ...grants.projectGrants.map((grant) => ({
        type: grant.groupId ? "group" : "direct", id: grant.id, groupId: grant.groupId,
        scope: grant.scope, capabilities: grant.capabilities,
      })),
      ...grants.experimentGrants.map((grant) => ({
        type: grant.groupId ? "group_experiment" : "experiment", id: grant.id,
        groupId: grant.groupId, experimentId: grant.experimentId,
        scope: "selected_experiments", capabilities: grant.capabilities,
      })),
    ];
    return {
      user: { id: row.user.id, username: row.user.username, displayName: row.user.displayName, isActive: row.user.isActive },
      role, directGrant: direct ? { id: direct.id, scope: direct.scope, capabilities: direct.capabilities, preset } : null,
      editable: role === "lab_member" && row.user.isActive && (!direct || direct.scope === "all_experiments"),
      effectiveAccess: row.user.isActive ? resolveEffectiveProjectAccess({
        projectId, labRole: role,
        projectGrants: grants.projectGrants.map((grant) => ({ scope: grant.scope as GrantScope, capabilities: grant.capabilities })),
        experimentGrants: grants.experimentGrants,
      }) : null,
      sources,
    };
  }

  async list(auth: AuthContext, projectId: string, query: PageQueryDto) {
    const project = await this.project(auth, projectId);
    const offset = pageOffset(query.cursor);
    const rows = await this.database.db.select({ membership: labMemberships, user: users })
      .from(labMemberships).innerJoin(users, eq(users.id, labMemberships.userId)).where(and(
        eq(labMemberships.labId, project.labId), eq(labMemberships.status, "active"),
      )).orderBy(asc(users.displayName), asc(users.id)).offset(offset).limit(query.limit + 1);
    const page = pageResult(rows, offset, query.limit);
    return { ...page, items: await Promise.all(page.items.map((row) => this.member(projectId, row))) };
  }

  async set(auth: AuthContext, projectId: string, userId: string, body: SetMemberAccessDto) {
    const project = await this.project(auth, projectId);
    await this.database.db.transaction(async (tx) => {
      const [lab] = await tx.select().from(labs).where(eq(labs.id, project.labId)).for("update");
      const [actor] = await tx.select().from(labMemberships).where(and(
        eq(labMemberships.labId, project.labId), eq(labMemberships.userId, auth.user.id),
      )).for("share");
      if (lab?.status !== "active" || actor?.status !== "active" || !["lab_owner", "lab_admin"].includes(actor.role)) {
        throw new ApiError(403, "forbidden", "Lab administrator access is required.");
      }
      const [member] = await tx.select({ membership: labMemberships, user: users }).from(labMemberships)
        .innerJoin(users, eq(users.id, labMemberships.userId)).where(and(
          eq(labMemberships.labId, project.labId), eq(labMemberships.userId, userId),
          eq(labMemberships.status, "active"), eq(users.isActive, true),
        ));
      if (!member) throw new ApiError(404, "lab_member_not_found", "Active lab member not found.");
      if (normalizeLabRole(member.membership.role) !== "lab_member") {
        throw new ApiError(409, "inherited_lab_access", "Lab administrators inherit full project access.");
      }
      const [grant] = await tx.select().from(projectAccessGrants).where(and(
        eq(projectAccessGrants.projectId, projectId), eq(projectAccessGrants.userId, userId),
        eq(projectAccessGrants.status, "active"),
      )).for("update");
      if ((grant?.id || null) !== body.expectedGrantId) {
        throw new ApiError(409, "grant_conflict", "Permissions changed. Refresh before retrying.");
      }
      if (grant && grant.scope !== "all_experiments") {
        throw new ApiError(409, "advanced_grant", "Experiment-scoped grants cannot be edited with project presets.");
      }
      const now = new Date().toISOString();
      if (grant) await tx.update(projectAccessGrants).set({ status: "inactive", updatedAt: now, updatedBy: auth.user.id })
        .where(eq(projectAccessGrants.id, grant.id));
      let grantId: string | null = null;
      if (body.preset !== "none") {
        grantId = makeId("project_grant");
        await tx.insert(projectAccessGrants).values({
          id: grantId, labId: project.labId, projectId, userId, scope: "all_experiments",
          capabilities: [...ACCESS_PRESETS[body.preset]], status: "active",
          createdAt: now, updatedAt: now, createdBy: auth.user.id, updatedBy: auth.user.id,
        });
      }
      await tx.insert(auditEvents).values({
        id: makeId("audit"), labId: project.labId, projectId, actorUserId: auth.user.id,
        action: "authorization.member_access.set", targetType: "user", targetId: userId,
        createdAt: now, metadata: { preset: body.preset, previousGrantId: grant?.id || null, grantId },
        summary: "Replaced direct project access; inherited grants unchanged.",
      });
    });
    const [row] = await this.database.db.select({ membership: labMemberships, user: users })
      .from(labMemberships).innerJoin(users, eq(users.id, labMemberships.userId))
      .where(and(eq(labMemberships.labId, project.labId), eq(labMemberships.userId, userId)));
    return { memberAccess: await this.member(projectId, row!) };
  }
}
