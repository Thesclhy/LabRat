# Region-Level Workbook Understanding Implementation Plan

Status: Tasks 1-7 implemented 2026-07-20; Task 8 final verification and browser QA in progress.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace aggregate workbook understanding review with independently interpreted, revised, confirmed, ignored, and logically deleted workbook regions while preserving Snapshot-backed Browser publication.

**Architecture:** `WorkbookReviewSession` remains the SourceDocument-scoped container. New `WorkbookReviewRegion` rows own stable source ranges and point to immutable `RegionUnderstandingRevision` rows; only active accepted revision pointers are usable by evidence retrieval and DataPlan drafting. Workbook-region model calls remain backend-only and receive bounded cells, neighboring context, and workbook metadata rather than the complete workbook.

**Tech Stack:** Node.js ES modules, Node test runner, PostgreSQL JSONB migrations/store, React 19 JSX, Vitest/Testing Library, Vite 6, existing `xlsx` SourceDocument index.

## Global Constraints

- Do not send the complete workbook cell grid to a model.
- Do not persist hidden reasoning or model-authored source hashes.
- Every accepted semantic claim must retain exact SourceDocument/sheet/range refs.
- Region confirmation must not publish Browser rows, execute Python, create charts, or mutate manuscripts.
- Experiment Browser remains derived only from accepted DataSnapshots selected by experiment snapshot heads.
- Use one contract cutover; do not add legacy WorkbookUnderstanding dual-read or dual-write behavior.
- Keep each source range read at or below `SOURCE_RANGE_MAX_CELLS`.
- Do not add dependencies.

---

### Task 1: Region Persistence Contract

**Files:**
- Create: `backend/migrations/013_region_understandings.sql`
- Modify: `backend/src/saas/memoryStore.js`
- Modify: `backend/src/saas/postgresStore.js`
- Test: `backend/src/saas/routes/saasRoutes.postgres.test.js`
- Test: `backend/src/saas/workbookReviewRegions.test.js`

**Interfaces:**
- Produces: `create/list/find/updateWorkbookReviewRegion` and `create/list/findRegionUnderstandingRevision` store methods.
- Produces: region records with `disposition`, `reviewStatus`, `currentRevisionId`, `acceptedRevisionId`, and monotonic `version`.
- Produces: immutable revision records with `revisionNumber`, `summary`, `interpretation`, `sourceRefs`, hashes, validation, provider metadata, and visible feedback.

- [x] **Step 1: Write failing memory-store tests**

```js
const region = await store.createWorkbookReviewRegion({
  projectId: project.id,
  workbookReviewSessionId: session.id,
  sourceDocumentId: sourceDocument.id,
  sheetName: "Runs",
  rangeRef: "A1:D3",
  disposition: "active",
  reviewStatus: "interpreting",
});
const revision = await store.createRegionUnderstandingRevision({
  regionId: region.id,
  revisionNumber: 1,
  summary: ["Rows describe experiments."],
  interpretation: { experimentAxis: "rows" },
});
assert.equal((await store.findWorkbookReviewRegionById(region.id)).version, 1);
assert.equal((await store.listRegionUnderstandingRevisions({ regionId: region.id }))[0].id, revision.id);
```

- [x] **Step 2: Run the focused test and verify missing methods fail**

Run: `node --test backend/src/saas/workbookReviewRegions.test.js`

Expected: FAIL because region store methods do not exist.

- [x] **Step 3: Add migration 013**

Create two project-owned tables with foreign keys to session/source evidence, JSONB interpretation/source metadata, unique `(region_id, revision_number)`, project/session indexes, and accepted/current revision pointers added after both tables exist. Keep the aggregate table and session draft columns intact until Task 6 so every intermediate commit remains runnable.

- [x] **Step 4: Implement memory and PostgreSQL parity**

Use exact methods:

```js
createWorkbookReviewRegion(input)
findWorkbookReviewRegionById(id)
listWorkbookReviewRegions({ projectId, workbookReviewSessionId, sourceDocumentId, includeDeleted })
updateWorkbookReviewRegion(id, patch)
createRegionUnderstandingRevision(input)
findRegionUnderstandingRevisionById(id)
listRegionUnderstandingRevisions({ regionId, projectId })
listAcceptedRegionUnderstandings({ projectId, sourceDocumentId, workbookReviewSessionId })
```

`updateWorkbookReviewRegion` increments `version` exactly once and never changes ownership/source coordinates. `createRegionUnderstandingRevision` rejects duplicate revision numbers.

- [x] **Step 5: Run focused store tests**

