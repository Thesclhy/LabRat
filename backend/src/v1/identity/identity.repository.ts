import { Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  auditEvents,
  labMemberships,
  labs,
  sessions,
  users,
} from "../platform/database/schema.js";

type UserRow = typeof users.$inferSelect;

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  labId?: string;
  projectId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class IdentityRepository {
  constructor(private readonly database: DatabaseService) {}

  findUserByUsername(username: string): Promise<UserRow | undefined> {
    return this.database.db.query.users.findFirst({
      where: eq(users.username, username),
    });
  }

  findUserById(userId: string): Promise<UserRow | undefined> {
    return this.database.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<string> {
    const id = makeId("session");
    const now = new Date().toISOString();
    await this.database.db.insert(sessions).values({
      id,
      userId: input.userId,
      sessionTokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdAt: now,
      lastSeenAt: now,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
      revokedAt: null,
    });
    return id;
  }

  async findActiveSession(tokenHash: string): Promise<{
    sessionId: string;
    user: UserRow;
  } | null> {
    const now = new Date().toISOString();
    const rows = await this.database.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(
        eq(sessions.sessionTokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(users.isActive, true),
      ))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    await this.database.db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, row.session.id));
    return { sessionId: row.session.id, user: row.user };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId));
  }

  async listMembershipsForUser(userId: string) {
    return this.database.db
      .select({ membership: labMemberships, lab: labs })
      .from(labMemberships)
      .innerJoin(labs, eq(labs.id, labMemberships.labId))
      .where(and(
        eq(labMemberships.userId, userId),
        eq(labMemberships.status, "active"),
        eq(labs.status, "active"),
      ))
      .orderBy(asc(labs.name), asc(labs.id));
  }

  async listLabs() {
    return this.database.db
      .select()
      .from(labs)
      .where(eq(labs.status, "active"))
      .orderBy(asc(labs.name), asc(labs.id));
  }

  async createLab(input: {
    name: string;
    slug: string;
    ownerUserId: string;
    createdBy: string;
  }) {
    const now = new Date().toISOString();
    return this.database.db.transaction(async (tx) => {
      const [owner] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, input.ownerUserId), eq(users.isActive, true)))
        .limit(1);
      if (!owner) return null;
      const lab = {
        id: makeId("lab"),
        name: input.name,
        slug: input.slug,
        status: "active",
        settings: {},
        createdAt: now,
        updatedAt: now,
        createdBy: input.createdBy,
      };
      await tx.insert(labs).values(lab);
      await tx.insert(labMemberships).values({
        id: makeId("membership"),
        labId: lab.id,
        userId: owner.id,
        role: "lab_owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
        createdBy: input.createdBy,
      });
      return lab;
    });
  }

  async listUsers() {
    const userRows = await this.database.db
      .select()
      .from(users)
      .orderBy(asc(users.username), asc(users.id));
    if (!userRows.length) return [];
    const memberships = await this.database.db
      .select()
      .from(labMemberships)
      .where(inArray(labMemberships.userId, userRows.map((user) => user.id)));
    return userRows.map((user) => ({
      ...user,
      memberships: memberships.filter((membership) => membership.userId === user.id),
    }));
  }

  async createUser(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    isSuperAdmin: boolean;
    createdBy: string;
  }) {
    const now = new Date().toISOString();
    const row = {
      id: makeId("user"),
      username: input.username,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      isActive: true,
      isSuperAdmin: input.isSuperAdmin,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    };
    await this.database.db.insert(users).values(row);
    return row;
  }

  async updateUser(userId: string, changes: {
    displayName?: string;
    isActive?: boolean;
    isSuperAdmin?: boolean;
    updatedBy: string;
  }) {
    const [row] = await this.database.db
      .update(users)
      .set({
        ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
        ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
        ...(changes.isSuperAdmin !== undefined ? { isSuperAdmin: changes.isSuperAdmin } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId))
      .returning();
    return row;
  }

  async resetPassword(userId: string, passwordHash: string) {
    const now = new Date().toISOString();
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, userId))
        .returning();
      if (!row) return null;
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      return row;
    });
  }

  async recordAudit(input: AuditInput): Promise<void> {
    await this.database.db.insert(auditEvents).values({
      id: makeId("audit"),
      labId: input.labId || null,
      projectId: input.projectId || null,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType || null,
      targetId: input.targetId || null,
      summary: input.summary || null,
      metadata: input.metadata || {},
      createdAt: new Date().toISOString(),
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });
  }
}
