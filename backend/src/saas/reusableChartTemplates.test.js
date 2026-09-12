import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_RECIPE_SCHEMA_VERSION,
  buildChartStyleProfileVersion,
  buildReusableChartTemplateVersion,
  deriveReusableChartTemplateDefinition,
  inspectLinkedSeriesTemplateEligibility,
  inspectReusableChartTemplateEligibility,
  reusableChartTemplateSummary,
  validateChartStyleProfileVersion,
  validateReusableChartTemplateVersion,
} from "./reusableChartTemplates.js";

function eligibleFixture(overrides = {}) {
  const projectId = "project_1";
  const snapshot = {
    id: "snapshot_1",
    projectId,
    status: "accepted",
    experimentRecords: ["Exp1", "Exp2"].map((label, index) => ({
      experimentId: `experiment_${index + 1}`,
      label,
      fields: [{
        columnId: "column_yield",
        displayName: "Yield",
        valueType: "number",
        unit: "%",
        value: 80 + index,
      }],
      series: [],
    })),
  };
  const chartSpec = {
    id: "chart_spec_1",
    projectId,
    chartType: "bar",
    spec: {
      schemaVersion: "labrat.chartSpec.v3",
      origin: "analysis_result",
      status: "accepted",
      chartType: "bar",
      sourceSelections: [],
      experimentSelections: [0, 1].map((recordIndex) => ({
        experimentId: `experiment_${recordIndex + 1}`,
        columnIndexes: [0],
        includeSeries: false,
        baseHeadRef: { dataSnapshotId: snapshot.id, recordIndex },
      })),
      ...overrides.spec,
    },
    ...overrides.chartSpec,
  };
  const store = {
    async findDataSnapshotById(id) {
      return id === snapshot.id ? structuredClone(snapshot) : null;
    },
  };
  return { projectId, snapshot, chartSpec, store };
}

test("style profile versions normalize defaults and hash deterministically", () => {
  const first = buildChartStyleProfileVersion({
    definition: { palette: { colors: ["#112233", "#AABBCC"] } },
    version: 1,
  });
  const second = buildChartStyleProfileVersion({
    definition: { palette: { colors: ["#112233", "#aabbcc"] } },
    version: 9,
  });

  assert.equal(first.palette.colors[1], "#AABBCC");
  assert.equal(first.geometry.preferredPlotAreaWidthRatio, 0.76);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(validateChartStyleProfileVersion(first).contentHash, first.contentHash);
});

test("style profile versions reject geometry and typography that violate constraints", () => {
  assert.throws(
    () => buildChartStyleProfileVersion({
      definition: {
        typography: { minimumSizePt: 12, tickSizePt: 9 },
        geometry: { preferredPlotAreaWidthRatio: 0.6, minimumPlotAreaWidthRatio: 0.7 },
      },
    }),
    (error) => error.code === "chart_style_profile_invalid",
  );
});

test("eligible accepted scalar comparison derives a bounded deterministic template", async () => {
  const fixture = eligibleFixture();
  const definition = await deriveReusableChartTemplateDefinition({
    store: fixture.store,
    projectId: fixture.projectId,
    chartSpec: fixture.chartSpec,
    chartStyleProfileVersionId: "style_version_1",
  });
  const version = buildReusableChartTemplateVersion({ definition, version: 1 });

  assert.equal(version.recipe.schemaVersion, CHART_RECIPE_SCHEMA_VERSION);
  assert.deepEqual(version.experimentCardinality, { minimum: 1, recommendedMaximum: 6, hardMaximum: 12 });
  assert.equal(version.inputSlots[0].identityContract.preferredColumnId, "column_yield");
  assert.equal(version.encoding.comparisonMode, "grouped");
  assert.equal(version.missingDataPolicy.missingScalar, "block");
  assert.equal(validateReusableChartTemplateVersion(version).contentHash, version.contentHash);
});

test("eligible stacked comparison derives one reusable scalar slot per component", async () => {
  const fixture = eligibleFixture({
    spec: {
      plotly: { layout: { barmode: "stack" } },
      experimentSelections: [0, 1].map((recordIndex) => ({
        experimentId: `experiment_${recordIndex + 1}`,
        columnIndexes: [0, 1, 2],
        includeSeries: false,
        baseHeadRef: { dataSnapshotId: "snapshot_1", recordIndex },
      })),
    },
  });
  fixture.snapshot.experimentRecords.forEach((record, recordIndex) => {
    record.fields = ["Solid", "Liquid", "Gas"].map((displayName, columnIndex) => ({
      columnId: `column_${displayName.toLowerCase()}`,
      displayName,
      valueType: "number",
      unit: "%",
      value: 70 + recordIndex + columnIndex,
    }));
  });

  const definition = await deriveReusableChartTemplateDefinition({
    store: fixture.store,
    projectId: fixture.projectId,
    chartSpec: fixture.chartSpec,
  });

  assert.equal(definition.inputSlots.length, 3);
  assert.deepEqual(definition.inputSlots.map((slot) => slot.label), ["Solid", "Liquid", "Gas"]);
  assert.equal(definition.encoding.comparisonMode, "stacked_components");
  assert.equal(definition.encoding.colorBy, "component");
  assert.equal(definition.validation.eligibility, "direct_multi_scalar_comparison_v1");
});