Run: `node --test backend/src/saas/workbookReviewRegions.test.js backend/src/saas/routes/saasRoutes.postgres.test.js`

Expected: memory tests PASS; PostgreSQL test PASS when configured or report the existing optional skip.

- [x] **Step 6: Commit the persistence slice**

```bash
git add backend/migrations/013_region_understandings.sql backend/src/saas/memoryStore.js backend/src/saas/postgresStore.js backend/src/saas/workbookReviewRegions.test.js backend/src/saas/routes/saasRoutes.postgres.test.js
git commit -m "feat: persist workbook region understanding revisions"
```

---

### Task 2: Bounded Region Interpretation Service

**Files:**
- Create: `backend/src/saas/workbookReviewRegions.js`
- Modify: `backend/src/saas/backendModelProvider.js`
- Test: `backend/src/saas/backendModelProvider.test.js`
- Test: `backend/src/saas/workbookReviewRegions.test.js`

**Interfaces:**
- Produces: `createWorkbookReviewRegionDraft`, `reviseWorkbookReviewRegion`, `confirmWorkbookReviewRegion`, `ignoreWorkbookReviewRegion`, and `deleteWorkbookReviewRegion`.
- Consumes: SourceDocument/index blobs, the store methods from Task 1, and `modelProvider.interpretWorkbookRegion(input)`.

- [x] **Step 1: Write failing model-provider and service tests**

Assert that the provider returns strict `{summary, interpretation}` JSON and bounded provider metadata. Assert the service payload contains one inspection range with at most 500 cells, workbook sheet metadata, and summaries rather than complete unrelated sheets.

- [x] **Step 2: Run focused tests and verify failures**

Run: `node --test backend/src/saas/backendModelProvider.test.js backend/src/saas/workbookReviewRegions.test.js`

Expected: FAIL because `interpretWorkbookRegion` and region lifecycle functions do not exist.

- [x] **Step 3: Add the model-provider operation**

Add a `WORKBOOK_REGION_SYSTEM` prompt that requires JSON shaped as:

```json
{
  "summary": ["sentence one", "sentence two"],
  "interpretation": {
    "semanticType": "experiment_table",
    "experimentAxis": "rows",
    "headerRow": 1,
    "experimentIdColumn": "A",
    "fields": [],
    "series": [],
    "inclusion": {},
    "confidence": 0.9,
    "warnings": []
  }
}
```

Expose `interpretWorkbookRegion(input)` through the existing private `requestStructured` helper with a bounded token limit and no browser credential path.

- [x] **Step 4: Implement strict region validation and revision creation**

Use `buildWorkbookUnderstandingPreview` on exactly one region to obtain bounded inspection and backend-normalized interpretation. Treat model interpretation as an explicit patch, re-run the deterministic validator, reject unresolved blockers on confirmation, calculate hashes on the backend, and cap visible summaries at four bounded sentences.

- [x] **Step 5: Implement lifecycle rules**

```js
await createWorkbookReviewRegionDraft({ store, session, sourceDocument, indexBlobs, input, modelProvider, actorUserId });
await reviseWorkbookReviewRegion({ store, region, sourceDocument, indexBlobs, input, modelProvider, actorUserId });
await confirmWorkbookReviewRegion({ store, region, revisionId, expectedRegionVersion, actorUserId });
await ignoreWorkbookReviewRegion({ store, region, expectedRegionVersion, reason, actorUserId });
await deleteWorkbookReviewRegion({ store, region, expectedRegionVersion, reason, actorUserId });
```

An accepted pointer remains unchanged while a later current revision awaits review. Delete changes only disposition/review metadata and never deletes source or downstream records.

- [x] **Step 6: Run focused tests**

Run: `node --test backend/src/saas/backendModelProvider.test.js backend/src/saas/workbookReviewRegions.test.js`

Expected: PASS for bounds, model failure, immutable revisions, stale versions, acceptance pointer replacement, ignore, and logical delete.

- [x] **Step 7: Commit the domain slice**

```bash
git add backend/src/saas/workbookReviewRegions.js backend/src/saas/workbookReviewRegions.test.js backend/src/saas/backendModelProvider.js backend/src/saas/backendModelProvider.test.js
git commit -m "feat: interpret workbook regions on the backend"
```

---

### Task 3: Region REST API And Session Seeding

