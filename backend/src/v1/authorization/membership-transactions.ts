import { and, eq } from "drizzle-orm";
import type { V1Transaction } from "../platform/database/database.service.js";
import { experimentAccessGrants, labGroupMembers, projectAccessGrants } from "../platform/database/schema.js";

export async function clearLabMemberAccess(
  tx: V1Transaction, labId: string, userId: string, actorUserId: string,
) {
  const changes = { status: "inactive", updatedAt: new Date().toISOString(), updatedBy: actorUserId };
  await tx.update(projectAccessGrants).set(changes)
    .where(and(eq(projectAccessGrants.labId, labId), eq(projectAccessGrants.userId, userId), eq(projectAccessGrants.status, "active")));
  await tx.update(experimentAccessGrants).set(changes)
    .where(and(eq(experimentAccessGrants.labId, labId), eq(experimentAccessGrants.userId, userId), eq(experimentAccessGrants.status, "active")));
  await tx.update(labGroupMembers).set(changes)
    .where(and(eq(labGroupMembers.labId, labId), eq(labGroupMembers.userId, userId), eq(labGroupMembers.status, "active")));
}
