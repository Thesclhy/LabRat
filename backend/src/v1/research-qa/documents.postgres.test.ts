import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { syntheticDoc, syntheticDocx, syntheticPdf } from "../../research/testing/documentFixtures.js";
import { createV1Application } from "../bootstrap.js";
import { seedAnalysisScenario } from "../testing/analysis-review-fixture.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";
import { DocumentsRepository } from "./documents.repository.js";
import { IdentityService } from "../identity/identity.service.js";

const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
const projectId = "project_analysis";
const base = `/api/v1/projects/${projectId}`;

async function login(app: NestFastifyApplication, username: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "LabRatTest123!" } });
  expect(response.statusCode).toBe(200);
  return String(response.headers["set-cookie"]).split(";")[0]!;
}

async function upload(app: NestFastifyApplication, cookie: string, name: string, buffer: Buffer, mime = "application/octet-stream") {
  const boundary = "labrat-research-fixture-boundary";
  const response = await app.inject({ method: "POST", url: `${base}/files`, headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
  expect([200, 201]).toContain(response.statusCode);
  return response.json().fileObject.id;
}

async function register(app: NestFastifyApplication, cookie: string, fileObjectId: string) {
  const response = await app.inject({ method: "POST", url: `${base}/context-documents`, headers: { cookie }, payload: { fileObjectId } });
  expect(response.statusCode, response.body).toBe(201);
  expect(response.json().version.leaseToken).toBeUndefined();
  return response.json();
}

async function processed(app: NestFastifyApplication, cookie: string, id: string) {
  let version: any;
  await vi.waitFor(async () => {
    const response = await app.inject({ method: "GET", url: `${base}/context-document-versions/${id}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    version = response.json().version;
    expect(["ready", "partial", "failed"]).toContain(version.status);
  }, { timeout: 30_000, interval: 60 });
  return version;
}

describe.skipIf(!databaseUrl)("research document PostgreSQL lifecycle", () => {
  test("real parsers, versioned persistence, View reads, archive and project isolation", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated);
      await applyTestMigrations(isolated, { only: "034_research_documents.sql" });
      await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated });
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-research-docs-"));
      let app: NestFastifyApplication | undefined;
      try {
        await pool.query("update project_access_grants set capabilities='[\"read\"]'::jsonb where user_id='user_reviewer'");
        await pool.query(`insert into projects(id, lab_id, name, created_by, updated_by, created_at, updated_at)
          values ('project_other', 'lab_analysis', 'Other project', 'user_owner', 'user_owner', now(), now())`);
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated); vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage);
        vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "");
        app = await createV1Application({ logger: false });
        const owner = await login(app, "owner"), viewer = await login(app, "reviewer"), selected = await login(app, "selected");
        const oldCounts = (await pool.query("select (select count(*) from data_snapshots) snapshots, (select count(*) from analysis_runs) runs, (select count(*) from chart_specs) charts")).rows[0];
        const registered = [];
        for (const [name, buffer] of [
          ["notes.txt", Buffer.from("Project Q\nTemperature: 80 C\n\nSecond paragraph\n\nThird paragraph")],
          ["method.doc", syntheticDoc()], ["method.docx", syntheticDocx()],
          ["method.pdf", syntheticPdf([{ text: ["Protocol RQ-001 for dry samples", "Temperature 80 C"] }, { scan: { chinese: true } }])],
        ] as const) {
          const file = await upload(app, owner, name, buffer);
          const result = await register(app, owner, file);
          const version = await processed(app, viewer, result.version.id);
          expect(["ready", "partial"], JSON.stringify(version)).toContain(version.status);
          const response = await app.inject({ method: "GET", url: `${base}/context-document-versions/${version.id}/passages?limit=1`, headers: { cookie: viewer } });
          expect(response.statusCode).toBe(200);
          expect(response.headers["cache-control"]).toContain("no-store");
          expect(response.json().items[0].text.length).toBeGreaterThan(0);
          expect(response.json().items[0].versionId).toBe(version.id);
          registered.push({ ...result, file, firstPassage: response.json().items[0] });
        }
        expect(registered[0]!.firstPassage.locator.lineStart).toBe(1);
        const first = registered[0]!;
        const replay = await register(app, owner, first.file);
        expect(replay.reused).toBe(true); expect(replay.version.id).toBe(first.version.id);
        const revisedFile = await upload(app, owner, "notes.txt", Buffer.from("Temperature: 95 C\nA later source version."));
        const revised = await register(app, owner, revisedFile);
        expect(revised.document.id).toBe(first.document.id);
        expect(revised.version.versionNumber).toBe(2);
        await processed(app, owner, revised.version.id);
        const oldRef = `${base}/context-document-versions/${first.version.id}/passages/${first.firstPassage.id}`;
        const original = await app.inject({ method: "GET", url: oldRef, headers: { cookie: viewer } });
        expect(original.json().passage.text).toContain("80 C");
        const selectedResponse = await app.inject({ method: "GET", url: oldRef, headers: { cookie: selected } });
        expect(selectedResponse.statusCode).toBe(403);
        const other = await app.inject({ method: "GET", url: oldRef.replace(projectId, "project_other"), headers: { cookie: owner } });
        expect(other.statusCode).toBe(404);
        for (const [suffix, payload] of [["context-documents", { fileObjectId: first.file }],
          [`context-document-versions/${first.version.id}/retry`, {}],
          [`context-documents/${first.document.id}/archive`, { expectedVersion: revised.document.version }]] as const) {
          const denied = await app.inject({ method: "POST", url: `${base}/${suffix}`, headers: { cookie: viewer }, payload });
          expect(denied.statusCode).toBe(403);
        }
        const image = await app.inject({ method: "GET", url: `${base}/context-document-versions/${registered[3]!.version.id}/pages/2`, headers: { cookie: viewer } });
        expect(image.statusCode).toBe(200); expect(image.headers["content-type"]).toContain("image/png");
        expect(image.headers["cache-control"]).toContain("no-store");
        const conflict = await app.inject({ method: "POST", url: `${base}/context-documents/${first.document.id}/archive`, headers: { cookie: owner }, payload: { expectedVersion: 1 } });
        expect(conflict.statusCode).toBe(409);
        const archived = await app.inject({ method: "POST", url: `${base}/context-documents/${first.document.id}/archive`, headers: { cookie: owner }, payload: { expectedVersion: revised.document.version } });
        expect(archived.statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: oldRef, headers: { cookie: viewer } })).statusCode).toBe(200);
        const list = await app.inject({ method: "GET", url: `${base}/context-documents`, headers: { cookie: viewer } });
        expect(list.json().items.some((item: any) => item.document.id === first.document.id)).toBe(false);
        expect((await pool.query("select (select count(*) from data_snapshots) snapshots, (select count(*) from analysis_runs) runs, (select count(*) from chart_specs) charts")).rows[0]).toEqual(oldCounts);
        await app.close(); app = await createV1Application({ logger: false });
        expect((await app.inject({ method: "GET", url: oldRef, headers: { cookie: viewer } })).json().passage.text).toContain("80 C");
        await pool.query("update project_access_grants set status='inactive' where user_id='user_reviewer'");
        expect((await app.inject({ method: "GET", url: oldRef, headers: { cookie: viewer } })).statusCode).toBe(404);
      } finally {
        await app?.close(); await pool.end(); vi.unstubAllEnvs(); await fs.rm(storage, { recursive: true, force: true });
      }
    });
  });

  test("duplicate registration, lease fencing, explicit interrupted recovery and revocation", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated });
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-research-lease-"));
      let app: NestFastifyApplication | undefined;
      try {
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated); vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage);
        vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "");
        app = await createV1Application({ logger: false });
        const owner = await login(app, "owner"), proposer = await login(app, "proposer");
        const file = await upload(app, owner, "parallel.txt", Buffer.from("Temperature: 80 C. Time: 30 minutes."));
        const [first, replay] = await Promise.all([register(app, owner, file), register(app, owner, file)]);
        expect(first.version.id).toBe(replay.version.id);
        await processed(app, owner, first.version.id);
        const repository = app.get(DocumentsRepository);
        const ownerAuth = await app.get(IdentityService).authenticateCookieHeader(owner);
        const proposerAuth = await app.get(IdentityService).authenticateCookieHeader(proposer);
        await expect(repository.finish(projectId, first.version.id, "wrong-token", { passages: [], status: "ready" }, ownerAuth!)).rejects.toMatchObject({ code: "document_lease_lost" });
        await pool.query("update context_document_versions set status='processing', lease_token='lost', lease_expires_at=now()-interval '1 minute' where id=$1", [first.version.id]);
        const interrupted = await app.inject({ method: "GET", url: `${base}/context-document-versions/${first.version.id}`, headers: { cookie: owner } });
        expect(interrupted.json().version.status).toBe("interrupted");
        const retry = await app.inject({ method: "POST", url: `${base}/context-document-versions/${first.version.id}/retry`, headers: { cookie: owner }, payload: {} });
        expect(retry.statusCode).toBe(200); expect((await processed(app, owner, first.version.id)).status).toBe("ready");
        expect((await pool.query("select count(*)::int count from context_document_passages where version_id=$1", [first.version.id])).rows[0].count).toBe(1);
        const revokedFile = await upload(app, proposer, "revoked.pdf", syntheticPdf([{ scan: {} }, { scan: { chinese: true } }]));
        const revoked = await register(app, proposer, revokedFile);
        await pool.query("update project_access_grants set status='inactive' where user_id='user_proposer'");
        await expect(repository.claim(projectId, first.version.id, "stale-authority", proposerAuth!)).rejects.toMatchObject({ statusCode: 404 });
        expect((await processed(app, owner, revoked.version.id)).status).toBe("failed");
        expect((await pool.query("select count(*)::int count from context_document_passages where version_id=$1", [revoked.version.id])).rows[0].count).toBe(0);
        await pool.query("insert into public_guest_accounts(user_id, project_id, created_by) values('user_selected', 'project_analysis', 'user_owner')");
        const guest = await login(app, "selected");
        const denied = await app.inject({ method: "POST", url: `${base}/context-documents`, headers: { cookie: guest }, payload: { fileObjectId: file } });
        expect(denied.statusCode).toBe(403); expect(denied.json().error.code).toBe("public_guest_read_only");
      } finally { await app?.close(); await pool.end(); vi.unstubAllEnvs(); await fs.rm(storage, { recursive: true, force: true }); }
    });
  });
});
