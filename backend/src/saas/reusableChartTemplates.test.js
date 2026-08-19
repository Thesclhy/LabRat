import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_RECIPE_SCHEMA_VERSION,
  buildChartStyleProfileVersion,
  buildReusableChartTemplateVersion,
  deriveReusableChartTemplateDefinition,
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
