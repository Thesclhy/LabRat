import { and, eq, sql } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { hashPassword, verifyPassword } from "../../saas/passwords.js";
import type { DatabaseService } from "../platform/database/database.service.js";
import { auditEvents, labMemberships, labs, projectAccessGrants, projects, publicGuestAccounts, users } from "../platform/database/schema.js";
import { ApiError } from "../platform/http/api-error.js";

export async function provisionPublicGuest(database: DatabaseService, input: {
  username: string;
  password: string;
  adminUsername: string;
  labSlug?: string;
}) {
  const username = input.username.trim();
  const labSlug = input.labSlug || "labrat-public-demo";
  if (!/^[a-zA-Z0-9._-]{1,200}$/.test(username) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(labSlug)
    || labSlug.length > 200 || input.password.length < 12 || input.password.length > 1000) {
    throw new ApiError(400, "invalid_guest_input", "A valid username/slug and a 12-1000 character demo password are required.");
  }
  return database.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"labrat_public_guest:" + username}))`);
    const [admin] = await tx.select().from(users).where(and(
      eq(users.username, input.adminUsername.trim()), eq(users.isActive, true), eq(users.isSuperAdmin, true),
    )).limit(1).for("update");
    const adminGuest = admin && await tx.select().from(publicGuestAccounts)
      .where(eq(publicGuestAccounts.userId, admin.id)).limit(1);
    if (!admin || adminGuest?.length) {
      throw new ApiError(403, "guest_operator_required", "An active non-Guest platform administrator is required.");
    }
    if (verifyPassword(input.password, admin.passwordHash)) {
      throw new ApiError(400, "unsafe_guest_password", "Do not reuse the administrator password for a public demo.");
    }
    const [existing] = await tx.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing) {
      const [scope] = await tx.select({ project: projects, lab: labs }).from(publicGuestAccounts)
        .innerJoin(projects, eq(projects.id, publicGuestAccounts.projectId))
        .innerJoin(labs, eq(labs.id, projects.labId))
        .where(eq(publicGuestAccounts.userId, existing.id)).limit(1);
      if (!scope || scope.lab.slug !== labSlug || scope.project.metadata.publicDemo !== true
        || existing.createdBy !== admin.id || !verifyPassword(input.password, existing.passwordHash)) {
        throw new ApiError(409, "guest_conflict", "The username is already in use; no existing account was changed.");
      }
      return { created: false, userId: existing.id, username, labId: scope.lab.id,
        projectId: scope.project.id, isActive: existing.isActive };
    }
    if ((await tx.select({ id: labs.id }).from(labs).where(eq(labs.slug, labSlug)).limit(1)).length) {
      throw new ApiError(409, "guest_lab_conflict", "The demo lab slug is already in use; no existing lab was changed.");
    }
    const now = new Date().toISOString();
    const userId = makeId("user");
    const labId = makeId("lab");
    const projectId = makeId("project");
    await tx.insert(users).values({ id: userId, username, displayName: "Guest (public read-only demo)",
      passwordHash: hashPassword(input.password), isActive: true, isSuperAdmin: false,
      createdAt: now, updatedAt: now, createdBy: admin.id });
    await tx.insert(labs).values({ id: labId, name: "LabRat Public Demo", slug: labSlug,
      status: "active", settings: { publicDemo: true }, createdAt: now, updatedAt: now, createdBy: admin.id });
    await tx.insert(labMemberships).values([
      { id: makeId("membership"), labId, userId: admin.id, role: "lab_owner", status: "active",
        createdAt: now, updatedAt: now, createdBy: admin.id },
      { id: makeId("membership"), labId, userId, role: "lab_member", status: "active",
        createdAt: now, updatedAt: now, createdBy: admin.id },
    ]);
    await tx.insert(projects).values({ id: projectId, labId, name: "Guest Workspace",
      description: "Public read-only demo. No real laboratory data is included.", status: "active",
      metadata: { publicDemo: true, projectProfile: { schemaVersion: "labrat.projectProfile.v1",
        researchGoal: "Explore LabRat's read-only project interface.",
        experimentBackground: "This is a separate public demonstration workspace, not a real research lab.",
        analysisNotes: "This initial demo contains no workbooks or accepted scientific results. Upload, AI, editing and invitations are disabled for Guest.",
        tags: ["public-demo", "read-only"] } },
      createdAt: now, updatedAt: now, createdBy: admin.id, updatedBy: admin.id });
    await tx.insert(projectAccessGrants).values({ id: makeId("grant"), labId, projectId, userId,
      scope: "all_experiments", capabilities: ["read", "export"], status: "active",
      createdAt: now, updatedAt: now, createdBy: admin.id, updatedBy: admin.id });
    await tx.insert(publicGuestAccounts).values({ userId, projectId, createdAt: now, createdBy: admin.id });
    await tx.insert(auditEvents).values({ id: makeId("audit"), actorUserId: admin.id, labId, projectId,
      action: "admin.public_guest.create", targetType: "user", targetId: userId,
      summary: "Created a restricted public Guest and an empty dedicated demo workspace.",
      metadata: { capabilities: ["read", "export"], publicDemo: true }, createdAt: now });
    return { created: true, userId, username, labId, projectId, isActive: true };
  });
}
