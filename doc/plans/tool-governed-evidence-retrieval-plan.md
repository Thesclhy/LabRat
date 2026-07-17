# Tool-Governed Evidence Retrieval Implementation Plan

Status: implemented MVP / reference dependency
Last reviewed: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Implementation Status

The Tool-Governed Evidence Retrieval MVP was implemented on 2026-06-29. The codebase now includes the backend evidence tool registry, retrieval orchestrator, project-scoped `POST /api/projects/:projectId/evidence/retrieve` route, accepted-region-only usable results, unconfirmed suggestions with `canUseForDataPlan: false`, frontend `retrieveProjectEvidence()`, contract notes, and route/helper/unit coverage.

Use this document as the reference contract and safety rationale for DataPlan Agent work. Do not re-run the early unchecked task snippets as current work unless a regression or redesign explicitly reopens this layer.

**Goal:** Build a read-only agent-tool retrieval layer that maps a natural-language request to relevant user-confirmed workbook regions/cells without allowing the agent to use unconfirmed workbook data as chart-ready evidence.

**Architecture:** The backend exposes a project-scoped retrieval endpoint powered by a small registry of evidence tools. The LLM or injected planner can call tools such as `semantic_search_confirmed_regions`, `read_confirmed_region_preview`, and `verify_evidence_selection`; the backend executes every tool, validates source refs, and returns only accepted `WorkbookUnderstanding` evidence as usable `results[]`. Unconfirmed `SourceRegion`s can appear only as `suggestions[]` with `canUseForDataPlan: false`.

**Tech Stack:** Node backend with built-in test runner, existing SaaS route/store patterns, optional Anthropic-backed tool planner, React/Vite frontend API helper tests, existing SourceDocument range/index utilities.

---

## Scope

This plan supersedes the pure deterministic retrieval direction in `doc/plans/evidence-retrieval-mvp-plan.md`.

This MVP implements the **tool-governed retrieval layer only**. It does not create DataPlans, DataSnapshots, SourceExtractProposals, ChartSpecs, FigurePackages, or Manuscript placements.

## Non-Negotiable Rules

- `results[]` may include only accepted `WorkbookUnderstanding` facts/region summaries.
- Unconfirmed `SourceRegion`s and raw source ranges may appear only in `suggestions[]`.
- Every usable result must include exact `sourceDocumentId`, `sheetName`, `range`, and `sourceRefs`.
- Tool outputs must include `evidenceStatus` and `canUseForDataPlan`.
- The agent/planner cannot directly read arbitrary workbook cells.
- The agent/planner cannot create scientific data, ChartSpecs, DataPlans, or manuscript content.
- A verifier tool must reject wrong experiment aliases, stale source documents, missing source refs, and unaccepted regions.
- If the LLM provider is unavailable, the endpoint may use a clearly labeled fallback ranker, but the verifier remains mandatory.

## File Structure

- Create: `backend/src/saas/evidenceAgentTools.js`
  - Tool registry and tool implementations.
  - Tool input validation.
  - Accepted-region card construction.
  - Unconfirmed-suggestion shaping.
  - Preview read wrappers.
  - Verification rules.

- Create: `backend/src/saas/evidenceAgentRetrieval.js`
  - Agent retrieval orchestration.
  - Planner interface.
  - Tool-call execution trace.
  - Result/suggestion/clarification response shape.

- Create: `backend/src/saas/evidenceAgentRetrieval.test.js`
  - Unit tests for tool registry, planner orchestration, verifier behavior, and no-mutation guarantees.

- Modify: `backend/src/saas/routes/saasRoutes.js`
  - Add `POST /api/projects/:projectId/evidence/retrieve`.
  - Enforce project auth.
  - Load accepted understandings, source documents, source regions, and range readers.

- Modify: `backend/src/saas/routes/saasRoutes.test.js`
  - Add route-level tests for accepted retrieval, unconfirmed suggestions, wrong experiment rejection, and provider fallback.

- Modify: `src/data/serverApi.js`
  - Add `retrieveProjectEvidence(projectId, request, options)`.

- Modify: `src/data/serverApi.test.js`
  - Add frontend helper request/error tests.

- Modify: `doc/contracts/saas-api-contract-v0.md`
  - Document the request/response contract and safety rules.

- Modify: `doc/contracts/canonical-data-dictionary.md`
  - Define tool-governed evidence retrieval terms.

- Modify: `doc/PROGRESS.md`
  - Record implementation milestone and verification.

---

## Response Contract

Endpoint:

```http
POST /api/projects/:projectId/evidence/retrieve
```

Request:

```json
{
  "query": "draw reaction rate vs time for experiment 33",
  "mode": "tool_agent",
  "includePreview": true,
  "includeUnconfirmedSuggestions": true,
  "maxResults": 5
}
```

Response:

