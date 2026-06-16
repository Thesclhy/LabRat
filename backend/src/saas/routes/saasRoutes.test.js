import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import * as XLSX from "xlsx";
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

async function uploadAndCreateImportRun(projectId, blob = makeWorkbookBlob(), filename = "MasterTable_updated.xlsx") {
  const form = new FormData();
  form.set("file", blob, filename);
  const upload = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();
  const importRunResponse = await jsonFetch(`/api/projects/${projectId}/import-runs`, {
    method: "POST",
    body: { fileObjectId: uploadBody.fileObject.id },
  });
  assert.equal(importRunResponse.status, 201);
  const importRunBody = await importRunResponse.json();
  return { upload: uploadBody.fileObject, importRun: importRunBody.importRun };
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

test("applying later imports creates merged current dataset commits without mutating parents", async () => {
  const labs = await (await jsonFetch("/api/labs")).json();
  const labId = labs.labs[0].labId;
  const project = await (await jsonFetch("/api/projects", {
    method: "POST",
    body: { labId, name: "Merged Dataset Commit Project" },
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
  const secondApply = await normalizeAndApplyImportRun(second.importRun);
  const secondCommit = secondApply.apply.datasetCommit;

  assert.equal(secondCommit.parentCommitId, firstCommitId);
  assert.equal(secondCommit.datasetPayload.genericImports.length, 2);
  assert.equal(secondCommit.datasetPayload.genericImports[0].importId, firstImportId);
  assert.equal(secondCommit.summary.totalGenericImportCount, 2);
  assert.equal(secondCommit.summary.totalExperimentCount, 2);

  const state = await (await jsonFetch(`/api/projects/${project.project.id}/state`)).json();
  const parent = state.datasetCommits.find((commit) => commit.id === firstCommitId);
  assert.equal(parent.datasetPayload.genericImports.length, 1);
  assert.equal(state.currentDatasetCommit.id, secondCommit.id);
  assert.equal(state.currentDatasetCommit.datasetPayload.genericImports.length, 2);
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

  const appended = await uploadAndCreateImportRun(project.project.id, makeWorkbookBlob([
    ["Exp2", 275, 8, 0.24],
  ]), "refresh-stale-append.xlsx");
  await normalizeAndApplyImportRun(appended.importRun);
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

test("duplicate imports and repeated apply are rejected", async () => {
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
  assert.equal((await duplicateApply.json()).error.code, "duplicate_import_already_committed");

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
      decisionSummary: { accepted: 1, rejected: 0 },
    },
  });
  assert.equal(mappingPatch.status, 200);
  const mappingPatchBody = await mappingPatch.json();
  assert.equal(mappingPatchBody.mappingSet.status, "accepted");
  assert.equal(mappingPatchBody.mappingSet.decisionSummary.accepted, 1);

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
      prompt: "plot gas selectivity vs temperature grouped by label",
      persistAsProposal: true,
    },
  });
  assert.equal(persisted.status, 200);
  const persistedBody = await persisted.json();
  assert.match(persistedBody.chartProposalSet.id, /^chart_proposal_set_/);
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
  assert.equal(chartSpecBody.chartSpec.spec.schemaVersion, "labrat.chartSpec.v1.2");
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
  assert.equal(body.chartSpec.spec.schemaVersion, "labrat.chartSpec.v1.2");

  const list = await jsonFetch(`/api/projects/${project.id}/chart-specs`);
  const listBody = await list.json();
  assert.equal(listBody.chartSpecs.some((chartSpec) => chartSpec.id === body.chartSpec.id), true);
  assert.equal(listBody.chartSpecs.find((chartSpec) => chartSpec.id === body.chartSpec.id).status, "active");
  assert.equal(listBody.chartSpecs.find((chartSpec) => chartSpec.id === body.chartSpec.id).isStale, false);
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
