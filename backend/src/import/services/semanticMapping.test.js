import test from "node:test";
import assert from "node:assert/strict";
import { createSemanticMappingResponse } from "./semanticMapping.js";

function genericImport() {
  return {
    importId: "import_1",
    schemaVersion: "labrat.genericImport.v1",
    experiments: [{ experimentId: "exp_1", name: "Run 1", metadata: [] }],
    measurements: [
      { measurementId: "m_time", experimentId: "exp_1", field: "time", displayName: "Time", value: 10, rawValue: "10", unit: "min", sourceRef: "src_time", confidence: 0.9 },
      { measurementId: "m_conv", experimentId: "exp_1", field: "conversion", displayName: "Conversion", value: 25, rawValue: "25", unit: "%", sourceRef: "src_conv", confidence: 0.86 },
    ],
    sources: [],
  };
}

test("createSemanticMappingResponse returns deterministic review proposals without AI config", async () => {
  const response = await createSemanticMappingResponse({
    genericImports: [genericImport()],
    env: {},
    createdAt: "2026-06-10T00:00:00.000Z",
  });

  assert.equal(response.schemaVersion, "labrat.semanticMappingResponse.v1");
  assert.equal(response.mappingSet.schemaVersion, "labrat.semanticMappingSet.v1");
  assert.equal(response.mappingSet.sourceImportIds[0], "import_1");
  assert.equal(response.mappingSet.mappings.length, 2);
  assert.equal(response.mappingSet.mappings.find((item) => item.rawLabel === "Time").semanticRole, "time");
  assert.equal(response.mappingSet.mappings.find((item) => item.rawLabel === "Conversion").semanticRole, "response");
  assert.equal(response.mappingSet.warnings.some((warning) => warning.code === "ai_unavailable"), true);
  assert.equal(response.summary.proposalCount, 2);
});

test("createSemanticMappingResponse preserves prior accepted decisions", async () => {
  const response = await createSemanticMappingResponse({
    genericImports: [genericImport()],
    priorDecisions: [{
      targetKind: "measurement",
      canonicalField: "conversion",
      sourceIds: ["m_conv"],
      status: "accepted",
    }],
    env: {},
  });

  const conversion = response.mappingSet.mappings.find((item) => item.rawLabel === "Conversion");
  assert.equal(conversion.status, "accepted");
});
