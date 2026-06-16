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

function workbookBlob(rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Label", "Temperature (C)", "Reaction Time (hrs)", "Selectivity Gas (%)"],
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Runs");
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

test("Postgres SaaS routes preserve import lifecycle, merged commits, and chart spec validation", {
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
    const uploadAndRun = async (projectId, blob, filename) => {
      const { response: upload, body: uploadBody } = await uploadFile(projectId, blob, filename);
      assert.equal(upload.status, 201);
      const run = await jsonFetch(`/api/projects/${projectId}/import-runs`, {
        method: "POST",
        body: { fileObjectId: uploadBody.fileObject.id },
      });
      assert.equal(run.status, 201);
      return (await run.json()).importRun;
    };
    const previewAndApply = async (run) => {
      const blockId = run.scanResult.sheets[0].blocks[0].blockId;
      const preview = await jsonFetch(`/api/import-runs/${run.id}/normalize-preview`, {
        method: "POST",
        body: { approvedBlockIds: [blockId] },
      });
      assert.equal(preview.status, 200);
      const apply = await jsonFetch(`/api/import-runs/${run.id}/apply`, {
        method: "POST",
        body: {},
      });
      assert.equal(apply.status, 200);
      return apply.json();
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
      body: { labId, name: "Postgres Parity Project" },
    })).json();

    const duplicateWorkbook = workbookBlob([["Exp0", 225, 3, 0.15]]);
    const firstUpload = await uploadFile(project.project.id, duplicateWorkbook, "duplicate.xlsx");
    assert.equal(firstUpload.response.status, 201);
    const reusedUpload = await uploadFile(project.project.id, duplicateWorkbook, "duplicate.xlsx");
    assert.equal(reusedUpload.response.status, 200);
    assert.equal(reusedUpload.body.reused, true);
    assert.equal(reusedUpload.body.fileObject.id, firstUpload.body.fileObject.id);
    const reusedRun = await jsonFetch(`/api/projects/${project.project.id}/import-runs`, {
      method: "POST",
      body: { fileObjectId: reusedUpload.body.fileObject.id },
    });
    assert.equal(reusedRun.status, 201);

    const firstRun = await uploadAndRun(project.project.id, workbookBlob([["Exp1", 250, 5, 0.35]]), "first.xlsx");
    const firstApply = await previewAndApply(firstRun);
    const secondRun = await uploadAndRun(project.project.id, workbookBlob([["Exp2", 275, 8, 0.24]]), "second.xlsx");
    const secondApply = await previewAndApply(secondRun);
    assert.equal(secondApply.datasetCommit.parentCommitId, firstApply.datasetCommit.id);
    assert.equal(secondApply.datasetCommit.datasetPayload.genericImports.length, 2);

    const repeatApply = await jsonFetch(`/api/import-runs/${firstRun.id}/apply`, { method: "POST", body: {} });
    assert.equal(repeatApply.status, 409);
    assert.equal((await repeatApply.json()).error.code, "import_run_already_applied");

    const interpreted = await jsonFetch(`/api/projects/${project.project.id}/charts/interpret`, {
      method: "POST",
      body: { prompt: "plot gas selectivity vs temperature", persistAsProposal: true },
    });
    assert.equal(interpreted.status, 200);
    const interpretedBody = await interpreted.json();
    const proposal = interpretedBody.chartProposalSet.payload.proposals[0];
    const chartSpec = await jsonFetch(`/api/projects/${project.project.id}/chart-specs/from-proposal`, {
      method: "POST",
      body: {
        chartProposalSetId: interpretedBody.chartProposalSet.id,
        proposalId: proposal.proposalId,
      },
    });
    assert.equal(chartSpec.status, 201);

    const badChart = await jsonFetch(`/api/projects/${project.project.id}/chart-specs/from-proposal`, {
      method: "POST",
      body: {
        proposalId: "bad_chart",
        proposal: {
          proposalId: "bad_chart",
          chartType: "scatter",
          x: { label: "Temperature", sourceIds: ["missing_x"] },
          y: { label: "Gas", sourceIds: ["missing_y"] },
        },
      },
    });
    assert.equal(badChart.status, 400);
    assert.equal((await badChart.json()).error.code, "chart_source_unresolved");

    const auditEvents = await store.listAuditEvents({ projectId: project.project.id });
    assert.equal(auditEvents.some((event) => event.action === "import.apply"), true);
    assert.equal(auditEvents.some((event) => event.action === "chart_spec.create"), true);
  } finally {
    if (server) await closeServer(server);
    if (store?.pool) await store.pool.end();
    await adminPool.query(`drop schema if exists ${quoteIdent(schema)} cascade`);
    await adminPool.end();
  }
});
