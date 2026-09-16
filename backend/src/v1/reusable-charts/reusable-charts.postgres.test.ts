import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";
import { PostgresSaasStore } from "../../saas/postgresStore.js";
import { createV1Application } from "../bootstrap.js";
import { V1_ANALYSIS_EXECUTOR } from "../platform/analysis/analysis-executor.js";
import { V1_MODEL_PROVIDER } from "../platform/model/model-provider.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";

const TEST_DATABASE_URL = process.env.LABRAT_TEST_DATABASE_URL;
const PASSWORD = "LabRatTemplateTest123!";

async function seedTemplateScenario(databaseUrl: string) {
  const store = new PostgresSaasStore({ databaseUrl }) as any;
  await store.initialize();
  try {
    const lab = await store.createLab({ name: "Template Lab", slug: "template-lab", createdBy: null });
    const users: Record<string, any> = {};
    for (const username of ["owner", "reader", "proposer", "selected"]) {
      const created = await store.createUser({
        username, displayName: username, temporaryPassword: PASSWORD, labId: lab.id,
        role: username === "owner" ? "lab_owner" : "lab_member",
      });
      users[username] = created.user;
    }
    const project = await store.createProject({ labId: lab.id, name: "Templates", createdBy: users.owner.id });
    const otherProject = await store.createProject({ labId: lab.id, name: "Other", createdBy: users.owner.id });
    for (const username of ["reader", "proposer", "selected"]) {
      await store.query(
        `insert into project_access_grants
         (id, lab_id, project_id, user_id, scope, capabilities, created_by)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [`grant_${username}`, lab.id, project.id, users[username].id,
          username === "selected" ? "selected_experiments" : "all_experiments",
          JSON.stringify(username === "reader" ? ["read"] : ["read", "propose"]), users.owner.id],
      );
    }
    const records = [0, 1].map((index) => ({
      experimentId: `experiment_${index + 1}`,
      label: `Exp${index + 1}`,
      fields: [{
        columnId: "yield_pct", fieldKey: "yield_pct", displayName: "Yield",
        valueType: "number", unit: "%", numericScale: "fraction", value: 0.8 + index * 0.1,
        sourceRefs: [{ sourceDocumentId: "source_fixture", sheet: "Data", cell: `B${index + 2}` }],
      }],
      series: [], sourceRefs: [], warnings: [],
    }));
    await store.query(
      `insert into data_plans
       (id, lab_id, project_id, dependency_hash, accepted_at, accepted_by, created_by)
       values ('plan_fixture', $1, $2, 'dependency_fixture', now(), $3, $3)`,
      [lab.id, project.id, users.owner.id],
    );
    await store.query(
      `insert into data_snapshots
       (id, lab_id, project_id, data_plan_id, content_hash, dependency_hash,
        experiment_records, accepted_at, accepted_by, created_by)
       values ('snapshot_fixture', $1, $2, 'plan_fixture', 'content_fixture',
        'dependency_fixture', $3::jsonb, now(), $4, $4)`,
      [lab.id, project.id, JSON.stringify(records), users.owner.id],
    );
    for (const [index, record] of records.entries()) {
      await store.query(
        `insert into experiment_identities
         (id, lab_id, project_id, canonical_label, normalized_label, created_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [record.experimentId, lab.id, project.id, record.label, record.label.toLowerCase(), users.owner.id],
      );
      await store.query(
        `insert into experiment_snapshot_heads
         (id, lab_id, project_id, experiment_id, data_snapshot_id, record_index, updated_by)
         values ($1, $2, $3, $4, 'snapshot_fixture', $5, $6)`,
        [`head_${index}`, lab.id, project.id, record.experimentId, index, users.owner.id],
      );
    }
    await store.query(
      `insert into experiment_access_grants
       (id, lab_id, project_id, experiment_id, user_id, capabilities, created_by)
       values ('grant_selected_experiment', $1, $2, 'experiment_1', $3, '["read","propose"]', $4)`,
      [lab.id, project.id, users.selected.id, users.owner.id],
    );
    const spec = {
      schemaVersion: "labrat.chartSpec.v3", origin: "analysis_result", status: "accepted",
      chartType: "bar", title: "Yield comparison", sourceSelections: [],
      experimentSelections: records.map((record, recordIndex) => ({
        experimentId: record.experimentId, columnIndexes: [0], includeSeries: false,
        baseHeadRef: { dataSnapshotId: "snapshot_fixture", recordIndex },
      })),
    };
    await store.query(
      `insert into chart_specs
       (id, lab_id, project_id, title, chart_type, spec, created_by, created_at, updated_at)
       values ('chart_fixture', $1, $2, 'Yield comparison', 'bar', $3::jsonb, $4, now(), now())`,
      [lab.id, project.id, JSON.stringify(spec), users.owner.id],
    );
    return { lab, project, otherProject, users };
  } finally {
    await store.pool.end();
  }
}

describe.skipIf(!TEST_DATABASE_URL)("Reusable charts v1 PostgreSQL integration", () => {
  test("owns all twelve operations and preserves review, lineage, permissions, and idempotency", async () => {
    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl);
      const { project, otherProject } = await seedTemplateScenario(databaseUrl);
      const originalEnv = { NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL,
        LABRAT_AI_PROVIDER: process.env.LABRAT_AI_PROVIDER };
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = databaseUrl;
      process.env.LABRAT_AI_PROVIDER = "anthropic";
      let app: NestFastifyApplication | undefined;
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        app = await createV1Application({ logger: false });
        const provider = app.get(V1_MODEL_PROVIDER);
        const executor = app.get(V1_ANALYSIS_EXECUTOR);
        const modelCalls = Object.keys(provider)
          .filter((name) => name !== "publicConfig" && typeof provider[name] === "function")
          .map((name) => vi.spyOn(provider, name).mockImplementation(() => {
            throw new Error("Template execution must not call a model.");
          }));
        const pythonCall = vi.spyOn(executor, "executeAcceptedRun").mockImplementation(() => {
          throw new Error("Template execution must not call Python.");
        });
        const cookies: Record<string, string> = {};
        for (const username of ["owner", "reader", "proposer", "selected"]) {
          const response = await app.inject({
            method: "POST", url: "/api/v1/auth/login", payload: { username, password: PASSWORD },
          });
          expect(response.statusCode).toBe(200);
          const raw = response.headers["set-cookie"];
          cookies[username] = String(Array.isArray(raw) ? raw[0] : raw).split(";")[0]!;
        }
        const request = async (
          username: string, method: "GET" | "POST", url: string,
          payload?: Record<string, unknown>, status = 200, key?: string,
        ) => {
          const response = await app!.inject({
            method, url, ...(payload ? { payload } : {}),
            headers: { cookie: cookies[username], ...(key ? { "idempotency-key": key } : {}) },
          });
          expect(response.statusCode, response.body).toBe(status);
          return response.json();
        };
        const stylePath = `/api/v1/projects/${project.id}/chart-style-profiles`;
        const templatePath = `/api/v1/projects/${project.id}/reusable-chart-templates`;
        await request("reader", "POST", stylePath, { name: "Denied", style: {} }, 403);
        await request("selected", "GET", stylePath, undefined, 403);
        const firstStyle = await request("proposer", "POST", stylePath, {
          name: "Blue", style: { palette: { colors: ["#123456", "#D97935"] } },
        }, 201);
        const styleId = firstStyle.chartStyleProfile.id;
        expect(firstStyle.versions[0].geometry.preferredPlotAreaWidthRatio).toBe(0.76);
        expect((await request("reader", "GET", stylePath)).items).toHaveLength(1);
        const styleDetail = `/api/v1/chart-style-profiles/${styleId}`;
        expect((await request("reader", "GET", styleDetail)).versions).toHaveLength(1);
        const secondStyle = await request("proposer", "POST", `${styleDetail}/versions`, {
          style: { palette: { colors: ["#654321", "#D97935"] } },
        }, 201);
        expect(secondStyle.versions.map((version: any) => version.version)).toEqual([2, 1]);
        const eligibility = await request("reader", "GET", "/api/v1/chart-specs/chart_fixture/template-eligibility");
        expect(eligibility).toMatchObject({ status: "eligible", inputSlots: [{
          identityContract: { preferredColumnId: "yield_pct", numericScale: "fraction" },
        }] });
        await request("proposer", "POST", `/api/v1/projects/${otherProject.id}/reusable-chart-templates`,
          { name: "Hidden", sourceChartSpecId: "chart_fixture" }, 404);
        await request("owner", "POST", `/api/v1/projects/${otherProject.id}/reusable-chart-templates`,
          { name: "Foreign source", sourceChartSpecId: "chart_fixture" }, 404);
        const firstTemplate = await request("proposer", "POST", templatePath, {
          name: "Yield comparison", sourceChartSpecId: "chart_fixture",
          chartStyleProfileVersionId: firstStyle.versions[0].id,
        }, 201);
        const templateId = firstTemplate.reusableChartTemplate.id;
        const templateDetail = `/api/v1/reusable-chart-templates/${templateId}`;
        expect((await request("reader", "GET", templatePath)).items).toHaveLength(1);
        expect((await request("reader", "GET", templateDetail)).versions).toHaveLength(1);
        await request("selected", "GET", templateDetail, undefined, 404);
        await request("selected", "GET", styleDetail, undefined, 404);
        await request("selected", "GET", "/api/v1/chart-specs/chart_fixture/template-eligibility", undefined, 404);
        const secondTemplate = await request("proposer", "POST", `${templateDetail}/versions`, {
          chartStyleProfileVersionId: secondStyle.versions[0].id,
        }, 201);
        expect(secondTemplate.versions.map((version: any) => version.version)).toEqual([2, 1]);
        const versionId = secondTemplate.versions[0].id;
        const applicationPath = `/api/v1/reusable-chart-template-versions/${versionId}/applications`;
        const inputs = { experimentIds: ["experiment_1", "experiment_2"] };
        await request("reader", "POST", applicationPath, inputs, 403, "denied");
        await request("selected", "POST", applicationPath, inputs, 404, "hidden");
        await request("proposer", "POST", applicationPath, inputs, 400);
        await request("proposer", "POST", applicationPath, {
          ...inputs, bindings: [{ slotId: "value", unexpectedColumn: "yield_pct" }],
        }, 400, "invalid-binding");
        const applied = await request("proposer", "POST", applicationPath, inputs, 201, "apply-once");
        expect(applied).toMatchObject({
          replayed: false, compatibility: { status: "ready" },
          analysisThread: { inputMode: "experiment_browser" }, analysisRun: { status: "queued" },
        });
        const replay = await request("proposer", "POST", applicationPath, inputs, 200, "apply-once");
        expect(replay.analysisRun.id).toBe(applied.analysisRun.id);
        expect(replay.replayed).toBe(true);
        await request("proposer", "POST", applicationPath,
          { experimentIds: ["experiment_1"] }, 409, "apply-once");
        const runId = applied.analysisRun.id;
        const executed = await request("proposer", "POST", `/api/v1/analysis-runs/${runId}/execute`,
          { executionStrategy: "chart_template_v1" }, 201);
        expect(executed.analysisRun.status, JSON.stringify(executed)).toBe("awaiting_result_review");
        const preview = await request("reader", "GET", `/api/v1/analysis-runs/${runId}/result-preview`);
        expect(preview.resolvedGeometry.schemaVersion).toBe("labrat.resolvedChartGeometry.v1");
        expect(preview.plotly.data[0].y).toEqual([80, 90]);
        expect((await pool.query("select count(*)::int as count from chart_specs")).rows[0].count).toBe(1);
        const acceptPath = `/api/v1/analysis-runs/${runId}/accept-and-create-chart`;
        const acceptBody = {
          analysisResultId: executed.analysisResult.id,
          defaultVisibleTraceIds: preview.plotly.data.map((trace: any) => trace.traceId),
        };
        await request("proposer", "POST", acceptPath, acceptBody, 403, "accept-once");
        const accepted = await request("owner", "POST", acceptPath, acceptBody, 201, "accept-once");
        expect(accepted.chartSpec.spec.templateLineage.reusableChartTemplateVersionId).toBe(versionId);
        expect(accepted.chartSpec.spec.resolvedGeometry).toEqual(preview.resolvedGeometry);
        const persisted = await request("reader", "GET", `/api/v1/chart-specs/${accepted.chartSpec.id}`);
        expect(persisted.chartSpec.spec.templateLineage).toEqual(accepted.chartSpec.spec.templateLineage);
        const summary = await request("reader", "GET", `/api/v1/projects/${project.id}`);
        expect(summary.project.workflowSummary).toEqual({
          publishedExperimentCount: 2, chartSpecCount: 2,
          chartStyleProfileCount: 1, reusableChartTemplateCount: 1,
        });
        const shell = await request("selected", "GET", `/api/v1/projects/${project.id}`);
        expect(shell.project).not.toHaveProperty("workflowSummary");
        const staleApplication = await request("proposer", "POST", applicationPath, inputs, 201, "stale-inputs");
        const staleRunId = staleApplication.analysisRun.id;
        const staleExecuted = await request("proposer", "POST",
          `/api/v1/analysis-runs/${staleRunId}/execute`, {}, 201);
        await pool.query(`
          insert into data_snapshots
          (id, lab_id, project_id, data_plan_id, content_hash, dependency_hash,
           experiment_records, accepted_at, accepted_by, created_by)
          select 'snapshot_new', lab_id, project_id, data_plan_id, 'content_new', dependency_hash,
            experiment_records, accepted_at, accepted_by, created_by
          from data_snapshots where id = 'snapshot_fixture'
        `);
        await pool.query("update experiment_snapshot_heads set data_snapshot_id = 'snapshot_new' where experiment_id = 'experiment_1'");
        const stale = await request("owner", "POST",
          `/api/v1/analysis-runs/${staleRunId}/accept-and-create-chart`, {
            ...acceptBody, analysisResultId: staleExecuted.analysisResult.id,
          }, 409, "stale-accept");
        expect(stale.error.code).toBe("chart_template_inputs_stale");
        expect((await pool.query("select count(*)::int as count from chart_specs")).rows[0].count).toBe(2);
        await request("proposer", "POST", `${templateDetail}/archive`, {});
        expect((await request("reader", "GET", templatePath)).items).toHaveLength(0);
        expect((await request("reader", "GET", `${templatePath}?includeArchived=true`)).items).toHaveLength(1);
        await request("proposer", "POST", `${templateDetail}/versions`, {}, 409);
        await request("proposer", "POST", `${styleDetail}/archive`, {});
        expect((await request("reader", "GET", stylePath)).items).toHaveLength(0);
        expect((await request("reader", "GET", `${stylePath}?includeArchived=true`)).items).toHaveLength(1);
        expect((await request("reader", "GET", styleDetail)).versions).toHaveLength(2);
        for (const modelCall of modelCalls) expect(modelCall).not.toHaveBeenCalled();
        expect(pythonCall).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
        await app?.close();
        await pool.end();
        for (const [name, value] of Object.entries(originalEnv)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    });
  });
});