test("template eligibility rejects workbook ranges, series, and mismatched scalar identities", async () => {
  const workbook = eligibleFixture({ spec: { sourceSelections: [{ range: "A1:B3" }] } });
  await assert.rejects(
    deriveReusableChartTemplateDefinition({ store: workbook.store, projectId: workbook.projectId, chartSpec: workbook.chartSpec }),
    (error) => error.code === "reusable_chart_template_not_eligible",
  );

  const series = eligibleFixture();
  series.chartSpec.spec.experimentSelections[0].includeSeries = true;
  series.snapshot.experimentRecords[0].series = [{ seriesKey: "rate", points: [{ x: 0, y: 1 }] }];
  await assert.rejects(
    deriveReusableChartTemplateDefinition({ store: series.store, projectId: series.projectId, chartSpec: series.chartSpec }),
    (error) => error.code === "reusable_chart_template_not_eligible",
  );

  const mismatch = eligibleFixture();
  mismatch.snapshot.experimentRecords[1].fields[0].columnId = "column_conversion";
  await assert.rejects(
    deriveReusableChartTemplateDefinition({ store: mismatch.store, projectId: mismatch.projectId, chartSpec: mismatch.chartSpec }),
    (error) => error.code === "reusable_chart_template_not_eligible",
  );
});

test("ignores an inert includeSeries flag and normalizes stacked bar encoding", async () => {
  const fixture = eligibleFixture({
    chartSpec: { chartType: "stacked_bar" },
    spec: {
      chartType: "stacked_bar",
      plotly: { layout: { barmode: "stack" } },
      experimentSelections: [0, 1].map((recordIndex) => ({
        experimentId: `experiment_${recordIndex + 1}`,
        columnIndexes: [0],
        includeSeries: true,
        baseHeadRef: { dataSnapshotId: "snapshot_1", recordIndex },
      })),
    },
  });

  const eligibility = await inspectReusableChartTemplateEligibility({
    store: fixture.store,
    projectId: fixture.projectId,
    chartSpec: fixture.chartSpec,
  });
  const definition = await deriveReusableChartTemplateDefinition({
    store: fixture.store,
    projectId: fixture.projectId,
    chartSpec: fixture.chartSpec,
  });

  assert.equal(eligibility.status, "eligible");
  assert.equal(definition.encoding.chartType, "bar");
  assert.equal(definition.encoding.comparisonMode, "stacked_components");
});

test("template eligibility names string-typed fields that require correction", async () => {
  const fixture = eligibleFixture();
  fixture.snapshot.experimentRecords.forEach((record) => {
    record.fields[0].valueType = "string";
    record.fields[0].value = String(record.fields[0].value);
  });
  await assert.rejects(
    deriveReusableChartTemplateDefinition({
      store: fixture.store,
      projectId: fixture.projectId,
      chartSpec: fixture.chartSpec,
    }),
    (error) => (
      error.code === "reusable_chart_template_field_type_incompatible"
      && /Yield is stored as string/.test(error.message)
    ),
  );
});

test("template eligibility reports every independently actionable blocker", async () => {
  const fixture = eligibleFixture({ spec: { sourceSelections: [{ range: "A1:B3" }] } });
  fixture.snapshot.experimentRecords[0].fields[0].valueType = "string";
  fixture.snapshot.experimentRecords[1].fields[0].columnId = "column_conversion";

  const result = await inspectReusableChartTemplateEligibility({
    store: fixture.store,
    projectId: fixture.projectId,
    chartSpec: fixture.chartSpec,
  });

  assert.equal(result.status, "ineligible");
  assert.deepEqual(result.blockers.map((item) => item.code), [
    "reusable_chart_template_workbook_inputs_unsupported",
    "reusable_chart_template_field_type_incompatible",
    "reusable_chart_template_field_contract_mismatch",
  ]);
});

