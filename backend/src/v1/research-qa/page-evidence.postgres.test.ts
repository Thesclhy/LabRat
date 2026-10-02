import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { describe, expect, test, vi } from 'vitest';
import { createV1Application } from '../bootstrap.js';
import { IdentityService } from '../identity/identity.service.js';
import { seedAnalysisScenario } from '../testing/analysis-review-fixture.js';
import { applyTestMigrations, withTestSchema } from '../testing/postgres-test-database.js';
import { V1_MODEL_PROVIDER } from '../platform/model/model-provider.js';
import { DocumentsRepository } from './documents.repository.js';
import { ResearchEvidenceService } from './research-evidence.service.js';
import { modelDocumentEvidence, researchQuestionRequest } from '../../research/citedAnswer.js';

const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
const projectId = 'project_analysis', base = `/api/v1/projects/${projectId}`;
const body = (page: number, text: string) => ({ schemaVersion: 2, page, status: 'ready', text,
  width: 612, height: 792, rotation: 0, warnings: [],
  blocks: [{ id: `p${page}`, kind: 'text', start: 0, end: text.length, bbox: [.1, .2, .8, .7] }] });

describe.skipIf(!databaseUrl)('canonical PDF Q&A PostgreSQL', () => {
  test('whole-page discovery, pinned versions, frozen sources and compact model payload retain authorization', async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated });
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'labrat-page-evidence-'));
      let app: Awaited<ReturnType<typeof createV1Application>> | undefined;
      try {
        await pool.query(`update project_access_grants set capabilities='["read"]' where user_id='user_reviewer'`);
        await pool.query(`insert into file_objects(id,lab_id,project_id,original_name,mime_type,extension,size_bytes,
          checksum_sha256,storage_key,created_at,created_by) values('page_file','lab_analysis',$1,'same.pdf','application/pdf',
          'pdf',4,$2,'fixture-only',now(),'user_owner')`, [projectId, 'a'.repeat(64)]);
        vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', isolated); vi.stubEnv('LABRAT_FILE_STORAGE_ROOT', storage);
        vi.stubEnv('LABRAT_AI_PROVIDER', 'anthropic'); vi.stubEnv('ANTHROPIC_API_KEY', '');
        app = await createV1Application({ logger: false });
        const login = async (username: string) => {
          const response = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: 'LabRatTest123!' } });
          expect(response.statusCode).toBe(200); const cookie = String(response.headers['set-cookie']).split(';')[0]!;
          return { cookie, auth: (await app!.get(IdentityService).authenticateCookieHeader(cookie))! };
        };
        const owner = await login('owner'), viewer = await login('reviewer'), selected = await login('selected');
        const repository = app.get(DocumentsRepository), readers = app.get(ResearchEvidenceService);
        const publish = async (text: string, suffix: string, choice: Record<string, any> = { newDocument: true }) => {
          const input = { projectId, labId: 'lab_analysis', fileObjectId: 'page_file', originalName: 'same.pdf',
            contentHash: 'a'.repeat(64), processingVersion: `labrat.pdf.pages.v1:${suffix}`, actorUserId: owner.auth.user.id, ...choice };
          const result = await repository.register(input, owner.auth);
          await repository.claim(projectId, result.version.id, suffix, owner.auth);
          await repository.finishPages(projectId, result.version.id, suffix, { ...input, pageCount: 1, pages: [body(1, text)] }, owner.auth);
          return result;
        };
        const text = 'Beginning of the source.\n' + 'x'.repeat(3999) + '🔬' + ' y'.repeat(5000) + '\nFe2O3 苏打催化剂 ZnO: source only.';
        const original = await publish(text, 'old'), other = await publish('CoO unselected document', 'other');
        expect(other.document.id).not.toBe(original.document.id); expect(other.document.originalName).toBe(original.document.originalName);
        const context = { sourceScope: 'selected', referenceDocuments: [{ documentId: original.document.id, versionId: original.version.id }] };
        const session = readers.createSession(viewer.auth, projectId, new AbortController().signal, context);
        for (const query of ['Fe2O3', '苏打催化剂', 'ZnO']) {
          const search = await session.invoke('search_project_documents', { query });
          const hit = search.items.find((item: any) => item.target.snippet.includes(query));
          expect(hit?.kind).toBe('document_page'); expect(hit.target.page).toBe(1);
          expect(hit.target.cursor).toBeGreaterThan(4000);
          const read = await session.invoke('read_document_page', { versionId: hit.target.versionId, page: 1, cursor: hit.target.cursor });
          expect(read.evidence.data.text).toContain(query);
          expect(read.evidence.locator.start).toBe(hit.target.cursor);
          expect(read.evidence.data.text).toBe(text.slice(read.evidence.locator.start, read.evidence.locator.end));
        }
        const noOther = await session.invoke('search_project_documents', { query: 'CoO' });
        expect(noOther.items.every((item: any) => item.target.versionId === original.version.id)).toBe(true);
        expect(noOther.items).toEqual([]);
        expect(noOther.coverage.note).toContain('not full-source reading or proof of absence');
        await expect(session.invoke('read_document_page', { versionId: other.version.id, page: 1 })).rejects.toMatchObject({ code: 'evidence_not_found' });
        await expect(session.invoke('find_experiments', { query: '' })).rejects.toMatchObject({ code: 'evidence_not_found' });
        await expect(readers.createSession(selected.auth, projectId, new AbortController().signal).invoke('search_project_documents', { query: 'ZnO' })).rejects.toMatchObject({ statusCode: 403 });
        const provider = app.get(V1_MODEL_PROVIDER);
        let frozen: any;
        vi.spyOn(provider, 'answerResearchQuestion').mockImplementation(async (input: any, options: any) => {
          const request = researchQuestionRequest(input, options);
          const first = await request.toolHandlers.read_document_page({ versionId: original.version.id, page: 1, cursor: 0 });
          const next = await request.toolHandlers.read_document_page({ versionId: original.version.id, page: 1, cursor: first.evidence.nextCursor });
          expect(next.evidence.text.isWellFormed()).toBe(true);
          frozen = { first, next };
          expect(JSON.stringify(frozen)).not.toMatch(/contentHash|rectangles|processingVersion|blocks|base64/);
          return { ok: true, status: 'answered', claims: [{ text: 'The source contains the microscope symbol.',
            citations: [{ evidenceId: next.evidence.id }] }], missingEvidence: [] } as any;
        });
        const sent = await app.inject({ method: 'POST', url: `${base}/research-questions`, headers: { cookie: viewer.cookie },
          payload: { requestKey: 'page-citation-test', question: 'Read the first two windows.', ...context } });
        expect(sent.statusCode, sent.body).toBe(202); const runId = sent.json().request.runId;
        let completed: any;
        await vi.waitFor(async () => {
          completed = (await app!.inject({ method: 'GET', url: `${base}/research-questions/${runId}`, headers: { cookie: viewer.cookie } })).json();
          expect(completed.request.status).toBe('completed');
        }, { timeout: 5000 });
        expect(completed.artifact.evidence).toHaveLength(2); expect(completed.artifact.trace).toHaveLength(2);
        const cited = completed.artifact.answer.claims[0].citations[0].evidenceId;
        const sourceUrl = `${base}/research-questions/${runId}/evidence/${cited}`;
        const firstSource = (await app.inject({ method: 'GET', url: sourceUrl, headers: { cookie: viewer.cookie } })).json().evidence;
        expect(firstSource.locator.precision).toBe('block'); expect(firstSource.locator.rectangles).toHaveLength(1);
        expect(firstSource.data.text).toBe(frozen.next.evidence.text);
        expect(firstSource.version.versionId).toBe(original.version.id);
        const newer = await publish('New parser text: RuO2', 'new', { documentId: original.document.id, expectedVersion: original.document.version });
        expect(newer.version.id).not.toBe(original.version.id);
        const pinned = await session.invoke('search_project_documents', { query: 'Fe2O3' });
        expect(pinned.items.some((item: any) => item.target.versionId === original.version.id)).toBe(true);
        expect(pinned.items.some((item: any) => item.target.versionId === newer.version.id)).toBe(false);
        const unpinned = await readers.createSession(viewer.auth, projectId, new AbortController().signal).invoke('search_project_documents', { query: 'Fe2O3' });
        expect(unpinned.items).toEqual([]);
        await repository.archive(projectId, original.document.id, newer.document.version, owner.auth);
        expect((await app.inject({ method: 'GET', url: sourceUrl, headers: { cookie: viewer.cookie } })).json().evidence.data.text).toBe(firstSource.data.text);
        await expect(session.invoke('read_document_page', { versionId: original.version.id, page: 1 })).rejects.toMatchObject({ code: 'qa_reference_unavailable' });
        await pool.query('delete from sessions where id=$1', [viewer.auth.sessionId]);
        expect((await app.inject({ method: 'GET', url: sourceUrl, headers: { cookie: viewer.cookie } })).statusCode).toBe(401);
        const report = { sameTextCharacters: firstSource.data.text.length,
          savedSourceBytes: Buffer.byteLength(JSON.stringify(firstSource)),
          modelBytes: Buffer.byteLength(JSON.stringify(modelDocumentEvidence(firstSource))),
          readWindows: completed.artifact.evidence.length, traceEntries: completed.artifact.trace.length,
          checks: ['long-page-literal', 'Chinese', 'formula', 'selected-only', 'pinned-version', 'duplicate-filename', 'archive-history', 'revoked-session'] };
        const output = path.resolve('../artifacts/docling-pdf-pages'); await fs.mkdir(output, { recursive: true });
        await fs.writeFile(path.join(output, 'page-evidence-db.json'), JSON.stringify(report, null, 2));
      } finally {
        if (app) await app.close(); await pool.end(); vi.restoreAllMocks(); vi.unstubAllEnvs();
        await fs.rm(storage, { recursive: true, force: true });
      }
    });
  }, 90000);
});
