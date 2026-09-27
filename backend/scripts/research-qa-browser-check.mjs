// Actual HTTP, PostgreSQL and Chromium. Only the provider is a deterministic substitute.
import "reflect-metadata";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { createV1Application } from "../dist-v1/v1/bootstrap.js";
import { V1_MODEL_PROVIDER } from "../dist-v1/v1/platform/model/model-provider.js";
import { seedAnalysisScenario } from "../dist-v1/v1/testing/analysis-review-fixture.js";
import { applyTestMigrations, withTestSchema } from "../dist-v1/v1/testing/postgres-test-database.js";
import { seedResearchCorpus } from "../dist-v1/v1/research-qa/testing/research-qa-scenario.js";
import { syntheticDoc, syntheticDocx, syntheticPdf } from "../src/research/testing/documentFixtures.js";
import { researchWorkbook } from "../src/research/testing/researchQaCorpus.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databaseUrl = process.env.LABRAT_TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1") throw new Error("Use the dedicated loopback test database.");
const { chromium } = await import(pathToFileURL(process.env.LABRAT_QA_PLAYWRIGHT).href);
const output = path.join(root, ".tmp/research-qa-browser"); await mkdir(output, { recursive: true });
const base = "http://127.0.0.1:5197/LabRat/";
await withTestSchema(databaseUrl, async ({ databaseUrl: isolated }) => {
  await applyTestMigrations(isolated); await seedAnalysisScenario(isolated);
  const storage = await mkdtemp(path.join(os.tmpdir(), "labrat-qa-browser-"));
  const pool = new Pool({ connectionString: isolated });
  let app, vite, viteClosed, browser;
  let viteLog = "";
  const errors = [], network = [], pages = [];
  try {
    Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: isolated, LABRAT_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "", LABRAT_FILE_STORAGE_ROOT: storage });
    app = await createV1Application({ logger: false });
    const fixture = await seedResearchCorpus(app, isolated);
    const provider = app.get(V1_MODEL_PROVIDER);
    let retryFailure = true;
    provider.publicConfig = () => ({ configured: true, provider: "test-substitute", model: "synthetic-browser-only" });
    provider.answerResearchQuestion = async (input, { toolHandlers: tools, signal }) => {
      if (input.question.includes("fail once") && retryFailure) {
        retryFailure = false; return { ok: false, warning: { code: "ai_request_failed", message: "HTTP 429" } };
      }
      if (input.question.includes("slow")) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      let evidence, text, quote, numericBindings = [];
      if (input.question.includes("empty file")) {
        const search = await tools.search_project_documents({ query: "空白项目资料.txt" });
        const hit = search.items.find((item) => item.kind === "document");
        ({ evidence } = await tools.read_document_passage({ versionId: hit.target.versionId, passageId: hit.target.passageId }));
        text = "The uploaded note requires a dry sample."; quote = "Use a dry sample.";
      } else if (input.question.includes("accepted")) {
        await tools.find_experiments({ query: "Exp17" });
        ({ evidence } = await tools.read_experiment_evidence({ experimentId: "experiment_17", snapshotId: "snapshot_experiment_17" }));
        text = "Exp17 has accepted Temperature 82 C."; quote = "Temperature";
        numericBindings = [{ evidenceId: evidence.id, path: "/data/fields/0/value", value: 82, unit: "C", numericScale: null }];
      } else if (input.question.includes("scan")) {
        const search = await tools.search_project_documents({ query: "Temperature" });
        const found = search.items.find((item) => item.kind === "document" && item.label === "browser-scan.pdf");
        assert.ok(found, "Browser-uploaded scan is immediately retrievable");
        ({ evidence } = await tools.read_document_passage({ versionId: found.target.versionId, passageId: found.target.passageId }));
        text = "The scanned protocol states 80 C."; quote = evidence.data.text;
      } else if (input.question.includes("cache")) {
        ({ evidence } = await tools.read_workbook_source({ sourceDocumentId: fixture.sources.workbook.id, sheetName: "Measurements", range: "G2" }));
        text = "The formula has no saved cached value."; quote = "B2*2";
      } else if (input.question.includes("raw")) {
        ({ evidence } = await tools.read_workbook_source({ sourceDocumentId: fixture.sources.workbook.id, sheetName: "Measurements", range: "B2" }));
        text = "The raw cell contains 80. This is raw workbook evidence."; quote = "80";
        numericBindings = [{ evidenceId: evidence.id, path: "/data/cells/0/rawValue", value: 80, unit: null, numericScale: null }];
      } else {
        ({ evidence } = await tools.get_project_context({}));
        text = "The saved goal is to study catalyst stability."; quote = "Study catalyst stability";
      }
      return { ok: true, status: "answered", claims: [{ text, citations: [{ evidenceId: evidence.id, quote }], numericBindings }], missingEvidence: [] };
    };
    await app.listen({ host: "127.0.0.1", port: 8797 });
    const frontendMode = process.env.LABRAT_QA_FRONTEND_MODE === "preview" ? ["preview"] : ["--mode", "blank"];
    vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), ...frontendMode, "--host", "127.0.0.1", "--port", "5197", "--strictPort"],
      { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VITE_LABRAT_API_PROXY_TARGET: "http://127.0.0.1:8797" } });
    viteClosed = once(vite, "close");
    for (const stream of [vite.stdout, vite.stderr]) stream.on("data", (chunk) => { viteLog = (viteLog + chunk).slice(-4000); });
    let ready = false;
    for (let i = 0; i < 100 && vite.exitCode === null; i++) {
      try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Startup only. */ }
      await delay(150);
    }
    assert.ok(ready, viteLog);
    browser = await chromium.launch({ executablePath: process.env.LABRAT_QA_CHROMIUM, headless: true });
    const login = async (username) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
      const page = await context.newPage(); pages.push(page);
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("requestfailed", (request) => network.push(`FAILED ${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
      page.on("response", (response) => { if (response.url().includes("/api/")) network.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`); });
      await page.goto(base); await page.getByRole("button", { name: "Log in", exact: true }).click();
      await page.getByLabel("Username", { exact: true }).fill(username); await page.getByLabel("Password", { exact: true }).fill("LabRatTest123!");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await page.getByRole("button", { name: "Overview", exact: true }).waitFor();
      return page;
    };
    const owner = await login("owner");
    await owner.getByRole("button", { name: "Ask", exact: true }).click();
    await owner.getByText(/Project sources ·/).click();
    const files = [
      ["browser-notes.txt", Buffer.from("Browser sample: a dry sample only.")], ["browser-method.doc", syntheticDoc()], ["browser-table.docx", syntheticDocx()],
      ["browser-text.pdf", syntheticPdf([{ text: ["Browser protocol: 80 C, dry samples only."] }])],
      ["browser-scan.pdf", syntheticPdf([{ scan: {} }])], ["browser-raw.xls", researchWorkbook("xls")], ["browser-raw.xlsx", researchWorkbook("xlsx")],
    ].map(([name, buffer]) => ({ name, mimeType: "application/octet-stream", buffer }));
    await owner.getByLabel("Upload PDF, Word, TXT or Excel").setInputFiles(files);
    await owner.getByRole("button", { name: "browser-raw.xlsx", exact: true }).waitFor({ timeout: 90_000 });
    await owner.getByRole("button", { name: "browser-scan.pdf", exact: true }).click();
    const dialog = owner.getByRole("dialog"); await dialog.waitFor();
    await owner.waitForFunction(() => { const img = document.querySelector(".qa-pdf-page img"); return img?.complete && img.naturalWidth > 0; });
    assert.ok(await owner.locator(".qa-source-highlight").count());
    await owner.screenshot({ path: path.join(output, "original-scan.png"), fullPage: true });
    await owner.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    await owner.getByRole("button", { name: "browser-method.doc", exact: true }).click();
    await owner.getByRole("dialog").getByText(/paragraph/).first().waitFor();
    await owner.keyboard.press("Escape");
    const ask = async (page, question, expected) => {
      await page.getByLabel("Question about project sources").fill(question);
      await page.getByRole("button", { name: "Ask with citations", exact: true }).click();
      await page.getByText(expected, { exact: true }).waitFor({ timeout: 20_000 });
    };
    await ask(owner, "Read the scan temperature", "The scanned protocol states 80 C.");
    await owner.locator(".qa-citations").getByRole("button").first().click();
    await owner.waitForFunction(() => { const img = document.querySelector(".qa-pdf-page img"); return img?.complete && img.naturalWidth > 0; });
    await owner.keyboard.press("Escape");
    // Historical citations must survive a same-name new version and archive.
    await owner.getByLabel("Upload PDF, Word, TXT or Excel").setInputFiles({ name: "browser-scan.pdf", mimeType: "application/pdf",
      buffer: syntheticPdf([{ text: ["Revised browser protocol: Temperature 95 C for dry samples."] }]) });
    const scanRow = owner.locator(".qa-source-row").filter({ has: owner.getByRole("button", { name: "browser-scan.pdf", exact: true }) });
    await scanRow.getByText(/Ready for questions · v2/).waitFor();
    await scanRow.getByRole("button", { name: "Archive", exact: true }).click();
    await scanRow.waitFor({ state: "hidden" });
    await owner.locator(".qa-citations").getByRole("button").first().click();
    await owner.getByRole("dialog").getByText(/Temperature: 80 C/).waitFor();
    await owner.keyboard.press("Escape");
    await owner.getByRole("button", { name: "Analysis & manuscript", exact: true }).click();
    await owner.getByRole("button", { name: "Source questions", exact: true }).click();
    await owner.getByRole("button", { name: "Close Ask LabRat" }).click();
    await owner.getByRole("button", { name: "Browser", exact: true }).click(); await owner.getByRole("button", { name: "Manuscript", exact: true }).click();
    assert.equal(errors.length, 0);

    const viewer = await login("reviewer"); await viewer.getByRole("button", { name: "Ask", exact: true }).click();
    assert.equal(await viewer.getByRole("button", { name: "Upload sources", exact: true }).count(), 0);
    await ask(viewer, "Read accepted temperature Exp17", "Exp17 has accepted Temperature 82 C.");
    await viewer.locator(".qa-citations").getByRole("button").first().focus(); await viewer.keyboard.press("Enter");
    await viewer.getByRole("dialog").getByRole("cell", { name: "82", exact: true }).waitFor(); await viewer.keyboard.press("Escape");
    await viewer.reload(); await viewer.getByRole("button", { name: "Open", exact: true }).click(); await viewer.getByRole("button", { name: "Ask", exact: true }).click();
    await viewer.getByText("Exp17 has accepted Temperature 82 C.", { exact: true }).waitFor();
    await ask(viewer, "Read raw B2", "The raw cell contains 80. This is raw workbook evidence.");
    await viewer.locator(".qa-citations").getByRole("button").first().click(); await viewer.getByRole("dialog").getByRole("rowheader", { name: "B2", exact: true }).waitFor();
    await viewer.keyboard.press("Escape");
    await ask(viewer, "Read missing formula cache", "The formula has no saved cached value.");
    await viewer.locator(".qa-citations").getByRole("button").first().click();
    await viewer.getByRole("dialog").getByText("B2*2 · no cached value", { exact: true }).waitFor();
    await viewer.getByRole("dialog").getByRole("cell", { name: "Missing", exact: true }).waitFor();
    await viewer.keyboard.press("Escape");
    await ask(viewer, "fail once then read context", "The model service is rate limited. Retry later.");
    await viewer.getByRole("button", { name: "Retry question", exact: true }).click();
    await viewer.getByText("The saved goal is to study catalyst stability.", { exact: true }).waitFor();
    await ask(viewer, "Calculate the mean", "This needs a reviewed analysis plan");
    assert.equal(await viewer.getByRole("button", { name: "Prepare a reviewed analysis plan", exact: true }).count(), 0);
    await viewer.getByLabel("Question about project sources").fill("slow source question"); await viewer.getByRole("button", { name: "Ask with citations", exact: true }).click();
    await viewer.getByRole("button", { name: "Cancel question", exact: true }).click(); await viewer.getByText("Question cancelled. No answer was saved.", { exact: true }).waitFor();
    await ask(viewer, "Read accepted temperature Exp17", "Exp17 has accepted Temperature 82 C.");
    await viewer.setViewportSize({ width: 390, height: 844 });
    const bounds = await viewer.locator(".qa-panel").boundingBox(); assert.ok(bounds.width <= 391 && bounds.x >= -1);
    await viewer.screenshot({ path: path.join(output, "view-questions-narrow.png"), fullPage: true });
    await viewer.setViewportSize({ width: 1440, height: 1000 });
    await viewer.screenshot({ path: path.join(output, "view-questions-desktop.png"), fullPage: true });
    await pool.query("update project_access_grants set status='inactive' where user_id='user_reviewer'");
    await viewer.reload(); await viewer.getByText("Waiting for your lab owner to assign project access.", { exact: true }).waitFor();
    const selected = await login("selected");
    assert.equal(await selected.getByRole("button", { name: "Ask", exact: true }).isEnabled(), false);
    await pool.query("insert into public_guest_accounts(user_id, project_id, created_by) values('user_selected', 'project_analysis', 'user_owner')");
    const guest = await login("selected");
    assert.equal(await guest.getByRole("button", { name: "Ask", exact: true }).isEnabled(), false);
    const empty = await app.inject({ method: "POST", url: "/api/v1/projects", headers: { cookie: fixture.cookie },
      payload: { labId: "lab_analysis", name: "Empty Q&A Project" } });
    assert.equal(empty.statusCode, 201, empty.body);
    await owner.reload();
    await owner.getByRole("row").filter({ hasText: "Empty Q&A Project" }).getByRole("button", { name: "Open", exact: true }).click();
    await owner.getByRole("button", { name: "Ask about sources", exact: true }).click();
    await owner.getByText(/Project sources ·/).click();
    await owner.getByLabel("Upload PDF, Word, TXT or Excel").setInputFiles({ name: "空白项目资料.txt", mimeType: "text/plain", buffer: Buffer.from("Use a dry sample.") });
    await owner.getByText(/Ready for questions · v1/).waitFor();
    await owner.getByRole("button", { name: "空白项目资料.txt", exact: true }).waitFor();
    await ask(owner, "Read the empty file", "The uploaded note requires a dry sample.");
    await owner.locator(".qa-citations").getByRole("button").first().click();
    await owner.getByRole("dialog").getByText("Use a dry sample.", { exact: true }).waitFor();
    await owner.keyboard.press("Escape");
    await owner.screenshot({ path: path.join(output, "empty-project-questions.png"), fullPage: true });
    assert.equal((await pool.query("select count(*)::int count from analysis_runs")).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int count from chart_specs")).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int count from data_snapshots")).rows[0].count, 2);
    assert.deepEqual(errors, []);
    assert.equal(network.some((line) => / \/api\/(?!v1\/)/.test(line)), false);
    await writeFile(path.join(output, "result.json"), JSON.stringify({ status: "passed", provider: "deterministic substitute", database: "isolated PostgreSQL", frontend: process.env.LABRAT_QA_FRONTEND_MODE === "preview" ? "production build" : "development server",
      coverage: ["all seven formats uploaded in UI", "actual scanned PDF OCR and highlight", "DOC paragraph source", "cited document/accepted/raw answers",
        "View/selected/Guest permissions", "review boundary", "cancel", "refresh", "revocation", "keyboard", "narrow screen", "Browser and manuscript navigation",
        "formula cache absence", "provider error and explicit retry", "old citation after new version and archive", "empty-project source Q&A", "Unicode filename", "workflow return"], errors }, null, 2));
    console.log("PASS research Q&A browser acceptance with real HTTP/PostgreSQL/OCR and a provider substitute.");
  } catch (error) {
    console.error(viteLog);
    console.error(network.slice(-45).join("\n"));
    for (const [index, page] of pages.entries()) { console.error((await page.locator("body").innerText()).slice(-6500)); await page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true }).catch(() => {}); }
    throw error;
  } finally {
    await browser?.close(); if (vite?.exitCode === null) vite.kill(); if (viteClosed) await viteClosed;
    await app?.close(); await pool.end(); await rm(storage, { recursive: true, force: true });
  }
});
