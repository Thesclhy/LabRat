import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  ensureMigrationLedger,
  LAST_PRE_LEDGER_MIGRATION,
} from "./migrate.js";

function migration(file) {
  return { file, checksum: `checksum:${file}`, sql: "select 1" };
}

test("pre-ledger databases baseline only migrations that existed with the ledger cutover", async () => {
  const inserted = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("has_ledger")) {
        return { rows: [{ has_ledger: false, has_existing_schema: true }] };
      }
      if (text.includes("has_retry_receipts")) {
        return { rows: [{ has_retry_receipts: true, has_analysis_v2: true }] };
      }
      if (text.includes("insert into labrat_schema_migrations")) {
        inserted.push(params[0]);
      }
      return { rows: [] };
    },
  };

  await ensureMigrationLedger(client, [
    migration("001_saas_auth_v0.sql"),
    migration(LAST_PRE_LEDGER_MIGRATION),
    migration("020_reset_list_column_analysis.sql"),
    migration("027_authorization_v1.sql"),
  ]);

  assert.deepEqual(inserted, [
    "001_saas_auth_v0.sql",
    LAST_PRE_LEDGER_MIGRATION,
  ]);
});

test("authorization migration is additive and backfills only legacy viewer/editor access", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.resolve(here, "..", "..", "migrations", "027_authorization_v1.sql"),
    "utf8",
  );

  for (const table of [
    "lab_groups",
    "lab_group_members",
    "project_access_grants",
    "experiment_access_grants",
  ]) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(sql, /membership\.role in \('viewer', 'editor'\)/);
  assert.match(sql, /when 'editor' then '\["read", "propose", "approve", "export"\]'/);
  assert.match(sql, /else '\["read", "export"\]'/);
  assert.doesNotMatch(sql, /update\s+lab_memberships/i);
  assert.doesNotMatch(sql, /drop\s+(table|column)/i);
});