**Files:**
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/workbookReviewSessions.js`
- Test: `backend/src/saas/routes/saasRoutes.test.js`
- Test: `backend/src/saas/routes/saasRoutes.postgres.test.js`

**Interfaces:**
- Produces the nested region routes from the approved design.
- Changes session create/detail responses to include `reviewRegions` and bounded current-revision summaries.

- [x] **Step 1: Write failing route tests**

Cover session-created detected cards, manual create, list/detail/history, revision, exact-revision confirm, ignore, delete, viewer write rejection, cross-project rejection, stale `expectedRegionVersion`, model failure/retry, and idempotent mutation replay.

- [x] **Step 2: Run the focused route cases**

Run: `node --test --test-name-pattern="workbook review region" backend/src/saas/routes/saasRoutes.test.js`

Expected: FAIL with 404 for the new routes.

- [x] **Step 3: Add region authorization and response summaries**

Implement project/session/region ownership helpers. Public region payloads expose visible summary, validated interpretation, warnings, provider/model/usage metadata, exact refs, version, and current/accepted revision ids; they never expose hidden prompt text or credentials.

- [x] **Step 4: Add nested routes**

Implement the approved GET/POST/DELETE endpoints. Create/revision/confirm require editor; reads require viewer. Return `409` for stale region versions, `422` for model/schema/source validation failures, and stable error codes.

- [x] **Step 5: Seed detected regions during session creation**

Create a review region for each deterministic detected SourceRegion and draft its initial backend-model revision. Provider failure preserves a visible `interpretation_failed` card and does not abort workbook/session creation.

- [x] **Step 6: Run route tests**

Run: `node --test backend/src/saas/routes/saasRoutes.test.js backend/src/saas/routes/saasRoutes.postgres.test.js`

Expected: all route tests PASS with only the optional PostgreSQL skip when unconfigured.

- [x] **Step 7: Commit the API slice**

```bash
git add backend/src/saas/routes/saasRoutes.js backend/src/saas/workbookReviewSessions.js backend/src/saas/routes/saasRoutes.test.js backend/src/saas/routes/saasRoutes.postgres.test.js
git commit -m "feat: expose region-level workbook review APIs"
```

---

### Task 4: Accepted-Region Evidence And DataPlan Cutover

**Files:**
- Modify: `backend/src/saas/evidenceAgentTools.js`
- Modify: `backend/src/saas/evidenceAgentRetrieval.js`
- Modify: `backend/src/saas/dataPlanAgent.js`
- Modify: `backend/src/saas/dataPlanAgentTools.js`
- Modify: `backend/src/saas/dataPlanSchemas.js`
- Modify: `backend/src/saas/experimentBrowserPublish.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Test: matching backend `*.test.js` files

**Interfaces:**
- Replaces `acceptedUnderstandings` with `acceptedRegionUnderstandings`.
- Replaces `workbookUnderstandingIds` and evidence fields with `regionUnderstandingRevisionIds`, `regionUnderstandingRevisionId`, and `regionId`.

- [x] **Step 1: Rewrite tests first for accepted-region evidence**

Assert that only `disposition: active` regions with a valid `acceptedRevisionId` are usable; ignored/deleted/unconfirmed/current-but-unaccepted revisions are excluded. Assert dependency hashes change when the accepted revision pointer changes.

- [x] **Step 2: Run focused evidence/DataPlan tests and verify failures**

Run: `node --test backend/src/saas/evidenceAgentRetrieval.test.js backend/src/saas/dataPlanAgent.test.js backend/src/saas/dataPlanSchemas.test.js backend/src/saas/experimentBrowserPublish.test.js`

Expected: FAIL on old WorkbookUnderstanding field names.

- [x] **Step 3: Change evidence compilation and schemas**

Compile each accepted region revision into the existing row/region extraction representation while preserving its validated interpretation and exact range. Source evidence entries become:

```js
{
  kind: "region_understanding_revision",
  regionId,
  regionUnderstandingRevisionId,
  sourceDocumentId,
  sourceRef,
  contentHash,
  dependencyHash,
}
```

- [x] **Step 4: Change draft and publish reload boundaries**

`loadExperimentDataPlanReview` and `publishExperimentBrowserData` must reload the exact requested accepted revisions, verify active region pointers and source hashes, and reject stale/deleted/ignored evidence. Existing identity review, DataSnapshot execution, publish idempotency, and experiment-head advancement remain unchanged.

- [x] **Step 5: Run focused backend tests**

Run the four commands from Step 2 plus `node --test backend/src/saas/dataPlanExecutor.test.js`.

Expected: PASS with exact region revision lineage.

- [x] **Step 6: Commit the downstream cutover**

