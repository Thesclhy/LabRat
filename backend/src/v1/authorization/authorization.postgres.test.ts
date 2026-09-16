import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getTableColumns, getTableName } from "drizzle-orm";
import { Pool } from "pg";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { describe, expect, test } from "vitest";
import { hashPassword } from "../../saas/passwords.js";
import { createV1Application } from "../bootstrap.js";
import { v1Schema } from "../platform/database/schema.js";
import {
  applyTestMigrations,
  withTestSchema,
} from "../testing/postgres-test-database.js";

const TEST_DATABASE_URL = process.env.LABRAT_TEST_DATABASE_URL;

async function runMigrationRunner(databaseUrl: string, fixtureThrough?: string, formerAuth = false) {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const migrationsDirectory = path.join(backendRoot, "migrations");
  if (fixtureThrough) {
    const files = (await fs.readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql") && file <= fixtureThrough).sort();
    if (formerAuth) files.push("024_authorization_v1.sql");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      for (const filename of files) {
        const sourceName = filename === "024_authorization_v1.sql" ? "027_authorization_v1.sql" : filename;
        const sql = await fs.readFile(path.join(migrationsDirectory, sourceName), "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        await pool.query(
          "insert into labrat_schema_migrations (filename, checksum) values ($1, $2)",
          [filename, checksum],
        );
      }
    } finally {
      await pool.end();
    }
  }
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [path.join(backendRoot, "src", "saas", "migrate.js")],
    { env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", LABRAT_AI_PROVIDER: "anthropic" } },
  );
  return stdout;
}

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers["set-cookie"];
  return String(Array.isArray(raw) ? raw[0] : raw || "").split(";")[0] || "";
}