```json
{
  "schemaVersion": "labrat.evidenceRetrieval.toolAgent.v1",
  "projectId": "project_...",
  "query": "draw reaction rate vs time for experiment 33",
  "mode": "tool_agent",
  "planner": {
    "provider": "mock_test_planner",
    "fallbackUsed": false
  },
  "toolTrace": [
    {
      "tool": "semantic_search_confirmed_regions",
      "status": "completed",
      "resultCount": 1
    },
    {
      "tool": "verify_evidence_selection",
      "status": "completed",
      "resultCount": 1
    }
  ],
  "results": [
    {
      "kind": "confirmed_region",
      "evidenceStatus": "accepted",
      "canUseForDataPlan": true,
      "source": "workbook_understanding",
      "workbookUnderstandingId": "workbook_understanding_...",
      "factId": "fact_exp33_rate",
      "sourceDocumentId": "source_doc_...",
      "workbookName": "Reaction_Rate_Exp33.xlsx",
      "sheetName": "Exp33",
      "range": "A1:P61",
      "semanticType": "reaction_rate_time_series",
      "matchedReason": "The confirmed region is described as Exp33 reaction-rate time-series data.",
      "sourceRefs": [
        {
          "sourceType": "excel_range",
          "sourceDocumentId": "source_doc_...",
          "sheet": "Exp33",
          "range": "A1:P61"
        }
      ],
      "preview": {
        "sheetName": "Exp33",
        "range": "A1:P10",
        "rows": []
      }
    }
  ],
  "suggestions": [],
  "clarification": null
}
```

When only unconfirmed evidence exists:

```json
{
  "results": [],
  "suggestions": [
    {
      "kind": "detected_region",
      "evidenceStatus": "suggested_unconfirmed",
      "canUseForDataPlan": false,
      "requiredNextStep": "confirm_region",
      "sourceDocumentId": "source_doc_...",
      "sheetName": "Exp33",
      "range": "A1:P61"
    }
  ],
  "clarification": {
    "code": "confirm_region_before_use",
    "message": "I found a possible workbook region, but it must be confirmed before I can use it for charting."
  }
}
```

---

## Task 1: Tool Registry Unit Tests

**Files:**
- Create: `backend/src/saas/evidenceAgentRetrieval.test.js`
- Create later: `backend/src/saas/evidenceAgentTools.js`

- [ ] **Step 1: Write failing tests for confirmed-region tool search**

Add this test:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  createEvidenceAgentTools,
  buildAcceptedRegionCards,
} from "./evidenceAgentTools.js";

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
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: fails because `evidenceAgentTools.js` does not exist.

- [ ] **Step 3: Implement accepted region cards and confirmed search**

Create `backend/src/saas/evidenceAgentTools.js`:

