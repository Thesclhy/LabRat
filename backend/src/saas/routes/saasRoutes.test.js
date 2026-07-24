import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
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

function makeOversizedCalculationWorkbookBlob() {
  const workbook = XLSX.utils.book_new();
  const rows = Array.from({ length: 107 }, () => Array(83).fill(null));
  rows[0][0] = "Label";
  rows[0][1] = "C1";
  rows[1][0] = "Overall tots";
  rows[1][1] = 12.5;
  rows[106][82] = "Used range boundary";
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "LDPE TEMPLATE");
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
  let reviewableRegion = reviewRegion;
  if (!reviewableRegion.currentRevision?.id) {
    const interpretation = await jsonFetch(
      `/api/workbook-review-sessions/${sessionId}/regions/${reviewableRegion.id}/interpret`,
      {
        method: "POST",
        body: {
          expectedRegionVersion: reviewableRegion.version,
          idempotencyKey: `interpret_${reviewableRegion.id}_${Date.now()}`,
        },
      },
    );
    assert.equal(interpretation.status, 201);
    reviewableRegion = (await interpretation.json()).region;
  }
  const response = await jsonFetch(
    `/api/workbook-review-sessions/${sessionId}/regions/${reviewableRegion.id}/confirm`,
    {
      method: "POST",
      body: {
        revisionId: reviewableRegion.currentRevision.id,
        expectedRegionVersion: reviewableRegion.version,
        idempotencyKey: `confirm_${reviewableRegion.id}_${Date.now()}`,
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
  await confirmReviewRegion(createdBody.workbookReviewSession.id, reviewRegion);
  const snapshotId = `analysis_fixture_snapshot_${suffix}`;
  const experimentIdentities = ["Exp1", "Exp2"].map((label, index) => ({
    id: `analysis_fixture_experiment_${suffix}_${index + 1}`,
    projectId: project.id,
    labId: project.labId,
    canonicalLabel: label,
    aliases: [label],
  }));
  const sourceRef = {
    sourceType: "excel_range",
    sourceDocumentId: createdBody.sourceDocument.id,
    sheet: "Sheet1",
    range: "A1:N4",
  };
  const experimentRecords = experimentIdentities.map((identity, index) => ({
    experimentId: identity.id,
    label: identity.canonicalLabel,
    aliases: [identity.canonicalLabel],
    fields: [
      ["solid", "Solid", index === 0 ? 92.8 : 92],
      ["liquid", "Liquid", index === 0 ? 0.1 : 0.34],
      ["gas", "Gas", index === 0 ? 0.35 : 0.41],
    ].map(([fieldKey, displayName, value]) => ({
      fieldKey,
      displayName,
      role: "outcome",
      valueType: "number",
      unit: "percent",
      value,
      formattedValue: String(value),
      sourceRefs: [sourceRef],
    })),
    series: [],
    warnings: [],
    sourceRefs: [sourceRef],
  }));
  experimentIdentities.forEach((identity) => store.experimentIdentities.set(identity.id, identity));
  store.dataSnapshots.set(snapshotId, {
    id: snapshotId,
    projectId: project.id,
    labId: project.labId,
    schemaVersion: "labrat.dataSnapshot.v3",
    status: "accepted",
    experimentRecords,
  });
  const experimentSnapshotHeads = experimentRecords.map((record, recordIndex) => ({
    id: `analysis_fixture_head_${suffix}_${recordIndex + 1}`,
    projectId: project.id,
    labId: project.labId,
    experimentId: record.experimentId,
    dataSnapshotId: snapshotId,
    recordIndex,
  }));
  experimentSnapshotHeads.forEach((head) => store.experimentSnapshotHeads.set(head.id, head));
  return { experimentIdentities, experimentSnapshotHeads };
}

const testModelProvider = {
  workbookInterpretCalls: [],
  publicConfig() {
    return {
      provider: "anthropic",
      model: "test-analysis-model",
      configured: true,
    };
  },
  async classifyIntent() {
    return { ok: false };
  },
  async answerReadOnly(input) {
    const goal = input.project?.profile?.researchGoal || "";
    return {
      ok: true,
      answer: [`Project ${input.project?.name || "Untitled project"}.`, goal].filter(Boolean).join(" "),
      evidenceIds: [],
      metadata: {
        provider: "anthropic",
        model: "test-analysis-model",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    };
  },
  async draftAnalysisPlan(input) {
    const region = input.confirmedRegions?.[0];
    if (!region) return { ok: false, warning: { code: "analysis_evidence_required" } };
    return {
      ok: true,
      requestSummary: "Create a chart from the confirmed workbook cells.",
      sourceSelections: [{
        regionUnderstandingRevisionId: region.regionUnderstandingRevisionId,
        sourceDocumentId: region.sourceDocumentId,
        sheetName: region.sheetName,
        range: region.range === "A1:CE107" ? "A1:B2" : region.range,
        label: region.experimentLabel || region.workbookName || "Selected workbook data",
        purpose: "Use the selected labels and numeric values in the chart",
      }],
      reviewPlan: {
        processingSteps: [
          "Read labels and numeric values from the selected red range.",
          "Create one chart curve for the selected table.",
        ],
        missingValueHandling: "Skip empty plotted values.",
        chart: {
          title: "Confirmed workbook data",
          chartType: "bar",
          xDescription: "Workbook labels",
          yDescription: "Selected values",
          seriesDescription: "One curve per selected table",
        },
        invariants: [],
      },
      displayPlan: [
        "Use the selected red workbook range.",
        "Plot the first readable labels on X and the corresponding numeric values on Y.",
      ],
      warnings: [],
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
  async draftExperimentBrowserPlan(input) {
    const experiment = input.activeExperiments?.[0];
    const sourceField = experiment?.fields?.find((field) => field.fieldKey === "solid")
      || experiment?.fields?.[0];
    if (!experiment || !sourceField) {
      return { ok: false, warning: { code: "analysis_evidence_required" } };
    }
    return {
      ok: true,
      requestSummary: "Add normalized Solid to the selected experiment.",
      sourceSelections: [],
      experimentSelections: [{
        experimentId: experiment.experimentId,
        columnIds: [sourceField.columnId],
        includeSeries: false,
        purpose: "Use the accepted Solid value.",
      }],
      reviewPlan: {
        processingSteps: [
          "Read Solid from the active experiment snapshot.",
          "Add Normalized Solid and preserve every existing field.",
        ],
        missingValueHandling: "Exclude experiments without Solid.",
        experimentOutput: { summary: "Add Normalized Solid without replacing other data." },
        browserView: { summary: "Show the experiment and the new Normalized Solid column." },
        invariants: [],
      },
      displayPlan: [
        "Use the accepted Solid value for the selected experiment.",
        "Add Normalized Solid and keep all existing fields.",
      ],
      warnings: [],
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
          "    return {'recordPatches': [], 'browserView': {}, 'exclusions': []}",
        ].join("\n"),
      },
    };
  },
  async interpretWorkbookRegion(input) {
    this.workbookInterpretCalls.push(input);
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
  publicConfig() {
    return {
      mode: "test",
      adapter: "test_executor",
      configured: true,
      productionSafe: false,
    };
  },
  async executeAcceptedRun(runPackage) {
    if (runPackage.inputs.experiments?.length) {
      const experiment = runPackage.inputs.experiments[0];
      const sourceField = experiment.fields.find((field) => field.fieldKey === "solid")
        || experiment.fields[0];
      return {
        ok: true,
        adapter: "test_executor",
        runtime: { version: runPackage.runtimeVersion, exitCode: 0 },
        result: {
          recordPatches: [{
            label: experiment.label,
            upsertFields: [{
              fieldKey: "normalized_solid",
              displayName: "Normalized Solid",
              role: "outcome",
              valueType: "number",
              unit: "percent",
              value: sourceField.value,
              formattedValue: String(sourceField.value),
              confidence: 1,
              warnings: [],
              sources: [{
                experimentId: experiment.experimentId,
                columnId: sourceField.columnId,
              }],
            }],
            upsertSeries: [],
            removeFields: [],
            removeSeries: [],
            warnings: [],
          }],
          browserView: { name: "Normalized Solid" },
          exclusions: [],
        },
      };
    }
    const traces = runPackage.inputs.tables.map((table, index) => {
      const rows = table.values || [];
      const displayRows = table.displayValues || [];
      const numericRowIndex = rows.findIndex((row) => row.some((value) => Number.isFinite(value)));
      const numericRow = numericRowIndex >= 0 ? rows[numericRowIndex] : [];
      const labelRow = numericRowIndex > 0 ? displayRows[numericRowIndex - 1] : [];
      const y = numericRow.flatMap((value) => Number.isFinite(value) ? [value] : []);
      const x = y.map((_, pointIndex) => String(labelRow[pointIndex] || `Value ${pointIndex + 1}`));
      return {
        traceId: `table_${index + 1}`,
        name: table.source?.workbookName || `Table ${index + 1}`,
        type: "bar",
        x,
        y,
      };
    }).filter((trace) => trace.y.length);
    return {
      ok: true,
      adapter: "test_executor",
      runtime: {
        version: runPackage.runtimeVersion,
        exitCode: 0,
      },
      result: {
        plotly: {
          data: traces,
          layout: {
            title: { text: "Confirmed workbook data" },
            xaxis: { title: { text: "Workbook labels" } },
            yaxis: { title: { text: "Selected values" } },
          },
        },
        exclusions: [],
        checks: [],
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
    fileStorageRoot: path.join(os.tmpdir(), `labrat-saas-test-${Date.now()}`),
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

  const fallbackProjectResponse = await jsonFetch("/api/projects", {
    method: "POST",
    body: { name: "Default Lab Project" },
  });
  assert.equal(fallbackProjectResponse.status, 201);
  const fallbackProject = (await fallbackProjectResponse.json()).project;
  assert.equal(fallbackProject.labId, meBody.labs[0].labId);

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
  const interpretationCallCountBeforeCreate = testModelProvider.workbookInterpretCalls.length;
  const sessionResponse = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(sessionResponse.status, 201);
  const sessionBody = await sessionResponse.json();
  const sessionId = sessionBody.workbookReviewSession.id;
  assert.ok(sessionBody.reviewRegions.length >= 1);
  assert.equal(sessionBody.interpretationDeferred, true);
  assert.equal(testModelProvider.workbookInterpretCalls.length, interpretationCallCountBeforeCreate);
  assert.ok(sessionBody.reviewRegions.every((region) => (
    region.reviewStatus === "interpreting" && region.currentRevision === null
  )));

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

  const deferredResponse = await jsonFetch(`/api/workbook-review-sessions/${sessionId}/regions`, {
    method: "POST",
    body: {
      sourceDocumentId: sessionBody.sourceDocument.id,
      sheetName: "Runs",
      range: "A2:D3",
      selectionMethod: "drag_select",
      deferInterpretation: true,
      idempotencyKey: `create_deferred_region_${Date.now()}`,
    },
  });
  assert.equal(deferredResponse.status, 201);
  const deferred = await deferredResponse.json();
  assert.equal(deferred.interpretationDeferred, true);
  assert.equal(deferred.region.reviewStatus, "interpreting");
  assert.equal(deferred.currentRevision, null);

  const interpretResponse = await jsonFetch(
    `/api/workbook-review-sessions/${sessionId}/regions/${deferred.region.id}/interpret`,
    {
      method: "POST",
      body: {
        expectedRegionVersion: deferred.region.version,
        semanticType: "experiment_table",
        idempotencyKey: `interpret_region_${Date.now()}`,
      },
    },
  );
  assert.equal(interpretResponse.status, 201);
  const interpreted = await interpretResponse.json();
  assert.equal(interpreted.region.reviewStatus, "awaiting_review");
  assert.ok(interpreted.currentRevision.summary.length >= 2);

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
  assert.equal(createBody.interpretationDeferred, true);
  assert.equal(createBody.regions.length > 0, true);
  assert.ok(createBody.reviewRegions.every((region) => region.reviewStatus === "interpreting"));
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

test("deleting a workbook review session hides it and retires its active regions", async () => {
  const project = await createProject("Delete Workbook Review Project");
  const upload = await uploadProjectFile(project.id, makeWorkbookBlob(), "delete-review.xlsx");
  const create = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  const session = createBody.workbookReviewSession;
  const reviewRegion = createBody.reviewRegions[0];
  await confirmReviewRegion(session.id, reviewRegion);
  const ignoredRegionResponse = await jsonFetch(
    `/api/workbook-review-sessions/${session.id}/regions`,
    {
      method: "POST",
      body: {
        sourceDocumentId: createBody.sourceDocument.id,
        sheetName: "Runs",
        range: "A1:B2",
        selectionMethod: "manual",
        idempotencyKey: `ignored_before_session_delete_${Date.now()}`,
      },
    },
  );
  assert.equal(ignoredRegionResponse.status, 201);
  const ignoredRegion = (await ignoredRegionResponse.json()).region;
  const ignoreResponse = await jsonFetch(
    `/api/workbook-review-sessions/${session.id}/regions/${ignoredRegion.id}/ignore`,
    {
      method: "POST",
      body: {
        expectedRegionVersion: ignoredRegion.version,
        reason: "Keep ignored history unchanged.",
      },
    },
  );
  assert.equal(ignoreResponse.status, 200);

  const staleDelete = await jsonFetch(`/api/workbook-review-sessions/${session.id}`, {
    method: "DELETE",
    body: {
      expectedVersion: session.version + 1,
      reason: "Stale delete attempt.",
    },
  });
  assert.equal(staleDelete.status, 409);
  assert.equal((await staleDelete.json()).error.code, "workbook_review_session_version_conflict");

  const deleted = await jsonFetch(`/api/workbook-review-sessions/${session.id}`, {
    method: "DELETE",
    body: {
      expectedVersion: session.version,
      reason: "Remove this workbook from review.",
    },
  });
  assert.equal(deleted.status, 200);
  const deletedBody = await deleted.json();
  assert.equal(deletedBody.workbookReviewSession.status, "deleted");
  assert.ok(deletedBody.deletedRegionCount >= 1);
  assert.equal((await store.findWorkbookReviewRegionById(ignoredRegion.id)).disposition, "ignored");

  const list = await (await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`)).json();
  assert.equal(list.workbookReviewSessions.some((item) => item.id === session.id), false);

  const state = await (await jsonFetch(`/api/projects/${project.id}/state`)).json();
  assert.equal(state.workbookReviewSessions.some((item) => item.id === session.id), false);
  assert.equal(
    state.workbookReviewRegions.some((region) => region.workbookReviewSessionId === session.id),
    false,
  );
  assert.equal(
    state.regionUnderstandings.some((understanding) => understanding.workbookReviewSessionId === session.id),
    false,
  );
  assert.equal(state.sourceDocuments.some((document) => document.id === createBody.sourceDocument.id), true);
  assert.equal(state.fileObjects.some((file) => file.id === upload.body.fileObject.id), true);

  const deletedSession = await jsonFetch(`/api/workbook-review-sessions/${session.id}`);
  assert.equal(deletedSession.status, 404);
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

test.skip("retired DataPlan draft and publish workflow", async () => {
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

test.skip("retired golden workbook DataPlan publication workflow", async () => {
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

test.skip("retired grouped-header DataPlan publication workflow", async () => {
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
  const interpretResponse = await jsonFetch(
    `/api/workbook-review-sessions/${sessionId}/regions/${reviewRegion.id}/interpret`,
    {
      method: "POST",
      body: {
        expectedRegionVersion: reviewRegion.version,
        idempotencyKey: `interpret_grouped_selectivity_${Date.now()}`,
      },
    },
  );
  assert.equal(interpretResponse.status, 201);
  const interpretedRegion = (await interpretResponse.json()).region;
  const interpretation = interpretedRegion.currentRevision.interpretation;
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

  const accepted = await confirmReviewRegion(sessionId, interpretedRegion);
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

test("legacy dataset, source-extract, chart-proposal, and planner routes are retired", async () => {
  const project = await createProject("Snapshot Browser Project");
  for (const request of [
    { path: `/api/projects/${project.id}/dataset-commits`, method: "GET" },
    { path: `/api/projects/${project.id}/mapping-sets`, method: "GET" },
    { path: `/api/projects/${project.id}/mapping-sets`, method: "POST", body: {} },
    { path: `/api/projects/${project.id}/analysis-views`, method: "GET" },
    { path: `/api/projects/${project.id}/analysis-views`, method: "POST", body: {} },
    { path: `/api/projects/${project.id}/charts/interpret`, method: "POST", body: { prompt: "plot gas selectivity" } },
    { path: `/api/projects/${project.id}/source-extract-proposals`, method: "POST", body: {} },
    { path: `/api/projects/${project.id}/chart-proposal-sets`, method: "GET" },
    { path: `/api/projects/${project.id}/chart-specs/from-proposal`, method: "POST", body: {} },
    { path: `/api/projects/${project.id}/agent/plan`, method: "POST", body: { message: "plot gas selectivity" } },
    { path: `/api/projects/${project.id}/data-plans/draft`, method: "POST", body: {} },
    { path: `/api/projects/${project.id}/data-plans/publish`, method: "POST", body: {} },
  ]) {
    const response = await jsonFetch(request.path, { method: request.method, body: request.body });
    assert.equal(response.status, 404, `${request.method} ${request.path}`);
  }

  const propose = await jsonFetch(`/api/projects/${project.id}/charts/propose`, {
    method: "POST",
    body: { userGoal: "Find charts" },
  });
  assert.equal(propose.status, 404);
});

test("project-content AgentRun returns a direct read-only answer without confirmation actions", async () => {
  const project = await createProject("Agent Project Summary");
  const run = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "这个项目目前有什么内容？" },
  });
  assert.equal(run.status, 201);
  const body = await run.json();
  assert.equal(body.agentRun.mode, "project_question");
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

async function uploadAndConfirmAnalysisWorkbook(project, blob, filename) {
  const upload = await uploadProjectFile(project.id, blob, filename);
  assert.equal(upload.response.status, 201);
  const sessionResponse = await jsonFetch(`/api/projects/${project.id}/workbook-review-sessions`, {
    method: "POST",
    body: { fileObjectId: upload.body.fileObject.id },
  });
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json();
  const reviewRegion = session.reviewRegions[0];
  const confirmed = await confirmReviewRegion(session.workbookReviewSession.id, reviewRegion);
  return {
    sourceDocument: session.sourceDocument,
    reviewRegion: confirmed.region,
    regionRevision: confirmed.acceptedRevision,
  };
}

test("confirmed workbook chart request completes Source to Plotly to ChartSpec without hashes", async () => {
  const project = await createProject("Analysis V2 Route Project");
  await uploadAndConfirmAnalysisWorkbook(
    project,
    makeComponentDistributionWorkbookBlob(),
    "Calculation Exp33.xlsx",
  );

  const plannedResponse = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "Draw the carbon number distribution for Exp33." },
  });
  assert.equal(plannedResponse.status, 201);
  const planned = await plannedResponse.json();
  const revision = planned.currentPlanRevision;
  assert.equal(revision.schemaVersion, "labrat.analysisPlanRevision.v2");
  assert.equal(revision.sourceSelections.length, 1);
  assert.equal(Object.hasOwn(revision, "pythonProgram"), false);

  const selectionResponse = await jsonFetch(
    `/api/analysis-plan-revisions/${revision.id}/selection`,
  );
  assert.equal(selectionResponse.status, 200);
  const selection = await selectionResponse.json();
  assert.deepEqual(selection.records, []);
  assert.equal(selection.sourceRectangles.length, 1);

  const acceptResponse = await jsonFetch(`/api/analysis-plan-revisions/${revision.id}/accept`, {
    method: "POST",
    headers: { "idempotency-key": `accept_analysis_v2_${Date.now()}` },
    body: {},
  });
  assert.equal(acceptResponse.status, 201);
  const accepted = await acceptResponse.json();
  assert.equal(accepted.analysisRun.status, "queued");
  assert.equal(Object.hasOwn(accepted.analysisRun.execution, "pythonProgram"), false);

  const executeResponse = await jsonFetch(`/api/analysis-runs/${accepted.analysisRun.id}/execute`, {
    method: "POST",
    body: {},
  });
  assert.equal(executeResponse.status, 201);
  const executed = await executeResponse.json();
  assert.equal(executed.analysisRun.status, "awaiting_result_review");
  assert.equal(executed.analysisResult.status, "awaiting_review");

  const previewResponse = await jsonFetch(
    `/api/analysis-runs/${accepted.analysisRun.id}/result-preview`,
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.ok(preview.plotly.data.length >= 1);
  assert.equal(preview.summary.seriesCount, preview.plotly.data.length);
  assert.equal(Object.hasOwn(preview, "rows"), false);
  assert.equal(Object.hasOwn(preview, "lineage"), false);

  const publishResponse = await jsonFetch(
    `/api/analysis-runs/${accepted.analysisRun.id}/accept-and-create-chart`,
    {
      method: "POST",
      headers: { "idempotency-key": `publish_analysis_v2_${Date.now()}` },
      body: {
        analysisResultId: executed.analysisResult.id,
        defaultVisibleTraceIds: preview.plotly.data.map((trace) => trace.traceId),
      },
    },
  );
  assert.equal(publishResponse.status, 201);
  const published = await publishResponse.json();
  assert.equal(published.chartSpec.spec.schemaVersion, "labrat.chartSpec.v3");
  assert.deepEqual(published.chartSpec.spec.plotly, preview.plotly);
  assert.deepEqual(
    published.chartSpec.spec.defaultChartView.visibleTraceIds,
    preview.plotly.data.map((trace) => trace.traceId),
  );
});

test("natural-language Experiment Browser request publishes a patch-based v3 snapshot", async () => {
  const project = await createProject("Experiment Browser Analysis Project");
  const seeded = await publishGroupedSelectivityDataForAnalysis(project, `browser_${Date.now()}`);
  const baseHead = seeded.experimentSnapshotHeads[0];

  const plannedResponse = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: {
      message: "Add normalized Solid to Experiment Browser and preserve the current fields.",
      selectedContext: {
        tab: "experiment_browser",
        analysisOutputTarget: "experiment_browser",
      },
    },
  });
  assert.equal(plannedResponse.status, 201);
  const planned = await plannedResponse.json();
  assert.equal(planned.analysisThread.outputTarget, "experiment_browser");
  assert.equal(planned.currentPlanRevision.outputTarget, "experiment_browser");
  assert.equal(planned.currentPlanRevision.experimentSelections.length, 1);
  assert.equal(Object.hasOwn(planned.currentPlanRevision, "pythonProgram"), false);

  const acceptResponse = await jsonFetch(
    `/api/analysis-plan-revisions/${planned.currentPlanRevision.id}/accept`,
    {
      method: "POST",
      headers: { "idempotency-key": `accept_browser_${Date.now()}` },
      body: {},
    },
  );
  assert.equal(acceptResponse.status, 201);
  const accepted = await acceptResponse.json();
  const executeResponse = await jsonFetch(`/api/analysis-runs/${accepted.analysisRun.id}/execute`, {
    method: "POST",
    body: {},
  });
  assert.equal(executeResponse.status, 201);
  const executed = await executeResponse.json();
  assert.equal(executed.analysisRun.status, "awaiting_result_review");
  assert.equal(executed.analysisResult.outputTarget, "experiment_browser");

  const previewResponse = await jsonFetch(
    `/api/analysis-runs/${accepted.analysisRun.id}/result-preview?offset=0&limit=100`,
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.outputTarget, "experiment_browser");
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.changeSummary.newFieldCount, 1);
  assert.equal(preview.changeSummary.preservedFieldCount, 3);
  assert.equal(preview.identityCandidates[0].status, "reuse");

  const publishResponse = await jsonFetch(
    `/api/analysis-runs/${accepted.analysisRun.id}/accept-and-publish-experiments`,
    {
      method: "POST",
      headers: { "idempotency-key": `publish_browser_${Date.now()}` },
      body: {
        analysisResultId: executed.analysisResult.id,
        identityResolutions: [],
      },
    },
  );
  assert.equal(publishResponse.status, 201);
  const published = await publishResponse.json();
  assert.equal(published.dataSnapshot.schemaVersion, "labrat.dataSnapshot.v3");
  assert.equal(published.dataSnapshot.dataPlanId, null);
  assert.equal(published.dataSnapshot.analysisResultId, executed.analysisResult.id);
  assert.equal(published.dataSnapshot.experimentRecords[0].fields.length, 4);
  assert.equal(
    published.dataSnapshot.experimentRecords[0].fields.some((field) => (
      field.fieldKey === "normalized_solid"
    )),
    true,
  );
  assert.equal(published.experimentSnapshotHeads[0].id, baseHead.id);
  assert.equal(
    published.experimentSnapshotHeads[0].dataSnapshotId,
    published.dataSnapshot.id,
  );
  assert.equal(published.browserView.isDefault, false);
});

test("two confirmed workbook selections materialize as two Python input tables and curves", async () => {
  const project = await createProject("Analysis V2 Multi Table Project");
  const first = await uploadAndConfirmAnalysisWorkbook(
    project,
    makeComponentDistributionWorkbookBlob(),
    "Calculation Exp32.xlsx",
  );
  const second = await uploadAndConfirmAnalysisWorkbook(
    project,
    makeComponentDistributionWorkbookBlob(),
    "Calculation Exp33.xlsx",
  );
  const threadResponse = await jsonFetch(`/api/projects/${project.id}/analysis-threads`, {
    method: "POST",
    body: { originalRequest: "Compare Exp32 and Exp33 carbon distributions." },
  });
  assert.equal(threadResponse.status, 201);
  const thread = (await threadResponse.json()).analysisThread;
  const sourceSelections = [first, second].map((item, index) => ({
    sourceSelectionId: `requested_${index + 1}`,
    regionUnderstandingRevisionId: item.regionRevision.id,
    sourceDocumentId: item.sourceDocument.id,
    sheetName: item.reviewRegion.sheetName,
    range: item.reviewRegion.rangeRef,
    label: `Exp${index + 32}`,
    purpose: "Compare carbon distribution",
  }));
  const revisionResponse = await jsonFetch(`/api/analysis-threads/${thread.id}/plan-revisions`, {
    method: "POST",
    body: {
      plan: {
        schemaVersion: "labrat.analysisPlanRevision.v2",
        status: "awaiting_review",
        requestSummary: "Compare two carbon distributions.",
        sourceSelections,
        reviewPlan: {
          processingSteps: ["Read both selected workbook tables.", "Create one curve per table."],
          missingValueHandling: "Skip empty plotted values.",
          chart: {
            title: "Exp32 and Exp33 carbon distributions",
            chartType: "bar",
            xDescription: "Carbon number",
            yDescription: "Distribution",
            seriesDescription: "One curve per experiment",
          },
          invariants: [],
        },
        displayPlan: [
          "Use the two red workbook ranges.",
          "Plot one curve for each experiment.",
        ],
        warnings: [],
      },
    },
  });
  assert.equal(revisionResponse.status, 201);
  const revision = (await revisionResponse.json()).analysisPlanRevision;
  assert.equal(revision.sourceSelections.length, 2);

  const acceptResponse = await jsonFetch(`/api/analysis-plan-revisions/${revision.id}/accept`, {
    method: "POST",
    headers: { "idempotency-key": `accept_multi_table_${Date.now()}` },
    body: {},
  });
  const accepted = await acceptResponse.json();
  const executeResponse = await jsonFetch(`/api/analysis-runs/${accepted.analysisRun.id}/execute`, {
    method: "POST",
    body: {},
  });
  assert.equal(executeResponse.status, 201);
  const executed = await executeResponse.json();
  assert.equal(executed.analysisRun.status, "awaiting_result_review");
  const preview = await (
    await jsonFetch(`/api/analysis-runs/${accepted.analysisRun.id}/result-preview`)
  ).json();
  assert.equal(preview.plotly.data.length, 2);
  assert.deepEqual(
    preview.plotly.data.map((trace) => trace.name),
    ["Calculation Exp32.xlsx", "Calculation Exp33.xlsx"],
  );
});

test("an 8,881-cell confirmed region is planned through an exact subrange without a 500-cell error", async () => {
  const project = await createProject("Analysis V2 Oversized Region Project");
  await uploadAndConfirmAnalysisWorkbook(
    project,
    makeOversizedCalculationWorkbookBlob(),
    "Calculation Exp33.xlsx",
  );

  const plannedResponse = await jsonFetch(`/api/projects/${project.id}/agent/runs`, {
    method: "POST",
    body: { message: "Draw the carbon number distribution in Exp33." },
  });
  assert.equal(plannedResponse.status, 201);
  const planned = await plannedResponse.json();
  assert.equal(planned.currentPlanRevision.sourceSelections[0].range, "A1:B2");

  const acceptResponse = await jsonFetch(
    `/api/analysis-plan-revisions/${planned.currentPlanRevision.id}/accept`,
    {
      method: "POST",
      headers: { "idempotency-key": `accept_oversized_region_${Date.now()}` },
      body: {},
    },
  );
  assert.equal(acceptResponse.status, 201);
  const accepted = await acceptResponse.json();
  const executeResponse = await jsonFetch(`/api/analysis-runs/${accepted.analysisRun.id}/execute`, {
    method: "POST",
    body: {},
  });
  assert.equal(executeResponse.status, 201);
  assert.equal((await executeResponse.json()).analysisRun.status, "awaiting_result_review");
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
  assert.equal(body.agentRun.mode, "project_question");
  assert.equal(body.agentRun.status, "completed");
  assert.deepEqual(body.agentRun.actions, []);
  assert.match(body.reply, /Determine how reaction conditions affect selectivity/);
});

test("explicit source wording uses the unified analysis flow and requires confirmed evidence", async () => {
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
  assert.equal(runBody.agentRun.mode, "analysis_planning");
  assert.equal(runBody.agentRun.status, "waiting_for_user");
  assert.deepEqual(runBody.agentRun.actions, []);
  assert.match(runBody.analysisThread.id, /^analysis_thread_/);
  assert.equal(runBody.currentPlanRevision, null);
  assert.equal(
    runBody.agentRun.warnings.some((warning) => warning.code === "analysis_evidence_required"),
    true,
  );
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
