import assert from "node:assert/strict";
import os from "node:os";
import { after, before, test } from "node:test";
import * as XLSX from "xlsx";
import {
  createGoldenExperimentBrowserWorkbook,
  createGroupedMasterTableWorkbook,
  goldenExperimentBrowserFixture,
  groupedMasterTableFixture,
} from "../../import/fixtures/workbookFixtures.js";
import { createServer } from "../../server.js";
import { loadSaasConfig } from "../config.js";
import { MemorySaasStore } from "../memoryStore.js";

let server;
let baseUrl;
let cookie;
let store;

function makeWorkbookBlob(rows = [
  ["Exp1", 250, 5, 0.35],
  ["Exp2", 275, 8, 0.24],
]) {
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

function groupedMasterTableBlob() {
  const fixture = createGroupedMasterTableWorkbook();
  return new Blob([fixture.buffer], { type: fixture.contentType });
}

function makeReactionRateWorkbookBlob(rows = [
  [0, 0.1, 80],
  [5, 0.2, 80],
]) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Reaction Time (min)", "Reaction Rate (mol/s)", "Temperature (C)"],
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Exp33");
  return new Blob([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function makeSparseWorkbookBlob() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Temperature"],
    [80],
    [90],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Mystery");
  return new Blob([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function makeUnlabelledSeriesWorkbookBlob() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Reaction Time (min)", "Reaction Rate (mol/g/h)"],
    [0, 0.1],
    [5, 0.2],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Series");
  return new Blob([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function makeComponentDistributionWorkbookBlob({ headerRowNumber = 1 } = {}) {
  const workbook = XLSX.utils.book_new();
  const rows = Array.from({ length: Math.max(0, headerRowNumber - 1) }, () => []);
  rows.push(
    ["Label", "C1", "C2", "C3", "C4"],
    ["Overall tots", 5, 12.5, 21, 9.5],
    ["Light fraction", 1, 2, 3, 4],
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return new Blob([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function componentDistributionRows(values = [5, 12.5, 21, 9.5]) {
  return [
    ["Label", "C1", "C2", "C3", "C4"],
    ["Overall tots", ...values],
  ];
}

function appendRangeSheet(workbook, sheetName, rows, origin = "P31") {
  const worksheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(worksheet, rows, { origin });
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
}

function makeCalculationRangeWorkbookBlob({
  values = [5, 12.5, 21, 9.5],
  validSheets = ["Carbon Balance"],
  invalidSheets = [],
} = {}) {
  const workbook = XLSX.utils.book_new();
  invalidSheets.forEach((sheetName, index) => {
    appendRangeSheet(workbook, sheetName, [
      ["Label", "Not C", "Still Not C"],
      [`Noise ${index + 1}`, "abc", "def"],
    ]);
  });
  validSheets.forEach((sheetName) => appendRangeSheet(workbook, sheetName, componentDistributionRows(values)));
  return new Blob([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

async function jsonFetch(pathname, options = {}) {
  const headers = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(cookie ? { cookie } : {}),
    ...(options.headers || {}),
  };
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
}

async function uploadProjectFile(projectId, blob = makeWorkbookBlob(), filename = "workbook.xlsx") {
  const form = new FormData();
  form.set("file", blob, filename);
  const response = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  return { response, body: await response.json() };
}

function goldenExperimentBrowserBlob() {
  const workbook = createGoldenExperimentBrowserWorkbook();
  return new Blob([workbook.buffer], { type: workbook.contentType });
}

async function uploadAndCreateImportRun(projectId, blob = makeWorkbookBlob(), filename = "workbook.xlsx") {
  const { response: upload, body: uploadBody } = await uploadProjectFile(projectId, blob, filename);
  assert.equal(upload.status, 201);
  const importRunResponse = await jsonFetch(`/api/projects/${projectId}/import-runs`, {
    method: "POST",
    body: { fileObjectId: uploadBody.fileObject.id },
  });
  assert.equal(importRunResponse.status, 201);
  return { fileObject: uploadBody.fileObject, importRun: (await importRunResponse.json()).importRun };
}

async function createProject(name = "Route Test Project") {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const response = await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name },
  });
  assert.equal(response.status, 201);
  return (await response.json()).project;
}

before(async () => {
  const config = {
    ...loadSaasConfig({
      NODE_ENV: "test",
      SESSION_SECRET: "test-secret",
      LABRAT_SEED_DEV_ACCOUNTS: "true",
    }),
    fileStorageRoot: `${os.tmpdir()}\\labrat-saas-test-${Date.now()}`,
  };
  store = new MemorySaasStore({ seedDevAccounts: true });
  server = createServer({ config, store });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      baseUrl = `http://${address.address}:${address.port}`;
      resolve();
    });
  });
  const login = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: { username: "labuser", password: "LabRatLab123!" },
  });
  assert.equal(login.status, 200);
  cookie = cookieFrom(login);
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("seeded lab owner can create projects and cross-lab access is rejected", async () => {
  const me = await jsonFetch("/api/auth/me");
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.user.username, "labuser");

  const project = await createProject("Auth Project");
  const state = await jsonFetch(`/api/projects/${project.id}/state`);
  assert.equal(state.status, 200);

  const ownerCookie = cookie;
  const adminLogin = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "LabRatAdmin123!" },
  });
  assert.equal(adminLogin.status, 200);
  cookie = cookieFrom(adminLogin);
  const otherLab = await (await jsonFetch("/api/admin/labs", {
    method: "POST",
    body: { name: "Other Test Lab", slug: `other-${Date.now()}` },
  })).json();
  const otherProject = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId: otherLab.lab.id, name: "Other Project" },
  })).json();

  cookie = ownerCookie;
  const crossLab = await jsonFetch(`/api/projects/${otherProject.project.id}/state`);
  assert.equal(crossLab.status, 403);
});

test("file upload can scan source documents and old import workflow endpoints are absent", async () => {
  const project = await createProject("Source Scan Project");
  const { fileObject, importRun } = await uploadAndCreateImportRun(project.id, makeWorkbookBlob(), "scan.xlsx");
  assert.match(fileObject.id, /^file_/);
  assert.equal(importRun.status, "review_ready");
  assert.equal(importRun.scanResult.sheets[0].cellGrid.cells, undefined);

  const removedImportRunRoutes = ["normalize", "refresh", "relationship"].map((prefix) => (
    { method: "POST", path: `/api/import-runs/${importRun.id}/${prefix}-preview`, body: {} }
  ));
  const removedBatchPath = `/api/projects/${project.id}/supplemental-import-${"batches"}`;
  for (const request of [
    ...removedImportRunRoutes,
    { method: "POST", path: `/api/import-runs/${importRun.id}/apply`, body: {} },
    { method: "GET", path: removedBatchPath },
    { method: "POST", path: removedBatchPath, body: { fileObjectIds: [] } },
    { method: "GET", path: `${removedBatchPath}/batch_missing/events` },
  ]) {
    const response = await jsonFetch(request.path, { method: request.method, body: request.body });
    assert.equal(response.status, 404, `${request.method} ${request.path}`);
  }

  const documentsResponse = await jsonFetch(`/api/projects/${project.id}/source-documents`);
  assert.equal(documentsResponse.status, 200);
  const documentsBody = await documentsResponse.json();
  assert.equal(documentsBody.schemaVersion, "labrat.sourceDocumentList.v1");
  assert.equal(documentsBody.sourceDocuments.length, 1);
  assert.equal(documentsBody.sourceDocuments[0].fileObjectId, fileObject.id);
  assert.equal(documentsBody.sourceDocuments[0].importRunId, importRun.id);
});

