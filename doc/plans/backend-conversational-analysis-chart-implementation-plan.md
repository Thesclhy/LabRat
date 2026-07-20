# Backend Conversational Analysis And Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reviewed backend-owned LabRat conversation, calculation-review, validated result, analysis-result ChartSpec, and placement-local trace visibility workflow.

**Architecture:** Keep authenticated HTTP routing and workflow persistence explicit in the existing Node SaaS backend. A framework-independent analysis service layer resolves accepted snapshot data, validates immutable plan revisions, delegates accepted code to a versioned executor adapter, validates outputs, and publishes immutable analysis-result ChartSpecs. React renders plan and result review artifacts inside the existing LabRat rail while a dedicated review workspace reuses bounded SourceDocument ranges; Canvas stores only presentation-local trace visibility.

**Tech Stack:** Node 22 ES modules, built-in Node test runner, PostgreSQL JSONB plus in-memory store parity, React 19 JSX, Vitest/Testing Library, Plotly, existing SourceDocument and DataSnapshot services.

## Global Constraints

- Provider credentials and model calls are backend-only; the frontend must not store or send `ANTHROPIC_API_KEY`.
- The model may draft selection, calculation meaning, exact Python, and chart encoding, but accepted numeric arrays come only from backend-owned execution inputs and outputs.
- Plan acceptance authorizes calculation only; result acceptance is a separate explicit action.
- Only the exact accepted Python source, source hash, input hash, and runtime version may execute.
- Production execution must use a hardened isolated worker. The local development adapter must identify itself as non-production and reject network, subprocess, filesystem, and non-allowlisted imports before execution.
- Analysis artifacts are immutable revisions linked to accepted DataSnapshot heads and exact source refs.
- Existing `origin: "source_extract"` ChartSpecs and Manuscript blocks must remain valid.
- The complete accepted trace catalog belongs to ChartSpec; `visibleTraceIds` belongs to each Manuscript placement.
- Every persisted shape and route change updates the API, database, canonical-data, architecture, and AI-boundary docs in the same milestone.
- No LangChain or LangGraph dependency is introduced.
- The optional MCP adapter is not required for the first-party workflow and is excluded from the initial implementation completion gate.

---

### Task 1: Backend Conversation Provider And Intent Router

**Files:**
- Create: `backend/src/saas/analysisIntentRouter.js`
- Create: `backend/src/saas/analysisIntentRouter.test.js`
- Create: `backend/src/saas/backendModelProvider.js`
- Create: `backend/src/saas/backendModelProvider.test.js`
- Modify: `backend/src/ai/anthropic.js`
- Modify: `backend/src/saas/config.js`
- Modify: `backend/src/saas/config.test.js`
- Modify: `backend/src/saas/projectAgentPlanner.js`
- Modify: `backend/src/saas/projectAgentPlanner.test.js`
- Modify: `backend/src/saas/agentRuns.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `src/main.jsx`
- Modify: `src/components/ProjectDashboard.test.jsx`

**Interfaces:**
- Produces: `routeAnalysisIntent({ message, selectedContext, projectContext, modelProvider }) -> { intent, disposition, confidence, clarification, metadata }`.
- Produces: `createBackendModelProvider({ config, fetchImpl })` with `classifyIntent(input)`, `draftAnalysisPlan(input)`, and `answerReadOnly(input)`.
- Consumes: existing deterministic project summary and explicit upload/navigation action rules.

- [x] **Step 1: Write failing intent-router and provider tests**

```js
test("routes derived trend requests into reviewed analysis", async () => {
  const result = await routeAnalysisIntent({
    message: "Give me a one-paragraph overview of the trends across all experiments.",
    projectContext: { publishedExperimentCount: 60 },
    modelProvider: null,
  });
  assert.equal(result.intent, "experiment_overview");
  assert.equal(result.disposition, "analysis_thread");
});

test("keeps explicit navigation deterministic", async () => {
  const result = await routeAnalysisIntent({
    message: "Open Experiment Browser",
    projectContext: { publishedExperimentCount: 60 },
    modelProvider: null,
  });
  assert.equal(result.disposition, "action");
  assert.equal(result.actionType, "open_experiment_browser");
});
```

- [x] **Step 2: Run tests and confirm the missing-module failure**

Run: `node --test backend/src/saas/analysisIntentRouter.test.js backend/src/saas/backendModelProvider.test.js`

Expected: FAIL because the new modules do not exist.

- [x] **Step 3: Implement bounded routing and provider structured-output validation**

```js
export const ANALYSIS_INTENTS = new Set([
  "project_purpose",
  "project_overview",
  "experiment_overview",
  "experiment_compare",
  "experiment_lookup",
  "open_or_filter_browser",
  "upload_workbook",
  "create_analysis_chart",
  "manuscript_action",
  "clarification",
]);

