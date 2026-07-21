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
import { analysisFieldId, resolveAnalysisSelection } from "../analysisSelection.js";
import { ANALYSIS_PLAN_REVISION_VERSION, pythonSourceHash } from "../analysisSchemas.js";
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

async function confirmReviewRegion(sessionId, reviewRegion) {
  const response = await jsonFetch(
    `/api/workbook-review-sessions/${sessionId}/regions/${reviewRegion.id}/confirm`,
    {
      method: "POST",
      body: {
        revisionId: reviewRegion.currentRevision.id,
        expectedRegionVersion: reviewRegion.version,
        idempotencyKey: `confirm_${reviewRegion.id}_${Date.now()}`,
      },
    },
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function publishGroupedSelectivityDataForAnalysis(project, suffix) {
  const upload = await uploadProjectFile(
    project.id,
    groupedMasterTableBlob(),
    groupedMasterTableFixture.filename,
  );
  assert.equal(upload.response.status, 201);
  const created = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const reviewRegion = createdBody.reviewRegions.find((region) => region.rangeRef === "A1:N4")
    || createdBody.reviewRegions[0];
  const confirmed = await confirmReviewRegion(createdBody.workbookReviewSession.id, reviewRegion);
  const identityDecisions = ["Exp1", "Exp2"].map((sourceAlias) => ({
    sourceAlias,
    action: "create",
  }));
  const drafted = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      regionUnderstandingRevisionIds: [confirmed.acceptedRevision.id],
      identityDecisions,
    },
  });
  assert.equal(drafted.status, 200);
  const draftBody = await drafted.json();
  assert.deepEqual(draftBody.reviewSummary.blockers, []);
  const published = await jsonFetch(`/api/projects/${project.id}/data-plans/publish`, {
    method: "POST",
    body: {
      dataPlan: draftBody.dataPlan,
      identityDecisions,
      expectedPreviewHash: draftBody.snapshotPreview.previewHash,
      expectedDependencyHash: draftBody.dataPlan.dependencyHash,
      idempotencyKey: `golden_analysis_data_${suffix}`,
    },
  });
  assert.equal(published.status, 201);
  return published.json();
}

function seedRouteAnalysisData(project, suffix = "route") {
  const experimentId = `experiment_analysis_${suffix}`;
  const snapshotId = `data_snapshot_analysis_${suffix}`;
  const headId = `head_analysis_${suffix}`;
  const fieldId = analysisFieldId({
    fieldKey: "yield",
    unit: "percent",
    valueType: "number",
  });
  store.experimentIdentities.set(experimentId, {
    id: experimentId,
    labId: project.labId,
    projectId: project.id,
    canonicalLabel: `Exp ${suffix}`,
    aliases: [`Exp${suffix}`],
  });
  store.dataSnapshots.set(snapshotId, {
    id: snapshotId,
    labId: project.labId,
    projectId: project.id,
    status: "accepted",
    contentHash: `sha256_snapshot_${suffix}`,
    dependencyHash: `sha256_dependency_${suffix}`,
    experimentRecords: [{
      experimentId,
      label: `Exp ${suffix}`,
      fields: [{
        fieldKey: "yield",
        displayName: "Yield",
        unit: "percent",
        valueType: "number",
        role: "outcome",
        value: 37.5,
        sourceRefs: [{
          sourceType: "excel_cell",
          sourceDocumentId: `source_document_${suffix}`,
          sheet: "Runs",
          cell: "B2",
        }],
        warnings: [],
      }],
      series: [],
      sourceRefs: [],
      warnings: [],
    }],
  });
  store.experimentSnapshotHeads.set(headId, {
    id: headId,
    labId: project.labId,
    projectId: project.id,
    experimentId,
    dataSnapshotId: snapshotId,
    recordIndex: 0,
  });
  const selectionRequest = {
    experimentIds: [experimentId],
    fieldIds: [fieldId],
    includeSeries: false,
  };
  const selection = resolveAnalysisSelection({
    projectId: project.id,
    dataSnapshots: [...store.dataSnapshots.values()],
    experimentIdentities: [...store.experimentIdentities.values()],
    experimentSnapshotHeads: [...store.experimentSnapshotHeads.values()],
    selectionRequest,
  });
  const source = [
    "def analyze(tables, labrat):",
    "    return {'result_table': [], 'traces': [], 'lineage': {}, 'summary': {}}",
  ].join("\n");
  const plan = {
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    requestSummary: "Compare accepted yield values.",
    selection: {
      selectionId: selection.selectionId,
      experimentIds: selection.experimentIds,
      fieldIds: selection.fieldIds,
      dependencyHash: selection.dependencyHash,
      selectionHash: selection.selectionHash,
    },
    processingSummary: ["Use each accepted yield value once."],
    calculationManifest: {
      inputs: [{ fieldId, fieldKey: "yield", unit: "percent" }],
      missingValuePolicy: { mode: "exclude_record", requiredFieldIds: [fieldId] },
      derivedFields: [],
      invariants: [],
    },
    pythonProgram: {
      runtime: "labrat-python-v1",
      entrypoint: "analyze",
      source,
      sourceHash: pythonSourceHash(source),
    },
    expectedOutput: {
      shape: "experiment_traces",
      chartType: "bar",
      xField: "experiment_label",
      yFields: ["yield"],
    },
    warnings: [],
  };
  return { plan, selection, selectionRequest };
}

const testModelProvider = {
  async classifyIntent() {
    return { ok: false };
  },
  async answerReadOnly() {
    return { ok: false };
  },
  async draftAnalysisPlan(input) {
    const field = input.fields?.find((candidate) => candidate.valueType === "number")
      || input.fields?.[0];
    if (!field) return { ok: false, warning: { code: "analysis_fields_required" } };
    const source = [
      "def analyze(tables, labrat):",
      "    return {'result_table': [], 'traces': [], 'lineage': {}, 'summary': {}}",
    ].join("\n");
    return {
      ok: true,
      selectionRequest: {
        experimentIds: [],
        fieldIds: [field.fieldId],
        includeSeries: false,
      },
      plan: {
        requestSummary: "Compare the accepted numeric field across experiments.",
        processingSummary: ["Use each accepted value once."],
        calculationManifest: {
          inputs: [{
            fieldId: field.fieldId,
            fieldKey: field.fieldKey,
            unit: field.unit,
          }],
          missingValuePolicy: {
            mode: "exclude_record",
            requiredFieldIds: [field.fieldId],
          },
          derivedFields: [],
          invariants: [],
        },
        pythonProgram: {
          runtime: "labrat-python-v1",
          entrypoint: "analyze",
          source,
        },
        expectedOutput: {
          shape: "experiment_traces",
          chartType: "bar",
          xField: "experiment_label",
          yFields: [field.fieldKey],
        },
        warnings: [],
      },
    };
  },
  async interpretWorkbookRegion(input) {
    const candidate = input.region?.deterministicCandidate || {};
    return {
      ok: true,
      summary: [
        `The selected range ${input.region?.sheetName}!${input.region?.range} contains a structured table.`,
        candidate.experimentAxis === "rows"
          ? "Each included row represents one experiment."
          : "The selected cells belong to one bounded workbook region.",
      ],
      interpretation: {
        ...candidate,
        semanticType: candidate.excluded
          ? "metadata_notes"
          : (candidate.experimentAxis ? "experiment_table" : "generic_table"),
        confidence: 0.9,
        warnings: [],
      },
      metadata: {
        provider: "anthropic",
        model: "test-workbook-model",
        latencyMs: 1,
        usage: { inputTokens: 10, outputTokens: 10 },
      },
    };
  },
};

