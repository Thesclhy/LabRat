// Isolated real HTTP + PostgreSQL acceptance. Requires build:v1 and Python Playwright.
import "reflect-metadata";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { hashPassword } from "../src/saas/passwords.js";
import { createV1Application } from "../dist-v1/v1/bootstrap.js";
import { DatabaseService } from "../dist-v1/v1/platform/database/database.service.js";
import { provisionPublicGuest } from "../dist-v1/v1/identity/public-guest-provision.js";
import { applyTestMigrations, withTestSchema } from "../dist-v1/v1/testing/postgres-test-database.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
const python = process.env.LABRAT_QA_PYTHON;
const chromium = process.env.LABRAT_QA_CHROMIUM;
if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1" || !python || !chromium) {
  throw new Error("Use a dedicated loopback LABRAT_TEST_DATABASE_URL and set LABRAT_QA_PYTHON / LABRAT_QA_CHROMIUM.");
}

// The dynamic, temporary database schema requires the existing custom server lifecycle.
await withTestSchema(databaseUrl, async ({ databaseUrl: isolatedUrl }) => {
  await applyTestMigrations(isolatedUrl);
  const pool = new Pool({ connectionString: isolatedUrl });
  const database = new DatabaseService({ databaseUrl: isolatedUrl });
  let app;
  let vite;
  let viteClosed;
  try {
    await pool.query(`insert into users (id, username, display_name, password_hash, is_super_admin, created_at, updated_at)
      values ('guest_operator_qa', 'guest_operator_qa', 'Guest Operator QA', $1, true, now(), now())`,
    [hashPassword("OperatorBrowserOnly123!")]);
    const guest = await provisionPublicGuest(database, {
      username: "guest_qa", password: "GuestBrowserOnly123!", adminUsername: "guest_operator_qa",
    });
    Object.assign(process.env, {
      NODE_ENV: "test", DATABASE_URL: isolatedUrl, LABRAT_AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "", DEEPSEEK_API_KEY: "", LABRAT_ANALYSIS_EXECUTOR: "disabled",
      LABRAT_SECURE_COOKIES: "", LABRAT_QA_GUEST_PROJECT: guest.projectId,
    });
    app = await createV1Application({ logger: false });
    await app.listen(8799, "127.0.0.1");
    vite = spawn(process.execPath, [
      path.join(root, "node_modules/vite/bin/vite.js"), "--mode", "blank",
      "--host", "127.0.0.1", "--port", "5189", "--strictPort",
    ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, VITE_LABRAT_API_PROXY_TARGET: "http://127.0.0.1:8799" } });
    viteClosed = once(vite, "close");
    vite.stdout.resume();
    vite.stderr.resume();
    let ready = false;
    for (let attempt = 0; attempt < 100 && vite.exitCode === null; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:5189/LabRat/", { signal: AbortSignal.timeout(1000) });
        if (response.ok) { ready = true; break; }
      } catch { /* Wait for this test's server. */ }
      await delay(150);
    }
    if (!ready) throw new Error("Guest browser test frontend did not become ready.");
    const browser = spawn(python, [
      path.join(root, "scripts/qa/public-guest-browser-live.py"),
      "--base-url", "http://127.0.0.1:5189/LabRat/", "--chromium", chromium,
      "--output", process.env.LABRAT_QA_OUTPUT || path.join(root, ".tmp/public-guest-browser-live"),
      ...process.argv.slice(2),
    ], { cwd: root, env: process.env, windowsHide: true, stdio: "inherit" });
    const [code] = await once(browser, "close");
    if (code !== 0) throw new Error("Live Guest browser acceptance failed.");
  } finally {
    if (vite && vite.exitCode === null) vite.kill();
    if (viteClosed) await viteClosed;
    if (app) await app.close();
    await database.onModuleDestroy();
    await pool.end();
  }
});
console.log("Guest acceptance complete; synthetic schema and HTTP servers cleaned up.");
