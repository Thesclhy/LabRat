import { Inject, Injectable } from "@nestjs/common";
import { parseCookies } from "../../saas/cookies.js";
import { makeSessionToken, sha256Hex } from "../../saas/ids.js";
import { hashPassword, verifyPassword } from "../../saas/passwords.js";
import { V1_CONFIG, type V1Config } from "../platform/config/v1-config.js";
import { ApiError } from "../platform/http/api-error.js";
import type {
  AuthContext,
  AuthResponse,
  PublicUser,
} from "./identity.types.js";
import { normalizeLabRole } from "./identity.types.js";
import { IdentityRepository } from "./identity.repository.js";

function publicUser(user: {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  isSuperAdmin: boolean;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isActive: user.isActive,
    isSuperAdmin: user.isSuperAdmin,
  };
}

function uniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

@Injectable()
export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    @Inject(V1_CONFIG) private readonly config: V1Config,
  ) {}

  async login(input: {
    username: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ token: string; expiresAt: Date; auth: AuthResponse }> {
    const user = await this.repository.findUserByUsername(input.username.trim());
    if (!user || !user.isActive || !verifyPassword(input.password, user.passwordHash)) {
      throw new ApiError(401, "invalid_credentials", "Username or password is incorrect.");
    }
    const token = makeSessionToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMs);
    await this.repository.createSession({
      userId: user.id,
      tokenHash: sha256Hex(token),
      expiresAt: expiresAt.toISOString(),
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });
    await this.repository.recordAudit({
      actorUserId: user.id,
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
      summary: "User logged in.",
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });
    return {
      token,
      expiresAt,
      auth: await this.authResponseFor(user),
    };
  }

  async authenticateCookieHeader(cookieHeader: string | undefined): Promise<AuthContext | null> {
    const cookies = parseCookies({ headers: { cookie: cookieHeader || "" } });
    const token = cookies.get(this.config.sessionCookieName);
    if (!token) return null;
    const active = await this.repository.findActiveSession(sha256Hex(token));
    if (!active) return null;
    const memberships = await this.repository.listMembershipsForUser(active.user.id);
    return {
      sessionId: active.sessionId,
      user: publicUser(active.user),
      memberships: memberships.map(({ membership, lab }) => ({
        labId: lab.id,
        labName: lab.name,
        labSlug: lab.slug,
        role: normalizeLabRole(membership.role),
        status: "active" as const,
      })),
    };
  }

  async logout(auth: AuthContext, metadata: { ipAddress?: string; userAgent?: string }): Promise<void> {
    await this.repository.revokeSession(auth.sessionId);
    await this.repository.recordAudit({
      actorUserId: auth.user.id,
      action: "auth.logout",
      targetType: "user",
      targetId: auth.user.id,
      summary: "User logged out.",
      ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress } : {}),
      ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
    });
  }

  toAuthResponse(auth: AuthContext): AuthResponse {
    return {
      user: auth.user,
      memberships: auth.memberships.map(({ labId, role, status }) => ({ labId, role, status })),
    };
  }

  async listLabsFor(auth: AuthContext) {
    return auth.memberships.map((membership) => ({
      id: membership.labId,
      name: membership.labName,
      slug: membership.labSlug,
      status: "active" as const,
      role: membership.role,
    }));
  }

  async listAdminLabs() {
    return this.repository.listLabs();
  }

  async createLab(input: {
    name: string;
    slug: string;
    ownerUserId: string;
    actorUserId: string;
  }) {
    try {
      const lab = await this.repository.createLab({
        name: input.name.trim(),
        slug: input.slug.trim(),
        ownerUserId: input.ownerUserId,
        createdBy: input.actorUserId,
      });
      if (!lab) throw new ApiError(404, "owner_not_found", "Lab owner was not found.");
      await this.repository.recordAudit({
        labId: lab.id,
        actorUserId: input.actorUserId,
        action: "admin.lab.create",
        targetType: "lab",
        targetId: lab.id,
        summary: `Created lab ${lab.name}.`,
        metadata: { ownerUserId: input.ownerUserId },
      });
      return lab;
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new ApiError(409, "lab_conflict", "A Lab with this slug already exists.");
      }
      throw error;
    }
  }

  async listAdminUsers() {
    const rows = await this.repository.listUsers();
    return rows.map((user) => publicUser(user));
  }

  async createUser(input: {
    username: string;
    displayName: string;
    password: string;
    isSuperAdmin: boolean;
    actorUserId: string;
  }) {
    try {
      const user = await this.repository.createUser({
        username: input.username.trim(),
        displayName: input.displayName.trim(),
        passwordHash: hashPassword(input.password),
        isSuperAdmin: input.isSuperAdmin,
        createdBy: input.actorUserId,
      });
      await this.repository.recordAudit({
        actorUserId: input.actorUserId,
        action: "admin.user.create",
        targetType: "user",
        targetId: user.id,
        summary: `Created user ${user.username}.`,
      });
      return publicUser(user);
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new ApiError(409, "user_conflict", "A user with this username already exists.");
      }
      throw error;
    }
  }

  async updateUser(userId: string, input: {
    displayName?: string;
    isActive?: boolean;
    isSuperAdmin?: boolean;
    actorUserId: string;
  }) {
    const user = await this.repository.updateUser(userId, {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.isSuperAdmin !== undefined ? { isSuperAdmin: input.isSuperAdmin } : {}),
      updatedBy: input.actorUserId,
    });
    if (!user) throw new ApiError(404, "user_not_found", "User not found.");
    await this.repository.recordAudit({
      actorUserId: input.actorUserId,
      action: "admin.user.update",
      targetType: "user",
      targetId: user.id,
      summary: `Updated user ${user.username}.`,
    });
    return publicUser(user);
  }

  async resetPassword(userId: string, password: string, actorUserId: string): Promise<void> {
    const user = await this.repository.resetPassword(userId, hashPassword(password));
    if (!user) throw new ApiError(404, "user_not_found", "User not found.");
    await this.repository.recordAudit({
      actorUserId,
      action: "admin.user.reset_password",
      targetType: "user",
      targetId: user.id,
      summary: `Reset password for ${user.username}.`,
    });
  }

  private async authResponseFor(user: {
    id: string;
    username: string;
    displayName: string;
    isActive: boolean;
    isSuperAdmin: boolean;
  }): Promise<AuthResponse> {
    const memberships = await this.repository.listMembershipsForUser(user.id);
    return {
      user: publicUser(user),
      memberships: memberships.map(({ membership, lab }) => ({
        labId: lab.id,
        role: normalizeLabRole(membership.role),
        status: "active" as const,
      })),
    };
  }
}
