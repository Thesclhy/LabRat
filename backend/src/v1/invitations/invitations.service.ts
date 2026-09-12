import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { makeId, makeSessionToken, sha256Hex } from "../../saas/ids.js";
import { hashPassword } from "../../saas/passwords.js";
import { clearLabMemberAccess } from "../authorization/membership-transactions.js";
import { IdentityService } from "../identity/identity.service.js";
import type { AuthContext } from "../identity/identity.types.js";
import { V1_CONFIG, type V1Config } from "../platform/config/v1-config.js";
import { DatabaseService, type V1Transaction } from "../platform/database/database.service.js";
import { auditEvents, invitations, labMemberships, labs, sessions, users } from "../platform/database/schema.js";
import { ApiError } from "../platform/http/api-error.js";
import { PageQueryDto, pageOffset, pageResult } from "../platform/http/page-query.js";
import type { RedeemInvitationDto, RegisterInvitationDto } from "./invitations.dto.js";

type Invitation = typeof invitations.$inferSelect;
type Scope = { labId?: string };
const isManager = (role: string) => role === "lab_owner" || role === "lab_admin";
const publicLab = (lab: typeof labs.$inferSelect, role: string) => ({
  id: lab.id, name: lab.name, slug: lab.slug, status: lab.status, role,
});
export function invitationStatus(row: Invitation) {
  return row.redeemedAt ? "used" : row.revokedAt ? "revoked"
    : new Date(row.expiresAt).getTime() <= Date.now() ? "expired" : "pending";
}
function publicInvitation(row: Invitation) {
  return {
    id: row.id, kind: row.kind, labId: row.labId, createdBy: row.createdBy,
    createdAt: row.createdAt, expiresAt: row.expiresAt, status: invitationStatus(row),
    revokedAt: row.revokedAt, redeemedAt: row.redeemedAt, redeemedBy: row.redeemedBy,
    redeemedLabId: row.redeemedLabId,
  };
}
function hasPgCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; cause?: unknown };
  return candidate.code === code || Boolean(candidate.cause && hasPgCode(candidate.cause, code));
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly identity: IdentityService,
    @Inject(V1_CONFIG) private readonly config: V1Config,
  ) {}

  // Serialize lab membership changes on the lab row; issuer permissions are checked again in the transaction.
  private async issuer(tx: V1Transaction, userId: string, scope: Scope) {
    let lab: typeof labs.$inferSelect | undefined;
    if (scope.labId) {
      [lab] = await tx.select().from(labs).where(eq(labs.id, scope.labId)).for("update");
      if (!lab || lab.status !== "active") throw new ApiError(403, "invitation_unavailable", "Lab is unavailable.");
    }
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("share");
    if (!user?.isActive) throw new ApiError(403, "invitation_unavailable", "Invitation issuer is unavailable.");
    if (!scope.labId) {
      if (!user.isSuperAdmin) throw new ApiError(403, "forbidden", "Platform administrator access is required.");
    } else {
      const [membership] = await tx.select().from(labMemberships).where(and(
        eq(labMemberships.labId, scope.labId), eq(labMemberships.userId, userId),
      )).for("share");
      if (membership?.status !== "active" || !isManager(membership.role)) {
        throw new ApiError(403, "invitation_unavailable", "Lab administrator access is required.");
      }
    }
    return lab;
  }

  private audit(tx: V1Transaction, actorUserId: string, action: string, row: Invitation, labId?: string) {
    return tx.insert(auditEvents).values({
      id: makeId("audit"), actorUserId, action, targetType: "invitation", targetId: row.id,
      labId: labId || row.labId, createdAt: new Date().toISOString(),
      metadata: { kind: row.kind }, summary: action,
    });
  }

  async create(auth: AuthContext, scope: Scope) {
    const invitationCode = randomBytes(32).toString("base64url");
    const now = new Date();
    const invitation = await this.database.db.transaction(async (tx) => {
      await this.issuer(tx, auth.user.id, scope);
      const [row] = await tx.insert(invitations).values({
        id: makeId("invitation"), codeHash: sha256Hex(invitationCode),
        kind: scope.labId ? "lab_member" : "lab_owner", labId: scope.labId || null,
        createdBy: auth.user.id, createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
      }).returning();
      await this.audit(tx, auth.user.id, "invitation.create", row!);
      return publicInvitation(row!);
    });
    return { invitation, invitationCode };
  }

  async list(auth: AuthContext, scope: Scope, query: PageQueryDto) {
    const offset = pageOffset(query.cursor);
    return this.database.db.transaction(async (tx) => {
      await this.issuer(tx, auth.user.id, scope);
      const rows = await tx.select().from(invitations).where(and(
        eq(invitations.kind, scope.labId ? "lab_member" : "lab_owner"),
        scope.labId ? eq(invitations.labId, scope.labId) : undefined,
      )).orderBy(desc(invitations.createdAt), desc(invitations.id)).offset(offset).limit(query.limit + 1);
      return pageResult(rows.map(publicInvitation), offset, query.limit);
    });
  }

  async revoke(auth: AuthContext, scope: Scope, invitationId: string) {
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx.select().from(invitations).where(and(
        eq(invitations.id, invitationId),
        eq(invitations.kind, scope.labId ? "lab_member" : "lab_owner"),
        scope.labId ? eq(invitations.labId, scope.labId) : undefined,
      )).for("update");
      if (!row) throw new ApiError(404, "invitation_not_found", "Invitation not found.");
      await this.issuer(tx, auth.user.id, scope);
      if (row.redeemedAt) throw new ApiError(409, "invitation_used", "Remove the member instead of revoking a used invitation.");
      if (!row.revokedAt) {
        const [updated] = await tx.update(invitations).set({
          revokedAt: new Date().toISOString(), revokedBy: auth.user.id,
        }).where(eq(invitations.id, row.id)).returning();
        await this.audit(tx, auth.user.id, "invitation.revoke", row);
        return { invitation: publicInvitation(updated!) };
      }
      return { invitation: publicInvitation(row) };
    });
  }

  private async validInvitation(tx: V1Transaction, code: string) {
    const [row] = await tx.select().from(invitations).where(eq(invitations.codeHash, sha256Hex(code))).for("update");
    if (!row) throw new ApiError(400, "invalid_invitation", "Invitation code is invalid.");
    const status = invitationStatus(row);
    if (status !== "pending") throw new ApiError(410, `invitation_${status}`, `Invitation is ${status}.`);
    const lab = await this.issuer(tx, row.createdBy, row.labId ? { labId: row.labId } : {});
    return { row, lab };
  }

  async preview(code: string) {
    return this.database.db.transaction(async (tx) => {
      const { row, lab } = await this.validInvitation(tx, code);
      return { kind: row.kind, expiresAt: row.expiresAt, lab: lab ? { id: lab.id, name: lab.name } : null };
    });
  }

  async register(body: RegisterInvitationDto, metadata: { ipAddress: string; userAgent: string }) {
    if (!body.username.trim() || !body.displayName.trim()) throw new ApiError(400, "invalid_request", "Username and display name are required.");
    await this.preview(body.invitationCode);
    const passwordHash = hashPassword(body.password);
    const token = makeSessionToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMs);
    try {
      const result = await this.consume(body, {
        registration: { username: body.username.trim(), displayName: body.displayName.trim(), passwordHash },
        session: { tokenHash: sha256Hex(token), expiresAt: expiresAt.toISOString(), ...metadata },
      });
      return { ...result, token, expiresAt };
    } catch (error) {
      if (hasPgCode(error, "23505")) throw new ApiError(409, "user_conflict", "Username is already in use. The invitation has not been consumed.");
      throw error;
    }
  }

  redeem(auth: AuthContext, body: RedeemInvitationDto) {
    return this.consume(body, { userId: auth.user.id, sessionId: auth.sessionId });
  }

  private async consume(body: RedeemInvitationDto, input: {
    userId?: string; sessionId?: string;
    registration?: { username: string; displayName: string; passwordHash: string };
    session?: { tokenHash: string; expiresAt: string; ipAddress: string; userAgent: string };
  }) {
    const result = await this.database.db.transaction(async (tx) => {
      const { row, lab: targetLab } = await this.validInvitation(tx, body.invitationCode);
      const now = new Date().toISOString();
      if (row.kind === "lab_owner" ? !body.labName?.trim() : body.labName !== undefined) {
        throw new ApiError(400, "invalid_lab_name", row.kind === "lab_owner"
          ? "A lab name is required." : "A member invitation cannot select a lab.");
      }
      let user: typeof users.$inferSelect | undefined;
      if (input.registration) {
        [user] = await tx.insert(users).values({
          id: makeId("user"), ...input.registration, isActive: true, isSuperAdmin: false,
          createdAt: now, updatedAt: now, createdBy: row.createdBy, lastLoginAt: now,
        }).returning();
      } else {
        [user] = await tx.select().from(users).where(eq(users.id, input.userId!)).for("share");
        const [session] = await tx.select().from(sessions).where(eq(sessions.id, input.sessionId!)).for("share");
        if (!user?.isActive || !session || session.userId !== user.id || session.revokedAt
          || new Date(session.expiresAt).getTime() <= Date.now()) {
          throw new ApiError(401, "unauthorized", "Please sign in again.");
        }
      }
      let lab = targetLab;
      if (row.kind === "lab_owner") {
        const id = makeId("lab");
        [lab] = await tx.insert(labs).values({
          id, name: body.labName!.trim(), slug: id, status: "active", settings: {},
          createdAt: now, updatedAt: now, createdBy: user!.id,
        }).returning();
      }
      const [existing] = await tx.select().from(labMemberships).where(and(
        eq(labMemberships.labId, lab!.id), eq(labMemberships.userId, user!.id),
      )).for("update");
      if (existing?.status === "active") throw new ApiError(409, "already_member", "You already belong to this lab. The invitation has not been consumed.");
      if (existing) {
        await clearLabMemberAccess(tx, lab!.id, user!.id, row.createdBy);
        await tx.update(labMemberships).set({ role: row.kind, status: "active", updatedAt: now })
          .where(eq(labMemberships.id, existing.id));
      } else {
        await tx.insert(labMemberships).values({
          id: makeId("membership"), labId: lab!.id, userId: user!.id, role: row.kind,
          status: "active", createdAt: now, updatedAt: now, createdBy: row.createdBy,
        });
      }
      if (input.session) await tx.insert(sessions).values({
        id: makeId("session"), userId: user!.id, sessionTokenHash: input.session.tokenHash,
        expiresAt: input.session.expiresAt, ipAddress: input.session.ipAddress,
        userAgent: input.session.userAgent.slice(0, 1000), createdAt: now, lastSeenAt: now,
      });
      await tx.update(invitations).set({ redeemedAt: now, redeemedBy: user!.id, redeemedLabId: lab!.id })
        .where(eq(invitations.id, row.id));
      await this.audit(tx, user!.id, input.registration ? "invitation.register" : "invitation.redeem", row, lab!.id);
      return { user: user!, lab: publicLab(lab!, row.kind) };
    });
    return { auth: await this.identity.authResponseFor(result.user), lab: result.lab };
  }
}