```js
export const TOOL_AGENT_SCHEMA_VERSION = "labrat.evidenceRetrieval.toolAgent.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sourceDocumentById(sourceDocuments, sourceDocumentId) {
  return asArray(sourceDocuments).find((document) => document.id === sourceDocumentId) || null;
}

function sourceDocumentName(sourceDocument) {
  return sourceDocument?.metadata?.workbookName
    || sourceDocument?.metadata?.fileName
    || sourceDocument?.originalName
    || "";
}

function parseExperimentAliases(query) {
  return [...clean(query).matchAll(/\bexp(?:eriment)?\s*0*([0-9]+)\b/gi)]
    .map((match) => `Exp${Number(match[1])}`);
}

function lexicalScore(query, card) {
  const queryText = normalizeText(query);
  const cardText = normalizeText(card.searchText);
  let score = 0;
  for (const token of queryText.split(" ").filter(Boolean)) {
    if (cardText.includes(token)) score += 5;
  }
  for (const alias of parseExperimentAliases(query)) {
    if (cardText.includes(normalizeText(alias))) score += 35;
  }
  if (queryText.includes("reaction rate") && card.semanticType === "reaction_rate_time_series") score += 40;
  if ((queryText.includes("carbon") || queryText.includes("c number")) && card.semanticType === "component_distribution") score += 40;
  return score;
}

export function buildAcceptedRegionCards({ acceptedUnderstandings = [], sourceDocuments = [] } = {}) {
  return asArray(acceptedUnderstandings).flatMap((understanding) => {
    return asArray(understanding.facts).map((fact) => {
      const sourceDocumentId = fact.sourceDocumentId || understanding.sourceDocumentId;
      const sourceDocument = sourceDocumentById(sourceDocuments, sourceDocumentId);
      const workbookName = sourceDocumentName(sourceDocument);
      const sourceRefs = asArray(fact.sourceRefs).length
        ? fact.sourceRefs
        : [{
          sourceType: "excel_range",
          sourceDocumentId,
          sheet: fact.sheetName,
          range: fact.range,
        }];
      const searchText = [
        workbookName,
        fact.sheetName,
        fact.range,
        fact.semanticType,
        fact.description,
        fact.kind,
      ].filter(Boolean).join(" ");
      return {
        regionId: fact.factId || `${understanding.id}:${fact.sheetName}:${fact.range}`,
        kind: "confirmed_region",
        evidenceStatus: "accepted",
        canUseForDataPlan: true,
        source: "workbook_understanding",
        workbookUnderstandingId: understanding.id,
        factId: fact.factId || null,
        sourceDocumentId,
        workbookName,
        sheetName: fact.sheetName,
        range: fact.range,
        semanticType: fact.semanticType || "unknown_region",
        description: fact.description || "",
        sourceRefs,
        searchText,
      };
    });
  });
}

export function createEvidenceAgentTools({
  project,
  acceptedUnderstandings = [],
  sourceDocuments = [],
  sourceRegions = [],
  readRangePreview = null,
} = {}) {
  const acceptedCards = buildAcceptedRegionCards({ acceptedUnderstandings, sourceDocuments });

  return {
    async list_confirmed_regions(input = {}) {
      const semanticType = clean(input.semanticType);
      const experimentAlias = clean(input.experimentAlias);
      const regions = acceptedCards.filter((card) => {
        if (semanticType && card.semanticType !== semanticType) return false;
        if (experimentAlias && !normalizeText(card.searchText).includes(normalizeText(experimentAlias))) return false;
        return true;
      });
      return { regions };
    },

    async semantic_search_confirmed_regions(input = {}) {
      const query = clean(input.query);
      const topK = Math.max(1, Math.min(20, Number(input.topK) || 5));
      const ranked = acceptedCards
        .map((card) => ({
          ...card,
          score: lexicalScore(query, card),
          ranker: "fallback_region_card",
          matchedReason: "Matched against accepted workbook-understanding region text.",
        }))
        .filter((card) => card.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { results: ranked };
    },

    async read_confirmed_region_preview(input = {}) {
      const regionId = clean(input.regionId);
      const region = acceptedCards.find((card) => card.regionId === regionId);
      if (!region) {
        return { error: { code: "confirmed_region_not_found", message: "Confirmed region not found." } };
      }
      const preview = readRangePreview
        ? await readRangePreview({
          sourceDocumentId: region.sourceDocumentId,
          sheetName: region.sheetName,
          range: region.range,
          maxRows: input.maxRows || 20,
          maxColumns: input.maxColumns || 12,
        })
        : null;
      return { region, preview };
    },

    async verify_evidence_selection(input = {}) {
      const selectedRegionIds = asArray(input.selectedRegionIds).map(clean).filter(Boolean);
      const requiredAliases = asArray(input.requiredExperimentAliases).map(clean).filter(Boolean);
      const requiredSemanticTypes = asArray(input.requiredSemanticTypes).map(clean).filter(Boolean);
      const selected = selectedRegionIds
        .map((regionId) => acceptedCards.find((card) => card.regionId === regionId))
        .filter(Boolean);
      const rejected = [];
      const usableRegions = selected.filter((card) => {
        if (requiredSemanticTypes.length && !requiredSemanticTypes.includes(card.semanticType)) {
          rejected.push({ regionId: card.regionId, code: "semantic_type_mismatch" });
          return false;
        }
        for (const alias of requiredAliases) {
          if (!normalizeText(card.searchText).includes(normalizeText(alias))) {
            rejected.push({ regionId: card.regionId, code: "experiment_alias_mismatch", expected: alias });
            return false;
          }
        }
        if (!card.sourceDocumentId || !card.sheetName || !card.range) {
          rejected.push({ regionId: card.regionId, code: "missing_source_ref" });
          return false;
        }
        return true;
      });
      return {
        status: usableRegions.length && !rejected.length ? "verified" : "rejected",
        usableRegions,
        rejected,
      };
    },
  };
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: tests pass.

---

## Task 2: Unconfirmed Suggestions Tool

**Files:**
- Modify: `backend/src/saas/evidenceAgentTools.js`
- Test: `backend/src/saas/evidenceAgentRetrieval.test.js`

- [ ] **Step 1: Write failing tests for unconfirmed region suggestions**

Add:

```js
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
        kind: "standard_table",
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
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: fails because `semantic_search_unconfirmed_regions` is missing.

- [ ] **Step 3: Implement unconfirmed suggestion shaping**

Add this helper and tool to `backend/src/saas/evidenceAgentTools.js`:

```js
function buildUnconfirmedRegionCards({ sourceRegions = [], sourceDocuments = [] } = {}) {
  return asArray(sourceRegions).map((region) => {
    const sourceDocument = sourceDocumentById(sourceDocuments, region.sourceDocumentId);
    const workbookName = sourceDocumentName(sourceDocument);
    const searchText = [
      workbookName,
      region.sheetName,
      region.range,
      region.kind,
      region.label,
      region.summary,
    ].filter(Boolean).join(" ");
    return {
      kind: "detected_region",
      evidenceStatus: "suggested_unconfirmed",
      canUseForDataPlan: false,
      requiredNextStep: "confirm_region",
      source: "source_region",
      sourceRegionId: region.id,
      sourceDocumentId: region.sourceDocumentId,
      workbookName,
      sheetName: region.sheetName,
      range: region.range,
      semanticType: region.semanticType || region.kind || "unknown_region",
      description: region.label || region.summary || "",
      confidence: region.confidence ?? null,
      searchText,
    };
  });
}
```

Inside `createEvidenceAgentTools()`:

```js
const unconfirmedCards = buildUnconfirmedRegionCards({ sourceRegions, sourceDocuments });
```

Add the tool:

```js
async semantic_search_unconfirmed_regions(input = {}) {
  const query = clean(input.query);
  const topK = Math.max(1, Math.min(20, Number(input.topK) || 5));
  const ranked = unconfirmedCards
    .map((card) => ({
      ...card,
      score: lexicalScore(query, card),
      ranker: "fallback_region_card",
      matchedReason: "Matched against unconfirmed detected source-region text.",
    }))
    .filter((card) => card.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return { suggestions: ranked };
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: tests pass.

---

## Task 3: Agent Retrieval Orchestrator

**Files:**
- Create: `backend/src/saas/evidenceAgentRetrieval.js`
- Modify test: `backend/src/saas/evidenceAgentRetrieval.test.js`

- [ ] **Step 1: Write failing orchestration tests**

Add:

```js
import {
  runEvidenceRetrievalAgent,
} from "./evidenceAgentRetrieval.js";

test("runEvidenceRetrievalAgent returns verified accepted results from tool-selected evidence", async () => {
  const response = await runEvidenceRetrievalAgent({
    project,
    query: "draw reaction rate vs time for experiment 33",
    acceptedUnderstandings,
    sourceDocuments,
    sourceRegions: [],
    includePreview: true,
    planner: async ({ tools }) => {
      const search = await tools.semantic_search_confirmed_regions({
        query: "experiment 33 reaction rate",
        topK: 5,
      });
      const selectedRegionIds = search.results.map((result) => result.regionId);
      const verification = await tools.verify_evidence_selection({
        selectedRegionIds,
        requiredExperimentAliases: ["Exp33"],
        requiredSemanticTypes: ["reaction_rate_time_series"],
      });
      return {
        provider: "mock_test_planner",
        toolTrace: [
          { tool: "semantic_search_confirmed_regions", status: "completed", resultCount: search.results.length },
          { tool: "verify_evidence_selection", status: "completed", resultCount: verification.usableRegions.length },
        ],
        results: verification.usableRegions,
        suggestions: [],
        clarification: null,
      };
    },
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
  assert.equal(response.toolTrace.length, 2);
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
    planner: async ({ tools }) => {
      const suggestions = await tools.semantic_search_unconfirmed_regions({
        query: "experiment 33 reaction rate",
        topK: 5,
      });
      return {
        provider: "mock_test_planner",
        toolTrace: [
          { tool: "semantic_search_unconfirmed_regions", status: "completed", resultCount: suggestions.suggestions.length },
        ],
        results: [],
        suggestions: suggestions.suggestions,
        clarification: {
          code: "confirm_region_before_use",
          message: "I found a possible region, but it must be confirmed before use.",
        },
      };
    },
    readRangePreview: async () => null,
  });

  assert.equal(response.results.length, 0);
  assert.equal(response.suggestions.length, 1);
  assert.equal(response.suggestions[0].canUseForDataPlan, false);
  assert.equal(response.clarification.code, "confirm_region_before_use");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: fails because `evidenceAgentRetrieval.js` does not exist.

- [ ] **Step 3: Implement orchestrator**

Create `backend/src/saas/evidenceAgentRetrieval.js`:

```js
import {
  createEvidenceAgentTools,
  TOOL_AGENT_SCHEMA_VERSION,
} from "./evidenceAgentTools.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function attachPreviewToResults(results, tools, includePreview) {
  if (!includePreview) return results;
  return Promise.all(asArray(results).map(async (result) => {
    const previewResponse = await tools.read_confirmed_region_preview({
      regionId: result.regionId,
      maxRows: 20,
      maxColumns: 12,
    });
    return {
      ...result,
      preview: previewResponse.preview || null,
    };
  }));
}

async function fallbackPlanner({ query, tools, includeUnconfirmedSuggestions }) {
  const search = await tools.semantic_search_confirmed_regions({ query, topK: 5 });
  const selectedRegionIds = search.results.map((result) => result.regionId);
  const verification = await tools.verify_evidence_selection({ selectedRegionIds });
  if (verification.status === "verified") {
    return {
      provider: "fallback_region_card_planner",
      fallbackUsed: true,
      toolTrace: [
        { tool: "semantic_search_confirmed_regions", status: "completed", resultCount: search.results.length },
        { tool: "verify_evidence_selection", status: "completed", resultCount: verification.usableRegions.length },
      ],
      results: verification.usableRegions,
      suggestions: [],
      clarification: null,
    };
  }
  const suggestions = includeUnconfirmedSuggestions
    ? await tools.semantic_search_unconfirmed_regions({ query, topK: 5 })
    : { suggestions: [] };
  return {
    provider: "fallback_region_card_planner",
    fallbackUsed: true,
    toolTrace: [
      { tool: "semantic_search_confirmed_regions", status: "completed", resultCount: search.results.length },
      { tool: "verify_evidence_selection", status: "completed", resultCount: verification.usableRegions.length },
      { tool: "semantic_search_unconfirmed_regions", status: "completed", resultCount: suggestions.suggestions.length },
    ],
    results: [],
    suggestions: suggestions.suggestions,
    clarification: suggestions.suggestions.length
      ? {
        code: "confirm_region_before_use",
        message: "I found possible workbook regions, but they must be confirmed before use.",
      }
      : {
        code: "no_accepted_region_match",
        message: "No confirmed workbook region matches this request.",
      },
  };
}

export async function runEvidenceRetrievalAgent({
  project = null,
  query = "",
  acceptedUnderstandings = [],
  sourceDocuments = [],
  sourceRegions = [],
  includePreview = true,
  includeUnconfirmedSuggestions = false,
  planner = fallbackPlanner,
  readRangePreview = null,
} = {}) {
  const tools = createEvidenceAgentTools({
    project,
    acceptedUnderstandings,
    sourceDocuments,
    sourceRegions,
    readRangePreview,
  });
  const planResult = await planner({
    query,
    tools,
    includePreview,
    includeUnconfirmedSuggestions,
  });
  const results = await attachPreviewToResults(planResult.results, tools, includePreview);
  return {
    schemaVersion: TOOL_AGENT_SCHEMA_VERSION,
    projectId: project?.id || null,
    query,
    mode: "tool_agent",
    planner: {
      provider: planResult.provider || "unknown_planner",
      fallbackUsed: planResult.fallbackUsed === true,
    },
    toolTrace: asArray(planResult.toolTrace),
    results,
    suggestions: includeUnconfirmedSuggestions ? asArray(planResult.suggestions) : [],
    clarification: planResult.clarification || (results.length ? null : {
      code: "no_accepted_region_match",
      message: "No confirmed workbook region matches this request.",
    }),
  };
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: tests pass.

---

## Task 4: Wrong-Experiment Verification

**Files:**
- Modify: `backend/src/saas/evidenceAgentRetrieval.test.js`
- Modify if needed: `backend/src/saas/evidenceAgentTools.js`

- [ ] **Step 1: Write failing test for wrong experiment rejection**

Add:

```js
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
```

- [ ] **Step 2: Run test and verify RED or GREEN**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: pass if Task 1 verifier already handles aliases; otherwise fail.

- [ ] **Step 3: Fix verifier if needed**

Ensure `verify_evidence_selection()` checks every `requiredExperimentAliases` item against accepted card `searchText` and rejects mismatches with:

```js
{ regionId: card.regionId, code: "experiment_alias_mismatch", expected: alias }
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: tests pass.

---

## Task 5: SaaS Route

**Files:**
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`

- [ ] **Step 1: Add failing route test for accepted evidence retrieval**

Add a test near the workbook understanding route tests:

```js
test("POST /api/projects/:projectId/evidence/retrieve returns accepted workbook understanding evidence", async () => {
  const fixture = await createProjectWithAcceptedWorkbookUnderstanding({
    description: "Exp33 reaction rate data over time",
    semanticType: "reaction_rate_time_series",
    sheetName: "Exp33",
    range: "A1:P61",
  });

  const response = await requestJson(fixture.server, {
    method: "POST",
    path: `/api/projects/${fixture.projectId}/evidence/retrieve`,
    cookies: fixture.cookies,
    body: {
      query: "draw reaction rate vs time for experiment 33",
      mode: "tool_agent",
      includePreview: true,
      includeUnconfirmedSuggestions: true,
      maxResults: 5,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.schemaVersion, "labrat.evidenceRetrieval.toolAgent.v1");
  assert.equal(response.body.results.length, 1);
  assert.equal(response.body.results[0].evidenceStatus, "accepted");
  assert.equal(response.body.results[0].canUseForDataPlan, true);
  assert.equal(response.body.results[0].sourceDocumentId, fixture.sourceDocumentId);
  assert.equal(response.body.results[0].sheetName, "Exp33");
  assert.equal(response.body.results[0].range, "A1:P61");
});
```

If there is no existing helper named `createProjectWithAcceptedWorkbookUnderstanding`, create a focused local helper in the test file using the existing upload/session/revision/confirm route helpers already used by nearby tests.

- [ ] **Step 2: Run route test and verify RED**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: fails because the endpoint is missing.

- [ ] **Step 3: Add route implementation**

In `backend/src/saas/routes/saasRoutes.js`, import:

```js
import { runEvidenceRetrievalAgent } from "../evidenceAgentRetrieval.js";
```

Add the handler:

```js
async function handleProjectEvidenceRetrieve(req, res, context, projectId) {
  const { project } = await requireProjectRole(req, context, projectId, "viewer");
  const body = await readJsonBody(req);
  const acceptedUnderstandings = context.store.listWorkbookUnderstandings
    ? await context.store.listWorkbookUnderstandings({ projectId: project.id, status: "accepted" })
    : [];
  const sourceDocuments = context.store.listSourceDocuments
    ? await context.store.listSourceDocuments({ projectId: project.id })
    : [];
  const sourceRegions = context.store.listSourceRegionsForProject
    ? await context.store.listSourceRegionsForProject({ projectId: project.id })
    : [];
  const response = await runEvidenceRetrievalAgent({
    project,
    query: body.query || "",
    acceptedUnderstandings,
    sourceDocuments,
    sourceRegions,
    includePreview: body.includePreview !== false,
    includeUnconfirmedSuggestions: body.includeUnconfirmedSuggestions === true,
    readRangePreview: async ({ sourceDocumentId, sheetName, range }) => {
      return readSourceDocumentRangeForRoute(context, {
        sourceDocumentId,
        sheetName,
        range,
        maxCells: 240,
      });
    },
  });
  sendJson(res, 200, response);
}
```

Use the existing route helper names in `saasRoutes.js` if they differ from `requireProjectRole`, `readJsonBody`, `sendJson`, or `readSourceDocumentRangeForRoute`. Do not duplicate source range parsing if the route already has a bounded range helper.

Register:

```js
if (method === "POST" && pathname.match(/^\/api\/projects\/([^/]+)\/evidence\/retrieve$/)) {
  const [, projectId] = pathname.match(/^\/api\/projects\/([^/]+)\/evidence\/retrieve$/);
  return handleProjectEvidenceRetrieve(req, res, context, decodeURIComponent(projectId));
}
```

- [ ] **Step 4: Run route test and verify GREEN**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: route tests pass.

---

## Task 6: Store Helper For Project Source Regions

**Files:**
- Modify: `backend/src/saas/memoryStore.js`
- Modify: `backend/src/saas/postgresStore.js`
- Test: existing route tests

- [ ] **Step 1: Add failing route coverage for unconfirmed suggestions**

Add a route test that uploads a workbook and creates SourceRegions but does not confirm a WorkbookUnderstanding. Call:

```json
{
  "query": "reaction rate experiment 33",
  "includeUnconfirmedSuggestions": true
}
```

Expected:

```js
assert.equal(response.body.results.length, 0);
assert.equal(response.body.suggestions[0].canUseForDataPlan, false);
assert.equal(response.body.clarification.code, "confirm_region_before_use");
```

- [ ] **Step 2: Run route test and verify RED if project-level source-region listing is missing**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: may fail because stores only list regions by `sourceDocumentId`.

- [ ] **Step 3: Add project source-region listing**

In memory store:

```js
async listSourceRegionsForProject({ projectId }) {
  const documents = await this.listSourceDocuments({ projectId });
  const documentIds = new Set(documents.map((document) => document.id));
  return this.sourceRegions.filter((region) => documentIds.has(region.sourceDocumentId));
}
```

In Postgres store:

```js
async listSourceRegionsForProject({ projectId }) {
  const result = await this.pool.query(
    `
      select sr.*
      from source_regions sr
      join source_documents sd on sd.id = sr.source_document_id
      where sd.project_id = $1
      order by sr.created_at desc
    `,
    [projectId],
  );
  return result.rows.map(mapSourceRegionRow);
}
```

Use existing property names and mapper names in `postgresStore.js`; if the mapper is named differently, reuse that existing mapper.

- [ ] **Step 4: Run route test and verify GREEN**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: route tests pass.

---

## Task 7: Optional LLM Tool Planner Adapter

**Files:**
- Modify: `backend/src/saas/evidenceAgentRetrieval.js`
- Create or modify: `backend/src/saas/ai/evidenceToolPlanner.js`
- Test: `backend/src/saas/evidenceAgentRetrieval.test.js`

- [ ] **Step 1: Add planner adapter tests with mocked model response**

Add:

```js
test("LLM planner adapter only returns backend-verified tool results", async () => {
  const mockModel = async () => ({
    toolCalls: [
      {
        name: "semantic_search_confirmed_regions",
        arguments: { query: "experiment 33 reaction rate", topK: 5 },
      },
      {
        name: "verify_evidence_selection",
        arguments: {
          selectedRegionIds: ["fact_exp33_rate"],
          requiredExperimentAliases: ["Exp33"],
          requiredSemanticTypes: ["reaction_rate_time_series"],
        },
      },
    ],
  });

  const response = await runEvidenceRetrievalAgent({
    project,
    query: "draw reaction rate vs time for experiment 33",
    acceptedUnderstandings,
    sourceDocuments,
    sourceRegions: [],
    includePreview: false,
    plannerProvider: "llm_tool_planner",
    modelClient: mockModel,
    readRangePreview: async () => null,
  });

  assert.equal(response.planner.provider, "llm_tool_planner");
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].regionId, "fact_exp33_rate");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: fails because `plannerProvider`/`modelClient` are unsupported.

- [ ] **Step 3: Implement adapter with strict tool whitelist**

Create `backend/src/saas/ai/evidenceToolPlanner.js`:

```js
const ALLOWED_TOOL_NAMES = new Set([
  "list_confirmed_regions",
  "semantic_search_confirmed_regions",
  "read_confirmed_region_preview",
  "semantic_search_unconfirmed_regions",
  "verify_evidence_selection",
]);

export async function runLlmEvidenceToolPlanner({
  query,
  tools,
  modelClient,
  includeUnconfirmedSuggestions,
} = {}) {
  if (!modelClient) {
    return null;
  }
  const modelResponse = await modelClient({
    task: "evidence_retrieval",
    query,
    allowedTools: [...ALLOWED_TOOL_NAMES],
  });
  const toolTrace = [];
  let lastSearch = { results: [] };
  let lastSuggestions = { suggestions: [] };
  let verification = null;

  for (const call of modelResponse.toolCalls || []) {
    if (!ALLOWED_TOOL_NAMES.has(call.name)) {
      toolTrace.push({ tool: call.name, status: "rejected", resultCount: 0 });
      continue;
    }
    const toolResult = await tools[call.name](call.arguments || {});
    if (call.name === "semantic_search_confirmed_regions") lastSearch = toolResult;
    if (call.name === "semantic_search_unconfirmed_regions") lastSuggestions = toolResult;
    if (call.name === "verify_evidence_selection") verification = toolResult;
    toolTrace.push({
      tool: call.name,
      status: "completed",
      resultCount: toolResult.results?.length || toolResult.suggestions?.length || toolResult.usableRegions?.length || 0,
    });
  }

  if (!verification && lastSearch.results.length) {
    verification = await tools.verify_evidence_selection({
      selectedRegionIds: lastSearch.results.map((result) => result.regionId),
    });
    toolTrace.push({
      tool: "verify_evidence_selection",
      status: "completed",
      resultCount: verification.usableRegions.length,
    });
  }

  return {
    provider: "llm_tool_planner",
    fallbackUsed: false,
    toolTrace,
    results: verification?.status === "verified" ? verification.usableRegions : [],
    suggestions: includeUnconfirmedSuggestions ? lastSuggestions.suggestions : [],
    clarification: verification?.status === "verified"
      ? null
      : {
        code: lastSuggestions.suggestions?.length ? "confirm_region_before_use" : "no_accepted_region_match",
        message: lastSuggestions.suggestions?.length
          ? "I found possible workbook regions, but they must be confirmed before use."
          : "No confirmed workbook region matches this request.",
      },
  };
}
```

Update `runEvidenceRetrievalAgent()` to call this adapter when `plannerProvider === "llm_tool_planner"` and `modelClient` is provided; otherwise use the fallback planner.

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
```

Expected: tests pass.

---

## Task 8: Frontend API Helper

**Files:**
- Modify: `src/data/serverApi.js`
- Modify: `src/data/serverApi.test.js`

- [ ] **Step 1: Add failing helper tests**

Add:

```js
import { retrieveProjectEvidence } from "./serverApi.js";

test("retrieveProjectEvidence posts tool-agent retrieval request", async () => {
  const fetchImpl = vi.fn(async () => jsonResponse({
    schemaVersion: "labrat.evidenceRetrieval.toolAgent.v1",
    results: [],
    suggestions: [],
  }));

  await retrieveProjectEvidence("project_1", {
    query: "experiment 33 reaction rate",
    mode: "tool_agent",
    includePreview: true,
    includeUnconfirmedSuggestions: true,
    maxResults: 5,
  }, { fetch: fetchImpl });

  expect(fetchImpl).toHaveBeenCalledWith(
    "/api/projects/project_1/evidence/retrieve",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        query: "experiment 33 reaction rate",
        mode: "tool_agent",
        includePreview: true,
        includeUnconfirmedSuggestions: true,
        maxResults: 5,
      }),
    }),
  );
});

