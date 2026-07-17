# Tool-Governed DataPlan Agent Transition Implementation Plan

Status: active / Phase 3 next
Last reviewed: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transition LabRat from tool-governed evidence retrieval to scheme 5: a Tool-Governed DataPlan Agent that turns confirmed workbook evidence into reviewable DataPlans and deterministic DataSnapshot previews.

**Architecture:** Tool-Governed Evidence Retrieval remains the evidence finder. The new DataPlan Agent consumes accepted retrieval results, calls backend-owned tools to inspect confirmed regions, infer table structure, bind columns, validate extraction plans, and execute bounded previews. LLMs may choose tools and propose bindings, but backend validators and executors own source refs, ranges, values, hashes, and final preview data.

**Tech Stack:** Node backend with built-in test runner, existing SaaS auth/store/route patterns, optional Anthropic-backed planner adapter, existing SourceDocument range/index utilities, React/Vite frontend helper and review UI tests, Plotly chart proposal flow after DataSnapshot review.

---

## Implementation Status

2026-06-29: Phase 1-2 transient backend slice is implemented. The codebase now has DataPlan/DataSnapshot schema validation, backend-owned DataPlan agent tools, deterministic DataSnapshot preview execution, a fallback DataPlan agent orchestrator, `POST /api/projects/:projectId/data-plans/draft`, frontend `draftServerProjectDataPlan()`, and route/helper tests.

Current execution focus: Phase 3 persisted review objects. Add persistent DataPlan/DataSnapshot storage, route contracts, audit behavior, frontend helpers, and contract docs. A persisted DataPlan/DataSnapshot must still not create chart proposals, ChartSpecs, FigurePackages, DatasetCommits, or manuscript placements.

Next after Phase 3: DataSnapshot-to-chart proposal flow, frontend review integration, optional LLM planner adapter, cross-compare support, and golden workbook evaluation.

The detailed task snippets below include historical Phase 1-2 steps for traceability. Treat Phase 1-2 as completed unless the implementation is intentionally reopened.

---

## Position In The Architecture

This plan starts **after** `doc/plans/tool-governed-evidence-retrieval-plan.md`.

Current target chain:

```text
Upload workbook
  -> SourceDocument / SourceRegion
  -> WorkbookReviewSession
  -> accepted WorkbookUnderstanding
  -> Tool-Governed Evidence Retrieval
  -> Tool-Governed DataPlan Agent
  -> DataSnapshot preview
  -> chart proposal
  -> ChartSpec
  -> Manuscript / FigurePackage later
```

The transition to scheme 5 means DataPlan compilation itself becomes a backend tool loop:

```text
DataPlan Agent
  -> inspect_region_schema
  -> infer_header_row
  -> rank_candidate_columns
  -> draft_data_plan
  -> validate_data_plan
  -> execute_data_snapshot_preview
  -> ask_data_plan_clarification when needed
```

## Non-Negotiable Rules

- DataPlan Agent inputs must come from accepted retrieval `results[]` only.
- DataPlan Agent must reject `suggested_unconfirmed` evidence.
- LLMs may propose bindings but may not invent cell values, source refs, experiment aliases, or arrays.
- DataSnapshot values must be read deterministically from SourceDocument index/range data.
- DataPlan review must happen before chart proposal and ChartSpec creation.
- Visual-only chart edits must not re-run DataPlan/DataSnapshot.
- Wrong experiment aliases must return clarification or validation errors, not another experiment's data.
- Cross-compare requires at least two verified series unless the user explicitly asks for one experiment.

## File Structure

- Create: `backend/src/saas/dataPlanSchemas.js`
  - DataPlan/DataSnapshot schema versions.
  - DataPlan operation validators.
  - Accepted evidence input validator.
  - Stable dependency and content hash helpers.

- Create: `backend/src/saas/dataPlanSchemas.test.js`
  - Unit tests for schema validation and invalid evidence rejection.

- Create: `backend/src/saas/dataPlanAgentTools.js`
  - Tool registry for DataPlan agent tools.
  - Region schema inspection.
  - Header row inference.
  - Candidate column ranking.
  - Draft plan construction.
  - Plan validation.

- Create: `backend/src/saas/dataPlanExecutor.js`
  - Deterministic DataSnapshot preview executor.
  - Numeric/date/string parsing.
  - XY series, multi-series, and component-distribution output.

- Create: `backend/src/saas/dataPlanAgent.js`
  - Orchestrator for tool-governed DataPlan compilation.
  - Fallback deterministic planner.
  - Optional LLM tool planner adapter.
  - Tool trace and clarification shaping.

- Create: `backend/src/saas/dataPlanAgent.test.js`
  - Unit tests for agent tools, planner orchestration, validation, execution, and clarifications.

- Modify: `backend/src/saas/memoryStore.js`
  - Add DataPlan/DataSnapshot persistence after transient draft is stable.

- Modify: `backend/src/saas/postgresStore.js`
  - Add DataPlan/DataSnapshot persistence after transient draft is stable.

- Create: `backend/migrations/010_data_plans_and_snapshots.sql`
  - Add persisted review objects for DataPlan and DataSnapshot.

- Modify: `backend/src/saas/routes/saasRoutes.js`
  - Add draft endpoint.
  - Add persistence endpoint.
  - Add snapshot endpoint.
  - Add chart proposal endpoint from DataSnapshot.

- Modify: `backend/src/saas/routes/saasRoutes.test.js`
  - Add route tests for DataPlan draft, snapshot preview, chart proposal, and no-bypass behavior.

- Modify: `backend/src/saas/routes/saasRoutes.postgres.test.js`
  - Add persistence/reload tests when `LABRAT_TEST_DATABASE_URL` is available.

- Modify: `src/data/serverApi.js`
  - Add frontend helpers for DataPlan draft/review/snapshot/chart proposal.

- Modify: `src/data/serverApi.test.js`
  - Add helper tests.

- Modify: `src/data/chartIntentClient.js`
  - Normalize `data_plan_review` gateway responses after DataPlan Agent exists.

- Modify: `src/components/BackendScanPanel.jsx`
  - Show DataPlan review card inside Chart Review path.

- Modify: `src/components/BackendScanPanel.test.jsx`
  - Add DataPlan review UI tests.

- Modify: `src/components/ProjectDashboard.test.jsx`
  - Add Ask LabRat / Chart Review routing tests.

- Modify: `doc/contracts/saas-api-contract-v0.md`
  - Replace planned DataPlan API notes with concrete request/response contracts.

- Modify: `doc/contracts/canonical-data-dictionary.md`
  - Define Tool-Governed DataPlan Agent, DataPlan operations, DataSnapshot output shapes, and tool trace vocabulary.

- Modify: `doc/PROGRESS.md`
  - Record milestone and verification.

---

## DataPlan Shape V1

DataPlan is a reviewable extraction plan, not final data:

