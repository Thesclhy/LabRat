import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";
import { buildRegionExtractionTemplateVersion, matchTemplateVersionToDocument } from "./regionExtractionTemplates.js";
import {
  applyTemplateMatch,
  confirmTemplateRegionsBatch,
  prefilledInterpretationPatch,
  resolveExperimentLink,
} from "./regionTemplateApplications.js";

function cell(address, rawValue, extra = {}) {
  const type = extra.formula ? "formula" : typeof rawValue === "number" ? "number" : "string";
  return { address, rawValue, formattedValue: rawValue == null ? null : String(rawValue), type, formula: null, ...extra };
}

function calculationCells(label) {
  const cells = [
    cell("A1", "Filename"), cell("A2", label), cell("A11", 22.03), cell("A12", "Total C atoms"), cell("B12", 1.57, { formula: "A11/28.05*2" }),
    cell("E14", "Yield"), cell("P28", "Total C (liq)"), cell("P31", "Overall tots"),
  ];
  const columns = ["Q", "R", "S", "T", "U"];
  const gasColumns = ["F", "G", "H", "I", "J"];
  columns.forEach((col, index) => {
    const gas = gasColumns[index];
    cells.push(cell(`${gas}6`, 0.001 * (index + 1)));
    cells.push(cell(`${gas}14`, 0.1 * (index + 1), { formula: `${gas}6/B12*100` }));
    cells.push(cell(`${col}31`, `C${index + 1}`));
    cells.push(cell(`${col}32`, 0.1 * (index + 1), { formula: `${gas}14` }));
  });
  return cells;
}

function documentFixture(id, label, workbookName) {
  return {
    sourceDocument: { id, labId: "lab_1", projectId: "project_1", fileObjectId: `file_${id}`, importRunId: `run_${id}`, metadata: { workbookName, sheets: [{ name: "Sheet1", usedRange: "A1:U32" }] } },
    indexBlobs: [{ payload: { sheets: [{ name: "Sheet1", cellGrid: { range: "A1:U32", cells: calculationCells(label) } }] } }],
  };
}

const project = { id: "project_1", labId: "lab_1" };

const templateRevision = {
  id: "revision_template",
  regionId: "region_template",
  interpretation: {
    semanticType: "component_distribution",
    experimentAxis: "region",
    headerRow: 31,
    experimentLabel: "Exp31",
    fields: [],
    series: [{
      seriesKey: "carbon_distribution", label: "Overall carbon distribution", orientation: "header_row_categories",
      xHeaderRange: "Q31:U31", yValueRange: "Q32:U32", xSemanticKey: "carbon_number", ySemanticKey: "carbon_distribution",
      xValueType: "number", yUnit: "% of feed carbon", yNumericScale: "percent_points",
    }],
    inclusion: { startRow: 32, endRow: 32 },
  },
};

function templateFixture() {
  const source = documentFixture("doc_31", "Exp31", "Calculation Exp31.xlsx");
  const version = {
    id: "template_version_1",
    regionExtractionTemplateId: "template_1",
    ...buildRegionExtractionTemplateVersion({
      sourceDocument: source.sourceDocument,
      indexBlobs: source.indexBlobs,
      region: { id: "region_template", sourceDocumentId: "doc_31", sheetName: "Sheet1", rangeRef: "P31:U32", acceptedRevisionId: "revision_template" },
      revision: templateRevision,
      version: 1,
    }),
  };
  return { template: { id: "template_1", name: "Carbon distribution", status: "active" }, version };
}

test("resolveExperimentLink resolves exactly one identity and reports ambiguity or none", () => {
  const identities = [
    { id: "id_31", canonicalLabel: "Exp31", aliases: [] },
    { id: "id_32a", canonicalLabel: "Exp32", aliases: [] },
    { id: "id_32b", canonicalLabel: "EXP-32", aliases: [] },
  ];
  assert.deepEqual(resolveExperimentLink({ identities, experimentLabel: "exp 31" }), { linkedExperimentId: "id_31", linkStatus: "resolved", candidates: [{ experimentId: "id_31", label: "Exp31" }] });
  assert.equal(resolveExperimentLink({ identities, experimentLabel: "Exp32" }).linkStatus, "ambiguous");
  assert.equal(resolveExperimentLink({ identities, experimentLabel: "Exp40" }).linkStatus, "unresolved");
  assert.equal(resolveExperimentLink({ identities, experimentLabel: "" }).linkStatus, "none");
});

