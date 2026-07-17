import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { createServer } from "../../server.js";
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

test("Postgres SaaS routes preserve workbook review, source documents, and source-backed chart specs", {
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
    server = createServer({ config, store });
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

    const revision = await jsonFetch(`/api/workbook-review-sessions/${reviewBody.workbookReviewSession.id}/revisions`, {
      method: "POST",
      body: {
        message: "This red box is the Exp30 carbon number distribution.",
        redBoxUpdates: [{
          clientRegionId: "draft_region_pg_1",
          operation: "upsert",
          sourceDocumentId: reviewBody.sourceDocument.id,
          sheetName: "Sheet1",
          range: "A1:E3",
          selectionMethod: "drag_select",
          description: "Exp30 carbon number distribution",
        }],
      },
    });
    assert.equal(revision.status, 200);
    const revisionBody = await revision.json();
    assert.equal(revisionBody.workbookUnderstandingDraft.facts[0].semanticType, "component_distribution");

    const confirmedUnderstanding = await jsonFetch(`/api/workbook-review-sessions/${reviewBody.workbookReviewSession.id}/confirm`, {
      method: "POST",
      body: {
        workbookUnderstandingId: revisionBody.workbookUnderstandingDraft.id,
        decisionSummary: { acceptedByUser: true },
      },
    });
    assert.equal(confirmedUnderstanding.status, 200);
    const confirmedUnderstandingBody = await confirmedUnderstanding.json();
    assert.equal(confirmedUnderstandingBody.workbookUnderstanding.status, "accepted");

    const listedUnderstandings = await jsonFetch(`/api/projects/${project.project.id}/workbook-understandings`);
    assert.equal(listedUnderstandings.status, 200);
    const listedUnderstandingsBody = await listedUnderstandings.json();
    assert.equal(listedUnderstandingsBody.workbookUnderstandings.some((item) => item.id === confirmedUnderstandingBody.workbookUnderstanding.id), true);

    const dataPlanDraft = await jsonFetch(`/api/projects/${project.project.id}/data-plans/draft`, {
      method: "POST",
      body: {
        intent: "experiment_browser_publish",
        workbookUnderstandingIds: [confirmedUnderstandingBody.workbookUnderstanding.id],
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
        workbookUnderstandingIds: [confirmedUnderstandingBody.workbookUnderstanding.id],
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
  } finally {
    if (server) await closeServer(server);
    if (store?.pool) await store.pool.end();
    await adminPool.query(`drop schema if exists ${quoteIdent(schema)} cascade`);
    await adminPool.end();
  }
});
