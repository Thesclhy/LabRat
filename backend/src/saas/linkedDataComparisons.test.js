import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";
import { buildLinkedDataComparison, linkedDataKinds } from "./linkedDataComparisons.js";
import { ANALYSIS_PLAN_REVISION_VERSION, validateAnalysisPlanRevision } from "./analysisSchemas.js";

async function seedLinkedRegion(store, { id, experimentId, dataKind, workbookName, range = "P31:BA32", acceptedAt = "2026-09-09T10:00:00.000Z", series = true }) {
  store.sourceDocuments.set(`doc_${id}`, { id: `doc_${id}`, projectId: "project_1", labId: "lab_1", fileObjectId: `file_${id}`, metadata: { workbookName } });
  const session = await store.createWorkbookReviewSession({ labId: "lab_1", projectId: "project_1", sourceDocumentId: `doc_${id}`, workbookSummary: { workbookName }, status: "needs_user_review", createdBy: "user_1" });
  const region = await store.createWorkbookReviewRegion({
    labId: "lab_1", projectId: "project_1", workbookReviewSessionId: session.id, sourceDocumentId: `doc_${id}`,
    sheetName: "Sheet1", rangeRef: range, selectionMethod: "template_match", disposition: "active", reviewStatus: "awaiting_review",
    linkedExperimentId: experimentId, dataKind, templateMatch: { status: "exact", templateVersion: 1 }, createdBy: "user_1",
  });
  const revision = await store.createRegionUnderstandingRevision({
    labId: "lab_1", projectId: "project_1", workbookReviewSessionId: session.id, sourceDocumentId: `doc_${id}`, regionId: region.id,
    revisionNumber: 1, trigger: "template_match", summary: ["Prefilled."], sourceContentHash: `h_${id}`, dependencyHash: `d_${id}`,
    interpretation: {
      semanticType: "component_distribution", experimentAxis: "region", experimentLabel: experimentId, fields: [],
      series: series ? [{ seriesKey: "carbon_distribution", label: "Overall carbon distribution", orientation: "header_row_categories", xHeaderRange: "Q31:BA31", yValueRange: "Q32:BA32", xSemanticKey: "carbon_number", yUnit: "% of feed carbon", pointCount: 37 }] : [],
    },
    validation: { status: "ready", blockers: [] }, createdBy: "user_1",
  });
  await store.updateWorkbookReviewRegion(region.id, { reviewStatus: "accepted", currentRevisionId: revision.id, acceptedRevisionId: revision.id, acceptedAt, acceptedBy: "user_1" });
  return { region, revision };
}

async function seededStore() {
  const store = new MemorySaasStore();
  for (const [id, label] of [["31", "Exp31"], ["32", "Exp32"], ["33", "Exp33"]]) {
    store.experimentIdentities.set(`identity_${id}`, { id: `identity_${id}`, projectId: "project_1", labId: "lab_1", canonicalLabel: label, aliases: [] });
  }
  await seedLinkedRegion(store, { id: "31", experimentId: "identity_31", dataKind: "Carbon distribution", workbookName: "Calculation Exp31.xlsx" });
  await seedLinkedRegion(store, { id: "32", experimentId: "identity_32", dataKind: "Carbon distribution", workbookName: "Calculation Exp32.xlsx" });
  await seedLinkedRegion(store, { id: "32b", experimentId: "identity_32", dataKind: "Carbon distribution", workbookName: "Calculation Exp32 rerun.xlsx", acceptedAt: "2026-09-10T10:00:00.000Z" });
  await seedLinkedRegion(store, { id: "31r", experimentId: "identity_31", dataKind: "Reaction rate data", workbookName: "Rates Exp31.xlsx", range: "A1:B60", series: false });
  return store;
}