test("prefilledInterpretationPatch rebases template semantics onto the matched range", () => {
  const { version } = templateFixture();
  const patch = prefilledInterpretationPatch({ templateVersion: version, matchedRange: "P33:U34", experimentLabel: "Exp34" });
  assert.equal(patch.decisionSource, "template_match");
  assert.equal(patch.experimentAxis, "region");
  assert.equal(patch.headerRow, 33);
  assert.equal(patch.experimentLabel, "Exp34");
  assert.deepEqual(patch.seriesPatches, [{
    seriesKey: "carbon_distribution", label: "Overall carbon distribution", orientation: "header_row_categories",
    xHeaderRange: "Q33:U33", yValueRange: "Q34:U34", xMeaning: "carbon_number", xValueType: "number",
    yUnit: "% of feed carbon", yNumericScale: "percent_points",
  }]);
  assert.deepEqual(patch.inclusion, { startRow: 34, endRow: 34 });
});

test("applyTemplateMatch creates a session, a prefilled linked region, and a template_match revision, and is idempotent", async () => {
  const store = new MemorySaasStore();
  const { template, version } = templateFixture();
  const other = documentFixture("doc_32", "Exp32", "Calculation Exp32.xlsx");
  store.sourceDocuments?.set?.("doc_32", other.sourceDocument);
  const identities = [{ id: "identity_32", projectId: "project_1", labId: "lab_1", canonicalLabel: "Exp32", aliases: [] }];
  const report = matchTemplateVersionToDocument({ templateVersion: version, sourceDocument: other.sourceDocument, indexBlobs: other.indexBlobs });
  assert.equal(report.status, "exact");

  const first = await applyTemplateMatch({
    store, project, actorUserId: "user_1", template, templateVersion: version,
    sourceDocument: other.sourceDocument, indexBlobs: other.indexBlobs, report, identities, idempotencyKey: "apply_1",
  });
  assert.equal(first.created, true);
  assert.equal(first.sessionCreated, true);
  assert.equal(first.region.selectionMethod, "template_match");
  assert.equal(first.region.reviewStatus, "awaiting_review");
  assert.equal(first.region.rangeRef, "P31:U32");
  assert.equal(first.region.linkedExperimentId, "identity_32");
  assert.equal(first.region.dataKind, "Carbon distribution");
  assert.equal(first.region.regionExtractionTemplateVersionId, "template_version_1");
  assert.deepEqual(first.region.templateMatch.linkStatus, "resolved");
  assert.equal(first.revision.trigger, "template_match");
  assert.equal(first.revision.revisionNumber, 1);
  assert.match(first.revision.summary[0], /Prefilled from extraction template Carbon distribution v1/);
  assert.match(first.revision.summary[2], /Linked to experiment Exp32/);
  assert.equal(first.revision.interpretation.experimentLabel, "Exp32");
  const series = first.revision.interpretation.series.find((item) => item.seriesKey === "carbon_distribution");
  assert.equal(series.xHeaderRange, "Q31:U31");
  assert.equal(series.pointCount, 5);
  assert.equal(first.revision.interpretation.provenance.cellClassSummary.terminal, 5);
  assert.deepEqual(first.revision.validation.blockers, []);
  assert.equal(first.revision.provider.provider, "template_match");

  const again = await applyTemplateMatch({
    store, project, actorUserId: "user_1", template, templateVersion: version,
    sourceDocument: other.sourceDocument, indexBlobs: other.indexBlobs, report, identities, idempotencyKey: "apply_2",
  });
  assert.equal(again.created, false);
  assert.equal(again.reason, "already_applied");
  assert.equal(again.region.id, first.region.id);
  const regions = await store.listWorkbookReviewRegions({ workbookReviewSessionId: first.session.id });
  assert.equal(regions.filter((region) => region.selectionMethod === "template_match").length, 1);
});

