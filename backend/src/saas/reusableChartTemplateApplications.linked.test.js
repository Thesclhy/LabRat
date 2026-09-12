import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";
import { executeAnalysisRun } from "./analysisThreads.js";
import {
  CHART_TEMPLATE_EXECUTION_STRATEGY,
  buildReusableChartTemplateApplicationArtifacts,
  executeReusableChartTemplate,
  materializeLinkedSeriesInputs,
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

async function seedLinkedRegion(store, { index, docId = `doc_${index}`, cells, dataKind = DATA_KIND, seriesList = [series()], acceptedAt = "2026-09-09T10:00:00.000Z", disposition = "active", range = "A1:F2" }) {
  const experimentId = `identity_${index}`;
  if (!store.experimentIdentities.has(experimentId)) seedIdentity(store, index);
  if (!store.sourceDocuments.has(docId)) {
    store.sourceDocuments.set(docId, { id: docId, projectId: project.id, labId: project.labId, fileObjectId: `file_${docId}`, metadata: { workbookName: `Calculation Exp${index}.xlsx` } });
    store.sourceIndexBlobs.set(`blob_${docId}`, { id: `blob_${docId}`, sourceDocumentId: docId, payload: { sheets: [{ name: "Sheet1", cellGrid: { range: "A1:H10", cells } }] } });
  }
  const session = await store.createWorkbookReviewSession({ labId: project.labId, projectId: project.id, sourceDocumentId: docId, workbookSummary: { workbookName: `Calculation Exp${index}.xlsx` }, status: "needs_user_review", createdBy: actorUserId });
  const region = await store.createWorkbookReviewRegion({
    labId: project.labId, projectId: project.id, workbookReviewSessionId: session.id, sourceDocumentId: docId,
    sheetName: "Sheet1", rangeRef: range, selectionMethod: "template_match", disposition: "active", reviewStatus: "awaiting_review",
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

function seededTemplate(store) {
  const templateVersion = { ...linkedTemplateVersion(), templateName: "Carbon distribution comparison" };
  store.reusableChartTemplates.set(templateVersion.reusableChartTemplateId, {
    id: templateVersion.reusableChartTemplateId, labId: project.labId, projectId: project.id,
    name: "Carbon distribution comparison", status: "active", currentVersionId: templateVersion.id,
  });
  store.reusableChartTemplateVersions.set(templateVersion.id, templateVersion);
  return templateVersion;
}

async function preparedArtifacts(store, templateVersion, experimentIds = ["identity_31", "identity_32"], key = "linked_apply_1") {
  const compatibility = await prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion, experimentIds });
  assert.equal(compatibility.status, "ready", JSON.stringify(compatibility.blockers));
  return buildReusableChartTemplateApplicationArtifacts({
    project, actorUserId, templateVersion, compatibility, idempotencyKey: key, requestHash: `${key}_hash`,
  });
}

test("linked template applications build a workbook-mode plan and freeze region refs", async () => {
  const store = await fixture();
  const templateVersion = seededTemplate(store);
  const artifacts = await preparedArtifacts(store, templateVersion);
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
  const stored = await store.createReusableChartTemplateApplication(artifacts);
  assert.equal(stored.application.frozenRegionRefs.length, 2);
});

test("series renderer draws one grouped bar trace per experiment with workbook values, gaps, cell lineage, and a stable input hash", async () => {
  const store = await fixture();
  const templateVersion = seededTemplate(store);
  const artifacts = await preparedArtifacts(store, templateVersion);
  const { linkedSeries } = await materializeLinkedSeriesInputs({ store, projectId: project.id, application: artifacts.application });
  assert.deepEqual(linkedSeries.map((item) => [item.label, item.valueCount, item.missingCount]), [["Exp31", 5, 0], ["Exp32", 3, 2]]);

  const rendered = executeReusableChartTemplate({ templateVersion, application: artifacts.application, experiments: [], linkedSeries });
  const { data, layout } = rendered.executorResult.result.plotly;
  assert.equal(data.length, 2);
  assert.deepEqual(data.map((trace) => trace.name), ["Exp31", "Exp32"]);
  assert.deepEqual(data[0].x, ["C1", "C2", "C3", "C4", "C5", "C6"], "category union keeps source order");
  assert.deepEqual(data[0].y, [0.52, 0.14, 0.07, 0.03, 0.01, null]);
  assert.deepEqual(data[1].y, [0.5, null, 0.06, null, null, 0.02]);
  assert.equal(data[0].type, "bar");
  assert.equal(layout.barmode, "group");
  assert.equal(layout.xaxis.title.text, "carbon number");
  assert.equal(layout.yaxis.title.text, "% of feed carbon");
  assert.deepEqual(layout.xaxis.categoryarray, ["C1", "C2", "C3", "C4", "C5", "C6"]);
  assert.equal(layout.showlegend, true);
  assert.equal(data[0].meta.labrat.sourceLineage[0].regionUnderstandingRevisionId, artifacts.application.frozenRegionRefs[0].regionUnderstandingRevisionId);
  assert.deepEqual(data[1].meta.labrat.sourceLineage[0].cells, ["B2", "D2", "F2"]);
  const exp32Cells = rendered.sourceRefs.filter((ref) => ref.experimentId === "identity_32" && ref.sourceType === "excel_cell");
  assert.deepEqual(exp32Cells.map((ref) => [ref.cell, ref.category]), [["B2", "C1"], ["D2", "C3"], ["F2", "C6"]]);
  assert.equal(rendered.sourceRefs.filter((ref) => ref.sourceType === "excel_range").length, 4);
  assert.deepEqual(rendered.executorResult.result.exclusions.map((item) => [item.label, item.category, item.reason]), [
    ["Exp31", "C6", "category_absent"],
    ["Exp32", "C2", "excel_error"],
    ["Exp32", "C4", "blank"],
    ["Exp32", "C5", "category_absent"],
  ]);
  assert.equal(rendered.executorResult.result.resolvedGeometry.schemaVersion, "labrat.resolvedChartGeometry.v1");

  const again = executeReusableChartTemplate({ templateVersion, application: artifacts.application, experiments: [], linkedSeries: structuredClone(linkedSeries) });
  assert.equal(again.hashes.inputHash, rendered.hashes.inputHash);
  assert.equal(again.hashes.programHash, rendered.hashes.programHash);
});

test("series renderer honours overlay points, omit_point, intersection, exact alignment, and refuses stacked encodings", async () => {
  const store = await fixture();
  const base = seededTemplate(store);
  const artifacts = await preparedArtifacts(store, base);
  const { linkedSeries } = await materializeLinkedSeriesInputs({ store, projectId: project.id, application: artifacts.application });

  const overlay = { ...base, encoding: { ...base.encoding, chartType: "scatter", comparisonMode: "overlay" } };
  const points = executeReusableChartTemplate({ templateVersion: overlay, application: artifacts.application, experiments: [], linkedSeries });
  assert.equal(points.executorResult.result.plotly.data[0].type, "scatter");
  assert.equal(points.executorResult.result.plotly.data[0].mode, "markers");
  assert.equal(points.executorResult.result.plotly.data[0].connectgaps, false);
  assert.equal(points.executorResult.result.plotly.layout.barmode, undefined);

  const omit = { ...base, recipe: { ...base.recipe, operations: base.recipe.operations.map((operation) => (operation.op === "filter_missing" ? { ...operation, policy: "omit_point" } : operation)) } };
  const omitted = executeReusableChartTemplate({ templateVersion: omit, application: artifacts.application, experiments: [], linkedSeries });
  assert.deepEqual(omitted.executorResult.result.plotly.data[1].x, ["C1", "C3", "C6"]);
  assert.deepEqual(omitted.executorResult.result.plotly.data[1].y, [0.5, 0.06, 0.02]);

  const intersection = { ...base, recipe: { ...base.recipe, operations: base.recipe.operations.map((operation) => (operation.op === "align_x" ? { ...operation, policy: "intersection" } : operation)) } };
  const shared = executeReusableChartTemplate({ templateVersion: intersection, application: artifacts.application, experiments: [], linkedSeries });
  assert.deepEqual(shared.executorResult.result.plotly.data[0].x, ["C1", "C2", "C3", "C4"]);

  const exact = { ...base, recipe: { ...base.recipe, operations: base.recipe.operations.map((operation) => (operation.op === "align_x" ? { ...operation, policy: "exact" } : operation)) } };
  assert.throws(
    () => executeReusableChartTemplate({ templateVersion: exact, application: artifacts.application, experiments: [], linkedSeries }),
    (error) => error.code === "chart_template_alignment_incompatible" && error.details.categories.join() === "C5,C6",
  );

  const stacked = { ...base, encoding: { ...base.encoding, comparisonMode: "stacked_components" } };
  assert.throws(
    () => executeReusableChartTemplate({ templateVersion: stacked, application: artifacts.application, experiments: [], linkedSeries }),
    (error) => error.code === "chart_template_recipe_unsupported",
  );
  const computed = { ...base, recipe: { ...base.recipe, operations: [...base.recipe.operations, { op: "normalize", inputRole: "trace", outputRole: "trace" }] } };
  assert.throws(
    () => executeReusableChartTemplate({ templateVersion: computed, application: artifacts.application, experiments: [], linkedSeries }),
    (error) => error.code === "chart_template_recipe_unsupported",
  );
  assert.throws(
    () => executeReusableChartTemplate({ templateVersion: base, application: artifacts.application, experiments: [], linkedSeries: linkedSeries.slice(0, 1) }),
    (error) => error.code === "chart_template_inputs_stale",
  );
});

test("chart_template_v1 runs for workbook templates read frozen regions, never call a provider, and fail closed when a frozen revision disappears", async () => {
  const store = await fixture();
  const templateVersion = seededTemplate(store);
  const artifacts = await preparedArtifacts(store, templateVersion);
  await store.createReusableChartTemplateApplication(artifacts);

  // A newer confirmation on Exp31 must not be swapped in: the frozen revision wins.
  await seedLinkedRegion(store, { index: 31, docId: "doc_31b", cells: headerRowCells(["C1", "C2", "C3", "C4", "C5"], [9, 9, 9, 9, 9]), acceptedAt: "2026-09-12T10:00:00.000Z" });

  const result = await executeAnalysisRun({
    store, project, actorUserId, analysisRunId: artifacts.analysisRun.id, executionStrategy: CHART_TEMPLATE_EXECUTION_STRATEGY,
    modelProvider: { complete: async () => assert.fail("model provider must not be called") },
    executor: { executeAcceptedRun: async () => assert.fail("Python executor must not be called") },
  });
  assert.equal(result.analysisRun.status, "awaiting_result_review", JSON.stringify(result.analysisRun.payload));
  assert.deepEqual(result.analysisResult.result.plotly.data[0].y, [0.52, 0.14, 0.07, 0.03, 0.01, null]);
  assert.equal(result.analysisResult.validation.ok, true);
  assert.equal(result.analysisResult.sourceRefs.some((ref) => ref.sourceType === "excel_cell" && ref.cell === "B2"), true);
  assert.equal(result.analysisRun.payload.inputManifest.linkedSeries.length, 2);
  assert.equal(result.analysisRun.payload.pythonProgram ?? null, null);
  assert.equal((await store.findReusableChartTemplateApplicationById(artifacts.application.id)).status, "result_ready");

  const second = await preparedArtifacts(store, templateVersion, ["identity_32"], "linked_apply_2");
  await store.createReusableChartTemplateApplication(second);
  store.regionUnderstandingRevisions.delete(second.application.frozenRegionRefs[0].regionUnderstandingRevisionId);
  const stale = await executeAnalysisRun({
    store, project, actorUserId, analysisRunId: second.analysisRun.id, executionStrategy: CHART_TEMPLATE_EXECUTION_STRATEGY,
    modelProvider: { complete: async () => assert.fail("model provider must not be called") },
    executor: { executeAcceptedRun: async () => assert.fail("Python executor must not be called") },
  });
  assert.equal(stale.analysisRun.status, "failed");
  assert.equal(stale.analysisRun.payload.error.code, "chart_template_inputs_stale");
  assert.equal((await store.findReusableChartTemplateApplicationById(second.application.id)).status, "failed");
});

test("a template bound to one series of a multi-series region reads that series and excludes regions without it", async () => {
  const store = new MemorySaasStore();
  store.projects.set(project.id, project);
  const gasCells = (values) => [
    cell("A1", "Component"), cell("B1", "C1"), cell("C1", "C2"), cell("D1", "C3"), cell("E1", "i-C4"), cell("F1", "C4"),
    cell("A2", "C-Response"), cell("B2", 1), cell("C2", 1), cell("D2", 1), cell("E2", 1), cell("F2", 1),
    cell("A3", "Area"), ...values.map((value, index) => (value == null ? null : cell(`${"BCDEF"[index]}3`, value))).filter(Boolean),
  ];
  const gasSeries = [
    series({ seriesKey: "c_response_series", label: "C-Response", ySemanticKey: "c_response_series", xHeaderRange: "B1:F1", yValueRange: "B2:F2", yUnit: null, yNumericScale: null }),
    series({ seriesKey: "area_series", label: "Area", ySemanticKey: "area_series", xHeaderRange: "B1:F1", yValueRange: "B3:F3", yUnit: null, yNumericScale: null }),
  ];
  const seedGas = (index, values, seriesList = gasSeries) => seedLinkedRegion(store, { index, dataKind: "Gas product distribution", cells: gasCells(values), seriesList, range: "A1:F3" });
  await seedGas(35, [44, 11, 6, null, 3]);
  await seedGas(45, [40, 16, 14, null, 18]);
  await seedGas(46, [1, 2, 3, 4, 5], [gasSeries[0]]);

  const slot = {
    ...linkedTemplateVersion().inputSlots[0],
    label: "Area",
    linkedDataKind: "Gas product distribution",
    identityContract: { preferredColumnId: "", valueType: "series", readableName: "Area", sourceSignature: "sig", numericScale: "" },
    unitContract: { allowedUnits: [], conversionPolicyIds: [] },
    seriesContract: { orientation: "header_row_categories", xMeaning: "hydrocarbon_component", xValueType: "string", yNumericScale: null, alignmentPolicy: "union_with_gaps", seriesSelector: { seriesKey: "area_series", label: "Area", ySemanticKey: "area_series" } },
  };
  const templateVersion = { ...linkedTemplateVersion({ inputSlots: [slot] }), templateName: "Gas product distribution" };
  store.reusableChartTemplates.set(templateVersion.reusableChartTemplateId, { id: templateVersion.reusableChartTemplateId, labId: project.labId, projectId: project.id, name: "Gas product distribution", status: "active", currentVersionId: templateVersion.id });
  store.reusableChartTemplateVersions.set(templateVersion.id, templateVersion);

  const compatibility = await prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion, experimentIds: ["identity_35", "identity_45", "identity_46"] });
  assert.equal(compatibility.status, "ready", JSON.stringify(compatibility.blockers));
  assert.deepEqual(compatibility.experiments.map((item) => item.label), ["Exp35", "Exp45"]);
  assert.deepEqual(compatibility.excludedExperiments.map((item) => [item.label, item.code]), [["Exp46", "chart_template_series_shape_mismatch"]]);
  assert.match(compatibility.excludedExperiments[0].message, /no "Area" series \(it defines C-Response\)/);
  assert.deepEqual(compatibility.frozenRegionRefs.map((ref) => ref.seriesKey), ["area_series", "area_series"]);
  assert.deepEqual(compatibility.linkedSeries[0].points.map((point) => point.y), [44, 11, 6, null, 3]);

  const artifacts = buildReusableChartTemplateApplicationArtifacts({ project, actorUserId, templateVersion, compatibility, idempotencyKey: "gas_apply", requestHash: "gas_apply_hash" });
  const { linkedSeries } = await materializeLinkedSeriesInputs({ store, projectId: project.id, application: artifacts.application, templateVersion });
  assert.deepEqual(linkedSeries.map((item) => item.seriesLabel), ["Area", "Area"]);
  const rendered = executeReusableChartTemplate({ templateVersion, application: artifacts.application, experiments: [], linkedSeries });
  assert.deepEqual(rendered.executorResult.result.plotly.data[1].y, [40, 16, 14, null, 18]);
  assert.equal(rendered.executorResult.result.plotly.layout.yaxis.title.text, "Area");

  const unselective = { ...templateVersion, inputSlots: [{ ...slot, seriesContract: { ...slot.seriesContract, seriesSelector: undefined } }] };
  const ambiguous = await prepareReusableChartTemplateApplication({ store, projectId: project.id, templateVersion: unselective, experimentIds: ["identity_35"] });
  assert.equal(ambiguous.status, "blocked");
  assert.match(ambiguous.excludedExperiments[0].message, /defines 2 series/);
});