export async function routeAnalysisIntent(input = {}) {
  const deterministic = deterministicIntent(input);
  if (deterministic) return deterministic;
  const classified = await input.modelProvider?.classifyIntent?.(boundedIntentInput(input));
  return validateOrFallbackIntent(classified, input);
}
```

The deterministic router must classify explicit upload, Browser navigation, Manuscript commands, project purpose, explicit experiment lookup, chart requests, derived calculations, and ambiguity. Provider output outside the enum becomes `clarification`, never `open_experiment_browser`.

- [x] **Step 4: Route AgentRun creation through the new router**

Update `buildAgentRunDraft` so:

```js
if (route.disposition === "direct_answer") {
  return directAnswerAgentRun({ route, reply });
}
if (route.disposition === "analysis_thread") {
  return analysisThreadAgentRunDraft({ route });
}
return existingConfirmedActionDraft({ route });
```

Persist provider, model, latency, usage, and fallback metadata in `AgentRun.usage`; do not persist reasoning text.

- [x] **Step 5: Remove browser Anthropic credentials and direct provider calls**

Delete `apiKey`, `model`, stream parsing, `anthropic-dangerous-direct-browser-access`, API settings fields, and the direct `fetch("https://api.anthropic.com/v1/messages")` branch from `AgentPanel`. Keep writing examples, project background, and house rules as project-scoped context sent to the backend.

- [x] **Step 6: Run targeted backend and frontend tests**

Run:

```bash
node --test backend/src/saas/analysisIntentRouter.test.js backend/src/saas/backendModelProvider.test.js backend/src/saas/projectAgentPlanner.test.js backend/src/saas/routes/saasRoutes.test.js
npm test -- src/components/ProjectDashboard.test.jsx
```

Expected: direct questions have no Browser action; chart/derived requests return an analysis-thread disposition; no frontend Anthropic-key prompt remains.

- [x] **Step 7: Commit**

```bash
git add backend/src/ai/anthropic.js backend/src/saas/analysisIntentRouter.js backend/src/saas/analysisIntentRouter.test.js backend/src/saas/backendModelProvider.js backend/src/saas/backendModelProvider.test.js backend/src/saas/config.js backend/src/saas/config.test.js backend/src/saas/projectAgentPlanner.js backend/src/saas/projectAgentPlanner.test.js backend/src/saas/agentRuns.js backend/src/saas/routes/saasRoutes.js backend/src/saas/routes/saasRoutes.test.js src/main.jsx src/components/ProjectDashboard.test.jsx
git commit -m "Add backend LabRat intent routing"
```

### Task 2: Analysis Schemas, Tool Registry, And Accepted Selection

**Files:**
- Create: `backend/src/saas/analysisSchemas.js`
- Create: `backend/src/saas/analysisSchemas.test.js`
- Create: `backend/src/saas/analysisSelection.js`
- Create: `backend/src/saas/analysisSelection.test.js`
- Create: `backend/src/saas/analysisToolRegistry.js`
- Create: `backend/src/saas/analysisToolRegistry.test.js`
- Modify: `backend/src/saas/experimentProjection.js`
- Modify: `backend/src/saas/sourceDocuments.js`

**Interfaces:**
- Produces: `validateAnalysisPlanRevision(plan)`.
- Produces: `resolveAnalysisSelection({ projectId, selectionRequest, dataSnapshots, experimentIdentities, experimentSnapshotHeads })`.
- Produces: `compressSourceRefsToRectangles(sourceRefs)`.
- Produces: `createAnalysisToolRegistry(context)` exposing the five reviewed planning tools.
- Consumes: accepted active snapshot heads and SourceDocument range metadata.

- [x] **Step 1: Write failing schema and selection tests**

```js
test("selection resolves only accepted active heads", () => {
  const selection = resolveAnalysisSelection(fixtureWithHistoricalAndActiveHeads());
  assert.deepEqual(selection.experimentIds, ["experiment_active"]);
  assert.equal(selection.records[0].snapshotId, "snapshot_active");
});

