# Evidence Retrieval MVP Implementation Plan

> Superseded direction: this pure deterministic retrieval plan has been replaced by `doc/plans/tool-governed-evidence-retrieval-plan.md`. Keep this file as historical context only unless the user explicitly asks to revive deterministic-only retrieval.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only project-scoped retrieval API that maps a natural-language query to relevant user-confirmed workbook regions/cells.

**Architecture:** The MVP retrieves only from accepted `WorkbookUnderstanding` facts/region summaries as usable evidence. Detected `SourceRegion`s and raw workbook cells can appear only as unconfirmed suggestions when explicitly requested; they must never be marked usable for DataPlan/chart. The backend returns ranked, explainable source refs plus bounded previews, and the frontend/API helper can call this endpoint without creating DatasetCommits, SourceExtractProposals, DataPlans, ChartSpecs, FigurePackages, or Manuscript placements.

**Tech Stack:** Node backend with built-in test runner, existing SaaS route/store patterns, React/Vite frontend helper tests, existing SourceDocument range/index utilities.

---

## Non-Negotiable Rules

- Retrieval can read the workbook index, but default usable results must come only from accepted `WorkbookUnderstanding`.
- `SourceDocument`, `SourceRegion`, and raw cell index hits are suggestions only unless they are referenced by accepted understanding facts.
- Every result must include exact source refs: `sourceDocumentId`, `sheetName`, and `range` or cell refs.
- Wrong experiment aliases must be penalized or blocked. `Exp999` must not silently return another experiment.
- Retrieval is read-only. It must not create or mutate WorkbookReviewSessions, WorkbookUnderstandings, SourceExtractProposals, DatasetCommits, DataPlans, ChartSpecs, manuscripts, or audit-significant scientific data.

## Files

- Create: `backend/src/saas/evidenceRetrieval.js`
  - query parsing
  - accepted-understanding candidate extraction
  - optional unconfirmed suggestion extraction
  - ranking/scoring
  - bounded preview shaping
- Modify: `backend/src/saas/routes/saasRoutes.js`
  - add `POST /api/projects/:projectId/evidence/retrieve`
  - enforce project auth
  - call retrieval service
- Modify: `backend/src/saas/memoryStore.js`
  - add or reuse read methods needed by retrieval if missing
- Modify: `backend/src/saas/postgresStore.js`
  - add or reuse read methods needed by retrieval if missing
- Test: `backend/src/saas/evidenceRetrieval.test.js`
  - unit coverage for parser/scorer/result shape
- Test: `backend/src/saas/routes/saasRoutes.test.js`
  - route-level auth and end-to-end retrieval coverage
- Modify: `src/data/serverApi.js`
  - add `retrieveProjectEvidence(projectId, request, options)`
- Test: `src/data/serverApi.test.js`
  - helper URL/method/body/error tests
- Modify: `doc/contracts/saas-api-contract-v0.md`
  - document endpoint request/response/error shape
- Modify: `doc/contracts/canonical-data-dictionary.md`
  - define accepted evidence retrieval result vocabulary if not already present
- Modify: `doc/PROGRESS.md`
  - record milestone and verification after implementation
- Modify: `doc/task-checklist.md`
  - track active milestone while implementing

---

## Task 1: Backend Retrieval Service Unit Tests

**Files:**
- Create: `backend/src/saas/evidenceRetrieval.test.js`
- Create later: `backend/src/saas/evidenceRetrieval.js`

- [ ] **Step 1: Write parser and scoring tests first**

Add tests covering the exact MVP behavior:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEvidenceRetrievalQuery,
  retrieveWorkbookEvidence,
} from "./evidenceRetrieval.js";

test("parseEvidenceRetrievalQuery extracts experiment aliases and concepts", () => {
  const parsed = parseEvidenceRetrievalQuery("experiment 33 reaction rate");
  assert.deepEqual(parsed.experimentAliases, ["Exp33"]);
  assert.equal(parsed.concepts.includes("reaction_rate"), true);
});

