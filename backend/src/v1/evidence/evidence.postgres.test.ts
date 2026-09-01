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

async function seedEvidence(databaseUrl: string) {
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
       values ('lab_evidence', 'Evidence Lab', 'evidence-lab', 'active', '{}', $1, $1, 'user_owner')`,
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
        ) values ($1, 'lab_evidence', $2, $3, 'active', $4, $4, 'user_owner')`,
        [id, userId, role, timestamp],
      );
    }
    await pool.query(
      `insert into projects (
        id, lab_id, name, description, status, metadata, created_at, updated_at, created_by, updated_by
      ) values (
        'project_evidence', 'lab_evidence', 'Evidence Project', '', 'active', '{}',
        $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into experiment_identities (
        id, lab_id, project_id, canonical_label, normalized_label, aliases,
        created_at, updated_at, created_by
      ) values (
        'experiment_evidence', 'lab_evidence', 'project_evidence', 'Exp1', 'exp1', '[]',
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
          $1, 'lab_evidence', 'project_evidence', $2, $3, $4::jsonb, 'active',
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
        'experiment_grant_selected', 'lab_evidence', 'project_evidence', 'experiment_evidence',
        'user_selected', '["read","propose"]', 'active', $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into file_objects (
        id, lab_id, project_id, original_name, mime_type, extension, size_bytes,
        checksum_sha256, storage_provider, storage_key, metadata, created_at, created_by
      ) values (
        'file_evidence', 'lab_evidence', 'project_evidence', 'evidence.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 128,
        repeat('a', 64), 'local', 'project_evidence/file_evidence.xlsx', '{}', $1, 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into import_runs (
        id, lab_id, project_id, file_object_id, status, scan_result, normalize_preview,
        review_decisions, warnings, error, created_at, updated_at, created_by, updated_by
      ) values (
        'import_evidence', 'lab_evidence', 'project_evidence', 'file_evidence', 'source_review_ready',
        '{}', null, '{}', '[]', null, $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into source_documents (
        id, lab_id, project_id, file_object_id, import_run_id, document_type, index_version,
        status, metadata, summary, warnings, created_at, updated_at, created_by, updated_by
      ) values (
        'source_evidence', 'lab_evidence', 'project_evidence', 'file_evidence', 'import_evidence',
        'excel_workbook', 'labrat.sourceIndex.v1', 'indexed', $1::jsonb,
        '{"sheetCount":1,"regionCount":1}', '[]', $2, $2, 'user_owner', 'user_owner'
      )`,
      [JSON.stringify({
        workbookName: "evidence.xlsx",
        sheets: [{ name: "Sheet1", usedRange: "A1:B2", rowCount: 2, columnCount: 2 }],
      }), timestamp],
    );
    await pool.query(
      `insert into source_regions (
        id, lab_id, project_id, source_document_id, import_run_id, region_key, kind,
        label, sheet_name, range_ref, start_row, end_row, start_col, end_col, confidence,
        signals, candidate_fields, source_refs, warnings, status,
        created_at, updated_at, created_by, updated_by
      ) values (
        'source_region_evidence', 'lab_evidence', 'project_evidence', 'source_evidence',
        'import_evidence', 'sheet1_table', 'experiment_table', 'Experiments', 'Sheet1',
        'A1:B2', 0, 1, 0, 1, 0.95, '{}', '[]', '[]', '[]', 'active',
        $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into source_index_blobs (
        id, lab_id, project_id, source_document_id, blob_kind, storage_provider,
        storage_key, payload, checksum_sha256, created_at, created_by
      ) values (
        'blob_evidence', 'lab_evidence', 'project_evidence', 'source_evidence',
        'excel_cell_grid_v1', 'database', null, $1::jsonb, repeat('b', 64), $2, 'user_owner'
      )`,
      [JSON.stringify({
        sheets: [{
          name: "Sheet1",
          cellGrid: {
            range: "A1:B2",
            rowCount: 2,
            columnCount: 2,
            cells: [
              { row: 0, col: 0, address: "A1", rawValue: "Experiment", formattedValue: "Experiment", type: "string" },
              { row: 0, col: 1, address: "B1", rawValue: "Temperature", formattedValue: "Temperature", type: "string" },
              { row: 1, col: 0, address: "A2", rawValue: "Exp1", formattedValue: "Exp1", type: "string" },
              { row: 1, col: 1, address: "B2", rawValue: 250, formattedValue: "250", type: "number" },
            ],
          },
        }],
      }), timestamp],
    );
    await pool.query(
      `insert into workbook_review_sessions (
        id, lab_id, project_id, source_document_id, schema_version, status, version,
        workbook_summary, messages, warnings, created_at, updated_at, created_by, updated_by
      ) values (
        'review_evidence', 'lab_evidence', 'project_evidence', 'source_evidence',
        'labrat.workbookReviewSession.v1', 'needs_user_review', 1,
        '{"workbookName":"evidence.xlsx"}', '[]', '[]', $1, $1, 'user_owner', 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `insert into workbook_review_regions (
        id, lab_id, project_id, workbook_review_session_id, source_document_id,
        source_region_id, sheet_name, range_ref, selection_method, disposition,
        review_status, current_revision_id, accepted_revision_id, version, warnings,
        interpretation_hint, created_at, updated_at, created_by, updated_by
      ) values (
        'review_region_evidence', 'lab_evidence', 'project_evidence', 'review_evidence',
        'source_evidence', 'source_region_evidence', 'Sheet1', 'A1:B2', 'detected_region',
        'active', 'awaiting_review', null, null, 1, '[]', '{}', $1, $1, 'user_owner', 'user_owner'
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
        'revision_evidence', 'lab_evidence', 'project_evidence', 'review_evidence',
        'source_evidence', 'review_region_evidence', 1, 'initial', '',
        '["The region is an experiment table.","Rows represent experiments."]',
        '{"semanticType":"experiment_table"}', '[]', 'source_hash', 'dependency_hash',
        '{"status":"ready","blockers":[]}', '{"provider":"test"}', '[]', 0.95,
        $1, 'user_owner'
      )`,
      [timestamp],
    );
    await pool.query(
      `update workbook_review_regions set current_revision_id = 'revision_evidence'
       where id = 'review_region_evidence'`,
    );
  } finally {
    await pool.end();
  }
}

describe.skipIf(!TEST_DATABASE_URL)("Evidence v1 PostgreSQL integration", () => {
  test("filters project evidence and requires approve before accepting immutable understanding history", async () => {
    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl);
      await seedEvidence(databaseUrl);
      process.env.NODE_ENV = "test";
      process.env.LABRAT_AI_PROVIDER = "anthropic";
      process.env.DATABASE_URL = databaseUrl;
      let app: NestFastifyApplication | undefined;
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        app = await createV1Application({ logger: false });
        const ownerCookie = await login(app, "owner");
        const proposerCookie = await login(app, "proposer");
        const reviewerCookie = await login(app, "reviewer");
        const selectedCookie = await login(app, "selected");

        const sourceList = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_evidence/source-documents",
          headers: { cookie: ownerCookie },
        });
        expect(sourceList.statusCode).toBe(200);
        expect(sourceList.json()).toMatchObject({ items: [{ id: "source_evidence" }], nextCursor: null });

        const sourceRange = await app.inject({
          method: "POST",
          url: "/api/v1/source-documents/source_evidence/range",
          headers: { cookie: ownerCookie },
          payload: { sheetName: "Sheet1", range: "A1:B2" },
        });
        expect(sourceRange.statusCode).toBe(200);
        const sourceRangeBody = sourceRange.json();
        expect(sourceRangeBody).toMatchObject({
          sourceDocumentId: "source_evidence",
          cellCount: 4,
        });
        expect(sourceRangeBody.cells.map((cell: { address: string }) => cell.address))
          .toEqual(["A1", "B1", "A2", "B2"]);
        expect(sourceRangeBody.rows.map((row: Array<{ address: string }>) => (
          row.map((cell) => cell.address)
        ))).toEqual([["A1", "B1"], ["A2", "B2"]]);

        const deniedList = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_evidence/source-documents",
          headers: { cookie: selectedCookie },
        });
        expect(deniedList.statusCode).toBe(403);
        expect(JSON.stringify(deniedList.json())).not.toContain("Temperature");

        const hiddenRange = await app.inject({
          method: "POST",
          url: "/api/v1/source-documents/source_evidence/range",
          headers: { cookie: selectedCookie },
          payload: { sheetName: "Sheet1", range: "A1:B2" },
        });
        expect(hiddenRange.statusCode).toBe(404);
        expect(hiddenRange.json()).toMatchObject({ error: { code: "source_document_not_found" } });
        expect(JSON.stringify(hiddenRange.json())).not.toContain("Temperature");

        const deniedConfirm = await app.inject({
          method: "POST",
          url: "/api/v1/workbook-review-sessions/review_evidence/regions/review_region_evidence/confirm",
          headers: { cookie: proposerCookie },
          payload: { revisionId: "revision_evidence", expectedRegionVersion: 1 },
        });
        expect(deniedConfirm.statusCode).toBe(403);

        const revisionBefore = await pool.query(
          "select * from region_understanding_revisions where id = 'revision_evidence'",
        );
        const confirmed = await app.inject({
          method: "POST",
          url: "/api/v1/workbook-review-sessions/review_evidence/regions/review_region_evidence/confirm",
          headers: { cookie: reviewerCookie },
          payload: { revisionId: "revision_evidence", expectedRegionVersion: 1 },
        });
        expect(confirmed.statusCode).toBe(200);
        expect(confirmed.json()).toMatchObject({
          region: { acceptedRevisionId: "revision_evidence", reviewStatus: "accepted", version: 2 },
          acceptedRevision: { id: "revision_evidence", revisionNumber: 1 },
        });
        const revisionAfter = await pool.query(
          "select * from region_understanding_revisions where id = 'revision_evidence'",
        );
        expect(revisionAfter.rows).toEqual(revisionBefore.rows);

        const staleConfirm = await app.inject({
          method: "POST",
          url: "/api/v1/workbook-review-sessions/review_evidence/regions/review_region_evidence/confirm",
          headers: { cookie: reviewerCookie },
          payload: { revisionId: "revision_evidence", expectedRegionVersion: 1 },
        });
        expect(staleConfirm.statusCode).toBe(409);
        expect(staleConfirm.json()).toMatchObject({ error: { code: "stale_workbook_review_region" } });

        const accepted = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_evidence/region-understandings",
          headers: { cookie: reviewerCookie },
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toMatchObject({
          items: [{ revision: { id: "revision_evidence" } }],
          nextCursor: null,
        });

        const deleted = await app.inject({
          method: "DELETE",
          url: "/api/v1/workbook-review-sessions/review_evidence",
          headers: { cookie: proposerCookie, "content-type": "application/json" },
          payload: { expectedVersion: 1, reason: "superseded" },
        });
        expect(deleted.statusCode).toBe(200);
        expect(deleted.json()).toMatchObject({
          workbookReviewSession: { status: "deleted", version: 2 },
          deletedRegionCount: 1,
        });
        const retainedRevision = await pool.query(
          "select count(*)::int as count from region_understanding_revisions where id = 'revision_evidence'",
        );
        expect(retainedRevision.rows[0]?.count).toBe(1);
      } finally {
        await pool.end();
        await app?.close();
        delete process.env.DATABASE_URL;
      }
    });
  });
});
