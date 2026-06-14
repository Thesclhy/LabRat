import test from "node:test";
import assert from "node:assert/strict";
import {
  SEMANTIC_MAPPING_RESPONSE_VERSION,
  validateSemanticMappingRequest,
  shapeSemanticMappingResponse,
} from "./semanticMappingSchemas.js";

test("validateSemanticMappingRequest accepts generic imports from body or dataset", () => {
  const direct = validateSemanticMappingRequest({ genericImports: [{ importId: "import_1" }] });
  const dataset = validateSemanticMappingRequest({ dataset: { genericImports: [{ importId: "import_2" }] } });

  assert.equal(direct.ok, true);
  assert.equal(direct.value.genericImports[0].importId, "import_1");
  assert.equal(dataset.ok, true);
  assert.equal(dataset.value.genericImports[0].importId, "import_2");
});

test("validateSemanticMappingRequest rejects missing generic imports", () => {
  const result = validateSemanticMappingRequest({ genericImports: [] });

  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("At least one generic import is required."), true);
});

test("shapeSemanticMappingResponse returns a stable response envelope", () => {
  const response = shapeSemanticMappingResponse({
    mappingSet: {
      mappingSetId: "mapping_set_1",
      sourceImportIds: ["import_1"],
      mappings: [{ mappingId: "mapping_1" }],
      warnings: [],
    },
  });

  assert.equal(response.schemaVersion, SEMANTIC_MAPPING_RESPONSE_VERSION);
  assert.equal(response.mappingSet.schemaVersion, "labrat.semanticMappingSet.v1");
  assert.equal(response.summary.proposalCount, 1);
});
