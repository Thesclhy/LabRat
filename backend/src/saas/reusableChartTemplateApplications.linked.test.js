import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";
import { executeAnalysisRun } from "./analysisThreads.js";
import {
  CHART_TEMPLATE_EXECUTION_STRATEGY,
  buildReusableChartTemplateApplicationArtifacts,
  executeReusableChartTemplate,
  prepareReusableChartTemplateApplication,
} from "./reusableChartTemplateApplications.js";

const project = { id: "project_linked", labId: "lab_linked" };
const actorUserId = "user_linked";
const DATA_KIND = "Carbon distribution";

function cell(address, rawValue, extra = {}) {
  const type = extra.type || (extra.formula ? "formula" : typeof rawValue === "number" ? "number" : "string");
  return { address, rawValue, formattedValue: extra.formattedValue ?? (rawValue == null ? null : String(rawValue)), type, formula: extra.formula || null };
}

function headerRowCells(categories, values) {
  return [
    cell("A1", "Overall tots"),
    ...categories.map((category, index) => cell(`${String.fromCharCode(66 + index)}1`, category)),
    ...values.map((value, index) => (value === "#DIV/0!"
      ? cell(`${String.fromCharCode(66 + index)}2`, null, { type: "error", formattedValue: "#DIV/0!", formula: "F14" })
      : value == null ? null : cell(`${String.fromCharCode(66 + index)}2`, value, { formula: "F14" }))).filter(Boolean),
  ];
}

function series(overrides = {}) {
  return {
    seriesKey: "carbon_distribution",
    label: "Overall carbon distribution",
    orientation: "header_row_categories",
    xHeaderRange: "B1:F1",
    yValueRange: "B2:F2",
    xSemanticKey: "carbon_number",
    xValueType: "string",
    yUnit: "% of feed carbon",
    yNumericScale: "percent_points",
    pointCount: 5,
    ...overrides,
  };
}

function linkedTemplateVersion(overrides = {}) {
  return {
    id: "template_version_linked",
    labId: project.labId,
    projectId: project.id,
    reusableChartTemplateId: "template_linked",
    contentHash: "template_hash_linked",
    chartStyleProfileVersionId: null,
    experimentCardinality: { minimum: 1, recommendedMaximum: 8, hardMaximum: 24 },
    inputSlots: [{
      slotId: "series",
      label: "Overall carbon distribution",
      dataKind: "series",
      required: true,
      cardinality: "one_per_experiment",
      sourceKind: "linked_region",
      linkedDataKind: DATA_KIND,
      identityContract: { preferredColumnId: "", valueType: "series", readableName: "Overall carbon distribution", sourceSignature: "sig", numericScale: "percent_points" },
      unitContract: { allowedUnits: ["% of feed carbon"], conversionPolicyIds: [] },
      seriesContract: { orientation: "header_row_categories", xMeaning: "carbon_number", xValueType: "string", yNumericScale: "percent_points", alignmentPolicy: "union_with_gaps" },
    }],
    recipe: {
      schemaVersion: "labrat.chartRecipe.v1",
      operations: [
        { op: "select_series", inputSlotId: "series", outputRole: "trace" },
        { op: "align_x", inputRole: "trace", outputRole: "trace", policy: "union_with_gaps", order: "source" },
        { op: "filter_missing", inputRole: "trace", outputRole: "trace", policy: "preserve_gap" },
      ],
    },
    encoding: { chartType: "bar", comparisonMode: "grouped", xRole: "category", yRole: "value", colorBy: "experiment", sourceChartType: "grouped_bar" },
    missingDataPolicy: { missingScalar: "block", missingPoint: "preserve_gap", missingCategory: "union_with_gaps", missingSeries: "exclude_experiment" },
    ...overrides,
  };
}

function seedIdentity(store, index) {
  const id = `identity_${index}`;
  store.experimentIdentities.set(id, { id, labId: project.labId, projectId: project.id, canonicalLabel: `Exp${index}`, aliases: [] });
  return id;
}

