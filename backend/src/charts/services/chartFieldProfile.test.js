import test from "node:test";
import assert from "node:assert/strict";
import { buildChartDataProfile } from "./chartFieldProfile.js";

test("buildChartDataProfile detects spread, missing values, constants, and category cardinality", () => {
  const fields = [
    {
      fieldId: "temperature",
      field: "temperature",
      displayName: "Temperature",
      role: "condition",
      valueType: "numeric",
      values: [250, 275, 300, null],
      rowIndexes: [1, 2, 3],
      coverageCount: 3,
    },
    {
      fieldId: "pressure",
      field: "pressure",
      displayName: "Pressure",
      role: "condition",
      valueType: "numeric",
      values: [60, 60, 60],
      rowIndexes: [1, 2, 3],
      coverageCount: 3,
    },
    {
      fieldId: "catalyst",
      field: "catalyst",
      displayName: "Catalyst",
      role: "material",
      valueType: "categorical",
      values: ["Ru/TiO2", "Pt/C", "Ru/TiO2"],
      rowIndexes: [1, 2, 3],
      coverageCount: 3,
    },
    {
      fieldId: "gas",
      field: "gas",
      displayName: "Gas Selectivity",
      role: "measurement",
      valueType: "numeric",
      values: [0.35],
      rowIndexes: [1],
      coverageCount: 1,
    },
  ];

  const profile = buildChartDataProfile({ fields, genericImports: [] });
  const temperature = profile.fieldProfiles.get("temperature");
  const pressure = profile.fieldProfiles.get("pressure");
  const catalyst = profile.fieldProfiles.get("catalyst");
  const gas = profile.fieldProfiles.get("gas");

  assert.equal(temperature.hasUsefulSpread, true);
  assert.equal(pressure.isMostlyConstant, true);
  assert.equal(catalyst.uniqueCount, 2);
  assert.equal(gas.missingRate > 0.6, true);
});

test("buildChartDataProfile computes paired x/y coverage", () => {
  const xField = { fieldId: "temperature", sourceIds: ["temp_1", "temp_2"], valueType: "numeric" };
  const yField = { fieldId: "gas", sourceIds: ["gas_1", "gas_2"], valueType: "numeric" };
  const genericImports = [{
    importId: "import_1",
    fields: [
      { fieldValueId: "temp_1", experimentId: "exp_1", rowIndex: 2, value: 250 },
      { fieldValueId: "gas_1", experimentId: "exp_1", rowIndex: 2, value: 0.35 },
      { fieldValueId: "temp_2", experimentId: "exp_2", rowIndex: 3, value: 275 },
      { fieldValueId: "gas_2", experimentId: "exp_2", rowIndex: 3, value: 0.24 },
    ],
  }];

  const profile = buildChartDataProfile({ fields: [xField, yField], genericImports });
  const pair = profile.pairProfile(xField, yField);

  assert.equal(pair.pairedCount, 2);
  assert.equal(pair.xSpread, 25);
  assert.equal(Number(pair.ySpread.toFixed(2)), 0.11);
});
