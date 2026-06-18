import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decorateObservationSeriesStaleness,
  deriveObservationSeriesFromDatasetCommit,
} from "./observationSeries.js";

test("deriveObservationSeriesFromDatasetCommit creates reaction-rate y-field series", () => {
  const datasetCommit = {
    id: "commit_1",
    labId: "lab_1",
    projectId: "project_1",
    datasetPayload: {
      genericImports: [
        {
          importId: "master_import",
          experiments: [{ experimentId: "exp_30", label: "Exp30" }],
        },
        {
          importId: "rate_import",
          fileName: "Reaction_Rate_Exp30.xlsx",
          relatedExperimentIds: ["exp_30"],
          observationSets: [{
            observationSetId: "obsset_rate_30",
            kind: "reaction_rate_time_series",
            inferredExperimentLabel: "Exp30",
            targetExperimentIds: ["exp_30"],
            xField: "reaction_time_min",
            yFields: ["adjusted_rate_m_s", "rate_mol_s"],
            fields: [
              { field: "reaction_time_min", key: "reactionTimeMin", displayName: "Reaction Time (min)", unit: "min" },
              { field: "adjusted_rate_m_s", key: "adjustedRateMPerS", displayName: "Adjusted Rate (M/s)", unit: "M/s" },
              { field: "rate_mol_s", key: "rateMolPerS", displayName: "Rate (mol/s)", unit: "mol/s" },
            ],
            observations: [
              { observationId: "obs_1", reactionTimeMin: 0, adjustedRateMPerS: 0.1, rateMolPerS: 0.01, sourceRefs: ["src_1"] },
              { observationId: "obs_2", reactionTimeMin: 10, adjustedRateMPerS: 0.2, rateMolPerS: 0.02, sourceRefs: ["src_2"] },
              { observationId: "obs_3", reactionTimeMin: null, adjustedRateMPerS: 0.3, rateMolPerS: 0.03, sourceRefs: ["src_3"] },
            ],
          }],
        },
      ],
    },
  };

  const series = deriveObservationSeriesFromDatasetCommit({ datasetCommit });
  assert.equal(series.length, 2);
  const adjusted = series.find((item) => item.yField === "adjusted_rate_m_s");
  assert.ok(adjusted);
  assert.equal(adjusted.schemaVersion, "labrat.observationSeries.v1");
  assert.equal(adjusted.datasetCommitId, "commit_1");
  assert.equal(adjusted.sourceImportId, "rate_import");
  assert.equal(adjusted.observationSetId, "obsset_rate_30");
  assert.equal(adjusted.experimentId, "exp_30");
  assert.equal(adjusted.experimentLabel, "Exp30");
  assert.equal(adjusted.seriesKind, "reaction_rate_time_series");
  assert.equal(adjusted.xField, "reaction_time_min");
  assert.equal(adjusted.xKey, "reactionTimeMin");
  assert.equal(adjusted.xUnit, "min");
  assert.equal(adjusted.yKey, "adjustedRateMPerS");
  assert.equal(adjusted.yUnit, "M/s");
  assert.deepEqual(adjusted.sourceRefs, ["src_1", "src_2"]);
  assert.deepEqual(adjusted.summary, {
    pointCount: 2,
    xMin: 0,
    xMax: 10,
    yMin: 0.1,
    yMax: 0.2,
    observationCount: 3,
    sourceFileName: "Reaction_Rate_Exp30.xlsx",
    sourceSheetName: null,
  });
});

test("decorateObservationSeriesStaleness marks replaced-commit series stale", () => {
  const decorated = decorateObservationSeriesStaleness([
    { id: "old", datasetCommitId: "commit_old", status: "active" },
    { id: "current", datasetCommitId: "commit_current", status: "active" },
  ], "commit_current");

  assert.equal(decorated.find((item) => item.id === "old").status, "stale");
  assert.equal(decorated.find((item) => item.id === "old").staleReason, "dataset_commit_replaced");
  assert.equal(decorated.find((item) => item.id === "current").status, "active");
  assert.equal(decorated.find((item) => item.id === "current").isStale, false);
});
