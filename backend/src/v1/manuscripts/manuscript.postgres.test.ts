import { Pool } from "pg";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { describe, expect, test } from "vitest";
import { hashPassword } from "../../saas/passwords.js";
import { createV1Application } from "../bootstrap.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";

const TEST_DATABASE_URL = process.env.LABRAT_TEST_DATABASE_URL;

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers["set-cookie"];
  return String(Array.isArray(raw) ? raw[0] : raw || "").split(";")[0] || "";
}

async function login(app: NestFastifyApplication, username: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username, password: "LabRatTest123!" },
  });
  expect(response.statusCode).toBe(200);
  return cookieFrom(response);
}

async function seedArtifacts(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const timestamp = "2026-08-23T12:00:00.000Z";
  const passwordHash = hashPassword("LabRatTest123!");
  try {
    for (const [id, username, displayName] of [
      ["user_owner", "owner", "Owner"],
      ["user_reader", "reader", "Reader"],
      ["user_editor", "editor", "Editor"],
      ["user_selected", "selected", "Selected experiment member"],
    ]) {
      await pool.query(
        `insert into users (
          id, username, display_name, password_hash, is_active, is_super_admin, created_at, updated_at
        ) values ($1, $2, $3, $4, true, false, $5, $5)`,
        [id, username, displayName, passwordHash, timestamp],
      );
    }
    await pool.query(
      `insert into labs (id, name, slug, status, settings, created_at, updated_at, created_by)
       values ('lab_artifacts', 'Artifact Lab', 'artifact-lab', 'active', '{}', $1, $1, 'user_owner')`,
      [timestamp],
    );
    for (const [id, userId, role] of [
      ["membership_owner", "user_owner", "lab_owner"],
      ["membership_reader", "user_reader", "lab_member"],
      ["membership_editor", "user_editor", "lab_member"],
      ["membership_selected", "user_selected", "lab_member"],
    ]) {
      await pool.query(
        `insert into lab_memberships (
          id, lab_id, user_id, role, status, created_at, updated_at, created_by
        ) values ($1, 'lab_artifacts', $2, $3, 'active', $4, $4, 'user_owner')`,
        [id, userId, role, timestamp],
      );
    }
    await pool.query(
      `insert into projects (
        id, lab_id, name, description, status, metadata, created_at, updated_at, created_by, updated_by
      ) values (
        'project_artifacts', 'lab_artifacts', 'Artifact Project', '', 'active', '{}',
        $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into experiment_identities (
        id, lab_id, project_id, canonical_label, normalized_label, aliases,
        created_at, updated_at, created_by
      ) values (
        'experiment_artifacts', 'lab_artifacts', 'project_artifacts', 'Exp1', 'exp1', '[]',
        $1, $1, 'user_owner'
      )`,
      [timestamp],
    );
    for (const [id, userId, scope, capabilities] of [
      ["grant_reader", "user_reader", "all_experiments", ["read"]],
      ["grant_editor", "user_editor", "all_experiments", ["read", "propose"]],
      ["grant_selected", "user_selected", "selected_experiments", ["read", "propose"]],
    ] as const) {
      await pool.query(
        `insert into project_access_grants (
          id, lab_id, project_id, user_id, scope, capabilities, status,
          created_at, updated_at, created_by, updated_by
        ) values (
          $1, 'lab_artifacts', 'project_artifacts', $2, $3, $4::jsonb, 'active',
          $5, $5, 'user_owner', 'user_owner'
        )`,
        [id, userId, scope, JSON.stringify(capabilities), timestamp],
      );
    }
    await pool.query(
      `insert into experiment_access_grants (
        id, lab_id, project_id, experiment_id, user_id, capabilities, status,
        created_at, updated_at, created_by, updated_by
      ) values (
        'experiment_grant_selected', 'lab_artifacts', 'project_artifacts', 'experiment_artifacts',
        'user_selected', '["read","propose"]', 'active', $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    const chartSpec = {
      schemaVersion: "labrat.chartSpec.v3",
      origin: "analysis_result",
      status: "accepted",
      chartType: "bar",
      title: "Carbon number distribution",
      analysisThreadId: "thread_archived",
      analysisPlanRevisionId: "revision_archived",
      analysisRunId: "run_archived",
      analysisResultId: "result_archived",
      sourceSelections: [{ sourceDocumentId: "source_archived", sheetName: "Carbon", range: "A1:C2" }],
      experimentSelections: [],
      sourceRefs: [{ sourceType: "excel_cell", cell: "B2" }],
      plotly: {
        data: [{ x: ["C1", "C2"], y: [1, 2], type: "bar", meta: { labrat: { traceId: "trace_1" } } }],
        layout: { title: "Carbon number distribution" },
      },
      traceCatalog: [{ traceId: "trace_1", name: "Exp1", type: "bar", pointCount: 2 }],
      defaultChartView: { visibleTraceIds: ["trace_1"] },
      warnings: [],
      createdAt: timestamp,
      createdBy: "user_owner",
    };
    await pool.query(
      `insert into chart_specs (
        id, lab_id, project_id, analysis_result_id, title, chart_type, spec, layout, warnings,
        created_at, updated_at, created_by, updated_by
      ) values (
        'chart_artifacts', 'lab_artifacts', 'project_artifacts', null,
        'Carbon number distribution', 'bar', $1::jsonb, '{}', '[]',
        $2, $2, 'user_owner', 'user_owner'
      )`,
      [JSON.stringify(chartSpec), timestamp],
    );
  } finally {
    await pool.end();
  }
}

describe.skipIf(!TEST_DATABASE_URL)("ChartSpec and Manuscript v1 PostgreSQL integration", () => {
  test("keeps project-wide artifacts scoped while JSONB manuscript edits round trip with audit", async () => {
    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl);
      await seedArtifacts(databaseUrl);
      process.env.NODE_ENV = "test";
      process.env.LABRAT_AI_PROVIDER = "anthropic";
      process.env.DATABASE_URL = databaseUrl;
      let app: NestFastifyApplication | undefined;
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        app = await createV1Application({ logger: false });
        const readerCookie = await login(app, "reader");
        const editorCookie = await login(app, "editor");
        const selectedCookie = await login(app, "selected");

        const chartList = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_artifacts/chart-specs",
          headers: { cookie: readerCookie },
        });
        expect(chartList.statusCode).toBe(200);
        expect(chartList.json()).toMatchObject({
          items: [{ id: "chart_artifacts", spec: { detailRequired: true, plotlyTraceCount: 1 } }],
          nextCursor: null,
        });
        expect(JSON.stringify(chartList.json())).not.toContain('"x":["C1","C2"]');

        const chartDetail = await app.inject({
          method: "GET",
          url: "/api/v1/chart-specs/chart_artifacts",
          headers: { cookie: readerCookie },
        });
        expect(chartDetail.statusCode).toBe(200);
        expect(chartDetail.json()).toMatchObject({
          chartSpec: { spec: { plotly: { data: [{ x: ["C1", "C2"], y: [1, 2] }] } } },
        });

        const deniedChartList = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_artifacts/chart-specs",
          headers: { cookie: selectedCookie },
        });
        expect(deniedChartList.statusCode).toBe(403);
        const hiddenChart = await app.inject({
          method: "GET",
          url: "/api/v1/chart-specs/chart_artifacts",
          headers: { cookie: selectedCookie },
        });
        expect(hiddenChart.statusCode).toBe(404);

        const created = await app.inject({
          method: "POST",
          url: "/api/v1/projects/project_artifacts/manuscripts",
          headers: { cookie: editorCookie },
          payload: {
            title: "Group Meeting",
            blocks: [{ id: "block_1", kind: "chart", chartSpecId: "chart_artifacts" }],
            pages: [{ id: "page_1", width: 1600, height: 900 }],
            canvasState: { canvasHeight: 900 },
            references: [{ id: "reference_1", title: "Paper" }],
          },
        });
        expect(created.statusCode).toBe(201);
        const manuscript = created.json().manuscript;
        expect(manuscript).toMatchObject({
          title: "Group Meeting",
          references: [{ id: "reference_1", title: "Paper" }],
        });
        expect(manuscript).not.toHaveProperty("referencesPayload");

        const patched = await app.inject({
          method: "PATCH",
          url: `/api/v1/manuscripts/${manuscript.id}`,
          headers: { cookie: editorCookie },
          payload: {
            title: "Updated Meeting",
            blocks: [
              ...manuscript.blocks,
              { id: "block_2", kind: "text", text: "Conclusion" },
            ],
          },
        });
        expect(patched.statusCode).toBe(200);
        expect(patched.json()).toMatchObject({
          manuscript: {
            title: "Updated Meeting",
            blocks: [{ id: "block_1" }, { id: "block_2" }],
            pages: [{ id: "page_1" }],
            references: [{ id: "reference_1" }],
          },
        });

        const hiddenPatch = await app.inject({
          method: "PATCH",
          url: `/api/v1/manuscripts/${manuscript.id}`,
          headers: { cookie: selectedCookie },
          payload: { title: "Hidden update" },
        });
        expect(hiddenPatch.statusCode).toBe(404);

        const stored = await pool.query(
          "select title, blocks, references_payload from manuscripts where id = $1",
          [manuscript.id],
        );
        expect(stored.rows[0]).toMatchObject({
          title: "Updated Meeting",
          blocks: [{ id: "block_1" }, { id: "block_2" }],
          references_payload: [{ id: "reference_1", title: "Paper" }],
        });
        const audits = await pool.query(
          "select action from audit_events where target_id = $1 order by created_at",
          [manuscript.id],
        );
        expect(audits.rows.map((row) => row.action)).toEqual(["manuscript.create", "manuscript.update"]);
      } finally {
        await pool.end();
        await app?.close();
        delete process.env.DATABASE_URL;
      }
    });
  });
});