async function seedLinkedRegion(store, { index, docId = `doc_${index}`, cells, dataKind = DATA_KIND, seriesList = [series()], acceptedAt = "2026-09-09T10:00:00.000Z", disposition = "active" }) {
  const experimentId = `identity_${index}`;
  if (!store.experimentIdentities.has(experimentId)) seedIdentity(store, index);
  if (!store.sourceDocuments.has(docId)) {
    store.sourceDocuments.set(docId, { id: docId, projectId: project.id, labId: project.labId, fileObjectId: `file_${docId}`, metadata: { workbookName: `Calculation Exp${index}.xlsx` } });
    store.sourceIndexBlobs.set(`blob_${docId}`, { id: `blob_${docId}`, sourceDocumentId: docId, payload: { sheets: [{ name: "Sheet1", cellGrid: { range: "A1:H10", cells } }] } });
  }
  const session = await store.createWorkbookReviewSession({ labId: project.labId, projectId: project.id, sourceDocumentId: docId, workbookSummary: { workbookName: `Calculation Exp${index}.xlsx` }, status: "needs_user_review", createdBy: actorUserId });
  const region = await store.createWorkbookReviewRegion({
    labId: project.labId, projectId: project.id, workbookReviewSessionId: session.id, sourceDocumentId: docId,
    sheetName: "Sheet1", rangeRef: "A1:F2", selectionMethod: "template_match", disposition: "active", reviewStatus: "awaiting_review",
    linkedExperimentId: experimentId, dataKind, createdBy: actorUserId,
  });
  const revision = await store.createRegionUnderstandingRevision({
    labId: project.labId, projectId: project.id, workbookReviewSessionId: session.id, sourceDocumentId: docId, regionId: region.id,
    revisionNumber: 1, trigger: "template_match", summary: ["Prefilled."], sourceContentHash: `h_${docId}`, dependencyHash: `d_${docId}`,
    interpretation: { semanticType: "component_distribution", experimentAxis: "region", fields: [], series: seriesList },
    validation: { status: "ready", blockers: [] }, createdBy: actorUserId,
  });
  await store.updateWorkbookReviewRegion(region.id, { reviewStatus: "accepted", currentRevisionId: revision.id, acceptedRevisionId: revision.id, acceptedAt, acceptedBy: actorUserId, ...(disposition !== "active" ? { disposition } : {}) });
  return { region, revision, session };
}

async function fixture() {
  const store = new MemorySaasStore();
  store.projects.set(project.id, project);
  await seedLinkedRegion(store, { index: 31, cells: headerRowCells(["C1", "C2", "C3", "C4", "C5"], [0.52, 0.14, 0.07, 0.03, 0.01]) });
  await seedLinkedRegion(store, { index: 32, cells: headerRowCells(["C1", "C2", "C3", "C4", "C6"], [0.5, "#DIV/0!", 0.06, null, 0.02]) });
  return store;
}

test("linked template applications resolve regions by data kind, align categories, and exclude experiments without the data kind", async () => {
  const store = await fixture();
  seedIdentity(store, 33);
  const compatibility = await prepareReusableChartTemplateApplication({
    store, projectId: project.id, templateVersion: linkedTemplateVersion(), experimentIds: ["identity_31", "identity_32", "identity_33"],
  });
  assert.equal(compatibility.status, "ready", JSON.stringify(compatibility.blockers));
  assert.equal(compatibility.sourceKind, "linked_region");
  assert.equal(compatibility.linkedDataKind, DATA_KIND);
  assert.equal(compatibility.experimentCount, 2);
  assert.deepEqual(compatibility.experiments.map((item) => [item.label, item.valueCount, item.missingCount, item.missingCategories]), [
    ["Exp31", 5, 0, ["C6"]],
    ["Exp32", 3, 2, ["C2", "C4", "C5"]],
  ]);
  assert.deepEqual(compatibility.excludedExperiments, [{
    experimentId: "identity_33", label: "Exp33", code: "chart_template_input_missing", message: `Exp33 has no confirmed ${DATA_KIND} linked to it.`,
  }]);
  assert.deepEqual(compatibility.alignment, { categories: ["C1", "C2", "C3", "C4", "C5", "C6"], policy: "union_with_gaps" });
  assert.deepEqual(compatibility.resolvedBindings, [{ slotId: "series", mode: "data_kind", linkedDataKind: DATA_KIND, valueType: "series", unit: "% of feed carbon", sourceSignature: "sig", explicit: false }]);
  assert.deepEqual(compatibility.experimentSelections, []);
  assert.deepEqual(compatibility.frozenHeadRefs, []);
  assert.equal(compatibility.sourceSelections.length, 2);
  assert.equal(compatibility.sourceSelections[0].regionUnderstandingRevisionId, compatibility.frozenRegionRefs[0].regionUnderstandingRevisionId);
  assert.equal(compatibility.sourceSelections[0].range, "A1:F2");
  assert.equal(compatibility.frozenRegionRefs.length, 2);
  assert.equal(compatibility.frozenRegionRefs[1].workbookName, "Calculation Exp32.xlsx");
  const exp32 = compatibility.linkedSeries[1];
  assert.deepEqual(exp32.points.map((point) => [point.x, point.y, point.missingReason]), [
    ["C1", 0.5, null], ["C2", null, "excel_error"], ["C3", 0.06, null], ["C4", null, "blank"], ["C6", 0.02, null],
  ]);
});

