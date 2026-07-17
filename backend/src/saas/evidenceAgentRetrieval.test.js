import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAcceptedRegionCards,
  createEvidenceAgentTools,
} from "./evidenceAgentTools.js";
import { runEvidenceRetrievalAgent } from "./evidenceAgentRetrieval.js";

const project = { id: "project_1", labId: "lab_1" };
const sourceDocuments = [
  {
    id: "source_doc_exp33",
    projectId: "project_1",
    metadata: { workbookName: "Reaction_Rate_Exp33.xlsx" },
  },
];
const acceptedUnderstandings = [
  {
    id: "workbook_understanding_1",
    projectId: "project_1",
    sourceDocumentId: "source_doc_exp33",
    facts: [
      {
        factId: "fact_exp33_rate",
        kind: "region_description",
        sourceDocumentId: "source_doc_exp33",
        sheetName: "Exp33",
        range: "A1:P61",
        semanticType: "reaction_rate_time_series",
        description: "Exp33 reaction rate data over time",
        sourceRefs: [
          {
            sourceType: "excel_range",
            sourceDocumentId: "source_doc_exp33",
            sheet: "Exp33",
            range: "A1:P61",
          },
        ],
      },
    ],
  },
];

test("buildAcceptedRegionCards creates searchable cards from accepted WorkbookUnderstanding facts", () => {
  const cards = buildAcceptedRegionCards({ acceptedUnderstandings, sourceDocuments });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].regionId, "fact_exp33_rate");
  assert.equal(cards[0].evidenceStatus, "accepted");
  assert.equal(cards[0].canUseForDataPlan, true);
  assert.equal(cards[0].sourceDocumentId, "source_doc_exp33");
  assert.equal(cards[0].sheetName, "Exp33");
  assert.equal(cards[0].range, "A1:P61");
  assert.match(cards[0].searchText, /reaction rate/i);
});

test("semantic_search_confirmed_regions returns accepted regions as usable candidates", async () => {
  const tools = createEvidenceAgentTools({
    project,
    acceptedUnderstandings,
    sourceDocuments,
    sourceRegions: [],
    readRangePreview: async () => null,
  });

  const response = await tools.semantic_search_confirmed_regions({
    query: "experiment 33 reaction rate over time",
    topK: 3,
  });

  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].regionId, "fact_exp33_rate");
  assert.equal(response.results[0].evidenceStatus, "accepted");
  assert.equal(response.results[0].canUseForDataPlan, true);
  assert.equal(response.results[0].semanticType, "reaction_rate_time_series");
});

test("semantic_search_unconfirmed_regions returns suggestions that cannot be used for DataPlan", async () => {
  const tools = createEvidenceAgentTools({
    project,
    acceptedUnderstandings: [],
    sourceDocuments,
    sourceRegions: [
      {
        id: "source_region_exp33_rate",
        sourceDocumentId: "source_doc_exp33",
        sheetName: "Exp33",
        range: "A1:P61",
        kind: "reaction rate table",
        label: "Reaction rate table",
        confidence: 0.82,
      },
    ],
    readRangePreview: async () => null,
  });

  const response = await tools.semantic_search_unconfirmed_regions({
    query: "experiment 33 reaction rate",
    topK: 3,
  });

  assert.equal(response.suggestions.length, 1);
  assert.equal(response.suggestions[0].sourceRegionId, "source_region_exp33_rate");
  assert.equal(response.suggestions[0].evidenceStatus, "suggested_unconfirmed");
  assert.equal(response.suggestions[0].canUseForDataPlan, false);
  assert.equal(response.suggestions[0].requiredNextStep, "confirm_region");
});

test("verify_evidence_selection rejects a selected region from the wrong experiment", async () => {
  const tools = createEvidenceAgentTools({
    project,
    acceptedUnderstandings,
    sourceDocuments,
    sourceRegions: [],
    readRangePreview: async () => null,
  });

  const response = await tools.verify_evidence_selection({
    selectedRegionIds: ["fact_exp33_rate"],
    requiredExperimentAliases: ["Exp35"],
    requiredSemanticTypes: ["reaction_rate_time_series"],
  });

  assert.equal(response.status, "rejected");
  assert.equal(response.usableRegions.length, 0);
  assert.equal(response.rejected[0].code, "experiment_alias_mismatch");
});

test("runEvidenceRetrievalAgent returns verified accepted results with bounded preview", async () => {
  const response = await runEvidenceRetrievalAgent({
    project,
    query: "draw reaction rate vs time for experiment 33",
    acceptedUnderstandings,
    sourceDocuments,
    sourceRegions: [],
    includePreview: true,
    readRangePreview: async () => ({
      sheetName: "Exp33",
      range: "A1:P10",
      rows: [{ rowNumber: 1, cells: [{ address: "A1", value: "Time" }] }],
    }),
  });

  assert.equal(response.schemaVersion, "labrat.evidenceRetrieval.toolAgent.v1");
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].regionId, "fact_exp33_rate");
  assert.equal(response.results[0].preview.range, "A1:P10");
  assert.equal(response.toolTrace.some((step) => step.tool === "verify_evidence_selection"), true);
});

test("runEvidenceRetrievalAgent returns confirmation suggestion when only unconfirmed evidence matches", async () => {
  const response = await runEvidenceRetrievalAgent({
    project,
    query: "experiment 33 reaction rate",
    acceptedUnderstandings: [],
    sourceDocuments,
    sourceRegions: [
      {
        id: "source_region_exp33_rate",
        sourceDocumentId: "source_doc_exp33",
        sheetName: "Exp33",
        range: "A1:P61",
        kind: "reaction rate table",
        label: "Reaction rate table",
        confidence: 0.82,
      },
    ],
    includeUnconfirmedSuggestions: true,
    readRangePreview: async () => null,
  });

  assert.equal(response.results.length, 0);
  assert.equal(response.suggestions.length, 1);
  assert.equal(response.suggestions[0].canUseForDataPlan, false);
  assert.equal(response.clarification.code, "confirm_region_before_use");
});