test("non-contiguous source cells remain separate rectangles", () => {
  assert.deepEqual(compressSourceRefsToRectangles([
    excelCell("A2"),
    excelCell("A3"),
    excelCell("C2"),
  ]).map((item) => item.range), ["A2:A3", "C2"]);
});
```

- [x] **Step 2: Run tests and confirm missing exports**

Run: `node --test backend/src/saas/analysisSchemas.test.js backend/src/saas/analysisSelection.test.js backend/src/saas/analysisToolRegistry.test.js`

Expected: FAIL because the analysis services do not exist.

- [x] **Step 3: Implement immutable schema normalization and hashing**

```js
export function frozenPlanHash(plan) {
  return stableDataHash({
    selection: plan.selection,
    processingSummary: plan.processingSummary,
    calculationManifest: plan.calculationManifest,
    pythonProgram: plan.pythonProgram,
    expectedOutput: plan.expectedOutput,
  });
}
```

Validation must reject embedded authoritative result arrays, missing source refs, unsupported runtime names, missing Python source hashes, unknown fields, mismatched units, duplicate trace/output ids, and missing explicit missing-value behavior.

- [x] **Step 4: Implement accepted-head selection and field catalog**

Create a reusable active-record resolver extracted from `experimentProjection.js`. Return:

```js
{
  selectionId,
  projectId,
  experimentIds,
  fieldCatalog,
  records,
  sourceRectangles,
  dependencyHash,
  selectionHash,
  coverage,
  warnings,
}
```

Each selected scalar value retains `experimentId`, `snapshotId`, `recordIndex`, field definition, value, unit, and source refs. Series points retain stable series and point indexes.

- [x] **Step 5: Implement authorization-neutral tool registry**

```js
const registry = createAnalysisToolRegistry({
  getProjectAnalysisContext,
  listAnalysisFields,
  resolveExperimentScope,
  previewAnalysisSelection,
  inspectAnalysisSelection,
  validateAnalysisPlan,
});
await registry.call("preview_analysis_selection", args, authContext);
```

The registry validates each tool input, requires project ownership through injected service functions, returns bounded results, and exposes no execution tool.

- [x] **Step 6: Run targeted tests**

Run:

```bash
node --test backend/src/saas/analysisSchemas.test.js backend/src/saas/analysisSelection.test.js backend/src/saas/analysisToolRegistry.test.js backend/src/saas/experimentProjection.test.js
```

Expected: all accepted-head, unit, coverage, bounded-page, and source-rectangle cases pass.

- [x] **Step 7: Commit**

```bash
git add backend/src/saas/analysisSchemas.js backend/src/saas/analysisSchemas.test.js backend/src/saas/analysisSelection.js backend/src/saas/analysisSelection.test.js backend/src/saas/analysisToolRegistry.js backend/src/saas/analysisToolRegistry.test.js backend/src/saas/experimentProjection.js backend/src/saas/sourceDocuments.js
git commit -m "Add accepted-data analysis tools"
```

### Task 3: Analysis Persistence And Plan Revision API

**Files:**
- Create: `backend/migrations/012_analysis_workflow.sql`
- Modify: `backend/src/saas/memoryStore.js`
- Modify: `backend/src/saas/postgresStore.js`
- Create: `backend/src/saas/analysisThreads.js`
- Create: `backend/src/saas/analysisThreads.test.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `backend/src/saas/routes/saasRoutes.postgres.test.js`

**Interfaces:**
- Produces store methods for create/find/list/update AnalysisThread, create/find/list AnalysisPlanRevision, create/find AnalysisRun, create/find AnalysisResult, and atomic analysis publication.
- Produces the reviewed analysis-thread and plan-revision HTTP operations.
- Consumes Task 2 selection, schemas, and tool registry.

- [x] **Step 1: Write failing memory-store and route tests**

```js
test("plan feedback creates an immutable later revision", async () => {
  const first = await service.createRevision({ threadId, feedback: null });
  const second = await service.createRevision({ threadId, feedback: "Treat missing liquid as zero." });
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal((await store.findAnalysisPlanRevisionById(first.id)).status, "superseded");
});
```

Route coverage must include editor authorization, cross-project rejection, bounded lists, revision immutability, and stale dependency detection.

- [x] **Step 2: Run tests and confirm persistence methods are absent**

Run: `node --test backend/src/saas/analysisThreads.test.js backend/src/saas/routes/saasRoutes.test.js`

Expected: FAIL on missing store/service methods.

- [x] **Step 3: Add migration 012**

Create `analysis_threads`, `analysis_plan_revisions`, `analysis_runs`, `analysis_results`, and `analysis_publications`. Use text ids, lab/project foreign keys, JSONB payload columns, explicit status/revision/hash columns, timestamps, actor columns, unique `(analysis_thread_id, revision)`, and unique `(project_id, idempotency_key)` publication receipts.

- [x] **Step 4: Implement memory/Postgres parity**

All reads return copies. Revision and result payloads are append-only. Only workflow status fields may transition. The memory-store atomic publisher must clone maps before committing, matching the existing experiment snapshot publish pattern.

