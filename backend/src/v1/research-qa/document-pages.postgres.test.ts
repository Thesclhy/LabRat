import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";
import { createV1Application } from "../bootstrap.js";
import { IdentityService } from "../identity/identity.service.js";
import { seedAnalysisScenario } from "../testing/analysis-review-fixture.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";
import { DocumentsRepository } from "./documents.repository.js";
import { PDF_PROCESSING_VERSION } from "../../research/doclingPages.js";

const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
const projectId = "project_analysis", base = `/api/v1/projects/${projectId}`;
const page = (number: number, text: string, status = "ready") => ({ schemaVersion: 2, page: number,
  status, text, width: 612, height: 792, rotation: 0,
  blocks: text ? [{ id: `p${number}-b0`, kind: "text", start: 0, end: text.length }] : [],
  warnings: ["failed", "needs_review"].includes(status) ? ["incomplete_page"] : [] });

describe.skipIf(!databaseUrl)("canonical PDF pages PostgreSQL", () => {
  test("complete Unicode windows, additive upgrade, immutable retries and current authorization", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated, { through: "037_research_question_tasks.sql" });
      await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated });
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-pages-"));
      let app: Awaited<ReturnType<typeof createV1Application>> | undefined;
      try {
        // A legacy checkpoint exists before the additive migration.
        await pool.query(`insert into file_objects(id,lab_id,project_id,original_name,mime_type,extension,size_bytes,
          checksum_sha256,storage_key,created_at,created_by) values('file_pages','lab_analysis',$1,'pages.pdf','application/pdf',
          'pdf',4,$2,'fixture-only',now(),'user_owner')`, [projectId, "a".repeat(64)]);
        await pool.query(`insert into context_documents(id,lab_id,project_id,original_name,created_by)
          values('old_document','lab_analysis',$1,'old.pdf','user_owner')`, [projectId]);
        await pool.query(`insert into context_document_versions(id,document_id,project_id,file_object_id,version_number,
          content_hash,processing_version,status,created_by) values('old_version','old_document',$1,'file_pages',1,$2,
          'legacy-test','ready','user_owner')`, [projectId, "a".repeat(64)]);
        const oldBody = { page: 1, status: "ready", passages: [{ id: "original", text: "historical text" }] };
        await pool.query("insert into context_document_pages values('old_version',1,$1)", [oldBody]);
        await pool.query(`insert into context_document_passages(version_id,project_id,id,ordinal,text,locator)
          values('old_version',$1,'original',0,'historical text','{"page":1}')`, [projectId]);
        await applyTestMigrations(isolated, { only: "038_document_pages.sql" });
        await applyTestMigrations(isolated, { only: "038_document_pages.sql" });
        expect((await pool.query("select body from context_document_pages where version_id='old_version'")).rows[0].body).toEqual(oldBody);
        await pool.query("update project_access_grants set capabilities='[\"read\"]' where user_id='user_reviewer'");
        await pool.query(`insert into projects(id,lab_id,name,created_by,updated_by,created_at,updated_at)
          values('other_project','lab_analysis','Other','user_owner','user_owner',now(),now())`);
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated);
        vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage); vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic");
        vi.stubEnv("ANTHROPIC_API_KEY", "");
        app = await createV1Application({ logger: false });
        const login = async (username: string) => {
          const response = await app!.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "LabRatTest123!" } });
          expect(response.statusCode).toBe(200);
          return String(response.headers["set-cookie"]).split(";")[0]!;
        };
        const owner = await login("owner"), viewer = await login("reviewer"), selected = await login("selected");
        const auth = (await app.get(IdentityService).authenticateCookieHeader(owner))!;
        const repository = app.get(DocumentsRepository);
        const input = { projectId, labId: "lab_analysis", fileObjectId: "file_pages", originalName: "pages.pdf",
          contentHash: "a".repeat(64), processingVersion: "labrat.pdf.pages.v1:test", actorUserId: auth.user.id };
        const first = await repository.register(input, auth);
        const versionId = first.version.id, url = `${base}/context-document-versions/${versionId}`;
        const long = "a".repeat(3999) + "🔬中文 ZnO −12.5 °C\n" + "b".repeat(9001);
        const pages = [page(1, long), page(2, "", "failed"), page(3, "", "empty"), page(4, "uncertain", "needs_review")];
        const result = { contentHash: input.contentHash, processingVersion: input.processingVersion, pageCount: 4, pages };
        await repository.claim(projectId, versionId, "lease1", auth);
        await expect(repository.finishPages(projectId, versionId, "stale", result, auth)).rejects.toMatchObject({ code: "document_lease_lost" });
        await expect(repository.finishPages(projectId, versionId, "lease1", { ...result, contentHash: "different" }, auth)).rejects.toMatchObject({ code: "document_processing_changed" });
        await repository.finishPages(projectId, versionId, "lease1", result, auth);
        expect((await repository.findVersion(projectId, versionId))!.status).toBe("partial");
        expect((await repository.findPage(projectId, versionId, 1))!.text).toBe(long);
        const directory = await app.inject({ method: "GET", url: `${url}/pages?limit=2`, headers: { cookie: viewer } });
        expect(directory.statusCode, directory.body).toBe(200);
        expect(directory.headers["cache-control"]).toContain("no-store");
        expect(directory.json().items.map((p: any) => p.status)).toEqual(["ready", "failed"]);
        expect(directory.json().items[0].text).toBeUndefined(); expect(directory.json().nextCursor).toBe("2");
        let cursor: string | null = "0", restored = "", count = 0;
        while (cursor !== null) {
          const response = await app.inject({ method: "GET", url: `${url}/pages/1/text?cursor=${cursor}`, headers: { cookie: viewer } });
          expect(response.statusCode, response.body).toBe(200);
          const value = response.json();
          expect(value.start).toBe(restored.length); expect(value.text.length).toBeLessThanOrEqual(4000);
          expect(value.text.isWellFormed()).toBe(true); restored += value.text; cursor = value.nextCursor;
          expect(++count).toBeLessThan(10);
        }
        expect(restored).toBe(long);
        for (const suffix of ["pages", "pages/1/text"]) {
          expect((await app.inject({ method: "GET", url: `${url}/${suffix}`, headers: { cookie: selected } })).statusCode).toBe(403);
          expect((await app.inject({ method: "GET", url: `${url}/${suffix}` })).statusCode).toBe(401);
          expect((await app.inject({ method: "GET", url: `${url}/${suffix}`.replace(projectId, "other_project"), headers: { cookie: owner } })).statusCode).toBe(404);
        }
        expect((await app.inject({ method: "GET", url: `${url}/pages/1/text?cursor=4000`, headers: { cookie: viewer } })).statusCode).toBe(400);
        expect((await app.inject({ method: "GET", url: `${url}/pages/1/text?limit=4001`, headers: { cookie: viewer } })).statusCode).toBe(400);
        expect((await app.inject({ method: "GET", url: `${base}/context-document-versions/old_version/pages`, headers: { cookie: viewer } })).statusCode).toBe(409);
        expect((await app.inject({ method: "GET", url: `${base}/context-document-versions/old_version/passages/original`, headers: { cookie: viewer } })).json().passage.text).toBe("historical text");
        const summary = (await app.inject({ method: "GET", url, headers: { cookie: viewer } })).json().version;
        for (const field of ["processingTaskId", "processingActorId", "processingSessionId", "processingAttempts", "processingStartedAt", "nextAttemptAt", "leaseToken", "leaseExpiresAt"]) expect(summary[field]).toBeUndefined();

        await repository.claim(projectId, versionId, "lease2", auth);
        await expect(repository.finishPages(projectId, versionId, "lease2", { ...result,
          pages: [page(1, "changed successful page"), page(2, "fixed"), ...pages.slice(2)] }, auth)).rejects.toMatchObject({ code: "document_page_conflict" });
        expect((await repository.findPage(projectId, versionId, 2))!.status).toBe("failed");
        await repository.finishPages(projectId, versionId, "lease2", { ...result,
          pages: [page(1, "", "failed"), page(2, "fixed"), ...pages.slice(2)] }, auth);
        expect((await repository.findPage(projectId, versionId, 1))!.text).toBe(long);
        expect((await repository.findPage(projectId, versionId, 2))!.text).toBe("fixed");
        await repository.claim(projectId, versionId, "lease3", auth);
        await expect(repository.finishPages(projectId, versionId, "lease3", { ...result, pages: pages.slice(0, 2) }, auth)).rejects.toMatchObject({ code: "document_page_set_invalid" });
        await repository.finishPages(projectId, versionId, "lease3", { ...result, pages: [pages[0]!, page(2, "fixed"), ...pages.slice(2)] }, auth);

        const next = await repository.register({ ...input, documentId: first.document.id,
          expectedVersion: first.document.version, processingVersion: "labrat.pdf.pages.v1:test-next" }, auth);
        expect(next.version.id).not.toBe(versionId); expect(next.version.versionNumber).toBe(2);
        expect((await repository.findPage(projectId, versionId, 1))!.text).toBe(long);
        await repository.claim(projectId, next.version.id, "lease4", auth);
        await expect(repository.finishPages(projectId, next.version.id, "lease4", { contentHash: input.contentHash,
          processingVersion: next.version.processingVersion, pageCount: 2, pages: [page(1, "a".repeat(1_000_001)), page(2, "b".repeat(1_000_001))] }, auth)).rejects.toMatchObject({ code: "document_text_limit" });
        expect(await repository.findPage(projectId, next.version.id, 1)).toBeNull();
        const queued = await repository.register({ ...input, originalName: "recoverable.pdf",
          processingVersion: PDF_PROCESSING_VERSION, newDocument: true }, auth);
        const second = await repository.register({ ...input, originalName: "second.pdf",
          processingVersion: PDF_PROCESSING_VERSION, newDocument: true }, auth);
        const claims = await Promise.all([repository.claimPages(projectId, queued.version.id, "cpu-1", auth),
          repository.claimPages(projectId, second.version.id, "cpu-2", auth)]);
        expect(claims.filter(Boolean)).toHaveLength(1);
        const winner = claims.find(Boolean)!;
        const started = await repository.beginPageAttempt(projectId, winner.id, winner.leaseToken!, auth);
        await repository.savePageTask(projectId, winner.id, winner.leaseToken!, "upstream-task", auth);
        const current = (await repository.findVersion(projectId, winner.id))!;
        expect(current.processingAttempts).toBe(1); expect(Date.parse(current.processingStartedAt!)).toBe(Date.parse(started));
        expect((await repository.processingAuth(current))!.user.id).toBe(auth.user.id);
        await pool.query("update context_document_versions set lease_expires_at=now()-interval '1 minute' where id=$1", [winner.id]);
        const replacement = await repository.claimPages(projectId, winner.id, "cpu-new", auth);
        expect(replacement!.processingTaskId).toBe("upstream-task"); expect(replacement!.processingAttempts).toBe(1);
        const onePage = { contentHash: input.contentHash, processingVersion: PDF_PROCESSING_VERSION, pageCount: 1, pages: [page(1, "bounded saved page")] };
        await expect(repository.finishPages(projectId, winner.id, winner.leaseToken!, onePage, auth)).rejects.toMatchObject({ code: "document_lease_lost" });
        const cancel = await app.inject({ method: "POST", url: `${base}/context-document-versions/${winner.id}/cancel`, headers: { cookie: owner }, payload: {} });
        expect(cancel.statusCode).toBe(200); expect(cancel.json().version.failureCode).toBe("document_cancelled");
        await expect(repository.finishPages(projectId, winner.id, "cpu-new", onePage, auth)).rejects.toMatchObject({ code: "document_lease_lost" });
        expect((await repository.recoverablePages()).some(({ version }) => version.id === winner.id)).toBe(false);
        await repository.queuePages(projectId, winner.id, auth);
        await repository.claimPages(projectId, winner.id, "cpu-after-cancel", auth);
        const beforeArchive = (await repository.findDocument(projectId, winner.documentId))!;
        await repository.archive(projectId, winner.documentId, beforeArchive.version, auth);
        await expect(repository.finishPages(projectId, winner.id, "cpu-after-cancel", onePage, auth)).rejects.toMatchObject({ code: "document_archived" });
        await repository.releasePages(winner, "cpu-after-cancel", "document_archived");
        expect(await repository.findPage(projectId, winner.id, 1)).toBeNull();

        // Public Guest remains denied even if the underlying account has full project read.
        await pool.query("insert into public_guest_accounts(user_id,project_id,created_by) values('user_reviewer',$1,'user_owner')", [projectId]);
        const guest = await login("reviewer");
        expect((await app.inject({ method: "GET", url: `${url}/pages`, headers: { cookie: guest } })).statusCode).toBe(403);
        await pool.query("delete from public_guest_accounts where user_id='user_reviewer'");
        await pool.query("update project_access_grants set status='inactive' where user_id='user_reviewer'");
        expect((await app.inject({ method: "GET", url: `${url}/pages/1/text`, headers: { cookie: viewer } })).statusCode).toBe(404);
        await pool.query("delete from sessions where id=$1", [auth.sessionId]);
        await expect(repository.finishPages(projectId, next.version.id, "lease4", { contentHash: input.contentHash,
          processingVersion: next.version.processingVersion, pageCount: 1, pages: [page(1, "late result")] }, auth)).rejects.toMatchObject({ statusCode: 401 });
        expect(await repository.findPage(projectId, next.version.id, 1)).toBeNull();
      } finally {
        await app?.close(); await pool.end(); vi.unstubAllEnvs();
        if (!path.basename(storage).startsWith("labrat-pages-") || path.dirname(storage) !== os.tmpdir()) throw new Error("Unexpected QA storage path");
        await fs.rm(storage, { recursive: true, force: true });
      }
    });
  });
});