```json
{
  "schemaVersion": "labrat.dataPlan.v1",
  "id": "data_plan_draft_...",
  "status": "draft",
  "task": "chart_data",
  "outputShape": "xy_series",
  "sourceEvidence": [
    {
      "retrievalResultId": "evidence_result_fact_exp33_rate",
      "workbookUnderstandingId": "workbook_understanding_...",
      "factId": "fact_exp33_rate",
      "sourceDocumentId": "source_doc_...",
      "sheetName": "Exp33",
      "range": "A1:P61",
      "evidenceStatus": "accepted"
    }
  ],
  "operations": [
    {
      "op": "read_table_region",
      "sourceDocumentId": "source_doc_...",
      "sheetName": "Exp33",
      "range": "A1:P61"
    },
    {
      "op": "use_row_as_header",
      "rowNumber": 1
    },
    {
      "op": "bind_columns",
      "bindings": {
        "x": {
          "semanticField": "reaction_time",
          "column": "A",
          "headerCell": "A1",
          "headerText": "Time",
          "unit": "min"
        },
        "y": {
          "semanticField": "reaction_rate",
          "column": "B",
          "headerCell": "B1",
          "headerText": "Rate",
          "unit": "mol/s"
        }
      }
    },
    {
      "op": "select_data_rows",
      "startRow": 2,
      "endRow": 61
    },
    {
      "op": "emit_xy_series",
      "seriesId": "series_exp33",
      "experimentAlias": "Exp33",
      "x": "reaction_time",
      "y": "reaction_rate"
    }
  ],
  "validation": {
    "status": "valid",
    "warnings": []
  },
  "requiresUserReview": true
}
```

## DataSnapshot Shape V1

DataSnapshot is deterministic output from a validated DataPlan:

```json
{
  "schemaVersion": "labrat.dataSnapshot.v1",
  "id": "data_snapshot_preview_...",
  "status": "preview",
  "dataPlanId": "data_plan_draft_...",
  "contentHash": "sha256_...",
  "outputShape": "xy_series",
  "series": [
    {
      "seriesId": "series_exp33",
      "experimentAlias": "Exp33",
      "x": [0, 5, 10],
      "y": [0.0012, 0.0015, 0.0011],
      "points": [
        {
          "x": 0,
          "y": 0.0012,
          "sourceRefs": [
            { "sourceType": "excel_cell", "sheet": "Exp33", "cell": "A2", "fieldId": "reaction_time" },
            { "sourceType": "excel_cell", "sheet": "Exp33", "cell": "B2", "fieldId": "reaction_rate" }
          ]
        }
      ]
    }
  ],
  "warnings": []
}
```

---

## Phase 1: Transient DataPlan Agent Draft

This phase does not persist DataPlans. It proves that the scheme 5 tool loop can produce a reviewable plan and preview from accepted evidence.

### Task 1: DataPlan Schema And Validation

**Files:**
- Create: `backend/src/saas/dataPlanSchemas.test.js`
- Create: `backend/src/saas/dataPlanSchemas.js`

- [ ] **Step 1: Write failing schema tests**

Add tests:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_PLAN_SCHEMA_VERSION,
  DATA_SNAPSHOT_SCHEMA_VERSION,
  validateDataPlanDraft,
  validateAcceptedEvidenceInputs,
} from "./dataPlanSchemas.js";

test("validateAcceptedEvidenceInputs accepts confirmed retrieval results", () => {
  const evidence = validateAcceptedEvidenceInputs([
    {
      resultId: "evidence_result_fact_exp33_rate",
      evidenceStatus: "accepted",
      canUseForDataPlan: true,
      sourceDocumentId: "source_doc_1",
      sheetName: "Exp33",
      range: "A1:P61",
      workbookUnderstandingId: "workbook_understanding_1",
      factId: "fact_exp33_rate",
    },
  ]);

  assert.equal(evidence.ok, true);
  assert.equal(evidence.evidence[0].sourceDocumentId, "source_doc_1");
});

test("validateAcceptedEvidenceInputs rejects unconfirmed suggestions", () => {
  const evidence = validateAcceptedEvidenceInputs([
    {
      resultId: "suggestion_1",
      evidenceStatus: "suggested_unconfirmed",
      canUseForDataPlan: false,
      sourceDocumentId: "source_doc_1",
      sheetName: "Exp33",
      range: "A1:P61",
    },
  ]);

  assert.equal(evidence.ok, false);
  assert.equal(evidence.errors[0].code, "evidence_not_accepted");
});

test("validateDataPlanDraft accepts bounded table-column extraction", () => {
  const plan = validateDataPlanDraft({
    schemaVersion: DATA_PLAN_SCHEMA_VERSION,
    status: "draft",
    task: "chart_data",
    outputShape: "xy_series",
    sourceEvidence: [{
      sourceDocumentId: "source_doc_1",
      sheetName: "Exp33",
      range: "A1:P61",
      evidenceStatus: "accepted",
    }],
    operations: [
      { op: "read_table_region", sourceDocumentId: "source_doc_1", sheetName: "Exp33", range: "A1:P61" },
      { op: "use_row_as_header", rowNumber: 1 },
      { op: "bind_columns", bindings: { x: { column: "A", semanticField: "reaction_time" }, y: { column: "B", semanticField: "reaction_rate" } } },
      { op: "select_data_rows", startRow: 2, endRow: 61 },
      { op: "emit_xy_series", seriesId: "series_exp33", experimentAlias: "Exp33", x: "reaction_time", y: "reaction_rate" },
    ],
  });

  assert.equal(plan.ok, true);
});

