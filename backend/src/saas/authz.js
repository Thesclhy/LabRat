import { parseCookies } from "./cookies.js";
import { sha256Hex } from "./ids.js";

const ROLE_RANK = {
  viewer: 1,
  editor: 2,
  lab_admin: 3,
  lab_owner: 4,
};

export function roleAtLeast(role, minimumRole) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minimumRole] || 0);
}

export async function getAuthContext(req, { store, config }) {
  const token = parseCookies(req).get(config.sessionCookieName);
  if (!token) return null;
  const session = await store.findSessionByTokenHash(sha256Hex(token));
  if (!session) return null;
  const now = Date.now();
  if (session.revokedAt || new Date(session.expiresAt).getTime() <= now) return null;
  const user = await store.findUserById(session.userId);
  if (!user || !user.isActive) return null;
  const labs = await store.listLabsForUser(user.id);
  return {
    session,
    user: publicUser(user),
    labs,
    isSuperAdmin: Boolean(user.isSuperAdmin),
  };
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isSuperAdmin: Boolean(user.isSuperAdmin),
  };
}

export function requireAuth(auth) {
  if (!auth) {
    throw Object.assign(new Error("Authentication is required."), {
      statusCode: 401,
      code: "unauthorized",
    });
  }
  return auth;
}

export function requireSuperAdmin(auth) {
  requireAuth(auth);
  if (!auth.isSuperAdmin) {
    throw Object.assign(new Error("Super admin access is required."), {
      statusCode: 403,
      code: "forbidden",
    });
  }
}

export function requireLabRole(auth, labId, minimumRole = "viewer") {
  requireAuth(auth);
  if (auth.isSuperAdmin) return { labId, role: "super_admin" };
  const membership = auth.labs.find((lab) => lab.labId === labId);
  if (!membership || !roleAtLeast(membership.role, minimumRole)) {
    throw Object.assign(new Error("You do not have access to this lab."), {
      statusCode: 403,
      code: "forbidden",
    });
  }
  return membership;
}

