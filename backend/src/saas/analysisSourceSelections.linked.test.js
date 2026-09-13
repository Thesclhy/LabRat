import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";
import { confirmedSourceRegionCatalog } from "./analysisSourceSelections.js";

test("the chart planner catalogue carries experiment links, data kinds, and header-row series", async () => {
  const store = new MemorySaasStore();
  store.experimentIdentities.set("identity_31", { id: "identity_31", projectId: "project_1", labId: "lab_1", canonicalLabel: "Exp31", aliases: [] });
  store.sourceDocuments.set("doc_31", { id: "doc_31", projectId: "project_1", labId: "lab_1", fileObjectId: "file_31", metadata: { workbookName: "Calculation Exp31.xlsx" } });
  const session = await store.createWorkbookReviewSession({ labId: "lab_1", projectId: "project_1", sourceDocumentId: "doc_31", workbookSummary: { workbookName: "Calculation Exp31.xlsx" }, status: "needs_user_review", createdBy: "user_1" });
  const region = await store.createWorkbookReviewRegion({
    labId: "lab_1", projectId: "project_1", workbookReviewSessionId: session.id, sourceDocumentId: "doc_31",
    sheetName: "Sheet1", rangeRef: "P31:BA32", selectionMethod: "template_match", disposition: "active", reviewStatus: "awaiting_review",
    linkedExperimentId: "identity_31", dataKind: "Carbon distribution", createdBy: "user_1",
  });
  const revision = await store.createRegionUnderstandingRevision({
    labId: "lab_1", projectId: "project_1", workbookReviewSessionId: session.id, sourceDocumentId: "doc_31", regionId: region.id,
    revisionNumber: 1, trigger: "template_match", summary: ["Prefilled."], sourceContentHash: "h1", dependencyHash: "h2",
    interpretation: {
      semanticType: "component_distribution", experimentAxis: "region", experimentLabel: "Exp31", fields: [],
      series: [{ seriesKey: "carbon_distribution", label: "Overall carbon distribution", orientation: "header_row_categories", xHeaderRange: "Q31:BA31", yValueRange: "Q32:BA32", xSemanticKey: "carbon_number", yUnit: "% of feed carbon", yNumericScale: "percent_points", pointCount: 37 }],
    },
    validation: { status: "ready", blockers: [] }, createdBy: "user_1",
  });
  await store.updateWorkbookReviewRegion(region.id, { reviewStatus: "accepted", currentRevisionId: revision.id, acceptedRevisionId: revision.id, acceptedAt: "2026-09-09T00:00:00.000Z", acceptedBy: "user_1" });

  const catalog = await confirmedSourceRegionCatalog({ store, projectId: "project_1" });
  assert.equal(catalog.length, 1);
  const [entry] = catalog;
  assert.equal(entry.linkedExperimentId, "identity_31");
  assert.equal(entry.linkedExperimentLabel, "Exp31");
  assert.equal(entry.dataKind, "Carbon distribution");
  assert.deepEqual(entry.series, [{
    seriesKey: "carbon_distribution", label: "Overall carbon distribution", orientation: "header_row_categories",
    xColumn: "", yColumn: "", xHeaderRange: "Q31:BA31", yValueRange: "Q32:BA32", xSemanticKey: "carbon_number",
    xUnit: null, yUnit: "% of feed carbon", yNumericScale: "percent_points", pointCount: 37,
  }]);
});
