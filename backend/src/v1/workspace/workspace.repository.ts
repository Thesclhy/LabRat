import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  labMemberships,
  projectAccessGrants,
  projects,
} from "../platform/database/schema.js";

@Injectable()
export class WorkspaceRepository {
  constructor(private readonly database: DatabaseService) {}

  async listProjectsByIds(projectIds: string[]) {
    if (!projectIds.length) return [];
    return this.database.db
      .select()
      .from(projects)
      .where(and(inArray(projects.id, projectIds), eq(projects.status, "active")))
      .orderBy(asc(projects.name), asc(projects.id));
  }

  async createProject(input: {
    labId: string;
    name: string;
    description: string;
    metadata: Record<string, unknown>;
    actorUserId: string;
  }) {
    const now = new Date().toISOString();
    return this.database.db.transaction(async (tx) => {
      const project = {
        id: makeId("project"),
        labId: input.labId,
        name: input.name,
        description: input.description,
        status: "active",
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorUserId,
        updatedBy: input.actorUserId,
      };
      await tx.insert(projects).values(project);
      const legacyMembers = await tx
        .select()
        .from(labMemberships)
        .where(and(
          eq(labMemberships.labId, input.labId),
          eq(labMemberships.status, "active"),
          inArray(labMemberships.role, ["viewer", "editor"]),
        ));
      for (const membership of legacyMembers) {
        await tx.insert(projectAccessGrants).values({
          id: `legacy_project_grant_${membership.id}_${project.id}`,
          labId: input.labId,
          projectId: project.id,
          userId: membership.userId,
          groupId: null,
          scope: "all_experiments",
          capabilities: membership.role === "editor"
            ? ["read", "propose", "approve", "export"]
            : ["read", "export"],
          status: "active",
          createdAt: now,
          updatedAt: now,
          createdBy: input.actorUserId,
          updatedBy: input.actorUserId,
        }).onConflictDoNothing();
      }
      return project;
    });
  }

  async updateProject(projectId: string, changes: {
    name?: string;
    description?: string;
    status?: "active" | "archived";
    metadata?: Record<string, unknown>;
    actorUserId: string;
  }) {
    const [project] = await this.database.db
      .update(projects)
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.metadata !== undefined ? { metadata: changes.metadata } : {}),
        updatedAt: new Date().toISOString(),
        updatedBy: changes.actorUserId,
      })
      .where(eq(projects.id, projectId))
      .returning();
    return project;
  }
}