test("workbook review sessions summarize detected source regions and reuse indexed documents", async () => {
  const project = await createProject("Workbook Review Project");
  const upload = await uploadProjectFile(project.id, makeWorkbookBlob(), "review.xlsx");
  assert.equal(upload.response.status, 201);

  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  assert.match(createBody.workbookReviewSession.id, /^workbook_review_session_/);
  assert.equal(createBody.workbookReviewSession.sourceDocumentId, createBody.sourceDocument.id);
  assert.equal(createBody.importRun.status, "source_review_ready");
  assert.equal(createBody.regions.length > 0, true);
  assert.equal(createBody.workbookReviewSession.messages.some((message) => message.role === "assistant"), true);

  const list = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`);
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.workbookReviewSessions.some((session) => session.id === createBody.workbookReviewSession.id), true);

  const fetched = await jsonFetch(`/api/workbook-review-sessions/${createBody.workbookReviewSession.id}`);
  assert.equal(fetched.status, 200);
  const fetchedBody = await fetched.json();
  assert.equal(fetchedBody.sourceDocument.id, createBody.sourceDocument.id);
  assert.equal(fetchedBody.regions.length, createBody.regions.length);

  const reused = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { sourceDocumentId: createBody.sourceDocument.id },
  });
  assert.equal(reused.status, 201);
  const reusedBody = await reused.json();
  assert.equal(reusedBody.importRun, null);
  assert.equal(reusedBody.sourceDocument.id, createBody.sourceDocument.id);
});

test("workbook review revisions create and confirm accepted understandings without data/chart side effects", async () => {
  const project = await createProject("Workbook Understanding Project");
  const upload = await uploadProjectFile(project.id, makeWorkbookBlob(), "understanding.xlsx");
  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  const sessionId = createBody.workbookReviewSession.id;
  const sourceDocumentId = createBody.sourceDocument.id;

  const revision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "This red box is the experiment condition table; first row is the header.",
      redBoxUpdates: [{
        clientRegionId: "draft_region_client_1",
        operation: "upsert",
        sourceDocumentId,
        sheetName: "Runs",
        range: "A1:D3",
        selectionMethod: "drag_select",
        description: "experiment condition table",
      }],
    },
  });
  assert.equal(revision.status, 200);
  const revisionBody = await revision.json();
  assert.equal(revisionBody.validation.status, "valid");
  assert.equal(revisionBody.workbookReviewSession.version, 2);
  assert.equal(revisionBody.workbookUnderstandingDraft.facts[0].sheetName, "Runs");
  assert.equal(revisionBody.workbookUnderstandingDraft.facts[0].range, "A1:D3");
  assert.equal(revisionBody.workbookUnderstandingDraft.facts[0].semanticType, "experiment_table");
  assert.equal(revisionBody.workbookUnderstandingDraft.facts[0].interpretation.experimentAxis, "rows");
  assert.equal(revisionBody.workbookUnderstandingDraft.facts[0].interpretation.experimentIdColumn, "A");
  assert.deepEqual(
    revisionBody.workbookUnderstandingDraft.facts[0].interpretation.fields.map((field) => field.column),
    ["B", "C", "D"],
  );
  assert.equal(revisionBody.workbookReviewSession.messages.some((message) => message.role === "user"), true);

  const secondRevision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "Also track this second red box as notes.",
      previousUnderstandingId: revisionBody.workbookUnderstandingDraft.id,
      redBoxUpdates: [{
        clientRegionId: "draft_region_client_2",
        operation: "upsert",
        sourceDocumentId,
        sheetName: "Runs",
        range: "A4:B5",
        selectionMethod: "manual_range_input",
        description: "notes and metadata",
      }],
    },
  });
  assert.equal(secondRevision.status, 200);
  const secondRevisionBody = await secondRevision.json();
  assert.equal(secondRevisionBody.workbookUnderstandingDraft.facts.length, 2);

  const languageOnly = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "Keep those two red boxes, but describe them as reviewed workbook evidence.",
      previousUnderstandingId: secondRevisionBody.workbookUnderstandingDraft.id,
      redBoxUpdates: [],
    },
  });
  assert.equal(languageOnly.status, 200);
  const languageOnlyBody = await languageOnly.json();
  assert.equal(languageOnlyBody.workbookUnderstandingDraft.facts.length, 2);

  const invalidRevision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "This sheet does not exist.",
      redBoxUpdates: [{
        clientRegionId: "draft_region_missing",
        operation: "upsert",
        sourceDocumentId,
        sheetName: "Missing",
        range: "A1:B2",
      }],
    },
  });
  assert.equal(invalidRevision.status, 404);
  const invalidBody = await invalidRevision.json();
  assert.equal(invalidBody.clarification.code, "source_sheet_not_found");

  const confirm = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/confirm`, {
    method: "POST",
    body: {
      workbookUnderstandingId: languageOnlyBody.workbookUnderstandingDraft.id,
      decisionSummary: { acceptedByUser: true, note: "Looks right." },
    },
  });
  assert.equal(confirm.status, 200);
  const confirmBody = await confirm.json();
  assert.equal(confirmBody.workbookReviewSession.status, "accepted");
  assert.equal(confirmBody.workbookUnderstanding.status, "accepted");
  assert.equal(confirmBody.workbookUnderstanding.facts.length, 2);
  assert.equal(confirmBody.workbookUnderstanding.understanding.status, "accepted");
  assert.equal(confirmBody.workbookUnderstanding.understanding.draftRegions.every((region) => region.status === "accepted"), true);
  assert.equal(confirmBody.workbookUnderstanding.understanding.regionSummaries.every((region) => region.status === "accepted"), true);
  assert.equal(confirmBody.workbookUnderstanding.regionSummaries.every((region) => region.status === "accepted"), true);

  const understandings = await jsonFetch(`/api/projects/${project.id}/workbook-understandings`);
  assert.equal(understandings.status, 200);
  const understandingsBody = await understandings.json();
  assert.equal(understandingsBody.workbookUnderstandings.some((item) => item.id === confirmBody.workbookUnderstanding.id), true);

  const secondConfirm = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/confirm`, {
    method: "POST",
    body: { workbookUnderstandingId: languageOnlyBody.workbookUnderstandingDraft.id },
  });
  assert.equal(secondConfirm.status, 409);

  const state = await (await jsonFetch(`/api/projects/${project.id}/state`)).json();
  assert.equal(state.datasetCommits, undefined);
  assert.equal(state.chartSpecs.length, 0);
  const sourceExtracts = await (await jsonFetch(`/api/projects/${project.id}/source-extract-proposals`)).json();
  assert.equal(sourceExtracts.sourceExtractProposals.length, 0);
});

test("workbook understanding confirmation blocks unresolved experiment axis and region identity", async () => {
  const project = await createProject("Workbook Interpretation Blockers Project");
  const sparseUpload = await uploadProjectFile(project.id, makeSparseWorkbookBlob(), "mystery.xlsx");
  const sparseCreate = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: sparseUpload.body.fileObject.id },
  });
  assert.equal(sparseCreate.status, 201);
  const sparseBody = await sparseCreate.json();
  const sparseRevision = await jsonFetch(`/api/workbook-review-sessions/${sparseBody.workbookReviewSession.id}/revisions`, {
    method: "POST",
    body: {
      message: "I cannot tell whether this is one experiment or several.",
      redBoxUpdates: [{
        clientRegionId: "draft_sparse",
        sourceDocumentId: sparseBody.sourceDocument.id,
        sheetName: "Mystery",
        range: "A1:A3",
        semanticType: "unknown_region",
      }],
    },
  });
  assert.equal(sparseRevision.status, 200);
  const sparseRevisionBody = await sparseRevision.json();
  assert.equal(sparseRevisionBody.workbookUnderstandingDraft.validation.blockers[0].code, "experiment_axis_required");

  const sparseConfirm = await jsonFetch(`/api/workbook-review-sessions/${sparseBody.workbookReviewSession.id}/confirm`, {
    method: "POST",
    body: { workbookUnderstandingId: sparseRevisionBody.workbookUnderstandingDraft.id },
  });
  assert.equal(sparseConfirm.status, 409);
  assert.equal((await sparseConfirm.json()).error.code, "experiment_axis_required");

  const seriesUpload = await uploadProjectFile(project.id, makeUnlabelledSeriesWorkbookBlob(), "series.xlsx");
  const seriesCreate = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: seriesUpload.body.fileObject.id },
  });
  assert.equal(seriesCreate.status, 201);
  const seriesBody = await seriesCreate.json();
  const seriesRevision = await jsonFetch(`/api/workbook-review-sessions/${seriesBody.workbookReviewSession.id}/revisions`, {
    method: "POST",
    body: {
      message: "This red box is reaction rate over time for one experiment.",
      redBoxUpdates: [{
        clientRegionId: "draft_series",
        sourceDocumentId: seriesBody.sourceDocument.id,
        sheetName: "Series",
        range: "A1:B3",
        semanticType: "reaction_rate_time_series",
      }],
      interpretationPatches: [{
        draftRegionId: "draft_series",
        experimentAxis: "region",
      }],
    },
  });
  assert.equal(seriesRevision.status, 200);
  const seriesRevisionBody = await seriesRevision.json();
  assert.equal(seriesRevisionBody.workbookUnderstandingDraft.validation.blockers[0].code, "experiment_label_required");

  const seriesConfirm = await jsonFetch(`/api/workbook-review-sessions/${seriesBody.workbookReviewSession.id}/confirm`, {
    method: "POST",
    body: { workbookUnderstandingId: seriesRevisionBody.workbookUnderstandingDraft.id },
  });
  assert.equal(seriesConfirm.status, 409);
  assert.equal((await seriesConfirm.json()).error.code, "experiment_label_required");
});

test("project evidence retrieve returns accepted workbook understanding regions only as usable results", async () => {
  const project = await createProject("Tool Evidence Retrieval Project");
  const upload = await uploadProjectFile(project.id, makeWorkbookBlob(), "reaction-rate-exp1.xlsx");
  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  const sessionId = createBody.workbookReviewSession.id;
  const sourceDocumentId = createBody.sourceDocument.id;

  const revision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "This red box is Exp1 reaction rate data over time.",
      redBoxUpdates: [{
        clientRegionId: "draft_region_exp1_rate",
        operation: "upsert",
        sourceDocumentId,
        sheetName: "Runs",
        range: "A1:D3",
        selectionMethod: "drag_select",
        description: "Exp1 reaction rate data over time",
      }],
    },
  });
  assert.equal(revision.status, 200);
  const revisionBody = await revision.json();
  const confirm = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/confirm`, {
    method: "POST",
    body: {
      workbookUnderstandingId: revisionBody.workbookUnderstandingDraft.id,
      decisionSummary: { acceptedByUser: true },
    },
  });
  assert.equal(confirm.status, 200);

  const retrieve = await jsonFetch(`/api/projects/${project.id}/evidence/retrieve`, {
    method: "POST",
    body: {
      query: "draw reaction rate vs time for experiment 1",
      mode: "tool_agent",
      includePreview: true,
      includeUnconfirmedSuggestions: true,
    },
  });
  assert.equal(retrieve.status, 200);
  const retrieveBody = await retrieve.json();
  assert.equal(retrieveBody.schemaVersion, "labrat.evidenceRetrieval.toolAgent.v1");
  assert.equal(retrieveBody.results.length, 1);
  assert.equal(retrieveBody.results[0].evidenceStatus, "accepted");
  assert.equal(retrieveBody.results[0].canUseForDataPlan, true);
  assert.equal(retrieveBody.results[0].sourceDocumentId, sourceDocumentId);
  assert.equal(retrieveBody.results[0].sheetName, "Runs");
  assert.equal(retrieveBody.results[0].range, "A1:D3");
  assert.equal(retrieveBody.results[0].preview.sheetName, "Runs");

  const nonexistent = await jsonFetch(`/api/projects/${project.id}/evidence/retrieve`, {
    method: "POST",
    body: {
      query: "draw reaction rate vs time for experiment 999",
      mode: "tool_agent",
      includeUnconfirmedSuggestions: true,
    },
  });
  assert.equal(nonexistent.status, 200);
  const nonexistentBody = await nonexistent.json();
  assert.equal(nonexistentBody.results.length, 0);
  assert.equal(nonexistentBody.results.some((result) => result.sheetName === "Runs"), false);
});