- [x] **Step 5: Implement thread and revision routes**

Implement:

```text
POST /api/projects/:projectId/analysis-threads
GET  /api/projects/:projectId/analysis-threads
GET  /api/analysis-threads/:analysisThreadId
POST /api/analysis-threads/:analysisThreadId/plan-revisions
GET  /api/analysis-plan-revisions/:planRevisionId/selection
POST /api/analysis-plan-revisions/:planRevisionId/accept
```

Plan acceptance requires `Idempotency-Key`, `planHash`, `selectionHash`, and `dependencyHash`; it atomically freezes the revision and creates a queued AnalysisRun but does not execute or create a ChartSpec.

- [x] **Step 6: Run backend route and optional Postgres tests**

Run:

```bash
node --test backend/src/saas/analysisThreads.test.js backend/src/saas/routes/saasRoutes.test.js
node --test backend/src/saas/routes/saasRoutes.postgres.test.js
```

Expected: memory tests pass; Postgres test passes when `LABRAT_TEST_DATABASE_URL` is configured and otherwise reports the repository's standard optional skip.

- [x] **Step 7: Commit**

```bash
git add backend/migrations/012_analysis_workflow.sql backend/src/saas/memoryStore.js backend/src/saas/postgresStore.js backend/src/saas/analysisThreads.js backend/src/saas/analysisThreads.test.js backend/src/saas/routes/saasRoutes.js backend/src/saas/routes/saasRoutes.test.js backend/src/saas/routes/saasRoutes.postgres.test.js
git commit -m "Persist reviewed analysis plans"
```

### Task 4: LabRat Plan Review Workspace

**Files:**
- Create: `src/data/analysisApi.js`
- Create: `src/data/analysisApi.test.js`
- Create: `src/components/AnalysisReviewWorkspace.jsx`
- Create: `src/components/AnalysisReviewWorkspace.test.jsx`
- Create: `src/components/AnalysisConversationCard.jsx`
- Create: `src/components/AnalysisConversationCard.test.jsx`
- Modify: `src/main.jsx`
- Modify: `src/styles.css`
- Modify: `src/components/ProjectDashboard.test.jsx`

**Interfaces:**
- Produces authenticated analysis API helpers matching Task 3 routes.
- Produces `AnalysisReviewWorkspace` with Source/Result/Chart tabs and a normal LabRat conversation rail.
- Consumes SourceDocument range API and plan revision source rectangles.

- [x] **Step 1: Write failing API and component tests**

```jsx
it("accepts only the visible plan revision", async () => {
  render(<AnalysisReviewWorkspace thread={threadFixture} revision={revision2} />);
  await user.click(screen.getByRole("button", { name: "Accept plan" }));
  expect(acceptPlan).toHaveBeenCalledWith(revision2.id, expect.objectContaining({
    planHash: revision2.planHash,
  }));
});

it("sends modification feedback without accepting", async () => {
  await user.type(screen.getByPlaceholderText("Describe a modification"), "Treat missing Liquid as zero.");
  await user.click(screen.getByRole("button", { name: "Send modification" }));
  expect(createRevision).toHaveBeenCalled();
  expect(acceptPlan).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run tests and confirm components are missing**

Run: `npm test -- src/data/analysisApi.test.js src/components/AnalysisReviewWorkspace.test.jsx src/components/AnalysisConversationCard.test.jsx`

Expected: FAIL because the new modules do not exist.

- [x] **Step 3: Implement analysis API helpers**

Use the existing `serverApi` request/error conventions. Mutations pass idempotency through headers and keep result/source pagination bounded.

- [x] **Step 4: Implement the persistent split review**

The left pane mounts the existing Excel-like workbook grid behavior with a source selector and labeled, non-contiguous red overlays. The right pane renders the request, processing summary, coverage, warnings, revision history, and expandable exact Python. The composer uses:

```jsx
<div className="analysis-review-composer">
  <button className="accept-plan">Accept plan</button>
  <textarea placeholder="Describe a modification" />
  <button aria-label="Send modification"><Send /></button>
