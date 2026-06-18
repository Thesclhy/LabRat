import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import * as XLSX from "xlsx";
import { createServer } from "../../server.js";
import { createReactionRateSupplementWorkbook } from "../../import/fixtures/workbookFixtures.js";
import { loadSaasConfig } from "../config.js";
import { MemorySaasStore } from "../memoryStore.js";

let server;
let baseUrl;
let cookie;
let store;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_SUPPLEMENT_FIXTURE_DIR = path.resolve(__dirname, "../../import/fixtures/real-workbooks");
const REAL_SUPPLEMENT_FIXTURE_FILES = [
  "MasterTable_updated.xlsx",
  "Reaction_Rate_Exp33.xlsx",
  "Reaction_Rate_Exp34.xlsx",
  "Reaction_Rate_Exp35.xlsx",
];
const hasRealSupplementFixtures = REAL_SUPPLEMENT_FIXTURE_FILES.every((filename) =>
  fs.existsSync(path.join(REAL_SUPPLEMENT_FIXTURE_DIR, filename)),
);
const realSupplementFixtureTest = hasRealSupplementFixtures ? test : test.skip;

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
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function makeSelectivityWorkbookBlob(rows = [
  ["Exp1", 250, "Ru/TiO2", 92.8, 0.1, 0.35],
  ["Exp2", 275, "Ru/TiO2", 93.1, 0.5, 0.24],
]) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Label", "Temperature (C)", "Catalyst Type", "Selectivity Solid (%)", "Selectivity Liquid (%)", "Selectivity Gas (%)"],
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Runs");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function makeReactionRateWorkbookBlob(rows = [
  [0, 0],
  [5, 1.2],
  [10, 2.4],
]) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Time (min)", "Reaction Rate (mol/g/h)"],
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Reaction Rate");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function fixtureBlob(file) {
  return new Blob([file.buffer], {
    type: file.contentType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function workbookFixtureBlob(filename) {
  return new Blob([fs.readFileSync(path.join(REAL_SUPPLEMENT_FIXTURE_DIR, filename))], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function uploadAndCreateImportRun(projectId, blob = makeWorkbookBlob(), filename = "MasterTable_updated.xlsx") {
  const { response: upload, body: uploadBody } = await uploadProjectFile(projectId, blob, filename);
  assert.equal(upload.status, 201);
  const importRunResponse = await jsonFetch(`/api/projects/${projectId}/import-runs`, {
    method: "POST",
    body: { fileObjectId: uploadBody.fileObject.id },
  });
  assert.equal(importRunResponse.status, 201);
  const importRunBody = await importRunResponse.json();
  return { upload: uploadBody.fileObject, importRun: importRunBody.importRun };
}

async function uploadProjectFile(projectId, blob = makeWorkbookBlob(), filename = "MasterTable_updated.xlsx") {
  const form = new FormData();
  form.set("file", blob, filename);
  const upload = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  const uploadBody = await upload.json();
  return { response: upload, body: uploadBody };
}

async function normalizeAndApplyImportRun(importRun, approvedBlockIds = null) {
  const previewBody = await normalizeImportRun(importRun, approvedBlockIds);
  const apply = await jsonFetch(`/api/import-runs/${importRun.id}/apply`, {
    method: "POST",
    body: { reviewNote: "Looks good." },
  });
  assert.equal(apply.status, 200);
  return {
    preview: previewBody.importRun,
    apply: await apply.json(),
  };
}

async function normalizeImportRun(importRun, approvedBlockIds = null) {
  const blockIds = approvedBlockIds || [importRun.scanResult.sheets[0].blocks[0].blockId];
  const preview = await jsonFetch(`/api/import-runs/${importRun.id}/normalize-preview`, {
    method: "POST",
    body: { approvedBlockIds: blockIds },
  });
  assert.equal(preview.status, 200);
  return preview.json();
}

async function waitForSupplementalBatch(projectId, batchId, predicate, timeoutMs = 5000) {
  const start = Date.now();
  let latest = null;
  while (Date.now() - start < timeoutMs) {
    const response = await jsonFetch(`/api/projects/${projectId}/supplemental-import-batches/${batchId}`);
    assert.equal(response.status, 200);
    latest = (await response.json()).batch;
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for supplemental batch ${batchId}. Latest: ${JSON.stringify(latest)}`);
}

async function readSupplementalBatchSse(projectId, batchId) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/projects/${projectId}/supplemental-import-batches/${batchId}/events`, {
    headers: { cookie },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.includes("event: complete")) break;
  }
  controller.abort();
  return text;
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  return setCookie.split(";")[0];
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

async function createProjectWithAppliedImport(name = "Applied Data Project") {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name },
  })).json();
  const created = await uploadAndCreateImportRun(project.project.id);
  const applied = await normalizeAndApplyImportRun(created.importRun);
  return {
    project: project.project,
    upload: created.upload,
    importRun: created.importRun,
    apply: applied.apply,
  };
}

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
  server = createServer({ config, store });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      baseUrl = `http://${address.address}:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("seeded lab owner can log in and fetch current auth context", async () => {
  const login = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: { username: "labuser", password: "LabRatLab123!" },
  });
  assert.equal(login.status, 200);
  cookie = cookieFrom(login);
  assert.match(cookie, /^labrat_session=/);
  const loginBody = await login.json();
  assert.equal(loginBody.user.username, "labuser");
  assert.equal(loginBody.labs[0].name, "Hanqi Test Lab");
  assert.equal(loginBody.labs[0].role, "lab_owner");

  const me = await jsonFetch("/api/auth/me");
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.user.username, "labuser");
  assert.equal(meBody.labs[0].slug, "hanqi-test-lab");
});

test("unauthenticated project list is rejected", async () => {
  const previousCookie = cookie;
  cookie = "";
  const response = await jsonFetch("/api/projects");
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "unauthorized");
  cookie = previousCookie;
});

test("lab owner can create a server project", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const create = await jsonFetch("/api/projects", {
    method: "POST",
    body: {
      labId,
      name: "SaaS Test Project",
      description: "Project created by route test.",
    },
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  assert.match(createBody.project.id, /^project_/);
  assert.equal(createBody.project.labId, labId);

  const list = await jsonFetch(`/api/projects?labId=${labId}`);
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.projects.some((project) => project.id === createBody.project.id), true);
});

test("lab owner can soft-delete a project and hide it from project lists", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const create = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Delete Me Project" },
  })).json();

  const deletion = await jsonFetch(`/api/projects/${create.project.id}`, {
    method: "PATCH",
    body: { status: "deleted" },
  });
  assert.equal(deletion.status, 200);
  const deletionBody = await deletion.json();
  assert.equal(deletionBody.project.status, "deleted");

  const list = await (await jsonFetch(`/api/projects?labId=${labId}`)).json();
  assert.equal(list.projects.some((project) => project.id === create.project.id), false);

  const fetched = await (await jsonFetch(`/api/projects/${create.project.id}`)).json();
  assert.equal(fetched.project.status, "deleted");

  const auditEvents = await store.listAuditEvents({ projectId: create.project.id });
  assert.equal(auditEvents.some((event) => event.action === "project.delete"), true);
});

test("projects persist independent profiles and merge profile updates", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const first = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: {
      labId,
      name: "Background Project A",
      description: "First profile project.",
      metadata: { source: "route-test" },
      projectProfile: {
        researchGoal: "Study gas selectivity.",
        experimentBackground: "Hydrogenolysis screening.",
        materials: "Ru/TiO2 and HDPE.",
        methods: "Batch reactor.",
        instruments: "GC-FID",
        analysisNotes: "Initial import.",
        tags: ["selectivity", "screening"],
      },
    },
  })).json();
  const second = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Background Project B" },
  })).json();

  assert.notEqual(first.project.id, second.project.id);
  assert.equal(first.project.projectProfile.researchGoal, "Study gas selectivity.");
  assert.deepEqual(first.project.projectProfile.tags, ["selectivity", "screening"]);

  const patch = await jsonFetch(`/api/projects/${first.project.id}`, {
    method: "PATCH",
    body: {
      status: "active",
      projectProfile: {
        researchGoal: "Updated selectivity goal.",
        tags: ["updated"],
      },
    },
  });
  assert.equal(patch.status, 200);
  const patchBody = await patch.json();
  assert.equal(patchBody.project.metadata.source, "route-test");
  assert.equal(patchBody.project.projectProfile.researchGoal, "Updated selectivity goal.");
  assert.equal(patchBody.project.projectProfile.methods, "Batch reactor.");
  assert.deepEqual(patchBody.project.projectProfile.tags, ["updated"]);

  const fetchedSecond = await (await jsonFetch(`/api/projects/${second.project.id}`)).json();
  assert.equal(fetchedSecond.project.projectProfile.researchGoal, "");
});

test("viewer can read project state but cannot update project profile", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const ownerCookie = cookie;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Viewer State Project" },
  })).json();
  const mappingCreate = await jsonFetch(`/api/projects/${project.project.id}/mapping-sets`, {
    method: "POST",
    body: {
      schemaVersion: "labrat.semanticMappingResponse.v1",
      status: "proposed",
      payload: { mappings: [{ mappingId: "map_viewer_guard", canonicalField: "temperature" }] },
      decisionSummary: { accepted: 0, rejected: 0 },
    },
  });
  assert.equal(mappingCreate.status, 201);
  const mappingBody = await mappingCreate.json();
  const username = `viewer_${Date.now()}`;
  const createUser = await jsonFetch("/api/admin/users", {
    method: "POST",
    body: {
      username,
      displayName: "Viewer User",
      temporaryPassword: "ViewerPass123!",
      labId,
      role: "viewer",
    },
  });
  assert.equal(createUser.status, 201);

  const viewerLogin = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: { username, password: "ViewerPass123!" },
  });
  assert.equal(viewerLogin.status, 200);
  cookie = cookieFrom(viewerLogin);

  const state = await jsonFetch(`/api/projects/${project.project.id}/state`);
  assert.equal(state.status, 200);
  const stateBody = await state.json();
  assert.equal(stateBody.project.id, project.project.id);

  const patch = await jsonFetch(`/api/projects/${project.project.id}`, {
    method: "PATCH",
    body: { projectProfile: { researchGoal: "Viewer edit attempt." } },
  });
  assert.equal(patch.status, 403);

  const deletePatch = await jsonFetch(`/api/projects/${project.project.id}`, {
    method: "PATCH",
    body: { status: "deleted" },
  });
  assert.equal(deletePatch.status, 403);

  const mappingPatch = await jsonFetch(`/api/mapping-sets/${mappingBody.mappingSet.id}`, {
    method: "PATCH",
    body: {
      payload: { mappings: [{ mappingId: "map_viewer_guard", canonicalField: "pressure" }] },
      decisionSummary: { accepted: 1, rejected: 0 },
    },
  });
  assert.equal(mappingPatch.status, 403);
  cookie = ownerCookie;
});

test("cross-lab project state access is rejected", async () => {
  const ownerCookie = cookie;
  const adminLogin = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "LabRatAdmin123!" },
  });
  assert.equal(adminLogin.status, 200);
  cookie = cookieFrom(adminLogin);

  const slug = `other-lab-${Date.now()}`;
  const lab = await (await jsonFetch("/api/admin/labs", {
    method: "POST",
    body: { name: "Other Test Lab", slug },
  })).json();
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId: lab.lab.id, name: "Other Lab Project" },
  })).json();

  cookie = ownerCookie;
  const state = await jsonFetch(`/api/projects/${project.project.id}/state`);
  assert.equal(state.status, 403);
});

test("file upload, import run, normalize preview, and apply create a dataset commit", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Import Commit Project" },
  })).json();

  const created = await uploadAndCreateImportRun(project.project.id);
  assert.match(created.upload.id, /^file_/);
  assert.match(created.upload.checksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(created.importRun.status, "review_ready");
  assert.match(created.importRun.scanResult.file.fileId, /^upload_[a-f0-9]{16}$/);

  const applied = await normalizeAndApplyImportRun(created.importRun);
  assert.equal(applied.preview.status, "normalized_preview");
  assert.equal(applied.preview.normalizePreview.datasetPatch.genericImports[0].experiments.length, 2);
  const applyBody = applied.apply;
  assert.match(applyBody.datasetCommit.id, /^commit_/);
  assert.equal(applyBody.datasetCommit.sourceImportRunIds[0], created.importRun.id);
  assert.equal(applyBody.project.currentDatasetCommitId, applyBody.datasetCommit.id);
  assert.equal(applyBody.datasetCommit.datasetPayload.genericImports.length, 1);
  assert.equal(applyBody.datasetCommit.summary.addedExperimentCount, 2);
  assert.equal(applyBody.datasetCommit.summary.totalGenericImportCount, 1);

  const state = await jsonFetch(`/api/projects/${project.project.id}/state`);
  assert.equal(state.status, 200);
  const stateBody = await state.json();
  assert.equal(stateBody.currentDatasetCommit.id, applyBody.datasetCommit.id);
  assert.equal(stateBody.datasetCommits.some((commit) => commit.id === applyBody.datasetCommit.id), true);
  assert.equal(stateBody.fileObjects.some((fileObject) => fileObject.id === created.upload.id), true);
  assert.equal(stateBody.importRuns.some((run) => run.id === created.importRun.id && run.status === "applied"), true);

  const auditEvents = await store.listAuditEvents({ projectId: project.project.id });
  assert.equal(auditEvents.some((event) => event.action === "import.normalize_preview"), true);
  assert.equal(auditEvents.some((event) => event.action === "import.apply"), true);
  assert.equal(auditEvents.some((event) => event.action === "dataset_commit.create"), true);
});

test("duplicate workbook upload reuses the existing file object and can create another import run", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Duplicate Upload Project" },
  })).json();
  const workbook = makeWorkbookBlob([
    ["Exp1", 250, 5, 0.35],
  ]);

  const first = await uploadProjectFile(project.project.id, workbook, "duplicate.xlsx");
  assert.equal(first.response.status, 201);
  assert.equal(first.body.reused, false);
  assert.match(first.body.fileObject.id, /^file_/);

  const duplicate = await uploadProjectFile(project.project.id, workbook, "duplicate.xlsx");
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.reused, true);
  assert.equal(duplicate.body.fileObject.id, first.body.fileObject.id);

  const duplicateRun = await jsonFetch(`/api/projects/${project.project.id}/import-runs`, {
    method: "POST",
    body: { fileObjectId: duplicate.body.fileObject.id },
  });
  assert.equal(duplicateRun.status, 201);

  const renamed = await uploadProjectFile(project.project.id, workbook, "renamed.xlsx");
  assert.equal(renamed.response.status, 201);
  assert.notEqual(renamed.body.fileObject.id, first.body.fileObject.id);

  const otherProject = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Duplicate Upload Other Project" },
  })).json();
  const otherProjectUpload = await uploadProjectFile(otherProject.project.id, workbook, "duplicate.xlsx");
  assert.equal(otherProjectUpload.response.status, 201);
  assert.notEqual(otherProjectUpload.body.fileObject.id, first.body.fileObject.id);

  const auditEvents = await store.listAuditEvents({ projectId: project.project.id });
  assert.equal(auditEvents.some((event) => event.action === "file.reuse"), true);
});

test("a project allows one master append and rejects a second append", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Single Master Dataset Project" },
  })).json();

  const first = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp1", 250, 5, 0.35],
  ]), "first.xlsx");
  const firstApply = await normalizeAndApplyImportRun(first.importRun);
  const firstCommitId = firstApply.apply.datasetCommit.id;
  const firstImportId = firstApply.apply.datasetCommit.datasetPayload.genericImports[0].importId;

  const second = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp3", 300, 10, 0.55],
  ]), "second.xlsx");
  await normalizeImportRun(second.importRun);
  const secondApply = await jsonFetch(`/api/import-runs/${second.importRun.id}/apply`, {
    method: "POST",
    body: { reviewNote: "Attempt second master append." },
  });
  assert.equal(secondApply.status, 409);
  assert.equal((await secondApply.json()).error.code, "master_table_already_exists");

  const state = await (await jsonFetch(`/api/projects/${project.project.id}/state`)).json();
  const parent = state.datasetCommits.find((commit) => commit.id === firstCommitId);
  assert.equal(parent.datasetPayload.genericImports.length, 1);
  assert.equal(parent.datasetPayload.genericImports[0].importId, firstImportId);
  assert.equal(state.currentDatasetCommit.id, firstCommitId);
  assert.equal(state.currentDatasetCommit.datasetPayload.genericImports.length, 1);
});

test("refresh preview and apply replace one active import while preserving parent commits", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Refresh Import Project" },
  })).json();

  const original = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp1", 250, 5, 0.35],
    ["Exp2", 275, 8, 0.24],
  ]), "refresh-original.xlsx");
  const originalApply = await normalizeAndApplyImportRun(original.importRun);
  const parentCommit = originalApply.apply.datasetCommit;
  const targetImport = parentCommit.datasetPayload.genericImports[0];

  const replacement = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp1", 250, 5, 0.99],
    ["Exp2", 275, 8, 0.24],
    ["Exp3", 300, 10, 0.55],
  ]), "refresh-replacement.xlsx");
  const replacementPreview = await normalizeImportRun(replacement.importRun);
  const replacementImport = replacementPreview.importRun.normalizePreview.datasetPatch.genericImports[0];

  const refreshPreview = await jsonFetch(`/api/import-runs/${replacement.importRun.id}/refresh-preview`, {
    method: "POST",
    body: {
      replaceImportId: targetImport.importId,
      expectedParentDatasetCommitId: parentCommit.id,
    },
  });
  assert.equal(refreshPreview.status, 200);
  const refreshPreviewBody = await refreshPreview.json();
  assert.equal(refreshPreviewBody.schemaVersion, "labrat.importRefreshPreview.v1");
  assert.equal(refreshPreviewBody.targetImportId, targetImport.importId);
  assert.equal(refreshPreviewBody.replacementImportId, replacementImport.importId);
  assert.equal(refreshPreviewBody.hasChanges, true);
  assert.equal(refreshPreviewBody.summary.experimentsAdded, 1);
  assert.equal(refreshPreviewBody.summary.valuesChanged, 1);

  const refreshApply = await jsonFetch(`/api/import-runs/${replacement.importRun.id}/apply`, {
    method: "POST",
    body: {
      applyMode: "replace_import",
      replaceImportId: targetImport.importId,
      expectedParentDatasetCommitId: parentCommit.id,
      reviewNote: "Corrected gas selectivity and added Exp3.",
    },
  });
  assert.equal(refreshApply.status, 200);
  const refreshApplyBody = await refreshApply.json();
  const refreshedCommit = refreshApplyBody.datasetCommit;
  const activeImport = refreshedCommit.datasetPayload.genericImports[0];
  assert.equal(refreshedCommit.parentCommitId, parentCommit.id);
  assert.equal(refreshedCommit.datasetPayload.genericImports.length, 1);
  assert.equal(activeImport.importId, replacementImport.importId);
  assert.equal(activeImport.refreshOfImportId, targetImport.importId);
  assert.equal(activeImport.refreshMetadata.sourceImportRunId, replacement.importRun.id);
  assert.equal(refreshedCommit.summary.applyMode, "replace_import");
  assert.equal(refreshedCommit.summary.replacedImportId, targetImport.importId);
  assert.equal(refreshedCommit.summary.replacementImportId, replacementImport.importId);
  assert.equal(refreshedCommit.summary.reviewNote, "Corrected gas selectivity and added Exp3.");
  assert.equal(refreshedCommit.summary.totalGenericImportCount, 1);
  assert.equal(refreshedCommit.summary.totalExperimentCount, 3);
  assert.equal(activeImport.fields.find((field) => field.displayName === "Selectivity Gas (%)" && field.rawValue === "0.99").value, 0.99);

  const state = await (await jsonFetch(`/api/projects/${project.project.id}/state`)).json();
  const historicalParent = state.datasetCommits.find((commit) => commit.id === parentCommit.id);
  assert.equal(historicalParent.datasetPayload.genericImports[0].importId, targetImport.importId);
  assert.equal(state.currentDatasetCommit.id, refreshedCommit.id);
  assert.equal(state.currentDatasetCommit.datasetPayload.genericImports[0].importId, replacementImport.importId);

  const auditEvents = await store.listAuditEvents({ projectId: project.project.id });
  assert.equal(auditEvents.some((event) => event.action === "import.refresh_apply"), true);
  assert.equal(auditEvents.some((event) => event.action === "dataset_commit.create" && event.targetId === refreshedCommit.id), true);

  const repeatRefreshApply = await jsonFetch(`/api/import-runs/${replacement.importRun.id}/apply`, {
    method: "POST",
    body: {
      applyMode: "replace_import",
      replaceImportId: targetImport.importId,
      expectedParentDatasetCommitId: parentCommit.id,
    },
  });
  assert.equal(repeatRefreshApply.status, 409);
  assert.equal((await repeatRefreshApply.json()).error.code, "import_run_already_applied");
});

test("relationship preview and supplement apply attach a detailed workbook to an existing experiment", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Supplement Relationship Project" },
  })).json();

  const master = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp30", 250, 14, 0.28],
    ["Exp31", 260, 10, 0.44],
  ]), "MasterTable.xlsx");
  const masterApply = await normalizeAndApplyImportRun(master.importRun);
  const parentCommit = masterApply.apply.datasetCommit;
  const exp30 = parentCommit.datasetPayload.genericImports[0].experiments.find((experiment) => experiment.label === "Exp30");
  const exp31 = parentCommit.datasetPayload.genericImports[0].experiments.find((experiment) => experiment.label === "Exp31");
  assert.ok(exp30?.experimentId);
  assert.ok(exp31?.experimentId);

  const supplement = await uploadAndCreateImportRun(
    project.project.id,
    fixtureBlob(createReactionRateSupplementWorkbook()),
    "Reaction_Rate_Exp30.xlsx",
  );
  const supplementPreview = await normalizeImportRun(supplement.importRun);
  const supplementImport = supplementPreview.importRun.normalizePreview.datasetPatch.genericImports[0];
  assert.equal(supplementImport.experiments.length, 0);
  assert.equal(supplementImport.observationSets.length, 1);
  assert.equal(supplementImport.observationSets[0].observations.length, 62);

  const relationshipPreview = await jsonFetch(`/api/import-runs/${supplement.importRun.id}/relationship-preview`, {
    method: "POST",
    body: {},
  });
  assert.equal(relationshipPreview.status, 200);
  const relationshipBody = await relationshipPreview.json();
  assert.equal(relationshipBody.schemaVersion, "labrat.importRelationshipPreview.v1");
  const proposal = relationshipBody.proposals[0];
  assert.equal(proposal.proposedRelationship, "supplement");
  assert.equal(proposal.supplementType, "reaction_rate_time_series");
  assert.equal(proposal.targetExperimentIds.includes(exp30.experimentId), true);

  const supplementApply = await jsonFetch(`/api/import-runs/${supplement.importRun.id}/apply`, {
    method: "POST",
    body: {
      applyMode: "supplement_import",
      relationshipDecision: proposal,
      reviewNote: "Attach reaction rate detail to Exp30.",
    },
  });
  assert.equal(supplementApply.status, 200);
  const supplementApplyBody = await supplementApply.json();
  const supplementCommit = supplementApplyBody.datasetCommit;
  assert.equal(supplementCommit.parentCommitId, parentCommit.id);
  assert.equal(supplementCommit.datasetPayload.genericImports.length, 2);
  assert.equal(supplementCommit.summary.applyMode, "supplement_import");
  assert.equal(supplementCommit.summary.relationship, "supplement");
  assert.equal(supplementCommit.summary.targetExperimentIds.includes(exp30.experimentId), true);
  const linkedImport = supplementCommit.datasetPayload.genericImports.find((item) => item.fileName === "Reaction_Rate_Exp30.xlsx");
  assert.equal(linkedImport.relationship.relationship, "supplement");
  assert.equal(linkedImport.relationship.targetExperimentIds.includes(exp30.experimentId), true);
  assert.equal(linkedImport.observationSets[0].targetExperimentIds.includes(exp30.experimentId), true);
  assert.equal(linkedImport.fields.some((field) => field.recordKind === "observation" && field.relatedExperimentIds.includes(exp30.experimentId)), true);

  const secondSupplement = await uploadAndCreateImportRun(
    project.project.id,
    makeReactionRateWorkbookBlob([[0, 0], [15, 3.1]]),
    "Reaction_Rate_Exp31.xlsx",
  );
  await normalizeImportRun(secondSupplement.importRun);
  const secondRelationshipPreview = await (await jsonFetch(`/api/import-runs/${secondSupplement.importRun.id}/relationship-preview`, {
    method: "POST",
    body: {},
  })).json();
  const secondProposal = secondRelationshipPreview.proposals[0];
  assert.equal(secondProposal.proposedRelationship, "supplement");
  assert.equal(secondProposal.targetExperimentIds.includes(exp31.experimentId), true);
  const secondSupplementApply = await jsonFetch(`/api/import-runs/${secondSupplement.importRun.id}/apply`, {
    method: "POST",
    body: {
      applyMode: "supplement_import",
      relationshipDecision: secondProposal,
      reviewNote: "Attach repeated reaction rate detail to Exp30.",
    },
  });
  assert.equal(secondSupplementApply.status, 200);
  const secondSupplementCommit = (await secondSupplementApply.json()).datasetCommit;
  assert.equal(secondSupplementCommit.datasetPayload.genericImports.length, 3);
  assert.equal(secondSupplementCommit.summary.applyMode, "supplement_import");
  const secondLinkedImport = secondSupplementCommit.datasetPayload.genericImports.find((item) => item.fileName === "Reaction_Rate_Exp31.xlsx");
  assert.ok(secondLinkedImport?.importId);

  const chartResponse = await jsonFetch(`/api/projects/${project.project.id}/charts/propose`, {
    method: "POST",
    body: {
      selectedImportIds: [secondLinkedImport.importId],
      chartConstraints: { maxProposals: 4 },
    },
  });
  assert.equal(chartResponse.status, 200);
  const chartBody = await chartResponse.json();
  const secondImportProposal = chartBody.chartProposalSet.payload.proposals.find((proposal) => {
    const sourceIds = [
      ...(proposal.x?.sourceIds || []),
      ...(proposal.y?.sourceIds || []),
      ...(proposal.yFields || []).flatMap((field) => field.sourceIds || []),
    ];
    return sourceIds.length && sourceIds.every((sourceId) => sourceId.startsWith(secondLinkedImport.importId));
  });
  assert.ok(secondImportProposal);
  assert.equal(secondImportProposal.sourceImportIds.includes(secondLinkedImport.importId), true);
  assert.equal(secondImportProposal.x.sourceIds.every((sourceId) => sourceId.startsWith(secondLinkedImport.importId)), true);
  assert.equal(secondImportProposal.y.sourceIds.every((sourceId) => sourceId.startsWith(secondLinkedImport.importId)), true);
  assert.equal(secondImportProposal.x.sourceIds.some((sourceId) => sourceId.startsWith(linkedImport.importId)), false);
  assert.equal(secondImportProposal.y.sourceIds.some((sourceId) => sourceId.startsWith(linkedImport.importId)), false);

  const state = await (await jsonFetch(`/api/projects/${project.project.id}/state`)).json();
  const historicalParent = state.datasetCommits.find((commit) => commit.id === parentCommit.id);
  assert.equal(historicalParent.datasetPayload.genericImports.length, 1);
  assert.equal(state.currentDatasetCommit.id, secondSupplementCommit.id);
  assert.ok(Array.isArray(state.observationSeries));

  const observationSeriesResponse = await jsonFetch(`/api/projects/${project.project.id}/observation-series`);
  assert.equal(observationSeriesResponse.status, 200);
  const observationSeriesBody = await observationSeriesResponse.json();
  assert.equal(observationSeriesBody.schemaVersion, "labrat.observationSeriesList.v1");
  assert.equal(observationSeriesBody.currentDatasetCommitId, secondSupplementCommit.id);
  const activeSeries = observationSeriesBody.observationSeries.filter((series) => !series.isStale);
  const staleSeries = observationSeriesBody.observationSeries.filter((series) => series.isStale);
  assert.equal(activeSeries.every((series) => series.datasetCommitId === secondSupplementCommit.id), true);
  assert.equal(activeSeries.some((series) => (
    series.experimentId === exp30.experimentId
    && series.seriesKind === "reaction_rate_time_series"
    && series.yField === "adjusted_rate_m_s"
    && series.summary.pointCount > 0
  )), true);
  assert.equal(activeSeries.some((series) => (
    series.experimentId === exp31.experimentId
    && series.seriesKind === "reaction_rate_time_series"
    && series.summary.pointCount > 0
  )), true);
  assert.equal(staleSeries.some((series) => series.datasetCommitId === supplementCommit.id), true);
  assert.equal(state.observationSeries.some((series) => (
    series.experimentId === exp30.experimentId
    && series.yField === "adjusted_rate_m_s"
    && !series.isStale
  )), true);

  const query = await jsonFetch(`/api/projects/${project.project.id}/data/resolve-query`, {
    method: "POST",
    body: { prompt: "show Exp30 reaction rate data" },
  });
  assert.equal(query.status, 200);
  const queryBody = await query.json();
  assert.equal(queryBody.schemaVersion, "labrat.dataResolveQuery.v1");
  assert.equal(queryBody.retrievedContext.experiments.some((entry) => entry.label === "Exp30"), true);
  assert.equal(queryBody.retrievedContext.fields.some((entry) => entry.metadata?.recordKind === "observation" && /rate/i.test(entry.label)), true);
  assert.equal(queryBody.viewIntentDraft.columns.some((column) => /rate/i.test(column.label)), true);

  const auditEvents = await store.listAuditEvents({ projectId: project.project.id });
  assert.equal(auditEvents.some((event) => event.action === "import.supplement_apply"), true);
});

test("series compare AnalysisView drafts a reviewable chart proposal set", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "AnalysisView Compare Project" },
  })).json();

  const master = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp30", 250, 14, 0.28],
    ["Exp31", 260, 10, 0.44],
  ]), "MasterTable.xlsx");
  const masterApply = await normalizeAndApplyImportRun(master.importRun);
  const parentCommit = masterApply.apply.datasetCommit;
  const exp30 = parentCommit.datasetPayload.genericImports[0].experiments.find((experiment) => experiment.label === "Exp30");
  const exp31 = parentCommit.datasetPayload.genericImports[0].experiments.find((experiment) => experiment.label === "Exp31");

  for (const [filename, rows, reviewNote] of [
    ["Reaction_Rate_Exp30.xlsx", [[0, 0], [15, 3.1], [30, 2.4]], "Attach reaction rate detail to Exp30."],
    ["Reaction_Rate_Exp31.xlsx", [[0, 0], [12, 2.8], [24, 2.1]], "Attach reaction rate detail to Exp31."],
  ]) {
    const supplement = await uploadAndCreateImportRun(
      project.project.id,
      makeReactionRateWorkbookBlob(rows),
      filename,
    );
    await normalizeImportRun(supplement.importRun);
    const relationshipBody = await (await jsonFetch(`/api/import-runs/${supplement.importRun.id}/relationship-preview`, {
      method: "POST",
      body: {},
    })).json();
    const relationship = relationshipBody.proposals[0];
    const applyResponse = await jsonFetch(`/api/import-runs/${supplement.importRun.id}/apply`, {
      method: "POST",
      body: {
        applyMode: "supplement_import",
        relationshipDecision: relationship,
        reviewNote,
      },
    });
    assert.equal(applyResponse.status, 200);
  }

  const viewResponse = await jsonFetch(`/api/projects/${project.project.id}/analysis-views`, {
    method: "POST",
    body: {
      viewType: "series_compare",
      title: "Reaction Rate comparison",
      spec: {
        seriesKind: "reaction_rate_time_series",
        experimentIds: [exp30.experimentId, exp31.experimentId],
        xField: "reaction_time_min",
        yField: "reaction_rate_mol_g_h",
        groupBy: "experiment",
      },
    },
  });
  assert.equal(viewResponse.status, 201);
  const viewBody = await viewResponse.json();
  assert.equal(viewBody.analysisView.viewType, "series_compare");
  assert.equal(viewBody.analysisView.datasetCommitId.length > 0, true);
  assert.deepEqual(viewBody.analysisView.spec.experimentIds, [exp30.experimentId, exp31.experimentId]);
  assert.equal(viewBody.analysisView.spec.seriesIds.length, 2);

  const listBody = await (await jsonFetch(`/api/projects/${project.project.id}/analysis-views`)).json();
  assert.equal(listBody.analysisViews.some((view) => view.id === viewBody.analysisView.id), true);
  const state = await (await jsonFetch(`/api/projects/${project.project.id}/state`)).json();
  assert.equal(state.analysisViews.some((view) => view.id === viewBody.analysisView.id), true);

  const chartResponse = await jsonFetch(`/api/analysis-views/${viewBody.analysisView.id}/chart-proposal`, {
    method: "POST",
    body: {},
  });
  const chartBody = await chartResponse.json();
  assert.equal(chartResponse.status, 201, JSON.stringify(chartBody));
  assert.equal(chartBody.chartProposalSet.payload.origin, "analysis_view");
  assert.equal(chartBody.chartProposalSet.payload.analysisViewId, viewBody.analysisView.id);
  const proposal = chartBody.chartProposalSet.payload.proposals[0];
  assert.equal(proposal.origin, "analysis_view");
  assert.equal(proposal.analysisViewId, viewBody.analysisView.id);
  assert.equal(proposal.series.length, 2);
  assert.equal(proposal.selectedExperimentIds.includes(exp30.experimentId), true);
  assert.equal(proposal.selectedExperimentIds.includes(exp31.experimentId), true);
  assert.equal(proposal.x.sourceIds.length > 0, true);
  assert.equal(proposal.y.sourceIds.length > 0, true);
  assert.equal(proposal.groupBy.sourceIds.includes(exp30.experimentId), true);
  assert.equal(proposal.groupBy.sourceIds.includes(exp31.experimentId), true);
});

test("supplemental import batch processes multiple workbooks to review and streams status", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const ownerCookie = cookie;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Batch Supplemental Project" },
  })).json();

  const master = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp30", 250, 14, 0.28],
    ["Exp31", 260, 10, 0.44],
  ]), "MasterTable.xlsx");
  const masterApply = await normalizeAndApplyImportRun(master.importRun);
  const parentCommitId = masterApply.apply.datasetCommit.id;

  const firstUpload = await uploadProjectFile(
    project.project.id,
    fixtureBlob(createReactionRateSupplementWorkbook()),
    "Reaction_Rate_Exp30.xlsx",
  );
  assert.equal(firstUpload.response.status, 201);
  const secondUpload = await uploadProjectFile(
    project.project.id,
    makeReactionRateWorkbookBlob([[0, 0], [15, 3.1]]),
    "Reaction_Rate_Exp31.xlsx",
  );
  assert.equal(secondUpload.response.status, 201);
  const badUpload = await uploadProjectFile(
    project.project.id,
    new Blob([], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "Reaction_Rate_ExpBad.xlsx",
  );
  assert.equal(badUpload.response.status, 201);

  const createBatch = await jsonFetch(`/api/projects/${project.project.id}/supplemental-import-batches`, {
    method: "POST",
    body: {
      fileObjectIds: [
        firstUpload.body.fileObject.id,
        secondUpload.body.fileObject.id,
        badUpload.body.fileObject.id,
      ],
    },
  });
  assert.equal(createBatch.status, 201);
  const batchBody = await createBatch.json();
  assert.equal(batchBody.batch.items.length, 3);

  const ssePromise = readSupplementalBatchSse(project.project.id, batchBody.batch.id);
  const completed = await waitForSupplementalBatch(project.project.id, batchBody.batch.id, (batch) => batch.summary.completed === 3);
  assert.equal(completed.summary.ready, 2);
  assert.equal(completed.summary.failed, 1);
  assert.equal(completed.items.filter((item) => item.status === "ready_for_review").every((item) => item.importRunId), true);
  assert.equal(completed.items.some((item) => item.status === "failed" && item.error?.message), true);
  const readyItem = completed.items.find((item) => item.status === "ready_for_review");
  assert.equal(readyItem.relationshipPreview.schemaVersion, "labrat.importRelationshipPreview.v1");
  assert.equal(readyItem.relationshipPreview.proposals.some((proposal) => proposal.proposedRelationship === "supplement"), true);

  const sseText = await ssePromise;
  assert.match(sseText, /event: snapshot/);
  assert.match(sseText, /event: complete|event: item_ready/);

  const state = await (await jsonFetch(`/api/projects/${project.project.id}/state`)).json();
  assert.equal(state.supplementalImportBatches.some((batch) => batch.id === completed.id), true);
  assert.equal(state.importRuns.filter((run) => completed.items.some((item) => item.importRunId === run.id)).length, 3);
  assert.equal(state.currentDatasetCommit.id, parentCommitId);
  assert.equal(state.currentDatasetCommit.datasetPayload.genericImports.length, 1);

  const username = `batch_viewer_${Date.now()}`;
  const createUser = await jsonFetch("/api/admin/users", {
    method: "POST",
    body: {
      username,
      displayName: "Batch Viewer User",
      temporaryPassword: "ViewerPass123!",
      labId,
      role: "viewer",
    },
  });
  assert.equal(createUser.status, 201);
  const viewerLogin = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: { username, password: "ViewerPass123!" },
  });
  assert.equal(viewerLogin.status, 200);
  cookie = cookieFrom(viewerLogin);
  const viewerStatus = await jsonFetch(`/api/projects/${project.project.id}/supplemental-import-batches/${completed.id}`);
  assert.equal(viewerStatus.status, 403);
  cookie = ownerCookie;
});

realSupplementFixtureTest("real workbook fixtures link Exp33-35 supplements and chart from their own source ids", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Real Supplement Fixture Project" },
  })).json();

  const master = await uploadAndCreateImportRun(
    project.project.id,
    workbookFixtureBlob("MasterTable_updated.xlsx"),
    "MasterTable_updated.xlsx",
  );
  const masterApply = await normalizeAndApplyImportRun(master.importRun);
  const masterImport = masterApply.apply.datasetCommit.datasetPayload.genericImports[0];
  assert.equal(masterImport.experiments.length, 61);

  const expected = [
    { exp: "Exp33", fileName: "Reaction_Rate_Exp33.xlsx", observationCount: 36, pointCount: 35 },
    { exp: "Exp34", fileName: "Reaction_Rate_Exp34.xlsx", observationCount: 65, pointCount: 63 },
    { exp: "Exp35", fileName: "Reaction_Rate_Exp35.xlsx", observationCount: 61, pointCount: 60 },
  ];
  const linkedImportsByExp = new Map();

  for (const fixture of expected) {
    const targetExperiment = masterImport.experiments.find((experiment) => experiment.label === fixture.exp);
    assert.ok(targetExperiment?.experimentId);

    const supplement = await uploadAndCreateImportRun(
      project.project.id,
      workbookFixtureBlob(fixture.fileName),
      fixture.fileName,
    );
    const normalizePreview = await normalizeImportRun(supplement.importRun);
    const supplementImport = normalizePreview.importRun.normalizePreview.datasetPatch.genericImports[0];
    assert.equal(supplementImport.observationSets.length, 1);
    assert.equal(supplementImport.observationSets[0].inferredExperimentLabel, fixture.exp);
    assert.equal(supplementImport.observationSets[0].summary.observationCount, fixture.observationCount);

    const relationshipPreview = await (await jsonFetch(`/api/import-runs/${supplement.importRun.id}/relationship-preview`, {
      method: "POST",
      body: {},
    })).json();
    const relationship = relationshipPreview.proposals[0];
    assert.equal(relationship.proposedRelationship, "supplement");
    assert.equal(relationship.supplementType, "reaction_rate_time_series");
    assert.equal(relationship.targetExperimentIds.includes(targetExperiment.experimentId), true);

    const supplementApply = await jsonFetch(`/api/import-runs/${supplement.importRun.id}/apply`, {
      method: "POST",
      body: {
        applyMode: "supplement_import",
        relationshipDecision: relationship,
        reviewNote: `Attach real ${fixture.exp} reaction-rate workbook.`,
      },
    });
    assert.equal(supplementApply.status, 200);
    const supplementCommit = (await supplementApply.json()).datasetCommit;
    const linkedImport = supplementCommit.datasetPayload.genericImports.find((item) => item.fileName === fixture.fileName);
    assert.ok(linkedImport?.importId);
    linkedImportsByExp.set(fixture.exp, linkedImport);

    const chartResponse = await jsonFetch(`/api/projects/${project.project.id}/charts/interpret`, {
      method: "POST",
      body: {
        prompt: `plot adjusted rate vs reaction time for ${fixture.exp} with log base 10 y-axis and no connecting lines`,
        selectedImportIds: [linkedImport.importId],
        persistAsProposal: false,
      },
    });
    assert.equal(chartResponse.status, 200);
    const chartBody = await chartResponse.json();
    const draft = chartBody.chartSpecDraft;
    assert.equal(chartBody.clarification, null);
    assert.equal(draft.x.label, "Reaction Time (min)");
    assert.equal(draft.y.label, "Adjusted Rate (M/s)");
    assert.equal(draft.axisOptions.y.scale, "log10");
    assert.equal(draft.renderStyle.traceMode, "markers");
    assert.deepEqual(draft.sourceImportIds, [linkedImport.importId]);
    assert.equal(draft.x.sourceIds.length, fixture.pointCount);
    assert.equal(draft.y.sourceIds.length, fixture.pointCount);
    assert.equal(draft.x.sourceIds.every((sourceId) => sourceId.startsWith(linkedImport.importId)), true);
    assert.equal(draft.y.sourceIds.every((sourceId) => sourceId.startsWith(linkedImport.importId)), true);
  }

  const exp35Import = linkedImportsByExp.get("Exp35");
  const unscopedChartResponse = await jsonFetch(`/api/projects/${project.project.id}/charts/interpret`, {
    method: "POST",
    body: {
      prompt: "plot adjusted rate vs reaction time for Exp35",
      persistAsProposal: false,
    },
  });
  assert.equal(unscopedChartResponse.status, 200);
  const unscopedChartBody = await unscopedChartResponse.json();
  assert.equal(unscopedChartBody.clarification, null);
  assert.deepEqual(unscopedChartBody.chartSpecDraft.sourceImportIds, [exp35Import.importId]);
  assert.equal(unscopedChartBody.chartSpecDraft.x.sourceIds.every((sourceId) => sourceId.startsWith(exp35Import.importId)), true);
  assert.equal(unscopedChartBody.chartSpecDraft.y.sourceIds.every((sourceId) => sourceId.startsWith(exp35Import.importId)), true);

  const missingExperimentResponse = await jsonFetch(`/api/projects/${project.project.id}/charts/interpret`, {
    method: "POST",
    body: {
      prompt: "plot adjusted rate vs reaction time for Exp999",
      persistAsProposal: false,
    },
  });
  assert.equal(missingExperimentResponse.status, 200);
  const missingExperimentBody = await missingExperimentResponse.json();
  assert.equal(missingExperimentBody.chartSpecDraft, null);
  assert.match(missingExperimentBody.clarification.message, /No imported data matched the requested experiment exp999/);
});

test("refresh rejects no-op replacement, missing target, stale parent, and repeated apply", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Refresh Rejection Project" },
  })).json();

  const workbook = makeWorkbookBlob([
    ["Exp1", 250, 5, 0.35],
  ]);
  const original = await uploadAndCreateImportRun(project.project.id, workbook, "refresh-noop-original.xlsx");
  const originalApply = await normalizeAndApplyImportRun(original.importRun);
  const parentCommit = originalApply.apply.datasetCommit;
  const targetImportId = parentCommit.datasetPayload.genericImports[0].importId;

  const noChange = await uploadAndCreateImportRun(project.project.id, workbook, "refresh-noop-copy.xlsx");
  await normalizeImportRun(noChange.importRun);
  const noChangePreview = await jsonFetch(`/api/import-runs/${noChange.importRun.id}/refresh-preview`, {
    method: "POST",
    body: {
      replaceImportId: targetImportId,
      expectedParentDatasetCommitId: parentCommit.id,
    },
  });
  assert.equal(noChangePreview.status, 200);
  assert.equal((await noChangePreview.json()).hasChanges, false);
  const noChangeApply = await jsonFetch(`/api/import-runs/${noChange.importRun.id}/apply`, {
    method: "POST",
    body: {
      applyMode: "replace_import",
      replaceImportId: targetImportId,
      expectedParentDatasetCommitId: parentCommit.id,
    },
  });
  assert.equal(noChangeApply.status, 409);
  assert.equal((await noChangeApply.json()).error.code, "refresh_no_changes_detected");

  const missingTarget = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp1", 250, 5, 0.8],
  ]), "refresh-missing-target.xlsx");
  await normalizeImportRun(missingTarget.importRun);
  const missingTargetApply = await jsonFetch(`/api/import-runs/${missingTarget.importRun.id}/apply`, {
    method: "POST",
    body: {
      applyMode: "replace_import",
      replaceImportId: "import_missing",
      expectedParentDatasetCommitId: parentCommit.id,
    },
  });
  assert.equal(missingTargetApply.status, 404);
  assert.equal((await missingTargetApply.json()).error.code, "refresh_target_not_found");

  const supplement = await uploadAndCreateImportRun(project.project.id, makeReactionRateWorkbookBlob(), "Reaction_Rate_Exp1.xlsx");
  await normalizeImportRun(supplement.importRun);
  const supplementRelationship = await (await jsonFetch(`/api/import-runs/${supplement.importRun.id}/relationship-preview`, {
    method: "POST",
    body: {},
  })).json();
  const supplementProposal = supplementRelationship.proposals[0];
  const supplementApply = await jsonFetch(`/api/import-runs/${supplement.importRun.id}/apply`, {
    method: "POST",
    body: {
      applyMode: "supplement_import",
      relationshipDecision: supplementProposal,
    },
  });
  assert.equal(supplementApply.status, 200);
  const stale = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp1", 250, 5, 0.9],
  ]), "refresh-stale-replacement.xlsx");
  await normalizeImportRun(stale.importRun);
  const staleApply = await jsonFetch(`/api/import-runs/${stale.importRun.id}/apply`, {
    method: "POST",
    body: {
      applyMode: "replace_import",
      replaceImportId: targetImportId,
      expectedParentDatasetCommitId: parentCommit.id,
    },
  });
  assert.equal(staleApply.status, 409);
  assert.equal((await staleApply.json()).error.code, "dataset_commit_conflict");

  const state = await (await jsonFetch(`/api/projects/${project.project.id}/state`)).json();
  assert.equal(state.currentDatasetCommit.datasetPayload.genericImports.length, 2);
});

test("second master append and repeated apply are rejected", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Duplicate Import Project" },
  })).json();
  const workbook = makeWorkbookBlob();
  const first = await uploadAndCreateImportRun(project.project.id, workbook, "same-a.xlsx");
  const firstApply = await normalizeAndApplyImportRun(first.importRun);

  const repeatApply = await jsonFetch(`/api/import-runs/${first.importRun.id}/apply`, {
    method: "POST",
    body: {},
  });
  assert.equal(repeatApply.status, 409);
  assert.equal((await repeatApply.json()).error.code, "import_run_already_applied");

  const duplicate = await uploadAndCreateImportRun(project.project.id, workbook, "same-b.xlsx");
  const duplicatePreview = await jsonFetch(`/api/import-runs/${duplicate.importRun.id}/normalize-preview`, {
    method: "POST",
    body: { approvedBlockIds: [duplicate.importRun.scanResult.sheets[0].blocks[0].blockId] },
  });
  assert.equal(duplicatePreview.status, 200);
  const duplicateApply = await jsonFetch(`/api/import-runs/${duplicate.importRun.id}/apply`, {
    method: "POST",
    body: {},
  });
  assert.equal(duplicateApply.status, 409);
  assert.equal((await duplicateApply.json()).error.code, "master_table_already_exists");

  const state = await (await jsonFetch(`/api/projects/${project.project.id}/state`)).json();
  assert.equal(state.datasetCommits.length, 1);
  assert.equal(state.currentDatasetCommit.id, firstApply.apply.datasetCommit.id);
});

test("import run lifecycle rejects invalid normalize and apply transitions", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Import Lifecycle Project" },
  })).json();

  const pending = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp5", 260, 4, 0.12],
  ]), "pending.xlsx");
  const earlyApply = await jsonFetch(`/api/import-runs/${pending.importRun.id}/apply`, {
    method: "POST",
    body: {},
  });
  assert.equal(earlyApply.status, 409);
  assert.equal((await earlyApply.json()).error.code, "invalid_import_run_transition");

  await store.updateImportRun(pending.importRun.id, { status: "rejected" });
  const rejectedPreview = await jsonFetch(`/api/import-runs/${pending.importRun.id}/normalize-preview`, {
    method: "POST",
    body: { approvedBlockIds: [pending.importRun.scanResult.sheets[0].blocks[0].blockId] },
  });
  assert.equal(rejectedPreview.status, 409);
  assert.equal((await rejectedPreview.json()).error.code, "invalid_import_run_transition");

  const applied = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp6", 265, 5, 0.22],
  ]), "applied.xlsx");
  await normalizeAndApplyImportRun(applied.importRun);
  const normalizeAgain = await jsonFetch(`/api/import-runs/${applied.importRun.id}/normalize-preview`, {
    method: "POST",
    body: { approvedBlockIds: [applied.importRun.scanResult.sheets[0].blocks[0].blockId] },
  });
  assert.equal(normalizeAgain.status, 409);
  assert.equal((await normalizeAgain.json()).error.code, "invalid_import_run_transition");

  const failed = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp7", 280, 7, 0.44],
  ]), "failed.xlsx");
  await store.updateImportRun(failed.importRun.id, { status: "failed" });
  const failedApply = await jsonFetch(`/api/import-runs/${failed.importRun.id}/apply`, {
    method: "POST",
    body: {},
  });
  assert.equal(failedApply.status, 409);
  assert.equal((await failedApply.json()).error.code, "invalid_import_run_transition");
});

test("mapping sets and chart proposal sets persist review decisions", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Review State Project" },
  })).json();

  const mappingCreate = await jsonFetch(`/api/projects/${project.project.id}/mapping-sets`, {
    method: "POST",
    body: {
      schemaVersion: "labrat.semanticMappingResponse.v1",
      status: "proposed",
      payload: { mappings: [{ mappingId: "map_1", sourceFieldId: "field_temperature" }] },
      decisionSummary: { accepted: 0, rejected: 0 },
    },
  });
  assert.equal(mappingCreate.status, 201);
  const mappingBody = await mappingCreate.json();
  assert.match(mappingBody.mappingSet.id, /^mapping_set_/);

  const mappingPatch = await jsonFetch(`/api/mapping-sets/${mappingBody.mappingSet.id}`, {
    method: "PATCH",
    body: {
      status: "accepted",
      payload: {
        mappings: [{
          mappingId: "map_1",
          sourceFieldId: "field_temperature",
          canonicalField: "temperature_C",
          semanticRole: "condition",
          valueType: "numeric",
          unit: "C",
          status: "accepted",
        }],
      },
      decisionSummary: { accepted: 1, rejected: 0, proposed: 0 },
    },
  });
  assert.equal(mappingPatch.status, 200);
  const mappingPatchBody = await mappingPatch.json();
  assert.equal(mappingPatchBody.mappingSet.status, "accepted");
  assert.equal(mappingPatchBody.mappingSet.decisionSummary.accepted, 1);
  assert.equal(mappingPatchBody.mappingSet.payload.mappings[0].canonicalField, "temperature_C");

  const chartCreate = await jsonFetch(`/api/projects/${project.project.id}/chart-proposal-sets`, {
    method: "POST",
    body: {
      mappingSetId: mappingBody.mappingSet.id,
      schemaVersion: "labrat.chartProposalSet.v1",
      payload: { proposals: [{ proposalId: "chart_1", chartType: "scatter", title: "Gas vs Temp" }] },
      decisionSummary: { accepted: 0, rejected: 0 },
    },
  });
  assert.equal(chartCreate.status, 201);
  const chartBody = await chartCreate.json();
  assert.match(chartBody.chartProposalSet.id, /^chart_proposal_set_/);

  const chartPatch = await jsonFetch(`/api/chart-proposal-sets/${chartBody.chartProposalSet.id}`, {
    method: "PATCH",
    body: {
      status: "accepted",
      decisionSummary: { accepted: 1, rejected: 0 },
    },
  });
  assert.equal(chartPatch.status, 200);
  const chartPatchBody = await chartPatch.json();
  assert.equal(chartPatchBody.chartProposalSet.status, "accepted");

  const state = await (await jsonFetch(`/api/projects/${project.project.id}/state`)).json();
  assert.equal(state.mappingSets.some((set) => set.id === mappingBody.mappingSet.id && set.status === "accepted"), true);
  const stateMappingSet = state.mappingSets.find((set) => set.id === mappingBody.mappingSet.id);
  assert.equal(stateMappingSet.payload.mappings[0].canonicalField, "temperature_C");
  assert.equal(stateMappingSet.payload.mappings[0].status, "accepted");
  assert.equal(stateMappingSet.decisionSummary.accepted, 1);
  assert.equal(state.chartProposalSets.some((set) => set.id === chartBody.chartProposalSet.id && set.status === "accepted"), true);

  const auditEvents = await store.listAuditEvents({ projectId: project.project.id });
  assert.equal(auditEvents.some((event) => event.action === "mapping_set.create"), true);
  assert.equal(auditEvents.some((event) => event.action === "mapping_set.update_decision"), true);
  assert.equal(auditEvents.some((event) => event.action === "chart_proposal_set.create"), true);
  assert.equal(auditEvents.some((event) => event.action === "chart_proposal_set.update_decision"), true);
});

test("profile-only route updates project profile and preserves metadata", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const created = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: {
      labId,
      name: "Profile Only Project",
      metadata: { source: "keep-me" },
      projectProfile: { researchGoal: "Initial goal", methods: "Initial method" },
    },
  })).json();

  const patch = await jsonFetch(`/api/projects/${created.project.id}/profile`, {
    method: "PATCH",
    body: {
      researchGoal: "Updated project-scoped goal",
      materials: "Ru/TiO2 and HDPE",
      tags: ["profile", "ai-context"],
    },
  });
  assert.equal(patch.status, 200);
  const body = await patch.json();
  assert.equal(body.project.metadata.source, "keep-me");
  assert.equal(body.projectProfile.researchGoal, "Updated project-scoped goal");
  assert.equal(body.projectProfile.methods, "Initial method");
  assert.deepEqual(body.projectProfile.tags, ["profile", "ai-context"]);
});

test("project AI context summarizes fields, mappings, prior decisions, and charts", async () => {
  const { project } = await createProjectWithAppliedImport("AI Context Project");
  const initialContext = await jsonFetch(`/api/projects/${project.id}/ai/context`, {
    method: "POST",
    body: {},
  });
  assert.equal(initialContext.status, 200);
  const initialBody = await initialContext.json();
  assert.equal(initialBody.schemaVersion, "labrat.projectAiContext.v1");
  assert.equal(initialBody.project.id, project.id);
  assert.equal(initialBody.fieldInventory.some((field) => /selectivity gas/i.test(field.displayName)), true);
  const gasField = initialBody.fieldInventory.find((field) => /selectivity gas/i.test(field.displayName));
  const temperatureField = initialBody.fieldInventory.find((field) => /temperature/i.test(field.displayName));
  assert.ok(gasField.sourceIds.length);
  assert.ok(temperatureField.sourceIds.length);

  const mappingCreate = await jsonFetch(`/api/projects/${project.id}/mapping-sets`, {
    method: "POST",
    body: {
      status: "accepted",
      payload: {
        mappings: [{
          mappingId: "map_gas_selectivity",
          status: "accepted",
          sourceIds: gasField.sourceIds,
          canonicalField: "selectivity_gas",
          semanticRole: "response",
          targetKind: "measurement",
        }],
      },
      decisionSummary: { accepted: 1, rejected: 0 },
    },
  });
  assert.equal(mappingCreate.status, 201);

  const proposalCreate = await jsonFetch(`/api/projects/${project.id}/chart-proposal-sets`, {
    method: "POST",
    body: {
      payload: {
        proposals: [{
          proposalId: "chart_keep",
          status: "accepted",
          chartType: "scatter",
          title: "Keep this chart",
          x: {
            fieldId: temperatureField.fieldId,
            field: temperatureField.field,
            label: temperatureField.displayName,
            unit: temperatureField.unit,
            sourceIds: temperatureField.sourceIds,
          },
          y: {
            fieldId: gasField.fieldId,
            field: gasField.field,
            label: gasField.displayName,
            unit: gasField.unit,
            sourceIds: gasField.sourceIds,
          },
          sourceRefs: [...temperatureField.sourceRefs, ...gasField.sourceRefs],
        }],
      },
      decisionSummary: {
        acceptedProposalIds: ["chart_keep"],
      },
    },
  });
  assert.equal(proposalCreate.status, 201);

  const chartSpec = await jsonFetch(`/api/projects/${project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      proposalId: "chart_keep",
      chartProposalSetId: (await proposalCreate.json()).chartProposalSet.id,
    },
  });
  assert.equal(chartSpec.status, 201);

  const contextResponse = await jsonFetch(`/api/projects/${project.id}/ai/context`, {
    method: "POST",
    body: {},
  });
  assert.equal(contextResponse.status, 200);
  const contextBody = await contextResponse.json();
  assert.equal(contextBody.acceptedMappings.some((mapping) => mapping.mappingId === "map_gas_selectivity"), true);
  assert.equal(contextBody.priorChartDecisions.some((decision) => decision.proposalId === "chart_keep" && decision.status === "accepted"), true);
  assert.equal(contextBody.existingCharts.some((chart) => chart.sourceProposalId === "chart_keep"), true);
  assert.equal(contextBody.serviceInput, undefined);
});

