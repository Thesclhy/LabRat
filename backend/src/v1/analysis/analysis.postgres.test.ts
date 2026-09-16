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

async function seedAnalysisScenario(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const timestamp = "2026-08-23T12:00:00.000Z";
  const passwordHash = hashPassword("LabRatTest123!");
  try {
    for (const [id, username, displayName] of [
      ["user_owner", "owner", "Owner"],
      ["user_proposer", "proposer", "Proposer"],
      ["user_reviewer", "reviewer", "Reviewer"],
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
       values ('lab_analysis', 'Analysis Lab', 'analysis-lab', 'active', '{}', $1, $1, 'user_owner')`,
      [timestamp],
    );
    for (const [id, userId, role] of [
      ["membership_owner", "user_owner", "lab_owner"],
      ["membership_proposer", "user_proposer", "lab_member"],
      ["membership_reviewer", "user_reviewer", "lab_member"],
      ["membership_selected", "user_selected", "lab_member"],
    ]) {
      await pool.query(
        `insert into lab_memberships (
          id, lab_id, user_id, role, status, created_at, updated_at, created_by
        ) values ($1, 'lab_analysis', $2, $3, 'active', $4, $4, 'user_owner')`,
        [id, userId, role, timestamp],
      );
    }
    await pool.query(
      `insert into projects (
        id, lab_id, name, description, status, metadata, created_at, updated_at, created_by, updated_by
      ) values (
        'project_analysis', 'lab_analysis', 'Analysis Project', '', 'active', '{}',
        $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into experiment_identities (
        id, lab_id, project_id, canonical_label, normalized_label, aliases,
        created_at, updated_at, created_by
      ) values (
        'experiment_analysis', 'lab_analysis', 'project_analysis', 'Exp1', 'exp1', '[]',
        $1, $1, 'user_owner'
      )`,
      [timestamp],
    );
    for (const [id, userId, scope, capabilities] of [
      ["grant_proposer", "user_proposer", "all_experiments", ["read", "propose"]],
      ["grant_reviewer", "user_reviewer", "all_experiments", ["read", "propose", "approve"]],
      ["grant_selected", "user_selected", "selected_experiments", ["read", "propose"]],
    ] as const) {
      await pool.query(
        `insert into project_access_grants (
          id, lab_id, project_id, user_id, scope, capabilities, status,
          created_at, updated_at, created_by, updated_by
        ) values (
          $1, 'lab_analysis', 'project_analysis', $2, $3, $4::jsonb, 'active',
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
        'experiment_grant_selected', 'lab_analysis', 'project_analysis', 'experiment_analysis',
        'user_selected', '["read","propose"]', 'active', $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into source_documents (
        id, lab_id, project_id, document_type, index_version, status, metadata, summary,
        warnings, created_at, updated_at, created_by, updated_by
      ) values (
        'source_analysis', 'lab_analysis', 'project_analysis', 'excel_workbook',
        'labrat.sourceIndex.v1', 'indexed', '{"workbookName":"analysis.xlsx"}',
        '{"sheetCount":1,"regionCount":1}', '[]', $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into workbook_review_sessions (
        id, lab_id, project_id, source_document_id, schema_version, status, version,
        workbook_summary, messages, warnings, created_at, updated_at, created_by, updated_by
      ) values (
        'review_analysis', 'lab_analysis', 'project_analysis', 'source_analysis',
        'labrat.workbookReviewSession.v1', 'completed', 1,
        '{"workbookName":"analysis.xlsx"}', '[]', '[]', $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into workbook_review_regions (
        id, lab_id, project_id, workbook_review_session_id, source_document_id,
        sheet_name, range_ref, selection_method, disposition, review_status,
        version, warnings, accepted_at, accepted_by,
        created_at, updated_at, created_by, updated_by
      ) values (
        'review_region_analysis', 'lab_analysis', 'project_analysis', 'review_analysis',
        'source_analysis', 'Carbon', 'A1:C2', 'detected_region', 'active', 'accepted',
        2, '[]', $1, 'user_reviewer', $1, $1, 'user_owner', 'user_reviewer'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into region_understanding_revisions (
        id, lab_id, project_id, workbook_review_session_id, source_document_id, region_id,
        revision_number, trigger, user_feedback, summary, interpretation, source_refs,
        source_content_hash, dependency_hash, validation, provider, warnings, confidence,
        created_at, created_by
      ) values (
        'revision_analysis', 'lab_analysis', 'project_analysis', 'review_analysis',
        'source_analysis', 'review_region_analysis', 1, 'initial', '',
        '["Carbon distribution table."]', '{"semanticType":"component_distribution"}', '[]',
        'source_hash', 'dependency_hash', '{"status":"ready","blockers":[]}',
        '{"provider":"test"}', '[]', 0.95, $1, 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `update workbook_review_regions
       set current_revision_id = 'revision_analysis', accepted_revision_id = 'revision_analysis'
       where id = 'review_region_analysis'`,
    );
  } finally {
    await pool.end();
  }
}

describe.skipIf(!TEST_DATABASE_URL)("Analysis v1 PostgreSQL integration", () => {
  test("enforces full-project review boundaries and atomically accepts a plan once", async () => {
    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl);
      await seedAnalysisScenario(databaseUrl);
      process.env.NODE_ENV = "test";
      process.env.LABRAT_AI_PROVIDER = "anthropic";
      process.env.DATABASE_URL = databaseUrl;
      let app: NestFastifyApplication | undefined;
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        app = await createV1Application({ logger: false });
        const proposerCookie = await login(app, "proposer");
        const reviewerCookie = await login(app, "reviewer");
        const selectedCookie = await login(app, "selected");

        const createdThread = await app.inject({
          method: "POST",
          url: "/api/v1/projects/project_analysis/analysis-threads",
          headers: { cookie: proposerCookie },
          payload: { originalRequest: "Plot the accepted carbon distribution." },
        });
        expect(createdThread.statusCode).toBe(201);
        const thread = createdThread.json().analysisThread;
        expect(thread).toMatchObject({ projectId: "project_analysis", status: "planning", outputTarget: "chart" });

        const hiddenThread = await app.inject({
          method: "GET",
          url: `/api/v1/analysis-threads/${thread.id}`,
          headers: { cookie: selectedCookie },
        });
        expect(hiddenThread.statusCode).toBe(404);
        expect(hiddenThread.json()).toMatchObject({ error: { code: "analysis_thread_not_found" } });

        const createdRevision = await app.inject({
          method: "POST",
          url: `/api/v1/analysis-threads/${thread.id}/plan-revisions`,
          headers: { cookie: proposerCookie },
          payload: {
            plan: {
              schemaVersion: "labrat.analysisPlanRevision.v4",
              status: "awaiting_review",
              requestSummary: "Plot the accepted carbon distribution as a bar chart.",
              sourceSelections: [{
                regionUnderstandingRevisionId: "revision_analysis",
                sourceDocumentId: "source_analysis",
                sheetName: "Carbon",
                range: "A1:C2",
                label: "Accepted carbon table",
                purpose: "Read carbon labels and values.",
              }],
              experimentSelections: [],
              reviewPlan: {
                processingSteps: ["Read carbon labels and values from the accepted range."],
                missingValueHandling: "Exclude only blank plotted cells.",
                chart: {
                  title: "Carbon number distribution",
                  chartType: "bar",
                  xDescription: "Carbon number",
                  yDescription: "Distribution",
                  seriesDescription: "Accepted values",
                },
                invariants: [],
              },
              displayPlan: ["Show one bar trace from the accepted range."],
              warnings: [],
            },
          },
        });
        expect(createdRevision.statusCode).toBe(201);
        const revision = createdRevision.json().analysisPlanRevision;
        expect(revision).toMatchObject({
          analysisThreadId: thread.id,
          status: "awaiting_review",
          sourceSelections: [{ sourceSelectionId: "source_selection_1", range: "A1:C2" }],
        });

        const hiddenSelection = await app.inject({
          method: "GET",
          url: `/api/v1/analysis-plan-revisions/${revision.id}/selection`,
          headers: { cookie: selectedCookie },
        });
        expect(hiddenSelection.statusCode).toBe(404);
        expect(hiddenSelection.json()).toMatchObject({ error: { code: "analysis_plan_revision_not_found" } });

        const deniedAccept = await app.inject({
          method: "POST",
          url: `/api/v1/analysis-plan-revisions/${revision.id}/accept`,
          headers: { cookie: proposerCookie, "idempotency-key": "analysis-accept-1" },
        });
        expect(deniedAccept.statusCode).toBe(403);

        const accepted = await app.inject({
          method: "POST",
          url: `/api/v1/analysis-plan-revisions/${revision.id}/accept`,
          headers: { cookie: reviewerCookie, "idempotency-key": "analysis-accept-1" },
        });
        expect(accepted.statusCode).toBe(201);
        const acceptedBody = accepted.json();
        expect(acceptedBody).toMatchObject({
          analysisPlanRevision: { id: revision.id, status: "accepted", acceptedBy: "user_reviewer" },
          analysisRun: { status: "queued", outputTarget: "chart" },
          idempotentReplay: false,
        });
        expect(acceptedBody.analysisRun.execution).not.toHaveProperty("claimToken");
        expect(acceptedBody.analysisRun.execution).not.toHaveProperty("pythonProgram");
        expect(acceptedBody.analysisRun.execution).not.toHaveProperty("inputs");

        const replay = await app.inject({
          method: "POST",
          url: `/api/v1/analysis-plan-revisions/${revision.id}/accept`,
          headers: { cookie: reviewerCookie, "idempotency-key": "analysis-accept-1" },
        });
        expect(replay.statusCode).toBe(200);
        expect(replay.json()).toMatchObject({
          analysisRun: { id: acceptedBody.analysisRun.id },
          idempotentReplay: true,
        });

        const databaseState = await pool.query(
          `select
             (select status from analysis_plan_revisions where id = $1) as revision_status,
             (select count(*)::int from analysis_runs where accepted_plan_revision_id = $1) as run_count`,
          [revision.id],
        );
        expect(databaseState.rows[0]).toEqual({ revision_status: "accepted", run_count: 1 });
      } finally {
        await pool.end();
        await app?.close();
        delete process.env.DATABASE_URL;
      }
    });
  });
});
