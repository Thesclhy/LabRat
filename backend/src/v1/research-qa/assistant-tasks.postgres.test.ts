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
import { researchLogin, researchProjectId as projectId, researchUpload } from "./testing/research-qa-scenario.js";

const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
const base = `/api/v1/projects/${projectId}/assistant-tasks`;
describe.skipIf(!databaseUrl)("cross-device pending Ask tasks", () => {
  test("survives restart, isolates owners, verifies current evidence and atomically continues once", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated });
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-tasks-"));
      let app: NestFastifyApplication | undefined;
      let modelCalls = 0;
      const start = async () => {
        app = await createV1Application({ logger: false });
        vi.spyOn(app.get(V1_MODEL_PROVIDER), "answerResearchQuestion").mockImplementation(async () => {
          modelCalls += 1;
          return { ok: true, status: "insufficient_evidence", claims: [], missingEvidence: ["Synthetic test has no relevant evidence."] } as any;
        });
      };
      try {
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated); vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage);
        vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "");
        await pool.query(`update project_access_grants set capabilities='["read"]' where user_id='user_reviewer'`);
        await start();
        const first = await researchLogin(app!), second = await researchLogin(app!), viewer = await researchLogin(app!, "reviewer");
        const call = (method: "GET" | "POST", url: string, cookie = first.cookie, payload?: any) => app!.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
        const body = { requestKey: "saved-task-question", question: "What does this workbook report?", attachments: [{ name: "data.xlsx", kind: "workbook" }] };
        const created = await call("POST", base, first.cookie, body);
        expect(created.statusCode, created.body).toBe(201);
        const id = created.json().id, taskUrl = `${base}/${id}`;
        expect(created.json()).toMatchObject({ ready: false, status: "waiting", attachments: [{ state: "needs_upload" }] });
        expect((await call("POST", base, second.cookie, body)).json().id).toBe(id);
        expect((await call("POST", base, first.cookie, { ...body, question: "Changed" })).statusCode).toBe(409);
        expect((await call("GET", base, viewer.cookie)).json().items).toEqual([]);
        expect((await call("GET", taskUrl, viewer.cookie)).statusCode).toBe(404);
        expect((await call("POST", `${taskUrl}/continue`, viewer.cookie, {})).statusCode).toBe(404);
        expect((await call("POST", base, viewer.cookie, body)).statusCode).toBe(403);
        expect((await call("POST", `${taskUrl}/continue`, first.cookie, {})).statusCode).toBe(409);
        expect((await call("POST", `${taskUrl}/attachments`, first.cookie, { index: 0, workbookReviewSessionId: "foreign" })).statusCode).toBe(400);
        expect((await call("POST", `${taskUrl}/attachments`, first.cookie, { index: 0, workbookReviewSessionId: "review_analysis", accepted: true })).statusCode).toBe(400);
        const region = (await pool.query("select * from workbook_review_regions where id='review_region_analysis'")).rows[0];
        await pool.query("update workbook_review_regions set review_status='suggested',accepted_revision_id=null where id='review_region_analysis'");
        const attach = { index: 0, workbookReviewSessionId: "review_analysis" };
        expect((await call("POST", `${taskUrl}/attachments`, first.cookie, attach)).json()).toMatchObject({ ready: false, attachments: [{ state: "needs_review", sourceDocumentId: "source_analysis" }] });
        expect((await call("POST", `${taskUrl}/attachments`, second.cookie, attach)).statusCode).toBe(200);
        expect((await call("POST", `${taskUrl}/continue`, second.cookie, {})).statusCode).toBe(409);
        expect(modelCalls).toBe(0);
        await app!.close(); await start();
        expect((await call("GET", base, second.cookie)).json().items[0].id).toBe(id);
        expect(modelCalls).toBe(0);
        await pool.query("update workbook_review_regions set review_status='accepted',accepted_revision_id=$1 where id='review_region_analysis'", [region.accepted_revision_id]);
        expect((await call("GET", taskUrl, second.cookie)).json().ready).toBe(true);
        // A stale UI cannot continue after confirmation is withdrawn.
        await pool.query("update workbook_review_regions set review_status='suggested' where id='review_region_analysis'");
        expect((await call("POST", `${taskUrl}/continue`, second.cookie, {})).statusCode).toBe(409);
        await pool.query("update workbook_review_regions set review_status='accepted' where id='review_region_analysis'");
        await pool.query(`create function task_commit_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic task commit failure'; end $$`);
        await pool.query(`create trigger task_commit_failure before update on assistant_tasks for each row when (new.status='submitted') execute function task_commit_failure()`);
        expect((await call("POST", `${taskUrl}/continue`, first.cookie, {})).statusCode).toBe(500);
        expect((await pool.query("select count(*)::int count from research_qa_requests where request_key=$1", [`task-${id}`])).rows[0].count).toBe(0);
        expect((await call("GET", taskUrl)).json().status).toBe("waiting");
        await pool.query("drop trigger task_commit_failure on assistant_tasks; drop function task_commit_failure()");
        const continued = await Promise.all([call("POST", `${taskUrl}/continue`, first.cookie, {}), call("POST", `${taskUrl}/continue`, second.cookie, {})]);
        for (const result of continued) expect(result.statusCode, result.body).toBe(202);
        const runId = continued[0]!.json().request.runId;
        expect(continued[1]!.json().request.runId).toBe(runId);
        await vi.waitFor(async () => expect((await call("GET", `/api/v1/projects/${projectId}/research-questions/${runId}`)).json().request.status).toBe("completed"));
        expect(modelCalls).toBe(1);
        expect((await call("POST", `${taskUrl}/continue`, second.cookie, {})).json().request.runId).toBe(runId);
        expect(modelCalls).toBe(1);
        expect((await call("POST", `${taskUrl}/cancel`, first.cookie, {})).statusCode).toBe(409);
        expect((await call("GET", base, second.cookie)).json().items).toEqual([]);
        expect((await call("GET", taskUrl, second.cookie)).json()).toMatchObject({ status: "submitted", runId });

        const mixed = (await call("POST", base, first.cookie, { ...body, requestKey: "mixed-task-question", attachments: [...body.attachments, { name: "method.txt", kind: "reference" }] })).json();
        await call("POST", `${base}/${mixed.id}/attachments`, first.cookie, attach);
        expect((await call("POST", `${base}/${mixed.id}/continue`, first.cookie, {})).statusCode).toBe(409);
        const file = await researchUpload(app!, first.cookie, "method.txt", Buffer.from("Use a dry sample."));
        const ref = (await call("POST", `/api/v1/projects/${projectId}/context-documents`, first.cookie, { fileObjectId: file.id, newDocument: true })).json();
        const refAttached = await call("POST", `${base}/${mixed.id}/attachments`, first.cookie, { index: 1, documentId: ref.document.id, versionId: ref.version.id });
        expect(refAttached.statusCode, refAttached.body).toBe(200);
        await vi.waitFor(async () => {
          const saved = (await call("GET", `${base}/${mixed.id}`)).json();
          expect(saved.ready, JSON.stringify(saved)).toBe(true);
        }, { timeout: 15_000 });
        const replacementFile = await researchUpload(app!, first.cookie, "method.txt", Buffer.from("Revised procedure uses a wet sample."));
        const replacement = (await call("POST", `/api/v1/projects/${projectId}/context-documents`, first.cookie,
          { fileObjectId: replacementFile.id, documentId: ref.document.id, expectedVersion: ref.document.version })).json();
        expect((await call("GET", `${base}/${mixed.id}`)).json().attachments[1].versionId).toBe(ref.version.id);
        expect((await call("GET", `${base}/${mixed.id}`)).json().ready).toBe(true);
        const scoped = (await call("POST", base, first.cookie, { ...body, requestKey: "scoped-pending-question",
          question: "Based only on this document, what sample is required?", referenceDocuments: [{ documentId: ref.document.id, versionId: ref.version.id }] })).json();
        await call("POST", `${base}/${scoped.id}/attachments`, first.cookie, attach);
        const scopedRun = await call("POST", `${base}/${scoped.id}/continue`, second.cookie, {});
        expect(scopedRun.statusCode, scopedRun.body).toBe(202);
        expect(scopedRun.json().request.sourceScope).toBe("selected");
        await call("POST", `/api/v1/projects/${projectId}/context-documents/${ref.document.id}/archive`, first.cookie, { expectedVersion: replacement.document.version });
        expect((await call("GET", `${base}/${mixed.id}`)).json().ready).toBe(false);
        expect((await call("POST", `${base}/${mixed.id}/continue`, first.cookie, {})).statusCode).toBe(409);
        expect((await call("POST", `${base}/${mixed.id}/cancel`, first.cookie, {})).statusCode).toBe(200);
        expect((await call("POST", `${base}/${mixed.id}/continue`, first.cookie, {})).statusCode).toBe(409);

        const race = (await call("POST", base, first.cookie, { ...body, requestKey: "cancel-continue-race" })).json();
        await call("POST", `${base}/${race.id}/attachments`, first.cookie, attach);
        const raceResults = await Promise.all([call("POST", `${base}/${race.id}/cancel`, first.cookie, {}), call("POST", `${base}/${race.id}/continue`, second.cookie, {})]);
        expect(raceResults.filter((result) => result.statusCode === 409)).toHaveLength(1);
        const final = (await call("GET", `${base}/${race.id}`)).json();
        expect(["submitted", "cancelled"]).toContain(final.status);
        expect(Boolean(final.runId)).toBe(final.status === "submitted");
        const proposer = await researchLogin(app!, "proposer");
        const personal = await call("POST", base, proposer.cookie, { ...body, requestKey: "revoked-task-owner" });
        expect(personal.statusCode, personal.body).toBe(201);
        await pool.query("delete from project_access_grants where user_id='user_proposer'");
        expect([403, 404]).toContain((await call("GET", `${base}/${personal.json().id}`, proposer.cookie)).statusCode);
        expect([403, 404]).toContain((await call("POST", `${base}/${personal.json().id}/continue`, proposer.cookie, {})).statusCode);
        for (let index = 0; index < 3; index += 1) await call("POST", base, first.cookie, { ...body, requestKey: `pagination-task-${index}` });
        const page = (await call("GET", `${base}?limit=1`)).json();
        expect(page.items).toHaveLength(1); expect(page.nextCursor).toBeTruthy();
        const next = await call("GET", `${base}?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`);
        expect(next.statusCode, next.body).toBe(200); expect(next.json().items[0].id).not.toBe(page.items[0].id);
        expect((await call("GET", `${base}?limit=41`)).statusCode).toBe(400);
        const selected = await researchLogin(app!, "selected");
        expect((await call("GET", base, selected.cookie)).statusCode).toBe(403);
        expect((await pool.query("select (select count(*) from analysis_runs)::int analyses,(select count(*) from chart_specs)::int charts")).rows[0]).toEqual({ analyses: 0, charts: 0 });
      } finally { await app?.close(); await pool.end(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await fs.rm(storage, { recursive: true, force: true }); }
    });
  }, 90_000);
});