test("retrieveWorkbookEvidence returns accepted WorkbookUnderstanding regions as usable results", async () => {
  const response = await retrieveWorkbookEvidence({
    query: "experiment 33 reaction rate",
    project: { id: "project_1", labId: "lab_1" },
    acceptedUnderstandings: [{
      id: "workbook_understanding_1",
      sourceDocumentId: "source_doc_exp33",
      facts: [{
        factId: "fact_exp33_rate",
        kind: "region_description",
        sourceDocumentId: "source_doc_exp33",
        sheetName: "Exp33",
        range: "A1:P61",
        semanticType: "reaction_rate_time_series",
        description: "Exp33 reaction rate table",
        sourceRefs: [{
          sourceType: "excel_range",
          sourceDocumentId: "source_doc_exp33",
          sheet: "Exp33",
          range: "A1:P61",
        }],
      }],
      regionSummaries: [],
    }],
    sourceDocuments: [{
      id: "source_doc_exp33",
      metadata: { workbookName: "Reaction_Rate_Exp33.xlsx" },
    }],
    sourceRegions: [],
    readRangePreview: async () => ({
      sheetName: "Exp33",
      range: "A1:P3",
      rows: [
        { rowNumber: 1, cells: [{ address: "A1", value: "Time" }, { address: "B1", value: "Rate" }] },
        { rowNumber: 2, cells: [{ address: "A2", value: 0 }, { address: "B2", value: 0.1 }] },
      ],
    }),
  });

  assert.equal(response.schemaVersion, "labrat.evidenceRetrieval.v1");
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].canUseForDataPlan, true);
  assert.equal(response.results[0].evidenceStatus, "accepted");
  assert.equal(response.results[0].workbookUnderstandingId, "workbook_understanding_1");
  assert.equal(response.results[0].factId, "fact_exp33_rate");
  assert.equal(response.results[0].sourceDocumentId, "source_doc_exp33");
  assert.equal(response.results[0].sheetName, "Exp33");
  assert.equal(response.results[0].range, "A1:P61");
  assert.equal(response.results[0].matchedSignals.includes("experiment_alias:Exp33"), true);
  assert.equal(response.results[0].matchedSignals.includes("semantic_type:reaction_rate_time_series"), true);
});

