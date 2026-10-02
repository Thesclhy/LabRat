import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { createV1Application } from '../bootstrap.js';
import { seedAnalysisScenario } from '../testing/analysis-review-fixture.js';
import { applyTestMigrations, withTestSchema } from '../testing/postgres-test-database.js';
import { researchLogin, researchUpload, researchProjectId } from './testing/research-qa-scenario.js';
import { DocumentsService } from './documents.service.js';
import { ResearchQuestionsService } from './research-questions.service.js';
import { V1_MODEL_PROVIDER } from '../platform/model/model-provider.js';

const enabled = process.env.LABRAT_DOCLING_PROVIDER_QA === '1';
const root = path.resolve('../artifacts/docling-pdf-pages');
const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
describe.skipIf(!enabled)('Docling pages with the configured real Q&A provider', () => {
  test('six frozen public/synthetic cases retain outputs for semantic review', async () => {
    expect(new URL(databaseUrl!).hostname).toBe('127.0.0.1');
    const labels = JSON.parse(await fs.readFile('../doc/qa/docling-pdf-pages-questions.json', 'utf8'));
    const chosen = process.env.LABRAT_DOCLING_PROVIDER_IDS?.split(',').filter(Boolean);
    const cases = labels.cases.filter((item: any) => !chosen || chosen.includes(item.id));
    expect(cases.length).toBeGreaterThan(0); expect(cases.length).toBeLessThanOrEqual(6);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(root, `provider-${timestamp}.json`);
    const records: any[] = [];
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'labrat-docling-provider-'));
      let app: Awaited<ReturnType<typeof createV1Application>> | undefined;
      let config: any;
      const writeReport = async () => fs.writeFile(reportPath, JSON.stringify({ timestamp, provider: config, labels: '../doc/qa/docling-pdf-pages-questions.json',
        material: labels.material, records, review: 'Pending semantic review against frozen expectations and actual read windows' }, null, 2));
      try {
        vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', isolated); vi.stubEnv('LABRAT_FILE_STORAGE_ROOT', storage);
        app = await createV1Application({ logger: false });
        config = app.get(V1_MODEL_PROVIDER).publicConfig();
        expect(config.configured, 'A configured real provider is required; do not substitute or switch accounts.').toBe(true);
        const owner = await researchLogin(app), documents = app.get(DocumentsService), questions = app.get(ResearchQuestionsService);
        const sources: Record<string, any> = {};
        const required = new Set(cases.map((item: any) => item.source));
        for (const name of required) {
          const filename = name === 'paper' ? process.env.LABRAT_DOCLING_QA_PAPER! : path.join(root, `fixtures/${name}.pdf`);
          const buffer = await fs.readFile(filename);
          if (name === 'paper') expect(createHash('sha256').update(buffer).digest('hex')).toBe('639b4a3cf3056ce7eb5567d160a2e416d98503eed3938831e6d39201f80d7656');
          const file = await researchUpload(app, owner.cookie, path.basename(filename), buffer);
          const registered = await documents.register(owner.auth, researchProjectId, file.id, { newDocument: true });
          let version: any;
          await vi.waitFor(async () => {
            version = await documents.version(owner.auth, researchProjectId, registered.version.id);
            expect(['ready', 'partial', 'failed']).toContain(version.status);
          }, { timeout: 160000, interval: 300 });
          expect(['ready', 'partial'], JSON.stringify(version)).toContain(version.status);
          expect(version.metadata.pageSchemaVersion).toBe(2);
          sources[String(name)] = { documentId: registered.document.id, versionId: version.id };
          console.log(`Real Docling source ${name}: ${version.metadata.pageCount} page(s).`);
        }
        for (const item of cases) {
          const started = Date.now();
          let response = await questions.create(owner.auth, researchProjectId, { requestKey: `docling-${item.id}-${timestamp}`,
            question: item.question, sourceScope: item.scope, referenceDocuments: [sources[item.source]] });
          while (['queued', 'running'].includes(response.request.status) && Date.now() - started < 145000) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            response = await questions.get(owner.auth, researchProjectId, response.request.runId) as typeof response;
          }
          const evidence = [];
          for (const reference of response.artifact?.evidence || []) evidence.push((await questions.source(owner.auth, researchProjectId, response.request.runId, reference.id)).evidence);
          records.push({ id: item.id, question: item.question, expectations: item.expect, selected: sources[item.source],
            request: response.request, artifact: response.artifact, evidence, elapsedMs: Date.now() - started });
          await writeReport();
          console.log(`${item.id}: ${response.request.status}/${response.artifact?.answer.status || response.request.failureCode}; ${response.request.usage.inputTokens || 0} input, ${response.request.usage.outputTokens || 0} output tokens.`);
          if (['qa_provider_balance', 'qa_provider_credentials', 'ai_unavailable'].includes(response.request.failureCode || '')) {
            throw new Error(`Configured provider unavailable: ${response.request.failureCode}. No further paid requests were made.`);
          }
        }
        expect(records.every((item) => item.request.status === 'completed'), 'Inspect the saved real-provider report.').toBe(true);
      } finally {
        await writeReport(); await app?.close(); vi.unstubAllEnvs();
        if (path.dirname(storage) !== os.tmpdir() || !path.basename(storage).startsWith('labrat-docling-provider-')) throw new Error('Unexpected scratch path.');
        await fs.rm(storage, { recursive: true, force: true });
      }
    });
  }, 1_200_000);
});
