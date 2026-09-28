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
import { ResearchEvidenceService } from "./research-evidence.service.js";
import { researchLogin, researchUpload, researchProjectId as projectId } from "./testing/research-qa-scenario.js";

const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL, base = `/api/v1/projects/${projectId}`;
describe.skipIf(!databaseUrl)("unified Ask reference identities and scope", () => {
  test("same-name documents stay separate, selected versions survive updates, View can ask but cannot mutate", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated }), storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-mentions-"));
      let app: NestFastifyApplication | undefined;
      try {
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated); vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage);
        vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "");
        await pool.query(`update project_access_grants set capabilities='["read"]' where user_id='user_reviewer'`);
        app = await createV1Application({ logger: false });
        const owner = await researchLogin(app), view = await researchLogin(app, "reviewer");
        const register = async (content: string, choice: any = { newDocument: true }) => {
          const file = await researchUpload(app!, owner.cookie, "method.txt", Buffer.from(content));
          const response = await app!.inject({ method: "POST", url: `${base}/context-documents`, headers: { cookie: owner.cookie }, payload: { fileObjectId: file.id, ...choice } });
          expect(response.statusCode, response.body).toBe(201);
          const result = response.json();
          await vi.waitFor(async () => {
            const current = await app!.inject({ method: "GET", url: `${base}/context-document-versions/${result.version.id}`, headers: { cookie: view.cookie } });
            expect(current.json().version.status).toBe("ready");
          });
          return { ...result, file };
        };
        const first = await register("Original method requires a dry sample."), separate = await register("Independent method uses a wet sample.");
        expect(separate.document.id).not.toBe(first.document.id);
        const second = await register("Revised method uses a sealed sample.", { documentId: first.document.id, expectedVersion: first.document.version });
        expect(second.document.id).toBe(first.document.id); expect(second.version.versionNumber).toBe(2);
        const ambiguous = await app.inject({ method: "POST", url: `${base}/context-documents`, headers: { cookie: owner.cookie }, payload: { fileObjectId: first.file.id } });
        expect(ambiguous.statusCode).toBe(409);
        const stale = await app.inject({ method: "POST", url: `${base}/context-documents`, headers: { cookie: owner.cookie }, payload: { fileObjectId: separate.file.id, documentId: first.document.id, expectedVersion: first.document.version } });
        expect(stale.statusCode).toBe(409);
        const listed = await app.inject({ method: "GET", url: `${base}/context-documents?search=method&type=txt&status=ready&sort=oldest&limit=1`, headers: { cookie: view.cookie } });
        expect(listed.json().items[0].document.id).toBe(first.document.id);
        const next = await app.inject({ method: "GET", url: `${base}/context-documents?type=txt&sort=oldest&cursor=${listed.json().nextCursor}`, headers: { cookie: view.cookie } });
        expect(next.json().items.map((item: any) => item.document.id)).toEqual([separate.document.id]);
        const notPdf = await app.inject({ method: "GET", url: `${base}/context-documents?type=pdf`, headers: { cookie: view.cookie } });
        expect(notPdf.json().items).toEqual([]);
        const denied = await app.inject({ method: "POST", url: `${base}/context-documents`, headers: { cookie: view.cookie }, payload: { fileObjectId: first.file.id, newDocument: true } });
        expect(denied.statusCode).toBe(403);
        const service = app.get(ResearchEvidenceService);
        const references = await service.resolveReferences(view.auth, projectId, [{ documentId: first.document.id, versionId: first.version.id }]);
        await expect(service.resolveReferences(view.auth, projectId, [{ documentId: separate.document.id, versionId: first.version.id }])).rejects.toMatchObject({ code: "qa_reference_unavailable" });
        const selected = service.createSession(view.auth, projectId, new AbortController().signal, { referenceDocuments: references, sourceScope: "selected" });
        const selectedHits = await selected.invoke("search_project_documents", { query: "method" });
        expect(selectedHits.items.length).toBeGreaterThan(0);
        expect(selectedHits.items.every((item: any) => item.target.versionId === first.version.id)).toBe(true);
        await expect(selected.invoke("get_project_context", {})).rejects.toMatchObject({ statusCode: 404 });
        const broader = service.createSession(view.auth, projectId, new AbortController().signal, { referenceDocuments: references, sourceScope: "project" });
        const broadHits = await broader.invoke("search_project_documents", { query: "method" });
        expect(broadHits.items[0].target.versionId).toBe(first.version.id);
        expect(broadHits.items.some((item: any) => item.target.versionId === separate.version.id)).toBe(true);
        expect(broadHits.items.some((item: any) => item.target.versionId === second.version.id)).toBe(false);
        await expect(broader.invoke("read_workbook_source", { sourceDocumentId: "source_analysis", sheetName: "Carbon", range: "A1" })).rejects.toMatchObject({ code: "qa_workbook_review_required" });
        const provider = app.get(V1_MODEL_PROVIDER);
        const model = vi.spyOn(provider, "answerResearchQuestion").mockImplementation(async (input: any, options: any) => {
          expect(input.selectedContext.referenceDocuments).toEqual(references);
          expect(input.selectedContext.sourceScope).toBe("selected");
          const hit = input.initialDiscovery.items[0];
          const { evidence } = await options.toolHandlers.read_document_passage({ versionId: hit.target.versionId, passageId: hit.target.passageId });
          return { ok: true, status: "answered", claims: [{ text: "The original method requires a dry sample.", citations: [{ evidenceId: evidence.id, quote: "dry sample" }], numericBindings: [] }], missingEvidence: [] } as any;
        });
        const question = {
          requestKey: "pinned-source-question", question: "Based only on this document, what sample is required?", referenceDocuments: [{ documentId: first.document.id, versionId: first.version.id }],
          conversation: [{ role: "user", text: "We discussed sample preparation." }] };
        const send = await app.inject({ method: "POST", url: `${base}/research-questions`, headers: { cookie: view.cookie }, payload: question });
        expect(send.statusCode, send.body).toBe(202);
        let completed: any;
        await vi.waitFor(async () => {
          const result = await app!.inject({ method: "GET", url: `${base}/research-questions/${send.json().request.runId}`, headers: { cookie: view.cookie } });
          completed = result.json(); expect(completed.request.status).toBe("completed");
        });
        expect(model).toHaveBeenCalledTimes(1); expect(completed.request.referenceDocuments).toEqual(references);
        const archive = await app.inject({ method: "POST", url: `${base}/context-documents/${first.document.id}/archive`, headers: { cookie: owner.cookie }, payload: { expectedVersion: second.document.version } });
        expect(archive.statusCode, archive.body).toBe(200);
        await expect(broader.invoke("search_project_documents", { query: "method" })).rejects.toMatchObject({ code: "qa_reference_unavailable" });
        const saved = await app.inject({ method: "GET", url: `${base}/research-questions/${send.json().request.runId}/evidence/${completed.artifact.evidence[0].id}`, headers: { cookie: view.cookie } });
        expect(saved.statusCode).toBe(200); expect(saved.json().evidence.version.versionId).toBe(first.version.id);
        const replay = await app.inject({ method: "POST", url: `${base}/research-questions`, headers: { cookie: view.cookie }, payload: question });
        expect(replay.statusCode, replay.body).toBe(202); expect(replay.json().request.runId).toBe(send.json().request.runId);
        expect(model).toHaveBeenCalledTimes(1);
        const counts = (await pool.query("select (select count(*) from analysis_runs)::int analyses,(select count(*) from chart_specs)::int charts")).rows[0];
        expect(counts).toEqual({ analyses: 0, charts: 0 });
      } finally { await app?.close(); await pool.end(); vi.unstubAllEnvs(); await fs.rm(storage, { recursive: true, force: true }); }
    });
  }, 60_000);
});