test("project data plan draft reloads accepted understanding and returns a transient experiment-record preview", async () => {
  const project = await createProject("Tool DataPlan Agent Project");
  const upload = await uploadProjectFile(project.id, makeReactionRateWorkbookBlob(), "Reaction_Rate_Exp33.xlsx");
  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  const sessionId = createBody.workbookReviewSession.id;
  const sourceDocumentId = createBody.sourceDocument.id;

  const revision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "This red box is Exp33 reaction rate over time.",
      redBoxUpdates: [{
        clientRegionId: "draft_region_exp33_rate",
        operation: "upsert",
        sourceDocumentId,
        sheetName: "Exp33",
        range: "A1:C3",
        selectionMethod: "drag_select",
        description: "Exp33 reaction rate over time",
      }],
    },
  });
  assert.equal(revision.status, 200);
  const revisionBody = await revision.json();
  const confirm = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/confirm`, {
    method: "POST",
    body: {
      workbookUnderstandingId: revisionBody.workbookUnderstandingDraft.id,
      decisionSummary: { acceptedByUser: true },
    },
  });
  assert.equal(confirm.status, 200);
  const confirmBody = await confirm.json();
  const stateBefore = await (await jsonFetch(`/api/projects/${project.id}/state`)).json();

  const draft = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      workbookUnderstandingIds: [confirmBody.workbookUnderstanding.id],
      identityDecisions: [],
      retrievalResults: [{
        resultId: "client_supplied_values_are_ignored",
        values: [999],
      }],
    },
  });
  assert.equal(draft.status, 200);
  const draftBody = await draft.json();
  assert.equal(draftBody.resultKind, "data_plan_review");
  assert.equal(draftBody.dataPlan.outputShape, "experiment_records");
  assert.equal(draftBody.snapshotPreview.schemaVersion, "labrat.dataSnapshot.v2");
  assert.equal(draftBody.snapshotPreview.experimentRecords[0].label, "Exp33");
  assert.deepEqual(draftBody.snapshotPreview.experimentRecords[0].series[0].points.map((point) => [point.x, point.y]), [[0, 0.1], [5, 0.2]]);
  assert.equal(draftBody.dataPlan.sourceEvidence[0].workbookUnderstandingId, confirmBody.workbookUnderstanding.id);
  assert.equal(JSON.stringify(draftBody.dataPlan).includes("client_supplied_values_are_ignored"), false);
  assert.equal(JSON.stringify(draftBody.dataPlan).includes('"values":[999]'), false);
  assert.deepEqual(draftBody.reviewSummary.blockers.map((item) => item.code), ["identity_decision_required"]);

  const reviewedDraft = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      workbookUnderstandingIds: [confirmBody.workbookUnderstanding.id],
      identityDecisions: [{ sourceAlias: "Exp33", action: "create" }],
    },
  });
  assert.equal(reviewedDraft.status, 200);
  const reviewedBody = await reviewedDraft.json();
  assert.deepEqual(reviewedBody.reviewSummary.blockers, []);
  assert.match(reviewedBody.snapshotPreview.experimentRecords[0].identityCandidateKey, /^identity_candidate_/);

  const stateAfter = await (await jsonFetch(`/api/projects/${project.id}/state`)).json();
  assert.equal(stateAfter.datasetCommits, undefined);
  assert.equal(stateBefore.datasetCommits, undefined);
  assert.equal(stateAfter.chartSpecs.length, stateBefore.chartSpecs.length);
  assert.equal(stateAfter.workbookUnderstandings.length, stateBefore.workbookUnderstandings.length);
  assert.equal(JSON.stringify(stateAfter).includes("data_plan_preview_"), false);

  const missingIdempotency = await jsonFetch(`/api/projects/${project.id}/data-plans/publish`, {
    method: "POST",
    body: {
      dataPlan: reviewedBody.dataPlan,
      identityDecisions: [{ sourceAlias: "Exp33", action: "create" }],
      expectedPreviewHash: reviewedBody.snapshotPreview.previewHash,
      expectedDependencyHash: reviewedBody.dataPlan.dependencyHash,
    },
  });
  assert.equal(missingIdempotency.status, 400);
  assert.equal((await missingIdempotency.json()).error.code, "idempotency_key_required");

  const publishRequest = {
    dataPlan: reviewedBody.dataPlan,
    identityDecisions: [{ sourceAlias: "Exp33", action: "create" }],
    expectedPreviewHash: reviewedBody.snapshotPreview.previewHash,
    expectedDependencyHash: reviewedBody.dataPlan.dependencyHash,
    idempotencyKey: "publish_route_exp33_1",
  };
  const publish = await jsonFetch(`/api/projects/${project.id}/data-plans/publish`, {
    method: "POST",
    body: publishRequest,
  });
  assert.equal(publish.status, 201);
  const publishBody = await publish.json();
  assert.equal(publishBody.idempotentReplay, false);
  assert.equal(publishBody.dataPlan.status, "accepted");
  assert.equal(publishBody.dataSnapshot.status, "accepted");
  assert.equal(publishBody.dataSnapshot.experimentRecordCount, 1);
  assert.equal(publishBody.experimentIdentities[0].canonicalLabel, "Exp33");

  const retry = await jsonFetch(`/api/projects/${project.id}/data-plans/publish`, {
    method: "POST",
    body: publishRequest,
  });
  assert.equal(retry.status, 200);
  const retryBody = await retry.json();
  assert.equal(retryBody.idempotentReplay, true);
  assert.equal(retryBody.dataPlan.id, publishBody.dataPlan.id);
  assert.equal(retryBody.dataSnapshot.id, publishBody.dataSnapshot.id);

  const idempotencyConflict = await jsonFetch(`/api/projects/${project.id}/data-plans/publish`, {
    method: "POST",
    body: { ...publishRequest, expectedPreviewHash: "sha256_other" },
  });
  assert.equal(idempotencyConflict.status, 409);
  assert.equal((await idempotencyConflict.json()).error.code, "idempotency_key_conflict");

  const stale = await jsonFetch(`/api/projects/${project.id}/data-plans/publish`, {
    method: "POST",
    body: {
      ...publishRequest,
      expectedPreviewHash: "sha256_stale",
      idempotencyKey: "publish_route_exp33_stale",
    },
  });
  assert.equal(stale.status, 409);
  const staleBody = await stale.json();
  assert.equal(staleBody.error.code, "preview_stale");
  assert.match(staleBody.error.details.currentPreviewHash, /^sha256_/);
  assert.equal(staleBody.error.details.currentReview.reviewSummary.blockers.length, 0);

  const dataPlans = await jsonFetch(`/api/projects/${project.id}/data-plans`);
  assert.equal(dataPlans.status, 200);
  const dataPlansBody = await dataPlans.json();
  assert.equal(dataPlansBody.dataPlans.length, 1);
  assert.equal(dataPlansBody.dataPlans[0].status, "accepted");
  const dataSnapshots = await jsonFetch(`/api/projects/${project.id}/data-snapshots`);
  assert.equal(dataSnapshots.status, 200);
  const dataSnapshotsBody = await dataSnapshots.json();
  assert.equal(dataSnapshotsBody.dataSnapshots.length, 1);
  assert.equal(dataSnapshotsBody.dataSnapshots[0].experimentRecordCount, 1);
  assert.equal(JSON.stringify(dataSnapshotsBody).includes("points"), false);

  const publishedState = await (await jsonFetch(`/api/projects/${project.id}/state`)).json();
  assert.equal(publishedState.sourceDocuments.length, 1);
  assert.equal(publishedState.dataPlans.length, 1);
  assert.equal(publishedState.dataSnapshots.length, 1);
  assert.equal(publishedState.experimentSnapshotHeads.length, 1);

  const browserResponse = await jsonFetch(`/api/projects/${project.id}/experiment-browser?limit=1`);
  assert.equal(browserResponse.status, 200);
  const browserBody = await browserResponse.json();
  assert.equal(browserBody.totalCount, 1);
  assert.equal(browserBody.rows.length, 1);
  assert.equal(browserBody.rows[0].label, "Exp33");
  assert.equal(browserBody.columns[0].id, "experiment");
  assert.equal(JSON.stringify(browserBody.rows).includes('"points"'), false);

  const experimentDetail = await jsonFetch(`/api/projects/${project.id}/experiments/${browserBody.rows[0].experimentId}`);
  assert.equal(experimentDetail.status, 200);
  const experimentDetailBody = await experimentDetail.json();
  assert.equal(experimentDetailBody.record.label, "Exp33");
  assert.equal(experimentDetailBody.record.series[0].points.length, 2);

  const unknownExperiment = await jsonFetch(`/api/projects/${project.id}/experiments/experiment_missing`);
  assert.equal(unknownExperiment.status, 404);
  assert.equal((await unknownExperiment.json()).error.code, "experiment_not_found");

  const otherProject = await createProject("Other DataPlan Publish Project");
  const crossProjectExperiment = await jsonFetch(`/api/projects/${otherProject.id}/experiments/${browserBody.rows[0].experimentId}`);
  assert.equal(crossProjectExperiment.status, 404);
  const crossProject = await jsonFetch(`/api/projects/${otherProject.id}/data-plans/publish`, {
    method: "POST",
    body: { ...publishRequest, idempotencyKey: "publish_cross_project_1" },
  });
  assert.equal(crossProject.status, 422);
  assert.equal((await crossProject.json()).error.code, "accepted_workbook_understanding_not_found");

  const ownerCookie = cookie;
  try {
    const adminLogin = await jsonFetch("/api/auth/login", {
      method: "POST",
      body: { username: "admin", password: "LabRatAdmin123!" },
    });
    cookie = cookieFrom(adminLogin);
    const viewerUsername = `publish_viewer_${Date.now()}`;
    const viewerPassword = "PublishViewer123!";
    const createViewer = await jsonFetch("/api/admin/users", {
      method: "POST",
      body: {
        username: viewerUsername,
        displayName: "Publish Viewer",
        temporaryPassword: viewerPassword,
        labId: project.labId,
        role: "viewer",
      },
    });
    assert.equal(createViewer.status, 201);
    const viewerLogin = await jsonFetch("/api/auth/login", {
      method: "POST",
      body: { username: viewerUsername, password: viewerPassword },
    });
    cookie = cookieFrom(viewerLogin);
    const viewerPublish = await jsonFetch(`/api/projects/${project.id}/data-plans/publish`, {
      method: "POST",
      body: { ...publishRequest, idempotencyKey: "publish_viewer_forbidden" },
    });
    assert.equal(viewerPublish.status, 403);
    assert.equal((await viewerPublish.json()).error.code, "forbidden");
  } finally {
    cookie = ownerCookie;
  }

  const missingUnderstanding = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      workbookUnderstandingIds: ["workbook_understanding_missing"],
      identityDecisions: [],
    },
  });
  assert.equal(missingUnderstanding.status, 200);
  const missingBody = await missingUnderstanding.json();
  assert.equal(missingBody.resultKind, "clarification");
  assert.equal(missingBody.clarification.code, "accepted_workbook_understanding_not_found");

  const wrongIntent = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "chart_data",
      workbookUnderstandingIds: [confirmBody.workbookUnderstanding.id],
      identityDecisions: [],
    },
  });
  assert.equal(wrongIntent.status, 200);
  const wrongIntentBody = await wrongIntent.json();
  assert.equal(wrongIntentBody.resultKind, "clarification");
  assert.equal(wrongIntentBody.clarification.code, "invalid_data_plan_intent");
});

test("golden workbook publishes three reviewed experiments to Browser without legacy artifacts", async () => {
  const project = await createProject("Golden Workbook Browser Project");
  const upload = await uploadProjectFile(
    project.id,
    goldenExperimentBrowserBlob(),
    goldenExperimentBrowserFixture.filename,
  );
  assert.equal(upload.response.status, 201);
  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  const sessionId = createBody.workbookReviewSession.id;
  const sourceDocumentId = createBody.sourceDocument.id;

  const revision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "Runs is an experiment table with one experiment per row. The first column is the experiment identity.",
      redBoxUpdates: [],
    },
  });
  assert.equal(revision.status, 200);
  const revisionBody = await revision.json();
  const confirm = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/confirm`, {
    method: "POST",
    body: {
      workbookUnderstandingId: revisionBody.workbookUnderstandingDraft.id,
      decisionSummary: { acceptedByUser: true },
    },
  });
  assert.equal(confirm.status, 200);
  const accepted = (await confirm.json()).workbookUnderstanding;
  const identityDecisions = goldenExperimentBrowserFixture.expectedExperimentLabels.map((sourceAlias) => ({
    sourceAlias,
    action: "create",
  }));
  const draft = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      workbookUnderstandingIds: [accepted.id],
      identityDecisions,
    },
  });
  assert.equal(draft.status, 200);
  const review = await draft.json();
  assert.deepEqual(review.reviewSummary.blockers, []);
  assert.deepEqual(
    review.snapshotPreview.experimentRecords.map((record) => record.label),
    goldenExperimentBrowserFixture.expectedExperimentLabels,
  );
  assert.equal(review.snapshotPreview.skippedRows.some((row) => row.rowNumber === 3), true);

  const publish = await jsonFetch(`/api/projects/${project.id}/data-plans/publish`, {
    method: "POST",
    body: {
      dataPlan: review.dataPlan,
      identityDecisions,
      expectedPreviewHash: review.snapshotPreview.previewHash,
      expectedDependencyHash: review.dataPlan.dependencyHash,
      idempotencyKey: "golden_workbook_publish_v1",
    },
  });
  assert.equal(publish.status, 201);

  const state = await (await jsonFetch(`/api/projects/${project.id}/state`)).json();
  assert.equal(state.dataPlans.length, 1);
  assert.equal(state.dataSnapshots.length, 1);
  assert.equal(state.experimentSnapshotHeads.length, 3);
  assert.equal(state.datasetCommits, undefined);
  assert.equal(state.mappingSets, undefined);

  const browser = await jsonFetch(`/api/projects/${project.id}/experiment-browser?limit=10`);
  assert.equal(browser.status, 200);
  const projection = await browser.json();
  assert.equal(projection.totalCount, 3);
  assert.deepEqual(projection.rows.map((row) => row.label), goldenExperimentBrowserFixture.expectedExperimentLabels);
  assert.equal(JSON.stringify(projection.rows).includes('"points"'), false);
});