test("applyTemplateMatch skips non-eligible reports and existing manual regions at the same range", async () => {
  const store = new MemorySaasStore();
  const { template, version } = templateFixture();
  const other = documentFixture("doc_33", "Exp33", "Calculation Exp33.xlsx");
  const report = matchTemplateVersionToDocument({ templateVersion: version, sourceDocument: other.sourceDocument, indexBlobs: other.indexBlobs });
  const notEligible = await applyTemplateMatch({ store, project, template, templateVersion: version, sourceDocument: other.sourceDocument, indexBlobs: other.indexBlobs, report: { ...report, status: "formula_mismatch" } });
  assert.deepEqual(notEligible, { skipped: true, reason: "not_eligible", status: "formula_mismatch", sourceDocumentId: "doc_33" });

  const session = await store.createWorkbookReviewSession({ labId: "lab_1", projectId: "project_1", sourceDocumentId: "doc_33", workbookSummary: { workbookName: "Calculation Exp33.xlsx" }, status: "needs_user_review", createdBy: "user_1" });
  const manual = await store.createWorkbookReviewRegion({ labId: "lab_1", projectId: "project_1", workbookReviewSessionId: session.id, sourceDocumentId: "doc_33", sheetName: "Sheet1", rangeRef: "P31:U32", selectionMethod: "manual", disposition: "active", reviewStatus: "awaiting_review", createdBy: "user_1" });
  const collides = await applyTemplateMatch({ store, project, template, templateVersion: version, sourceDocument: other.sourceDocument, indexBlobs: other.indexBlobs, report });
  assert.equal(collides.skipped, true);
  assert.equal(collides.reason, "region_exists");
  assert.equal(collides.region.id, manual.id);
});

test("confirmTemplateRegionsBatch confirms only template-matched regions, applies chosen links, and isolates failures", async () => {
  const store = new MemorySaasStore();
  const { template, version } = templateFixture();
  const identities = [{ id: "identity_34", projectId: "project_1", labId: "lab_1", canonicalLabel: "Exp34", aliases: [] }];
  const docA = documentFixture("doc_34", "Exp34", "Calculation Exp34.xlsx");
  const docB = documentFixture("doc_99", "Exp99", "Calculation Exp99.xlsx");
  const appliedA = await applyTemplateMatch({ store, project, actorUserId: "user_1", template, templateVersion: version, sourceDocument: docA.sourceDocument, indexBlobs: docA.indexBlobs, report: matchTemplateVersionToDocument({ templateVersion: version, sourceDocument: docA.sourceDocument, indexBlobs: docA.indexBlobs }), identities });
  const appliedB = await applyTemplateMatch({ store, project, actorUserId: "user_1", template, templateVersion: version, sourceDocument: docB.sourceDocument, indexBlobs: docB.indexBlobs, report: matchTemplateVersionToDocument({ templateVersion: version, sourceDocument: docB.sourceDocument, indexBlobs: docB.indexBlobs }), identities });
  assert.equal(appliedA.region.linkedExperimentId, "identity_34");
  assert.equal(appliedB.region.linkedExperimentId, null);
  assert.equal(appliedB.region.templateMatch.linkStatus, "unresolved");

  const session = await store.createWorkbookReviewSession({ labId: "lab_1", projectId: "project_1", sourceDocumentId: "doc_manual", workbookSummary: { workbookName: "Manual.xlsx" }, status: "needs_user_review", createdBy: "user_1" });
  const manual = await store.createWorkbookReviewRegion({ labId: "lab_1", projectId: "project_1", workbookReviewSessionId: session.id, sourceDocumentId: "doc_manual", sheetName: "Sheet1", rangeRef: "A1:B2", selectionMethod: "manual", disposition: "active", reviewStatus: "awaiting_review", createdBy: "user_1" });

  const outcome = await confirmTemplateRegionsBatch({
    store, project, actorUserId: "user_2", identities,
    items: [
      { regionId: appliedA.region.id, revisionId: appliedA.revision.id, expectedRegionVersion: appliedA.region.version },
      { regionId: appliedB.region.id, revisionId: appliedB.revision.id, expectedRegionVersion: appliedB.region.version, linkedExperimentId: "identity_34" },
      { regionId: manual.id, revisionId: null, expectedRegionVersion: manual.version },
      { regionId: appliedA.region.id, revisionId: appliedA.revision.id, expectedRegionVersion: 1 },
    ],
  });
  assert.equal(outcome.confirmedCount, 2);
  assert.equal(outcome.rejectedCount, 2);
  assert.equal(outcome.results[0].ok, true);
  assert.equal(outcome.results[0].region.reviewStatus, "accepted");
  assert.equal(outcome.results[0].region.acceptedBy, "user_2");
  assert.equal(outcome.results[1].ok, true);
  assert.equal(outcome.results[1].region.linkedExperimentId, "identity_34");
  assert.equal(outcome.results[1].region.templateMatch.linkStatus, "resolved");
  assert.equal(outcome.results[2].ok, false);
  assert.equal(outcome.results[2].code, "batch_confirm_requires_individual_review");
  assert.equal(outcome.results[3].ok, false);
  assert.equal(outcome.results[3].code, "stale_workbook_review_region");
});
