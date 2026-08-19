import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { createServer } from "../../server.js";
import { ANALYSIS_PLAN_REVISION_VERSION } from "../analysisSchemas.js";
import { loadSaasConfig } from "../config.js";
import { PostgresSaasStore } from "../postgresStore.js";

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function databaseUrlForSchema(rawUrl, schema) {
  const url = new URL(rawUrl);
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", [existing, `-c search_path=${schema}`].filter(Boolean).join(" "));
  return url.toString();
}

async function applyMigrations(databaseUrl) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, "..", "..", "..", "migrations");
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  try {
    for (const file of files) {
      await pool.query(await fs.readFile(path.join(migrationsDir, file), "utf8"));
    }
  } finally {
    await pool.end();
  }
}

function componentDistributionWorkbookBlob() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Label", "C1", "C2", "C3", "C4"],
    ["Overall tots", 5, 12.5, 21, 9.5],
    ["Light fraction", 1, 2, 3, 4],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  return new Blob([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("analysis migrations and Postgres store expose retry receipt persistence parity", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migration = await fs.readFile(
    path.resolve(here, "..", "..", "..", "migrations", "012_analysis_workflow.sql"),
    "utf8",
  );
  for (const table of [
    "analysis_threads",
    "analysis_plan_revisions",
    "analysis_runs",
    "analysis_results",
    "analysis_publications",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}`));
  }
  const retryMigration = await fs.readFile(
    path.resolve(here, "..", "..", "..", "migrations", "015_analysis_retry_receipts.sql"),
    "utf8",
  );
  assert.match(retryMigration, /create table if not exists analysis_thread_retry_receipts/);
  assert.match(retryMigration, /unique\(project_id, idempotency_key\)/);
  assert.match(retryMigration, /lease_expires_at timestamptz/);
  assert.match(retryMigration, /analysis_plan_revision_id text references analysis_plan_revisions/);
  const resetMigration = await fs.readFile(
    path.resolve(here, "..", "..", "..", "migrations", "017_reset_analysis_v2.sql"),
    "utf8",
  );
  assert.match(resetMigration, /drop column if exists selection/);
  assert.match(resetMigration, /drop column if exists python_program/);
  assert.match(resetMigration, /drop column if exists plan_hash/);
  const deferredRegionMigration = await fs.readFile(
    path.resolve(here, "..", "..", "..", "migrations", "018_deferred_region_interpretation.sql"),
    "utf8",
  );
  assert.match(deferredRegionMigration, /add column if not exists interpretation_hint jsonb/);
  const experimentBrowserMigration = await fs.readFile(
    path.resolve(here, "..", "..", "..", "migrations", "019_experiment_browser_analysis.sql"),
    "utf8",
  );
  assert.match(experimentBrowserMigration, /create table if not exists analysis_experiment_publications/);
  assert.match(experimentBrowserMigration, /add column if not exists output_target text/);
  const listColumnResetMigration = await fs.readFile(
    path.resolve(here, "..", "..", "..", "migrations", "020_reset_list_column_analysis.sql"),
    "utf8",
  );
  assert.match(listColumnResetMigration, /update data_snapshots/);
  assert.match(listColumnResetMigration, /delete from analysis_experiment_publications/);
  assert.match(listColumnResetMigration, /delete from analysis_plan_revisions/);
  const reusableChartMigration = await fs.readFile(
    path.resolve(here, "..", "..", "..", "migrations", "024_reusable_chart_templates.sql"),
    "utf8",
  );
  for (const table of [
    "chart_style_profiles",
    "chart_style_profile_versions",
    "reusable_chart_templates",
    "reusable_chart_template_versions",
  ]) {
    assert.match(reusableChartMigration, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(reusableChartMigration, /current_version_id text/);
  assert.match(reusableChartMigration, /source_chart_spec_id text not null references chart_specs/);
  const reusableChartApplicationMigration = await fs.readFile(
    path.resolve(here, "..", "..", "..", "migrations", "025_reusable_chart_template_applications.sql"),
    "utf8",
  );
  for (const table of [
    "reusable_chart_template_slot_bindings",
    "reusable_chart_template_applications",
  ]) {
    assert.match(reusableChartApplicationMigration, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(reusableChartApplicationMigration, /unique \(project_id, idempotency_key\)/);
  const store = new PostgresSaasStore({ databaseUrl: "" });
  for (const method of [
    "createAnalysisThread",
    "deleteWorkbookReviewSession",
    "findAnalysisThreadById",
    "listAnalysisThreads",
    "claimAnalysisThreadRetry",
    "releaseAnalysisThreadRetry",
    "completeAnalysisThreadRetry",
    "appendAnalysisPlanRevision",
    "findAnalysisPlanRevisionById",
    "listAnalysisPlanRevisions",
    "findAnalysisRunById",
    "findAnalysisRunByIdempotencyKey",
    "listAnalysisRuns",
    "claimAnalysisRun",
    "finalizeAnalysisRun",
    "createAnalysisResult",
    "findAnalysisResultById",
    "publishAnalysisResult",
    "publishExperimentAnalysis",
    "acceptAnalysisPlan",
    "findChartSpecById",
    "createChartStyleProfile",
    "findChartStyleProfileById",
    "findChartStyleProfileVersionById",
    "listChartStyleProfiles",
    "listChartStyleProfileVersions",
    "appendChartStyleProfileVersion",
    "archiveChartStyleProfile",
    "createReusableChartTemplate",
    "findReusableChartTemplateById",
    "findReusableChartTemplateVersionById",
    "listReusableChartTemplates",
    "listReusableChartTemplateVersions",
    "appendReusableChartTemplateVersion",
    "archiveReusableChartTemplate",
    "listReusableChartTemplateSlotBindings",
    "findReusableChartTemplateApplicationById",
    "findReusableChartTemplateApplicationByIdempotencyKey",
    "createReusableChartTemplateApplication",
    "updateReusableChartTemplateApplication",
  ]) {
    assert.equal(typeof store[method], "function", method);
  }
});

test("Postgres SaaS routes preserve workbook review, source documents, and supported chart specs", {
  skip: !process.env.LABRAT_TEST_DATABASE_URL,
}, async () => {
  const rawUrl = process.env.LABRAT_TEST_DATABASE_URL;
  const schema = `labrat_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const { Pool } = await import("pg");
  const adminPool = new Pool({ connectionString: rawUrl });
  await adminPool.query(`create schema ${quoteIdent(schema)}`);
  const databaseUrl = databaseUrlForSchema(rawUrl, schema);
  let server;
  let store;
  try {
    await applyMigrations(databaseUrl);
    const config = {
      ...loadSaasConfig({
        NODE_ENV: "test",
        SESSION_SECRET: "postgres-test-secret",
        LABRAT_AI_PROVIDER: "anthropic",
        DATABASE_URL: databaseUrl,
        LABRAT_SEED_DEV_ACCOUNTS: "true",
      }),
      fileStorageRoot: path.join(os.tmpdir(), `labrat-postgres-route-test-${Date.now()}`),
    };
    store = new PostgresSaasStore(config);
    await store.initialize();
    const modelProvider = {
      async interpretWorkbookRegion(input) {
        const candidate = input.region?.deterministicCandidate || {};
        return {
          ok: true,
          summary: [
            `The selected range ${input.region?.sheetName}!${input.region?.range} contains a structured table.`,
            "The table contains a component distribution suitable for reviewed extraction.",
          ],
          interpretation: {
            ...candidate,
            semanticType: candidate.semanticType || "component_distribution",
            confidence: 0.9,
            warnings: [],
          },
          metadata: {
            provider: "test",
            model: "postgres-workbook-model",
            latencyMs: 1,
            usage: { inputTokens: 10, outputTokens: 10 },
          },
        };
      },
      async draftAnalysisProgram() {
        return {
          ok: true,
          pythonProgram: {
            runtime: "labrat-python-v2",
            entrypoint: "analyze",
            source: [
              "def analyze(inputs, labrat):",
              "    return {'plotly': {'data': [], 'layout': {}}, 'exclusions': [], 'checks': []}",
            ].join("\n"),
          },
        };
      },
      async draftExperimentBrowserProgram() {
        return {
          ok: true,
          pythonProgram: {
            runtime: "labrat-python-v2",
            entrypoint: "analyze",
            source: [
              "def analyze(inputs, labrat):",
              "    return {'columns': [], 'recordPatches': [], 'exclusions': []}",
            ].join("\n"),
          },
        };
      },
    };
    const analysisExecutor = {
      async executeAcceptedRun(runPackage) {
        const table = runPackage.inputs.tables[0];
        if (runPackage.outputTarget === "experiment_browser") {
          return {
            ok: true,
            adapter: "postgres_test",
            runtime: { version: runPackage.runtimeVersion, exitCode: 0 },
            result: {
              columns: [{
                displayName: "C1",
                valueType: "number",
                unit: null,
              }],
              recordPatches: [{
                label: "Exp30",
                values: [{
                  columnIndex: 0,
                  value: table.values[1][1],
                  formattedValue: table.displayValues[1][1],
                  confidence: 1,
                  warnings: [],
                  sources: [{
                    tableId: table.tableId,
                    rowOffset: 1,
                    columnOffset: 1,
                  }],
                }],
                upsertSeries: [],
                removeSeries: [],
                warnings: [],
              }],
              exclusions: [],
            },
          };
        }
        return {
          ok: true,
          adapter: "postgres_test",
          runtime: { version: runPackage.runtimeVersion, exitCode: 0 },
          result: {
            plotly: {
              data: [{
                traceId: "postgres_trace",
                type: "bar",
                name: "Calculation Exp30",
                x: table.displayValues[0].slice(1),
                y: table.values[1].slice(1),
              }],
              layout: {
                title: { text: "Carbon number distribution" },
              },
            },
            exclusions: [],
            checks: [],
          },
        };
      },
    };
    server = createServer({ config, store, modelProvider, analysisExecutor });
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const baseUrl = `http://${address.address}:${address.port}`;
    let cookie = "";
    const jsonFetch = (pathname, options = {}) => fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(options.headers || {}),
      },
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
    });
    const uploadFile = async (projectId, blob, filename) => {
      const form = new FormData();
      form.set("file", blob, filename);
      const upload = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
        method: "POST",
        headers: { cookie },
        body: form,
      });
      return { response: upload, body: await upload.json() };
    };

    const login = await jsonFetch("/api/auth/login", {
      method: "POST",
      body: { username: "labuser", password: "LabRatLab123!" },
    });
    assert.equal(login.status, 200);
    cookie = cookieFrom(login);
    const labId = (await (await jsonFetch("/api/labs")).json()).labs[0].labId;
    const project = await (await jsonFetch("/api/projects", {
      method: "POST",
      body: { labId, name: "Postgres Source Review Project" },
    })).json();

    const retryThread = await store.createAnalysisThread({
      labId,
      projectId: project.project.id,
      status: "planning",
      originalRequest: "Exercise the Postgres retry lease.",
      createdBy: "user_labuser",
    });
    const retryClaim = {
      labId,
      projectId: project.project.id,
      analysisThreadId: retryThread.id,
      actorUserId: "user_labuser",
      idempotencyKey: "postgres_retry_lease_1",
      requestHash: "sha256_postgres_retry_lease_1",
      claimedAt: "2026-07-22T12:00:00.000Z",
      leaseMs: 6 * 60 * 1000,
    };
    assert.equal((await store.claimAnalysisThreadRetry(retryClaim)).claimStatus, "claimed");
    assert.equal((await store.claimAnalysisThreadRetry({
      ...retryClaim,
      claimedAt: "2026-07-22T12:05:59.999Z",
    })).claimStatus, "in_progress");
    const recoveredRetry = await store.claimAnalysisThreadRetry({
      ...retryClaim,
      claimedAt: "2026-07-22T12:06:00.001Z",
    });
    assert.equal(recoveredRetry.claimStatus, "claimed");
    assert.equal(recoveredRetry.recovered, true);
    assert.equal(recoveredRetry.receipt.attemptCount, 2);
    const releasedRetry = await store.releaseAnalysisThreadRetry({
      ...retryClaim,
      releasedAt: "2026-07-22T12:06:01.000Z",
    });
    assert.equal(releasedRetry.receipt.status, "retryable");
    assert.equal(releasedRetry.analysisThread.status, "planning");

    const workbook = componentDistributionWorkbookBlob();
    const firstUpload = await uploadFile(project.project.id, workbook, "Calculation_Exp30.xlsx");
    assert.equal(firstUpload.response.status, 201);
    const reusedUpload = await uploadFile(project.project.id, workbook, "Calculation_Exp30.xlsx");
    assert.equal(reusedUpload.response.status, 200);
    assert.equal(reusedUpload.body.reused, true);
    assert.equal(reusedUpload.body.fileObject.id, firstUpload.body.fileObject.id);

    const review = await jsonFetch(`/api/projects/${project.project.id}/workbook-review-sessions`, {
      method: "POST",
      body: { fileObjectId: firstUpload.body.fileObject.id },
    });
    assert.equal(review.status, 201);
    const reviewBody = await review.json();
    assert.match(reviewBody.workbookReviewSession.id, /^workbook_review_session_/);
    assert.equal(reviewBody.importRun.status, "source_review_ready");
    assert.equal(reviewBody.sourceDocument.fileObjectId, firstUpload.body.fileObject.id);
    assert.equal(reviewBody.regions.length > 0, true);

    const oldNormalize = await jsonFetch(`/api/import-runs/${reviewBody.importRun.id}/normalize-preview`, {
      method: "POST",
      body: {},
    });
    assert.equal(oldNormalize.status, 404);

    const range = await jsonFetch(`/api/source-documents/${reviewBody.sourceDocument.id}/range`, {
      method: "POST",
      body: { sheetName: "Sheet1", range: "A1:E3" },
    });
    assert.equal(range.status, 200);
    const rangeBody = await range.json();
    assert.equal(rangeBody.cells.find((cell) => cell.address === "B2").rawValue, 5);

    const reviewRegion = reviewBody.reviewRegions.find((region) => region.rangeRef === "A1:E3")
      || reviewBody.reviewRegions[0];
    assert.equal(reviewBody.interpretationDeferred, true);
    assert.equal(reviewRegion.reviewStatus, "interpreting");
    assert.equal(reviewRegion.currentRevision, null);
    assert.equal(reviewRegion.interpretationHint.semanticType, "experiment_table");

    const interpretedUnderstanding = await jsonFetch(
      `/api/workbook-review-sessions/${reviewBody.workbookReviewSession.id}/regions/${reviewRegion.id}/interpret`,
      {
        method: "POST",
        body: {
          expectedRegionVersion: reviewRegion.version,
          idempotencyKey: "postgres_interpret_region_1",
        },
      },
    );
    assert.equal(interpretedUnderstanding.status, 201);
    const interpretedUnderstandingBody = await interpretedUnderstanding.json();
    assert.equal(
      interpretedUnderstandingBody.currentRevision.interpretation.semanticType,
      "component_distribution",
    );

    const confirmedUnderstanding = await jsonFetch(
      `/api/workbook-review-sessions/${reviewBody.workbookReviewSession.id}/regions/${reviewRegion.id}/confirm`,
      {
      method: "POST",
      body: {
        revisionId: interpretedUnderstandingBody.currentRevision.id,
        expectedRegionVersion: interpretedUnderstandingBody.region.version,
        idempotencyKey: "postgres_confirm_region_1",
      },
      },
    );
    assert.equal(confirmedUnderstanding.status, 200);
    const confirmedUnderstandingBody = await confirmedUnderstanding.json();
    assert.equal(confirmedUnderstandingBody.region.reviewStatus, "accepted");

    const listedUnderstandings = await jsonFetch(`/api/projects/${project.project.id}/region-understandings?status=accepted`);
    assert.equal(listedUnderstandings.status, 200);
    const listedUnderstandingsBody = await listedUnderstandings.json();
    assert.equal(listedUnderstandingsBody.regionUnderstandings.some(
      (item) => item.revision.id === confirmedUnderstandingBody.acceptedRevision.id,
    ), true);

    const retiredDataPlanDraft = await jsonFetch(`/api/projects/${project.project.id}/data-plans/draft`, {
      method: "POST",
      body: {},
    });
    assert.equal(retiredDataPlanDraft.status, 404);
    const retiredDataPlanPublish = await jsonFetch(`/api/projects/${project.project.id}/data-plans/publish`, {
      method: "POST",
      body: {},
    });
    assert.equal(retiredDataPlanPublish.status, 404);

    const browserThreadResponse = await jsonFetch(
      `/api/projects/${project.project.id}/analysis-threads`,
      {
        method: "POST",
        body: {
          originalRequest: "Add the accepted Exp30 carbon data to Experiment Browser.",
          outputTarget: "experiment_browser",
        },
      },
    );
    assert.equal(browserThreadResponse.status, 201);
    const browserThread = (await browserThreadResponse.json()).analysisThread;
    const browserPlan = {
      schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
      status: "awaiting_review",
      requestSummary: "Add Exp30 C1 to Experiment Browser.",
      sourceSelections: [{
        sourceSelectionId: "postgres_browser_source_selection",
        regionUnderstandingRevisionId: confirmedUnderstandingBody.acceptedRevision.id,
        sourceDocumentId: reviewBody.sourceDocument.id,
        sheetName: reviewRegion.sheetName,
        range: reviewRegion.rangeRef,
        label: "Calculation Exp30",
        purpose: "Read the accepted Exp30 carbon data.",
      }],
      experimentSelections: [],
      reviewPlan: {
        processingSteps: [
          "Read Exp30 C1 from the accepted workbook range.",
          "Add the value while preserving existing experiment data.",
        ],
        missingValueHandling: "Exclude the experiment when C1 is blank.",
        experimentOutput: {
          summary: "Create or update Exp30 with the accepted C1 value.",
        },
        browserView: {
          summary: "Show Exp30 and the newly added C1 column.",
        },
        invariants: [],
      },
      displayPlan: [
        "Use the accepted Exp30 workbook range.",
        "Publish C1 and keep all unrelated fields.",
      ],
      warnings: [],
    };
    const browserRevisionResponse = await jsonFetch(
      `/api/analysis-threads/${browserThread.id}/plan-revisions`,
      {
        method: "POST",
        body: { plan: browserPlan },
      },
    );
    assert.equal(browserRevisionResponse.status, 201);
    const browserRevision = (await browserRevisionResponse.json()).analysisPlanRevision;
    const browserAccept = await jsonFetch(
      `/api/analysis-plan-revisions/${browserRevision.id}/accept`,
      {
        method: "POST",
        headers: { "idempotency-key": "postgres_browser_accept_1" },
        body: {},
      },
    );
    assert.equal(browserAccept.status, 201);
    const browserRun = (await browserAccept.json()).analysisRun;
    const browserExecute = await jsonFetch(`/api/analysis-runs/${browserRun.id}/execute`, {
      method: "POST",
      body: {},
    });
    assert.equal(browserExecute.status, 201);
    const browserExecuteBody = await browserExecute.json();
    assert.ok(browserExecuteBody.analysisResult, JSON.stringify(browserExecuteBody));
    assert.equal(browserExecuteBody.analysisResult.outputTarget, "experiment_browser");
    const publishRequest = {
      method: "POST",
      headers: { "idempotency-key": "postgres_browser_publish_1" },
      body: {
        analysisResultId: browserExecuteBody.analysisResult.id,
        identityResolutions: [],
      },
    };
    const publish = await jsonFetch(
      `/api/analysis-runs/${browserRun.id}/accept-and-publish-experiments`,
      publishRequest,
    );
    assert.equal(publish.status, 201);
    const publishBody = await publish.json();
    assert.equal(publishBody.dataSnapshot.status, "accepted");
    assert.equal(publishBody.dataSnapshot.schemaVersion, "labrat.dataSnapshot.v4");
    assert.equal(publishBody.dataSnapshot.analysisResultId, browserExecuteBody.analysisResult.id);
    assert.equal(publishBody.browserView.isDefault, false);
    const publishRetry = await jsonFetch(
      `/api/analysis-runs/${browserRun.id}/accept-and-publish-experiments`,
      publishRequest,
    );
    assert.equal(publishRetry.status, 200);
    assert.equal((await publishRetry.json()).dataSnapshot.id, publishBody.dataSnapshot.id);
    assert.equal((await store.listDataPlans({ projectId: project.project.id })).length, 0);
    assert.equal((await store.listDataSnapshots({ projectId: project.project.id })).length, 1);
    assert.equal(
      (await store.listExperimentIdentities({ projectId: project.project.id })).length,
      1,
    );
    assert.equal(
      (await store.listExperimentSnapshotHeads({ projectId: project.project.id })).length,
      1,
    );

    const analysisPlan = {
      schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
      status: "awaiting_review",
      requestSummary: "Review the confirmed carbon distribution range.",
      sourceSelections: [{
        sourceSelectionId: "postgres_source_selection",
        regionUnderstandingRevisionId: confirmedUnderstandingBody.acceptedRevision.id,
        sourceDocumentId: reviewBody.sourceDocument.id,
        sheetName: reviewRegion.sheetName,
        range: reviewRegion.rangeRef,
        label: "Calculation Exp30",
        purpose: "Plot carbon number distribution",
      }],
      reviewPlan: {
        processingSteps: [
          "Read carbon labels and values from the confirmed workbook range.",
          "Create one bar trace from the selected table.",
        ],
        missingValueHandling: "Skip blank plotted cells.",
        chart: {
          title: "Carbon number distribution",
          chartType: "bar",
          xDescription: "Carbon number",
          yDescription: "Distribution",
          seriesDescription: "Calculation Exp30",
        },
        invariants: [],
      },
      displayPlan: [
        "Use the confirmed workbook range.",
        "Plot carbon number on X and distribution on Y.",
      ],
      warnings: [],
    };
    const analysisThreadResponse = await jsonFetch(
      `/api/projects/${project.project.id}/analysis-threads`,
      {
        method: "POST",
        body: { originalRequest: "Review one accepted numeric field." },
      },
    );
    assert.equal(analysisThreadResponse.status, 201);
    const analysisThread = (await analysisThreadResponse.json()).analysisThread;
    const analysisRevisionResponse = await jsonFetch(
      `/api/analysis-threads/${analysisThread.id}/plan-revisions`,
      {
        method: "POST",
        body: { plan: analysisPlan },
      },
    );
    assert.equal(analysisRevisionResponse.status, 201);
    const analysisRevision = (await analysisRevisionResponse.json()).analysisPlanRevision;
    const analysisAcceptRequest = {
      method: "POST",
      headers: { "Idempotency-Key": "postgres_analysis_accept_1" },
      body: {},
    };
    const analysisAccept = await jsonFetch(
      `/api/analysis-plan-revisions/${analysisRevision.id}/accept`,
      analysisAcceptRequest,
    );
    assert.equal(analysisAccept.status, 201);
    const acceptedAnalysisBody = await analysisAccept.json();
    assert.equal(acceptedAnalysisBody.analysisRun.status, "queued");
    const analysisAcceptReplay = await jsonFetch(
      `/api/analysis-plan-revisions/${analysisRevision.id}/accept`,
      analysisAcceptRequest,
    );
    assert.equal(analysisAcceptReplay.status, 200);
    assert.equal(
      (await analysisAcceptReplay.json()).analysisRun.id,
      acceptedAnalysisBody.analysisRun.id,
    );
    assert.equal((await store.listAnalysisRuns({
      projectId: project.project.id,
      analysisThreadId: analysisThread.id,
    })).length, 1);
    assert.equal((await store.listChartSpecs({ projectId: project.project.id })).length, 0);

    const analysisExecute = await jsonFetch(
      `/api/analysis-runs/${acceptedAnalysisBody.analysisRun.id}/execute`,
      { method: "POST", body: {} },
    );
    assert.equal(analysisExecute.status, 201);
    const analysisExecuteBody = await analysisExecute.json();
    assert.equal(analysisExecuteBody.analysisRun.status, "awaiting_result_review");
    assert.equal(analysisExecuteBody.analysisResult.status, "awaiting_review");
    assert.equal(
      (await store.listAnalysisResults({
        projectId: project.project.id,
        analysisThreadId: analysisThread.id,
      })).length,
      1,
    );
    assert.equal((await store.listChartSpecs({ projectId: project.project.id })).length, 0);
    const analysisPublication = await jsonFetch(
      `/api/analysis-runs/${acceptedAnalysisBody.analysisRun.id}/accept-and-create-chart`,
      {
        method: "POST",
        headers: { "idempotency-key": `postgres_analysis_publish_${Date.now()}` },
        body: {
          analysisResultId: analysisExecuteBody.analysisResult.id,
          defaultVisibleTraceIds: ["postgres_trace"],
        },
      },
    );
    assert.equal(analysisPublication.status, 201);
    const analysisPublicationBody = await analysisPublication.json();
    assert.equal(analysisPublicationBody.analysisRun.status, "completed");
    assert.equal(analysisPublicationBody.analysisResult.status, "accepted");
    assert.equal(analysisPublicationBody.chartSpec.spec.origin, "analysis_result");
    assert.equal((await store.listChartSpecs({ projectId: project.project.id })).length, 1);

    const deleteWorkbook = await jsonFetch(
      `/api/workbook-review-sessions/${reviewBody.workbookReviewSession.id}`,
      {
        method: "DELETE",
        body: {
          expectedVersion: reviewBody.workbookReviewSession.version,
          reason: "Remove from active workbook review.",
        },
      },
    );
    assert.equal(deleteWorkbook.status, 200);
    assert.ok((await deleteWorkbook.json()).deletedRegionCount >= 1);
    assert.equal((await store.listWorkbookReviewSessions({ projectId: project.project.id })).length, 0);
    assert.equal((await store.listAcceptedRegionUnderstandings({ projectId: project.project.id })).length, 0);
    assert.equal((await store.listSourceDocuments({ projectId: project.project.id })).length, 1);
    assert.equal((await store.listDataSnapshots({ projectId: project.project.id })).length, 1);
    assert.equal((await store.listChartSpecs({ projectId: project.project.id })).length, 1);

    const auditEvents = await store.listAuditEvents({ projectId: project.project.id });
    assert.equal(auditEvents.some((event) => event.action === "file.reuse"), true);
    assert.equal(auditEvents.some((event) => event.action === "workbook_review_session.create"), true);
    assert.equal(auditEvents.some((event) => event.action === "workbook_review_region.confirm"), true);
    assert.equal(auditEvents.some((event) => event.action === "analysis_result.publish_chart"), true);
    assert.equal(auditEvents.some((event) => event.action === "workbook_review_session.delete"), true);
  } finally {
    if (server) await closeServer(server);
    if (store?.pool) await store.pool.end();
    await adminPool.query(`drop schema if exists ${quoteIdent(schema)} cascade`);
    await adminPool.end();
  }
});