test("grouped selectivity headers publish Solid, Liquid, and Gas fields to Browser", async () => {
  const project = await createProject("Grouped Selectivity Browser Project");
  const upload = await uploadProjectFile(
    project.id,
    groupedMasterTableBlob(),
    groupedMasterTableFixture.filename,
  );
  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  const sessionId = createBody.workbookReviewSession.id;
  const sourceDocumentId = createBody.sourceDocument.id;

  const sourceRange = await jsonFetch(`/api/source-documents/${sourceDocumentId}/range`, {
    method: "POST",
    body: { sheetName: groupedMasterTableFixture.sheetName, range: "L1:N2" },
  });
  assert.equal(sourceRange.status, 200);
  const sourceRangeBody = await sourceRange.json();
  assert.deepEqual(
    sourceRangeBody.rows[0].map((cell) => [cell.address, cell.mergedRange]),
    [["L1", "L1:N1"], ["M1", "L1:N1"], ["N1", "L1:N1"]],
  );

  const revision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "This is an experiment table with grouped selectivity headers and one experiment per row.",
      redBoxUpdates: [{
        clientRegionId: "draft_grouped_master",
        operation: "upsert",
        sourceDocumentId,
        sheetName: groupedMasterTableFixture.sheetName,
        range: "A1:N4",
        selectionMethod: "drag_select",
        description: "experiment table",
      }],
    },
  });
  assert.equal(revision.status, 200);
  const revisionBody = await revision.json();
  const draftUnderstanding = revisionBody.workbookUnderstandingDraft;
  const groupedFact = draftUnderstanding.facts.find((fact) => fact.range === "A1:N4");
  assert.ok(groupedFact);
  const interpretation = groupedFact.interpretation;
  assert.deepEqual(
    interpretation.fields
      .filter((field) => field.semanticKey.startsWith("selectivity_"))
      .map((field) => [field.semanticKey, field.column, field.unit]),
    [
      ["selectivity_solid", "L", "percent"],
      ["selectivity_liquid", "M", "percent"],
      ["selectivity_gas", "N", "percent"],
    ],
    JSON.stringify(interpretation.fields.map((field) => ({
      key: field.semanticKey,
      column: field.column,
      name: field.displayName,
      unit: field.unit,
    }))),
  );

  const confirm = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/confirm`, {
    method: "POST",
    body: {
      workbookUnderstandingId: draftUnderstanding.id,
      decisionSummary: { acceptedByUser: true },
    },
  });
  assert.equal(confirm.status, 200);
  const accepted = (await confirm.json()).workbookUnderstanding;
  const identityDecisions = ["Exp1", "Exp2"].map((sourceAlias) => ({ sourceAlias, action: "create" }));
  const draft = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      workbookUnderstandingIds: [accepted.id],
      identityDecisions,
    },
  });
  assert.equal(draft.status, 200);
  const review = await draft.json();
  assert.deepEqual(review.reviewSummary.blockers, []);
  const selectivityBindings = review.dataPlan.operations
    .find((operation) => operation.op === "bind_fields")
    .fields
    .filter((field) => field.fieldKey.startsWith("selectivity_"));
  assert.deepEqual(
    selectivityBindings.map((field) => [
      field.fieldKey,
      field.headerSourceRefs.map((sourceRef) => sourceRef.cell),
    ]),
    [
      ["selectivity_solid", ["L1", "L2"]],
      ["selectivity_liquid", ["L1", "M2"]],
      ["selectivity_gas", ["L1", "N2"]],
    ],
  );

  const publish = await jsonFetch(`/api/projects/${project.id}/data-plans/publish`, {
    method: "POST",
    body: {
      dataPlan: review.dataPlan,
      identityDecisions,
      expectedPreviewHash: review.snapshotPreview.previewHash,
      expectedDependencyHash: review.dataPlan.dependencyHash,
      idempotencyKey: "grouped_selectivity_publish_v1",
    },
  });
  assert.equal(publish.status, 201);

  const browser = await jsonFetch(`/api/projects/${project.id}/experiment-browser?limit=10`);
  assert.equal(browser.status, 200);
  const projection = await browser.json();
  const selectivityColumns = projection.columns.filter((column) => column.fieldKey?.startsWith("selectivity_"));
  assert.deepEqual(
    selectivityColumns.map((column) => column.fieldKey).sort(),
    ["selectivity_gas", "selectivity_liquid", "selectivity_solid"],
  );
  const exp1 = projection.rows.find((row) => row.label === "Exp1");
  const values = Object.fromEntries(selectivityColumns.map((column) => [
    column.fieldKey,
    exp1.cells[column.id]?.value,
  ]));
  assert.deepEqual(values, {
    selectivity_solid: 92.8,
    selectivity_liquid: 0.1,
    selectivity_gas: 0.35,
  });
  const detail = await jsonFetch(`/api/projects/${project.id}/experiments/${exp1.experimentId}`);
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  const gasField = detailBody.record.fields.find((field) => field.fieldKey === "selectivity_gas");
  assert.deepEqual(gasField.headerSourceRefs.map((sourceRef) => sourceRef.cell), ["L1", "N2"]);
  assert.equal(gasField.sourceRefs[0].cell, "N3");
});

test("BrowserView routes persist only owner-scoped personal display state", async () => {
  const project = await createProject("Personal Browser Views Project");
  const otherProject = await createProject("Other Browser Views Project");
  const ownerCookie = cookie;
  const createFirst = await jsonFetch(`/api/projects/${project.id}/browser-views`, {
    method: "POST",
    body: {
      name: "High yield screen",
      isDefault: true,
      payload: {
        columns: [{ columnId: "field:yield:percent:number", order: 0, width: 160, hidden: false }],
        filters: [{ columnId: "field:yield:percent:number", operator: "gte", value: 40 }],
        sort: [{ columnId: "field:yield:percent:number", direction: "desc" }],
        groupBy: null,
        selectedExperimentIds: ["experiment_missing_after_republish"],
      },
    },
  });
  assert.equal(createFirst.status, 201);
  const firstView = (await createFirst.json()).browserView;
  assert.equal(firstView.ownerUserId, "user_labuser");
  assert.equal(firstView.isDefault, true);

  const createSecond = await jsonFetch(`/api/projects/${project.id}/browser-views`, {
    method: "POST",
    body: { name: "Second default", isDefault: true, payload: { columns: [], filters: [], sort: [], groupBy: null, selectedExperimentIds: [] } },
  });
  assert.equal(createSecond.status, 201);
  const secondView = (await createSecond.json()).browserView;
  const ownerList = await jsonFetch(`/api/projects/${project.id}/browser-views`);
  assert.equal(ownerList.status, 200);
  const ownerViews = (await ownerList.json()).browserViews;
  assert.equal(ownerViews.length, 2);
  assert.equal(ownerViews.find((view) => view.id === firstView.id).isDefault, false);
  assert.equal(ownerViews.find((view) => view.id === secondView.id).isDefault, true);

  const renamed = await jsonFetch(`/api/projects/${project.id}/browser-views/${firstView.id}`, {
    method: "PATCH",
    body: { name: "Renamed screen", isDefault: true, payload: firstView.payload },
  });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).browserView.name, "Renamed screen");

  const invalid = await jsonFetch(`/api/projects/${project.id}/browser-views`, {
    method: "POST",
    body: { name: "Invalid scientific values", payload: { rows: [{ value: 999 }] } },
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "invalid_browser_view");

  const wrongProject = await jsonFetch(`/api/projects/${otherProject.id}/browser-views/${firstView.id}`, {
    method: "PATCH",
    body: { name: "Cross-project rename" },
  });
  assert.equal(wrongProject.status, 404);

  try {
    const adminLogin = await jsonFetch("/api/auth/login", {
      method: "POST",
      body: { username: "admin", password: "LabRatAdmin123!" },
    });
    cookie = cookieFrom(adminLogin);
    const viewerUsername = `browser_viewer_${Date.now()}`;
    const viewerPassword = "BrowserViewer123!";
    const createViewer = await jsonFetch("/api/admin/users", {
      method: "POST",
      body: {
        username: viewerUsername,
        displayName: "Browser View Viewer",
        temporaryPassword: viewerPassword,
        labId: project.labId,
        role: "viewer",
      },
    });
    assert.equal(createViewer.status, 201);
    const viewerLogin = await jsonFetch("/api/auth/login", {
      method: "POST",
      body: { username: viewerUsername, password: viewerPassword },
    });
    cookie = cookieFrom(viewerLogin);

    const viewerList = await jsonFetch(`/api/projects/${project.id}/browser-views`);
    assert.equal(viewerList.status, 200);
    assert.deepEqual((await viewerList.json()).browserViews, []);
    const ownerViewPatch = await jsonFetch(`/api/projects/${project.id}/browser-views/${firstView.id}`, {
      method: "PATCH",
      body: { name: "Not mine" },
    });
    assert.equal(ownerViewPatch.status, 404);
    const viewerCreate = await jsonFetch(`/api/projects/${project.id}/browser-views`, {
      method: "POST",
      body: { name: "Viewer personal view", payload: { columns: [], filters: [], sort: [], selectedExperimentIds: [] } },
    });
    assert.equal(viewerCreate.status, 201);
  } finally {
    cookie = ownerCookie;
  }

  const deleteView = await jsonFetch(`/api/projects/${project.id}/browser-views/${secondView.id}`, { method: "DELETE" });
  assert.equal(deleteView.status, 200);
  assert.equal((await deleteView.json()).deleted, true);
});

test("workbook review revisions respond only about the current red box when replacing selection", async () => {
  const project = await createProject("Workbook Current Selection Project");
  const upload = await uploadProjectFile(project.id, makeWorkbookBlob(), "current-selection.xlsx");
  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  const sessionId = createBody.workbookReviewSession.id;
  const sourceDocumentId = createBody.sourceDocument.id;

  const firstRevision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "This red box is the experiment condition table.",
      redBoxUpdates: [{
        clientRegionId: "draft_region_old",
        operation: "upsert",
        sourceDocumentId,
        sheetName: "Runs",
        range: "A1:D3",
        selectionMethod: "drag_select",
        description: "experiment condition table",
      }],
    },
  });
  assert.equal(firstRevision.status, 200);
  const firstBody = await firstRevision.json();

  const secondRevision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: {
      message: "new",
      previousUnderstandingId: firstBody.workbookUnderstandingDraft.id,
      revisionMode: "replace_current",
      activeDraftRegionId: "draft_region_active",
      redBoxUpdates: [{
        clientRegionId: "draft_region_active",
        draftRegionId: "draft_region_active",
        operation: "upsert",
        sourceDocumentId,
        sheetName: "Runs",
        range: "C1:D2",
        selectionMethod: "drag_select",
        description: "",
      }],
    },
  });
  assert.equal(secondRevision.status, 200);
  const secondBody = await secondRevision.json();
  assert.equal(secondBody.revisionMode, "replace_current");
  assert.equal(secondBody.activeDraftRegionId, "draft_region_active");
  assert.equal(secondBody.changedRegions.length, 1);
  assert.equal(secondBody.changedRegions[0].range, "C1:D2");
  const assistantMessage = secondBody.messages.find((message) => message.role === "assistant")?.content || "";
  assert.match(assistantMessage, /I selected Runs!C1:D2/);
  assert.doesNotMatch(assistantMessage, /A1:D3/);
  assert.doesNotMatch(assistantMessage, /as unknown_region/);
  assert.equal(secondBody.workbookUnderstandingDraft.pendingQuestions.some((question) => question.draftRegionId === "draft_region_active"), true);
});

test("source documents expose bounded ranges, cell search, and extract previews", async () => {
  const project = await createProject("Source Document Project");
  await uploadAndCreateImportRun(project.id, makeWorkbookBlob(), "source.xlsx");
  const documents = await (await jsonFetch(`/api/projects/${project.id}/source-documents`)).json();
  const sourceDocument = documents.sourceDocuments[0];

  const regionsResponse = await jsonFetch(`/api/source-documents/${sourceDocument.id}/regions`);
  assert.equal(regionsResponse.status, 200);
  const regionsBody = await regionsResponse.json();
  assert.equal(regionsBody.schemaVersion, "labrat.sourceRegionList.v1");
  assert.equal(regionsBody.regions.length > 0, true);
  assert.equal(JSON.stringify(regionsBody).includes('"cells"'), false);

  const queryResponse = await jsonFetch(`/api/source-documents/${sourceDocument.id}/query`, {
    method: "POST",
    body: { query: "Temperature", limit: 10 },
  });
  assert.equal(queryResponse.status, 200);
  const queryBody = await queryResponse.json();
  assert.equal(queryBody.matches.some((match) => match.type === "cell" && match.sheetName === "Runs"), true);

  const rangeResponse = await jsonFetch(`/api/source-documents/${sourceDocument.id}/range`, {
    method: "POST",
    body: { sheetName: "Runs", range: "A1:B2" },
  });
  assert.equal(rangeResponse.status, 200);
  const rangeBody = await rangeResponse.json();
  assert.equal(rangeBody.cells.find((cell) => cell.address === "A1").rawValue, "Label");
  assert.equal(rangeBody.cells.find((cell) => cell.address === "B2").rawValue, 250);

  const oversized = await jsonFetch(`/api/source-documents/${sourceDocument.id}/range`, {
    method: "POST",
    body: { sheetName: "Runs", range: "A1:ZZ100" },
  });
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).error.code, "source_range_too_large");
});

test("source extract proposals preserve original cell refs and create source-backed chart specs", async () => {
  const project = await createProject("Source Extract Project");
  await uploadAndCreateImportRun(project.id, makeComponentDistributionWorkbookBlob(), "Calculation_Exp30.xlsx");
  const documents = await (await jsonFetch(`/api/projects/${project.id}/source-documents`)).json();
  const sourceDocument = documents.sourceDocuments[0];

  const previewResponse = await jsonFetch(`/api/source-documents/${sourceDocument.id}/extract-preview`, {
    method: "POST",
    body: {
      sheetName: "Sheet1",
      range: "A1:E3",
      extractType: "component_distribution",
      intent: { title: "Exp30 Overall tots", chartTitle: "Exp30 carbon number distribution" },
    },
  });
  assert.equal(previewResponse.status, 200);
  const previewBody = await previewResponse.json();
  assert.deepEqual(previewBody.preview.rows.map((row) => row.values.carbon_number), [1, 2, 3, 4]);
  assert.equal(previewBody.preview.rows[0].sourceRefs.some((ref) => ref.cell === "B2" && ref.fieldId === "percentage"), true);

  const proposalResponse = await jsonFetch(`/api/projects/${project.id}/source-extract-proposals`, {
    method: "POST",
    body: {
      sourceDocumentId: sourceDocument.id,
      sheetName: "Sheet1",
      range: "A1:E3",
      extractType: "component_distribution",
      purpose: "chart_source",
      intent: { chartTitle: "Exp30 carbon number distribution" },
    },
  });
  assert.equal(proposalResponse.status, 201);
  const proposal = (await proposalResponse.json()).sourceExtractProposal;
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.datasetCommitId, undefined);
  assert.equal(proposal.preview.rows[2].sourceRefs.some((ref) => ref.cell === "D2"), true);

  const prematureChart = await jsonFetch(`/api/source-extract-proposals/${proposal.id}/chart-proposal`, {
    method: "POST",
    body: {},
  });
  assert.equal(prematureChart.status, 409);

  const accepted = await jsonFetch(`/api/source-extract-proposals/${proposal.id}`, {
    method: "PATCH",
    body: { status: "accepted", decisionSummary: { acceptedByUser: true } },
  });
  assert.equal(accepted.status, 200);

  const chartProposalResponse = await jsonFetch(`/api/source-extract-proposals/${proposal.id}/chart-proposal`, {
    method: "POST",
    body: {},
  });
  assert.equal(chartProposalResponse.status, 201);
  const chartProposalSet = (await chartProposalResponse.json()).chartProposalSet;
  const chartProposal = chartProposalSet.payload.proposals[0];
  assert.equal(chartProposal.origin, "source_extract");
  assert.equal(chartProposal.chartSpecDraft.datasetCommitId, undefined);
  assert.equal(chartProposal.sourceSnapshot.rows.length, 4);

  const chartSpecResponse = await jsonFetch(`/api/projects/${project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      chartProposalSetId: chartProposalSet.id,
      proposalId: chartProposal.proposalId,
    },
  });
  assert.equal(chartSpecResponse.status, 201);
  const chartSpec = (await chartSpecResponse.json()).chartSpec;
  assert.equal(chartSpec.datasetCommitId, undefined);
  assert.equal(chartSpec.spec.origin, "source_extract");
  assert.equal(chartSpec.spec.sourceSnapshot.rows.length, 4);
});

