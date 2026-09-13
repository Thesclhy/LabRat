import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";
import { readLinkedRegionSeries, resolveLinkedRegionsForExperiments } from "./linkedRegionSeries.js";

function cell(address, rawValue, extra = {}) {
  const type = extra.type || (extra.formula ? "formula" : typeof rawValue === "number" ? "number" : "string");
  return { address, rawValue, formattedValue: extra.formattedValue ?? (rawValue == null ? null : String(rawValue)), type, formula: extra.formula || null };
}

function seedDocument(store, id, cells) {
  store.sourceDocuments.set(id, { id, projectId: "project_1", labId: "lab_1", fileObjectId: `file_${id}`, metadata: { workbookName: `${id}.xlsx` } });
  store.sourceIndexBlobs.set(`blob_${id}`, { id: `blob_${id}`, sourceDocumentId: id, payload: { sheets: [{ name: "Sheet1", cellGrid: { range: "A1:H40", cells } }] } });
}

async function seedLinkedRegion(store, { id, experimentId, dataKind, range, series, headerRow = null, inclusion = null, acceptedAt = "2026-09-09T10:00:00.000Z", disposition = "active" }) {
  const session = await store.createWorkbookReviewSession({ labId: "lab_1", projectId: "project_1", sourceDocumentId: id, workbookSummary: { workbookName: `${id}.xlsx` }, status: "needs_user_review", createdBy: "user_1" });
  const region = await store.createWorkbookReviewRegion({
    labId: "lab_1", projectId: "project_1", workbookReviewSessionId: session.id, sourceDocumentId: id,
    sheetName: "Sheet1", rangeRef: range, selectionMethod: "template_match", disposition: "active", reviewStatus: "awaiting_review",
    linkedExperimentId: experimentId, dataKind, createdBy: "user_1",
  });
  const revision = await store.createRegionUnderstandingRevision({
    labId: "lab_1", projectId: "project_1", workbookReviewSessionId: session.id, sourceDocumentId: id, regionId: region.id,
    revisionNumber: 1, trigger: "template_match", summary: ["Prefilled."], sourceContentHash: `h_${id}`, dependencyHash: `d_${id}`,
    interpretation: { semanticType: "component_distribution", experimentAxis: "region", ...(headerRow ? { headerRow } : {}), ...(inclusion ? { inclusion } : {}), fields: [], series },
    validation: { status: "ready", blockers: [] }, createdBy: "user_1",
  });
  await store.updateWorkbookReviewRegion(region.id, { reviewStatus: "accepted", currentRevisionId: revision.id, acceptedRevisionId: revision.id, acceptedAt, acceptedBy: "user_1", ...(disposition !== "active" ? { disposition } : {}) });
  return { region, revision, session };
}

const headerRowSeries = [{ seriesKey: "carbon_distribution", label: "Overall carbon distribution", orientation: "header_row_categories", xHeaderRange: "B1:F1", yValueRange: "B2:F2", xSemanticKey: "carbon_number", yUnit: "% of feed carbon", yNumericScale: "percent_points" }];

test("readLinkedRegionSeries reads header-row categories with blanks, text, and Excel errors as missing points", async () => {
  const store = new MemorySaasStore();
  seedDocument(store, "doc_31", [
    cell("A1", "Overall tots"), cell("B1", "C1"), cell("C1", "C2"), cell("D1", "C3"), cell("E1", "C4"), cell("F1", "C5"),
    cell("B2", 0.52, { formula: "F14" }), cell("C2", "0.14", { type: "string" }), cell("D2", null, { type: "error", formattedValue: "#DIV/0!", formula: "H14" }), cell("F2", "n/a"),
  ]);
  const read = await readLinkedRegionSeries({ store, projectId: "project_1", region: { sourceDocumentId: "doc_31", sheetName: "Sheet1", range: "A1:F2" }, series: headerRowSeries[0] });
  assert.equal(read.orientation, "header_row_categories");
  assert.deepEqual(read.xLabels, ["C1", "C2", "C3", "C4", "C5"]);
  assert.deepEqual(read.points.map((point) => [point.x, point.y, point.missingReason]), [
    ["C1", 0.52, null],
    ["C2", 0.14, null],
    ["C3", null, "excel_error"],
    ["C4", null, "blank"],
    ["C5", null, "non_numeric"],
  ]);
  assert.equal(read.points[0].yCell, "B2");
  assert.equal(read.valueCount, 2);
  assert.equal(read.missingCount, 3);
  assert.equal(read.yUnit, "% of feed carbon");
  assert.deepEqual(read.sourceRefs.map((ref) => ref.range), ["B1:F1", "B2:F2"]);
});

