import test from "node:test";
import assert from "node:assert/strict";
import { MemorySaasStore } from "./memoryStore.js";
import { executeAnalysisRun } from "./analysisThreads.js";
import {
  CHART_TEMPLATE_EXECUTION_STRATEGY,
  buildReusableChartTemplateApplicationArtifacts,
  executeReusableChartTemplate,
  prepareReusableChartTemplateApplication,
} from "./reusableChartTemplateApplications.js";

const project = { id: "project_template", labId: "lab_template" };
const actorUserId = "user_template";

function templateVersion(overrides = {}) {
  return {
    id: "template_version_1",
    labId: project.labId,
    projectId: project.id,
    reusableChartTemplateId: "template_1",
    contentHash: "template_hash_1",
    chartStyleProfileVersionId: null,
    experimentCardinality: { minimum: 1, recommendedMaximum: 6, hardMaximum: 12 },
    inputSlots: [{
      slotId: "value",
      label: "Yield",
      dataKind: "scalar",
      required: true,
      cardinality: "one_per_experiment",
      identityContract: {
        preferredColumnId: "yield_pct",
        readableName: "Yield",
        valueType: "number",
      },
      unitContract: { allowedUnits: ["%"], conversionPolicyIds: [] },
    }],
    recipe: {
      schemaVersion: "labrat.chartRecipe.v1",
      operations: [{ op: "select_scalar", inputSlotId: "value", outputRole: "y" }],
    },
    encoding: { chartType: "bar", comparisonMode: "grouped", xRole: "experiment", yRole: "value" },
    ...overrides,
  };
}

function seedExperiment(store, index, { value = index * 10, unit = "%", columnId = "yield_pct", displayName = "Yield" } = {}) {
  const experimentId = `experiment_${index}`;
  const snapshotId = `snapshot_${index}`;
  const headId = `head_${index}`;
  store.dataSnapshots.set(snapshotId, {
    id: snapshotId,
    labId: project.labId,
    projectId: project.id,
    status: "accepted",
    experimentRecords: [{
      experimentId,
      label: `Exp${index}`,
      fields: [{
        columnId,
        fieldKey: columnId,
        displayName,
        valueType: "number",
        unit,
        value,
        formattedValue: `${value}${unit}`,
        sourceRefs: [{ sourceDocumentId: "source_1", sheet: "Data", cell: `B${index + 1}` }],
      }],
    }],
  });
  store.experimentIdentities.set(experimentId, {
    id: experimentId,
    labId: project.labId,
    projectId: project.id,
    canonicalLabel: `Exp${index}`,
    aliases: [],
  });
  store.experimentSnapshotHeads.set(headId, {
    id: headId,
    labId: project.labId,
    projectId: project.id,
    experimentId,
    dataSnapshotId: snapshotId,
    recordIndex: 0,
  });
  return experimentId;
}

async function compatibilityFixture(count, options = {}) {
  const store = new MemorySaasStore();
  const experimentIds = Array.from({ length: count }, (_, index) => seedExperiment(store, index + 1, options));
  const compatibility = await prepareReusableChartTemplateApplication({
    store,
    projectId: project.id,
    templateVersion: templateVersion(),
    experimentIds,
  });
  return { store, experimentIds, compatibility };
}

test("reusable template compatibility accepts one, two, and three frozen experiments", async () => {
  for (const count of [1, 2, 3]) {
    const { compatibility } = await compatibilityFixture(count);
    assert.equal(compatibility.status, "ready");
    assert.equal(compatibility.experimentCount, count);
    assert.equal(compatibility.frozenHeadRefs.length, count);
    assert.deepEqual(compatibility.experimentSelections.map((item) => item.columnIndexes), Array.from({ length: count }, () => [0]));
  }
});

test("reusable template compatibility blocks missing and unit-incompatible scalars", async () => {
  const missingStore = new MemorySaasStore();
  const missingId = seedExperiment(missingStore, 1, { columnId: "other_column", displayName: "Other" });
  const missing = await prepareReusableChartTemplateApplication({
    store: missingStore,
    projectId: project.id,
    templateVersion: templateVersion(),
    experimentIds: [missingId],
  });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.blockers[0].code, "chart_template_input_missing");

  const unitStore = new MemorySaasStore();
  const unitId = seedExperiment(unitStore, 1, { unit: "g" });
  const incompatible = await prepareReusableChartTemplateApplication({
    store: unitStore,
    projectId: project.id,
    templateVersion: templateVersion(),
    experimentIds: [unitId],
  });
  assert.equal(incompatible.status, "blocked");
  assert.equal(incompatible.blockers[0].code, "chart_template_unit_incompatible");
});

