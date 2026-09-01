import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  eq,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  experimentAccessGrants,
  experimentIdentities,
  labGroupMembers,
  labGroups,
  labMemberships,
  labs,
  projectAccessGrants,
  projects,
  users,
} from "../platform/database/schema.js";
import type { Capability, GrantScope } from "./authorization.policy.js";

type ProjectRow = typeof projects.$inferSelect;
type MembershipRow = typeof labMemberships.$inferSelect;

@Injectable()
export class AuthorizationRepository {
  constructor(private readonly database: DatabaseService) {}

  findProject(projectId: string): Promise<ProjectRow | undefined> {
    return this.database.db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.status, "active")),
    });
  }

  findLabMembership(userId: string, labId: string): Promise<MembershipRow | undefined> {
    return this.database.db.query.labMemberships.findFirst({
      where: and(
        eq(labMemberships.userId, userId),
        eq(labMemberships.labId, labId),
        eq(labMemberships.status, "active"),
      ),
    });
  }

  async listEffectiveGrantRows(userId: string, projectId: string) {
    const activeGroupIds = this.database.db
      .select({ id: labGroupMembers.groupId })
      .from(labGroupMembers)
      .innerJoin(labGroups, eq(labGroups.id, labGroupMembers.groupId))
      .where(and(
        eq(labGroupMembers.userId, userId),
        eq(labGroupMembers.status, "active"),
        eq(labGroups.status, "active"),
      ));
    const subject = or(
      eq(projectAccessGrants.userId, userId),
      inArray(projectAccessGrants.groupId, activeGroupIds),
    );
    const experimentSubject = or(
      eq(experimentAccessGrants.userId, userId),
      inArray(experimentAccessGrants.groupId, activeGroupIds),
    );
    const [projectGrants, experimentGrants] = await Promise.all([
      this.database.db
        .select()
        .from(projectAccessGrants)
        .where(and(
          eq(projectAccessGrants.projectId, projectId),
          eq(projectAccessGrants.status, "active"),
          subject,
        )),
      this.database.db
        .select()
        .from(experimentAccessGrants)
        .where(and(
          eq(experimentAccessGrants.projectId, projectId),
          eq(experimentAccessGrants.status, "active"),
          experimentSubject,
        )),
    ]);
    return { projectGrants, experimentGrants };
  }

  async listAccessibleProjectIds(userId: string, labId: string): Promise<string[]> {
    const result = await this.database.db.execute<{ id: string }>(sql`
      select distinct project.id
      from projects project
      join lab_memberships membership
        on membership.lab_id = project.lab_id
       and membership.user_id = ${userId}
       and membership.status = 'active'
      where project.lab_id = ${labId}
        and project.status = 'active'
        and (
          membership.role in ('lab_owner', 'lab_admin')
          or exists (
            select 1
            from project_access_grants grant_row
            where grant_row.project_id = project.id
              and grant_row.status = 'active'
              and (
                grant_row.user_id = ${userId}
                or grant_row.group_id in (
                  select member.group_id
                  from lab_group_members member
                  join lab_groups group_row on group_row.id = member.group_id
                  where member.user_id = ${userId}
                    and member.status = 'active'
                    and group_row.status = 'active'
                )
              )
          )
          or exists (
            select 1
            from experiment_access_grants grant_row
            where grant_row.project_id = project.id
              and grant_row.status = 'active'
              and (
                grant_row.user_id = ${userId}
                or grant_row.group_id in (
                  select member.group_id
                  from lab_group_members member
                  join lab_groups group_row on group_row.id = member.group_id
                  where member.user_id = ${userId}
                    and member.status = 'active'
                    and group_row.status = 'active'
                )
              )
          )
        )
      order by project.id
    `);
    return result.rows.map((row) => row.id);
  }

  async listLabMembers(labId: string) {
    return this.database.db
      .select({ membership: labMemberships, user: users })
      .from(labMemberships)
      .innerJoin(users, eq(users.id, labMemberships.userId))
      .where(and(eq(labMemberships.labId, labId), eq(labMemberships.status, "active")))
      .orderBy(asc(users.displayName), asc(users.id));
  }

  async upsertLabMember(input: {
    labId: string;
    userId: string;
    role: "lab_admin" | "lab_member";
    actorUserId: string;
  }) {
    const now = new Date().toISOString();
    return this.database.db.transaction(async (tx) => {
      const lab = await tx.select({ id: labs.id }).from(labs)
        .where(and(eq(labs.id, input.labId), eq(labs.status, "active"))).limit(1);
      const user = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.id, input.userId), eq(users.isActive, true))).limit(1);
      if (!lab[0] || !user[0]) return null;
      const [existing] = await tx
        .select()
        .from(labMemberships)
        .where(and(eq(labMemberships.labId, input.labId), eq(labMemberships.userId, input.userId)))
        .limit(1);
      if (existing?.role === "lab_owner") return { ownerProtected: true as const };
      if (existing) {
        const [membership] = await tx
          .update(labMemberships)
          .set({ role: input.role, status: "active", updatedAt: now })
          .where(eq(labMemberships.id, existing.id))
          .returning();
        return { membership };
      }
      const [membership] = await tx.insert(labMemberships).values({
        id: makeId("membership"),
        labId: input.labId,
        userId: input.userId,
        role: input.role,
        status: "active",
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorUserId,
      }).returning();
      return { membership };
    });
  }

  async deactivateLabMember(labId: string, userId: string) {
    const [existing] = await this.database.db
      .select()
      .from(labMemberships)
      .where(and(eq(labMemberships.labId, labId), eq(labMemberships.userId, userId)))
      .limit(1);
    if (!existing) return null;
    if (existing.role === "lab_owner") return { ownerProtected: true as const };
    const [membership] = await this.database.db
      .update(labMemberships)
      .set({ status: "inactive", updatedAt: new Date().toISOString() })
      .where(eq(labMemberships.id, existing.id))
      .returning();
    return { membership };
  }

  async listGroups(labId: string) {
    const groups = await this.database.db
      .select()
      .from(labGroups)
      .where(and(eq(labGroups.labId, labId), eq(labGroups.status, "active")))
      .orderBy(asc(labGroups.name), asc(labGroups.id));
    if (!groups.length) return [];
    const members = await this.database.db
      .select()
      .from(labGroupMembers)
      .where(and(
        inArray(labGroupMembers.groupId, groups.map((group) => group.id)),
        eq(labGroupMembers.status, "active"),
      ));
    return groups.map((group) => ({
      ...group,
      memberUserIds: members
        .filter((member) => member.groupId === group.id)
        .map((member) => member.userId)
        .sort(),
    }));
  }

  async createGroup(input: {
    labId: string;
    name: string;
    description: string;
    actorUserId: string;
  }) {
    const now = new Date().toISOString();
    const [group] = await this.database.db.insert(labGroups).values({
      id: makeId("group"),
      labId: input.labId,
      name: input.name,
      description: input.description,
      status: "active",
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    }).returning();
    return group;
  }

  async updateGroup(groupId: string, labId: string, changes: {
    name?: string;
    description?: string;
    status?: "active" | "inactive";
    actorUserId: string;
  }) {
    const [group] = await this.database.db
      .update(labGroups)
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        updatedAt: new Date().toISOString(),
        updatedBy: changes.actorUserId,
      })
      .where(and(eq(labGroups.id, groupId), eq(labGroups.labId, labId)))
      .returning();
    return group;
  }

  async disableGroup(groupId: string, labId: string, actorUserId: string) {
    const now = new Date().toISOString();
    return this.database.db.transaction(async (tx) => {
      const [group] = await tx
        .update(labGroups)
        .set({ status: "inactive", updatedAt: now, updatedBy: actorUserId })
        .where(and(eq(labGroups.id, groupId), eq(labGroups.labId, labId)))
        .returning();
      if (!group) return null;
      await tx.update(labGroupMembers).set({ status: "inactive", updatedAt: now, updatedBy: actorUserId })
        .where(eq(labGroupMembers.groupId, groupId));
      await tx.update(projectAccessGrants).set({ status: "inactive", updatedAt: now, updatedBy: actorUserId })
        .where(eq(projectAccessGrants.groupId, groupId));
      await tx.update(experimentAccessGrants).set({ status: "inactive", updatedAt: now, updatedBy: actorUserId })
        .where(eq(experimentAccessGrants.groupId, groupId));
      return group;
    });
  }

  async upsertGroupMember(input: {
    groupId: string;
    labId: string;
    userId: string;
    actorUserId: string;
  }) {
    const now = new Date().toISOString();
    return this.database.db.transaction(async (tx) => {
      const group = await tx.select({ id: labGroups.id }).from(labGroups).where(and(
        eq(labGroups.id, input.groupId),
        eq(labGroups.labId, input.labId),
        eq(labGroups.status, "active"),
      )).limit(1);
      const membership = await tx.select({ id: labMemberships.id }).from(labMemberships).where(and(
        eq(labMemberships.labId, input.labId),
        eq(labMemberships.userId, input.userId),
        eq(labMemberships.status, "active"),
      )).limit(1);
      if (!group[0] || !membership[0]) return null;
      await tx.insert(labGroupMembers).values({
        groupId: input.groupId,
        labId: input.labId,
        userId: input.userId,
        status: "active",
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorUserId,
        updatedBy: input.actorUserId,
      }).onConflictDoUpdate({
        target: [labGroupMembers.groupId, labGroupMembers.userId],
        set: { status: "active", updatedAt: now, updatedBy: input.actorUserId },
      });
      return true;
    });
  }

  async removeGroupMember(groupId: string, labId: string, userId: string, actorUserId: string) {
    const [member] = await this.database.db
      .update(labGroupMembers)
      .set({ status: "inactive", updatedAt: new Date().toISOString(), updatedBy: actorUserId })
      .where(and(
        eq(labGroupMembers.groupId, groupId),
        eq(labGroupMembers.labId, labId),
        eq(labGroupMembers.userId, userId),
      ))
      .returning();
    return member;
  }

  async createAccessGrant(input: {
    project: ProjectRow;
    subject: { type: "user" | "group"; id: string };
    scope: GrantScope;
    capabilities: Capability[];
    experimentIds: string[];
    actorUserId: string;
  }) {
    const now = new Date().toISOString();
    return this.database.db.transaction(async (tx) => {
      if (input.subject.type === "user") {
        const membership = await tx.select({ id: labMemberships.id }).from(labMemberships)
          .where(and(
            eq(labMemberships.labId, input.project.labId),
            eq(labMemberships.userId, input.subject.id),
            eq(labMemberships.status, "active"),
          )).limit(1);
        if (!membership[0]) return { invalidSubject: true as const };
      } else {
        const group = await tx.select({ id: labGroups.id }).from(labGroups)
          .where(and(
            eq(labGroups.labId, input.project.labId),
            eq(labGroups.id, input.subject.id),
            eq(labGroups.status, "active"),
          )).limit(1);
        if (!group[0]) return { invalidSubject: true as const };
      }
      if (input.experimentIds.length) {
        const experiments = await tx.select({ id: experimentIdentities.id })
          .from(experimentIdentities)
          .where(and(
            eq(experimentIdentities.projectId, input.project.id),
            inArray(experimentIdentities.id, input.experimentIds),
          ));
        if (experiments.length !== input.experimentIds.length) {
          return { invalidExperiments: true as const };
        }
      }
      const subjectColumns = input.subject.type === "user"
        ? { userId: input.subject.id, groupId: null }
        : { userId: null, groupId: input.subject.id };
      const [projectGrant] = await tx.insert(projectAccessGrants).values({
        id: makeId("project_grant"),
        labId: input.project.labId,
        projectId: input.project.id,
        ...subjectColumns,
        scope: input.scope,
        capabilities: input.capabilities,
        status: "active",
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorUserId,
        updatedBy: input.actorUserId,
      }).returning();
      const experimentGrants = [];
      for (const experimentId of input.experimentIds) {
        const [grant] = await tx.insert(experimentAccessGrants).values({
          id: makeId("experiment_grant"),
          labId: input.project.labId,
          projectId: input.project.id,
          experimentId,
          ...subjectColumns,
          capabilities: input.capabilities,
          status: "active",
          createdAt: now,
          updatedAt: now,
          createdBy: input.actorUserId,
          updatedBy: input.actorUserId,
        }).returning();
        if (grant) experimentGrants.push(grant);
      }
      return { projectGrant, experimentGrants };
    });
  }

  async listAccessGrants(projectId: string) {
    const [projectRows, experimentRows] = await Promise.all([
      this.database.db.select().from(projectAccessGrants).where(and(
        eq(projectAccessGrants.projectId, projectId),
        eq(projectAccessGrants.status, "active"),
      )).orderBy(asc(projectAccessGrants.createdAt), asc(projectAccessGrants.id)),
      this.database.db.select().from(experimentAccessGrants).where(and(
        eq(experimentAccessGrants.projectId, projectId),
        eq(experimentAccessGrants.status, "active"),
      )),
    ]);
    return projectRows.map((grant) => ({
      ...grant,
      experimentIds: experimentRows
        .filter((experimentGrant) => (
          experimentGrant.userId === grant.userId
          && experimentGrant.groupId === grant.groupId
        ))
        .map((experimentGrant) => experimentGrant.experimentId)
        .sort(),
    }));
  }

  async disableAccessGrant(projectId: string, grantId: string, actorUserId: string) {
    const now = new Date().toISOString();
    return this.database.db.transaction(async (tx) => {
      const [grant] = await tx.select().from(projectAccessGrants).where(and(
        eq(projectAccessGrants.id, grantId),
        eq(projectAccessGrants.projectId, projectId),
        eq(projectAccessGrants.status, "active"),
      )).limit(1);
      if (!grant) return null;
      await tx.update(projectAccessGrants)
        .set({ status: "inactive", updatedAt: now, updatedBy: actorUserId })
        .where(eq(projectAccessGrants.id, grant.id));
      const subject = grant.userId
        ? eq(experimentAccessGrants.userId, grant.userId)
        : eq(experimentAccessGrants.groupId, grant.groupId as string);
      await tx.update(experimentAccessGrants)
        .set({ status: "inactive", updatedAt: now, updatedBy: actorUserId })
        .where(and(eq(experimentAccessGrants.projectId, projectId), subject));
      return grant;
    });
  }
}
