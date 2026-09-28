import { Injectable } from "@nestjs/common";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { makeId } from "../../saas/ids.js";
import { evidenceHash, QA_LIMITS } from "../../research/evidenceTools.js";
import { DatabaseService, type V1Transaction } from "../platform/database/database.service.js";
import { researchQaRequests as requests, answerArtifacts as answers, agentRuns, sessions } from "../platform/database/schema.js";
import { authorizeProjectTransaction } from "../authorization/authorized-store.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";

const now = () => new Date().toISOString();
export type ResearchRequest = typeof requests.$inferSelect;
const scope = (auth: AuthContext, projectId: string, id?: string) => and(eq(requests.projectId, projectId),
  eq(requests.actorUserId, auth.user.id), id ? eq(requests.runId, id) : undefined);

@Injectable()
export class ResearchQuestionsRepository {
  constructor(private readonly database: DatabaseService) {}

  private async authorize(tx: V1Transaction, auth: AuthContext, project: { id: string; labId: string }) {
    const database = { db: tx } as unknown as DatabaseService;
    await authorizeProjectTransaction(database, auth, project, "read");
    const [session] = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, auth.sessionId),
      eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now()))).for("share");
    if (!session) throw new ApiError(401, "unauthorized", "The session is no longer active.");
    if (auth.publicGuest || await new IdentityRepository(database).findPublicGuestScope(auth.user.id)) throw new ApiError(403, "public_guest_read_only", "Public Guest cannot use AI.");
  }

  async create(auth: AuthContext, project: { id: string; labId: string }, requestKey: string, question: string, context: Record<string, any> = {}) {
    const requestHash = evidenceHash({ question, scope: "full_project", ...(Object.keys(context).length ? { context } : {}) });
    return this.database.db.transaction(async (tx) => {
      await this.authorize(tx, auth, project);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${JSON.stringify(["research-qa", project.id, auth.user.id])}))`);
      const [existing] = await tx.select().from(requests).where(and(scope(auth, project.id), eq(requests.requestKey, requestKey))).limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ApiError(409, "qa_request_conflict", "This request key belongs to a different question.");
        return { request: existing, reused: true };
      }
      const [running] = await tx.select({ id: requests.runId }).from(requests).where(and(scope(auth, project.id),
        eq(requests.status, "running"), gt(requests.leaseExpiresAt, now()))).limit(1);
      if (running) throw new ApiError(429, "qa_actor_busy", "A question is already running for this project. Wait or cancel it first.");
      const timestamp = now(), runId = makeId("agent_run");
      await tx.insert(agentRuns).values({ id: runId, labId: project.labId, projectId: project.id, status: "running", mode: "research_qa",
        userMessage: question, selectedContext: { ...context, scope: "full_project", readOnly: true }, createdAt: timestamp, updatedAt: timestamp, createdBy: auth.user.id });
      const [request] = await tx.insert(requests).values({ runId, labId: project.labId, projectId: project.id, actorUserId: auth.user.id,
        requestKey, requestHash, question, createdAt: timestamp, updatedAt: timestamp }).returning();
      return { request: request!, reused: false };
    });
  }

  async get(auth: AuthContext, projectId: string, id: string) {
    const [request] = await this.database.db.select().from(requests).where(scope(auth, projectId, id)).limit(1);
    return request || null;
  }

  async byRequestKey(auth: AuthContext, projectId: string, key: string) {
    const [request] = await this.database.db.select().from(requests).where(and(scope(auth, projectId), eq(requests.requestKey, key))).limit(1);
    return request || null;
  }

  async context(auth: AuthContext, projectId: string, id: string): Promise<Record<string, any>> {
    const [row] = await this.database.db.select({ context: agentRuns.selectedContext }).from(requests)
      .innerJoin(agentRuns, and(eq(agentRuns.id, requests.runId), eq(agentRuns.projectId, projectId)))
      .where(scope(auth, projectId, id)).limit(1);
    return row?.context || {};
  }

  async list(auth: AuthContext, projectId: string, cursor: string | undefined, limit: number) {
    const [date, id] = cursor?.split("|") || [];
    return this.database.db.select().from(requests).where(and(scope(auth, projectId),
      date && id ? sql`(${requests.createdAt},${requests.runId}) < (${date}::timestamptz,${id})` : undefined))
      .orderBy(desc(requests.createdAt), desc(requests.runId)).limit(limit + 1);
  }

  async answer(auth: AuthContext, projectId: string, runId: string) {
    const [row] = await this.database.db.select().from(answers).where(and(eq(answers.projectId, projectId), eq(answers.createdBy, auth.user.id), eq(answers.runId, runId))).limit(1);
    return row || null;
  }

  async claim(auth: AuthContext, request: ResearchRequest) {
    return this.database.db.transaction(async (tx) => {
      await this.authorize(tx, auth, { id: request.projectId, labId: request.labId });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${JSON.stringify(["research-qa", request.projectId, auth.user.id])}))`);
      const [current] = await tx.select().from(requests).where(scope(auth, request.projectId, request.runId)).for("update");
      if (!current) throw new ApiError(404, "qa_not_found", "Question not found.");
      if (["completed", "cancelled"].includes(current.status) || current.status === "running" && Date.parse(current.leaseExpiresAt!) > Date.now()) return null;
      if (current.attempt >= 3) throw new ApiError(409, "qa_retry_limit", "This question reached its attempt limit. Review its failure before sending a new question.");
      const [other] = await tx.select({ id: requests.runId }).from(requests).where(and(scope(auth, request.projectId),
        sql`${requests.runId} <> ${request.runId}`, eq(requests.status, "running"), gt(requests.leaseExpiresAt, now()))).limit(1);
      if (other) throw new ApiError(429, "qa_actor_busy", "Another question is already running.");
      const usage = { ...current.usage };
      const elapsed = Math.max(0, Number(usage.elapsedMs) || 0);
      // A crashed attempt may have continued since its last persisted checkpoint.
      // Reserve that unknown interval; manual retries cannot reset the deadline.
      usage.elapsedMs = current.status === "running"
        ? Math.min(QA_LIMITS.deadlineMs, elapsed + Math.max(0, Date.now() - (Number(usage.lastActiveAt) || Date.parse(current.updatedAt))))
        : elapsed;
      usage.lastActiveAt = Date.now();
      const [claimed] = await tx.update(requests).set({ status: "running", attempt: current.attempt + 1, failureCode: null,
        usage, leaseToken: makeId("qa_lease"), leaseExpiresAt: new Date(Date.now() + 150_000).toISOString(), updatedAt: now() })
        .where(eq(requests.runId, request.runId)).returning();
      await tx.update(agentRuns).set({ status: "running", error: null, updatedAt: now() }).where(eq(agentRuns.id, request.runId));
      return claimed!;
    });
  }

  async checkpoint(auth: AuthContext, request: ResearchRequest, usage: Record<string, any>) {
    return this.database.db.transaction(async (tx) => {
      await this.authorize(tx, auth, { id: request.projectId, labId: request.labId });
      const updated = await tx.update(requests).set({ usage, updatedAt: now() }).where(and(scope(auth, request.projectId, request.runId),
        eq(requests.status, "running"), eq(requests.leaseToken, request.leaseToken!), gt(requests.leaseExpiresAt, now()))).returning({ id: requests.runId });
      if (!updated.length) throw new ApiError(409, "qa_lease_lost", "This question attempt is no longer active.");
    });
  }

  async finish(auth: AuthContext, request: ResearchRequest, answer: Record<string, any>, evidence: Array<Record<string, any>>, trace: Array<Record<string, any>>, usage: Record<string, any>) {
    return this.database.db.transaction(async (tx) => {
      await this.authorize(tx, auth, { id: request.projectId, labId: request.labId });
      const [active] = await tx.select().from(requests).where(and(scope(auth, request.projectId, request.runId),
        eq(requests.status, "running"), eq(requests.leaseToken, request.leaseToken!), gt(requests.leaseExpiresAt, now()))).for("update");
      if (!active) throw new ApiError(409, "qa_lease_lost", "This question attempt is no longer active.");
      await tx.insert(answers).values({ id: makeId("answer"), runId: request.runId, projectId: request.projectId,
        createdBy: auth.user.id, answer, evidence, trace, usage });
      await tx.update(requests).set({ status: "completed", leaseToken: null, leaseExpiresAt: null, usage, updatedAt: now() }).where(eq(requests.runId, request.runId));
      await tx.update(agentRuns).set({ status: "completed", usage, toolTrace: trace, visibleSteps: [{ title: "Completed cited project question", status: answer.status }],
        updatedAt: now() }).where(eq(agentRuns.id, request.runId));
    });
  }

  async fail(request: ResearchRequest, code: string, usage: Record<string, any>) {
    await this.database.db.transaction(async (tx) => {
      const changed = await tx.update(requests).set({ status: "failed", failureCode: code, usage, leaseToken: null, leaseExpiresAt: null, updatedAt: now() })
        .where(and(eq(requests.runId, request.runId), eq(requests.status, "running"), eq(requests.leaseToken, request.leaseToken!))).returning({ id: requests.runId });
      if (changed.length) await tx.update(agentRuns).set({ status: "failed", error: { code }, usage, updatedAt: now() }).where(eq(agentRuns.id, request.runId));
    });
  }

  async cancel(auth: AuthContext, request: ResearchRequest) {
    await this.database.db.transaction(async (tx) => {
      await this.authorize(tx, auth, { id: request.projectId, labId: request.labId });
      const changed = await tx.update(requests).set({ status: "cancelled", leaseToken: null, leaseExpiresAt: null, updatedAt: now() })
        .where(and(scope(auth, request.projectId, request.runId), sql`${requests.status} in ('queued','running','failed')`)).returning({ id: requests.runId });
      if (changed.length) await tx.update(agentRuns).set({ status: "cancelled", updatedAt: now() }).where(eq(agentRuns.id, request.runId));
    });
  }
}
