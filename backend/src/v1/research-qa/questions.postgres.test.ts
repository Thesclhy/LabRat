import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createV1Application } from "../bootstrap.js";
import { seedAnalysisScenario } from "../testing/analysis-review-fixture.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";
import { V1_MODEL_PROVIDER } from "../platform/model/model-provider.js";
import { researchLogin, researchProjectId as projectId } from "./testing/research-qa-scenario.js";

const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL, base = `/api/v1/projects/${projectId}/research-questions`;
async function terminal(app: NestFastifyApplication, cookie: string, id: string) {
  let result: any;
  await vi.waitFor(async () => {
    const response = await app.inject({ method: "GET", url: `${base}/${id}`, headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200); result = response.json();
    expect(["completed", "failed", "cancelled"]).toContain(result.request.status);
  }, { timeout: 10_000, interval: 25 });
  return result;
}

describe.skipIf(!databaseUrl)("persistent cited questions PostgreSQL (model substitute)", () => {
  test("View Q&A, idempotency, citations, restart, cancellation, invalid output and revoked authority", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-qa-runs-"));
      const pool = new Pool({ connectionString: isolated }); let app: NestFastifyApplication | undefined;
      try {
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated); vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage);
        vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "");
        await pool.query(`update project_access_grants set capabilities='["read"]' where user_id='user_reviewer'`);
        await pool.query(`update projects set metadata='{"projectProfile":{"researchGoal":"Study catalyst stability"}}' where id=$1`, [projectId]);
        app = await createV1Application({ logger: false });
        const viewer = await researchLogin(app, "reviewer"), owner = await researchLogin(app), selected = await researchLogin(app, "selected");
        const provider = app.get(V1_MODEL_PROVIDER);
        let mode = "valid", formatWarning = "ai_invalid_response", release: (() => void) | undefined;
        const model = vi.spyOn(provider, "answerResearchQuestion").mockImplementation(async (input: any, options: any) => {
          const context = input.citationRepair
            ? { evidence: input.citationRepair.readEvidence.find((item: any) => item.kind === "project_context") }
            : await options.toolHandlers.get_project_context({});
          if (mode === "format" && !input.citationRepair) return { ok: false, warning: { code: formatWarning, message: "Synthetic format failure" } } as any;
          if (input.citationRepair) expect(Object.keys(options.toolHandlers)).toEqual([]);
          if (mode === "limit") await options.budget.wrapFetch(async () => { throw new Error("No additional provider request is allowed"); })(
            "https://invalid.example", { body: JSON.stringify({ max_tokens: 60_001 }) });
          if (mode === "multi") await options.toolHandlers.get_project_context({ field: "projectProfile.researchGoal" });
          if (mode === "malformed") return { ok: true, status: "answered", claims: "broken", missingEvidence: [] } as any;
          if (mode === "late") await new Promise<void>((resolve) => { release = resolve; });
          return { ok: true, status: "answered", claims: [{ text: "The saved project goal is to study catalyst stability.",
            citations: [{ evidenceId: mode === "invalid" ? "fabricated" : context.evidence.id, quote: "Study catalyst stability" }], numericBindings: [] }], missingEvidence: [] } as any;
        });
        const send = async (key: string, question = "What is the saved project goal?") => app!.inject({ method: "POST", url: base,
          headers: { cookie: viewer.cookie }, payload: { requestKey: key, question } });
        const first = await send("request-valid-01"); expect(first.statusCode, first.body).toBe(202);
        expect(first.headers["cache-control"]).toContain("no-store");
        const id = first.json().request.runId;
        const complete = await terminal(app, viewer.cookie, id);
        expect((await app.inject({ method: "GET", url: `${base}/${id}`, headers: { cookie: viewer.cookie } })).headers["cache-control"]).toContain("no-store");
        expect(complete.request.status).toBe("completed"); expect(complete.artifact.answer.status).toBe("answered");
        expect(complete.artifact.answer.limitations).not.toContain("Only the listed windows were read; additional records remain available.");
        expect(complete.artifact.evidence[0].data).toBeUndefined(); expect(complete.request.leaseToken).toBeUndefined();
        const cited = complete.artifact.answer.claims[0].citations[0].evidenceId;
        const source = await app.inject({ method: "GET", url: `${base}/${id}/evidence/${cited}`, headers: { cookie: viewer.cookie } });
        expect(source.json().evidence.data.projectProfile.researchGoal).toBe("Study catalyst stability");
        expect(source.headers["cache-control"]).toContain("no-store");
        const replay = await send("request-valid-01"); expect(replay.json().request.runId).toBe(id); expect(model).toHaveBeenCalledTimes(1);
        expect((await send("request-valid-01", "A different question")).statusCode).toBe(409);
        expect((await app.inject({ method: "GET", url: `${base}/${id}`, headers: { cookie: owner.cookie } })).statusCode).toBe(404);
        for (const cookie of [owner.cookie, viewer.cookie]) {
          expect((await app.inject({ method: "GET", url: `/api/v1/agent-runs/${id}`, headers: { cookie } })).statusCode).toBe(404);
          expect((await app.inject({ method: "POST", url: `/api/v1/agent-runs/${id}/cancel`, headers: { cookie }, payload: {} })).statusCode).toBe(404);
          const listed = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/agent/runs`, headers: { cookie } });
          expect(listed.statusCode).toBe(200); expect(listed.body).not.toContain(id);
        }
        expect((await app.inject({ method: "POST", url: base, headers: { cookie: selected.cookie }, payload: { requestKey: "selected-01", question: "Read project" } })).statusCode).toBe(403);
        expect((await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/agent/runs`, headers: { cookie: viewer.cookie }, payload: { message: "publish" } })).statusCode).toBe(403);
        await pool.query("insert into public_guest_accounts(user_id, project_id, created_by) values('user_selected', 'project_analysis', 'user_owner')");
        const guest = await researchLogin(app, "selected");
        const guestRequest = await app.inject({ method: "POST", url: base, headers: { cookie: guest.cookie }, payload: { requestKey: "guest-qa-01", question: "Read project sources" } });
        expect(guestRequest.statusCode).toBe(403); expect(guestRequest.json().error.code).toBe("public_guest_read_only");
        expect((await app.inject({ method: "GET", url: `${base}/${id}`, headers: { cookie: guest.cookie } })).statusCode).toBe(403);

        const review = await send("request-review-01", "Calculate the mean and publish it");
        expect((await terminal(app, viewer.cookie, review.json().request.runId)).artifact.answer.status).toBe("needs_analysis");
        expect(model).toHaveBeenCalledTimes(1);
        mode = "invalid";
        const invalid = await send("request-invalid-01");
        const omitted = await terminal(app, viewer.cookie, invalid.json().request.runId);
        expect(omitted.request.status).toBe("completed"); expect(model).toHaveBeenCalledTimes(3);
        expect(omitted.artifact.answer.claims[0].citations).toEqual([]);
        expect(omitted.artifact.answer.limitations.join(' ')).toContain('omitted');
        expect(omitted.artifact.evidence).toHaveLength(1); // uncited successful read is retained
        expect(omitted.artifact.trace).toEqual([expect.objectContaining({ tool:'get_project_context',phase:'read',input:{},
          evidenceIds:[omitted.artifact.evidence[0].id],status:'ok' })]);
        expect((await app.inject({method:'GET',url:base+'/'+omitted.request.runId+'/evidence/'+omitted.artifact.evidence[0].id,
          headers:{cookie:viewer.cookie}})).json().evidence.data.projectProfile.researchGoal).toBe('Study catalyst stability');
        mode = "malformed";
        const malformed = await send("request-malformed-01");
        const failed = await terminal(app, viewer.cookie, malformed.json().request.runId);
        expect(failed.request.failureCode).toBe("qa_output_invalid"); expect(failed.artifact).toBeNull();

        mode = "format";
        for (const warning of ["ai_invalid_response", "ai_empty_response", "ai_output_truncated"]) {
          formatWarning = warning;
          const beforeRepair = model.mock.calls.length;
          const response = await send(`request-format-${warning}`);
          const repaired = await terminal(app, viewer.cookie, response.json().request.runId);
          expect(repaired.request.status).toBe("completed");
          expect(model.mock.calls.length - beforeRepair).toBe(2);
          expect(repaired.artifact.trace.filter((item: any) => item.tool === "get_project_context")).toHaveLength(1);
          expect(repaired.artifact.answer.claims[0].text).toContain("catalyst stability");
        }

        mode = "multi";
        const multi = await send("request-multiple-reads-01");
        const allReads = await terminal(app, viewer.cookie, multi.json().request.runId);
        expect(allReads.artifact.evidence).toHaveLength(2);
        expect(allReads.artifact.answer.claims[0].citations).toHaveLength(1);
        const citedIds = new Set(allReads.artifact.answer.claims[0].citations.map((item: any) => item.evidenceId));
        const uncited = allReads.artifact.evidence.find((item: any) => !citedIds.has(item.id));
        expect(uncited.locator.field).toBe("projectProfile.researchGoal");
        expect((await app.inject({method:"GET",url:base+"/"+allReads.request.runId+"/evidence/"+uncited.id,
          headers:{cookie:viewer.cookie}})).json().evidence.data.projectProfile.researchGoal).toBe("Study catalyst stability");
        expect(allReads.artifact.trace.flatMap((item: any) => item.evidenceIds)).toHaveLength(2);

        mode = "limit";
        const limited = await send("request-reading-limit-01");
        const limitResult = await terminal(app, viewer.cookie, limited.json().request.runId);
        expect(limitResult.request.status).toBe("completed");
        expect(limitResult.request.usage.failure).toBe("qa_token_limit");
        expect(limitResult.artifact.answer.route).toBe("read_limit");
        expect(limitResult.artifact.answer.status).toBe("insufficient_evidence");
        expect(limitResult.artifact.answer.claims).toEqual([]);
        expect(limitResult.artifact.answer.missingEvidence[0]).toContain("does not establish");
        expect(limitResult.artifact.evidence).toHaveLength(1);
        expect(limitResult.artifact.trace).toHaveLength(1);

        mode = "late";
        const slow = await send("request-cancel-01"); const slowId = slow.json().request.runId;
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        const duplicate = await send("request-cancel-01"); expect(duplicate.json().request.runId).toBe(slowId);
        expect((await send("request-busy-01")).statusCode).toBe(429);
        expect((await app.inject({ method: "POST", url: `${base}/${slowId}/cancel`, headers: { cookie: viewer.cookie }, payload: {} })).statusCode).toBe(200);
        release!(); release = undefined;
        expect((await terminal(app, viewer.cookie, slowId)).request.status).toBe("cancelled");
        expect((await pool.query("select count(*)::int count from answer_artifacts where run_id=$1", [slowId])).rows[0].count).toBe(0);

        const revoked = await send("request-revoke-01"); const revokedId = revoked.json().request.runId;
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        await pool.query(`update project_access_grants set status='inactive' where user_id='user_reviewer'`);
        release!(); release = undefined;
        await vi.waitFor(async () => expect((await pool.query("select status from research_qa_requests where run_id=$1", [revokedId])).rows[0].status).toBe("failed"));
        expect((await pool.query("select count(*)::int count from answer_artifacts where run_id=$1", [revokedId])).rows[0].count).toBe(0);
        expect((await app.inject({ method: "GET", url: `${base}/${id}`, headers: { cookie: viewer.cookie } })).statusCode).toBe(404);
        await pool.query(`update project_access_grants set status='active' where user_id='user_reviewer'`);

        // Simulate a crashed worker using only this request's lease, then explicitly recover.
        mode = "valid";
        await pool.query(`update research_qa_requests set status='running',lease_token='lost',lease_expires_at=now()-interval '1 minute' where run_id=$1`, [failed.request.runId]);
        expect((await app.inject({ method: "GET", url: `${base}/${failed.request.runId}`, headers: { cookie: viewer.cookie } })).json().request.status).toBe("interrupted");
        expect((await app.inject({ method: "POST", url: `${base}/${failed.request.runId}/retry`, headers: { cookie: viewer.cookie }, payload: {} })).statusCode).toBe(202);
        expect((await terminal(app, viewer.cookie, failed.request.runId)).request.status).toBe("completed");
        const expired = await send("request-time-exhausted-01");
        await terminal(app, viewer.cookie, expired.json().request.runId);
        await pool.query(`delete from answer_artifacts where run_id=$1`, [expired.json().request.runId]);
        await pool.query(`update research_qa_requests set status='running',lease_token='lost',lease_expires_at=now()-interval '1 minute',
          usage='{"elapsedMs":1000,"lastActiveAt":1}' where run_id=$1`, [expired.json().request.runId]);
        const beforeRecovery = model.mock.calls.length;
        await app.inject({ method: "POST", url: `${base}/${expired.json().request.runId}/retry`, headers: { cookie: viewer.cookie }, payload: {} });
        expect((await terminal(app, viewer.cookie, expired.json().request.runId)).request.failureCode).toBe("qa_timeout");
        expect(model).toHaveBeenCalledTimes(beforeRecovery);
        await pool.query(`update projects set metadata='{"projectProfile":{"researchGoal":"New goal"}}' where id=$1`, [projectId]);
        await app.close(); app = await createV1Application({ logger: false });
        expect((await app.inject({ method: "GET", url: `${base}/${id}/evidence/${cited}`, headers: { cookie: viewer.cookie } })).json().evidence.data.projectProfile.researchGoal).toBe("Study catalyst stability");
        const unavailable = await send("request-unavailable-01");
        expect((await terminal(app, viewer.cookie, unavailable.json().request.runId)).request.failureCode).toBe("ai_unavailable");
        const counts = (await pool.query("select (select count(*) from data_snapshots)::int snapshots,(select count(*) from chart_specs)::int charts,(select count(*) from analysis_runs)::int analyses")).rows[0];
        expect(counts).toEqual({ snapshots: 0, charts: 0, analyses: 0 });
      } finally { await app?.close(); await pool.end(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(storage, { recursive: true, force: true }); }
    });
  });
});
