import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

function quoteIdent(value: string): string {
  if (!/^labrat_v1_test_[a-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe test schema name: ${value}`);
  }
  return `"${value}"`;
}

export function databaseUrlForSchema(rawUrl: string, schema: string): string {
  const url = new URL(rawUrl);
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", [existing, `-c search_path=${schema}`].filter(Boolean).join(" "));
  return url.toString();
}

function migrationsDirectory(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "migrations");
}

export async function applyTestMigrations(databaseUrl: string, options: {
  through?: string;
  only?: string;
} = {}): Promise<void> {
  const directory = migrationsDirectory();
  let files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  if (options.through) files = files.filter((file) => file <= options.through!);
  if (options.only) files = files.filter((file) => file === options.only);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      create table if not exists labrat_schema_migrations (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    for (const file of files) {
      await pool.query(await fs.readFile(path.join(directory, file), "utf8"));
    }
  } finally {
    await pool.end();
  }
}

export async function withTestSchema<T>(
  rawUrl: string,
  run: (context: { databaseUrl: string; adminPool: Pool; schema: string }) => Promise<T>,
): Promise<T> {
  const schema = `labrat_v1_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const adminPool = new Pool({ connectionString: rawUrl });
  await adminPool.query(`create schema ${quoteIdent(schema)}`);
  try {
    return await run({
      databaseUrl: databaseUrlForSchema(rawUrl, schema),
      adminPool,
      schema,
    });
  } finally {
    await adminPool.query(`drop schema if exists ${quoteIdent(schema)} cascade`);
    await adminPool.end();
  }
}