test("linked template applications honour the block policy, unit contracts, deleted sessions, and multiple regions", async () => {
  const store = await fixture();
  seedIdentity(store, 33);
  const blocking = linkedTemplateVersion({ missingDataPolicy: { missingSeries: "block" } });
  const blocked = await prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion: blocking, experimentIds: ["identity_31", "identity_33"] });
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.blockers.map((item) => item.code), ["chart_template_input_missing"]);
  assert.deepEqual(blocked.sourceSelections, []);

  await seedLinkedRegion(store, { index: 34, cells: headerRowCells(["C1"], [1]), seriesList: [series({ yUnit: "mol%" })] });
  await seedLinkedRegion(store, { index: 35, cells: headerRowCells(["C1"], [1]), disposition: "deleted" });
  await seedLinkedRegion(store, { index: 36, cells: headerRowCells(["C1"], [1]), seriesList: [series({ orientation: "column_pair", xColumn: "A", yColumn: "B" })] });
  await seedLinkedRegion(store, { index: 37, cells: headerRowCells(["C1", "C2"], ["#DIV/0!", null]) });
  await seedLinkedRegion(store, { index: 31, docId: "doc_31b", cells: headerRowCells(["C1", "C2", "C3", "C4", "C5"], [0.6, 0.1, 0.1, 0.1, 0.1]), acceptedAt: "2026-09-11T10:00:00.000Z" });

  const compatibility = await prepareReusableChartTemplateApplication({
    store, projectId: project.id, templateVersion: linkedTemplateVersion(),
    experimentIds: ["identity_31", "identity_34", "identity_35", "identity_36", "identity_37"],
  });
  assert.equal(compatibility.status, "ready");
  assert.deepEqual(compatibility.experiments.map((item) => item.label), ["Exp31"]);
  assert.equal(compatibility.experiments[0].region.workbookName, "Calculation Exp31.xlsx");
  assert.equal(compatibility.frozenRegionRefs[0].sourceDocumentId, "doc_31b", "the most recently confirmed region wins");
  assert.deepEqual(compatibility.warnings.map((item) => item.code), ["chart_template_multiple_regions"]);
  assert.deepEqual(compatibility.excludedExperiments.map((item) => [item.label, item.code]), [
    ["Exp35", "chart_template_session_deleted"],
    ["Exp34", "chart_template_unit_incompatible"],
    ["Exp36", "chart_template_series_shape_mismatch"],
    ["Exp37", "chart_template_input_missing"],
  ]);
  assert.match(compatibility.excludedExperiments[3].message, /excel_error, blank/);

  const nothing = await prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion: linkedTemplateVersion(), experimentIds: ["identity_34"] });
  assert.equal(nothing.status, "blocked");
  assert.deepEqual(nothing.blockers.map((item) => item.code), ["chart_template_input_missing"]);
});

