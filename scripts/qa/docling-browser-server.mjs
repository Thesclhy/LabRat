import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createV1Application } from '../../backend/dist-v1/v1/bootstrap.js';
import { withTestSchema } from '../../backend/dist-v1/v1/testing/postgres-test-database.js';
import { seedAnalysisScenario } from '../../backend/dist-v1/v1/testing/analysis-review-fixture.js';
import { researchLogin, researchUpload } from '../../backend/dist-v1/v1/research-qa/testing/research-qa-scenario.js';
import { DocumentsRepository } from '../../backend/dist-v1/v1/research-qa/documents.repository.js';
import { V1_MODEL_PROVIDER } from '../../backend/dist-v1/v1/platform/model/model-provider.js';
import { parseDocument } from '../../backend/src/research/documentParser.js';
import { DOCUMENT_PROCESSING_VERSION } from '../../backend/src/research/documentLimits.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'artifacts/docling-pdf-pages/browser');
const require = createRequire(path.join(root, 'backend/package.json'));
const { Pool } = require('pg');
const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1') throw new Error('Use the isolated local test PostgreSQL instance.');
await fs.mkdir(output, { recursive: true });
const stop = path.join(output, `stop-${Date.now()}.json`);
await withTestSchema(databaseUrl, async ({ databaseUrl: isolated, schema }) => {
  const pool = new Pool({ connectionString: isolated });
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'labrat-docling-browser-'));
  let app;
  try {
    for (const file of (await fs.readdir(path.join(root, 'backend/migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
      await pool.query(await fs.readFile(path.join(root, 'backend/migrations', file), 'utf8'));
    }
    await seedAnalysisScenario(isolated);
    await pool.query(`update project_access_grants set capabilities='["read"]' where user_id='user_reviewer'`);
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: isolated, LABRAT_FILE_STORAGE_ROOT: storage,
      LABRAT_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '' });
    app = await createV1Application({ logger: ['error', 'warn'] });
    const owner = await researchLogin(app);
    const buffer = await fs.readFile(path.join(root, 'artifacts/docling-pdf-pages/fixtures/native.pdf'));
    const file = await researchUpload(app, owner.cookie, 'Legacy native.pdf', buffer);
    const repository = app.get(DocumentsRepository);
    const legacy = await repository.register({ projectId: 'project_analysis', labId: 'lab_analysis', fileObjectId: file.id,
      originalName: file.originalName, contentHash: file.checksumSha256, processingVersion: DOCUMENT_PROCESSING_VERSION,
      actorUserId: owner.auth.user.id, newDocument: true }, owner.auth);
    await repository.claim('project_analysis', legacy.version.id, 'browser-seed', owner.auth);
    const parsed = await parseDocument({ buffer, filename: file.originalName, mimeType: 'application/pdf' });
    await repository.finish('project_analysis', legacy.version.id, 'browser-seed', parsed, owner.auth);
    // Browser acceptance substitutes only answer generation. Reads, source artifacts,
    // permissions, Docling recognition, HTTP, original images and persistence are real.
    app.get(V1_MODEL_PROVIDER).answerResearchQuestion = async (input, options) => {
      const versionId = input.selectedContext?.referenceDocuments?.[0]?.versionId;
      if (!versionId) return { ok: true, status: 'clarification', claims: [], missingEvidence: ['Select the PDF for this browser test.'] };
      const number = Number(input.question.match(/page\s+(\d+)/i)?.[1] || 1);
      const version = await repository.findVersion('project_analysis', versionId);
      const reads = [];
      if (version.metadata.pageSchemaVersion === 2) {
        let cursor = 0;
        for (let index = 0; index < 3 && cursor !== null; index++) {
          const result = await options.toolHandlers.read_document_page({ versionId, page: number, cursor });
          reads.push(result.evidence); cursor = result.evidence.coverage.nextCursor;
        }
      } else {
        const result = await options.toolHandlers.search_project_documents({ query: '' });
        const hit = result.items.find((item) => item.target.versionId === versionId);
        reads.push((await options.toolHandlers.read_document_passage({ versionId, passageId: hit.target.passageId })).evidence);
      }
      return { ok: true, status: 'answered', claims: [{ text: 'Browser fixture: source windows are available below.',
        citations: reads.map((item) => ({ evidenceId: item.id })) }], missingEvidence: [] };
    };
    await app.listen(8789, '127.0.0.1');
    await fs.writeFile(path.join(output, 'server.json'), JSON.stringify({ pid: process.pid, schema,
      url: 'http://127.0.0.1:8789', stop, legacy: { documentId: legacy.document.id, versionId: legacy.version.id },
      model: 'deterministic browser fixture; not A14 provider evidence', startedAt: new Date().toISOString() }, null, 2));
    console.log('Docling browser server ready on 127.0.0.1:8789; model substitution is limited to browser acceptance.');
    const deadline = Date.now() + 90 * 60_000;
    while (Date.now() < deadline) {
      if (await fs.stat(stop).then(() => true, () => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    await app?.close(); await pool.end();
    if (path.dirname(storage) !== os.tmpdir() || !path.basename(storage).startsWith('labrat-docling-browser-')) throw new Error('Unsafe scratch path.');
    await fs.rm(storage, { recursive: true, force: true });
  }
});
