import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createV1Application } from "../bootstrap.js";
import { seedAnalysisScenario } from "../testing/analysis-review-fixture.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";
import { ResearchEvidenceService } from "./research-evidence.service.js";
import { seedResearchCorpus, researchLogin, researchProjectId as projectId } from "./testing/research-qa-scenario.js";
import { RESEARCH_QA_CASES } from "../../research/testing/researchQaCorpus.js";
import { validateCitedAnswer } from "../../research/citedAnswer.js";

const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("research evidence PostgreSQL", () => {
  test("real format corpus, scoped retrieval, raw/accepted evidence, bounded pages and revocation", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated });
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-qa-evidence-"));
      let app: NestFastifyApplication | undefined;
      try {
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated); vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage);
        vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "");
        app = await createV1Application({ logger: false });
        const seeded = await seedResearchCorpus(app, isolated);
        const viewer = await researchLogin(app, "reviewer"), selected = await researchLogin(app, "selected");
        const service = app.get(ResearchEvidenceService);
        const session = () => service.createSession(viewer.auth, projectId, new AbortController().signal);
        const invoke = session().invoke;
        const context = await invoke("get_project_context", {});
        expect(context.evidence.data.projectProfile.researchGoal).toBe("Study catalyst stability");
        await pool.query(`update projects set metadata='{}' where id=$1`, [projectId]);
        expect(context.evidence.data.projectProfile.researchGoal).toBe("Study catalyst stability");

        const search = await invoke("search_project_documents", { query: "RQ-DOSE Catalyst" });
        const hit = search.items.find((item: any) => item.target.versionId === seeded.sources.legacy.version.id);
        expect(hit).toBeTruthy();
        const passage = await invoke("read_document_passage", { versionId: hit.target.versionId, passageId: hit.target.passageId });
        expect(passage.evidence.version.contentHash).toBe(seeded.sources.legacy.file.checksumSha256);
        expect(passage.neighbors.length).toBeGreaterThan(0);
        const contextual = session();
        const scopeHits = await contextual.invoke("search_project_documents", { query: "RQ-001 dry samples" });
        const scopeHit = scopeHits.items.find((item: any) => item.target.versionId === seeded.sources.scope.version.id && item.target.snippet.startsWith("Protocol"));
        const scope = await contextual.invoke("read_document_passage", { versionId: scopeHit.target.versionId, passageId: scopeHit.target.passageId });
        const excluded = scope.contextEvidence.find((item: any) => item.data.text.startsWith("Wet samples"));
        expect(excluded).toBeTruthy(); expect(excluded.locator.lineStart).toBe(5);
        expect(contextual.trace[0]).toMatchObject({ phase:'discovery', input:{query:'RQ-001 dry samples'}, evidenceIds:[], status:'ok' });
        expect(contextual.trace[1]).toMatchObject({ phase:'read',input:{versionId:scopeHit.target.versionId,passageId:scopeHit.target.passageId},
          evidenceIds:[scope.evidence.id,...scope.contextEvidence.map((item:any)=>item.id)] });
        const before=contextual.registry.values().map((item:any)=>item.id);
        await expect(contextual.invoke('read_document_passage',{versionId:scopeHit.target.versionId,passageId:'not-real'})).rejects.toMatchObject({statusCode:404});
        expect(contextual.registry.values().map((item:any)=>item.id)).toEqual(before);
        expect(contextual.trace.at(-1)).toMatchObject({phase:'read',status:'evidence_not_found'});
        expect(contextual.trace.at(-1)?.evidenceIds).toBeUndefined();
        expect(excluded.version.versionId).toBe(scope.evidence.version.versionId);
        expect([scope.evidence, ...scope.contextEvidence].reduce((size: number, item: any) => size + item.data.text.length, 0)).toBeLessThanOrEqual(4000);
        expect(validateCitedAnswer({ status: "answered", claims: [{ text: "Wet samples are excluded.", numericBindings: [],
          citations: [{ evidenceId: excluded.id, quote: "Wet samples are excluded" }] }], missingEvidence: [] }, contextual.registry.values()).valid).toBe(true);
        await expect(session().invoke("read_document_passage", { versionId: hit.target.versionId, passageId: hit.target.passageId })).rejects.toMatchObject({ statusCode: 404 });
        expect((await invoke("search_project_documents", { query: "zzznomatchzzz" })).items).toHaveLength(0);
        expect((await invoke("search_project_documents", { query: "Co" })).items).toHaveLength(0);
        const acceptedFields = await invoke("search_project_documents", { query: "yield_fraction" });
        expect(acceptedFields.items).toHaveLength(2);
        expect(acceptedFields.items.every((item: any) => item.kind === "experiment_field" && item.target.fieldOffset === 1)).toBe(true);
        expect(acceptedFields.coverage.readForCitation).toBe(false);
        const browse = await invoke("search_project_documents", { query: "" });
        expect(browse.items).toHaveLength(8); expect(browse.nextCursor).toBe(8); expect(browse.coverage.complete).toBe(false);
        const next = await invoke("search_project_documents", { query: "", cursor: browse.nextCursor });
        expect(JSON.stringify(next.items)).not.toBe(JSON.stringify(browse.items));

        for (const key of ["workbook", "workbook_xls"]) {
          await expect(invoke("read_workbook_source", { sourceDocumentId: seeded.sources[key].id, sheetName: "Measurements", range: "A1:G2" }))
            .rejects.toMatchObject({ code: "qa_workbook_review_required" });
        }
        expect((await invoke("search_project_documents", { query: "research.xlsx" })).items).toEqual([]);

        const dataSession = session();
        const noMatch = await dataSession.invoke("find_experiments", { query: "Exp404" });
        expect(noMatch).toMatchObject({ status: "no_match", items: [] });
        const ambiguous = await dataSession.invoke("find_experiments", { query: "Batch-A" });
        expect(ambiguous.status).toBe("ambiguous"); expect(ambiguous.items).toHaveLength(2);
        await expect(dataSession.invoke("read_experiment_evidence", { experimentId: "experiment_17", snapshotId: "snapshot_experiment_17" })).rejects.toMatchObject({ statusCode: 404 });
        const matched = await dataSession.invoke("find_experiments", { query: "Exp17" });
        expect(matched.items).toHaveLength(1);
        const accepted = await dataSession.invoke("read_experiment_evidence", { experimentId: "experiment_17", snapshotId: "snapshot_experiment_17" });
        expect(accepted.evidence.data.fields[0].value).toBe(82);
        expect(accepted.evidence.data.fields[1].numericScale).toBe("fraction");
        expect(accepted.evidence.data.fields[2].numericScale).toBe("percent_points");
        expect(accepted.evidence.data.fields[3]).toMatchObject({ value: null, missingReason: "source_blank" });
        expect(accepted.evidence.data.fields).toHaveLength(20);
        expect(accepted.evidence.coverage.nextFieldOffset).toBe(20);
        const tail = await dataSession.invoke("read_experiment_evidence", { experimentId: "experiment_17", snapshotId: "snapshot_experiment_17", fieldOffset: 20, seriesKey: "temperature_trace", pointOffset: 120 });
        expect(tail.evidence.data.seriesWindow.points).toEqual([{ x: 120, y: 82, sourceRefs: [] }]);
        expect(tail.evidence.coverage.nextPointOffset).toBeNull();
        expect(tail.evidence.coverage.nextFieldOffset).toBeNull();
        const region = await dataSession.invoke("read_confirmed_region_evidence", { regionId: "review_region_analysis", revisionId: "revision_analysis", range: "A1:C2" });
        expect(region.evidence.kind).toBe("confirmed_region"); expect(region.evidence.data.interpretation.semanticType).toBe("component_distribution");
        await expect(dataSession.invoke("read_confirmed_region_evidence", { regionId: "review_region_analysis", revisionId: "revision_analysis", range: "A1:D2" })).rejects.toMatchObject({ statusCode: 404 });
        await pool.query(`update workbook_review_regions set disposition='ignored' where id='review_region_analysis'`);
        await expect(dataSession.invoke("read_confirmed_region_evidence", { regionId: "review_region_analysis", revisionId: "revision_analysis", range: "A1:C2" })).rejects.toMatchObject({ statusCode: 404 });

        expect(RESEARCH_QA_CASES).toHaveLength(30);
        for (const group of new Set(RESEARCH_QA_CASES.map((item) => item.group))) expect(RESEARCH_QA_CASES.filter((item) => item.group === group)).toHaveLength(6);

        await expect(service.createSession(selected.auth, projectId, new AbortController().signal).invoke("get_project_context", {})).rejects.toMatchObject({ statusCode: 403 });
        const counts = (await pool.query("select (select count(*) from analysis_runs)::int runs,(select count(*) from chart_specs)::int charts,(select count(*) from data_snapshots)::int snapshots")).rows[0];
        expect(counts).toEqual({ runs: 0, charts: 0, snapshots: 2 });
        await pool.query(`update project_access_grants set status='inactive' where user_id='user_reviewer'`);
        await expect(dataSession.invoke("get_project_context", {})).rejects.toMatchObject({ statusCode: 404 });
      } finally { await app?.close(); await pool.end(); vi.unstubAllEnvs(); await fs.rm(storage, { recursive: true, force: true }); }
    });
  });
});