test("project agent plan returns deterministic upload, supplement, chart, and query actions", async () => {
  const { project } = await createProjectWithAppliedImport("Agent Plan Project");

  const master = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "upload master table" },
  });
  assert.equal(master.status, 200);
  const masterBody = await master.json();
  assert.equal(masterBody.schemaVersion, "labrat.agentPlan.v1");
  assert.equal(masterBody.actions[0].type, "upload_master_table");
  assert.equal(masterBody.actions[0].requiresFile, true);
  assert.equal(masterBody.actions[0].status, "requires_confirmation");
  assert.equal(masterBody.contextSummary.hasCurrentDatasetCommit, true);
  assert.equal(JSON.stringify(masterBody).includes("cellGrid"), false);

  const supplement = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "upload supplement reaction rate for Exp30" },
  });
  assert.equal(supplement.status, 200);
  const supplementBody = await supplement.json();
  assert.equal(supplementBody.actions[0].type, "upload_supplement");
  assert.deepEqual(supplementBody.actions[0].params.targetExperimentAliases, ["Exp30"]);

  const chart = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "plot gas selectivity vs temperature" },
  });
  assert.equal(chart.status, 200);
  const chartBody = await chart.json();
  assert.equal(chartBody.actions[0].type, "interpret_chart");
  assert.equal(chartBody.actions[0].params.prompt, "gas selectivity vs temperature");

  const query = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "show Exp1 data as a table" },
  });
  assert.equal(query.status, 200);
  const queryBody = await query.json();
  assert.equal(queryBody.actions[0].type, "resolve_data_query");
  assert.equal(queryBody.actions[0].requiresReview, false);
});