test("retrieveProjectEvidence requires project id", async () => {
  await expect(retrieveProjectEvidence("", { query: "x" }, { fetch: vi.fn() }))
    .rejects.toThrow(/project id/i);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- src/data/serverApi.test.js
```

Expected: fails because helper is missing.

- [ ] **Step 3: Implement helper**

Add to `src/data/serverApi.js` using the existing fetch wrapper style:

```js
export function retrieveProjectEvidence(projectId, request = {}, options = {}) {
  if (!projectId) throw new Error("project id is required to retrieve project evidence");
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/evidence/retrieve`, {
    method: "POST",
    body: JSON.stringify({
      query: request.query || "",
      mode: request.mode || "tool_agent",
      includePreview: request.includePreview !== false,
      includeUnconfirmedSuggestions: request.includeUnconfirmedSuggestions === true,
      maxResults: request.maxResults || 5,
    }),
  }, options);
}
```

If `serverApi.js` uses a helper name other than `apiFetch`, use the existing local helper.

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
npm test -- src/data/serverApi.test.js
```

Expected: tests pass.

---

## Task 9: Contract Documentation

**Files:**
- Modify: `doc/contracts/saas-api-contract-v0.md`
- Modify: `doc/contracts/canonical-data-dictionary.md`

- [ ] **Step 1: Add API contract**

Add a section:

```markdown
### `POST /api/projects/:projectId/evidence/retrieve`

Purpose: run tool-governed retrieval over accepted WorkbookUnderstanding evidence.

Request:

```json
{
  "query": "draw reaction rate vs time for experiment 33",
  "mode": "tool_agent",
  "includePreview": true,
  "includeUnconfirmedSuggestions": true,
  "maxResults": 5
}
```

Rules:

- `results[]` may include only accepted WorkbookUnderstanding evidence.
- `suggestions[]` may include detected SourceRegions, but must set `canUseForDataPlan: false`.
- The endpoint is read-only.
- No DataPlan, DataSnapshot, ChartSpec, SourceExtractProposal, FigurePackage, ManuscriptPlacement, or DatasetCommit is created.
- Wrong experiment aliases must return no usable result.
```

- [ ] **Step 2: Add data dictionary terms**

Add:

```markdown
### Tool-Governed Evidence Retrieval

A read-only agent retrieval workflow where an LLM or injected planner can call a backend-owned tool registry. Tools expose accepted workbook-understanding regions, bounded previews, unconfirmed suggestions, and verifier results. The planner never receives unrestricted workbook access and cannot create scientific data.

### Confirmed Region Card

A compact searchable representation of one accepted WorkbookUnderstanding fact or region summary, including workbook name, sheet, range, semantic type, user description, and source refs.

### Evidence Tool Trace

An audit-friendly list of retrieval tools called during one request. The trace is diagnostic only; source refs in `results[]` remain the authoritative provenance.
```

- [ ] **Step 3: Run docs diff check**

Run:

```bash
git diff --check -- doc/contracts/saas-api-contract-v0.md doc/contracts/canonical-data-dictionary.md
```

Expected: no whitespace errors.

---

## Task 10: Final Verification And Progress

**Files:**
- Modify: `doc/PROGRESS.md`

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
node --test backend/src/saas/evidenceAgentRetrieval.test.js
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: all pass.

- [ ] **Step 2: Run targeted frontend helper tests**

Run:

```bash
npm test -- src/data/serverApi.test.js
```

Expected: all pass.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm --prefix backend test
npm test
npm run build
git diff --check
```

Expected:

- backend tests pass, allowing existing optional Postgres skip
- frontend tests pass
- build passes, allowing existing Plotly chunk warning
- diff check has no whitespace errors, allowing existing LF/CRLF warnings if already present

- [ ] **Step 4: Update progress**

Add a newest-first `doc/PROGRESS.md` entry:

```markdown
- Implemented the tool-governed evidence retrieval MVP. Added a backend evidence tool registry, agent retrieval orchestrator, project-scoped `/api/projects/:projectId/evidence/retrieve` route, accepted-region-only usable results, unconfirmed suggestions with `canUseForDataPlan: false`, strict verifier behavior for experiment aliases/source refs, frontend API helper, and API/data dictionary docs. Verification: `node --test backend/src/saas/evidenceAgentRetrieval.test.js`, `node --test backend/src/saas/routes/saasRoutes.test.js`, `npm test -- src/data/serverApi.test.js`, `npm --prefix backend test`, `npm test`, `npm run build`, and `git diff --check` passed. Follow-up: connect Chart Review and Ask LabRat chart requests to DataPlan/DataSnapshot only after this retrieval layer is stable.
```

---

## Manual QA

1. Start Docker/local server.
2. Log in.
3. Upload `Reaction_Rate_Exp33.xlsx`.
4. Use workbook review to confirm `Exp33!A1:P61` as `reaction_rate_time_series`.
5. Call:

```powershell
$body = @{
  query = "draw reaction rate vs time for experiment 33"
  mode = "tool_agent"
  includePreview = $true
  includeUnconfirmedSuggestions = $true
  maxResults = 5
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Uri "$base/api/projects/$projectId/evidence/retrieve" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body `
  -WebSession $session
```

Expected:

- `results[0].canUseForDataPlan` is `true`.
- `results[0].evidenceStatus` is `accepted`.
- `results[0].sourceDocumentId`, `sheetName`, and `range` point to the confirmed red box.
- `toolTrace` includes `semantic_search_confirmed_regions` and `verify_evidence_selection`.

6. Ask for `experiment 999 reaction rate`.

Expected:

- `results` is empty.
- No Exp33/Exp35 region is returned as usable evidence.
- Response includes a clarification.

7. Upload a workbook but do not confirm any red box.

Expected:

- Matching detected regions appear only in `suggestions`.
- Every suggestion has `canUseForDataPlan: false`.

---

## Out Of Scope

- Full DataPlan/DataSnapshot creation.
- ChartSpec creation.
- Manuscript insertion.
- User-facing retrieval UI.
- Formula dependency graph.
- Cross-workbook join planning.
- Embedding index persistence.
- Long-term vector store.

## Acceptance Criteria

- `POST /api/projects/:projectId/evidence/retrieve` exists.
- The endpoint is read-only.
- Tool trace is returned for debugging/audit.
- Usable results come only from accepted WorkbookUnderstanding evidence.
- Unconfirmed suggestions are never usable for DataPlan/chart.
- Wrong experiment requests do not return another experiment as usable evidence.
- Preview reads stay bounded and source-backed.
- Frontend has a tested API helper.
- API and data dictionary docs describe the new retrieval model.