async function insertFoundation(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const now = new Date().toISOString();
  const passwordHash = hashPassword("LabRatTest123!");
  try {
    for (const user of [
      ["user_platform", "platform", "Platform Admin", true],
      ["user_owner", "owner", "Lab Owner", false],
      ["user_member", "member", "Lab Member", false],
      ["user_viewer", "viewer", "Legacy Viewer", false],
      ["user_editor", "editor", "Legacy Editor", false],
    ] as const) {
      await pool.query(
        `insert into users (
          id, username, display_name, password_hash, is_active, is_super_admin,
          created_at, updated_at
        ) values ($1, $2, $3, $4, true, $5, $6, $6)`,
        [user[0], user[1], user[2], passwordHash, user[3], now],
      );
    }
    await pool.query(
      `insert into labs (id, name, slug, status, settings, created_at, updated_at, created_by)
       values ('lab_1', 'Test Lab', 'test-lab', 'active', '{}', $1, $1, 'user_platform')`,
      [now],
    );
    for (const membership of [
      ["membership_owner", "user_owner", "lab_owner"],
      ["membership_member", "user_member", "lab_member"],
      ["membership_viewer", "user_viewer", "viewer"],
      ["membership_editor", "user_editor", "editor"],
    ] as const) {
      await pool.query(
        `insert into lab_memberships (
          id, lab_id, user_id, role, status, created_at, updated_at, created_by
        ) values ($1, 'lab_1', $2, $3, 'active', $4, $4, 'user_platform')`,
        [membership[0], membership[1], membership[2], now],
      );
    }
    for (const project of [
      ["project_1", "Visible Project"],
      ["project_2", "Hidden Project"],
    ] as const) {
      await pool.query(
        `insert into projects (
          id, lab_id, name, description, status, metadata,
          created_at, updated_at, created_by, updated_by
        ) values ($1, 'lab_1', $2, '', 'active', '{}', $3, $3, 'user_owner', 'user_owner')`,
        [project[0], project[1], now],
      );
    }
    await pool.query(
      `insert into experiment_identities (
        id, lab_id, project_id, canonical_label, normalized_label, aliases,
        created_at, updated_at, created_by
      ) values
        ('experiment_1', 'lab_1', 'project_1', 'Exp1', 'exp1', '[]', $1, $1, 'user_owner'),
        ('experiment_2', 'lab_1', 'project_1', 'Exp2', 'exp2', '[]', $1, $1, 'user_owner')`,
      [now],
    );
    await pool.query(
      `insert into data_plans (
        id, lab_id, project_id, dependency_hash, accepted_at, accepted_by,
        created_at, updated_at, created_by
      ) values ('plan_1', 'lab_1', 'project_1', 'dependency_1', $1, 'user_owner', $1, $1, 'user_owner')`,
      [now],
    );
    await pool.query(
      `insert into data_snapshots (
        id, lab_id, project_id, data_plan_id, content_hash, dependency_hash,
        experiment_records, summary, accepted_at, accepted_by, created_at, created_by
      ) values (
        'snapshot_1', 'lab_1', 'project_1', 'plan_1', 'content_1', 'dependency_1',
        $1::jsonb, '{"experimentRecordCount":2}'::jsonb, $2, 'user_owner', $2, 'user_owner'
      )`,
      [JSON.stringify([
        {
          experimentId: "experiment_1",
          label: "Exp1",
          aliases: ["Exp1"],
          fields: [{
            fieldKey: "temperature",
            displayName: "Temperature",
            role: "condition",
            value: 250,
            formattedValue: "250",
            valueType: "number",
            unit: "degC",
            confidence: 1,
            warnings: [],
            sourceRefs: [],
          }],
          series: [], warnings: [], sourceRefs: [],
        },
        {
          experimentId: "experiment_2",
          label: "HIDDEN_SENTINEL",
          aliases: ["HIDDEN_SENTINEL"],
          fields: [{
            fieldKey: "secret",
            displayName: "HIDDEN_SENTINEL",
            role: "outcome",
            value: "HIDDEN_SENTINEL",
            formattedValue: "HIDDEN_SENTINEL",
            valueType: "string",
            unit: null,
            confidence: 1,
            warnings: [],
            sourceRefs: [],
          }],
          series: [], warnings: [], sourceRefs: [],
        },
      ]), now],
    );
    await pool.query(
      `insert into data_snapshots (
        id, lab_id, project_id, data_plan_id, content_hash, dependency_hash,
        experiment_records, summary, accepted_at, accepted_by, created_at, created_by
      ) values (
        'snapshot_history', 'lab_1', 'project_1', 'plan_1', 'content_history', 'dependency_history',
        $1::jsonb, '{"experimentRecordCount":1,"historyMarker":"OLD_HISTORY_SENTINEL"}'::jsonb,
        $2, 'user_owner', $2, 'user_owner'
      )`,
      [JSON.stringify([{
        experimentId: "experiment_1",
        label: "Exp1",
        aliases: ["Exp1"],
        fields: [],
        series: [],
        warnings: [],
        sourceRefs: [],
      }]), now],
    );
    await pool.query(
      `insert into experiment_snapshot_heads (
        id, lab_id, project_id, experiment_id, data_snapshot_id, record_index, updated_at, updated_by
      ) values
        ('head_1', 'lab_1', 'project_1', 'experiment_1', 'snapshot_1', 0, $1, 'user_owner'),
        ('head_2', 'lab_1', 'project_1', 'experiment_2', 'snapshot_1', 1, $1, 'user_owner')`,
      [now],
    );
  } finally {
    await pool.end();
  }
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

describe.skipIf(!TEST_DATABASE_URL)("authorization v1 PostgreSQL integration", () => {
  test("migrations 024-027 support fresh, former-authorization-first, and main-first databases", async () => {
    const expectReconciledSchema = async (databaseUrl: string) => {
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const state = await pool.query(`
          select
            to_regclass(current_schema() || '.chart_style_profiles') is not null
              as has_chart_style_profiles,
            to_regclass(current_schema() || '.reusable_chart_templates') is not null
              as has_reusable_chart_templates,
            to_regclass(current_schema() || '.reusable_chart_template_applications') is not null
              as has_template_applications,
            to_regclass(current_schema() || '.project_access_grants') is not null
              as has_project_access_grants,
            exists (
              select 1
              from information_schema.columns
              where table_schema = current_schema()
                and table_name = 'analysis_threads'
                and column_name = 'input_mode'
            ) as has_analysis_input_mode
        `);
        expect(state.rows[0]).toEqual({
          has_chart_style_profiles: true,
          has_reusable_chart_templates: true,
          has_template_applications: true,
          has_project_access_grants: true,
          has_analysis_input_mode: true,
        });
      } finally {
        await pool.end();
      }
    };

    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      expect(await runMigrationRunner(databaseUrl)).toContain("Applied 027_authorization_v1.sql");
      expect(await runMigrationRunner(databaseUrl)).not.toContain("Applied ");
      await expectReconciledSchema(databaseUrl);
    });

    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl, { through: "026_analysis_chart_input_mode.sql" });
      const output = await runMigrationRunner(databaseUrl, "026_analysis_chart_input_mode.sql");
      expect(output).toContain("Applied 027_authorization_v1.sql");
      expect(output).not.toContain("Applied 024_reusable_chart_templates.sql");
      await expectReconciledSchema(databaseUrl);
    });

    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl, { through: "023_experiment_custom_columns.sql" });
      await insertFoundation(databaseUrl);
      await applyTestMigrations(databaseUrl, { only: "027_authorization_v1.sql" });
      const output = await runMigrationRunner(databaseUrl, "023_experiment_custom_columns.sql", true);
      expect(output).toContain("Applied 024_reusable_chart_templates.sql");
      expect(output).toContain("Applied 027_authorization_v1.sql");
      expect(await runMigrationRunner(databaseUrl)).not.toContain("Applied ");
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const ledger = await pool.query("select filename from labrat_schema_migrations where filename like '%authorization_v1.sql' order by filename");
        expect(ledger.rows).toEqual([
          { filename: "024_authorization_v1.sql" },
          { filename: "027_authorization_v1.sql" },
        ]);
        expect((await pool.query("select count(*)::int as count from project_access_grants")).rows[0].count).toBe(4);
      } finally {
        await pool.end();
      }
      await expectReconciledSchema(databaseUrl);
    });
  });

  test("migration backfills legacy access without rewriting membership roles and is idempotent", async () => {
    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl, { through: "023_experiment_custom_columns.sql" });
      await insertFoundation(databaseUrl);
      await applyTestMigrations(databaseUrl, { only: "027_authorization_v1.sql" });
      await applyTestMigrations(databaseUrl, { only: "027_authorization_v1.sql" });

      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const roles = await pool.query(
          `select user_id, role from lab_memberships
           where user_id in ('user_viewer', 'user_editor') order by user_id`,
        );
        expect(roles.rows).toEqual([
          { user_id: "user_editor", role: "editor" },
          { user_id: "user_viewer", role: "viewer" },
        ]);
        const grants = await pool.query(
          `select user_id, project_id, capabilities
           from project_access_grants order by user_id, project_id`,
        );
        expect(grants.rows).toHaveLength(4);
        expect(grants.rows.find((row) => row.user_id === "user_viewer")?.capabilities)
          .toEqual(["read", "export"]);
        expect(grants.rows.find((row) => row.user_id === "user_editor")?.capabilities)
          .toEqual(["read", "propose", "approve", "export"]);
      } finally {
        await pool.end();
      }
    });
  });

  test("Drizzle v1 declarations match every declared migrated table and column", async () => {
    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl);
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const tables = await pool.query<{ table_name: string }>(
          `select table_name from information_schema.tables
           where table_schema = current_schema() and table_type = 'BASE TABLE'
           order by table_name`,
        );
        const declaredTableNames = Object.values(v1Schema).map(getTableName).sort();
        expect(tables.rows.map((row) => row.table_name)).toEqual(declaredTableNames);
        for (const table of Object.values(v1Schema)) {
          const tableName = getTableName(table);
          const result = await pool.query<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = current_schema() and table_name = $1`,
            [tableName],
          );
          const actual = result.rows.map((row) => row.column_name).sort();
          const declared = Object.values(getTableColumns(table)).map((column) => column.name).sort();
          expect(actual, tableName).toEqual(declared);
        }
      } finally {
        await pool.end();
      }
    });
  });

  test("HTTP flow enforces platform isolation, default deny, selected experiment shell and revocation", async () => {
    await withTestSchema(TEST_DATABASE_URL!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl);
      await insertFoundation(databaseUrl);
      process.env.NODE_ENV = "test";
      process.env.LABRAT_AI_PROVIDER = "anthropic";
      process.env.DATABASE_URL = databaseUrl;
      let app: NestFastifyApplication | undefined;
      try {
        app = await createV1Application({ logger: false });
        const platformCookie = await login(app, "platform");
        const ownerCookie = await login(app, "owner");
        const memberCookie = await login(app, "member");

        const platformLabs = await app.inject({
          method: "GET",
          url: "/api/v1/labs",
          headers: { cookie: platformCookie },
        });
        expect(platformLabs.json()).toEqual({ items: [], nextCursor: null });

        const deniedProjects = await app.inject({
          method: "GET",
          url: "/api/v1/projects?labId=lab_1",
          headers: { cookie: memberCookie },
        });
        expect(deniedProjects.json()).toEqual({ items: [], nextCursor: null });

        const grantResponse = await app.inject({
          method: "POST",
          url: "/api/v1/projects/project_1/access-grants",
          headers: { cookie: ownerCookie },
          payload: {
            subject: { type: "user", id: "user_member" },
            scope: "selected_experiments",
            capabilities: ["read", "propose"],
            experimentIds: ["experiment_1"],
          },
        });
        expect(grantResponse.statusCode).toBe(201);

        const visibleProjects = await app.inject({
          method: "GET",
          url: "/api/v1/projects?labId=lab_1",
          headers: { cookie: memberCookie },
        });
        expect(visibleProjects.json()).toMatchObject({
          items: [{ id: "project_1", shellOnly: true }],
          nextCursor: null,
        });
        expect(JSON.stringify(visibleProjects.json())).not.toContain("Hidden Project");
        expect(JSON.stringify(visibleProjects.json())).not.toContain("projectProfile");

        const browser = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_1/experiment-browser",
          headers: { cookie: memberCookie },
        });
        expect(browser.statusCode).toBe(200);
        expect(browser.json()).toMatchObject({
          totalCount: 1,
          rows: [{ experimentId: "experiment_1" }],
        });
        expect(JSON.stringify(browser.json())).not.toContain("HIDDEN_SENTINEL");
        expect(JSON.stringify(browser.json())).not.toContain("experiment_2");

        const snapshotList = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_1/data-snapshots",
          headers: { cookie: memberCookie },
        });
        expect(snapshotList.statusCode).toBe(200);
        expect(snapshotList.json()).toMatchObject({
          items: [{
            id: "snapshot_1",
            scope: "selected_experiments",
            authorizedExperimentCount: 1,
          }],
        });
        expect(JSON.stringify(snapshotList.json())).not.toContain("experimentRecordCount");
        expect(JSON.stringify(snapshotList.json())).not.toContain("OLD_HISTORY_SENTINEL");

        const ownerSnapshotList = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_1/data-snapshots",
          headers: { cookie: ownerCookie },
        });
        expect(ownerSnapshotList.statusCode).toBe(200);
        expect(ownerSnapshotList.json().items.map((item: { id: string }) => item.id).sort())
          .toEqual(["snapshot_1", "snapshot_history"]);
        expect(JSON.stringify(ownerSnapshotList.json())).toContain("OLD_HISTORY_SENTINEL");

        const dataPlans = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_1/data-plans",
          headers: { cookie: memberCookie },
        });
        expect(dataPlans.statusCode).toBe(403);

        const access = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_1/access",
          headers: { cookie: memberCookie },
        });
        expect(access.json()).toMatchObject({
          access: {
            shellOnly: true,
            allExperiments: false,
            experimentIds: ["experiment_1"],
          },
        });

        const hiddenProject = await app.inject({
          method: "GET",
          url: "/api/v1/projects/project_2",
          headers: { cookie: memberCookie },
        });
        expect(hiddenProject.statusCode).toBe(404);

        const revoke = await app.inject({
          method: "DELETE",
          url: "/api/v1/labs/lab_1/members/user_member",
          headers: { cookie: ownerCookie },
        });
        expect(revoke.statusCode).toBe(200);
        const afterRevoke = await app.inject({
          method: "GET",
          url: "/api/v1/projects?labId=lab_1",
          headers: { cookie: memberCookie },
        });
        expect(afterRevoke.json()).toEqual({ items: [], nextCursor: null });
      } finally {
        await app?.close();
        delete process.env.DATABASE_URL;
      }
    });
  });
});