test("explicit compatible slot bindings are reviewed and persisted append-only", async () => {
  const store = new MemorySaasStore();
  const experimentId = seedExperiment(store, 1, { columnId: "alternate_yield" });
  const compatibility = await prepareReusableChartTemplateApplication({
    store,
    projectId: project.id,
    templateVersion: templateVersion(),
    experimentIds: [experimentId],
    explicitBindings: [{ slotId: "value", columnId: "alternate_yield" }],
  });
  assert.equal(compatibility.status, "ready");
  assert.equal(compatibility.resolvedBindings[0].mode, "explicit");
  const artifacts = buildReusableChartTemplateApplicationArtifacts({
    project,
    actorUserId,
    templateVersion: { ...templateVersion(), templateName: "Yield comparison" },
    compatibility,
    idempotencyKey: "application_one",
    requestHash: "request_one",
  });
  const created = await store.createReusableChartTemplateApplication(artifacts);
  assert.equal(created.replayed, false);
  assert.equal((await store.listReusableChartTemplateSlotBindings({
    reusableChartTemplateVersionId: templateVersion().id,
    status: "active",
  })).length, 1);
  const replayed = await store.createReusableChartTemplateApplication(artifacts);
  assert.equal(replayed.replayed, true);
});

test("deterministic renderer adapts experiment count while preserving margins and source lineage", async () => {
  const { store, experimentIds, compatibility } = await compatibilityFixture(3);
  const artifacts = buildReusableChartTemplateApplicationArtifacts({
    project,
    actorUserId,
    templateVersion: { ...templateVersion(), templateName: "Yield comparison" },
    compatibility,
    idempotencyKey: "application_three",
    requestHash: "request_three",
  });
  const experiments = compatibility.experimentSelections.map((selection) => {
    const head = compatibility.frozenHeadRefs.find((item) => item.experimentId === selection.experimentId);
    const snapshot = store.dataSnapshots.get(head.dataSnapshotId);
    return {
      experimentId: selection.experimentId,
      label: snapshot.experimentRecords[0].label,
      activeHead: head,
      fields: snapshot.experimentRecords[0].fields.map((field, columnIndex) => ({ ...field, columnIndex })),
    };
  });
  const rendered = executeReusableChartTemplate({
    templateVersion: { ...templateVersion(), templateName: "Yield comparison" },
    application: artifacts.application,
    experiments,
    styleVersion: { geometry: { preferredMarginsPx: { top: 40, right: 20, bottom: 50, left: 60 } } },
  });
  assert.equal(rendered.executorResult.result.plotly.data[0].x.length, experimentIds.length);
  assert.deepEqual(rendered.executorResult.result.plotly.layout.margin, { t: 40, r: 20, b: 50, l: 60 });
  assert.equal(rendered.sourceRefs.length, 3);
});

test("chart_template_v1 execution never calls the model provider or Python executor", async () => {
  const { store, compatibility } = await compatibilityFixture(2);
  store.projects.set(project.id, project);
  store.reusableChartTemplates.set("template_1", {
    id: "template_1", labId: project.labId, projectId: project.id,
    name: "Yield comparison", status: "active", currentVersionId: templateVersion().id,
  });
  store.reusableChartTemplateVersions.set(templateVersion().id, templateVersion());
  const artifacts = buildReusableChartTemplateApplicationArtifacts({
    project,
    actorUserId,
    templateVersion: { ...templateVersion(), templateName: "Yield comparison" },
    compatibility,
    idempotencyKey: "execute_without_provider",
    requestHash: "execute_without_provider_hash",
  });
  await store.createReusableChartTemplateApplication(artifacts);
  const result = await executeAnalysisRun({
    store,
    project,
    actorUserId,
    analysisRunId: artifacts.analysisRun.id,
    executionStrategy: CHART_TEMPLATE_EXECUTION_STRATEGY,
    modelProvider: { complete: async () => assert.fail("model provider must not be called") },
    executor: { executeAcceptedRun: async () => assert.fail("Python executor must not be called") },
  });
  assert.equal(result.analysisRun.status, "awaiting_result_review", JSON.stringify(result.analysisRun.payload));
  assert.equal(result.analysisResult.result.plotly.data[0].x.length, 2);
  assert.equal((await store.findReusableChartTemplateApplicationById(artifacts.application.id)).status, "result_ready");
});

test("chart_template_v1 fails closed when an experiment head changes before execution", async () => {
  const { store, compatibility } = await compatibilityFixture(1);
  store.projects.set(project.id, project);
  store.reusableChartTemplates.set("template_1", { id: "template_1", projectId: project.id, name: "Yield", status: "active" });
  store.reusableChartTemplateVersions.set(templateVersion().id, templateVersion());
  const artifacts = buildReusableChartTemplateApplicationArtifacts({
    project, actorUserId, templateVersion: templateVersion(), compatibility,
    idempotencyKey: "stale_application", requestHash: "stale_hash",
  });
  await store.createReusableChartTemplateApplication(artifacts);
  const head = [...store.experimentSnapshotHeads.values()][0];
  store.experimentSnapshotHeads.set(head.id, { ...head, dataSnapshotId: "replacement_snapshot" });
  const result = await executeAnalysisRun({ store, project, actorUserId, analysisRunId: artifacts.analysisRun.id });
  assert.equal(result.analysisRun.status, "validation_failed");
  assert.equal(result.analysisRun.payload.error.code, "chart_template_inputs_stale");
});