function linkedSeriesFixture({ steps = null, secondUnit = "% of feed carbon", link = true, chartType = "grouped_bar", traceCount = 2, seriesCount = 1 } = {}) {
  const projectId = "project_1";
  const series = (unit) => Array.from({ length: seriesCount }, (_, index) => ({
    seriesKey: index ? `extra_${index}` : "carbon_distribution",
    label: "Overall carbon distribution",
    orientation: "header_row_categories",
    xHeaderRange: "Q31:BA31",
    yValueRange: "Q32:BA32",
    xSemanticKey: "carbon_number",
    xValueType: "number",
    yUnit: unit,
    yNumericScale: "percent_points",
    pointCount: 37,
  }));
  const regions = {
    region_31: { id: "region_31", projectId, disposition: "active", acceptedRevisionId: "rev_31", linkedExperimentId: link ? "identity_31" : null, dataKind: link ? "Carbon distribution" : null },
    region_32: { id: "region_32", projectId, disposition: "active", acceptedRevisionId: "rev_32", linkedExperimentId: "identity_32", dataKind: "Carbon distribution" },
  };
  const revisions = {
    rev_31: { id: "rev_31", regionId: "region_31", interpretation: { series: series("% of feed carbon") } },
    rev_32: { id: "rev_32", regionId: "region_32", interpretation: { series: series(secondUnit) } },
  };
  const planRevision = {
    id: "plan_rev_1",
    plan: {
      reviewPlan: {
        processingSteps: steps || [
          "Each input table is one experiment's confirmed Carbon distribution region; the table label is the experiment name.",
          "In each input table, the header row of category labels is the x axis and the row of numeric values beneath it is the y axis; ignore label cells and blanks.",
          "Plot one trace per experiment, named by its experiment label, sharing one x axis and one y axis.",
        ],
      },
      linkedDataComparison: { dataKind: "Carbon distribution" },
    },
  };
  const chartSpec = {
    id: "chart_spec_linked",
    projectId,
    chartType,
    spec: {
      schemaVersion: "labrat.chartSpec.v3",
      origin: "analysis_result",
      status: "accepted",
      chartType,
      analysisPlanRevisionId: "plan_rev_1",
      sourceSelections: [
        { sourceSelectionId: "s1", regionUnderstandingRevisionId: "rev_31", sourceDocumentId: "doc_31", sheetName: "Sheet1", range: "P31:BA32" },
        { sourceSelectionId: "s2", regionUnderstandingRevisionId: "rev_32", sourceDocumentId: "doc_32", sheetName: "Sheet1", range: "P31:BA32" },
      ],
      experimentSelections: [],
      traceCatalog: Array.from({ length: traceCount }, (_, index) => ({ traceId: `trace_${index}` })),
    },
  };
  const store = {
    async findRegionUnderstandingRevisionById(id) { return revisions[id] ? structuredClone(revisions[id]) : null; },
    async findWorkbookReviewRegionById(id) { return regions[id] ? structuredClone(regions[id]) : null; },
    async findAnalysisPlanRevisionById(id) { return id === planRevision.id ? structuredClone(planRevision) : null; },
    async findDataSnapshotById() { return null; },
  };
  return { projectId, chartSpec, store };
}

test("an accepted linked-data comparison chart derives a workbook series template bound to its data kind", async () => {
  const fixture = linkedSeriesFixture();
  const eligibility = await inspectReusableChartTemplateEligibility(fixture);
  assert.deepEqual(eligibility, { status: "eligible", blockers: [], eligibility: "linked_series_comparison_v1" });

  const definition = await deriveReusableChartTemplateDefinition(fixture);
  assert.equal(definition.inputSlots.length, 1);
  const slot = definition.inputSlots[0];
  assert.equal(slot.sourceKind, "linked_region");
  assert.equal(slot.linkedDataKind, "Carbon distribution");
  assert.equal(slot.dataKind, "series");
  assert.equal(slot.label, "Overall carbon distribution");
  assert.deepEqual(slot.unitContract.allowedUnits, ["% of feed carbon"]);
  assert.deepEqual(slot.seriesContract, { orientation: "header_row_categories", xMeaning: "carbon_number", xValueType: "number", yNumericScale: "percent_points", alignmentPolicy: "union_with_gaps" });
  assert.match(slot.identityContract.sourceSignature, /^sha256_[0-9a-f]{16,}$/i);
  assert.deepEqual(definition.recipe.operations.map((operation) => operation.op), ["select_series", "align_x", "filter_missing"]);
  assert.deepEqual(definition.encoding, { chartType: "bar", comparisonMode: "grouped", xRole: "category", yRole: "value", colorBy: "experiment", sourceChartType: "grouped_bar" });
  assert.equal(definition.missingDataPolicy.missingSeries, "exclude_experiment");
  assert.equal(definition.validation.eligibility, "linked_series_comparison_v1");

  const version = validateReusableChartTemplateVersion({ ...definition, schemaVersion: "labrat.reusableChartTemplateVersion.v1", version: 1 });
  assert.equal(version.inputSlots[0].sourceKind, "linked_region");
  assert.equal(version.inputSlots[0].linkedDataKind, "Carbon distribution");
  assert.equal(version.inputSlots[0].seriesContract.orientation, "header_row_categories");
  assert.match(version.contentHash, /^sha256_[0-9a-f]+$/i);
  const summary = reusableChartTemplateSummary({ id: "t", schemaVersion: "s", name: "Carbon distribution", status: "active", currentVersionId: "v", updatedAt: "now" }, version);
  assert.equal(summary.sourceKind, "linked_region");
  assert.equal(summary.linkedDataKind, "Carbon distribution");

  const scatter = linkedSeriesFixture({ chartType: "scatter" });
  const overlay = await deriveReusableChartTemplateDefinition(scatter);
  assert.equal(overlay.encoding.comparisonMode, "overlay");
  assert.equal(overlay.encoding.chartType, "scatter");
});