```bash
git add backend/src/saas/evidenceAgentTools.js backend/src/saas/evidenceAgentRetrieval.js backend/src/saas/dataPlanAgent.js backend/src/saas/dataPlanAgentTools.js backend/src/saas/dataPlanSchemas.js backend/src/saas/experimentBrowserPublish.js backend/src/saas/routes/saasRoutes.js backend/src/saas/*DataPlan*.test.js backend/src/saas/evidenceAgentRetrieval.test.js backend/src/saas/experimentBrowserPublish.test.js
git commit -m "refactor: derive data plans from accepted region revisions"
```

---

### Task 5: Simplified Region Review Frontend

**Files:**
- Modify: `src/data/serverApi.js`
- Modify: `src/data/serverApi.test.js`
- Modify: `src/data/workbookReviewState.js`
- Modify: `src/data/workbookReviewState.test.js`
- Rewrite: `src/components/WorkbookReviewDock.jsx`
- Rewrite: `src/components/WorkbookReviewDock.test.jsx`
- Modify: `src/main.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces frontend helpers for region list/create/revise/confirm/ignore/delete.
- `WorkbookReviewDock` consumes server `reviewRegions`; it emits one-region commands and no multi-selection state.

- [x] **Step 1: Write failing API and dock tests**

Cover exact request paths/bodies, two-to-four sentence rendering, active-card focus, one feedback draft per card, independent submit/confirm, provider failure retry, ignore, delete confirmation, accepted-pending-revision display, and absence of checkbox/structured editor/workbook confirmation.

- [x] **Step 2: Run focused frontend tests and verify failures**

Run: `npm test -- --run src/data/serverApi.test.js src/data/workbookReviewState.test.js src/components/WorkbookReviewDock.test.jsx`

Expected: FAIL on missing helpers and old UI controls.

- [x] **Step 3: Replace frontend API helpers**

Add:

```js
listServerWorkbookReviewRegions(sessionId)
createServerWorkbookReviewRegion(sessionId, request)
listServerWorkbookReviewRegionRevisions(sessionId, regionId)
reviseServerWorkbookReviewRegion(sessionId, regionId, request)
confirmServerWorkbookReviewRegion(sessionId, regionId, request)
ignoreServerWorkbookReviewRegion(sessionId, regionId, request)
deleteServerWorkbookReviewRegion(sessionId, regionId, request)
```

Remove aggregate revise/confirm/list-understanding helpers.

- [x] **Step 4: Rewrite the dock as compact cards**

Each card renders range, summary sentences, confidence/warnings, status, feedback textarea, and icon/text commands for revise, confirm, ignore, and delete. No card nests another card. Delete of an accepted region requires a confirmation dialog; deletion of a draft region uses the same API without historical-cascade copy.

- [x] **Step 5: Rewire main workbook state**

Use server region ids as the only card/highlight ids. Ordinary drag creates a manual region; Ctrl/Command drag may continue to create an additional region but no checkbox set controls blue highlights. Active-card focus highlights only that card's range. DataPlan review collects accepted revision ids for the current session.

- [x] **Step 6: Run focused frontend tests and build**

Run: `npm test -- --run src/data/serverApi.test.js src/data/workbookReviewState.test.js src/components/WorkbookReviewDock.test.jsx`

Run: `npm run build`

Expected: focused tests PASS; build succeeds with only the existing Plotly chunk warning.

- [x] **Step 7: Commit the frontend slice**

```bash
git add src/data/serverApi.js src/data/serverApi.test.js src/data/workbookReviewState.js src/data/workbookReviewState.test.js src/components/WorkbookReviewDock.jsx src/components/WorkbookReviewDock.test.jsx src/main.jsx src/styles.css
git commit -m "feat: simplify workbook region review"
```

---

### Task 6: Retire Aggregate WorkbookUnderstanding

**Files:**
- Create: `backend/migrations/014_drop_aggregate_workbook_understanding.sql`
- Modify/Delete: `backend/src/saas/workbookReviewSessions.js`
- Modify: `backend/src/saas/memoryStore.js`
- Modify: `backend/src/saas/postgresStore.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `src/main.jsx`
- Modify: affected backend/frontend tests

**Interfaces:**
- Removes aggregate `/revisions`, `/confirm`, `/workbook-understandings` routes and store helpers.
- Removes `currentUnderstanding`, session-level draft regions, selected checkbox ids, and aggregate state responses.

- [x] **Step 1: Add route retirement assertions**

Assert all three retired endpoints return 404 and project state contains `regionUnderstandings`/`workbookReviewRegions` summaries without `workbookUnderstandings`.

- [x] **Step 2: Remove old code paths and symbols**

Delete aggregate confirmation/revision builders and frontend calls. Keep only session summary/initial candidate helpers still needed by region seeding. Remove old store maps/mappers/SQL methods and stale tests rather than maintaining compatibility fixtures.

