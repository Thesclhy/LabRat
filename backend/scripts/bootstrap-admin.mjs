#!/usr/bin/env node
import crypto from "node:crypto";
import { Pool } from "pg";
import { loadSaasConfig } from "../src/saas/config.js";
import { hashPassword } from "../src/saas/passwords.js";

function usage() {
  return `
Usage:
  LABRAT_BOOTSTRAP_USERNAME=hanqi \\
  LABRAT_BOOTSTRAP_PASSWORD='change-me' \\
  LABRAT_BOOTSTRAP_DISPLAY_NAME='Hanqi Liu' \\
  npm --prefix backend run bootstrap:admin

Options:
  --username <value>
  --password <value>
  --display-name <value>
`;
}

function readOption(argv, name) {
  const inlinePrefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = argv.indexOf(`--${name}`);
  if (index !== -1) return argv[index + 1] || "";
  return "";
}

function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function validatePassword(password) {
  if (String(password || "").length < 12) {
    throw new Error("Bootstrap password must be at least 12 characters.");
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage().trim());
    return;
  }

  const config = loadSaasConfig();
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");
  if (config.seedDevAccounts) {
    throw new Error("Disable LABRAT_SEED_DEV_ACCOUNTS before bootstrapping a production admin.");
  }

  const username = requireText(
    readOption(argv, "username") || process.env.LABRAT_BOOTSTRAP_USERNAME,
    "Bootstrap username",
  );
  const password = requireText(
    readOption(argv, "password") || process.env.LABRAT_BOOTSTRAP_PASSWORD,
    "Bootstrap password",
  );
  const displayName = requireText(
    readOption(argv, "display-name") || process.env.LABRAT_BOOTSTRAP_DISPLAY_NAME || username,
    "Bootstrap display name",
  );
  validatePassword(password);

  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('labrat_bootstrap_admin'))");
    const existing = await client.query("select count(*)::int as count from users");
    if (existing.rows[0]?.count > 0) {
      await client.query("commit");
      console.log(`Bootstrap skipped: users table already has ${existing.rows[0].count} user(s).`);
      return;
    }

    const id = `user_bootstrap_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    await client.query(
      `insert into users
        (id, username, display_name, password_hash, is_active, is_super_admin, created_at, updated_at)
       values ($1, $2, $3, $4, true, true, now(), now())`,
      [id, username, displayName, hashPassword(password)],
    );
    await client.query("commit");
    console.log(`Created bootstrap super admin '${username}'.`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