test("retrieveWorkbookEvidence blocks nonexistent requested experiments", async () => {
  const response = await retrieveWorkbookEvidence({
    query: "experiment 999 reaction rate",
    project: { id: "project_1", labId: "lab_1" },
    acceptedUnderstandings: [{
      id: "workbook_understanding_1",
      sourceDocumentId: "source_doc_exp33",
      facts: [{
        factId: "fact_exp33_rate",
        kind: "region_description",
        sourceDocumentId: "source_doc_exp33",
        sheetName: "Exp33",
        range: "A1:P61",
        semanticType: "reaction_rate_time_series",
        description: "Exp33 reaction rate table",
      }],
    }],
    sourceDocuments: [{ id: "source_doc_exp33", metadata: { workbookName: "Reaction_Rate_Exp33.xlsx" } }],
    sourceRegions: [],
    readRangePreview: async () => null,
  });

  assert.equal(response.results.length, 0);
  assert.equal(response.clarification.code, "no_accepted_region_match");
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test backend/src/saas/evidenceRetrieval.test.js
```

Expected: fail because `backend/src/saas/evidenceRetrieval.js` does not exist or exports are missing.

- [ ] **Step 3: Implement minimal retrieval service**

Create `backend/src/saas/evidenceRetrieval.js` with:

```js
export const EVIDENCE_RETRIEVAL_SCHEMA_VERSION = "labrat.evidenceRetrieval.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value) {
  return String(value ?? "").trim();
}

function slug(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(values) {
  return [...new Set(asArray(values).map(normalize).filter(Boolean))];
}

export function parseEvidenceRetrievalQuery(query = "") {
  const text = normalize(query);
  const lower = slug(text);
  const experimentAliases = unique([...text.matchAll(/\bexp(?:eriment)?\s*0*([0-9]+)\b/gi)]
    .map((match) => `Exp${Number(match[1])}`));
  const concepts = [];
  if (/\breaction\s*rate\b|\brate\b/.test(lower)) concepts.push("reaction_rate");
  if (/\btime\b|\bminute\b|\bmin\b/.test(lower)) concepts.push("time");
  if (/\bcarbon\b|\bc\s*number\b|\bdistribution\b/.test(lower)) concepts.push("component_distribution");
  const explicitRanges = unique([...text.matchAll(/\b([A-Z]{1,3}[0-9]+)\s*(?::|to)\s*([A-Z]{1,3}[0-9]+)\b/gi)]
    .map((match) => `${match[1].toUpperCase()}:${match[2].toUpperCase()}`));
  return { query: text, experimentAliases, concepts: unique(concepts), explicitRanges };
}

function textMatchesExperiment(text, aliases) {
  if (!aliases.length) return true;
  const haystack = slug(text);
  return aliases.some((alias) => haystack.includes(slug(alias)));
}

function conceptMatchesFact(concepts, fact) {
  if (!concepts.length) return true;
  const haystack = slug([fact.semanticType, fact.description, fact.sheetName, fact.range].join(" "));
  return concepts.some((concept) => {
    if (concept === "reaction_rate") return haystack.includes("reaction rate") || haystack.includes("reaction rate time series");
    if (concept === "component_distribution") return haystack.includes("component distribution") || haystack.includes("carbon") || haystack.includes("distribution");
    if (concept === "time") return haystack.includes("time");
    return haystack.includes(slug(concept));
  });
}

function sourceDocumentFor(sourceDocuments, sourceDocumentId) {
  return asArray(sourceDocuments).find((document) => document.id === sourceDocumentId) || {};
}

function scoreAcceptedFact({ parsed, fact, sourceDocument }) {
  const sourceText = [
    fact.description,
    fact.semanticType,
    fact.sheetName,
    fact.range,
    sourceDocument.metadata?.workbookName,
    sourceDocument.metadata?.fileName,
  ].join(" ");
  const matchedSignals = [];
  let score = 0;
  parsed.experimentAliases.forEach((alias) => {
    if (textMatchesExperiment(sourceText, [alias])) {
      score += 30;
      matchedSignals.push(`experiment_alias:${alias}`);
    }
  });
  if (!parsed.experimentAliases.length) score += 5;
  parsed.concepts.forEach((concept) => {
    if (conceptMatchesFact([concept], fact)) {
      score += 20;
      matchedSignals.push(`concept:${concept}`);
    }
  });
  if (fact.semanticType) {
    score += 15;
    matchedSignals.push(`semantic_type:${fact.semanticType}`);
  }
  parsed.explicitRanges.forEach((range) => {
    if (normalize(fact.range).toUpperCase() === range) {
      score += 35;
      matchedSignals.push(`explicit_range:${range}`);
    }
  });
  if (fact.semanticType === "ignored_region") score -= 100;
  return { score, matchedSignals };
}

function acceptedFactCandidates({ parsed, acceptedUnderstandings, sourceDocuments }) {
  return asArray(acceptedUnderstandings).flatMap((understanding) => (
    asArray(understanding.facts).map((fact) => {
      const sourceDocument = sourceDocumentFor(sourceDocuments, fact.sourceDocumentId || understanding.sourceDocumentId);
      const scored = scoreAcceptedFact({ parsed, fact, sourceDocument });
      return {
        resultId: `evidence_result_${fact.factId || `${understanding.id}_${fact.range}`}`,
        kind: "confirmed_region",
        evidenceStatus: "accepted",
        canUseForDataPlan: true,
        source: "workbook_understanding",
        workbookUnderstandingId: understanding.id,
        factId: fact.factId || null,
        sourceDocumentId: fact.sourceDocumentId || understanding.sourceDocumentId,
        workbookName: sourceDocument.metadata?.workbookName || sourceDocument.metadata?.fileName || "",
        sheetName: fact.sheetName,
        range: fact.range,
        semanticType: fact.semanticType || "",
        description: fact.description || "",
        sourceRefs: asArray(fact.sourceRefs).length ? fact.sourceRefs : [{
          sourceType: "excel_range",
          sourceDocumentId: fact.sourceDocumentId || understanding.sourceDocumentId,
          sheet: fact.sheetName,
          range: fact.range,
        }],
        score: scored.score,
        confidence: Math.min(1, Math.max(0, scored.score / 100)),
        matchedSignals: scored.matchedSignals,
      };
    })
  ));
}

async function attachPreview(result, readRangePreview) {
  if (!readRangePreview || !result.sourceDocumentId || !result.sheetName || !result.range) return result;
  const preview = await readRangePreview({
    sourceDocumentId: result.sourceDocumentId,
    sheetName: result.sheetName,
    range: result.range,
  });
  return { ...result, preview: preview || null };
}

export async function retrieveWorkbookEvidence({
  query = "",
  project = null,
  acceptedUnderstandings = [],
  sourceDocuments = [],
  sourceRegions = [],
  includeUnconfirmedSuggestions = false,
  includePreview = true,
  maxResults = 10,
  readRangePreview = null,
} = {}) {
  const parsed = parseEvidenceRetrievalQuery(query);
  const candidates = acceptedFactCandidates({ parsed, acceptedUnderstandings, sourceDocuments })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(25, Number(maxResults) || 10)));
  const results = includePreview
    ? await Promise.all(candidates.map((candidate) => attachPreview(candidate, readRangePreview)))
    : candidates;
  return {
    schemaVersion: EVIDENCE_RETRIEVAL_SCHEMA_VERSION,
    projectId: project?.id || null,
    query: parsed.query,
    parsedQuery: parsed,
    results,
    suggestions: includeUnconfirmedSuggestions ? [] : [],
    clarification: results.length ? null : {
      code: "no_accepted_region_match",
      message: "No confirmed workbook region matches this request. Select and confirm a region first.",
    },
  };
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
node --test backend/src/saas/evidenceRetrieval.test.js
```

Expected: all tests pass.

---

## Task 2: Route Endpoint

**Files:**
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Test: `backend/src/saas/routes/saasRoutes.test.js`

- [ ] **Step 1: Add route-level failing tests**

Add a route test that:

1. Creates a project.
2. Uploads or uses fixture-backed workbook source document.
3. Creates a WorkbookReviewSession.
4. Submits a revision with one red box described as reaction-rate data.
5. Confirms the understanding.
6. Calls retrieval.
7. Asserts the result is usable and source-backed.

Expected request:

```http
POST /api/projects/:projectId/evidence/retrieve
{
  "query": "experiment 33 reaction rate",
  "includePreview": true,
  "includeUnconfirmedSuggestions": true,
  "maxResults": 5
}
```

Expected response assertions:

```js
assert.equal(body.schemaVersion, "labrat.evidenceRetrieval.v1");
assert.equal(body.results[0].evidenceStatus, "accepted");
assert.equal(body.results[0].canUseForDataPlan, true);
assert.equal(body.results[0].source, "workbook_understanding");
assert.equal(body.results[0].sourceDocumentId, sourceDocumentId);
assert.equal(body.results[0].sheetName, "Sheet1");
assert.equal(body.results[0].range, "A1:D20");
assert.equal(body.results[0].preview != null, true);
```

Also add a negative route test:

```js
assert.equal(body.results.length, 0);
assert.equal(body.clarification.code, "no_accepted_region_match");
assert.equal(body.suggestions.every((item) => item.canUseForDataPlan === false), true);
```

- [ ] **Step 2: Run route tests and verify RED**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: fail because endpoint does not exist.

- [ ] **Step 3: Add route implementation**

In `backend/src/saas/routes/saasRoutes.js`:

- import `retrieveWorkbookEvidence`
- add `handleProjectEvidenceRetrieve`
- route `POST /api/projects/:projectId/evidence/retrieve`

Handler responsibilities:

```js
async function handleProjectEvidenceRetrieve(req, res, context, projectId) {
  const { project } = await projectAuth(req, context, projectId, "viewer");
  const body = await readJsonBody(req);
  const acceptedUnderstandings = context.store.listWorkbookUnderstandings
    ? await context.store.listWorkbookUnderstandings({ projectId: project.id, status: "accepted" })
    : [];
  const sourceDocuments = context.store.listSourceDocuments
    ? await context.store.listSourceDocuments({ projectId: project.id })
    : [];
  const sourceRegions = context.store.listSourceRegions
    ? await context.store.listSourceRegions({ projectId: project.id })
    : [];
  const response = await retrieveWorkbookEvidence({
    query: body.query || "",
    project,
    acceptedUnderstandings,
    sourceDocuments,
    sourceRegions,
    includeUnconfirmedSuggestions: body.includeUnconfirmedSuggestions === true,
    includePreview: body.includePreview !== false,
    maxResults: body.maxResults || 10,
    readRangePreview: async ({ sourceDocumentId, sheetName, range }) => {
      const sourceDocument = await context.store.findSourceDocumentById?.(sourceDocumentId);
      const indexBlobs = context.store.listSourceIndexBlobs
        ? await context.store.listSourceIndexBlobs({ sourceDocumentId })
        : [];
      return buildBoundedRangePreview({ sourceDocument, indexBlobs, sheetName, range });
    },
  });
  sendJson(res, 200, response);
}
```

Use existing range-read utility functions already present in `saasRoutes.js` or extract a tiny local helper if the current code keeps range construction inside another handler.

- [ ] **Step 4: Run route tests and verify GREEN**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: route tests pass.

---

## Task 3: Unconfirmed Suggestions

**Files:**
- Modify: `backend/src/saas/evidenceRetrieval.js`
- Test: `backend/src/saas/evidenceRetrieval.test.js`

- [ ] **Step 1: Add failing tests for suggestion-only source regions**

Add a unit test where there are no accepted understandings but a detected source region matches `reaction rate`.

Expected:

```js
assert.equal(response.results.length, 0);
assert.equal(response.suggestions.length, 1);
assert.equal(response.suggestions[0].evidenceStatus, "suggested_unconfirmed");
assert.equal(response.suggestions[0].canUseForDataPlan, false);
assert.equal(response.clarification.code, "no_accepted_region_match");
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --test backend/src/saas/evidenceRetrieval.test.js
```

Expected: suggestion assertions fail.

- [ ] **Step 3: Implement suggestion candidates**

Add a `suggestionCandidates()` helper that maps matching `sourceRegions` to:

```js
{
  kind: "detected_region",
  evidenceStatus: "suggested_unconfirmed",
  canUseForDataPlan: false,
  source: "source_region",
  sourceDocumentId,
  sourceRegionId,
  workbookName,
  sheetName,
  range,
  semanticType,
  description,
  score,
  confidence,
  matchedSignals
}
```

Important: do not merge suggestions into `results`.

- [ ] **Step 4: Run and verify GREEN**

Run:

```bash
node --test backend/src/saas/evidenceRetrieval.test.js
```

Expected: unit tests pass.

---

## Task 4: Frontend API Helper

**Files:**
- Modify: `src/data/serverApi.js`
- Test: `src/data/serverApi.test.js`

- [ ] **Step 1: Add failing helper test**

Add:

```js
await retrieveProjectEvidence("project_1", {
  query: "experiment 33 reaction rate",
  includePreview: true,
  includeUnconfirmedSuggestions: true,
}, { fetch: fetchImpl });

expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project_1/evidence/retrieve");
expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
  query: "experiment 33 reaction rate",
  includePreview: true,
  includeUnconfirmedSuggestions: true,
});
```

Also assert missing project id throws:

```js
await assert.rejects(
  () => retrieveProjectEvidence("", { query: "x" }, { fetch: fetchImpl }),
  /project id/i,
);
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm test -- src/data/serverApi.test.js
```

Expected: helper export missing.

- [ ] **Step 3: Implement helper**

Add to `src/data/serverApi.js`:

```js
export async function retrieveProjectEvidence(projectId, request = {}, options = {}) {
  if (!projectId) throw new Error("project id is required to retrieve project evidence");
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/evidence/retrieve`, {
    method: "POST",
    body: JSON.stringify({
      query: request.query || "",
      scope: request.scope || "accepted_understanding",
      includePreview: request.includePreview !== false,
      includeUnconfirmedSuggestions: request.includeUnconfirmedSuggestions === true,
      maxResults: request.maxResults || 10,
    }),
  }, options);
}
```

Match the existing helper style in `src/data/serverApi.js`; if the internal function name is not `apiFetch`, use the existing local helper in that file.

- [ ] **Step 4: Run and verify GREEN**

Run:

```bash
npm test -- src/data/serverApi.test.js
```

Expected: helper tests pass.

---

## Task 5: Contract Documentation

**Files:**
- Modify: `doc/contracts/saas-api-contract-v0.md`
- Modify: `doc/contracts/canonical-data-dictionary.md`

- [ ] **Step 1: Document endpoint**

Add:

```text
POST /api/projects/:projectId/evidence/retrieve
```

Request:

```json
{
  "query": "experiment 33 reaction rate",
  "scope": "accepted_understanding",
  "includePreview": true,
  "includeUnconfirmedSuggestions": true,
  "maxResults": 10
}
```

Response:

```json
{
  "schemaVersion": "labrat.evidenceRetrieval.v1",
  "projectId": "project_...",
  "query": "experiment 33 reaction rate",
  "parsedQuery": {
    "experimentAliases": ["Exp33"],
    "concepts": ["reaction_rate"],
    "explicitRanges": []
  },
  "results": [
    {
      "kind": "confirmed_region",
      "evidenceStatus": "accepted",
      "canUseForDataPlan": true,
      "source": "workbook_understanding",
      "workbookUnderstandingId": "workbook_understanding_...",
      "factId": "fact_...",
      "sourceDocumentId": "source_doc_...",
      "sheetName": "Exp33",
      "range": "A1:P61",
      "semanticType": "reaction_rate_time_series",
      "matchedSignals": ["experiment_alias:Exp33"],
      "sourceRefs": []
    }
  ],
  "suggestions": [
    {
      "kind": "detected_region",
      "evidenceStatus": "suggested_unconfirmed",
      "canUseForDataPlan": false
    }
  ],
  "clarification": null
}
```

Rules:

- `results[]` must only include accepted WorkbookUnderstanding evidence in this MVP.
- `suggestions[]` may include detected regions but must have `canUseForDataPlan: false`.
- No mutation is allowed.

- [ ] **Step 2: Run docs check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

---

## Task 6: Final Verification

**Files:**
- Update: `doc/task-checklist.md`
- Update: `doc/PROGRESS.md`

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
node --test backend/src/saas/evidenceRetrieval.test.js
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: all pass.

- [ ] **Step 2: Run targeted frontend helper test**

Run:

```bash
npm test -- src/data/serverApi.test.js
```

Expected: all pass.

- [ ] **Step 3: Run full verification for this slice**

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
- diff check has no whitespace errors, allowing existing LF/CRLF warnings

- [ ] **Step 4: Manual QA**

In Docker:

1. Log in.
2. Open a project.
3. Upload a workbook.
4. Confirm one red-box region as `reaction_rate_time_series`.
5. Call retrieval:

```powershell
Invoke-RestMethod `
  -Uri "$base/api/projects/$projectId/evidence/retrieve" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
    query = "experiment 33 reaction rate"
    includePreview = $true
    includeUnconfirmedSuggestions = $true
  } | ConvertTo-Json -Depth 10) `
  -WebSession $session
```

Expected:

- confirmed red box appears in `results`
- unconfirmed detected regions appear only in `suggestions`
- no chart/source extract/data plan is created

---

## Out Of Scope

- Embeddings.
- LLM reranking.
- DataPlan/DataSnapshot creation.
- ChartProposal/ChartSpec creation.
- FigurePackage or Manuscript placement.
- Formula tracing beyond returning existing source refs.
- Using unconfirmed SourceRegions as chart-ready evidence.

## Acceptance Criteria

- `POST /api/projects/:projectId/evidence/retrieve` exists and is read-only.
- Accepted WorkbookUnderstanding red boxes are returned as usable results.
- Unconfirmed SourceRegions are returned only as non-usable suggestions.
- Nonexistent experiment requests do not return another experiment as usable evidence.
- Responses include exact source refs and matched signals.
- Frontend has a helper but no new UI surface is required for this MVP.
- Tests cover accepted retrieval, nonexistent experiment, unconfirmed suggestion behavior, route behavior, and helper behavior.