test("workbook charts whose plan recomputed values, mixed units, or used unlinked regions are refused with reasons", async () => {
  const recomputed = linkedSeriesFixture({ steps: ["For each experiment, the hydrocarbon component area measurements will be weighted by their respective C-Response calibration factors and normalized to percentages."] });
  const recomputedEligibility = await inspectLinkedSeriesTemplateEligibility(recomputed);
  assert.equal(recomputedEligibility.status, "ineligible");
  assert.deepEqual(recomputedEligibility.blockers.map((blocker) => blocker.code), ["reusable_chart_template_workbook_recomputation"]);
  await assert.rejects(deriveReusableChartTemplateDefinition(recomputed), (error) => error.code === "reusable_chart_template_not_eligible" && error.details.blockers[0].code === "reusable_chart_template_workbook_recomputation");

  const mixedUnits = await inspectLinkedSeriesTemplateEligibility(linkedSeriesFixture({ secondUnit: "mol%" }));
  assert.deepEqual(mixedUnits.blockers.map((blocker) => blocker.code), ["reusable_chart_template_series_contract_mismatch"]);
  assert.match(mixedUnits.blockers[0].message, /% of feed carbon, mol%/);

  const unlinked = await inspectLinkedSeriesTemplateEligibility(linkedSeriesFixture({ link: false }));
  assert.deepEqual(unlinked.blockers.map((blocker) => blocker.code), ["reusable_chart_template_linked_regions_required"]);

  const stacked = await inspectLinkedSeriesTemplateEligibility(linkedSeriesFixture({ chartType: "stacked_bar" }));
  assert.deepEqual(stacked.blockers.map((blocker) => blocker.code), ["reusable_chart_template_encoding_unsupported"]);

  const extraTraces = await inspectLinkedSeriesTemplateEligibility(linkedSeriesFixture({ traceCount: 4 }));
  assert.deepEqual(extraTraces.blockers.map((blocker) => blocker.code), ["reusable_chart_template_workbook_recomputation"]);

  const twoSeries = await inspectLinkedSeriesTemplateEligibility(linkedSeriesFixture({ seriesCount: 2 }));
  assert.deepEqual(twoSeries.blockers.map((blocker) => blocker.code), ["reusable_chart_template_series_contract_mismatch"]);
});

test("template version validation rejects linked-region slots without a data kind or orientation and keeps snapshot slots unchanged", async () => {
  const fixture = linkedSeriesFixture();
  const definition = await deriveReusableChartTemplateDefinition(fixture);
  const versionOf = (patch) => validateReusableChartTemplateVersion({
    ...definition,
    schemaVersion: "labrat.reusableChartTemplateVersion.v1",
    version: 1,
    inputSlots: [{ ...definition.inputSlots[0], ...patch }],
  });
  assert.throws(() => versionOf({ linkedDataKind: "" }), /requires the linked data kind/);
  assert.throws(() => versionOf({ dataKind: "scalar" }), /must be a series slot/);
  assert.throws(() => versionOf({ seriesContract: { ...definition.inputSlots[0].seriesContract, orientation: "" } }), /requires a series orientation/);
  assert.throws(() => versionOf({ sourceKind: "elsewhere" }), /unsupported source kind/);
  const scalar = eligibleFixture();
  const scalarDefinition = await deriveReusableChartTemplateDefinition({ store: scalar.store, projectId: scalar.projectId, chartSpec: scalar.chartSpec });
  const scalarVersion = validateReusableChartTemplateVersion({ ...scalarDefinition, schemaVersion: "labrat.reusableChartTemplateVersion.v1", version: 1 });
  assert.equal(scalarVersion.inputSlots[0].sourceKind, "snapshot");
  assert.equal("linkedDataKind" in scalarVersion.inputSlots[0], false);
});
