import test from "node:test";
import assert from "node:assert/strict";
import { buildGenericImportContext } from "./genericImportContext.js";

function genericImport() {
  return {
    importId: "import_1",
    experiments: [{
      experimentId: "exp_1",
      name: "Run 1",
      metadata: [{
        metadataId: "meta_temp",
        field: "temperature",
        displayName: "Temperature",
        value: 80,
        rawValue: "80 C",
        unit: "C",
        sourceRef: "src_meta",
        confidence: 0.9,
      }],
    }],
    measurements: [
      { measurementId: "m_time", experimentId: "exp_1", field: "time", displayName: "Time", value: 10, rawValue: "10", unit: "min", sourceRef: "src_time", confidence: 0.9 },
      { measurementId: "m_conv", experimentId: "exp_1", field: "conversion", displayName: "Conversion", value: 25, rawValue: "25", unit: "%", sourceRef: "src_conv", confidence: 0.86 },
      { measurementId: "m_exp", experimentId: "exp_1", field: "experiment", displayName: "Experiment", value: null, rawValue: "Exp1", sourceRef: "src_exp", confidence: 0.8 },
    ],
    sources: [
      { sourceRef: "src_time", sheet: "Runs", cell: "B2" },
      { sourceRef: "src_conv", sheet: "Runs", cell: "C2" },
    ],
  };
}

test("buildGenericImportContext inventories semantic field candidates", () => {
  const context = buildGenericImportContext({ genericImports: [genericImport()] });

  assert.deepEqual(context.sourceImportIds, ["import_1"]);
  assert.equal(context.measurementFields.length, 3);
  assert.equal(context.metadataFields.length, 1);

  const time = context.measurementFields.find((field) => field.displayName === "Time");
  assert.equal(time.semanticRole, "time");
  assert.equal(time.valueType, "numeric");
  assert.equal(time.unit, "min");
  assert.deepEqual(time.sourceIds, ["m_time"]);

  const conversion = context.measurementFields.find((field) => field.displayName === "Conversion");
  assert.equal(conversion.semanticRole, "response");
  assert.equal(conversion.canonicalField, "conversion");

  const experiment = context.measurementFields.find((field) => field.displayName === "Experiment");
  assert.equal(experiment.semanticRole, "identifier");
  assert.equal(experiment.valueType, "categorical");

  const temperature = context.metadataFields[0];
  assert.equal(temperature.semanticRole, "condition");
  assert.equal(temperature.sourceIds[0], "meta_temp");
});