test("project agent plan can target an accepted chart proposal for chart spec creation", async () => {
  const { project } = await createProjectWithAppliedImport("Agent ChartSpec Plan Project");
  const proposalCreate = await jsonFetch(`/api/projects/${project.id}/chart-proposal-sets`, {
    method: "POST",
    body: {
      payload: {
        proposals: [{
          proposalId: "chart_agent_keep",
          status: "accepted",
          chartType: "scatter",
          title: "Accepted agent chart",
        }],
      },
      decisionSummary: { acceptedProposalIds: ["chart_agent_keep"] },
    },
  });
  assert.equal(proposalCreate.status, 201);
  const proposalBody = await proposalCreate.json();

  const response = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "create chart spec from accepted proposal" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.actions[0].type, "create_chart_spec_from_proposal");
  assert.equal(body.actions[0].params.chartProposalSetId, proposalBody.chartProposalSet.id);
  assert.equal(body.actions[0].params.proposalId, "chart_agent_keep");
});

test("project agent plan requires auth and project access", async () => {
  const ownerCookie = cookie;
  const { project } = await createProjectWithAppliedImport("Agent Auth Project");
  cookie = "";
  const unauth = await jsonFetch(`/api/projects/${project.id}/agent/plan`, {
    method: "POST",
    body: { message: "upload master table" },
  });
  assert.equal(unauth.status, 401);

  const adminLogin = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "LabRatAdmin123!" },
  });
  assert.equal(adminLogin.status, 200);
  cookie = cookieFrom(adminLogin);
  const slug = `agent-other-lab-${Date.now()}`;
  const otherLab = await (await jsonFetch("/api/admin/labs", {
    method: "POST",
    body: { name: "Agent Other Lab", slug },
  })).json();
  const otherProject = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId: otherLab.lab.id, name: "Agent Other Project" },
  })).json();

  cookie = ownerCookie;
  const crossLab = await jsonFetch(`/api/projects/${otherProject.project.id}/agent/plan`, {
    method: "POST",
    body: { message: "show data" },
  });
  assert.equal(crossLab.status, 403);
});

