import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSaasConfig } from "./config.js";

const MIGRATIONS_TABLE = "labrat_schema_migrations";

function checksumMigration(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

async function loadMigrations(migrationsDir) {
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  return Promise.all(files.map(async (file) => {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    return { file, sql, checksum: checksumMigration(sql) };
  }));
}

async function ensureMigrationLedger(client, migrations) {
  const state = await client.query(`
    select
      to_regclass(current_schema() || '.${MIGRATIONS_TABLE}') is not null as has_ledger,
      to_regclass(current_schema() || '.labs') is not null as has_existing_schema
  `);
  const { has_ledger: hasLedger, has_existing_schema: hasExistingSchema } = state.rows[0];

  await client.query(`
    create table if not exists ${MIGRATIONS_TABLE} (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  if (!hasLedger && hasExistingSchema) {
    const currentSchema = await client.query(`
      select
        to_regclass(current_schema() || '.analysis_thread_retry_receipts') is not null
          as has_retry_receipts,
        not exists (
          select 1
          from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'analysis_plan_revisions'
            and column_name = 'python_program'
        ) as has_analysis_v2
    `);
    if (!currentSchema.rows[0].has_retry_receipts || !currentSchema.rows[0].has_analysis_v2) {
      throw new Error(
        "Existing database predates the migration ledger and is not at the current schema. "
        + "Back it up and migrate it explicitly before starting LabRat.",
      );
    }

    for (const migration of migrations) {
      await client.query(
        `insert into ${MIGRATIONS_TABLE} (filename, checksum) values ($1, $2)`,
        [migration.file, migration.checksum],
      );
    }
    console.log(`Baselined ${migrations.length} existing migrations.`);
  }
}

async function main() {
  const config = loadSaasConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: config.databaseUrl });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, "..", "..", "migrations");
  const migrations = await loadMigrations(migrationsDir);
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('labrat_schema_migrations'))");
    await ensureMigrationLedger(client, migrations);
    const appliedResult = await client.query(
      `select filename, checksum from ${MIGRATIONS_TABLE}`,
    );
    const applied = new Map(appliedResult.rows.map((row) => [row.filename, row.checksum]));

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.file);
      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.file} changed after it was applied. Add a new migration instead.`,
          );
        }
        continue;
      }

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          `insert into ${MIGRATIONS_TABLE} (filename, checksum) values ($1, $2)`,
          [migration.file, migration.checksum],
        );
        await client.query("commit");
        console.log(`Applied ${migration.file}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('labrat_schema_migrations'))")
      .catch(() => {});
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