test("linkedDataKinds groups accepted linked regions by data kind with experiment coverage", async () => {
  const store = await seededStore();
  const kinds = await linkedDataKinds({ store, projectId: "project_1" });
  assert.deepEqual(kinds.dataKinds.map((kind) => [kind.dataKind, kind.experimentCount, kind.regionCount]), [
    ["Carbon distribution", 2, 3],
    ["Reaction rate data", 1, 1],
  ]);
  const carbon = kinds.dataKinds[0];
  assert.deepEqual(carbon.experiments.map((experiment) => [experiment.label, experiment.regions.length]), [["Exp31", 1], ["Exp32", 2]]);
  assert.equal(carbon.experiments[0].regions[0].series[0].xHeaderRange, "Q31:BA31");
  assert.deepEqual(kinds.experiments.map((experiment) => experiment.label), ["Exp31", "Exp32", "Exp33"]);
});

test("buildLinkedDataComparison produces a valid workbook-mode chart plan from linked regions and reports gaps", async () => {
  const store = await seededStore();
  const comparison = await buildLinkedDataComparison({
    store,
    projectId: "project_1",
    dataKind: "carbon DISTRIBUTION",
    experimentIds: ["identity_31", "identity_32", "identity_33"],
  });
  assert.equal(comparison.dataKind, "Carbon distribution");
  assert.equal(comparison.chartType, "grouped_bar");
  assert.deepEqual(comparison.experiments.map((experiment) => [experiment.label, experiment.workbookName]), [
    ["Exp31", "Calculation Exp31.xlsx"],
    ["Exp32", "Calculation Exp32 rerun.xlsx"],
  ], "the most recently confirmed region wins when an experiment has several");
  assert.deepEqual(comparison.missingExperiments, [{ experimentId: "identity_33", label: "Exp33" }]);
  assert.deepEqual(comparison.warnings.map((warning) => warning.code), ["linked_data_multiple_regions"]);
  assert.equal(comparison.requestSummary, "Compare Carbon distribution across 2 experiments: Exp31, Exp32.");

  const plan = comparison.plan;
  assert.equal(plan.inputMode, "workbook");
  assert.equal(plan.sourceSelections.length, 2);
  assert.equal(plan.sourceSelections[0].regionUnderstandingRevisionId, comparison.experiments[0].revisionId);
  assert.equal(plan.sourceSelections[0].range, "P31:BA32");
  assert.equal(plan.reviewPlan.chart.chartType, "grouped_bar");
  assert.equal(plan.reviewPlan.chart.xDescription, "carbon number");
  assert.equal(plan.reviewPlan.chart.yDescription, "Overall carbon distribution (% of feed carbon)");
  assert.match(plan.reviewPlan.processingSteps[1], /header row of category labels is the x axis/);
  assert.match(plan.displayPlan.at(-1), /Not included \(no linked Carbon distribution\): Exp33/);
  assert.equal(plan.linkedDataComparison.experiments[1].sourceSelectionIndex, 1);

  // The same validation the reviewed chart path applies after selections resolve.
  const validation = validateAnalysisPlanRevision({
    ...plan,
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    sourceSelections: plan.sourceSelections.map((selection, index) => ({ ...selection, sourceSelectionId: `source_selection_${index + 1}` })),
  });
  assert.deepEqual(validation.errors, []);
});

test("buildLinkedDataComparison falls back to scatter for column-pair series and rejects unknown kinds or experiments", async () => {
  const store = await seededStore();
  const rate = await buildLinkedDataComparison({ store, projectId: "project_1", dataKind: "Reaction rate data", experimentIds: ["identity_31"] });
  assert.equal(rate.chartType, "grouped_bar", "regions without series metadata default to grouped bars");
  const explicit = await buildLinkedDataComparison({ store, projectId: "project_1", dataKind: "Reaction rate data", experimentIds: ["identity_31"], chartType: "scatter" });
  assert.equal(explicit.chartType, "scatter");
  await assert.rejects(() => buildLinkedDataComparison({ store, projectId: "project_1", dataKind: "Nothing", experimentIds: ["identity_31"] }), /No confirmed regions are linked as Nothing/);
  await assert.rejects(() => buildLinkedDataComparison({ store, projectId: "project_1", dataKind: "Carbon distribution", experimentIds: ["identity_missing"] }), /does not belong to this project/);
  await assert.rejects(() => buildLinkedDataComparison({ store, projectId: "project_1", dataKind: "Carbon distribution", experimentIds: [] }), /at least one experiment/);
});