test("readLinkedRegionSeries reads column pairs inside the accepted inclusion rows and refuses ranges outside the region", async () => {
  const store = new MemorySaasStore();
  seedDocument(store, "doc_rate", [
    cell("A1", "time"), cell("B1", "rate"),
    cell("A2", 0), cell("B2", 1.5), cell("A3", 5), cell("B3", 2.5), cell("A4", "x"), cell("B4", 3.5), cell("A5", 10), cell("B5", null, { type: "error", formattedValue: "#N/A" }),
  ]);
  const series = { seriesKey: "rate", label: "Rate", orientation: "column_pair", xColumn: "A", yColumn: "B", xSemanticKey: "time", yUnit: "mol/g/h" };
  const read = await readLinkedRegionSeries({ store, projectId: "project_1", region: { sourceDocumentId: "doc_rate", sheetName: "Sheet1", range: "A1:B5" }, series, headerRow: 1, inclusion: { startRow: 2, endRow: 5 } });
  assert.deepEqual(read.points.map((point) => [point.x, point.y, point.missingReason]), [
    [0, 1.5, null], [5, 2.5, null], [null, null, "x_non_numeric"], [10, null, "excel_error"],
  ]);
  assert.equal(read.valueCount, 2);
  await assert.rejects(
    () => readLinkedRegionSeries({ store, projectId: "project_1", region: { sourceDocumentId: "doc_rate", sheetName: "Sheet1", range: "A1:B3" }, series: headerRowSeries[0] }),
    (error) => error.code === "chart_template_series_outside_region",
  );
  await assert.rejects(
    () => readLinkedRegionSeries({ store, projectId: "project_1", region: { sourceDocumentId: "doc_rate", sheetName: "Sheet1", range: "A1:B5" }, series, headerRow: 1, inclusion: { startRow: 2, endRow: 5 }, maxCells: 2 }),
    (error) => error.code === "chart_template_range_too_large",
  );
});

test("resolveLinkedRegionsForExperiments prefers the newest region, reports missing and deleted data, and flags unknown experiments", async () => {
  const store = new MemorySaasStore();
  for (const [id, label] of [["31", "Exp31"], ["32", "Exp32"], ["33", "Exp33"], ["34", "Exp34"]]) {
    store.experimentIdentities.set(`identity_${id}`, { id: `identity_${id}`, projectId: "project_1", labId: "lab_1", canonicalLabel: label, aliases: [] });
  }
  for (const id of ["doc_31", "doc_32", "doc_32b", "doc_34"]) seedDocument(store, id, [cell("B1", "C1"), cell("B2", 1)]);
  await seedLinkedRegion(store, { id: "doc_31", experimentId: "identity_31", dataKind: "Carbon distribution", range: "A1:F2", series: headerRowSeries });
  await seedLinkedRegion(store, { id: "doc_32", experimentId: "identity_32", dataKind: "Carbon distribution", range: "A1:F2", series: headerRowSeries });
  await seedLinkedRegion(store, { id: "doc_32b", experimentId: "identity_32", dataKind: "Carbon distribution", range: "A1:F2", series: headerRowSeries, acceptedAt: "2026-09-11T10:00:00.000Z" });
  await seedLinkedRegion(store, { id: "doc_34", experimentId: "identity_34", dataKind: "Carbon distribution", range: "A1:F2", series: headerRowSeries, disposition: "deleted" });

  const resolved = await resolveLinkedRegionsForExperiments({ store, projectId: "project_1", dataKind: "carbon distribution", experimentIds: ["identity_31", "identity_32", "identity_33", "identity_34", "identity_ghost"] });
  assert.equal(resolved.kindFound, true);
  assert.equal(resolved.dataKind, "Carbon distribution");
  assert.deepEqual(resolved.experiments.map((item) => [item.label, item.sourceDocumentId, item.alternativeRegionIds.length]), [["Exp31", "doc_31", 0], ["Exp32", "doc_32b", 1]]);
  assert.deepEqual(resolved.missingExperiments, [
    { experimentId: "identity_33", label: "Exp33", reason: "missing_data_kind" },
    { experimentId: "identity_34", label: "Exp34", reason: "session_deleted" },
  ]);
  assert.deepEqual(resolved.unknownExperimentIds, ["identity_ghost"]);
  const none = await resolveLinkedRegionsForExperiments({ store, projectId: "project_1", dataKind: "Nothing", experimentIds: ["identity_31"] });
  assert.equal(none.kindFound, false);
  assert.equal(none.missingExperiments.length, 1);
});