const testAnalysisExecutor = {
  async executeAcceptedRun(runPackage) {
    const resultTable = runPackage.tables.records.map((record, index) => ({
      __result_id: `result_row_${index + 1}`,
      __experiment_id: record.__experiment_id,
      __snapshot_id: record.__snapshot_id,
      __record_index: record.__record_index,
      yield: record.yield,
    }));
    const sourceRecordIds = runPackage.tables.records.map((record) => record.__source_record_id);
    return {
      ok: true,
      adapter: "test_executor",
      runtime: {
        version: runPackage.runtimeVersion,
        exitCode: 0,
      },
      result: {
        result_table: resultTable,
        traces: [{
          traceId: "trace_yield",
          x: runPackage.tables.records.map((record) => record.__experiment_label),
          y: runPackage.tables.records.map((record) => record.yield),
          xUnit: null,
          yUnit: "percent",
          sourceRecordIds,
        }],
        lineage: {
          ...Object.fromEntries(resultTable.map((row, index) => [
            row.__result_id,
            { sourceRecordIds: [sourceRecordIds[index]] },
          ])),
          trace_yield: { sourceRecordIds },
        },
        summary: {
          inputRecordCount: runPackage.tables.records.length,
          outputRecordCount: resultTable.length,
          excludedRecordCount: 0,
          excludedRecords: [],
          missingValuePolicy: runPackage.calculationManifest.missingValuePolicy.mode,
        },
      },
    };
  },
};

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
  server = createServer({
    config,
    store,
    modelProvider: testModelProvider,
    analysisExecutor: testAnalysisExecutor,
  });
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