test("chart interpret creates source extract proposals for explicit original-index Excel ranges", async () => {
  const project = await createProject("Evidence Interpret Project");
  await uploadAndCreateImportRun(
    project.id,
    makeCalculationRangeWorkbookBlob({ invalidSheets: ["Notes"], validSheets: ["Carbon Balance"] }),
    "Calculation_Exp33.xlsx",
  );

  const response = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: {
      prompt: "draw carbon balance distribution of experiment 33, bar chart, using c-number distribution data from P31 to BA32 in calculation33",
      persistAsProposal: true,
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.chartProposalSet, null);
  assert.equal(body.chartSpecDraft, null);
  assert.equal(body.clarification, null);
  assert.equal(body.evidenceIntent.range, "P31:BA32");
  assert.equal(body.evidenceResolution.sheetName, "Carbon Balance");
  assert.equal(body.sourceExtractProposal.preview.rows[0].cells.carbon_number, "Q31");
  assert.equal(body.sourceExtractProposal.preview.rows[0].cells.percentage, "Q32");
  assert.equal(JSON.stringify(body).includes("Which C-number distribution fields should be used?"), false);
});

test("source evidence cross-compare creates series-backed source extract chart specs", async () => {
  const project = await createProject("Source Evidence Cross Compare Project");
  for (const fixture of [
    { exp: 33, values: [5, 12.5, 21, 9.5] },
    { exp: 34, values: [6, 13, 22, 10] },
    { exp: 35, values: [7, 14, 23, 11] },
  ]) {
    await uploadAndCreateImportRun(
      project.id,
      makeCalculationRangeWorkbookBlob({ values: fixture.values }),
      `Calculation_Exp${fixture.exp}.xlsx`,
    );
  }

  const response = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: {
      prompt: "draw a cross-compare carbon balance distribution chart for experiments 33, 34, and 35 using c-number distribution data from P31 to BA32 in calculation files",
      persistAsProposal: true,
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.clarification, null);
  assert.equal(body.evidenceResolution.mode, "multi_source_series");
  assert.deepEqual(body.evidenceResolution.series.map((series) => series.experimentAlias), ["Exp33", "Exp34", "Exp35"]);
  assert.deepEqual(body.sourceExtractProposal.preview.series.map((series) => series.rows[0].values.percentage), [5, 6, 7]);

  const accept = await jsonFetch(`/api/source-extract-proposals/${body.sourceExtractProposal.id}`, {
    method: "PATCH",
    body: { status: "accepted", decisionSummary: { acceptedByUser: true } },
  });
  assert.equal(accept.status, 200);
  const chartProposalResponse = await jsonFetch(`/api/source-extract-proposals/${body.sourceExtractProposal.id}/chart-proposal`, {
    method: "POST",
    body: {},
  });
  assert.equal(chartProposalResponse.status, 201);
  const chartProposalSet = (await chartProposalResponse.json()).chartProposalSet;
  const proposal = chartProposalSet.payload.proposals[0];
  assert.equal(proposal.seriesScope.groupBy, "experiment");
  assert.equal(proposal.series.length, 3);
  assert.equal(proposal.sourceSnapshot.series.length, 3);

  const specResponse = await jsonFetch(`/api/projects/${project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      chartProposalSetId: chartProposalSet.id,
      proposalId: proposal.proposalId,
    },
  });
  assert.equal(specResponse.status, 201);
  const spec = (await specResponse.json()).chartSpec.spec;
  assert.equal(spec.schemaVersion, "labrat.chartSpec.v1.4");
  assert.equal(spec.seriesScope.seriesKind, "component_distribution");
  assert.equal(spec.sourceSnapshot.series.length, 3);
});

test("legacy dataset, mapping, analysis, and dataset-chart routes are retired", async () => {
  const project = await createProject("Snapshot Browser Project");
  for (const request of [
    { path: `/api/projects/${project.id}/dataset-commits`, method: "GET" },
    { path: `/api/projects/${project.id}/mapping-sets`, method: "GET" },
    { path: `/api/projects/${project.id}/mapping-sets`, method: "POST", body: {} },
    { path: `/api/projects/${project.id}/analysis-views`, method: "GET" },
    { path: `/api/projects/${project.id}/analysis-views`, method: "POST", body: {} },
  ]) {
    const response = await jsonFetch(request.path, { method: request.method, body: request.body });
    assert.equal(response.status, 404, `${request.method} ${request.path}`);
  }

  const interpret = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: { prompt: "plot gas selectivity vs temperature" },
  });
  assert.equal(interpret.status, 409);
  assert.equal((await interpret.json()).error.code, "data_snapshot_chart_not_implemented");

  const propose = await jsonFetch(`/api/projects/${project.id}/charts/propose`, {
    method: "POST",
    body: { userGoal: "Find charts" },
  });
  assert.equal(propose.status, 404);
});

test("agent planner uses one workbook upload action and no legacy upload/supplement actions", async () => {
  const project = await createProject("Agent Plan Project");
  const upload = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "upload supplement reaction rate for Exp30" },
  });
  assert.equal(upload.status, 200);
  const uploadBody = await upload.json();
  assert.equal(uploadBody.actions[0].type, "upload_workbook_for_review");
  assert.equal(uploadBody.actions[0].requiresFile, true);
  assert.equal(JSON.stringify(uploadBody).includes("upload_supplement"), false);

  const chart = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "plot gas selectivity vs temperature" },
  });
  assert.equal(chart.status, 200);
  const chartBody = await chart.json();
  assert.equal(chartBody.actions[0].type, "interpret_chart");

  const compare = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "compare Exp30 and Exp31 in a table" },
  });
  assert.equal(compare.status, 200);
  const compareBody = await compare.json();
  assert.equal(compareBody.actions[0].type, "open_experiment_browser");
  assert.equal(compareBody.contextSummary.currentDatasetCommitId, undefined);
});

test("project-content AgentRun returns a direct read-only answer without confirmation actions", async () => {
  const project = await createProject("Agent Project Summary");
  const run = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "这个项目目前有什么内容？" },
  });
  assert.equal(run.status, 201);
  const body = await run.json();
  assert.equal(body.agentRun.mode, "project_summary");
  assert.equal(body.agentRun.status, "completed");
  assert.deepEqual(body.agentRun.actions, []);
  assert.match(body.reply, /Agent Project Summary/);
});

test("source extract AgentRun remains review-gated and confirmable", async () => {
  const project = await createProject("AgentRun Source Project");
  await uploadAndCreateImportRun(
    project.id,
    makeComponentDistributionWorkbookBlob({ headerRowNumber: 68 }),
    "Calculation_Exp30.xlsx",
  );

  const runResponse = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "use Overall tots row 69 to plot Exp30 carbon number distribution" },
  });
  assert.equal(runResponse.status, 201);
  const runBody = await runResponse.json();
  assert.equal(runBody.agentRun.mode, "source_extract");
  assert.equal(runBody.agentRun.status, "waiting_for_user");
  const action = runBody.agentRun.actions[0];
  assert.equal(action.type, "create_source_extract_proposal");

  const confirm = await jsonFetch(`/api/agent-runs/${runBody.agentRun.id}/confirm`, {
    method: "POST",
    body: { actionId: action.actionId },
  });
  assert.equal(confirm.status, 200);
  const confirmBody = await confirm.json();
  assert.equal(confirmBody.agentRun.status, "completed");
  assert.equal(confirmBody.sourceExtractProposal.status, "proposed");
  assert.equal(confirmBody.chartProposalSet, null);

  const secondConfirm = await jsonFetch(`/api/agent-runs/${runBody.agentRun.id}/confirm`, {
    method: "POST",
    body: { actionId: action.actionId },
  });
  assert.equal(secondConfirm.status, 409);
});

test("manuscripts round trip blocks and pages", async () => {
  const project = await createProject("Manuscript Project");
  const create = await jsonFetch(`/api/projects/${project.id}/manuscripts`, {
    method: "POST",
    body: {
      title: "Group Meeting",
      blocks: [{ id: "block_1", kind: "text", text: "Hello" }],
      pages: [{ id: "page_1", width: 1600, height: 900 }],
      canvasState: { height: 900 },
      references: [],
    },
  });
  assert.equal(create.status, 201);
  const manuscript = (await create.json()).manuscript;
  assert.match(manuscript.id, /^manuscript_/);

  const patch = await jsonFetch(`/api/manuscripts/${manuscript.id}`, {
    method: "PATCH",
    body: {
      title: "Updated Meeting",
      blocks: [...manuscript.blocks, { id: "block_2", kind: "text", text: "World" }],
    },
  });
  assert.equal(patch.status, 200);
  const patched = (await patch.json()).manuscript;
  assert.equal(patched.title, "Updated Meeting");
  assert.equal(patched.blocks.length, 2);

  const list = await jsonFetch(`/api/projects/${project.id}/manuscripts`);
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.manuscripts.some((item) => item.id === manuscript.id), true);
});

test("logout revokes the current session", async () => {
  const logout = await jsonFetch("/api/auth/logout", { method: "POST", body: {} });
  assert.equal(logout.status, 200);
  const me = await jsonFetch("/api/auth/me");
  assert.equal(me.status, 401);
});
