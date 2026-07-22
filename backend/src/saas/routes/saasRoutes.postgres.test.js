import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { createServer } from "../../server.js";
import { resolveAnalysisSelection } from "../analysisSelection.js";
import { ANALYSIS_PLAN_REVISION_VERSION, pythonSourceHash } from "../analysisSchemas.js";
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
  const store = new PostgresSaasStore({ databaseUrl: "" });
  for (const method of [
    "createAnalysisThread",
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
    "acceptAnalysisPlan",
    "findChartSpecById",
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
        DATABASE_URL: databaseUrl,
        LABRAT_SEED_DEV_ACCOUNTS: "true",
      }),
      fileStorageRoot: path.join(os.tmpdir(), `labrat-postgres-route-test-${Date.now()}`),
    };
    store = new PostgresSaasStore(config);
    await store.initialize();
    const analysisExecutor = {
      async executeAcceptedRun(runPackage) {
        const field = runPackage.fieldCatalog[0];
        const resultTable = runPackage.tables.records.map((record, index) => ({
          __result_id: `postgres_result_${index + 1}`,
          __experiment_id: record.__experiment_id,
          __snapshot_id: record.__snapshot_id,
          __record_index: record.__record_index,
          [field.fieldKey]: record[field.fieldKey],
        }));
        const sourceRecordIds = runPackage.tables.records.map(
          (record) => record.__source_record_id,
        );
        return {
          ok: true,
          adapter: "postgres_test",
          runtime: { version: runPackage.runtimeVersion, exitCode: 0 },
          result: {
            result_table: resultTable,
            traces: [{
              traceId: "postgres_trace",
              x: runPackage.tables.records.map((record) => record.__experiment_label),
              y: runPackage.tables.records.map((record) => record[field.fieldKey]),
              xUnit: null,
              yUnit: field.unit || null,
              sourceRecordIds,
            }],
            lineage: {
              ...Object.fromEntries(resultTable.map((row, index) => [
                row.__result_id,
                { sourceRecordIds: [sourceRecordIds[index]] },
              ])),
              postgres_trace: { sourceRecordIds },
            },
            summary: {
              inputRecordCount: resultTable.length,
              outputRecordCount: resultTable.length,
              excludedRecordCount: 0,
              excludedRecords: [],
              missingValuePolicy: runPackage.calculationManifest.missingValuePolicy.mode,
            },
          },
        };
      },
    };
    server = createServer({ config, store, analysisExecutor });
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
    assert.equal(reviewRegion.currentRevision.semanticType, "component_distribution");

    const confirmedUnderstanding = await jsonFetch(
      `/api/workbook-review-sessions/${reviewBody.workbookReviewSession.id}/regions/${reviewRegion.id}/confirm`,
      {
      method: "POST",
      body: {
        revisionId: reviewRegion.currentRevision.id,
        expectedRegionVersion: reviewRegion.version,
        idempotencyKey: "postgres_confirm_region_1",
      },
      },
    );
    assert.equal(confirmedUnderstanding.status, 200);
    const confirmedUnderstandingBody = await confirmedUnderstanding.json();
    assert.equal(confirmedUnderstandingBody.region.reviewStatus, "confirmed");

    const listedUnderstandings = await jsonFetch(`/api/projects/${project.project.id}/region-understandings?status=accepted`);
    assert.equal(listedUnderstandings.status, 200);
    const listedUnderstandingsBody = await listedUnderstandings.json();
    assert.equal(listedUnderstandingsBody.regionUnderstandings.some(
      (item) => item.revision.id === confirmedUnderstandingBody.acceptedRevision.id,
    ), true);

    const dataPlanDraft = await jsonFetch(`/api/projects/${project.project.id}/data-plans/draft`, {
      method: "POST",
      body: {
        intent: "experiment_browser_publish",
        regionUnderstandingRevisionIds: [confirmedUnderstandingBody.acceptedRevision.id],
        identityDecisions: [],
      },
    });
    assert.equal(dataPlanDraft.status, 200);
    const dataPlanDraftBody = await dataPlanDraft.json();
    assert.equal(dataPlanDraftBody.resultKind, "data_plan_review");
    const experimentAlias = dataPlanDraftBody.identityCandidates[0].sourceAlias;
    const reviewedDataPlan = await jsonFetch(`/api/projects/${project.project.id}/data-plans/draft`, {
      method: "POST",
      body: {
        intent: "experiment_browser_publish",
        regionUnderstandingRevisionIds: [confirmedUnderstandingBody.acceptedRevision.id],
        identityDecisions: [{ sourceAlias: experimentAlias, action: "create" }],
      },
    });
    assert.equal(reviewedDataPlan.status, 200);
    const reviewedDataPlanBody = await reviewedDataPlan.json();
    assert.deepEqual(reviewedDataPlanBody.reviewSummary.blockers, []);
    const publish = await jsonFetch(`/api/projects/${project.project.id}/data-plans/publish`, {
      method: "POST",
      body: {
        dataPlan: reviewedDataPlanBody.dataPlan,
        identityDecisions: [{ sourceAlias: experimentAlias, action: "create" }],
        expectedPreviewHash: reviewedDataPlanBody.snapshotPreview.previewHash,
        expectedDependencyHash: reviewedDataPlanBody.dataPlan.dependencyHash,
        idempotencyKey: "postgres_publish_1",
      },
    });
    assert.equal(publish.status, 201);
    const publishBody = await publish.json();
    assert.equal(publishBody.dataSnapshot.status, "accepted");
    const publishRetry = await jsonFetch(`/api/projects/${project.project.id}/data-plans/publish`, {
      method: "POST",
      body: {
        dataPlan: reviewedDataPlanBody.dataPlan,
        identityDecisions: [{ sourceAlias: experimentAlias, action: "create" }],
        expectedPreviewHash: reviewedDataPlanBody.snapshotPreview.previewHash,
        expectedDependencyHash: reviewedDataPlanBody.dataPlan.dependencyHash,
        idempotencyKey: "postgres_publish_1",
      },
    });
    assert.equal(publishRetry.status, 200);
    assert.equal((await publishRetry.json()).dataSnapshot.id, publishBody.dataSnapshot.id);
    assert.equal((await store.listDataPlans({ projectId: project.project.id })).length, 1);
    assert.equal((await store.listDataSnapshots({ projectId: project.project.id })).length, 1);
    assert.equal((await store.listExperimentIdentities({ projectId: project.project.id })).length, 1);
    assert.equal((await store.listExperimentSnapshotHeads({ projectId: project.project.id })).length, 1);

    const [
      analysisSnapshots,
      analysisIdentities,
      analysisHeads,
    ] = await Promise.all([
      store.listDataSnapshots({ projectId: project.project.id }),
      store.listExperimentIdentities({ projectId: project.project.id }),
      store.listExperimentSnapshotHeads({ projectId: project.project.id }),
    ]);
    const fieldSelection = resolveAnalysisSelection({
      projectId: project.project.id,
      dataSnapshots: analysisSnapshots,
      experimentIdentities: analysisIdentities,
      experimentSnapshotHeads: analysisHeads,
      selectionRequest: {
        experimentIds: analysisHeads.map((head) => head.experimentId),
        fieldIds: [],
        includeSeries: false,
      },
    });
    const selectedField = fieldSelection.fieldCatalog.find((field) => field.valueType === "number")
      || fieldSelection.fieldCatalog[0];
    assert.ok(selectedField);
    const selectionRequest = {
      experimentIds: analysisHeads.map((head) => head.experimentId),
      fieldIds: [selectedField.fieldId],
      includeSeries: false,
    };
    const analysisSelection = resolveAnalysisSelection({
      projectId: project.project.id,
      dataSnapshots: analysisSnapshots,
      experimentIdentities: analysisIdentities,
      experimentSnapshotHeads: analysisHeads,
      selectionRequest,
    });
    const pythonSource = [
      "def analyze(tables, labrat):",
      "    return {'result_table': [], 'traces': [], 'lineage': {}, 'summary': {}}",
    ].join("\n");
    const analysisPlan = {
      schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
      status: "awaiting_review",
      requestSummary: "Review one accepted numeric field.",
      selection: {
        selectionId: analysisSelection.selectionId,
        experimentIds: analysisSelection.experimentIds,
        fieldIds: analysisSelection.fieldIds,
        dependencyHash: analysisSelection.dependencyHash,
        selectionHash: analysisSelection.selectionHash,
      },
      processingSummary: ["Use the accepted numeric value once."],
      calculationManifest: {
        inputs: [{
          fieldId: selectedField.fieldId,
          fieldKey: selectedField.fieldKey,
          unit: selectedField.unit,
        }],
        missingValuePolicy: {
          mode: "exclude_record",
          requiredFieldIds: [selectedField.fieldId],
        },
        derivedFields: [],
        invariants: [],
      },
      pythonProgram: {
        runtime: "labrat-python-v1",
        entrypoint: "analyze",
        source: pythonSource,
        sourceHash: pythonSourceHash(pythonSource),
      },
      expectedOutput: {
        shape: "experiment_traces",
        chartType: "bar",
        xField: "experiment_label",
        yFields: [selectedField.fieldKey],
      },
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
        body: { plan: analysisPlan, selectionRequest },
      },
    );
    assert.equal(analysisRevisionResponse.status, 201);
    const analysisRevision = (await analysisRevisionResponse.json()).analysisPlanRevision;
    const analysisAcceptRequest = {
      method: "POST",
      headers: { "Idempotency-Key": "postgres_analysis_accept_1" },
      body: {
        planHash: analysisRevision.planHash,
        selectionHash: analysisRevision.selectionHash,
        dependencyHash: analysisRevision.dependencyHash,
      },
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
    assert.equal((await store.listAnalysisRuns({ projectId: project.project.id })).length, 1);
    assert.equal((await store.listChartSpecs({ projectId: project.project.id })).length, 0);

    const analysisPublication = await jsonFetch(
      `/api/analysis-runs/${acceptedAnalysisBody.analysisRun.id}/accept-and-create-chart`,
      {
        method: "POST",
        headers: { "idempotency-key": `postgres_analysis_publish_${Date.now()}` },
        body: {
          resultHash: analysisExecuteBody.analysisResult.contentHash,
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

    const sourceExtract = await jsonFetch(`/api/projects/${project.project.id}/source-extract-proposals`, {
      method: "POST",
      body: {
        sourceDocumentId: reviewBody.sourceDocument.id,
        sheetName: "Sheet1",
        range: "A1:E3",
        extractType: "component_distribution",
        purpose: "chart_source",
      },
    });
    assert.equal(sourceExtract.status, 201);
    const sourceExtractProposal = (await sourceExtract.json()).sourceExtractProposal;
    assert.equal(sourceExtractProposal.preview.rows.length, 4);

    const accepted = await jsonFetch(`/api/source-extract-proposals/${sourceExtractProposal.id}`, {
      method: "PATCH",
      body: { status: "accepted", decisionSummary: { acceptedByUser: true } },
    });
    assert.equal(accepted.status, 200);

    const chartProposal = await jsonFetch(`/api/source-extract-proposals/${sourceExtractProposal.id}/chart-proposal`, {
      method: "POST",
      body: {},
    });
    assert.equal(chartProposal.status, 201);
    const chartProposalSet = (await chartProposal.json()).chartProposalSet;
    const proposal = chartProposalSet.payload.proposals[0];
    assert.equal(proposal.origin, "source_extract");

    const chartSpec = await jsonFetch(`/api/projects/${project.project.id}/chart-specs/from-proposal`, {
      method: "POST",
      body: {
        chartProposalSetId: chartProposalSet.id,
        proposalId: proposal.proposalId,
      },
    });
    assert.equal(chartSpec.status, 201);
    const chartSpecBody = await chartSpec.json();
    assert.equal(chartSpecBody.chartSpec.datasetCommitId, undefined);
    assert.equal(chartSpecBody.chartSpec.spec.sourceSnapshot.rows.length, 4);

    const auditEvents = await store.listAuditEvents({ projectId: project.project.id });
    assert.equal(auditEvents.some((event) => event.action === "file.reuse"), true);
    assert.equal(auditEvents.some((event) => event.action === "workbook_review_session.create"), true);
    assert.equal(auditEvents.some((event) => event.action === "workbook_review.confirm_understanding"), true);
    assert.equal(auditEvents.some((event) => event.action === "chart_spec.create"), true);
    assert.equal(auditEvents.some((event) => event.action === "analysis_result.publish_chart"), true);
  } finally {
    if (server) await closeServer(server);
    if (store?.pool) await store.pool.end();
    await adminPool.query(`drop schema if exists ${quoteIdent(schema)} cascade`);
    await adminPool.end();
  }
});
