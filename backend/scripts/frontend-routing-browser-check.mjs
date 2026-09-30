// Real HTTP/PostgreSQL and the production frontend. No provider calls.
import "reflect-metadata";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { createV1Application } from "../dist-v1/v1/bootstrap.js";
import { seedAnalysisScenario } from "../dist-v1/v1/testing/analysis-review-fixture.js";
import { applyTestMigrations, withTestSchema } from "../dist-v1/v1/testing/postgres-test-database.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1") throw new Error("Use a dedicated loopback test database.");
const { chromium } = await import(pathToFileURL(process.env.LABRAT_QA_PLAYWRIGHT).href);
const output = path.join(root, "artifacts/routing-phase1/browser");
await mkdir(output, { recursive: true });
const startedAt = new Date().toISOString();
const buildHash = () => readFile(path.join(root, "dist/index.html")).then((bytes) => createHash("sha256").update(bytes).digest("hex"));
const testedBuild = await buildHash();
await writeFile(path.join(output, "result.json"), JSON.stringify({ status: "running", startedAt, testedBuild }, null, 2));
const origin = "http://127.0.0.1:5199";
const base = `${origin}/LabRat`;
const project = "/projects/project_analysis";
const errors = [], checks = [], writes = [], network = [];
await withTestSchema(databaseUrl, async ({ databaseUrl: isolated }) => {
  await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
  const pool = new Pool({ connectionString: isolated });
  const sheet = { name: "Carbon", usedRange: "A1:C2", rowCount: 2, columnCount: 3 };
  await pool.query("update source_documents set metadata=$1 where id='source_analysis'", [JSON.stringify({ workbookName: "analysis.xlsx", sheets: [sheet] })]);
  await pool.query(`insert into source_index_blobs(id,lab_id,project_id,source_document_id,blob_kind,payload,checksum_sha256,created_at)
    values('routing_cells','lab_analysis','project_analysis','source_analysis','excel_cell_grid_v1',$1,'routing_synthetic',now())`,
    [JSON.stringify({ sheets: [{ ...sheet, cellGrid: { range: "A1:C2", rowCount: 2, columnCount: 3,
      cells: [{ address: "A1", row: 1, col: 1, rawValue: "Carbon", formattedValue: "Carbon", type: "string" }] } }] })]);
  let app, vite, viteClosed, browser, page;
  let viteLog = "";
  try {
    Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: isolated, LABRAT_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "", LABRAT_FILE_STORAGE_ROOT: path.join(output, "files") });
    app = await createV1Application({ logger: false });
    await app.listen({ host: "127.0.0.1", port: 8799 });
    vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "5199", "--strictPort"],
      { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VITE_LABRAT_API_PROXY_TARGET: "http://127.0.0.1:8799" } });
    viteClosed = once(vite, "close");
    for (const stream of [vite.stdout, vite.stderr]) stream.on("data", (chunk) => { viteLog = (viteLog + chunk).slice(-4000); });
    let ready = false;
    for (let i = 0; i < 100 && vite.exitCode === null; i++) {
      try { if ((await fetch(`${base}/`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Startup only. */ }
      await delay(150);
    }
    assert.ok(ready, viteLog);
    browser = await chromium.launch({ executablePath: process.env.LABRAT_QA_CHROMIUM, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => network.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
    page.on("response", (response) => { if (response.status() >= 400) network.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    page.on("console", (message) => { if (/Encountered two children|does not have an element/.test(message.text())) errors.push(message.text()); });
    page.on("request", (request) => { if (request.url().includes("/api/") && !["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    const waitPath = (suffix) => page.waitForURL(`${base}${suffix}`);
    const clickTab = async (name, suffix) => {
      await page.getByRole("button", { name, exact: true }).click(); await waitPath(`${project}/${suffix}`);
    };
    const login = async (username = "owner") => {
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await page.getByLabel("Username", { exact: true }).fill(username);
      await page.getByLabel("Password", { exact: true }).fill("LabRatTest123!");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    };

    await page.goto(`${base}${project}/manuscript`);
    await page.getByRole("button", { name: "Log in", exact: true }).waitFor();
    await writeFile(path.join(output, "login-dom.txt"), await page.locator("body").innerText());
    assert.ok(new URL(page.url()).searchParams.get("returnTo").endsWith("/manuscript"));
    const loginUrl = page.url();
    await page.goto(loginUrl); await page.reload();
    await page.getByRole("button", { name: "Log in", exact: true }).waitFor();
    assert.equal(page.url(), loginUrl);
    await login(); await waitPath(`${project}/manuscript`);
    await page.getByRole("button", { name: "Add page", exact: true }).waitFor();
    checks.push("unauthenticated deep link and login return");

    for (const [name, suffix] of [["Overview", "overview"], ["Browser", "browser"], ["References", "references"], ["Manuscript", "manuscript"]]) {
      const response = await page.goto(`${base}${project}/${suffix}`);
      assert.equal(response.status(), 200);
      await page.locator(".tabs .active").filter({ hasText: name }).waitFor();
      await page.reload(); await page.locator(".tabs .active").filter({ hasText: name }).waitFor();
      assert.equal(new URL(page.url()).pathname, `/LabRat${project}/${suffix}`);
      for (const asset of await page.locator("script[src],link[rel=stylesheet]").evaluateAll((nodes) => nodes.map((node) => node.src || node.href))) {
        assert.equal((await context.request.get(asset)).status(), 200);
        assert.ok(new URL(asset).pathname.startsWith("/LabRat/assets/"));
      }
    }
    checks.push("all four production deep links, reload and assets under /LabRat");
    await page.getByRole("button", { name: "Home", exact: true }).click();
    // Home leaves the project; a freshly hydrated canvas must not prompt.
    await waitPath("/labs/lab_analysis/projects");
    assert.equal(await page.getByRole("dialog", { name: "Save your changes?" }).count(), 0);
    await page.reload(); await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/LabRat/labs/lab_analysis/projects");
    checks.push("login direct entry/reload preserves return target; lab dashboard reload");
    await page.goBack(); await waitPath(`${project}/manuscript`);
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await writeFile(path.join(output, "page-orientation-dom.txt"), await page.locator("body").innerText());
    const landscape = page.getByRole("button", { name: /Landscape/ });
    if (await landscape.count()) await landscape.first().click();
    await page.getByRole("region", { name: "Page 1", exact: true }).waitFor();
    const unloadDialog = page.waitForEvent("dialog").then(async (dialog) => {
      assert.equal(dialog.type(), "beforeunload"); await dialog.dismiss();
    });
    await Promise.all([unloadDialog, page.reload({ timeout: 1500 }).catch((error) => assert.match(error.message, /ERR_ABORTED|Timeout .*exceeded/))]);
    checks.push("native reload warning protects an unsaved draft");
    const pageCount = () => page.locator(".canvas-page").count();
    await clickTab("References", "references");
    await page.getByRole("region", { name: "Reference library" }).waitFor();
    const historyLength = await page.evaluate(() => history.length);
    await clickTab("References", "references"); assert.equal(await page.evaluate(() => history.length), historyLength);
    await clickTab("Overview", "overview"); assert.equal(await page.getByRole("region", { name: "Reference library" }).count(), 0);
    await page.goBack(); await waitPath(`${project}/references`);
    await page.goBack(); await waitPath(`${project}/manuscript`); assert.equal(await pageCount(), 1);
    await page.goForward(); await waitPath(`${project}/references`);
    await clickTab("Manuscript", "manuscript"); assert.equal(await pageCount(), 1);
    checks.push("PUSH/POP/forward, same-tab deduplication, draft retained, References cleanup");

    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("dialog", { name: "Save your changes?" }).waitFor();
    await page.screenshot({ path: path.join(output, "unsaved-desktop.png") });
    await page.getByRole("button", { name: "Stay here" }).click(); assert.equal(await pageCount(), 1);
    await page.route("**/api/v1/projects/project_analysis/manuscripts", (route) => route.request().method() === "POST"
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "test_offline", message: "Injected save failure" } }) }) : route.continue());
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Save and leave" }).click();
    await page.getByText(/Your changes could not be saved/).waitFor();
    assert.equal(await pageCount(), 1);
    await page.unroute("**/api/v1/projects/project_analysis/manuscripts");
    await page.getByRole("button", { name: "Save and leave" }).click(); await waitPath("/labs/lab_analysis/projects");
    await page.goBack(); await waitPath(`${project}/manuscript`); await page.getByRole("region", { name: "Page 1", exact: true }).waitFor();
    await page.reload(); await page.getByRole("region", { name: "Page 1", exact: true }).waitFor();
    checks.push("stay, injected save failure, save-and-leave and persisted manuscript reload");

    await page.getByRole("button", { name: "Add page", exact: true }).click();
    assert.equal(await pageCount(), 2);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "unsaved-mobile.png") });
    const dialog = page.getByRole("dialog", { name: "Save your changes?" });
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
    await page.getByRole("button", { name: "Discard and leave" }).click(); await waitPath("/labs/lab_analysis/projects");
    await page.goBack(); await waitPath(`${project}/manuscript`); await page.getByRole("region", { name: "Page 1", exact: true }).waitFor();
    assert.equal(await pageCount(), 1);
    await page.screenshot({ path: path.join(output, "manuscript-mobile.png") });
    checks.push("discard restores saved state; 390px navigation and prompt");

    await page.setViewportSize({ width: 1440, height: 1000 });
    const created = await context.request.post(`${origin}/api/v1/projects`, { data: { labId: "lab_analysis", name: "Routing empty project", description: "Synthetic QA", projectProfile: {} } });
    assert.equal(created.status(), 201); const secondId = (await created.json()).project.id;
    await page.goto(`${base}/projects/${secondId}/overview`);
    await page.getByRole("button", { name: "Skip onboarding", exact: true }).waitFor();
    await writeFile(path.join(output, "onboarding-dom.txt"), await page.locator("body").innerText());
    await page.screenshot({ path: path.join(output, "onboarding.png") });
    await page.goto(`${base}/projects/${secondId}/browser`); await page.locator(".tabs .active").filter({ hasText: "Browser" }).waitFor();
    await page.goto(`${base}${project}/overview`); await page.getByRole("button", { name: "Overview", exact: true }).waitFor();
    await page.getByRole("button", { name: "File menu" }).click();
    await page.getByRole("button", { name: "Lab management", exact: true }).click();
    await writeFile(path.join(output, "management-dom.txt"), await page.locator("body").innerText());
    await page.screenshot({ path: path.join(output, "management.png") });
    await page.goBack(); await page.locator(".tabs .active").filter({ hasText: "Browser" }).waitFor();
    checks.push("new project onboarding, direct Browser and management dismissed by history");

    await page.goto(`${base}${project}/overview`);
    await page.getByRole("button", { name: "View confirmed regions", exact: true }).first().click();
    await page.getByRole("button", { name: "Open analysis.xlsx", exact: true }).click();
    await page.getByLabel("Cell A1", { exact: true }).filter({ hasText: "Carbon" }).waitFor();
    assert.equal(new URL(page.url()).pathname, `/LabRat${project}/overview`);
    await page.screenshot({ path: path.join(output, "workbook-review.png") });
    await clickTab("Browser", "browser");
    assert.equal(await page.getByLabel("Cell A1", { exact: true }).count(), 0);
    await page.goBack(); await waitPath(`${project}/overview`);
    await page.getByRole("button", { name: "View confirmed regions", exact: true }).first().waitFor();
    assert.equal(await page.getByLabel("Cell A1", { exact: true }).count(), 0);
    checks.push("real workbook review opens; main navigation closes it without replay");

    await page.goto(`${base}/unknown-page`); await page.getByRole("heading", { name: "Page not found" }).waitFor();
    await page.getByRole("button", { name: "Back to projects" }).click(); await waitPath("/labs/lab_analysis/projects");
    await page.goto(`${base}/projects/missing/overview`); await page.getByRole("heading", { name: "Workspace unavailable" }).waitFor();
    checks.push("unknown path and missing project recovery");
    const archived = await context.request.patch(`${origin}/api/v1/projects/${secondId}`, { data: { status: "archived" } });
    assert.equal(archived.status(), 200);
    await page.goto(`${base}/projects/${secondId}/overview`); await page.getByRole("heading", { name: "Workspace unavailable" }).waitFor();
    checks.push("archived project cannot reopen");
    await page.goto(`${base}${project}/manuscript`); await page.getByRole("region", { name: "Page 1", exact: true }).waitFor();
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await context.request.post(`${origin}/api/v1/auth/logout`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Log in", exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog", { name: "Save your changes?" }).count(), 0);
    assert.equal(await page.locator(".canvas-page").count(), 0);
    checks.push("real expired session clears a dirty workspace without prompting");
    await login("reviewer"); await waitPath(`${project}/manuscript`);
    await page.getByText(/Read-only access/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
    await pool.query("update project_access_grants set status='inactive' where user_id='user_reviewer'");
    await clickTab("Browser", "browser");
    await page.getByRole("heading", { name: "Workspace unavailable" }).waitFor();
    assert.equal(await page.locator(".canvas-page").count(), 0);
    checks.push("read-only deep link and actual project permission revocation");
    assert.deepEqual(errors, []);
    assert.equal(network.some((entry) => /net::ERR_(CONNECTION|FAILED)/.test(entry)), false, network.join("\n"));
    assert.equal(await buildHash(), testedBuild, "Build changed during browser acceptance; run after the build finishes.");
    assert.equal((await pool.query("select count(*)::int count from analysis_runs")).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int count from data_snapshots")).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int count from chart_specs")).rows[0].count, 0);
    checks.push("navigation creates no analysis, snapshot or chart");
    await writeFile(path.join(output, "result.json"), JSON.stringify({ status: "passed", startedAt, completedAt: new Date().toISOString(), testedBuild, environment: "Production build, actual Chromium/HTTP/PostgreSQL, synthetic records, no provider", checks, errors, writes, network }, null, 2));
    console.log("PASS routing browser acceptance", checks);
  } catch (error) {
    console.error(viteLog);
    if (page) {
      console.error((await page.locator("body").innerText()).slice(-5000));
      await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    }
    console.error(network);
    const failure = { status: "failed", startedAt, testedBuild, message: error.message, checks, errors, writes, network };
    await writeFile(path.join(output, "failure.json"), JSON.stringify(failure, null, 2));
    await writeFile(path.join(output, "result.json"), JSON.stringify(failure, null, 2));
    throw error;
  } finally {
    await browser?.close(); if (vite?.exitCode === null) vite.kill(); if (viteClosed) await viteClosed;
    await app?.close(); await pool.end();
  }
});
