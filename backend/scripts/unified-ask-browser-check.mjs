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
const output = path.join(root, ".tmp/unified-ask-browser"); await mkdir(output, { recursive: true });
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
      if (input.selectedContext?.referenceDocuments?.length) {
        const ref = input.selectedContext.referenceDocuments[0];
        const hits = await tools.search_project_documents({ query: 'sample' });
        const hit = hits.items.find(item => item.target.versionId === ref.versionId);
        ({ evidence } = await tools.read_document_passage({ versionId: hit.target.versionId, passageId: hit.target.passageId }));
        text = 'The selected reference requires a dry sample.'; quote = 'dry sample';
      } else if (input.question.includes("empty file")) {
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
      page.on("console", (message) => { if (/Encountered two children with the same key/.test(message.text())) errors.push(message.text()); });
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
    const assertLibraryClosed = async () => {
      assert.equal(await owner.getByRole("region", { name: "Reference library" }).count(), 0, "Leaving References must unmount the library without orphaned content");
      assert.equal(await owner.getByRole("button", { name: "Add reference", exact: true }).count(), 0);
    };
    for (let cycle = 0; cycle < 3; cycle++) {
      await owner.getByRole("button", { name: "References", exact: true }).click();
      const currentLibrary = owner.getByRole("region", { name: "Reference library" });
      await currentLibrary.waitFor();
      assert.equal(await currentLibrary.count(), 1);
      const navigation = await owner.locator(".topbar").boundingBox(), content = await currentLibrary.boundingBox();
      assert.ok(content.y >= navigation.y + navigation.height, "Reference library belongs below the workspace navigation");
      await owner.getByRole("button", { name: "Overview", exact: true }).click();
      await owner.getByRole("heading", { name: "Analysis Project", exact: true }).waitFor();
      await assertLibraryClosed();
    }
    for (const destination of ["Browser", "Manuscript", "Home"]) {
      await owner.getByRole("button", { name: "References", exact: true }).click();
      await owner.getByRole("region", { name: "Reference library" }).waitFor();
      await owner.getByRole("button", { name: destination, exact: true }).click();
      await assertLibraryClosed();
    }
    await owner.getByRole("heading", { name: "Projects", exact: true }).waitFor();
    await owner.getByRole("button", { name: "Open", exact: true }).click();
    await owner.getByRole("button", { name: "Overview", exact: true }).waitFor();
    await owner.getByRole("heading", { name: "Analysis Project", exact: true }).waitFor();
    await assertLibraryClosed();
    await owner.screenshot({ path: path.join(output, "reference-library-closed-desktop.png"), fullPage: true });
    await owner.getByRole("button", { name: "Ask", exact: true }).click();
    const panel = owner.getByRole("complementary", { name: "Ask LabRat panel" });
    await panel.waitFor();
    const draft = panel.getByRole("textbox", { name: "Ask LabRat", exact: true });
    await draft.fill("Navigation should keep this unsent question");
    await panel.getByRole("button", { name: "Library", exact: true }).click();
    await owner.getByRole("region", { name: "Reference library" }).waitFor();
    await panel.getByRole("button", { name: "Close Lab Rat panel", exact: true }).click();
    await owner.waitForFunction(() => !document.querySelector(".agent.open"));
    assert.equal(await owner.getByRole("region", { name: "Reference library" }).count(), 1, "Closing Ask preserves the selected workspace");
    await owner.getByRole("button", { name: "Overview", exact: true }).click();
    await assertLibraryClosed();
    await owner.getByRole("button", { name: "Ask", exact: true }).click();
    await panel.waitFor();
    assert.equal(await draft.inputValue(), "Navigation should keep this unsent question");
    assert.equal(await panel.count(), 1, "Navigation must not duplicate the assistant");
    await draft.fill("");
    assert.equal(await owner.getByText("Source questions", { exact: true }).count(), 0);
    await panel.locator('input[type="file"]').setInputFiles({ name: "unified-method.txt", mimeType: "text/plain", buffer: Buffer.from("The protocol requires a dry sample.") });
    await panel.getByRole("button", { name: "Send message", exact: true }).click();
    await panel.getByText("unified-method.txt was added to the reference library.").waitFor();
    await panel.getByRole("button", { name: "Send message", exact: true }).waitFor({ state: "visible" });
    await owner.waitForFunction(() => !document.querySelector('button[aria-label="Send message"]').disabled);
    assert.equal(await panel.getByLabel("Attached files", { exact: true }).count(), 0, "Sent files leave the composer attachment list");
    assert.equal(await panel.getByLabel("Selected references", { exact: true }).count(), 0, "Upload-only messages must not preselect their files for the next question");
    await owner.screenshot({ path: path.join(output, "reference-upload-composer-cleared.png"), fullPage: false });
    const input = panel.getByRole("textbox", { name: "Ask LabRat", exact: true });
    await input.fill("@unified");
    await panel.getByRole("option").filter({ hasText: "unified-method.txt" }).click();
    await input.fill("What sample does this method require?");
    await input.press("Enter");
    await panel.getByText("The selected reference requires a dry sample.", { exact: true }).waitFor();
    await panel.locator(".qa-citations button").last().click();
    await owner.getByRole("dialog").getByText("The protocol requires a dry sample.", { exact: true }).waitFor();
    await owner.keyboard.press("Escape");
    await owner.screenshot({ path: path.join(output, "unified-ask-desktop.png"), fullPage: true });
    await panel.getByRole("button", { name: "Library", exact: true }).click();
    const library = owner.getByRole("region", { name: "Reference library" });
    await library.getByLabel("Search references").fill("unified-method");
    const row = library.locator(".reference-row").filter({ hasText: "unified-method.txt" });
    await row.waitFor();
    await row.getByRole("button", { name: "New version", exact: true }).click();
    await library.locator('input[type="file"]').setInputFiles({ name: "unified-method.txt", mimeType: "text/plain", buffer: Buffer.from("Revised method uses a sealed sample.") });
    await row.getByText(/v2 · ready/).waitFor();
    await row.getByRole("button", { name: "Versions", exact: true }).click();
    await library.getByRole("button", { name: "Version 1", exact: true }).click();
    await owner.getByRole("dialog").getByText("The protocol requires a dry sample.", { exact: true }).waitFor();
    await owner.keyboard.press("Escape");
    await owner.screenshot({ path: path.join(output, "reference-library-desktop.png"), fullPage: true });
    await row.getByRole("button", { name: "Archive", exact: true }).click();
    await library.getByText("No references match these filters.", { exact: true }).waitFor();
    await panel.locator(".qa-citations button").last().click();
    await owner.getByRole("dialog").getByText("The protocol requires a dry sample.", { exact: true }).waitFor();
    await owner.keyboard.press("Escape");
    await library.getByLabel("Search references").fill("browser-scan");
    await library.getByRole("button", { name: "Add reference", exact: true }).click();
    await library.locator('input[type="file"]').setInputFiles({ name: "browser-scan.pdf", mimeType: "application/pdf", buffer: syntheticPdf([
      { text: ["Cooling protocol", ...Array.from({ length: 10 }, (_, index) => `Dry sample preparation note ${index + 1}.`)] },
      { scan: {} }, { scan: { chinese: true } },
    ]) });
    const pdfRow = library.locator(".reference-row").filter({ hasText: "browser-scan.pdf" });
    await pdfRow.getByText(/v1 · (ready|partial)/).waitFor();
    await pdfRow.getByRole("button", { name: "browser-scan.pdf", exact: true }).click();
    const pdfDialog = owner.getByRole("dialog");
    const waitPdfPage = async (pageNumber) => {
      const image = pdfDialog.getByRole("img", { name: `Original browser-scan.pdf, page ${pageNumber}`, exact: true });
      await image.waitFor();
      await owner.waitForFunction((page) => {
        const img = document.querySelector(`dialog img[alt="Original browser-scan.pdf, page ${page}"]`);
        return img?.complete && img.naturalWidth > 0;
      }, pageNumber);
    };
    await waitPdfPage(1);
    assert.equal(await pdfDialog.getByRole("option").count(), 3, "PDF pages cannot be limited by the first eight passages");
    assert.equal(await pdfDialog.getByLabel("Passage", { exact: true }).count(), 0);
    assert.equal(await pdfDialog.locator(".qa-source-highlight").count(), 0, "Library reading shows a clean full page");
    await pdfDialog.evaluate(el => { el.scrollTop = 500; });
    await pdfDialog.getByRole("button", { name: "Next page", exact: true }).click();
    await waitPdfPage(2);
    assert.equal(await pdfDialog.evaluate(el => el.scrollTop), 0, "Turning the page returns to its top");
    await owner.screenshot({ path: path.join(output, "pdf-pages-desktop.png"), fullPage: false });
    await pdfDialog.getByRole("combobox", { name: "Page", exact: true }).selectOption("3");
    await waitPdfPage(3);
    assert.equal(await pdfDialog.getByRole("button", { name: "Next page", exact: true }).isDisabled(), true);
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.screenshot({ path: path.join(output, "pdf-pages-mobile.png"), fullPage: false });
    assert.ok(await pdfDialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "PDF controls fit the narrow dialog");
    await owner.keyboard.press("Escape");
    await owner.setViewportSize({ width: 1440, height: 1000 });
    if (!await owner.locator(".agent.open").count()) await owner.getByRole("button", { name: "Ask", exact: true }).click();
    await panel.waitFor();
    await input.fill("What temperature does the scan document?"); await input.press("Enter");
    await panel.getByText("The scanned protocol states 80 C.", { exact: true }).waitFor();
    await panel.locator(".qa-citations button").last().click();
    await waitPdfPage(2);
    await pdfDialog.locator(".qa-source-highlight").first().waitFor();
    await pdfDialog.getByRole("button", { name: "Next page", exact: true }).click();
    await waitPdfPage(3);
    assert.equal(await pdfDialog.locator(".qa-source-highlight").count(), 0);
    await pdfDialog.getByRole("button", { name: "Return to cited page 2", exact: true }).click();
    await waitPdfPage(2);
    await pdfDialog.locator(".qa-source-highlight").first().waitFor();
    await owner.screenshot({ path: path.join(output, "pdf-pages-citation.png"), fullPage: false });
    await owner.keyboard.press("Escape");
    await owner.reload();
    await owner.getByRole("button", { name: "Open", exact: true }).click();
    await owner.getByRole("button", { name: "Ask", exact: true }).click();
    await panel.getByText("The selected reference requires a dry sample.", { exact: true }).waitFor();
    await input.fill("Calculate the mean temperature"); await input.press("Enter");
    await panel.getByRole("button", { name: "Prepare analysis plan", exact: true }).waitFor();
    await panel.locator('input[type="file"]').setInputFiles({ name: "unified-data.xlsx", mimeType: "application/octet-stream", buffer: researchWorkbook("xlsx") });
    await input.fill("What are the reviewed conditions in this workbook?"); await input.press("Enter");
    const pendingTask = panel.getByRole("region", { name: "Saved questions to continue" });
    await pendingTask.getByRole("button", { name: "Open review", exact: true }).waitFor();
    assert.equal(await pendingTask.getByRole("button", { name: "Continue question", exact: true }).isEnabled(), false);
    await owner.reload();
    await owner.getByRole("button", { name: "Open", exact: true }).click();
    await owner.getByRole("button", { name: "Ask", exact: true }).click();
    await pendingTask.getByText("What are the reviewed conditions in this workbook?", { exact: true }).waitFor();
    await owner.screenshot({ path: path.join(output, "workbook-pending-question.png"), fullPage: true });
    const otherDevice = await login("owner");
    assert.equal(await otherDevice.evaluate(() => JSON.stringify(localStorage).includes("What are the reviewed conditions in this workbook?")), false);
    await otherDevice.getByRole("button", { name: "Ask", exact: true }).click();
    const otherPanel = otherDevice.getByRole("complementary", { name: "Ask LabRat panel" });
    const otherTask = otherPanel.getByRole("region", { name: "Saved questions to continue" });
    await otherTask.getByText("What are the reviewed conditions in this workbook?", { exact: true }).waitFor();
    assert.equal(await otherTask.getByRole("button", { name: "Continue question", exact: true }).isEnabled(), false);
    const opened = otherDevice.waitForResponse(response => response.url().includes("/workbook-review-sessions/") && response.request().method() === "GET" && response.status() === 200);
    await otherTask.getByRole("button", { name: "Open review", exact: true }).click(); await opened;
    await otherDevice.screenshot({ path: path.join(output, "task-other-device-review.png"), fullPage: true });
    const savedTask = (await pool.query("select * from assistant_tasks where actor_user_id='user_owner' and status='waiting'")).rows[0];
    const uploadedWorkbook = savedTask.attachments[0];
    // Fixture confirmation isolates task recovery from the already-tested semantic-review UI.
    await pool.query(`insert into workbook_review_regions(id,lab_id,project_id,workbook_review_session_id,source_document_id,
      sheet_name,range_ref,selection_method,disposition,review_status,version,warnings,created_at,updated_at,created_by)
      values('task_region','lab_analysis','project_analysis',$1,$2,'Measurements','A1:G2','manual','active','accepted',1,'[]',now(),now(),'user_owner')`,
      [uploadedWorkbook.workbookReviewSessionId, uploadedWorkbook.sourceDocumentId]);
    await pool.query(`insert into region_understanding_revisions(id,lab_id,project_id,workbook_review_session_id,source_document_id,region_id,
      revision_number,trigger,user_feedback,summary,interpretation,source_refs,source_content_hash,dependency_hash,validation,provider,warnings,confidence,created_at,created_by)
      select 'task_revision',lab_id,project_id,$1,$2,'task_region',1,trigger,user_feedback,summary,interpretation,source_refs,source_content_hash,
      dependency_hash,validation,provider,warnings,confidence,now(),created_by from region_understanding_revisions where id='revision_analysis'`,
      [uploadedWorkbook.workbookReviewSessionId, uploadedWorkbook.sourceDocumentId]);
    await pool.query("update workbook_review_regions set current_revision_id='task_revision',accepted_revision_id='task_revision' where id='task_region'");
    await otherDevice.reload(); await otherDevice.getByRole("button", { name: "Open", exact: true }).click();
    await otherDevice.getByRole("button", { name: "Ask", exact: true }).click();
    await otherTask.getByText("Ready to continue", { exact: true }).waitFor();
    await otherDevice.setViewportSize({ width: 390, height: 844 });
    await otherDevice.waitForFunction(() => { const panel = document.querySelector(".agent.open"); return panel && panel.scrollWidth <= panel.clientWidth + 1; });
    await otherTask.scrollIntoViewIfNeeded();
    await otherDevice.screenshot({ path: path.join(output, "task-other-device-mobile.png"), fullPage: false });
    await otherTask.getByRole("button", { name: "Continue question", exact: true }).click();
    await otherPanel.getByText("The saved goal is to study catalyst stability.", { exact: true }).waitFor();
    await otherDevice.screenshot({ path: path.join(output, "task-other-device-continued.png"), fullPage: true });
    assert.equal((await pool.query("select count(*)::int count from research_qa_requests where request_key=$1", [`task-${savedTask.id}`])).rows[0].count, 1);
    await panel.getByText("The saved goal is to study catalyst stability.", { exact: true }).waitFor();
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.waitForFunction(() => { const r = document.querySelector(".agent.open").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; });
    await owner.screenshot({ path: path.join(output, "unified-ask-mobile.png"), fullPage: false });
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await panel.getByRole("button", { name: "Library", exact: true }).click();
    await library.waitFor();
    await owner.waitForFunction(() => !document.querySelector(".agent.open"));
    await library.locator(".reference-row").first().waitFor();
    await owner.screenshot({ path: path.join(output, "reference-library-mobile.png"), fullPage: true });
    await owner.getByRole("button", { name: "Overview", exact: true }).click();
    await assertLibraryClosed();
    await owner.screenshot({ path: path.join(output, "reference-library-closed-mobile.png"), fullPage: true });
    const viewer = await login("reviewer");
    await viewer.getByRole("button", { name: "Ask", exact: true }).click();
    const viewPanel = viewer.getByRole("complementary", { name: "Ask LabRat panel" });
    assert.equal(await viewPanel.getByRole("button", { name: "Add files", exact: true }).count(), 0);
    assert.equal(await viewPanel.getByText("The selected reference requires a dry sample.", { exact: true }).count(), 0);
    await viewPanel.getByRole("textbox", { name: "Ask LabRat", exact: true }).fill("Read the accepted temperature for Exp17");
    await viewPanel.getByRole("button", { name: "Send message", exact: true }).click();
    await viewPanel.getByText("Exp17 has accepted Temperature 82 C.", { exact: true }).waitFor();
    await viewPanel.getByRole("button", { name: "Library", exact: true }).click();
    assert.equal(await viewer.getByRole("button", { name: "Add reference", exact: true }).count(), 0);
    assert.equal(await viewer.getByRole("button", { name: "Archive", exact: true }).count(), 0);
    await viewer.getByRole("region", { name: "Reference library" }).getByRole("button", { name: "browser-scan.pdf", exact: true }).click();
    await viewer.getByRole("dialog").getByRole("combobox", { name: "Page", exact: true }).selectOption("3");
    await viewer.getByRole("img", { name: "Original browser-scan.pdf, page 3", exact: true }).waitFor();
    await viewer.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    assert.equal(network.some(line => / \/api\/(?!v1\/)/.test(line)), false);
    assert.equal((await pool.query("select count(*)::int count from analysis_runs")).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int count from data_snapshots")).rows[0].count, 2);
    await writeFile(path.join(output, "result.json"), JSON.stringify({ status: "passed", provider: "deterministic substitute", coverage: ["one conversation", "library repeated open/close and workspace navigation", "closing Ask preserves the active library and composer draft", "upload and mention", "precise old-version citation", "library search/version/archive", "View Q&A and no mutations", "Excel pending task after reload", "second independent browser session opens review and continues", "fixture-confirmed region eligibility", "one linked question across devices", "first device recovers answer", "reviewed analysis boundary", "390px layout"], errors }, null, 2));
    console.log("PASS unified Ask browser acceptance with real HTTP/PostgreSQL and a provider substitute.");
  } catch (error) {
    console.error(viteLog);
    console.error(network.slice(-45).join("\n"));
    await writeFile(path.join(output, "failure.json"), JSON.stringify({ errors, network, message: error.message }, null, 2));
    for (const [index, page] of pages.entries()) { console.error((await page.locator("body").innerText()).slice(-6500)); await page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true }).catch(() => {}); }
    throw error;
  } finally {
    await browser?.close(); if (vite?.exitCode === null) vite.kill(); if (viteClosed) await viteClosed;
    await app?.close(); await pool.end(); await rm(storage, { recursive: true, force: true });
  }
});