test("schema versions are stable", () => {
  assert.equal(DATA_PLAN_SCHEMA_VERSION, "labrat.dataPlan.v1");
  assert.equal(DATA_SNAPSHOT_SCHEMA_VERSION, "labrat.dataSnapshot.v1");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test backend/src/saas/dataPlanSchemas.test.js
```

Expected: fail because `dataPlanSchemas.js` does not exist.

- [ ] **Step 3: Implement minimal schemas**

Create `backend/src/saas/dataPlanSchemas.js`:

```js
export const DATA_PLAN_SCHEMA_VERSION = "labrat.dataPlan.v1";
export const DATA_SNAPSHOT_SCHEMA_VERSION = "labrat.dataSnapshot.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function error(code, message, details = {}) {
  return { code, message, ...details };
}

export function validateAcceptedEvidenceInputs(results = []) {
  const errors = [];
  const evidence = asArray(results).map((item, index) => {
    if (item.evidenceStatus !== "accepted" || item.canUseForDataPlan !== true) {
      errors.push(error("evidence_not_accepted", "Only accepted retrieval results can be used for DataPlan.", { index }));
    }
    if (!text(item.sourceDocumentId) || !text(item.sheetName) || !text(item.range)) {
      errors.push(error("missing_source_ref", "Evidence result must include sourceDocumentId, sheetName, and range.", { index }));
    }
    return {
      retrievalResultId: text(item.resultId),
      workbookUnderstandingId: text(item.workbookUnderstandingId),
      factId: text(item.factId),
      sourceDocumentId: text(item.sourceDocumentId),
      sheetName: text(item.sheetName),
      range: text(item.range),
      semanticType: text(item.semanticType),
      evidenceStatus: item.evidenceStatus,
    };
  });
  return { ok: errors.length === 0, evidence, errors };
}

export function validateDataPlanDraft(plan = {}) {
  const errors = [];
  if (plan.schemaVersion !== DATA_PLAN_SCHEMA_VERSION) {
    errors.push(error("invalid_schema_version", "DataPlan schemaVersion must be labrat.dataPlan.v1."));
  }
  if (!["draft", "validated"].includes(text(plan.status))) {
    errors.push(error("invalid_status", "DataPlan status must be draft or validated."));
  }
  if (!text(plan.outputShape)) {
    errors.push(error("missing_output_shape", "DataPlan outputShape is required."));
  }
  const evidenceCheck = validateAcceptedEvidenceInputs(plan.sourceEvidence || []);
  errors.push(...evidenceCheck.errors);
  const operations = asArray(plan.operations);
  if (!operations.some((op) => op.op === "read_table_region")) {
    errors.push(error("missing_read_operation", "DataPlan must read a source region."));
  }
  if (!operations.some((op) => op.op === "bind_columns")) {
    errors.push(error("missing_bind_columns", "DataPlan must bind source columns."));
  }
  if (!operations.some((op) => String(op.op || "").startsWith("emit_"))) {
    errors.push(error("missing_emit_operation", "DataPlan must emit an output shape."));
  }
  return { ok: errors.length === 0, plan, errors };
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/dataPlanSchemas.test.js
```

Expected: tests pass.

### Task 2: DataPlan Agent Tools

**Files:**
- Create: `backend/src/saas/dataPlanAgent.test.js`
- Create: `backend/src/saas/dataPlanAgentTools.js`

- [ ] **Step 1: Write failing tests for tool outputs**

Add:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createDataPlanAgentTools } from "./dataPlanAgentTools.js";

const evidenceResults = [
  {
    resultId: "evidence_result_fact_exp33_rate",
    evidenceStatus: "accepted",
    canUseForDataPlan: true,
    sourceDocumentId: "source_doc_exp33",
    sheetName: "Exp33",
    range: "A1:C4",
    semanticType: "reaction_rate_time_series",
    workbookUnderstandingId: "workbook_understanding_1",
    factId: "fact_exp33_rate",
  },
];

const preview = {
  sheetName: "Exp33",
  range: "A1:C4",
  rows: [
    { rowNumber: 1, cells: [{ address: "A1", value: "Time" }, { address: "B1", value: "Rate" }, { address: "C1", value: "Temp" }] },
    { rowNumber: 2, cells: [{ address: "A2", value: 0 }, { address: "B2", value: 0.1 }, { address: "C2", value: 80 }] },
    { rowNumber: 3, cells: [{ address: "A3", value: 5 }, { address: "B3", value: 0.2 }, { address: "C3", value: 80 }] },
  ],
};

test("inspect_region_schema summarizes headers and numeric columns", async () => {
  const tools = createDataPlanAgentTools({
    evidenceResults,
    readRangePreview: async () => preview,
  });

  const response = await tools.inspect_region_schema({
    evidenceResultId: "evidence_result_fact_exp33_rate",
  });

  assert.equal(response.schema.evidenceResultId, "evidence_result_fact_exp33_rate");
  assert.deepEqual(response.schema.headers.map((header) => header.text), ["Time", "Rate", "Temp"]);
  assert.deepEqual(response.schema.numericColumns.map((column) => column.column), ["A", "B", "C"]);
});

test("rank_candidate_columns finds time and reaction-rate bindings", async () => {
  const tools = createDataPlanAgentTools({
    evidenceResults,
    readRangePreview: async () => preview,
  });

  const schema = (await tools.inspect_region_schema({ evidenceResultId: "evidence_result_fact_exp33_rate" })).schema;
  const time = await tools.rank_candidate_columns({ schema, targetField: "reaction_time" });
  const rate = await tools.rank_candidate_columns({ schema, targetField: "reaction_rate" });

  assert.equal(time.candidates[0].column, "A");
  assert.equal(rate.candidates[0].column, "B");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
```

Expected: fails because `dataPlanAgentTools.js` does not exist.

- [ ] **Step 3: Implement initial tools**

Create `backend/src/saas/dataPlanAgentTools.js`:

```js
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? "").trim();
}

function columnFromAddress(address) {
  return clean(address).match(/^[A-Z]+/)?.[0] || "";
}

function isNumeric(value) {
  if (value === null || value === undefined || clean(value) === "") return false;
  return Number.isFinite(Number(String(value).replace(/%$/, "")));
}

function scoreHeader(targetField, headerText) {
  const normalized = clean(headerText).toLowerCase();
  if (targetField === "reaction_time") {
    if (/\btime\b|minute|min|hour|hr/.test(normalized)) return 100;
  }
  if (targetField === "reaction_rate") {
    if (/reaction.*rate|rate/.test(normalized)) return 100;
  }
  if (targetField === "carbon_number") {
    if (/carbon|c\s*number|^c\d+/.test(normalized)) return 100;
  }
  if (targetField === "percentage") {
    if (/percent|percentage|%|overall/.test(normalized)) return 100;
  }
  return 0;
}

function findEvidence(evidenceResults, evidenceResultId) {
  return asArray(evidenceResults).find((item) => item.resultId === evidenceResultId);
}

export function createDataPlanAgentTools({ evidenceResults = [], readRangePreview } = {}) {
  return {
    async inspect_region_schema(input = {}) {
      const evidence = findEvidence(evidenceResults, input.evidenceResultId);
      if (!evidence) return { error: { code: "evidence_not_found", message: "Evidence result not found." } };
      const preview = await readRangePreview({
        sourceDocumentId: evidence.sourceDocumentId,
        sheetName: evidence.sheetName,
        range: evidence.range,
      });
      const headerRow = asArray(preview.rows)[0] || { rowNumber: 1, cells: [] };
      const headers = asArray(headerRow.cells).map((cell) => ({
        column: columnFromAddress(cell.address),
        cell: cell.address,
        text: clean(cell.value),
      }));
      const numericColumns = headers.filter((header) => {
        const values = asArray(preview.rows)
          .slice(1)
          .map((row) => asArray(row.cells).find((cell) => columnFromAddress(cell.address) === header.column)?.value);
        return values.some(isNumeric);
      });
      return {
        schema: {
          evidenceResultId: evidence.resultId,
          sourceDocumentId: evidence.sourceDocumentId,
          sheetName: evidence.sheetName,
          range: evidence.range,
          headerRow: headerRow.rowNumber,
          headers,
          numericColumns,
          preview,
        },
      };
    },

    async infer_header_row(input = {}) {
      const schema = input.schema;
      return {
        headerRow: schema?.headerRow || 1,
        confidence: 0.9,
        reason: "The first preview row contains text headers and later rows contain numeric values.",
      };
    },

    async rank_candidate_columns(input = {}) {
      const schema = input.schema || {};
      const targetField = clean(input.targetField);
      const candidates = asArray(schema.headers)
        .map((header) => ({
          column: header.column,
          headerCell: header.cell,
          headerText: header.text,
          semanticField: targetField,
          score: scoreHeader(targetField, header.text),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score);
      return { candidates };
    },
  };
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
```

Expected: tests pass.

### Task 3: DataPlan Draft And Validation Tools

**Files:**
- Modify: `backend/src/saas/dataPlanAgentTools.js`
- Modify: `backend/src/saas/dataPlanAgent.test.js`

- [ ] **Step 1: Add failing test for draft and validate tools**

Add:

```js
test("draft_data_plan and validate_data_plan produce reviewable xy_series plan", async () => {
  const tools = createDataPlanAgentTools({
    evidenceResults,
    readRangePreview: async () => preview,
  });
  const schema = (await tools.inspect_region_schema({ evidenceResultId: "evidence_result_fact_exp33_rate" })).schema;
  const draft = await tools.draft_data_plan({
    query: "draw reaction rate vs time for experiment 33",
    schema,
    bindings: {
      x: { column: "A", headerCell: "A1", headerText: "Time", semanticField: "reaction_time" },
      y: { column: "B", headerCell: "B1", headerText: "Rate", semanticField: "reaction_rate" },
    },
    outputShape: "xy_series",
    experimentAlias: "Exp33",
  });

  assert.equal(draft.dataPlan.outputShape, "xy_series");
  assert.equal(draft.dataPlan.operations.some((op) => op.op === "emit_xy_series"), true);

  const validation = await tools.validate_data_plan({ dataPlan: draft.dataPlan });
  assert.equal(validation.status, "valid");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
```

Expected: fails because draft/validate tools are missing.

- [ ] **Step 3: Implement draft and validate tools**

Import schema helpers in `dataPlanAgentTools.js`:

```js
import {
  DATA_PLAN_SCHEMA_VERSION,
  validateDataPlanDraft,
} from "./dataPlanSchemas.js";
```

Add tools:

```js
async draft_data_plan(input = {}) {
  const schema = input.schema || {};
  const bindings = input.bindings || {};
  const dataPlan = {
    schemaVersion: DATA_PLAN_SCHEMA_VERSION,
    id: `data_plan_draft_${Date.now()}`,
    status: "draft",
    task: "chart_data",
    outputShape: input.outputShape || "xy_series",
    sourceEvidence: [{
      retrievalResultId: schema.evidenceResultId,
      sourceDocumentId: schema.sourceDocumentId,
      sheetName: schema.sheetName,
      range: schema.range,
      evidenceStatus: "accepted",
    }],
    operations: [
      { op: "read_table_region", sourceDocumentId: schema.sourceDocumentId, sheetName: schema.sheetName, range: schema.range },
      { op: "use_row_as_header", rowNumber: schema.headerRow },
      { op: "bind_columns", bindings },
      { op: "select_data_rows", startRow: schema.headerRow + 1, endRow: schema.preview?.rows?.at(-1)?.rowNumber || schema.headerRow + 1 },
      { op: "emit_xy_series", seriesId: `series_${String(input.experimentAlias || "default").toLowerCase()}`, experimentAlias: input.experimentAlias || "", x: bindings.x?.semanticField, y: bindings.y?.semanticField },
    ],
    requiresUserReview: true,
  };
  return { dataPlan };
},

async validate_data_plan(input = {}) {
  const validation = validateDataPlanDraft(input.dataPlan);
  return {
    status: validation.ok ? "valid" : "invalid",
    errors: validation.errors,
    dataPlan: input.dataPlan,
  };
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
```

Expected: tests pass.

### Task 4: DataSnapshot Preview Executor

**Files:**
- Create: `backend/src/saas/dataPlanExecutor.js`
- Modify: `backend/src/saas/dataPlanAgent.test.js`

- [ ] **Step 1: Add failing executor test**

Add:

```js
import { executeDataSnapshotPreview } from "./dataPlanExecutor.js";

test("executeDataSnapshotPreview extracts xy points with source refs", async () => {
  const dataPlan = {
    schemaVersion: "labrat.dataPlan.v1",
    id: "data_plan_draft_1",
    status: "draft",
    task: "chart_data",
    outputShape: "xy_series",
    sourceEvidence: [{
      sourceDocumentId: "source_doc_exp33",
      sheetName: "Exp33",
      range: "A1:C4",
      evidenceStatus: "accepted",
    }],
    operations: [
      { op: "read_table_region", sourceDocumentId: "source_doc_exp33", sheetName: "Exp33", range: "A1:C4" },
      { op: "use_row_as_header", rowNumber: 1 },
      { op: "bind_columns", bindings: { x: { column: "A", semanticField: "reaction_time" }, y: { column: "B", semanticField: "reaction_rate" } } },
      { op: "select_data_rows", startRow: 2, endRow: 3 },
      { op: "emit_xy_series", seriesId: "series_exp33", experimentAlias: "Exp33", x: "reaction_time", y: "reaction_rate" },
    ],
  };

  const snapshot = await executeDataSnapshotPreview({
    dataPlan,
    readRangePreview: async () => preview,
  });

  assert.equal(snapshot.schemaVersion, "labrat.dataSnapshot.v1");
  assert.equal(snapshot.outputShape, "xy_series");
  assert.deepEqual(snapshot.series[0].x, [0, 5]);
  assert.deepEqual(snapshot.series[0].y, [0.1, 0.2]);
  assert.equal(snapshot.series[0].points[0].sourceRefs[0].cell, "A2");
  assert.equal(snapshot.series[0].points[0].sourceRefs[1].cell, "B2");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
```

Expected: fails because executor is missing.

- [ ] **Step 3: Implement executor**

Create `backend/src/saas/dataPlanExecutor.js`:

```js
import crypto from "node:crypto";
import { DATA_SNAPSHOT_SCHEMA_VERSION } from "./dataPlanSchemas.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function columnFromAddress(address) {
  return String(address || "").match(/^[A-Z]+/)?.[0] || "";
}

function parseNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized = String(value).trim().replace(/%$/, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function stableHash(value) {
  return `sha256_${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function operation(dataPlan, opName) {
  return asArray(dataPlan.operations).find((op) => op.op === opName) || null;
}

function cellByColumn(row, column) {
  return asArray(row.cells).find((cell) => columnFromAddress(cell.address) === column) || null;
}

export async function executeDataSnapshotPreview({ dataPlan, readRangePreview }) {
  const readOp = operation(dataPlan, "read_table_region");
  const bindOp = operation(dataPlan, "bind_columns");
  const rowsOp = operation(dataPlan, "select_data_rows");
  const emitOp = asArray(dataPlan.operations).find((op) => op.op === "emit_xy_series");
  const preview = await readRangePreview({
    sourceDocumentId: readOp.sourceDocumentId,
    sheetName: readOp.sheetName,
    range: readOp.range,
  });
  const xColumn = bindOp.bindings.x.column;
  const yColumn = bindOp.bindings.y.column;
  const selectedRows = asArray(preview.rows).filter((row) => (
    row.rowNumber >= rowsOp.startRow && row.rowNumber <= rowsOp.endRow
  ));
  const points = selectedRows.map((row) => {
    const xCell = cellByColumn(row, xColumn);
    const yCell = cellByColumn(row, yColumn);
    return {
      x: parseNumber(xCell?.value),
      y: parseNumber(yCell?.value),
      sourceRefs: [
        { sourceType: "excel_cell", sourceDocumentId: readOp.sourceDocumentId, sheet: readOp.sheetName, cell: xCell?.address, fieldId: bindOp.bindings.x.semanticField },
        { sourceType: "excel_cell", sourceDocumentId: readOp.sourceDocumentId, sheet: readOp.sheetName, cell: yCell?.address, fieldId: bindOp.bindings.y.semanticField },
      ],
    };
  }).filter((point) => point.x !== null && point.y !== null);
  const snapshot = {
    schemaVersion: DATA_SNAPSHOT_SCHEMA_VERSION,
    id: `data_snapshot_preview_${Date.now()}`,
    status: "preview",
    dataPlanId: dataPlan.id,
    outputShape: dataPlan.outputShape,
    series: [{
      seriesId: emitOp.seriesId,
      experimentAlias: emitOp.experimentAlias,
      x: points.map((point) => point.x),
      y: points.map((point) => point.y),
      points,
    }],
    warnings: [],
  };
  return { ...snapshot, contentHash: stableHash(snapshot.series) };
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
```

Expected: tests pass.

### Task 5: DataPlan Agent Orchestrator

**Files:**
- Create: `backend/src/saas/dataPlanAgent.js`
- Modify: `backend/src/saas/dataPlanAgent.test.js`

- [ ] **Step 1: Add failing orchestrator tests**

Add:

```js
import { runDataPlanAgent } from "./dataPlanAgent.js";

test("runDataPlanAgent creates DataPlan draft and DataSnapshot preview from accepted evidence", async () => {
  const response = await runDataPlanAgent({
    query: "draw reaction rate vs time for experiment 33",
    retrievalResults: evidenceResults,
    readRangePreview: async () => preview,
  });

  assert.equal(response.resultKind, "data_plan_review");
  assert.equal(response.dataPlanDraft.outputShape, "xy_series");
  assert.equal(response.dataSnapshotPreview.series[0].experimentAlias, "Exp33");
  assert.equal(response.dataSnapshotPreview.series[0].x.length, 2);
  assert.equal(response.toolTrace.some((step) => step.tool === "validate_data_plan"), true);
});

test("runDataPlanAgent rejects unconfirmed retrieval suggestions", async () => {
  const response = await runDataPlanAgent({
    query: "draw reaction rate vs time for experiment 33",
    retrievalResults: [{
      resultId: "suggestion_1",
      evidenceStatus: "suggested_unconfirmed",
      canUseForDataPlan: false,
      sourceDocumentId: "source_doc_exp33",
      sheetName: "Exp33",
      range: "A1:C4",
    }],
    readRangePreview: async () => preview,
  });

  assert.equal(response.resultKind, "clarification");
  assert.equal(response.clarification.code, "accepted_evidence_required");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
```

Expected: fails because `dataPlanAgent.js` is missing.

- [ ] **Step 3: Implement fallback DataPlan agent**

Create `backend/src/saas/dataPlanAgent.js`:

```js
import { validateAcceptedEvidenceInputs } from "./dataPlanSchemas.js";
import { createDataPlanAgentTools } from "./dataPlanAgentTools.js";
import { executeDataSnapshotPreview } from "./dataPlanExecutor.js";

function inferExperimentAlias(query, evidence) {
  const match = String(query || evidence.sheetName || "").match(/exp(?:eriment)?\s*0*([0-9]+)/i);
  return match ? `Exp${Number(match[1])}` : evidence.sheetName || "";
}

export async function runDataPlanAgent({
  query = "",
  retrievalResults = [],
  readRangePreview,
  planner = null,
} = {}) {
  const evidenceCheck = validateAcceptedEvidenceInputs(retrievalResults);
  if (!evidenceCheck.ok) {
    return {
      resultKind: "clarification",
      clarification: {
        code: "accepted_evidence_required",
        message: "DataPlan creation requires accepted retrieval evidence.",
        errors: evidenceCheck.errors,
      },
      toolTrace: [],
    };
  }
  const tools = createDataPlanAgentTools({ evidenceResults: retrievalResults, readRangePreview });
  const selectedEvidence = retrievalResults[0];
  const schemaResponse = await tools.inspect_region_schema({ evidenceResultId: selectedEvidence.resultId });
  const xRank = await tools.rank_candidate_columns({ schema: schemaResponse.schema, targetField: "reaction_time" });
  const yRank = await tools.rank_candidate_columns({ schema: schemaResponse.schema, targetField: "reaction_rate" });
  if (!xRank.candidates[0] || !yRank.candidates[0]) {
    return {
      resultKind: "clarification",
      clarification: {
        code: "data_plan_binding_ambiguous",
        message: "I could not confidently bind reaction time and reaction rate columns.",
      },
      toolTrace: [
        { tool: "inspect_region_schema", status: "completed" },
        { tool: "rank_candidate_columns", status: "completed" },
      ],
    };
  }
  const draft = await tools.draft_data_plan({
    query,
    schema: schemaResponse.schema,
    bindings: { x: xRank.candidates[0], y: yRank.candidates[0] },
    outputShape: "xy_series",
    experimentAlias: inferExperimentAlias(query, selectedEvidence),
  });
  const validation = await tools.validate_data_plan({ dataPlan: draft.dataPlan });
  const snapshot = await executeDataSnapshotPreview({ dataPlan: draft.dataPlan, readRangePreview });
  return {
    resultKind: "data_plan_review",
    planner: { provider: planner ? "custom_planner" : "fallback_data_plan_agent" },
    toolTrace: [
      { tool: "inspect_region_schema", status: "completed" },
      { tool: "rank_candidate_columns", status: "completed", resultCount: xRank.candidates.length + yRank.candidates.length },
      { tool: "draft_data_plan", status: "completed" },
      { tool: "validate_data_plan", status: validation.status === "valid" ? "completed" : "failed" },
      { tool: "execute_data_snapshot_preview", status: "completed" },
    ],
    dataPlanDraft: draft.dataPlan,
    dataSnapshotPreview: snapshot,
    clarification: null,
  };
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
```

Expected: tests pass.

---

## Phase 2: Project API Draft Endpoint

### Task 6: Add Transient Draft Route

**Files:**
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`

- [ ] **Step 1: Add failing route test**

Add route coverage:

```js
test("POST /api/projects/:projectId/data-plans/draft creates reviewable DataPlan from accepted retrieval results", async () => {
  const fixture = await createProjectWithAcceptedWorkbookUnderstanding({
    description: "Exp33 reaction rate data over time",
    semanticType: "reaction_rate_time_series",
    sheetName: "Exp33",
    range: "A1:C4",
    rows: [
      ["Time", "Rate", "Temp"],
      [0, 0.1, 80],
      [5, 0.2, 80],
    ],
  });

  const retrieval = await requestJson(fixture.server, {
    method: "POST",
    path: `/api/projects/${fixture.projectId}/evidence/retrieve`,
    cookies: fixture.cookies,
    body: { query: "draw reaction rate vs time for experiment 33", mode: "tool_agent" },
  });

  const response = await requestJson(fixture.server, {
    method: "POST",
    path: `/api/projects/${fixture.projectId}/data-plans/draft`,
    cookies: fixture.cookies,
    body: {
      query: "draw reaction rate vs time for experiment 33",
      retrievalResults: retrieval.body.results,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.resultKind, "data_plan_review");
  assert.equal(response.body.dataPlanDraft.outputShape, "xy_series");
  assert.equal(response.body.dataSnapshotPreview.series[0].x.length, 2);
});
```

Use existing test helpers if their names differ. If evidence retrieval route is not implemented yet, create the accepted retrieval result inline using the same shape returned by that plan.

- [ ] **Step 2: Run route test and verify RED**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: fails because `/data-plans/draft` does not exist.

- [ ] **Step 3: Implement route**

In `backend/src/saas/routes/saasRoutes.js`, import:

```js
import { runDataPlanAgent } from "../dataPlanAgent.js";
```

Add handler:

```js
async function handleProjectDataPlanDraft(req, res, context, projectId) {
  const { project } = await requireProjectRole(req, context, projectId, "editor");
  const body = await readJsonBody(req);
  const response = await runDataPlanAgent({
    query: body.query || "",
    retrievalResults: body.retrievalResults || [],
    readRangePreview: async ({ sourceDocumentId, sheetName, range }) => (
      readSourceDocumentRangeForRoute(context, {
        sourceDocumentId,
        sheetName,
        range,
        maxCells: 600,
      })
    ),
  });
  sendJson(res, 200, { ...response, projectId: project.id });
}
```

Register:

```js
if (method === "POST" && /^\/api\/projects\/[^/]+\/data-plans\/draft$/.test(pathname)) {
  const projectId = decodeURIComponent(pathname.split("/")[3]);
  return handleProjectDataPlanDraft(req, res, context, projectId);
}
```

Use existing route helper names in `saasRoutes.js` if they differ.

- [ ] **Step 4: Run route test and verify GREEN**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: tests pass.

### Task 7: Frontend Helper For Draft Endpoint

**Files:**
- Modify: `src/data/serverApi.js`
- Modify: `src/data/serverApi.test.js`

- [ ] **Step 1: Add failing helper test**

Add:

```js
test("draftServerProjectDataPlan posts retrieval results", async () => {
  const fetchImpl = vi.fn(async () => jsonResponse({ resultKind: "data_plan_review" }));

  await draftServerProjectDataPlan("project_1", {
    query: "draw reaction rate vs time for experiment 33",
    retrievalResults: [{ resultId: "evidence_result_1" }],
  }, { fetch: fetchImpl });

  expect(fetchImpl).toHaveBeenCalledWith(
    "/api/projects/project_1/data-plans/draft",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        query: "draw reaction rate vs time for experiment 33",
        retrievalResults: [{ resultId: "evidence_result_1" }],
      }),
    }),
  );
});
```

- [ ] **Step 2: Run helper test and verify RED**

Run:

```bash
npm test -- src/data/serverApi.test.js
```

Expected: fails because helper is missing.

- [ ] **Step 3: Implement helper**

Add to `src/data/serverApi.js`:

```js
export function draftServerProjectDataPlan(projectId, request = {}, options = {}) {
  if (!projectId) throw new Error("project id is required to draft a data plan");
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/data-plans/draft`, {
    method: "POST",
    body: JSON.stringify({
      query: request.query || "",
      retrievalResults: request.retrievalResults || [],
    }),
  }, options);
}
```

Use the existing local request helper if it is not named `apiFetch`.

- [ ] **Step 4: Run helper test and verify GREEN**

Run:

```bash
npm test -- src/data/serverApi.test.js
```

Expected: tests pass.

---

## Phase 3: Persisted Review Objects

This phase makes DataPlan/DataSnapshot durable after transient draft output is correct.

### Task 8: Add Store And Migration

**Files:**
- Create: `backend/migrations/010_data_plans_and_snapshots.sql`
- Modify: `backend/src/saas/memoryStore.js`
- Modify: `backend/src/saas/postgresStore.js`
- Modify: `backend/src/saas/routes/saasRoutes.postgres.test.js`

- [ ] **Step 1: Add migration**

Create:

```sql
create table if not exists data_plans (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  status text not null,
  schema_version text not null,
  plan jsonb not null,
  source_evidence jsonb not null default '[]'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  created_by text references users(id),
  updated_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_snapshots (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  data_plan_id text not null references data_plans(id),
  status text not null,
  schema_version text not null,
  content_hash text not null,
  snapshot jsonb not null,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_data_plans_project_id on data_plans(project_id);
create index if not exists idx_data_snapshots_project_id on data_snapshots(project_id);
create index if not exists idx_data_snapshots_data_plan_id on data_snapshots(data_plan_id);
```

- [ ] **Step 2: Add failing store tests through route**

Add a Postgres route test:

```js
test("accepted DataPlan and DataSnapshot survive reload", async () => {
  const fixture = await createProjectWithAcceptedDataPlanDraft();
  const createPlan = await requestJson(fixture.server, {
    method: "POST",
    path: `/api/projects/${fixture.projectId}/data-plans`,
    cookies: fixture.cookies,
    body: { dataPlan: fixture.dataPlanDraft },
  });
  const snapshot = await requestJson(fixture.server, {
    method: "POST",
    path: `/api/data-plans/${createPlan.body.dataPlan.id}/snapshot`,
    cookies: fixture.cookies,
    body: {},
  });

  assert.equal(createPlan.body.dataPlan.status, "validated");
  assert.equal(snapshot.body.dataSnapshot.status, "preview");
});
```

- [ ] **Step 3: Implement store methods**

Add methods:

```js
async createDataPlan(input) {}
async findDataPlanById(id) {}
async listDataPlans({ projectId }) {}
async createDataSnapshot(input) {}
async findDataSnapshotById(id) {}
async listDataSnapshots({ projectId }) {}
```

Memory store should keep arrays. Postgres store should serialize JSONB fields using the same helper pattern already used for WorkbookUnderstandings and ChartSpecs.

- [ ] **Step 4: Run backend tests**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
node --test backend/src/saas/routes/saasRoutes.postgres.test.js
```

Expected: memory route tests pass; Postgres test runs only when `LABRAT_TEST_DATABASE_URL` is configured.

### Task 9: Persist DataPlan And Execute Snapshot Routes

**Files:**
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`

- [ ] **Step 1: Add failing route tests**

Add:

```js
test("POST /api/projects/:projectId/data-plans persists validated plan without ChartSpec", async () => {
  const fixture = await createProjectWithDataPlanDraft();
  const response = await requestJson(fixture.server, {
    method: "POST",
    path: `/api/projects/${fixture.projectId}/data-plans`,
    cookies: fixture.cookies,
    body: { dataPlan: fixture.dataPlanDraft },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.dataPlan.status, "validated");
  assert.equal(response.body.chartSpec, undefined);
});

test("POST /api/data-plans/:dataPlanId/snapshot executes deterministic preview", async () => {
  const fixture = await createProjectWithPersistedDataPlan();
  const response = await requestJson(fixture.server, {
    method: "POST",
    path: `/api/data-plans/${fixture.dataPlanId}/snapshot`,
    cookies: fixture.cookies,
    body: {},
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.dataSnapshot.schemaVersion, "labrat.dataSnapshot.v1");
  assert.equal(response.body.dataSnapshot.contentHash.startsWith("sha256_"), true);
});
```

- [ ] **Step 2: Implement routes**

Add:

```http
POST /api/projects/:projectId/data-plans
POST /api/data-plans/:dataPlanId/snapshot
```

Rules:

- `POST /data-plans` validates plan before persistence.
- `POST /snapshot` executes the existing plan from source refs.
- Neither route creates ChartSpec or Manuscript content.
- Both routes write audit events.

- [ ] **Step 3: Run tests**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: tests pass.

---

## Phase 4: DataSnapshot To Chart Proposal

### Task 10: Chart Proposal From DataSnapshot

**Files:**
- Modify: `backend/src/charts/services/chartProposal.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `src/charts/genericChartPreview.js`
- Modify: `src/charts/genericChartPreview.test.js`

- [ ] **Step 1: Add failing route test**

Add:

```js
test("POST /api/data-snapshots/:dataSnapshotId/chart-proposal creates proposal set without ChartSpec", async () => {
  const fixture = await createProjectWithDataSnapshot({
    outputShape: "xy_series",
    series: [{ experimentAlias: "Exp33", x: [0, 5], y: [0.1, 0.2] }],
  });

  const response = await requestJson(fixture.server, {
    method: "POST",
    path: `/api/data-snapshots/${fixture.dataSnapshotId}/chart-proposal`,
    cookies: fixture.cookies,
    body: {},
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.chartProposalSet.payload.proposals[0].origin, "data_snapshot");
  assert.equal(response.body.chartProposalSet.payload.proposals[0].chartSpecDraft.sourceSnapshot.dataSnapshotId, fixture.dataSnapshotId);
  assert.equal(response.body.chartSpec, undefined);
});
```

- [ ] **Step 2: Implement proposal compiler**

Proposal compiler maps:

```text
xy_series -> scatter
multi_xy_series -> scatter with seriesScope
component_distribution -> distribution_bar
```

ChartSpec draft must include:

```json
{
  "origin": "data_snapshot",
  "sourceSnapshot": {
    "dataSnapshotId": "data_snapshot_...",
    "contentHash": "sha256_...",
    "series": []
  },
  "sourceRefs": []
}
```

- [ ] **Step 3: Add preview support**

Update `genericChartPreview` so `sourceSnapshot.dataSnapshotId` plus embedded `sourceSnapshot.series` renders the same way as current source snapshot series.

- [ ] **Step 4: Run tests**

Run:

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
npm test -- src/charts/genericChartPreview.test.js
```

Expected: tests pass.

---

## Phase 5: Frontend Review Flow

### Task 11: DataPlan Review Card

**Files:**
- Modify: `src/data/chartIntentClient.js`
- Modify: `src/components/BackendScanPanel.jsx`
- Modify: `src/components/BackendScanPanel.test.jsx`
- Modify: `src/components/ProjectDashboard.test.jsx`

- [ ] **Step 1: Add failing UI tests**

Add tests asserting:

```text
Chart Review prompt returns data_plan_review
UI shows source evidence, column bindings, DataSnapshot preview
Accept DataPlan calls POST /api/projects/:projectId/data-plans
Execute snapshot calls POST /api/data-plans/:id/snapshot
Create chart proposal calls POST /api/data-snapshots/:id/chart-proposal
No ChartSpec is created before chart proposal review
```

- [ ] **Step 2: Implement UI state**

Add review state:

```js
{
  reviewKind: "data_plan_review",
  dataPlanDraft,
  dataSnapshotPreview,
  toolTrace,
  warnings,
}
```

Render:

```text
Data source:
  Reaction_Rate_Exp33.xlsx / Exp33!A1:P61
Bindings:
  X: Time column A
  Y: Rate column B
Preview:
  first N points
Actions:
  Accept DataPlan
  Create chart proposal after snapshot
```

- [ ] **Step 3: Run frontend tests**

Run:

```bash
npm test -- src/components/BackendScanPanel.test.jsx src/components/ProjectDashboard.test.jsx src/data/serverApi.test.js
```

Expected: tests pass.

---

## Phase 6: LLM Planner Adapter For Scheme 5

### Task 12: Tool-Governed DataPlan LLM Planner

**Files:**
- Create: `backend/src/saas/ai/dataPlanToolPlanner.js`
- Modify: `backend/src/saas/dataPlanAgent.js`
- Modify: `backend/src/saas/dataPlanAgent.test.js`

- [ ] **Step 1: Add mocked planner test**

Add:

```js
test("LLM DataPlan planner can choose tools but backend owns validation and execution", async () => {
  const modelClient = async () => ({
    toolCalls: [
      { name: "inspect_region_schema", arguments: { evidenceResultId: "evidence_result_fact_exp33_rate" } },
      { name: "rank_candidate_columns", arguments: { targetField: "reaction_time" } },
      { name: "rank_candidate_columns", arguments: { targetField: "reaction_rate" } },
      { name: "draft_data_plan", arguments: { outputShape: "xy_series", experimentAlias: "Exp33" } },
      { name: "validate_data_plan", arguments: {} },
      { name: "execute_data_snapshot_preview", arguments: {} }
    ]
  });

  const response = await runDataPlanAgent({
    query: "draw reaction rate vs time for experiment 33",
    retrievalResults: evidenceResults,
    readRangePreview: async () => preview,
    plannerProvider: "llm_tool_planner",
    modelClient,
  });

  assert.equal(response.planner.provider, "llm_tool_planner");
  assert.equal(response.resultKind, "data_plan_review");
  assert.equal(response.dataSnapshotPreview.series[0].x.length, 2);
});
```

- [ ] **Step 2: Implement strict planner adapter**

Allowed tools:

```js
const ALLOWED_DATA_PLAN_TOOLS = new Set([
  "inspect_region_schema",
  "infer_header_row",
  "rank_candidate_columns",
  "draft_data_plan",
  "validate_data_plan",
  "execute_data_snapshot_preview",
  "ask_data_plan_clarification",
]);
```

Reject any model call outside the whitelist. Always run `validate_data_plan` and `execute_data_snapshot_preview` server-side even if the model omits them.

- [ ] **Step 3: Run tests**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
```

Expected: tests pass.

---

## Phase 7: Cross-Compare Through DataPlan Agent

### Task 13: Multi-Series Extraction

**Files:**
- Modify: `backend/src/saas/dataPlanAgentTools.js`
- Modify: `backend/src/saas/dataPlanExecutor.js`
- Modify: `backend/src/saas/dataPlanAgent.test.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`

- [ ] **Step 1: Add failing cross-compare test**

Test input:

```text
retrievalResults:
  Exp33 accepted reaction_rate_time_series A1:C4
  Exp34 accepted reaction_rate_time_series A1:C4
query:
  cross-compare reaction rate vs time for experiments 33 and 34
```

Expected:

```js
assert.equal(response.dataPlanDraft.outputShape, "multi_xy_series");
assert.equal(response.dataSnapshotPreview.series.length, 2);
assert.deepEqual(response.dataSnapshotPreview.series.map((series) => series.experimentAlias), ["Exp33", "Exp34"]);
```

- [ ] **Step 2: Implement multi-series planner behavior**

Rules:

- Each accepted evidence result becomes one candidate series.
- Same semantic field bindings must be found per series.
- Missing x/y for selected experiments blocks the plan.
- `all_matching_experiments` may skip invalid series only if at least two valid series remain and warnings are returned.

- [ ] **Step 3: Run tests**

Run:

```bash
node --test backend/src/saas/dataPlanAgent.test.js
node --test backend/src/saas/routes/saasRoutes.test.js
```

Expected: tests pass.

---

## Phase 8: Golden Workbook Evaluation

### Task 14: Regression Fixtures And Golden Tests

**Files:**
- Create: `backend/src/saas/dataPlanGolden.test.js`
- Modify: `backend/src/import/fixtures/workflowScenarioFixtures.js`

- [ ] **Step 1: Add golden scenarios**

Create scenarios:

```js
export const dataPlanGoldenScenarios = [
  {
    name: "single experiment reaction rate",
    query: "draw reaction rate vs time for experiment 33",
    acceptedRegions: [
      { experimentAlias: "Exp33", semanticType: "reaction_rate_time_series", sheetName: "Exp33", range: "A1:C4" }
    ],
    expected: {
      outputShape: "xy_series",
      seriesCount: 1,
      x: [0, 5],
      y: [0.1, 0.2]
    }
  },
  {
    name: "cross compare reaction rate",
    query: "cross-compare reaction rate vs time for experiments 33 and 34",
    acceptedRegions: [
      { experimentAlias: "Exp33", semanticType: "reaction_rate_time_series", sheetName: "Exp33", range: "A1:C4" },
      { experimentAlias: "Exp34", semanticType: "reaction_rate_time_series", sheetName: "Exp34", range: "A1:C4" }
    ],
    expected: {
      outputShape: "multi_xy_series",
      seriesCount: 2
    }
  }
];
```

- [ ] **Step 2: Add test runner**

Each golden test should assert:

```text
expected source ranges
expected bindings
expected output shape
expected numeric preview values
no unconfirmed evidence used
toolTrace includes validate_data_plan
```

- [ ] **Step 3: Run golden tests**

Run:

```bash
node --test backend/src/saas/dataPlanGolden.test.js
```

Expected: tests pass.

---

## Verification Commands

Run after each phase:

```bash
node --test backend/src/saas/dataPlanSchemas.test.js
node --test backend/src/saas/dataPlanAgent.test.js
node --test backend/src/saas/routes/saasRoutes.test.js
npm test -- src/data/serverApi.test.js src/components/BackendScanPanel.test.jsx src/components/ProjectDashboard.test.jsx
```

Run before declaring the full transition complete:

```bash
npm --prefix backend test
npm test
npm run build
git diff --check
```

Optional when Postgres test DB is available:

```bash
node --test backend/src/saas/routes/saasRoutes.postgres.test.js
```

## Manual QA

1. Upload `Reaction_Rate_Exp33.xlsx`.
2. Confirm the reaction-rate red box as `reaction_rate_time_series`.
3. Ask LabRat or Chart Review:

```text
draw reaction rate vs time for experiment 33
```

Expected:

- Retrieval returns accepted evidence.
- DataPlan review shows workbook/sheet/range.
- Binding shows X = time column, Y = rate column.
- DataSnapshot preview shows real points.
- No ChartSpec exists yet.

4. Accept DataPlan and create DataSnapshot.
5. Create chart proposal from DataSnapshot.
6. Accept proposal and create ChartSpec.
7. Insert into Manuscript through existing approved chart flow.

Cross-compare QA:

1. Upload/confirm Exp33 and Exp34 reaction-rate red boxes.
2. Ask:

```text
cross-compare reaction rate vs time for experiments 33 and 34
```

Expected:

- DataPlan output shape is `multi_xy_series`.
- DataSnapshot has two series.
- Each series cites its own workbook/sheet/range.
- Colors remain stable in chart preview.

## Acceptance Criteria

- Tool-Governed Evidence Retrieval remains the only source of DataPlan evidence.
- DataPlan Agent tools are backend-owned and testable.
- LLM planner is optional and cannot bypass validator/executor.
- DataPlan draft can be reviewed before persistence.
- DataSnapshot preview is deterministic and source-cell-backed.
- Chart proposal creation comes after DataSnapshot review.
- Cross-compare uses one verified series per accepted experiment region.
- Existing ChartSpec/Manuscript paths do not bypass DataPlan review for new data-backed prompts.

## Out Of Scope

- Full spreadsheet formula dependency tracing.
- Arbitrary Python/R execution.
- DatasetCommit promotion.
- Long-term vector store.
- FigurePackage publishing.
- Manuscript placement dependency graph.
- Automatic chart insertion without user review.

## Migration Guidance

Do not delete existing ChartSpec or source-extract compatibility paths in this plan. After the DataPlan Agent path covers:

```text
single reaction-rate chart
reaction-rate cross-compare
source-range component distribution
nonexistent experiment rejection
visual-only ChartSpec edit separation
```

then create a separate cleanup plan to retire old chart proposal shortcuts.
