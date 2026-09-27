import { Pool } from "pg";
import { hashPassword } from "../../saas/passwords.js";

export async function seedAnalysisScenario(databaseUrl: string) {
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
      ["grant_reviewer", "user_reviewer", "all_experiments", ["read", "approve"]],
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