</div>
```

Use the repository's icon library only if already present; otherwise use an accessible text send control without introducing a dependency.

- [x] **Step 5: Wire AgentPanel analysis-thread responses**

When AgentRun returns `analysisThread` and `currentPlanRevision`, render `AnalysisConversationCard` and open the review workspace. Preserve ordinary direct answers as normal messages. Remove any fallback that converts analysis requests into Browser actions.

- [x] **Step 6: Run frontend tests and build**

Run:

```bash
npm test -- src/data/analysisApi.test.js src/components/AnalysisReviewWorkspace.test.jsx src/components/AnalysisConversationCard.test.jsx src/components/ProjectDashboard.test.jsx
npm run build
```

Expected: plan review is usable at desktop and narrow widths; no calculation request occurs before plan acceptance.

- [x] **Step 7: Commit**

```bash
git add src/data/analysisApi.js src/data/analysisApi.test.js src/components/AnalysisReviewWorkspace.jsx src/components/AnalysisReviewWorkspace.test.jsx src/components/AnalysisConversationCard.jsx src/components/AnalysisConversationCard.test.jsx src/main.jsx src/styles.css src/components/ProjectDashboard.test.jsx
git commit -m "Add conversational analysis plan review"
```

### Task 5: Versioned Executor Adapter And Result Validation

**Files:**
- Create: `backend/src/saas/pythonPolicy.js`
- Create: `backend/src/saas/pythonPolicy.test.js`
- Create: `backend/src/saas/analysisExecutor.js`
- Create: `backend/src/saas/analysisExecutor.test.js`
- Create: `backend/src/saas/analysisResultValidation.js`
- Create: `backend/src/saas/analysisResultValidation.test.js`
- Create: `backend/scripts/labrat_python_runner.py`
- Modify: `backend/src/saas/analysisThreads.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`

**Interfaces:**
- Produces: `validatePythonPolicy(source, runtimeVersion)`.
- Produces: `createAnalysisExecutor({ mode, pythonCommand, workerEndpoint })` with `executeAcceptedRun(runPackage)`.
- Produces: `validateAnalysisResult({ run, plan, selection, executorResult })`.
- Consumes an accepted plan revision and frozen execution package only.

- [x] **Step 1: Write failing policy, executor, and validator tests**

```js
test("rejects network and subprocess imports before execution", () => {
  const result = validatePythonPolicy("import requests\nimport subprocess");
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((item) => item.code), [
    "python_import_not_allowed",
    "python_import_not_allowed",
  ]);
});

