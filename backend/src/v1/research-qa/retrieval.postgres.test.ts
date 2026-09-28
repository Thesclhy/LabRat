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
import { seedResearchCorpus, researchProjectId as projectId } from "./testing/research-qa-scenario.js";
import { RESEARCH_QA_CASES } from "../../research/testing/researchQaCorpus.js";

const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const matches = (value: any, expected: any) => Object.entries(expected).every(([key, field]) => value?.[key] === field);
const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("exact supporting evidence Recall@8", () => {
  test("fixed source queries and explicit structured lookups return the pre-labeled minimum support", async () => {
    await withTestSchema(databaseUrl!, async ({ databaseUrl: isolated }) => {
      await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
      const pool = new Pool({ connectionString: isolated });
      const storage = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-qa-recall-"));
      let app: NestFastifyApplication | undefined;
      try {
        vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", isolated); vi.stubEnv("LABRAT_FILE_STORAGE_ROOT", storage);
        vi.stubEnv("LABRAT_AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", "");
        app = await createV1Application({ logger: false });
        const fixture = await seedResearchCorpus(app, isolated), service = app.get(ResearchEvidenceService);
        const records: any[] = [];
        const supported = RESEARCH_QA_CASES.filter((item) => !item.control && !item.retrievalReads.some((read: any) => read.kind === "workbook"));
        // Raw Excel cases are now review-boundary controls, tested in evidence.postgres.test.ts.
        // Do not compare this narrower denominator with the archived pre-unification Recall@8 report.
        for (const question of supported) {
          const session = service.createSession(fixture.auth, projectId, new AbortController().signal);
          const retrieved: any[] = [];
          for (const read of question.retrievalReads as any[]) {
            if (read.kind === "context") retrieved.push((await session.invoke("get_project_context", {})).evidence);
            else if (read.kind === "experiment") {
              const found = await session.invoke("find_experiments", { query: read.query });
              expect(found.status).toBe("matched"); expect(found.items).toHaveLength(1);
              const target = found.items[0];
              let result = await session.invoke("read_experiment_evidence", { experimentId: target.id, snapshotId: target.snapshotId });
              if (read.seriesKey) {
                const series = result.evidence.data.series.find((item: any) => item.seriesKey === read.seriesKey);
                expect(series).toBeTruthy();
                result = await session.invoke("read_experiment_evidence", { experimentId: target.id, snapshotId: target.snapshotId,
                  seriesKey: read.seriesKey, pointOffset: read.lastPoint ? series.pointCount - 1 : 0 });
              }
              retrieved.push(result.evidence);
            } else if (read.kind === "workbook") {
              const name = read.source === "workbook_xls" ? "research.xls" : "research.xlsx";
              const found = await session.invoke("search_project_documents", { query: name });
              const target = found.items.find((item: any) => item.label.split(" / ")[0] === name)?.target;
              expect(target, `${question.id}: discover the exact workbook`).toBeTruthy();
              retrieved.push((await session.invoke("read_workbook_source", { sourceDocumentId: target.sourceDocumentId, sheetName: read.sheetName, range: read.range })).evidence);
            } else if (read.kind === "region") {
              const found = await session.invoke("search_project_documents", { query: read.query });
              const target = found.items.find((item: any) => item.kind === "confirmed_region" && item.target.range === read.range)?.target;
              expect(target).toBeTruthy();
              retrieved.push((await session.invoke("read_confirmed_region_evidence", { regionId: target.regionId, revisionId: target.revisionId, range: read.range })).evidence);
            }
          }
          const slots = 8 - retrieved.length;
          const search = question.query ? await session.invoke("search_project_documents", { query: question.query }) : { items: [] };
          const ranked = search.items.slice(0, slots);
          // Every search hit consumes a slot; irrelevant raw/catalog hits cannot be silently skipped.
          for (const hit of ranked) if (hit.kind === "document") retrieved.push((await session.invoke("read_document_passage", {
            versionId: hit.target.versionId, passageId: hit.target.passageId })).evidence);
          const support = [];
          for (const label of question.minimumSupport as any[]) {
            let found = false, expectedPassageId = null;
            if (label.kind === "document") {
              const passages = (await pool.query("select id,text,locator from context_document_passages where project_id=$1 and version_id=$2", [projectId, fixture.sources[label.source].version.id])).rows;
              const target = passages.filter((item) => normalized(item.text).includes(normalized(label.text)) && matches(item.locator, label.locator));
              expect(target, `${question.id}: corpus must contain one pre-labeled supporting passage: ${label.text}`).toHaveLength(1);
              expectedPassageId = target[0].id;
              found = retrieved.some((item) => item.kind === "document_passage" && item.version.versionId === fixture.sources[label.source].version.id && item.coverage.passageId === expectedPassageId);
            } else if (label.kind === "field") {
              const { kind: _kind, ...expected } = label;
              found = retrieved.some((item) => item.kind === "experiment_snapshot" && item.data.fields.some((value: any) => matches(value, expected)));
            } else if (label.kind === "cell") {
              const { kind: _kind, source, sheet, ...expected } = label;
              found = retrieved.some((item) => item.kind === "workbook_raw" && item.version.sourceDocumentId === fixture.sources[source].id
                && item.locator.sheet === sheet && item.data.cells.some((value: any) => matches(value, expected)));
            } else if (label.kind === "context") {
              found = retrieved.some((item) => item.kind === "project_context" && item.data.projectProfile[label.path] === label.value);
            } else if (label.kind === "region") {
              found = retrieved.some((item) => item.kind === "confirmed_region" && item.data.sheetName === label.sheetName
                && item.data.range === label.range && item.data.interpretation.semanticType === label.semanticType);
            } else if (label.kind === "point") {
              found = retrieved.some((item) => item.kind === "experiment_snapshot" && item.data.seriesWindow?.seriesKey === label.seriesKey
                && item.locator.pointOffset === label.index && item.data.seriesWindow.xField.unit === label.xUnit && item.data.seriesWindow.yField.unit === label.yUnit
                && matches(item.data.seriesWindow.points[0], { x: label.x, y: label.y }));
            }
            support.push({ ...label, expectedPassageId, found });
          }
          records.push({ id: question.id, split: question.split, question: question.question, fixedQuery: question.query,
            structuredLookups: question.retrievalReads, searchSlots: slots, searchHits: ranked, support,
            recallAt8: support.filter((item) => item.found).length / support.length });
        }
        const recallAt8 = records.reduce((sum, record) => sum + record.recallAt8, 0) / records.length;
        const missed = records.flatMap((record) => record.support.filter((item: any) => !item.found).map((support: any) => ({ questionId: record.id, support })));
        if (process.env.LABRAT_WRITE_RESEARCH_QA_REPORT === "1") await fs.writeFile(path.resolve("..", "doc", "qa", "research-qa-retrieval.json"), JSON.stringify({
          schemaVersion: "labrat.researchQaRetrieval.v1", generatedAt: new Date().toISOString(), material: "synthetic only", k: 8,
          protocol: "Fixed predeclared tool queries; explicit structured lookups consume one slot each, then ranked search hits fill the remaining slots. No neighbor expansion or source-level credit. This tests retrieval, not model query choice.",
          questionCount: records.length, recallAt8, missed, records }, null, 2) + "\n");
        expect(records).toHaveLength(supported.length);
        expect(records.length).toBeGreaterThanOrEqual(10);
        expect(recallAt8, JSON.stringify(missed)).toBeGreaterThanOrEqual(0.9);
      } finally { await app?.close(); await pool.end(); vi.unstubAllEnvs(); await fs.rm(storage, { recursive: true, force: true }); }
    });
  }, 120_000);
});