test("workbook review region APIs independently revise confirm ignore and delete selections", async () => {
  const project = await createProject("Region Review API Project");
  const upload = await uploadProjectFile(project.id, makeWorkbookBlob(), "regions.xlsx");
  assert.equal(upload.response.status, 201);
  const sessionResponse = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(sessionResponse.status, 201);
  const sessionBody = await sessionResponse.json();
  const sessionId = sessionBody.workbookReviewSession.id;
  assert.ok(sessionBody.reviewRegions.length >= 1);
  assert.ok(sessionBody.reviewRegions.every((region) => region.currentRevision?.summary.length >= 2));

  const createdResponse = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/regions`, {
    method: "POST",
    body: {
      sourceDocumentId: sessionBody.sourceDocument.id,
      sheetName: "Runs",
      range: "A1:D3",
      selectionMethod: "manual",
      idempotencyKey: `create_region_${Date.now()}`,
    },
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.region.rangeRef, "A1:D3");
  assert.equal(created.region.reviewStatus, "awaiting_review");
  assert.ok(created.currentRevision.summary.length >= 2 && created.currentRevision.summary.length <= 4);

  const revisionResponse = await jsonFetch(
    `/api/workbook-review-sessions/${sessionId}/regions/${created.region.id}/revisions`,
    {
      method: "POST",
      body: {
        feedback: "Explain that temperature and selectivity are separate fields.",
        previousRevisionId: created.currentRevision.id,
        expectedRegionVersion: created.region.version,
        idempotencyKey: `revise_region_${Date.now()}`,
      },
    },
  );
  assert.equal(revisionResponse.status, 201);
  const revised = await revisionResponse.json();
  assert.equal(revised.currentRevision.revisionNumber, created.currentRevision.revisionNumber + 1);

  const confirmResponse = await jsonFetch(
    `/api/workbook-review-sessions/${sessionId}/regions/${created.region.id}/confirm`,
    {
      method: "POST",
      body: {
        revisionId: revised.currentRevision.id,
        expectedRegionVersion: revised.region.version,
        idempotencyKey: `confirm_region_${Date.now()}`,
      },
    },
  );
  assert.equal(confirmResponse.status, 200);
  const confirmed = await confirmResponse.json();
  assert.equal(confirmed.region.acceptedRevisionId, revised.currentRevision.id);

  const acceptedResponse = await jsonFetch(`/api/projects/${project.id}/region-understandings?status=accepted`);
  assert.equal(acceptedResponse.status, 200);
  const acceptedBody = await acceptedResponse.json();
  assert.equal(acceptedBody.regionUnderstandings.length, 1);
  assert.equal(acceptedBody.regionUnderstandings[0].region.id, created.region.id);
  assert.equal(acceptedBody.regionUnderstandings[0].revision.id, revised.currentRevision.id);

  const ignoredCreateResponse = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/regions`, {
    method: "POST",
    body: {
      sourceDocumentId: sessionBody.sourceDocument.id,
      sheetName: "Runs",
      range: "B1:D3",
      selectionMethod: "manual",
      idempotencyKey: `create_ignored_region_${Date.now()}`,
    },
  });
  const ignoredCreated = await ignoredCreateResponse.json();
  const ignoreResponse = await jsonFetch(
    `/api/workbook-review-sessions/${sessionId}/regions/${ignoredCreated.region.id}/ignore`,
    {
      method: "POST",
      body: {
        expectedRegionVersion: ignoredCreated.region.version,
        reason: "Not part of the experiment records.",
      },
    },
  );
  assert.equal(ignoreResponse.status, 200);
  assert.equal((await ignoreResponse.json()).region.disposition, "ignored");

  const deleteResponse = await jsonFetch(
    `/api/workbook-review-sessions/${sessionId}/regions/${created.region.id}`,
    {
      method: "DELETE",
      body: {
        expectedRegionVersion: confirmed.region.version,
        reason: "Duplicate manual selection.",
      },
    },
  );
  assert.equal(deleteResponse.status, 200);
  assert.equal((await deleteResponse.json()).region.disposition, "deleted");

  const acceptedAfterDelete = await jsonFetch(`/api/projects/${project.id}/region-understandings?status=accepted`);
  assert.equal((await acceptedAfterDelete.json()).regionUnderstandings.length, 0);

  const listResponse = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/regions`);
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.equal(listed.regions.some((region) => region.id === created.region.id), false);
  assert.equal(listed.regions.some((region) => region.id === ignoredCreated.region.id), true);

  const historyResponse = await jsonFetch(
    `/api/workbook-review-sessions/${sessionId}/regions/${created.region.id}/revisions`,
  );
  assert.equal(historyResponse.status, 200);
  assert.equal((await historyResponse.json()).revisions.length, 2);
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

test("aggregate workbook understanding routes stay retired", async () => {
  const project = await createProject("Retired Workbook Understanding Project");
  const upload = await uploadProjectFile(project.id, makeWorkbookBlob(), "retired-understanding.xlsx");
  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  const sessionId = createBody.workbookReviewSession.id;

  const revision = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/revisions`, {
    method: "POST",
    body: { message: "This old aggregate route must remain unavailable." },
  });
  assert.equal(revision.status, 404);

  const confirm = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/confirm`, {
    method: "POST",
    body: {},
  });
  assert.equal(confirm.status, 404);

  const understandings = await jsonFetch(`/api/projects/${project.id}/workbook-understandings`);
  assert.equal(understandings.status, 404);

  const state = await (await jsonFetch(`/api/projects/${project.id}/state`)).json();
  assert.equal(Array.isArray(state.workbookReviewRegions), true);
  assert.equal(Array.isArray(state.regionUnderstandings), true);
  assert.equal("workbookUnderstandings" in state, false);
});

test("project evidence retrieve returns accepted region revisions only as usable results", async () => {
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
  const reviewRegion = createBody.reviewRegions.find((region) => region.rangeRef === "A1:D3")
    || createBody.reviewRegions[0];
  await confirmReviewRegion(sessionId, reviewRegion);

  const retrieve = await jsonFetch(`/api/projects/${project.id}/evidence/retrieve`, {
    method: "POST",
    body: {
      query: "use experiment 1 workbook evidence",
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

test("project data plan draft reloads accepted region revisions and returns a transient experiment-record preview", async () => {
  const project = await createProject("Tool DataPlan Agent Project");
  const upload = await uploadProjectFile(project.id, makeReactionRateWorkbookBlob(), "Reaction_Rate_Exp33.xlsx");
  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  const sessionId = createBody.workbookReviewSession.id;
  const reviewRegion = createBody.reviewRegions.find((region) => region.rangeRef === "A1:C3")
    || createBody.reviewRegions[0];
  const confirmBody = await confirmReviewRegion(sessionId, reviewRegion);
  const stateBefore = await (await jsonFetch(`/api/projects/${project.id}/state`)).json();

  const draft = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      regionUnderstandingRevisionIds: [confirmBody.acceptedRevision.id],
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
  assert.equal(draftBody.dataPlan.sourceEvidence[0].regionUnderstandingRevisionId, confirmBody.acceptedRevision.id);
  assert.equal(JSON.stringify(draftBody.dataPlan).includes("client_supplied_values_are_ignored"), false);
  assert.equal(JSON.stringify(draftBody.dataPlan).includes('"values":[999]'), false);
  assert.deepEqual(draftBody.reviewSummary.blockers.map((item) => item.code), ["identity_decision_required"]);

  const reviewedDraft = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      regionUnderstandingRevisionIds: [confirmBody.acceptedRevision.id],
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
  assert.equal(stateAfter.regionUnderstandings.length, stateBefore.regionUnderstandings.length);
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
  assert.equal((await crossProject.json()).error.code, "accepted_region_understanding_not_found");

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
      regionUnderstandingRevisionIds: ["region_understanding_revision_missing"],
      identityDecisions: [],
    },
  });
  assert.equal(missingUnderstanding.status, 200);
  const missingBody = await missingUnderstanding.json();
  assert.equal(missingBody.resultKind, "clarification");
  assert.equal(missingBody.clarification.code, "accepted_region_understanding_not_found");

  const wrongIntent = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "chart_data",
      regionUnderstandingRevisionIds: [confirmBody.acceptedRevision.id],
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
  const reviewRegion = createBody.reviewRegions.find((region) => region.rangeRef === "A1:C5")
    || createBody.reviewRegions[0];
  const accepted = await confirmReviewRegion(sessionId, reviewRegion);
  const identityDecisions = goldenExperimentBrowserFixture.expectedExperimentLabels.map((sourceAlias) => ({
    sourceAlias,
    action: "create",
  }));
  const draft = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      regionUnderstandingRevisionIds: [accepted.acceptedRevision.id],
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

  const reviewRegion = createBody.reviewRegions.find((region) => region.rangeRef === "A1:N4")
    || createBody.reviewRegions[0];
  const interpretation = reviewRegion.currentRevision.interpretation;
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

  const accepted = await confirmReviewRegion(sessionId, reviewRegion);
  const identityDecisions = ["Exp1", "Exp2"].map((sourceAlias) => ({ sourceAlias, action: "create" }));
  const draft = await jsonFetch(`/api/projects/${project.id}/data-plans/draft`, {
    method: "POST",
    body: {
      intent: "experiment_browser_publish",
      regionUnderstandingRevisionIds: [accepted.acceptedRevision.id],
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
  assert.equal(chartBody.intent, "analysis_thread");
  assert.deepEqual(chartBody.actions, []);

  const compare = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "compare Exp30 and Exp31 in a table" },
  });
  assert.equal(compare.status, 200);
  const compareBody = await compare.json();
  assert.equal(compareBody.intent, "analysis_thread");
  assert.deepEqual(compareBody.actions, []);
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

test("experiment trend AgentRun enters reviewed analysis instead of opening Browser", async () => {
  const project = await createProject("AgentRun Analysis Project");
  const response = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: {
      message: "Give me a one-paragraph overview of the trends across all experiments.",
      conversation: [],
      selectedContext: {},
    },
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.agentRun.mode, "analysis_planning");
  assert.equal(body.agentRun.status, "waiting_for_user");
  assert.deepEqual(body.agentRun.actions, []);
  assert.equal(body.reply.includes("Open Experiment Browser"), false);
  assert.match(body.reply, /reviewed analysis plan/i);
  assert.match(body.analysisThread.id, /^analysis_thread_/);
  assert.equal(body.currentPlanRevision, null);
});

test("golden conversational analysis normalizes accepted selectivity and publishes a trace-complete chart", async () => {
  const project = await createProject("Golden Conversational Analysis");
  const suffix = `golden_${Date.now()}`;
  const publication = await publishGroupedSelectivityDataForAnalysis(project, suffix);
  assert.equal(publication.dataSnapshot.status, "accepted");
  assert.equal(publication.experimentSnapshotHeads.length, 2);

  const originalDraftAnalysisPlan = testModelProvider.draftAnalysisPlan;
  const originalExecuteAcceptedRun = testAnalysisExecutor.executeAcceptedRun;
  const selectedFieldKeys = [
    "selectivity_solid",
    "selectivity_liquid",
    "selectivity_gas",
  ];
  const outputFieldKeys = selectedFieldKeys.map((fieldKey) => `${fieldKey}_normalized`);
  const pythonSource = [
    "def analyze(tables, labrat):",
    "    result_table = []",
    "    for row in tables.get('records', []):",
    "        total = row.get('selectivity_solid') + row.get('selectivity_liquid') + row.get('selectivity_gas')",
    "        result_table.append({",
    "            '__result_id': row.get('__source_record_id'),",
    "            '__experiment_id': row.get('__experiment_id'),",
    "            '__snapshot_id': row.get('__snapshot_id'),",
    "            '__record_index': row.get('__record_index'),",
    "            'selectivity_solid_normalized': row.get('selectivity_solid') / total * 100,",
    "            'selectivity_liquid_normalized': row.get('selectivity_liquid') / total * 100,",
    "            'selectivity_gas_normalized': row.get('selectivity_gas') / total * 100,",
    "        })",
    "    return {'result_table': result_table, 'traces': [], 'lineage': {}, 'summary': {}}",
  ].join("\n");

  testModelProvider.draftAnalysisPlan = async (input) => {
    const selectedFields = selectedFieldKeys.map((fieldKey) => (
      input.fields.find((field) => field.fieldKey === fieldKey)
    ));
    assert.equal(selectedFields.every(Boolean), true);
    const fieldIds = selectedFields.map((field) => field.fieldId);
    return {
      ok: true,
      selectionRequest: {
        experimentIds: [],
        fieldIds,
        includeSeries: false,
      },
      plan: {
        requestSummary: "Normalize Solid, Liquid, and Gas selectivity to 100 percent for every accepted experiment.",
        processingSummary: [
          "Use the accepted Solid, Liquid, and Gas selectivity cells for every published experiment.",
          "Divide each component by its row total and multiply by 100.",
          ...(input.feedback ? [`Apply the review feedback: ${input.feedback}`] : []),
        ],
        calculationManifest: {
          inputs: selectedFields.map((field) => ({
            fieldId: field.fieldId,
            fieldKey: field.fieldKey,
            unit: field.unit,
          })),
          missingValuePolicy: {
            mode: "exclude_record",
            requiredFieldIds: fieldIds,
          },
          derivedFields: outputFieldKeys.map((fieldKey) => ({
            fieldKey,
            inputFieldIds: fieldIds,
            expression: `${fieldKey.replace("_normalized", "")} / row_total * 100`,
            outputUnit: "percent",
          })),
          invariants: [{
            type: "row_sum",
            fieldKeys: outputFieldKeys,
            target: 100,
            absoluteTolerance: 0.000001,
          }],
        },
        pythonProgram: {
          runtime: "labrat-python-v1",
          entrypoint: "analyze",
          source: pythonSource,
        },
        expectedOutput: {
          shape: "experiment_traces",
          chartType: "stacked_bar",
          xField: "experiment_label",
          yFields: outputFieldKeys,
        },
        warnings: [],
      },
    };
  };

  testAnalysisExecutor.executeAcceptedRun = async (runPackage) => {
    const resultTable = runPackage.tables.records.map((record, index) => {
      const total = selectedFieldKeys.reduce(
        (sum, fieldKey) => sum + Number(record[fieldKey]),
        0,
      );
      const solid = Number(record.selectivity_solid) / total * 100;
      const liquid = Number(record.selectivity_liquid) / total * 100;
      return {
        __result_id: `normalized_result_${index + 1}`,
        __experiment_id: record.__experiment_id,
        __snapshot_id: record.__snapshot_id,
        __record_index: record.__record_index,
        selectivity_solid_normalized: solid,
        selectivity_liquid_normalized: liquid,
        selectivity_gas_normalized: 100 - solid - liquid,
      };
    });
    const sourceRecordIds = runPackage.tables.records.map(
      (record) => record.__source_record_id,
    );
    const traces = [
      ["trace_solid", "Solid", "selectivity_solid_normalized"],
      ["trace_liquid", "Liquid", "selectivity_liquid_normalized"],
      ["trace_gas", "Gas", "selectivity_gas_normalized"],
    ].map(([traceId, name, fieldKey]) => ({
      traceId,
      name,
      yField: fieldKey,
      x: runPackage.tables.records.map((record) => record.__experiment_label),
      y: resultTable.map((row) => row[fieldKey]),
      xUnit: null,
      yUnit: "percent",
      sourceRecordIds,
    }));
    return {
      ok: true,
      adapter: "golden_test_executor",
      runtime: {
        version: runPackage.runtimeVersion,
        exitCode: 0,
      },
      result: {
        result_table: resultTable,
        traces,
        lineage: {
          ...Object.fromEntries(resultTable.map((row, index) => [
            row.__result_id,
            { sourceRecordIds: [sourceRecordIds[index]] },
          ])),
          ...Object.fromEntries(traces.map((trace) => [
            trace.traceId,
            { sourceRecordIds },
          ])),
        },
        summary: {
          inputRecordCount: runPackage.tables.records.length,
          outputRecordCount: resultTable.length,
          excludedRecordCount: 0,
          excludedRecords: [],
          missingValuePolicy: runPackage.calculationManifest.missingValuePolicy.mode,
        },
      },
    };
  };

  try {
    const requested = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
      method: "POST",
      body: {
        message: "Normalize Solid, Liquid, and Gas selectivity for every experiment so each row sums to 100%, then create a stacked chart.",
      },
    });
    assert.equal(requested.status, 201);
    const requestedBody = await requested.json();
    assert.equal(requestedBody.agentRun.mode, "analysis_planning");
    assert.deepEqual(requestedBody.agentRun.actions, []);
    assert.equal(requestedBody.reply.includes("Open Experiment Browser"), false);
    assert.equal(requestedBody.currentPlanRevision.revision, 1);
    assert.equal(requestedBody.currentPlanRevision.sourceRectangles.length, 1);
    assert.equal(requestedBody.currentPlanRevision.sourceRectangles[0].range, "L3:N4");

    const feedback = "Keep all accepted experiments and use concise Solid, Liquid, and Gas trace labels.";
    const modified = await jsonFetch(
      `/api/analysis-threads/${requestedBody.analysisThread.id}/plan-revisions`,
      {
        method: "POST",
        body: { feedback },
      },
    );
    assert.equal(modified.status, 201);
    const modifiedBody = await modified.json();
    const revision = modifiedBody.analysisPlanRevision;
    assert.equal(revision.revision, 2);
    assert.equal(revision.feedback, feedback);
    assert.equal(revision.status, "awaiting_review");

    const threadAfterRevision = await jsonFetch(
      `/api/analysis-threads/${requestedBody.analysisThread.id}`,
    );
    const threadAfterRevisionBody = await threadAfterRevision.json();
    assert.equal(threadAfterRevisionBody.planRevisions[0].status, "superseded");
    assert.equal(threadAfterRevisionBody.planRevisions[1].id, revision.id);

    const accepted = await jsonFetch(
      `/api/analysis-plan-revisions/${revision.id}/accept`,
      {
        method: "POST",
        headers: { "idempotency-key": `golden_plan_accept_${suffix}` },
        body: {
          planHash: revision.planHash,
          selectionHash: revision.selectionHash,
          dependencyHash: revision.dependencyHash,
        },
      },
    );
    assert.equal(accepted.status, 201);
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.analysisRun.status, "queued");

    const executed = await jsonFetch(
      `/api/analysis-runs/${acceptedBody.analysisRun.id}/execute`,
      { method: "POST", body: {} },
    );
    assert.equal(executed.status, 201);
    const executedBody = await executed.json();
    assert.equal(executedBody.analysisRun.status, "awaiting_result_review");
    assert.equal(executedBody.analysisRun.execution.adapter, "golden_test_executor");
    assert.equal(executedBody.analysisResult.status, "awaiting_review");
    assert.equal(executedBody.analysisResult.validation.ok, true);
    assert.equal(executedBody.analysisResult.validation.invariants[0].ok, true);

    const preview = await jsonFetch(
      `/api/analysis-runs/${acceptedBody.analysisRun.id}/result-preview?offset=0&limit=10&traceOffset=0&traceLimit=10`,
    );
    assert.equal(preview.status, 200);
    const previewBody = await preview.json();
    assert.equal(previewBody.rows.length, 2);
    assert.equal(previewBody.traces.length, 3);
    previewBody.rows.forEach((row) => {
      const normalizedTotal = outputFieldKeys.reduce(
        (sum, fieldKey) => sum + row[fieldKey],
        0,
      );
      assert.equal(Math.abs(normalizedTotal - 100) < 0.000001, true);
    });

    const published = await jsonFetch(
      `/api/analysis-runs/${acceptedBody.analysisRun.id}/accept-and-create-chart`,
      {
        method: "POST",
        headers: { "idempotency-key": `golden_result_accept_${suffix}` },
        body: {
          resultHash: executedBody.analysisResult.contentHash,
          defaultVisibleTraceIds: ["trace_solid", "trace_liquid", "trace_gas"],
        },
      },
    );
    assert.equal(published.status, 201);
    const publishedBody = await published.json();
    assert.equal(publishedBody.analysisThread.status, "completed");
    assert.equal(publishedBody.analysisRun.status, "completed");
    assert.equal(publishedBody.analysisResult.status, "accepted");

    const reloadedState = await jsonFetch(`/api/projects/${project.id}/state`);
    assert.equal(reloadedState.status, 200);
    const reloadedStateBody = await reloadedState.json();
    const chartSummary = reloadedStateBody.chartSpecs.find(
      (chartSpec) => chartSpec.id === publishedBody.chartSpec.id,
    );
    assert.equal(chartSummary.spec.origin, "analysis_result");
    assert.equal(chartSummary.spec.detailRequired, true);
    assert.equal(Object.hasOwn(chartSummary.spec.traceCatalog[0], "x"), false);
    assert.equal(reloadedStateBody.analysisThreads[0].status, "completed");

    const reloadedThread = await jsonFetch(
      `/api/analysis-threads/${requestedBody.analysisThread.id}`,
    );
    assert.equal(reloadedThread.status, 200);
    const reloadedThreadBody = await reloadedThread.json();
    assert.equal(reloadedThreadBody.analysisRuns[0].status, "completed");
    assert.deepEqual(
      reloadedThreadBody.analysisThread.chartSpecIds,
      [publishedBody.chartSpec.id],
    );
    const reloadedRun = await jsonFetch(
      `/api/analysis-runs/${acceptedBody.analysisRun.id}`,
    );
    assert.equal(reloadedRun.status, 200);
    const reloadedRunBody = await reloadedRun.json();
    assert.equal(reloadedRunBody.analysisResult.status, "accepted");

    const detail = await jsonFetch(`/api/chart-specs/${publishedBody.chartSpec.id}`);
    assert.equal(detail.status, 200);
    const chartSpec = (await detail.json()).chartSpec.spec;
    assert.equal(chartSpec.traceCatalog.length, 3);
    assert.equal(chartSpec.inputSnapshotRefs.length, 2);
    assert.deepEqual(
      chartSpec.defaultChartView.visibleTraceIds,
      ["trace_solid", "trace_liquid", "trace_gas"],
    );
    chartSpec.inputSnapshotRefs.forEach((ref) => {
      assert.match(ref.sourceRecordId, new RegExp(`^${ref.snapshotId}:\\d+$`));
      assert.match(ref.contentHash, /^sha256_/);
      assert.match(ref.dependencyHash, /^sha256_/);
      assert.match(ref.headId, /^experiment_snapshot_head_/);
    });
    chartSpec.traceCatalog.forEach((trace) => {
      assert.equal(trace.x.length, 2);
      assert.equal(trace.y.length, 2);
      assert.deepEqual(trace.sourceRecordIds, chartSpec.inputSnapshotRefs.map(
        (ref) => ref.sourceRecordId,
      ));
    });
    assert.equal(Object.hasOwn(reloadedStateBody, "datasetCommits"), false);
    assert.equal(Object.hasOwn(reloadedStateBody, "mappingSets"), false);
    assert.equal(Object.hasOwn(reloadedStateBody, "analysisViews"), false);
  } finally {
    testModelProvider.draftAnalysisPlan = originalDraftAnalysisPlan;
    testAnalysisExecutor.executeAcceptedRun = originalExecuteAcceptedRun;
  }
});

test("analysis thread routes preserve immutable reviewed plans and queue accepted work idempotently", async () => {
  const project = await createProject("Analysis Thread Route Project");
  const ownerCookie = cookie;
  const { plan, selection, selectionRequest } = seedRouteAnalysisData(project, `route_${Date.now()}`);

  const agentAnalysis = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "Compare yield across all experiments and plot it." },
  });
  assert.equal(agentAnalysis.status, 201);
  const agentAnalysisBody = await agentAnalysis.json();
  assert.match(agentAnalysisBody.analysisThread.id, /^analysis_thread_/);
  assert.equal(agentAnalysisBody.currentPlanRevision.status, "awaiting_review");
  assert.equal(agentAnalysisBody.currentPlanRevision.selectionHash, selection.selectionHash);
  const modifiedAgentPlan = await jsonFetch(
    `/api/analysis-threads/${agentAnalysisBody.analysisThread.id}/plan-revisions`,
    {
      method: "POST",
      body: { feedback: "Keep the same data but use a bar chart." },
    },
  );
  assert.equal(modifiedAgentPlan.status, 201);
  const modifiedAgentRevision = (await modifiedAgentPlan.json()).analysisPlanRevision;
  assert.equal(modifiedAgentRevision.revision, 2);
  const modifiedAgentDetail = await jsonFetch(
    `/api/analysis-threads/${agentAnalysisBody.analysisThread.id}`,
  );
  const modifiedAgentDetailBody = await modifiedAgentDetail.json();
  assert.equal(modifiedAgentDetailBody.planRevisions[0].status, "superseded");
  assert.equal(modifiedAgentDetailBody.planRevisions[1].status, "awaiting_review");

  const configuredDraftAnalysisPlan = testModelProvider.draftAnalysisPlan;
  testModelProvider.draftAnalysisPlan = async () => ({
    ok: false,
    warning: {
      code: "ai_unavailable",
      message: "Backend model provider is unavailable.",
    },
  });
  try {
    const providerFailureProject = await createProject("Analysis Provider Failure");
    seedRouteAnalysisData(providerFailureProject, `provider_failure_${Date.now()}`);
    const providerFailure = await jsonFetch(
      `/api/projects/${providerFailureProject.id}/agent/runs`,
      {
        method: "POST",
        body: { message: "Compare yield across all experiments." },
      },
    );
    assert.equal(providerFailure.status, 201);
    const providerFailureBody = await providerFailure.json();
    assert.match(providerFailureBody.analysisThread.id, /^analysis_thread_/);
    assert.equal(providerFailureBody.currentPlanRevision, null);
    assert.match(providerFailureBody.reply, /could not draft/i);
    assert.equal(
      providerFailureBody.agentRun.warnings.some((warning) => warning.code === "analysis_plan_draft_unavailable"),
      true,
    );
  } finally {
    testModelProvider.draftAnalysisPlan = configuredDraftAnalysisPlan;
  }

  const createThread = await jsonFetch(`/api/projects/${project.id}/analysis-threads`, {
    method: "POST",
    body: {
      originalRequest: "Compare accepted yield values.",
      messages: [{
        role: "assistant",
        content: "Client-supplied hidden reasoning must not be persisted.",
      }],
    },
  });
  assert.equal(createThread.status, 201);
  const thread = (await createThread.json()).analysisThread;
  assert.match(thread.id, /^analysis_thread_/);
  assert.equal(thread.status, "planning");
  const initialThreadDetail = await jsonFetch(`/api/analysis-threads/${thread.id}`);
  const initialThreadDetailBody = await initialThreadDetail.json();
  assert.deepEqual(
    initialThreadDetailBody.analysisThread.messages.map((message) => message.role),
    ["user"],
  );
  const stateWithAnalysis = await jsonFetch(`/api/projects/${project.id}/state`);
  const stateWithAnalysisBody = await stateWithAnalysis.json();
  assert.equal(
    stateWithAnalysisBody.analysisThreads.some((item) => item.id === thread.id),
    true,
  );

  const createRevision = await jsonFetch(`/api/analysis-threads/${thread.id}/plan-revisions`, {
    method: "POST",
    body: { plan, selectionRequest },
  });
  assert.equal(createRevision.status, 201);
  const revision = (await createRevision.json()).analysisPlanRevision;
  assert.equal(revision.revision, 1);
  assert.equal(revision.status, "awaiting_review");
  assert.equal(revision.selectionHash, selection.selectionHash);

  const list = await jsonFetch(`/api/projects/${project.id}/analysis-threads?limit=500`);
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.analysisThreads.some((item) => item.id === thread.id), true);
  assert.equal(listBody.page.limit, 100);

  const detail = await jsonFetch(`/api/analysis-threads/${thread.id}`);
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.planRevisions[0].id, revision.id);
  assert.deepEqual(detailBody.analysisRuns, []);

  const selectionResponse = await jsonFetch(
    `/api/analysis-plan-revisions/${revision.id}/selection?offset=0&limit=500`,
  );
  assert.equal(selectionResponse.status, 200);
  const selectionBody = await selectionResponse.json();
  assert.equal(selectionBody.records[0].fields[0].value, 37.5);
  assert.deepEqual(selectionBody.sourceRectangles.map((item) => item.range), ["B2"]);
  assert.equal(selectionBody.page.limit, 200);

  const otherProject = await createProject("Analysis Cross Project");
  const other = seedRouteAnalysisData(otherProject, `other_${Date.now()}`);
  const crossProjectRevision = await jsonFetch(`/api/analysis-threads/${thread.id}/plan-revisions`, {
    method: "POST",
    body: {
      feedback: "Use another project's experiment.",
      plan: other.plan,
      selectionRequest: other.selectionRequest,
    },
  });
  assert.equal(crossProjectRevision.status, 422);
  assert.equal((await crossProjectRevision.json()).error.code, "analysis_selection_invalid");

  const missingIdempotency = await jsonFetch(`/api/analysis-plan-revisions/${revision.id}/accept`, {
    method: "POST",
    body: {
      planHash: revision.planHash,
      selectionHash: revision.selectionHash,
      dependencyHash: revision.dependencyHash,
    },
  });
  assert.equal(missingIdempotency.status, 400);
  assert.equal((await missingIdempotency.json()).error.code, "idempotency_key_required");

  const acceptBody = {
    planHash: revision.planHash,
    selectionHash: revision.selectionHash,
    dependencyHash: revision.dependencyHash,
  };
  const accepted = await jsonFetch(`/api/analysis-plan-revisions/${revision.id}/accept`, {
    method: "POST",
    headers: { "Idempotency-Key": "analysis_route_accept_1" },
    body: acceptBody,
  });
  assert.equal(accepted.status, 201);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.analysisPlanRevision.status, "accepted");
  assert.equal(acceptedBody.analysisRun.status, "queued");

  const replay = await jsonFetch(`/api/analysis-plan-revisions/${revision.id}/accept`, {
    method: "POST",
    headers: { "Idempotency-Key": "analysis_route_accept_1" },
    body: acceptBody,
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).analysisRun.id, acceptedBody.analysisRun.id);
  assert.equal((await store.listAnalysisRuns({ projectId: project.id })).length, 1);
  assert.equal((await store.listChartSpecs({ projectId: project.id })).length, 0);

  const adminLogin = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "LabRatAdmin123!" },
  });
  assert.equal(adminLogin.status, 200);
  cookie = cookieFrom(adminLogin);
  const viewerUsername = `analysis_viewer_${Date.now()}`;
  const viewerPassword = "AnalysisViewer123!";
  const createViewer = await jsonFetch("/api/admin/users", {
    method: "POST",
    body: {
      username: viewerUsername,
      displayName: "Analysis Viewer",
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
  assert.equal(viewerLogin.status, 200);
  cookie = cookieFrom(viewerLogin);
  const viewerCreate = await jsonFetch(`/api/projects/${project.id}/analysis-threads`, {
    method: "POST",
    body: { originalRequest: "Viewer must not create analysis." },
  });
  assert.equal(viewerCreate.status, 403);
  assert.equal((await viewerCreate.json()).error.code, "forbidden");
  cookie = ownerCookie;
});

test("accepted analysis runs execute once, expose a bounded result preview, and revise immutably", async () => {
  const project = await createProject("Analysis Execution Route Project");
  seedRouteAnalysisData(project, `execute_${Date.now()}`);
  const drafted = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "Compare yield across all experiments and plot it." },
  });
  assert.equal(drafted.status, 201);
  const draftedBody = await drafted.json();
  const revision = draftedBody.currentPlanRevision;
  const accepted = await jsonFetch(`/api/analysis-plan-revisions/${revision.id}/accept`, {
    method: "POST",
    headers: { "idempotency-key": `execute_accept_${Date.now()}` },
    body: {
      planHash: revision.planHash,
      selectionHash: revision.selectionHash,
      dependencyHash: revision.dependencyHash,
    },
  });
  assert.equal(accepted.status, 201);
  const queuedRun = (await accepted.json()).analysisRun;

  const executed = await jsonFetch(`/api/analysis-runs/${queuedRun.id}/execute`, {
    method: "POST",
    body: {},
  });
  assert.equal(executed.status, 201);
  const executedBody = await executed.json();
  assert.equal(executedBody.analysisRun.status, "awaiting_result_review");
  assert.equal(Object.hasOwn(executedBody.analysisRun.execution, "claimToken"), false);
  assert.equal(executedBody.analysisResult.status, "awaiting_review");
  assert.match(executedBody.analysisResult.contentHash, /^sha256_/);

  const replay = await jsonFetch(`/api/analysis-runs/${queuedRun.id}/execute`, {
    method: "POST",
    body: {},
  });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.idempotentReplay, true);
  assert.equal(replayBody.analysisResult.id, executedBody.analysisResult.id);

  const detail = await jsonFetch(`/api/analysis-runs/${queuedRun.id}`);
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.analysisResult.id, executedBody.analysisResult.id);
  assert.equal(detailBody.analysisPlanRevision.id, revision.id);

  const preview = await jsonFetch(
    `/api/analysis-runs/${queuedRun.id}/result-preview?offset=0&limit=1&traceOffset=0&traceLimit=1`,
  );
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.rows.length, 1);
  assert.equal(previewBody.traces.length, 1);
  assert.equal(previewBody.rowPage.limit, 1);
  assert.equal(previewBody.resultPreviewHash, executedBody.analysisResult.resultPreviewHash);

  const revised = await jsonFetch(`/api/analysis-runs/${queuedRun.id}/revise`, {
    method: "POST",
    body: {
      resultHash: executedBody.analysisResult.contentHash,
      feedback: "Keep the same accepted data but label the yield trace more clearly.",
    },
  });
  assert.equal(revised.status, 201);
  const revisedBody = await revised.json();
  assert.equal(revisedBody.analysisPlanRevision.revision, 2);
  assert.equal((await store.findAnalysisResultById(executedBody.analysisResult.id)).status, "awaiting_review");
});

test("accepted analysis results publish one bounded-list ChartSpec atomically", async () => {
  const project = await createProject("Analysis Publication Route Project");
  seedRouteAnalysisData(project, `publish_${Date.now()}`);
  const drafted = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "Compare yield across all experiments and plot it." },
  });
  const revision = (await drafted.json()).currentPlanRevision;
  const accepted = await jsonFetch(`/api/analysis-plan-revisions/${revision.id}/accept`, {
    method: "POST",
    headers: { "idempotency-key": `publish_accept_${Date.now()}` },
    body: {
      planHash: revision.planHash,
      selectionHash: revision.selectionHash,
      dependencyHash: revision.dependencyHash,
    },
  });
  const run = (await accepted.json()).analysisRun;
  const executed = await jsonFetch(`/api/analysis-runs/${run.id}/execute`, {
    method: "POST",
    body: {},
  });
  const executedBody = await executed.json();
  const publicationBody = {
    resultHash: executedBody.analysisResult.contentHash,
    defaultVisibleTraceIds: ["trace_yield"],
  };

  const missingKey = await jsonFetch(
    `/api/analysis-runs/${run.id}/accept-and-create-chart`,
    { method: "POST", body: publicationBody },
  );
  assert.equal(missingKey.status, 400);
  assert.equal((await missingKey.json()).error.code, "idempotency_key_required");

  const publicationKey = `publish_result_${Date.now()}`;
  const published = await jsonFetch(
    `/api/analysis-runs/${run.id}/accept-and-create-chart`,
    {
      method: "POST",
      headers: { "idempotency-key": publicationKey },
      body: publicationBody,
    },
  );
  assert.equal(published.status, 201);
  const publishedBody = await published.json();
  assert.equal(publishedBody.analysisResult.status, "accepted");
  assert.equal(publishedBody.analysisRun.status, "completed");
  assert.equal(publishedBody.analysisThread.status, "completed");
  assert.equal(publishedBody.chartSpec.spec.origin, "analysis_result");
  assert.deepEqual(
    publishedBody.chartSpec.spec.defaultChartView.visibleTraceIds,
    ["trace_yield"],
  );

  const replay = await jsonFetch(
    `/api/analysis-runs/${run.id}/accept-and-create-chart`,
    {
      method: "POST",
      headers: { "idempotency-key": publicationKey },
      body: publicationBody,
    },
  );
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.idempotentReplay, true);
  assert.equal(replayBody.chartSpec.id, publishedBody.chartSpec.id);

  const list = await jsonFetch(`/api/projects/${project.id}/chart-specs`);
  const listedChart = (await list.json()).chartSpecs.find(
    (chartSpec) => chartSpec.id === publishedBody.chartSpec.id,
  );
  assert.equal(listedChart.spec.detailRequired, true);
  assert.equal(listedChart.spec.traceCatalog[0].pointCount, 1);
  assert.equal(Object.hasOwn(listedChart.spec.traceCatalog[0], "x"), false);
  assert.equal(Object.hasOwn(listedChart.spec.traceCatalog[0], "y"), false);
  assert.equal(Object.hasOwn(listedChart.spec.traceCatalog[0], "sourceRecordIds"), false);
  assert.equal(Object.hasOwn(listedChart.spec, "inputSnapshotRefs"), false);
  assert.equal(Object.hasOwn(listedChart.spec, "sourceRefs"), false);
  assert.equal(listedChart.spec.inputSnapshotRefCount, 1);

  const detail = await jsonFetch(`/api/chart-specs/${publishedBody.chartSpec.id}`);
  assert.equal(detail.status, 200);
  const detailedChart = (await detail.json()).chartSpec;
  assert.equal(detailedChart.spec.traceCatalog[0].x.length, 1);
  assert.equal(typeof detailedChart.spec.traceCatalog[0].x[0], "string");
  assert.equal(detailedChart.spec.traceCatalog[0].y[0], 37.5);

  const conflict = await jsonFetch(
    `/api/analysis-runs/${run.id}/accept-and-create-chart`,
    {
      method: "POST",
      headers: { "idempotency-key": publicationKey },
      body: { ...publicationBody, defaultVisibleTraceIds: [] },
    },
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "idempotency_key_conflict");
  assert.equal((await store.listChartSpecs({ projectId: project.id })).length, 1);
});

test("analysis execution terminally rejects stale active heads and remains revisable", async () => {
  const project = await createProject("Stale Analysis Execution Project");
  const seeded = seedRouteAnalysisData(project, `stale_execute_${Date.now()}`);
  const drafted = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "Compare yield across all experiments and plot it." },
  });
  assert.equal(drafted.status, 201);
  const revision = (await drafted.json()).currentPlanRevision;
  const accepted = await jsonFetch(`/api/analysis-plan-revisions/${revision.id}/accept`, {
    method: "POST",
    headers: { "idempotency-key": `stale_execute_accept_${Date.now()}` },
    body: {
      planHash: revision.planHash,
      selectionHash: revision.selectionHash,
      dependencyHash: revision.dependencyHash,
    },
  });
  assert.equal(accepted.status, 201);
  const queuedRun = (await accepted.json()).analysisRun;
  const headId = seeded.selection.records[0].headId;
  const priorHead = store.experimentSnapshotHeads.get(headId);
  const priorSnapshot = store.dataSnapshots.get(priorHead.dataSnapshotId);
  const replacementSnapshotId = `${priorSnapshot.id}_replacement`;
  store.dataSnapshots.set(replacementSnapshotId, {
    ...priorSnapshot,
    id: replacementSnapshotId,
    contentHash: `${priorSnapshot.contentHash}_replacement`,
  });
  store.experimentSnapshotHeads.set(headId, {
    ...priorHead,
    dataSnapshotId: replacementSnapshotId,
  });

  const executed = await jsonFetch(`/api/analysis-runs/${queuedRun.id}/execute`, {
    method: "POST",
    body: {},
  });
  assert.equal(executed.status, 201);
  const executedBody = await executed.json();
  assert.equal(executedBody.analysisRun.status, "validation_failed");
  assert.equal(executedBody.analysisResult, null);

  const revised = await jsonFetch(`/api/analysis-runs/${queuedRun.id}/revise`, {
    method: "POST",
    body: { feedback: "Use the newly accepted experiment snapshot instead." },
  });
  assert.equal(revised.status, 201);
  assert.equal((await revised.json()).analysisPlanRevision.revision, 2);
});

test("analysis run reads allow viewers while execution and revision require editors", async () => {
  const ownerCookie = cookie;
  const project = await createProject("Analysis Run Authorization Project");
  seedRouteAnalysisData(project, `execute_auth_${Date.now()}`);
  const drafted = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "Compare yield across experiments." },
  });
  const revision = (await drafted.json()).currentPlanRevision;
  const accepted = await jsonFetch(`/api/analysis-plan-revisions/${revision.id}/accept`, {
    method: "POST",
    headers: { "idempotency-key": `execute_auth_accept_${Date.now()}` },
    body: {
      planHash: revision.planHash,
      selectionHash: revision.selectionHash,
      dependencyHash: revision.dependencyHash,
    },
  });
  const queuedRun = (await accepted.json()).analysisRun;
  const viewerUsername = `analysis_run_viewer_${Date.now()}`;
  const viewerPassword = "AnalysisRunViewer123!";
  const createViewer = await jsonFetch("/api/admin/users", {
    method: "POST",
    body: {
      username: viewerUsername,
      displayName: "Analysis Run Viewer",
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

  assert.equal((await jsonFetch(`/api/analysis-runs/${queuedRun.id}`)).status, 200);
  assert.equal((await jsonFetch(`/api/analysis-runs/${queuedRun.id}/execute`, {
    method: "POST",
    body: {},
  })).status, 403);
  assert.equal((await jsonFetch(`/api/analysis-runs/${queuedRun.id}/revise`, {
    method: "POST",
    body: { feedback: "Change it." },
  })).status, 403);
  assert.equal((await jsonFetch(
    `/api/analysis-runs/${queuedRun.id}/accept-and-create-chart`,
    {
      method: "POST",
      headers: { "idempotency-key": "viewer_cannot_publish_analysis" },
      body: { resultHash: "sha256_not_visible", defaultVisibleTraceIds: [] },
    },
  )).status, 403);

  cookie = ownerCookie;
});

test("experiment-purpose AgentRun answers directly without a confirmation card", async () => {
  const project = await createProject("Purpose Project");
  await jsonFetch(`/api/projects/${project.id}/profile`, {
    method: "PATCH",
    body: {
      researchGoal: "Determine how reaction conditions affect selectivity.",
    },
  });
  const response = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: {
      message: "What is this experiment for?",
      conversation: [],
      selectedContext: {},
    },
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.agentRun.mode, "project_summary");
  assert.equal(body.agentRun.status, "completed");
  assert.deepEqual(body.agentRun.actions, []);
  assert.match(body.reply, /Determine how reaction conditions affect selectivity/);
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