test("blocks a normalized result that violates row-sum invariants", () => {
  const result = validateAnalysisResult(normalizationFixture({ rowSum: 99.5 }));
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "analysis_invariant_failed");
});
```

- [x] **Step 2: Run tests and confirm missing modules**

Run: `node --test backend/src/saas/pythonPolicy.test.js backend/src/saas/analysisExecutor.test.js backend/src/saas/analysisResultValidation.test.js`

Expected: FAIL because the executor modules do not exist.

- [x] **Step 3: Implement static Python policy and canonical run package**

Reject imports outside the standard numeric allowlist plus pandas/numpy/scipy, calls to `open`, `exec`, `eval`, `compile`, `__import__`, subprocess/process APIs, sockets, HTTP clients, and filesystem traversal. Require exactly one `analyze(tables, labrat)` function.

- [x] **Step 4: Implement development and production executor adapters**

`LABRAT_ANALYSIS_EXECUTOR=disabled` is the production default unless a hardened worker endpoint is configured. `local` is allowed only outside production and invokes the runner with a sanitized environment, temporary directory, timeout, bounded input/output, and recorded `adapter: "local_non_production"`. The runner applies process resource limits where supported and returns JSON only.

- [x] **Step 5: Implement result validation and run routes**

Implement:

```text
POST /api/analysis-runs/:analysisRunId/execute
GET  /api/analysis-runs/:analysisRunId
GET  /api/analysis-runs/:analysisRunId/result-preview
POST /api/analysis-runs/:analysisRunId/revise
```

Execution rechecks accepted state, active dependencies, source/program/input hashes, policy, and idempotency. Validation checks finite values, ids, x/y lengths, lineage, units, missing/exclusion counts, output bounds, and manifest invariants before persisting an immutable awaiting-review AnalysisResult.

- [x] **Step 6: Run executor and route tests**

Run:

```bash
node --test backend/src/saas/pythonPolicy.test.js backend/src/saas/analysisExecutor.test.js backend/src/saas/analysisResultValidation.test.js backend/src/saas/analysisThreads.test.js backend/src/saas/routes/saasRoutes.test.js
```

Expected: policy violations fail before process start; exact accepted source/hash is recorded; valid fixtures reach `awaiting_result_review`; invalid fixtures cannot publish.

- [x] **Step 7: Commit**

```bash
git add backend/src/saas/pythonPolicy.js backend/src/saas/pythonPolicy.test.js backend/src/saas/analysisExecutor.js backend/src/saas/analysisExecutor.test.js backend/src/saas/analysisResultValidation.js backend/src/saas/analysisResultValidation.test.js backend/scripts/labrat_python_runner.py backend/src/saas/analysisThreads.js backend/src/saas/routes/saasRoutes.js backend/src/saas/routes/saasRoutes.test.js
git commit -m "Execute accepted analysis plans"
```

### Task 6: Result Review And Revision Loop

**Files:**
- Modify: `src/data/analysisApi.js`
- Modify: `src/data/analysisApi.test.js`
- Modify: `src/components/AnalysisReviewWorkspace.jsx`
- Modify: `src/components/AnalysisReviewWorkspace.test.jsx`
- Modify: `src/components/AnalysisConversationCard.jsx`
- Modify: `src/components/AnalysisConversationCard.test.jsx`
- Modify: `src/styles.css`
- Modify: `src/main.jsx`

**Interfaces:**
- Produces result review tabs and `Accept result and create chart`.
- Consumes Task 5 result previews and revision endpoint.

- [x] **Step 1: Write failing result-review tests**

```jsx
it("shows validation and exclusions before result acceptance", () => {
  render(<AnalysisReviewWorkspace run={validatedRunFixture} result={resultFixture} />);
  expect(screen.getByText("3 records excluded")).toBeTruthy();
  expect(screen.getByText("Row sum = 100 ± 0.000001")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Accept result and create chart" })).toBeTruthy();
});
```

Add a test that result feedback calls `reviseAnalysisRun` and returns to plan review without changing the existing result.

- [x] **Step 2: Run tests and confirm result controls are absent**

Run: `npm test -- src/components/AnalysisReviewWorkspace.test.jsx src/components/AnalysisConversationCard.test.jsx`

Expected: FAIL on missing Result/Chart tabs and combined acceptance action.

- [x] **Step 3: Implement Source, Result, And Chart tabs**

Result rows are paginated. Chart preview renders the complete validated trace domain and allows choosing `defaultVisibleTraceIds` for publication. Show input/output counts, exclusions, missing policy, invariant status, hashes, warnings, and source links.

- [x] **Step 4: Implement immutable revision loop**

Modification feedback from result review posts the run id, result hash, and user feedback. Replace the active workspace pointer with the returned later plan revision while preserving prior revision/run history in the conversation.

- [x] **Step 5: Run frontend tests and build**

Run:

```bash
npm test -- src/data/analysisApi.test.js src/components/AnalysisReviewWorkspace.test.jsx src/components/AnalysisConversationCard.test.jsx src/components/ProjectDashboard.test.jsx
npm run build
```

Expected: accepted plans progress to result review; result feedback returns to planning; result acceptance remains disabled on validation failure.

- [x] **Step 6: Commit**

```bash
git add src/data/analysisApi.js src/data/analysisApi.test.js src/components/AnalysisReviewWorkspace.jsx src/components/AnalysisReviewWorkspace.test.jsx src/components/AnalysisConversationCard.jsx src/components/AnalysisConversationCard.test.jsx src/styles.css src/main.jsx
git commit -m "Add validated analysis result review"
```

### Task 7: Atomic AnalysisResult ChartSpec Publication

**Files:**
- Create: `backend/src/saas/analysisChartPublisher.js`
- Create: `backend/src/saas/analysisChartPublisher.test.js`
- Modify: `backend/src/saas/chartSpecValidation.js`
- Modify: `backend/src/saas/chartSpecValidation.test.js`
- Modify: `backend/src/saas/memoryStore.js`
- Modify: `backend/src/saas/postgresStore.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `src/charts/sourceChartPreview.js`
- Modify: `src/charts/sourceChartPreview.test.js`
- Modify: `src/main.jsx`

**Interfaces:**
- Produces: `publishAcceptedAnalysisChart({ runId, resultHash, defaultVisibleTraceIds, idempotencyKey })`.
- Extends ChartSpec validation/rendering with `origin: "analysis_result"`.
- Consumes validated immutable AnalysisResult.

- [x] **Step 1: Write failing publication and rendering tests**

```js
test("publishes accepted result and complete trace catalog atomically", async () => {
  const response = await publishAcceptedAnalysisChart(fixture);
  assert.equal(response.analysisResult.status, "accepted");
  assert.equal(response.chartSpec.spec.traceCatalog.length, 60);
  assert.deepEqual(response.chartSpec.spec.defaultChartView.visibleTraceIds, ["trace_exp_1"]);
});

it("renders analysis-result traces without sourceSnapshot", () => {
  const preview = makeSourceChartPreview(analysisResultChartSpecFixture);
  expect(preview.traces).toHaveLength(2);
});
```

- [x] **Step 2: Run tests and confirm source-only validation rejects the fixture**

Run:

```bash
node --test backend/src/saas/analysisChartPublisher.test.js backend/src/saas/chartSpecValidation.test.js
npm test -- src/charts/sourceChartPreview.test.js
```

Expected: FAIL because ChartSpec validation/rendering accepts only source snapshots.

- [x] **Step 3: Implement analysis-result ChartSpec v2 validation**

Require result/thread/plan/run ids and hashes, accepted input snapshot refs, unique complete trace catalog, immutable finite trace arrays, source-record lineage, compatible x/y lengths, and a default visible subset contained in the catalog.

- [x] **Step 4: Implement atomic idempotent publication**

Recheck result-review hash and active dependencies, mark result accepted, create ChartSpec, link all artifacts, and record audit/receipt in one store transaction. Idempotent replay returns the original artifact ids; conflicting request hashes return 409.

- [x] **Step 5: Render both ChartSpec origins**

Branch internally by origin:

```js
if (spec.origin === "analysis_result") return analysisResultTraces(spec, chartView, style);
return sourceSnapshotTraces(spec, chartView, style);
```

List responses stay bounded; project state may include immutable trace metadata but large arrays load from ChartSpec detail before Manuscript insertion.

- [x] **Step 6: Run targeted backend/frontend tests**

Run:

```bash
node --test backend/src/saas/analysisChartPublisher.test.js backend/src/saas/chartSpecValidation.test.js backend/src/saas/routes/saasRoutes.test.js
npm test -- src/charts/sourceChartPreview.test.js src/components/ProjectDashboard.test.jsx
```

Expected: source-backed regressions remain green; analysis-result publication is atomic and renderable.

- [x] **Step 7: Commit**

```bash
git add backend/src/saas/analysisChartPublisher.js backend/src/saas/analysisChartPublisher.test.js backend/src/saas/chartSpecValidation.js backend/src/saas/chartSpecValidation.test.js backend/src/saas/memoryStore.js backend/src/saas/postgresStore.js backend/src/saas/routes/saasRoutes.js backend/src/saas/routes/saasRoutes.test.js src/charts/sourceChartPreview.js src/charts/sourceChartPreview.test.js src/main.jsx
git commit -m "Publish analysis result chart specs"
```

### Task 8: Placement-Local Trace Visibility And Export

**Files:**
- Create: `src/charts/chartView.js`
- Create: `src/charts/chartView.test.js`
- Modify: `src/components/ManuscriptCanvas.jsx`
- Modify: `src/components/ManuscriptCanvas.history.test.jsx`
- Modify: `src/charts/sourceChartPreview.js`
- Modify: `src/charts/sourceChartPreview.test.js`
- Modify: `src/export/pptxExport.js`
- Create: `src/export/pptxExport.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `normalizeChartView(chartSpec, persistedView) -> { visibleTraceIds }`.
- Produces: `traceOptionsForChartSpec(chartSpec)`.
- Consumes complete ChartSpec trace catalog and default view.

- [x] **Step 1: Write failing normalization, Canvas, and export tests**

```js
it("normalizes legacy experiment selection into trace ids", () => {
  expect(normalizeChartView(seriesSpec, {
    selectedExperimentIds: ["exp_2"],
  })).toEqual({ visibleTraceIds: ["exp_2:rate"] });
});

it("keeps duplicate placements independent", async () => {
  renderCanvasWithTwoPlacementsOfOneSpec();
  await user.click(screen.getByLabelText("Hide Exp-002 in selected chart"));
  expect(firstPlacementTraceNames()).toEqual(["Exp-001"]);
  expect(secondPlacementTraceNames()).toEqual(["Exp-001", "Exp-002"]);
});
```

- [x] **Step 2: Run tests and confirm trace-aware APIs are absent**

Run:

```bash
npm test -- src/charts/chartView.test.js src/components/ManuscriptCanvas.history.test.jsx src/export/pptxExport.test.js
```

Expected: FAIL because `visibleTraceIds` normalization and export filtering are missing.

- [x] **Step 3: Implement bounded compatibility normalization**

For analysis-result specs, use `defaultChartView.visibleTraceIds` when no persisted view exists. For source specs, map existing selected/excluded experiment ids to stable trace ids. Preserve unknown legacy keys only during normalization; persisted updates write `visibleTraceIds`.

- [x] **Step 4: Replace experiment-only Canvas controls with trace controls**

Insertion inherits the default view. Inspector shows searchable trace checkboxes, visible/total count, Select all, and Clear. Checkbox changes patch only the selected block and participate in existing history transactions.

- [x] **Step 5: Apply visibility to context, reload, and PPTX**

Chart context includes complete trace catalog plus current visible ids without full arrays. Plot and PPTX export both pass the placement-local normalized chart view. Hidden traces remain in `chartSpecSnapshot`.

- [x] **Step 6: Run Canvas/chart/export tests and build**

Run:

```bash
npm test -- src/charts/chartView.test.js src/charts/sourceChartPreview.test.js src/components/ManuscriptCanvas.history.test.jsx src/export/pptxExport.test.js
npm run build
```

Expected: duplicate placements remain independent through undo/redo and save/reload; export includes only visible traces.

- [x] **Step 7: Commit**

```bash
git add src/charts/chartView.js src/charts/chartView.test.js src/components/ManuscriptCanvas.jsx src/components/ManuscriptCanvas.history.test.jsx src/charts/sourceChartPreview.js src/charts/sourceChartPreview.test.js src/export/pptxExport.js src/export/pptxExport.test.js src/styles.css
git commit -m "Add placement-local chart trace visibility"
```

### Task 9: Contracts, Full Verification, And Golden Workflow

**Files:**
- Modify: `doc/contracts/saas-api-contract-v0.md`
- Modify: `doc/contracts/saas-database-schema-v0.md`
- Modify: `doc/contracts/backend-api-contract.md`
- Modify: `doc/contracts/canonical-data-dictionary.md`
- Modify: `doc/arch/architecture.md`
- Modify: `doc/arch/ai-boundaries.md`
- Modify: `doc/current-milestone.md`
- Modify: `doc/plan.md`
- Modify: `doc/PROGRESS.md`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `src/components/ProjectDashboard.test.jsx`

**Interfaces:**
- Produces a documented, tested first-party end-to-end workflow.
- Consumes all prior tasks.

- [x] **Step 1: Add the failing golden backend workflow**

The test must publish accepted experiment snapshots, post a natural-language normalization/chart request, modify the plan, accept it, execute the exact program through the injected test executor, inspect validated output, atomically accept/create a chart, reload state, and assert complete trace catalog plus source lineage.

- [x] **Step 2: Run the golden test and fix only integration gaps**

Run: `node --test --test-name-pattern="golden conversational analysis" backend/src/saas/routes/saasRoutes.test.js`

Expected before integration fixes: FAIL at the first disconnected boundary. Expected after fixes: PASS through ChartSpec creation.

- [x] **Step 3: Add the frontend workflow test**

Drive LabRat request -> plan card -> modification -> plan accept -> result tabs -> combined result acceptance -> Manuscript insertion -> trace visibility. Assert there is no API-key UI and no Browser action for the analysis request.

- [x] **Step 4: Update active contracts and remove obsolete unsupported statements**

Document exact routes, persisted shapes, status transitions, idempotency, executor configuration, provider metadata, ChartSpec v2 origins, list/detail bounds, and Canvas `visibleTraceIds`. Retain the source-backed chart contract as a separate valid origin.

- [x] **Step 5: Run full verification**

Run:

```bash
npm run codex:preflight
npm test
npm --prefix backend test
npm run build
git diff --check
rg -n "anthropic-dangerous-direct-browser-access|labrat_blank_anthropic_key_v1|Only source-backed chart proposals" src backend/src
```

Expected: frontend and backend suites pass; build succeeds; diff check is clean apart from existing line-ending warnings; forbidden browser provider paths return no matches.

- [x] **Step 6: Run browser QA**

Verify:

1. Project purpose returns a direct answer.
2. Trend/chart requests open reviewed analysis instead of Browser.
3. Plan red boxes match exact workbook cells.
4. Modification creates revision 2 without execution.
5. Plan acceptance executes only the frozen revision.
6. Result review shows exclusions, invariants, hashes, and complete trace domain.
7. Combined acceptance creates one ChartSpec.
8. Two Canvas placements of that ChartSpec keep independent visible experiments after reload.
9. PPTX export matches each placement's visible traces.

- [x] **Step 7: Update milestone/progress and commit**

```bash
git add doc/contracts/saas-api-contract-v0.md doc/contracts/saas-database-schema-v0.md doc/contracts/backend-api-contract.md doc/contracts/canonical-data-dictionary.md doc/arch/architecture.md doc/arch/ai-boundaries.md doc/current-milestone.md doc/plan.md doc/PROGRESS.md backend/src/saas/routes/saasRoutes.test.js src/components/ProjectDashboard.test.jsx
git commit -m "Complete reviewed analysis chart workflow"
```

## Completion Gate

The first-party workflow is complete only when Tasks 1-9 pass. The optional MCP adapter may be planned after the backend tool registry and confirmation semantics have production evidence; it must not change analysis authorization, state, execution, or publication behavior.
