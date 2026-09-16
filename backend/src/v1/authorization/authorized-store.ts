import { eq } from "drizzle-orm";
import type { DatabaseService } from "../platform/database/database.service.js";
import { labs, users } from "../platform/database/schema.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import { AuthorizationService } from "./authorization.service.js";
import type { Capability } from "./authorization.policy.js";

export async function authorizeProjectTransaction(database: DatabaseService, auth: AuthContext,
  project: { id: string; labId: string }, capability: Capability) {
  // Membership and preset changes lock the lab for update.
  const [lab] = await database.db.select().from(labs).where(eq(labs.id, project.labId)).for("share");
  const [actor] = await database.db.select().from(users).where(eq(users.id, auth.user.id)).for("share");
  if (lab?.status !== "active" || !actor?.isActive) throw new ApiError(404, "project_not_found", "Project not found.");
  const authorization = new AuthorizationService(new AuthorizationRepository(database), new IdentityRepository(database));
  return authorization.requireFullProjectCapability(auth, project.id, capability);
}

/** Keep asynchronous domain work scoped to the caller's current authority. */
export function withWriteAuthorization<T extends object>(repository: T, authorize: () => Promise<unknown>): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (!/^(create|update|append|claim|finalize|publish|accept|complete|release|retry|delete|ignore)/.test(String(property))) return value.bind(target);
      return async (...args: unknown[]) => {
        await authorize();
        return value.apply(target, args);
      };
    },
  });
}
