import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";
import { createV1Application } from "../bootstrap.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";
import { seedAnalysisScenario } from "../testing/analysis-review-fixture.js";
import { DocumentsRepository } from "./documents.repository.js";
import { IdentityService } from "../identity/identity.service.js";
import { PDF_PROCESSING_VERSION } from "../../research/doclingPages.js";

const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
const enabled = process.env.LABRAT_DOCLING_QA === "1" && databaseUrl && process.env.LABRAT_DOCLING_API_KEY;
const root = path.resolve(process.env.LABRAT_DOCLING_QA_ROOT || "../artifacts/docling-pdf-pages");
const projectId = "project_analysis", base = `/api/v1/projects/${projectId}`;

describe.skipIf(!enabled)("real local Docling upload and page persistence", () => {
  test.skipIf(process.env.LABRAT_DOCLING_RESTART_QA !== "1")("service restart preserves the database job and bounds resubmission", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated });
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-docling-restart-"));
      let app: Awaited<ReturnType<typeof createV1Application>> | undefined;
      try {
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated); vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage);
        vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "");
        app = await createV1Application({ logger: false });
        const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "owner", password: "LabRatTest123!" } });
        expect(login.statusCode).toBe(200); const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
        const boundary = "restart-original-paper", buffer = await fs.readFile(process.env.LABRAT_DOCLING_QA_PAPER!);
        const upload = await app.inject({ method: "POST", url: `${base}/files`, headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
          payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="restart.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
        expect(upload.statusCode).toBe(201);
        const registered = await app.inject({ method: "POST", url: `${base}/context-documents`, headers: { cookie }, payload: { fileObjectId: upload.json().fileObject.id } });
        expect(registered.statusCode).toBe(201); const id = registered.json().version.id;
        let taskId = "";
        await vi.waitFor(async () => {
          taskId = (await pool.query("select processing_task_id from context_document_versions where id=$1", [id])).rows[0].processing_task_id;
          expect(taskId).toBeTruthy();
        }, { timeout: 30_000, interval: 25 });
        // The external QA harness restarts only the verified local test service.
        await fs.writeFile(path.join(root, "restart-stage.json"), JSON.stringify({ taskId, versionId: id, readyAt: Date.now() }));
        let version: any;
        await vi.waitFor(async () => {
          const response = await app!.inject({ method: "GET", url: `${base}/context-document-versions/${id}`, headers: { cookie } });
          expect(response.statusCode).toBe(200); version = response.json().version;
          expect(["ready", "partial", "failed"]).toContain(version.status);
        }, { timeout: 170_000, interval: 500 });
        expect(["ready", "partial"], JSON.stringify(version)).toContain(version.status);
        const state = (await pool.query("select processing_attempts from context_document_versions where id=$1", [id])).rows[0];
        expect(state.processing_attempts).toBe(2);
        const pages = (await pool.query("select page_number,body->>'text' as text from context_document_pages where version_id=$1 order by page_number", [id])).rows;
        expect(pages.map((row: any) => row.page_number)).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
        expect(pages.every((row: any) => row.text.length > 100)).toBe(true);
        await fs.writeFile(path.join(root, "service-restart-acceptance.json"), JSON.stringify({ status: version.status, attempts: state.processing_attempts, pages: pages.length }));
      } finally {
        await app?.close(); await pool.end(); vi.unstubAllEnvs();
        if (!path.basename(storage).startsWith("labrat-docling-restart-") || path.dirname(storage) !== os.tmpdir()) throw new Error("Unexpected QA storage path");
        await fs.rm(storage, { recursive: true, force: true });
      }
    });
  }, 240_000);

  test("real parser, native/scan/mixed/error pages, backend restart and missing upstream task", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated });
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-docling-e2e-"));
      let app: Awaited<ReturnType<typeof createV1Application>> | undefined;
      const evidence: any[] = [];
      try {
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated);
        vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage); vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "");
        app = await createV1Application({ logger: false });
        const signedIn = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "owner", password: "LabRatTest123!" } });
        expect(signedIn.statusCode).toBe(200); const cookie = String(signedIn.headers["set-cookie"]).split(";")[0]!;
        const auth = (await app.get(IdentityService).authenticateCookieHeader(cookie))!;
        const upload = async (name: string, input: string) => {
          const boundary = "docling-local-qa-boundary", buffer = await fs.readFile(input);
          const response = await app!.inject({ method: "POST", url: `${base}/files`, headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
            payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
          expect(response.statusCode, response.body).toBe(201); return response.json().fileObject;
        };
        const register = async (fileId: string) => {
          const response = await app!.inject({ method: "POST", url: `${base}/context-documents`, headers: { cookie }, payload: { fileObjectId: fileId } });
          expect(response.statusCode, response.body).toBe(201); return response.json();
        };
        const finished = async (id: string) => {
          let result: any;
          await vi.waitFor(async () => {
            const response = await app!.inject({ method: "GET", url: `${base}/context-document-versions/${id}`, headers: { cookie } });
            expect(response.statusCode).toBe(200); result = response.json().version;
            expect(["ready", "partial", "failed"]).toContain(result.status);
          }, { timeout: 110_000, interval: 250 }); return result;
        };
        const saved = async (id: string) => (await pool.query("select page_number,body from context_document_pages where version_id=$1 order by page_number", [id])).rows;
        const nativeFile = await upload("native.pdf", path.join(root, "fixtures/native.pdf"));
        const native = await register(nativeFile.id);
        let taskId: string;
        await vi.waitFor(async () => {
          const row = (await pool.query("select processing_task_id from context_document_versions where id=$1", [native.version.id])).rows[0];
          expect(row.processing_task_id).toBeTruthy(); taskId = row.processing_task_id;
        }, { timeout: 20_000, interval: 30 });
        await app.close(); app = await createV1Application({ logger: false });
        const nativeVersion = await finished(native.version.id);
        expect(nativeVersion.status, JSON.stringify(nativeVersion)).toBe("ready");
        const nativePages = await saved(native.version.id);
        expect(nativePages).toHaveLength(3); expect(nativePages[2].body.text.length).toBeGreaterThan(6000);
        expect(nativePages[1].body.blocks[0].bbox).toHaveLength(4);
        const run = (await pool.query("select processing_attempts from context_document_versions where id=$1", [native.version.id])).rows[0];
        expect(run.processing_attempts).toBe(1);
        evidence.push({ name: "native-backend-restart", version: nativeVersion, taskId: taskId!, attempts: run.processing_attempts,
          pages: nativePages.map(({ body }: any) => ({ page: body.page, status: body.status, characters: body.text.length })) });

        // The server has no task with this id: recover from its actual 404 response.
        const repository = app.get(DocumentsRepository);
        const lost = await repository.register({ projectId, labId: "lab_analysis", fileObjectId: nativeFile.id,
          originalName: "lost-task.pdf", contentHash: nativeFile.checksumSha256, processingVersion: PDF_PROCESSING_VERSION,
          actorUserId: auth.user.id, newDocument: true }, auth);
        await pool.query(`update context_document_versions set status='processing',processing_task_id='qa-missing-task',
          processing_attempts=1,processing_started_at=now(),lease_token='expired',lease_expires_at=now()-interval '1 minute' where id=$1`, [lost.version.id]);
        const recovered = await finished(lost.version.id);
        expect(recovered.status, JSON.stringify(recovered)).toBe("ready");
        expect((await pool.query("select processing_attempts from context_document_versions where id=$1", [lost.version.id])).rows[0].processing_attempts).toBe(2);
        expect(await saved(lost.version.id)).toHaveLength(3); evidence.push({ name: "missing-upstream-task", status: recovered.status, attempts: 2 });

        for (const [name, expected] of [["scan", "partial"], ["mixed", "partial"], ["blank", "ready"],
          ["low-quality", "partial"], ["encrypted", "failed"], ["corrupt", "failed"]]) {
          const file = await upload(`${name}.pdf`, path.join(root, `fixtures/${name}.pdf`));
          const registered = await register(file.id), version = await finished(registered.version.id);
          expect(version.status, JSON.stringify(version)).toBe(expected);
          const pages = await saved(version.id);
          if (name === "scan") { expect(pages[0].body.text).toContain("催化剂"); expect(pages[0].body.text).toContain("Zn/b-ZnO"); }
          if (name === "mixed") { expect(pages[0].body.text.split("NATIVE-HEADER").length - 1).toBe(1); expect(pages[0].body.text).toContain("SCAN-REGION"); }
          if (name === "blank") expect(pages[0].body.status).toBe("empty");
          if (name === "low-quality") expect(pages[0].body.warnings).toContain("sparse_text_check_original");
          if (expected === "failed") {
            expect(version.failureCode).toBe(`document_${name}`); expect(pages).toHaveLength(0);
            const retry = await app.inject({ method: "POST", url: `${base}/context-document-versions/${version.id}/retry`, headers: { cookie }, payload: {} });
            expect(retry.statusCode).toBe(422);
          }
          evidence.push({ name, version, pages: pages.map(({ body }: any) => ({ page: body.page, status: body.status, characters: body.text.length, warnings: body.warnings })) });
        }
        const paperPath = process.env.LABRAT_DOCLING_QA_PAPER;
        if (!paperPath) throw new Error("The original paper is required for this real acceptance run.");
        const paperFile = await upload("s41467-024-55584-1.pdf", paperPath), paper = await register(paperFile.id);
        const version = await finished(paper.version.id), pages = await saved(paper.version.id);
        expect(["ready", "partial"], JSON.stringify(version)).toContain(version.status); expect(pages).toHaveLength(11);
        const golden = JSON.parse(await fs.readFile("../doc/qa/docling-pdf-pages-goldens.json", "utf8"));
        const compare = (text: string) => text.replaceAll("ﬁ", "fi").replaceAll("ﬂ", "fl").replace(/-\s*\n\s*/gu, "").replace(/\s+/gu, " ").trim();
        expect(paperFile.checksumSha256).toBe(golden.sourceSha256);
        for (const anchor of golden.anchors) expect(compare(pages[anchor.page - 1].body.text), JSON.stringify(anchor)).toContain(compare(anchor.text));
        evidence.push({ name: "original-paper", version, pages: pages.length, anchorsPassed: golden.anchors.length });
      } finally {
        await fs.writeFile(path.join(root, "database-real-docling.json"), JSON.stringify(evidence, null, 2));
        await app?.close(); await pool.end(); vi.unstubAllEnvs();
        if (!path.basename(storage).startsWith("labrat-docling-e2e-") || path.dirname(storage) !== os.tmpdir()) throw new Error("Unexpected QA storage path");
        await fs.rm(storage, { recursive: true, force: true });
      }
    });
  }, 300_000);
});