test("linked template applications reject unknown experiments, explicit bindings, and mixed slot kinds", async () => {
  const store = await fixture();
  await assert.rejects(
    prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion: linkedTemplateVersion(), experimentIds: ["identity_31", "identity_ghost"] }),
    (error) => error.code === "chart_template_input_missing" && error.statusCode === 422,
  );
  await assert.rejects(
    prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion: linkedTemplateVersion(), experimentIds: ["identity_31"], explicitBindings: [{ slotId: "series", columnId: "x" }] }),
    (error) => error.code === "chart_template_binding_invalid",
  );
  const mixed = linkedTemplateVersion();
  mixed.inputSlots = [...mixed.inputSlots, { slotId: "value", label: "Yield", dataKind: "scalar", sourceKind: "snapshot", identityContract: { preferredColumnId: "yield" }, unitContract: { allowedUnits: ["%"] } }];
  await assert.rejects(
    prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion: mixed, experimentIds: ["identity_31"] }),
    (error) => error.code === "chart_template_slot_mix_unsupported",
  );
  await assert.rejects(
    prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion: linkedTemplateVersion(), experimentIds: [] }),
    (error) => error.code === "chart_template_experiment_count_invalid",
  );
});

test("linked template applications build a workbook-mode plan, freeze region refs, and fail closed at execution until the series renderer exists", async () => {
  const store = await fixture();
  const templateVersion = { ...linkedTemplateVersion(), templateName: "Carbon distribution comparison" };
  store.reusableChartTemplates.set(templateVersion.reusableChartTemplateId, {
    id: templateVersion.reusableChartTemplateId, labId: project.labId, projectId: project.id,
    name: "Carbon distribution comparison", status: "active", currentVersionId: templateVersion.id,
  });
  store.reusableChartTemplateVersions.set(templateVersion.id, templateVersion);
  const compatibility = await prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion, experimentIds: ["identity_31", "identity_32"] });
  const artifacts = buildReusableChartTemplateApplicationArtifacts({
    project, actorUserId, templateVersion, compatibility, idempotencyKey: "linked_apply_1", requestHash: "linked_apply_hash_1",
  });
  const { plan } = artifacts.analysisPlanRevision;
  assert.equal(artifacts.analysisThread.inputMode, "workbook");
  assert.equal(plan.inputMode, "workbook");
  assert.deepEqual(plan.experimentSelections, []);
  assert.equal(plan.sourceSelections.length, 2);
  assert.equal(plan.sourceSelections[0].sourceSelectionId, "template_source_selection_1");
  assert.equal(plan.templateLineage.linkedDataKind, DATA_KIND);
  assert.equal(plan.templateLineage.frozenRegionRefs.length, 2);
  assert.equal(plan.reviewPlan.chart.xDescription, "carbon number");
  assert.match(plan.displayPlan[1], /^Exp31: Calculation Exp31\.xlsx · Sheet1!A1:F2$/);
  assert.match(plan.displayPlan[2], /2 missing points/);
  assert.equal(artifacts.analysisPlanRevision.sourceRectangles.length, 2);
  assert.equal(artifacts.analysisPlanRevision.sourceRectangles[0].sourceType, "excel_range");
  assert.equal(artifacts.application.frozenRegionRefs.length, 2);
  assert.deepEqual(artifacts.application.frozenHeadRefs, []);
  assert.deepEqual(artifacts.application.experimentIds, ["identity_31", "identity_32"]);
  assert.equal(artifacts.analysisRun.status, "queued");
  assert.equal(artifacts.analysisRun.payload.executionStrategy, CHART_TEMPLATE_EXECUTION_STRATEGY);

  assert.throws(
    () => executeReusableChartTemplate({ templateVersion, application: artifacts.application, experiments: [] }),
    (error) => error.code === "chart_template_series_execution_unavailable" && error.statusCode === 422,
  );

  const stored = await store.createReusableChartTemplateApplication(artifacts);
  assert.equal(stored.application.frozenRegionRefs.length, 2);
  const result = await executeAnalysisRun({
    store, project, actorUserId, analysisRunId: artifacts.analysisRun.id, executionStrategy: CHART_TEMPLATE_EXECUTION_STRATEGY,
    modelProvider: { complete: async () => assert.fail("model provider must not be called") },
    executor: { executeAcceptedRun: async () => assert.fail("Python executor must not be called") },
  });
  assert.equal(result.analysisRun.status, "failed");
  assert.equal(result.analysisRun.payload.error.code, "chart_template_series_execution_unavailable");
  assert.equal((await store.findReusableChartTemplateApplicationById(artifacts.application.id)).status, "failed");
});