test("project chart interpret previews by default and can persist interpreted proposals", async () => {
  const { project } = await createProjectWithAppliedImport("Project Chart Interpret Project");

  const preview = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: { prompt: "plot gas selectivity vs temperature grouped by label" },
  });
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.schemaVersion, "labrat.chartInterpretResponse.v1");
  assert.equal(previewBody.chartSpecDraft.y.label, "Selectivity Gas (%)");
  assert.equal(previewBody.chartProposalSet, undefined);

  const listAfterPreview = await (await jsonFetch(`/api/projects/${project.id}/chart-proposal-sets`)).json();
  const beforeCount = listAfterPreview.chartProposalSets.length;

  const persisted = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: {
      prompt: "plot gas selectivity vs temperature with hollow markers, no connecting lines, and log base 10 y-axis",
      persistAsProposal: true,
    },
  });
  assert.equal(persisted.status, 200);
  const persistedBody = await persisted.json();
  assert.match(persistedBody.chartProposalSet.id, /^chart_proposal_set_/);
  const proposal = persistedBody.chartProposalSet.payload.proposals[0];
  assert.equal(proposal.axisOptions.y.scale, "log10");
  assert.equal(proposal.renderStyle.traceMode, "markers");
  assert.equal(proposal.renderStyle.traces[0].marker.symbol, "circle-open");
  assert.equal(proposal.chartSpecDraft.renderStyle.traceMode, "markers");
  const listAfterPersist = await (await jsonFetch(`/api/projects/${project.id}/chart-proposal-sets`)).json();
  assert.equal(listAfterPersist.chartProposalSets.length, beforeCount + 1);
});