Migration 014 drops `workbook_understandings` and removes the now-inert `current_understanding` and `regions` columns from `workbook_review_sessions` in the same release as the route/store cutover.

- [x] **Step 3: Run symbol scans**

Run: `rg -n "workbookUnderstandingIds|workbookUnderstandingId|workbook_understandings|confirmServerWorkbookReviewSession|reviseServerWorkbookReviewSession" backend/src src`

Expected: no active product references; historical migration/design documentation may still contain the retired terms.

- [x] **Step 4: Run route and frontend suites**

Run: `node --test backend/src/saas/routes/saasRoutes.test.js`

Run: `npm test -- --run src/data/serverApi.test.js src/components/WorkbookReviewDock.test.jsx`

Expected: PASS.

- [x] **Step 5: Commit retirement**

```bash
git add backend/src/saas src
git commit -m "refactor: retire aggregate workbook understanding"
```

---

### Task 7: Contracts And Golden Workflow

**Files:**
- Modify: `doc/plan.md`
- Modify: `doc/current-milestone.md`
- Modify: `doc/contracts/saas-api-contract-v0.md`
- Modify: `doc/contracts/saas-database-schema-v0.md`
- Modify: `doc/contracts/canonical-data-dictionary.md`
- Modify: `doc/contracts/server-project-state-plan.md`
- Modify: `doc/arch/architecture.md`
- Modify: `doc/arch/ai-boundaries.md`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `backend/src/saas/routes/saasRoutes.postgres.test.js`

**Interfaces:**
- Documents region revisions as the only accepted workbook semantic evidence.
- Preserves DataPlan/DataSnapshot/Experiment Browser boundaries.

- [x] **Step 1: Rewrite the golden route test**

Exercise upload, detected region model summary, manual selection, feedback revision, exact region confirmation, ignored/deleted exclusion, accepted-region DataPlan preview, explicit publish, reload, and Snapshot-backed Browser projection. Assert no aggregate WorkbookUnderstanding row or API exists.

- [x] **Step 2: Update active contracts and architecture**

Replace the aggregate flow with:

```text
SourceDocument -> WorkbookReviewSession -> accepted RegionUnderstandingRevision
-> reviewed DataPlan -> accepted DataSnapshot -> ExperimentSnapshotHead -> Browser
```

Document exact API payloads, status transitions, logical delete, model bounds, hashes, and stale rules.

- [x] **Step 3: Run documentation and golden checks**

Run: `git diff --check`

Run: `node --test --test-name-pattern="golden|workbook review region" backend/src/saas/routes/saasRoutes.test.js backend/src/saas/routes/saasRoutes.postgres.test.js`

Expected: diff check clean apart from existing line-ending notices; golden memory test passes and optional PostgreSQL test passes or skips when unconfigured.

- [x] **Step 4: Commit contracts and golden coverage**

```bash
git add doc backend/src/saas/routes/saasRoutes.test.js backend/src/saas/routes/saasRoutes.postgres.test.js
git commit -m "docs: cut over to accepted region understanding"
```

---

### Task 8: Full Verification And Browser QA

**Files:**
- Modify: `doc/PROGRESS.md`
- Modify: `doc/current-milestone.md`
- Modify: any task-owned file only when verification exposes a defect

**Interfaces:**
- Produces final verification evidence and milestone status.

- [ ] **Step 1: Run complete automated verification**

Run: `npm run codex:verify`

Expected: all frontend tests pass, all backend tests pass with only the optional PostgreSQL skip when unconfigured, and production build succeeds with the known Plotly chunk warning.

- [ ] **Step 2: Run desktop browser QA**

Upload a real multi-header workbook, verify full-sheet progressive loading, detected region summaries, manual region creation, focus/highlight, revision, confirmation, ignore, delete, DataPlan preview, publish, reload, and Browser source navigation. Confirm no console errors.

- [ ] **Step 3: Run 390x844 responsive QA**

Verify cards, sentence wrapping, feedback controls, dialogs, workbook/dock stacking, and no overlap or horizontal page overflow.

- [ ] **Step 4: Update durable progress**

Record request, API/schema cutover, LLM boundary, frontend behavior, exact test totals, browser QA evidence, provider configuration assumptions, and residual risks in `doc/PROGRESS.md`; mark `doc/current-milestone.md` completed only when all required checks pass.

- [ ] **Step 5: Final review and commit**

Run: `git diff --check`

Run: `git status --short`

Commit only task-owned files, leaving `.codex/`, `.superpowers/`, and `postman/cookies.txt` untouched.