test("project chart interpret returns clarification for ambiguous prompts", async () => {
  const { project } = await createProjectWithAppliedImport("Ambiguous Chart Project");
  const response = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: { prompt: "plot something interesting" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.chartSpecDraft, null);
  assert.equal(Boolean(body.clarification?.message), true);
});

test("project chart propose persists deterministic proposal sets", async () => {
  const { project } = await createProjectWithAppliedImport("Project Chart Propose Project");
  const profile = await jsonFetch(`/api/projects/${project.id}/profile`, {
    method: "PATCH",
    body: {
      researchGoal: "Optimize gas selectivity across reaction conditions.",
      experimentBackground: "Catalyst screening focused on selectivity trends.",
      tags: ["gas selectivity", "temperature"],
    },
  });
  assert.equal(profile.status, 200);
  const response = await jsonFetch(`/api/projects/${project.id}/charts/propose`, {
    method: "POST",
    body: { userGoal: "Find useful selectivity charts" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.chartProposalSet.id, /^chart_proposal_set_/);
  assert.equal(body.proposalSet.proposals.length > 0, true);
  assert.equal(body.proposalSet.proposals[0].origin, "deterministic_recipe");
  assert.equal(typeof body.proposalSet.proposals[0].score, "number");
  assert.equal(Boolean(body.proposalSet.proposals[0].scoreBreakdown?.goalFit), true);
  assert.equal(Boolean(body.proposalSet.proposals[0].insight), true);
  const list = await (await jsonFetch(`/api/projects/${project.id}/chart-proposal-sets`)).json();
  assert.equal(list.chartProposalSets.some((set) => set.id === body.chartProposalSet.id), true);
});

test("project chart propose can persist grouped selectivity ChartSpec v1", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const createdProject = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Complex Selectivity Chart Project" },
  })).json();
  const created = await uploadAndCreateImportRun(createdProject.project.id, makeSelectivityWorkbookBlob(), "selectivity.xlsx");
  await normalizeAndApplyImportRun(created.importRun);

  const response = await jsonFetch(`/api/projects/${createdProject.project.id}/charts/propose`, {
    method: "POST",
    body: { userGoal: "Recommend gas liquid solid selectivity charts" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const grouped = body.proposalSet.proposals.find((proposal) => proposal.chartType === "grouped_bar");
  const stacked = body.proposalSet.proposals.find((proposal) => proposal.chartType === "stacked_bar");
  assert.ok(grouped);
  assert.ok(stacked);
  assert.equal(grouped.yFields.length, 3);

  const chartSpec = await jsonFetch(`/api/projects/${createdProject.project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      chartProposalSetId: body.chartProposalSet.id,
      proposalId: grouped.proposalId,
    },
  });
  assert.equal(chartSpec.status, 201);
  const chartSpecBody = await chartSpec.json();
  assert.equal(chartSpecBody.chartSpec.chartType, "grouped_bar");
  assert.equal(chartSpecBody.chartSpec.spec.schemaVersion, "labrat.chartSpec.v1.3");
  assert.equal(chartSpecBody.chartSpec.spec.yFields.length, 3);
});

test("project chart routes require a current dataset commit", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "No Commit Chart Project" },
  })).json();
  const interpret = await jsonFetch(`/api/projects/${project.project.id}/charts/interpret`, {
    method: "POST",
    body: { prompt: "plot gas selectivity vs temperature" },
  });
  assert.equal(interpret.status, 409);
  const interpretBody = await interpret.json();
  assert.equal(interpretBody.error.code, "dataset_commit_required");

  const propose = await jsonFetch(`/api/projects/${project.project.id}/charts/propose`, {
    method: "POST",
    body: { userGoal: "Find charts" },
  });
  assert.equal(propose.status, 409);
});

test("viewer can read AI context but cannot persist chart proposals", async () => {
  const ownerCookie = cookie;
  const { project } = await createProjectWithAppliedImport("Viewer AI Context Project");
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const username = `viewer_ai_${Date.now()}`;
  const createUser = await jsonFetch("/api/admin/users", {
    method: "POST",
    body: {
      username,
      displayName: "Viewer AI User",
      temporaryPassword: "ViewerAiPass123!",
      labId,
      role: "viewer",
    },
  });
  assert.equal(createUser.status, 201);
  const login = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: { username, password: "ViewerAiPass123!" },
  });
  assert.equal(login.status, 200);
  cookie = cookieFrom(login);

  const contextResponse = await jsonFetch(`/api/projects/${project.id}/ai/context`, {
    method: "POST",
    body: {},
  });
  assert.equal(contextResponse.status, 200);

  const preview = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: { prompt: "plot gas selectivity vs temperature" },
  });
  assert.equal(preview.status, 200);

  const persist = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: { prompt: "plot gas selectivity vs temperature", persistAsProposal: true },
  });
  assert.equal(persist.status, 403);

  const propose = await jsonFetch(`/api/projects/${project.id}/charts/propose`, {
    method: "POST",
    body: { userGoal: "Find charts" },
  });
  assert.equal(propose.status, 403);
  cookie = ownerCookie;
});

test("project AI context does not mix records across projects", async () => {
  const first = await createProjectWithAppliedImport("First AI Isolation Project");
  const second = await createProjectWithAppliedImport("Second AI Isolation Project");

  const firstContext = await (await jsonFetch(`/api/projects/${first.project.id}/ai/context`, {
    method: "POST",
    body: {},
  })).json();
  const secondContext = await (await jsonFetch(`/api/projects/${second.project.id}/ai/context`, {
    method: "POST",
    body: {},
  })).json();
  assert.equal(firstContext.sourceImportIds.length, 1);
  assert.equal(secondContext.sourceImportIds.length, 1);
  assert.equal(firstContext.project.id, first.project.id);
  assert.equal(secondContext.project.id, second.project.id);
  assert.deepEqual(firstContext.existingCharts, []);
  assert.deepEqual(secondContext.existingCharts, []);
});

test("accepted chart proposal can become a durable chart spec", async () => {
  const { project } = await createProjectWithAppliedImport("Chart Spec Project");
  const interpreted = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: {
      prompt: "plot gas selectivity vs temperature",
      persistAsProposal: true,
    },
  });
  assert.equal(interpreted.status, 200);
  const interpretedBody = await interpreted.json();
  const proposal = interpretedBody.chartProposalSet.payload.proposals[0];

  const response = await jsonFetch(`/api/projects/${project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      proposalId: proposal.proposalId,
      chartProposalSetId: interpretedBody.chartProposalSet.id,
      layout: { showlegend: true },
    },
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.chartSpec.id, /^chart_spec_/);
  assert.equal(body.chartSpec.sourceProposalId, proposal.proposalId);
  assert.equal(body.chartSpec.datasetCommitId, interpretedBody.chartProposalSet.datasetCommitId);
  assert.match(body.chartSpec.title, /Selectivity Gas/i);
  assert.equal(body.chartSpec.spec.schemaVersion, "labrat.chartSpec.v1.3");

  const list = await jsonFetch(`/api/projects/${project.id}/chart-specs`);
  const listBody = await list.json();
  assert.equal(listBody.chartSpecs.some((chartSpec) => chartSpec.id === body.chartSpec.id), true);
  assert.equal(listBody.chartSpecs.find((chartSpec) => chartSpec.id === body.chartSpec.id).status, "active");
  assert.equal(listBody.chartSpecs.find((chartSpec) => chartSpec.id === body.chartSpec.id).isStale, false);

  const legacyNestedStyle = await jsonFetch(`/api/projects/${project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      proposalId: "legacy_nested_style",
      proposal: {
        proposalId: "legacy_nested_style",
        chartType: proposal.chartType,
        title: proposal.title,
        x: proposal.x,
        y: proposal.y,
        chartSpecDraft: {
          ...proposal,
          axisOptions: { y: { scale: "log10" } },
          renderStyle: {
            traceMode: "markers",
            traces: [{ target: "primary", marker: { symbol: "circle-open" } }],
          },
        },
      },
    },
  });
  assert.equal(legacyNestedStyle.status, 201);
  const legacyNestedStyleBody = await legacyNestedStyle.json();
  assert.equal(legacyNestedStyleBody.chartSpec.spec.axisOptions.y.scale, "log10");
  assert.equal(legacyNestedStyleBody.chartSpec.spec.renderStyle.traceMode, "markers");
  assert.equal(legacyNestedStyleBody.chartSpec.spec.renderStyle.traces[0].marker.symbol, "circle-open");
});

test("chart specs from replaced dataset commits are marked stale and excluded from AI context", async () => {
  const { project, apply } = await createProjectWithAppliedImport("Stale Chart Spec Project");
  const originalCommitId = apply.datasetCommit.id;
  const targetImportId = apply.datasetCommit.datasetPayload.genericImports[0].importId;

  const interpreted = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: {
      prompt: "plot gas selectivity vs temperature",
      persistAsProposal: true,
    },
  });
  assert.equal(interpreted.status, 200);
  const interpretedBody = await interpreted.json();
  const proposal = interpretedBody.chartProposalSet.payload.proposals[0];
  const oldSpecResponse = await jsonFetch(`/api/projects/${project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      proposalId: proposal.proposalId,
      chartProposalSetId: interpretedBody.chartProposalSet.id,
    },
  });
  assert.equal(oldSpecResponse.status, 201);
  const oldSpec = (await oldSpecResponse.json()).chartSpec;

  const replacement = await uploadAndCreateImportRun(project.id, makeWorkbookBlob([
    ["Exp1", 250, 5, 0.99],
    ["Exp2", 275, 8, 0.24],
  ]), "stale-chart-refresh.xlsx");
  await normalizeImportRun(replacement.importRun);
  const refreshApply = await jsonFetch(`/api/import-runs/${replacement.importRun.id}/apply`, {
    method: "POST",
    body: {
      applyMode: "replace_import",
      replaceImportId: targetImportId,
      expectedParentDatasetCommitId: originalCommitId,
    },
  });
  assert.equal(refreshApply.status, 200);
  const refreshedCommitId = (await refreshApply.json()).datasetCommit.id;

  const stateAfterRefresh = await (await jsonFetch(`/api/projects/${project.id}/state`)).json();
  const staleSpec = stateAfterRefresh.chartSpecs.find((chartSpec) => chartSpec.id === oldSpec.id);
  assert.equal(staleSpec.datasetCommitId, originalCommitId);
  assert.equal(staleSpec.isStale, true);
  assert.equal(staleSpec.status, "stale");
  assert.equal(staleSpec.staleReason, "dataset_commit_replaced");

  const newInterpreted = await jsonFetch(`/api/projects/${project.id}/charts/interpret`, {
    method: "POST",
    body: {
      prompt: "plot gas selectivity vs temperature",
      persistAsProposal: true,
    },
  });
  assert.equal(newInterpreted.status, 200);
  const newInterpretedBody = await newInterpreted.json();
  const newProposal = newInterpretedBody.chartProposalSet.payload.proposals[0];
  const newSpecResponse = await jsonFetch(`/api/projects/${project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      proposalId: newProposal.proposalId,
      chartProposalSetId: newInterpretedBody.chartProposalSet.id,
    },
  });
  assert.equal(newSpecResponse.status, 201);
  const newSpec = (await newSpecResponse.json()).chartSpec;
  assert.equal(newSpec.datasetCommitId, refreshedCommitId);

  const listBody = await (await jsonFetch(`/api/projects/${project.id}/chart-specs`)).json();
  assert.equal(listBody.chartSpecs.find((chartSpec) => chartSpec.id === oldSpec.id).status, "stale");
  assert.equal(listBody.chartSpecs.find((chartSpec) => chartSpec.id === newSpec.id).status, "active");
  assert.equal(listBody.chartSpecs.find((chartSpec) => chartSpec.id === newSpec.id).isStale, false);

  const contextBody = await (await jsonFetch(`/api/projects/${project.id}/ai/context`, {
    method: "POST",
    body: {},
  })).json();
  assert.equal(contextBody.existingCharts.some((chart) => chart.id === oldSpec.id), false);
  assert.equal(contextBody.existingCharts.some((chart) => chart.id === newSpec.id), true);
});

test("chart specs require current dataset commits and resolvable source fields", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const emptyProject = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Invalid Chart Spec Empty Project" },
  })).json();
  const noCommit = await jsonFetch(`/api/projects/${emptyProject.project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      proposalId: "chart_invalid",
      proposal: {
        proposalId: "chart_invalid",
        chartType: "scatter",
        title: "Invalid",
        x: { label: "Temperature", sourceIds: ["missing_x"] },
        y: { label: "Gas", sourceIds: ["missing_y"] },
      },
    },
  });
  assert.equal(noCommit.status, 409);
  assert.equal((await noCommit.json()).error.code, "dataset_commit_required");

  const { project } = await createProjectWithAppliedImport("Invalid Chart Spec Source Project");
  const badSource = await jsonFetch(`/api/projects/${project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      proposalId: "chart_invalid",
      proposal: {
        proposalId: "chart_invalid",
        chartType: "scatter",
        title: "Invalid unresolved fields",
        x: { label: "Temperature", sourceIds: ["missing_x"] },
        y: { label: "Gas", sourceIds: ["missing_y"] },
      },
    },
  });
  assert.equal(badSource.status, 400);
  assert.equal((await badSource.json()).error.code, "chart_source_unresolved");

  const missingSources = await jsonFetch(`/api/projects/${project.id}/chart-specs/from-proposal`, {
    method: "POST",
    body: {
      proposalId: "chart_missing_sources",
      proposal: {
        proposalId: "chart_missing_sources",
        chartType: "scatter",
        title: "Missing source ids",
        x: { field: "temperature", label: "Temperature" },
        y: { field: "selectivity_gas", label: "Gas" },
      },
    },
  });
  assert.equal(missingSources.status, 400);
  assert.equal((await missingSources.json()).error.code, "invalid_chart_spec");
});

test("manuscripts round trip blocks and pages", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Manuscript Project" },
  })).json();
  const create = await jsonFetch(`/api/projects/${project.project.id}/manuscripts`, {
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
  const createBody = await create.json();
  assert.match(createBody.manuscript.id, /^manuscript_/);
  assert.equal(createBody.manuscript.blocks[0].text, "Hello");

  const patch = await jsonFetch(`/api/manuscripts/${createBody.manuscript.id}`, {
    method: "PATCH",
    body: {
      title: "Updated Group Meeting",
      blocks: [{ id: "block_1", kind: "text", text: "Updated" }],
    },
  });
  assert.equal(patch.status, 200);
  const patchBody = await patch.json();
  assert.equal(patchBody.manuscript.title, "Updated Group Meeting");
  assert.equal(patchBody.manuscript.blocks[0].text, "Updated");
});

test("logout revokes the current session", async () => {
  const logout = await jsonFetch("/api/auth/logout", { method: "POST" });
  assert.equal(logout.status, 200);
  const me = await jsonFetch("/api/auth/me");
  assert.equal(me.status, 401);
});
