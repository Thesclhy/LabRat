# Workbook Review To Experiment Browser Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan one milestone at a time. Use `superpowers:test-driven-development` for each behavior change and `superpowers:verification-before-completion` before closing a milestone.

Status: approved
Read when: implementing the first complete reviewed workbook-to-browser path.
Created: 2026-07-16

**Goal:** Make an uploaded workbook reach a durable, source-backed Experiment Browser after explicit review, with one stable experiment per row and no DatasetCommit/genericImports dependency.

**Architecture:** Keep immutable workbook evidence and accepted interpretation separate from deterministic extraction. `SourceDocument -> WorkbookReviewSession -> accepted WorkbookUnderstanding -> reviewed DataPlan preview -> explicit publish -> accepted DataSnapshot -> experiment projection -> Experiment Browser`. Browser rows are a read model over each experiment's active accepted snapshot record. Saved views store display choices only.

**Tech stack:** React 19/JSX, react-data-grid, Vite/Vitest, Node HTTP routes and `node:test`, in-memory and Postgres stores, SQL migrations, existing SourceDocument range readers.

## Confirmed Product Decisions

1. The first complete product path ends at Experiment Browser. ChartSpec, FigurePackage, and Manuscript are later paths.
2. One Browser row represents one experiment or data series identity. Scalar values appear in columns; point arrays and full provenance appear in the detail drawer.
3. Experiment Browser is optimized for cross-experiment browsing and comparison, not import-batch administration.
4. The default view contains a deterministic set of recommended important columns. Users can add, hide, reorder, resize, filter, sort, and save personal views.
5. The selected layout is a dense table with a temporary right-side columns drawer, a row detail drawer, and a persistent comparison tray.
6. New product code must not create or read DatasetCommit, `dataset.genericImports`, `dataset.genericMappingSets`, or `dataset.genericChartProposals`.
7. No historical migration for local or legacy dataset shapes is required. Repository-wide legacy removal happens only after the replacement Browser path passes the golden workflow.

## Non-Negotiable Data Rules

- SourceDocument bytes and indexed cells are immutable evidence.
- WorkbookUnderstanding records user-confirmed interpretation; it does not contain invented scientific values.
- DataPlan stores validated references and operations, not client-supplied result arrays.
- Publish re-reads SourceDocument ranges on the backend and compares dependency and preview hashes.
- A DataSnapshot is immutable. A correction creates a new DataPlan and DataSnapshot and advances only the affected experiment heads.
- Experiment aliases never merge silently. Ambiguous matches require an explicit `reuse` or `create` identity decision.
- Fields share a Browser column only when semantic keys and normalized units are compatible. No unit conversion occurs without an explicit reviewed conversion operation.
- Included rows, skipped rows, parse warnings, confidence, and source refs remain visible before publish and in accepted details.
- BrowserView changes never alter DataSnapshot content.

## Target Flow

```text
Upload workbook
  -> SourceDocument + WorkbookReviewSession
  -> select one or more red boxes
  -> conversational correction + structured interpretation preview
  -> confirm accepted WorkbookUnderstanding
  -> review extracted experiments
  -> transient DataPlan + deterministic DataSnapshot preview
  -> resolve identity/unit/skip warnings
  -> Publish to Browser
  -> backend revalidates and re-executes
  -> persist accepted DataPlan + immutable DataSnapshot
  -> advance experiment_snapshot_heads transactionally
  -> GET experiment projection
  -> browse, compare, inspect sources, save BrowserView
```

There are two explicit review boundaries:

1. **Confirm understanding:** accepts what each source region means.
2. **Publish to Browser:** accepts the extracted experiment records and advances active Browser data.

## Canonical Shapes

### Workbook region interpretation

Extend each accepted `WorkbookUnderstanding.facts[]` region fact with a validated interpretation. Support both common workbook layouts from the start.

```js
{
  factId,
  sourceDocumentId,
  sheetName,
  range,
  semanticType,
  interpretation: {
    experimentAxis: "rows" | "region",
    headerRow: 1,
    experimentLabel: null,              // required for experimentAxis=region
    experimentIdColumn: "A" | null,    // required for experimentAxis=rows
    fields: [{
      column: "B",
      semanticKey: "reaction_temperature",
      displayName: "Reaction temperature",
      role: "identifier" | "condition" | "outcome" | "series_summary" | "other",
      valueType: "number" | "string" | "date" | "boolean",
      unit: "degC" | null,
      confidence: 0.92,
      sourceRefs: []
    }],
    series: [{
      seriesKey: "reaction_rate_over_time",
      xColumn: "D",
      yColumn: "E",
      xSemanticKey: "reaction_time",
      ySemanticKey: "reaction_rate",
      xUnit: "min",
      yUnit: "mol_g_h"
    }],
    inclusion: {
      startRow: 2,
      endRow: 31,
      skippedRows: [{ rowNumber: 14, reason: "blank_identifier" }]
    }
  }
}
```

Backend inspection may propose this shape from headers and bounded cell previews. The user must be able to correct every proposed property with structured controls when natural-language parsing cannot resolve it.

### DataPlan v2

Introduce `labrat.dataPlan.v2` for the Browser path. Keep v1 readable only until the cleanup milestone.

```js
{
  schemaVersion: "labrat.dataPlan.v2",
  status: "draft" | "validated" | "accepted" | "superseded",
  task: "experiment_browser_publish",
  outputShape: "experiment_records",
  sourceEvidence: [],
  dependencyHashes: [],
  identityBindings: [{
    sourceAlias: "Exp33",
    action: "create" | "reuse",
    experimentIdentityId: null
  }],
  operations: [
    { op: "read_table_region", sourceDocumentId, sheetName, range },
    { op: "use_row_as_header", rowNumber: 1 },
    { op: "bind_experiment_identity", experimentAxis: "rows", column: "A" },
    { op: "bind_fields", fields: [] },
    { op: "select_data_rows", startRow: 2, endRow: 31 },
    { op: "emit_experiment_records" }
  ]
}
```

### Accepted DataSnapshot

```js
{
  schemaVersion: "labrat.dataSnapshot.v2",
  status: "accepted" | "superseded",
  outputShape: "experiment_records",
  dataPlanId,
  contentHash,
  dependencyHash,
  experimentRecords: [{
    experimentId,                         // required when accepted
    identityCandidateKey: null,          // preview-only when action=create
    label,
    aliases: [],
    fields: [{
      fieldKey,
      displayName,
      role,
      value,
      formattedValue,
      valueType,
      unit,
      confidence,
      warnings: [],
      sourceRefs: []
    }],
    series: [{
      seriesKey,
      label,
      xField,
      yField,
      xUnit,
      yUnit,
      points: [{ x, y, sourceRefs: [] }],
      sourceRefs: []
    }],
    warnings: [],
    sourceRefs: []
  }],
  includedRowCount,
  skippedRows: [],
  warnings: []
}
```

Preview responses use the same payload with `status: "preview"`, but previews are not durable records.

Preview identity and hashing rules:

- A `reuse` decision may include an existing `experimentId` in preview.
- A `create` decision uses a stable `identityCandidateKey`; it does not invent a persisted id before the publish transaction.
- `previewHash` covers canonical extracted records, source aliases, and identity decisions while excluding database-assigned ids.
- Publish re-executes and compares `previewHash` before writing. The accepted snapshot's `contentHash` is then computed from final content including persisted experiment ids.

### Experiment projection

`GET /api/projects/:projectId/experiment-browser` returns a cursor-paginated projection rather than stored Browser rows. It accepts `cursor`, `limit`, `search`, `filters`, and `sort`; default limit is `200` and maximum limit is `1000`. Columns describe the full active projection while `rows` contains only the requested page.

```js
{
  schemaVersion: "labrat.experimentBrowserProjection.v1",
  nextCursor: null,
  totalCount: 3,
  columns: [{
    columnId,
    fieldKey,
    displayName,
    role,
    valueType,
    unit,
    coverage,
    averageConfidence,
    recommended,
    warningCount
  }],
  rows: [{
    experimentId,
    label,
    activeDataSnapshotId,
    values: { [columnId]: { value, formattedValue, sourceRefs, warnings } },
    seriesCount,
    warningCount,
    sourceCount
  }]
}
```

The detail endpoint returns full fields, point arrays, warnings, and source refs. The list endpoint must stay bounded and must not embed full series points.

### BrowserView

```js
{
  schemaVersion: "labrat.browserView.v1",
  id,
  projectId,
  ownerUserId,
  name,
  columns: [{ columnId, order, width, hidden }],
  filters: [],
  sort: [],
  groupBy: null,
  selectedExperimentIds: [],
  isDefault: false
}
```

BrowserViews are personal display state in this milestone. A viewer may create and mutate their own views; only an editor may publish scientific data.

## API Contract

Add or replace the following project-scoped endpoints:

```text
POST   /api/projects/:projectId/data-plans/draft
POST   /api/projects/:projectId/data-plans/publish
GET    /api/projects/:projectId/data-plans
GET    /api/projects/:projectId/data-snapshots
GET    /api/projects/:projectId/experiment-browser
GET    /api/projects/:projectId/experiments/:experimentId
GET    /api/projects/:projectId/browser-views
POST   /api/projects/:projectId/browser-views
PATCH  /api/projects/:projectId/browser-views/:browserViewId
DELETE /api/projects/:projectId/browser-views/:browserViewId
```

`POST /data-plans/draft` accepts `workbookUnderstandingIds[]` and a Browser intent. The backend reloads those accepted understandings and resolves SourceDocument evidence itself; v2 does not trust client-supplied retrieval results or values. It returns `dataPlan`, `snapshotPreview`, `identityCandidates`, `reviewSummary`, and hashes. It never persists or advances Browser state.

`POST /data-plans/publish` accepts the reviewed plan, identity decisions, `expectedPreviewHash`, and `expectedDependencyHash`. In one backend transaction it:

1. reloads accepted evidence and source ranges;
2. validates ownership, versions, operations, field bindings, units, and identity decisions;
3. re-executes deterministically and recomputes the id-independent `previewHash`;
4. returns `409 preview_stale` if the preview or dependency hash changed;
5. persists an accepted DataPlan and immutable DataSnapshot;
6. creates or reuses ExperimentIdentity rows;
7. advances only the contained `experiment_snapshot_heads`;
8. writes audit events;
9. returns the refreshed experiment projection summary.

It must not create DatasetCommits, generic imports, mapping sets, chart proposals, ChartSpecs, FigurePackages, or ManuscriptPlacements.

## Persistence Model

Create `backend/migrations/010_data_plan_experiment_browser.sql` with:

- `data_plans`: project ownership, schema/status, task/output shape, validated plan JSON, evidence refs, dependency hash, accepted actor/time.
- `data_snapshots`: immutable execution payload, plan FK, content/dependency hashes, included/skipped summary, warnings, accepted actor/time.
- `experiment_identities`: project-scoped canonical label, normalized label, aliases, created actor/time; do not add a unique normalized-label constraint that would force a silent merge.
- `experiment_snapshot_heads`: one row per project/experiment identity pointing to the active snapshot and record index.
- `browser_views`: personal project-scoped display state with owner FK and payload JSON.

Store methods must follow the existing memory/Postgres parity pattern. Multi-object publish needs a store transaction method instead of route-level partial writes.

## Default Column Recommendation

Implement a deterministic recommendation function in the projection layer. Do not call an AI provider for the default Browser view.

1. Pin `Experiment` first.
2. Group fields by `fieldKey + normalizedUnit + valueType`.
3. Reject fields that occur only in unaccepted or skipped evidence.
4. Score role priority: outcome `100`, condition `80`, identifier `60`, series_summary `40`, other `20`.
5. Add up to `30` points for row coverage and `10` for average confidence.
6. Subtract up to `20` for warning prevalence.
7. Recommend the highest scoring six to eight columns; preserve deterministic tie ordering by display name and column id.
8. Keep incompatible units as separate columns with units in the header.

## Milestone 0: Contract Cutover And Safety Net

**Purpose:** Establish the new source of truth before implementation changes behavior.

**Files:**

- Modify: `doc/contracts/canonical-data-dictionary.md`
- Modify: `doc/contracts/saas-api-contract-v0.md`
- Modify: `doc/contracts/saas-database-schema-v0.md`
- Modify: `doc/contracts/server-project-state-plan.md`
- Modify: `doc/arch/architecture.md`
- Modify: `doc/arch/ai-boundaries.md`
- Modify: `doc/task-checklist.md`

**Tasks:**

1. Mark DatasetCommit/generic import objects as deprecated implementation history, not an allowed input to the new Browser path.
2. Add the v2 WorkbookUnderstanding, DataPlan, DataSnapshot, ExperimentIdentity, experiment projection, and BrowserView shapes above.
3. Document publish transaction, stale-preview handling, permissions, audit events, and no-side-effect rules.
4. Document the two supported experiment layouts: one experiment per source region and one experiment per table row.
5. Add a temporary compatibility statement: old chart/manuscript screens may remain isolated until Milestone 6, but they are not evidence for Browser acceptance.
6. Run `npm run codex:preflight` and `git diff --check`.
7. Update `doc/PROGRESS.md`, then re-read all touched contracts before Milestone 1.

**Commit:** `docs: define reviewed experiment browser data path`

## Milestone 1: Continuous Workbook Review Dock

**Purpose:** Remove the close/reopen chat discontinuity and make multi-red-box review understandable before changing extraction semantics.

**Files:**

- Create: `src/components/WorkbookReviewDock.jsx`
- Create: `src/components/WorkbookReviewDock.test.jsx`
- Modify: `src/main.jsx`
- Modify: `src/components/ProjectDashboard.test.jsx`
- Modify: `src/styles.css`

**Test first:**

1. Add a failing component test proving the dock remains visible beside the workbook after upload and after a revision.
2. Add a failing test proving selecting a red box updates the active-region chip and does not discard other boxes.
3. Add a failing test proving a revision spinner/error is local to the dock and grid scroll/selection state remains mounted.
4. Add a failing test proving confirmation does not close the workspace into a generic assistant overlay; it transitions to a clear `Review extracted experiments` next action.

**Implementation:**

1. Extract the review conversation, active-region list, clarification, and confirm controls from the global Agent panel into `WorkbookReviewDock` while reusing existing callbacks.
2. Keep one stable `draftRegionId` per red box and show each region's sheet/range, semantic type, status, warnings, and active state.
3. Default revisions to the active red box; provide an explicit multi-select for revisions that intentionally affect several boxes.
4. Preserve `WorkbookReviewWorkspace` grid and range cache across dock submissions.
5. Keep the global Agent panel available for project-level work, but do not require it for workbook review.

**Verify:**

```bash
npm test -- src/components/WorkbookReviewDock.test.jsx src/components/ProjectDashboard.test.jsx
npm run build
git diff --check
```

Run desktop and narrow-viewport browser QA: select, resize, switch active boxes, submit a revision, inspect clarification, and confirm without UI overlap.

**Commit:** `feat: keep workbook review conversation beside source`

## Milestone 2: Structured Workbook Interpretation

**Purpose:** Capture enough accepted semantics to extract experiments without guessing from a rectangle.

**Files:**

- Create: `backend/src/saas/workbookUnderstandingPreview.js`
- Create: `backend/src/saas/workbookUnderstandingPreview.test.js`
- Modify: `backend/src/saas/workbookReviewSessions.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `src/data/serverApi.js`
- Modify: `src/data/serverApi.test.js`
- Modify: `src/components/WorkbookReviewDock.jsx`
- Modify: `src/components/WorkbookReviewDock.test.jsx`

**Test first:**

1. Add fixtures for a row-oriented experiment table and a region-oriented single experiment with an XY series.
2. Add failing unit tests for header/field/unit/inclusion proposals generated only from backend-read cells.
3. Add failing tests for preserving user corrections to experiment axis, identity binding, field role, unit, and skipped rows.
4. Add failing route tests that block confirmation when experiment axis or identity binding remains ambiguous.
5. Add failing frontend tests for structured preview sections: experiments, fields, units, included/skipped rows, warnings, and source range.

**Implementation:**

1. Implement bounded region inspection in `workbookUnderstandingPreview.js` using the existing SourceDocument range reader.
2. Extend revision responses and `currentUnderstanding.facts[]` with validated `interpretation` objects.
3. Treat automatic header/unit/layout output as proposals with confidence and warnings.
4. Add structured fallback controls in the dock for every property required by the canonical shape.
5. Convert conversational corrections into a typed `interpretationPatch`; validate patch targets and values before updating session state.
6. Keep ignored regions explicit and show why rows are skipped.
7. Block confirmation on unresolved experiment identity or incompatible unit ambiguity; allow low confidence only with explicit confirmation recorded in `decisionSummary`.

**Verify:**

```bash
node --test backend/src/saas/workbookUnderstandingPreview.test.js
node --test backend/src/saas/routes/saasRoutes.test.js
npm test -- src/data/serverApi.test.js src/components/WorkbookReviewDock.test.jsx
npm --prefix backend test
npm test
npm run build
git diff --check
```

**Commit:** `feat: review structured workbook interpretation`

## Milestone 3: Experiment-Record DataPlan And Deterministic Preview

**Purpose:** Compile accepted WorkbookUnderstanding facts into source-backed experiment records without persistence or Browser mutation.

**Files:**

- Modify: `backend/src/saas/dataPlanSchemas.js`
- Modify: `backend/src/saas/dataPlanSchemas.test.js`
- Modify: `backend/src/saas/dataPlanAgentTools.js`
- Modify: `backend/src/saas/dataPlanAgent.js`
- Modify: `backend/src/saas/dataPlanAgent.test.js`
- Modify: `backend/src/saas/dataPlanExecutor.js`
- Create: `backend/src/saas/dataPlanExecutor.test.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `src/data/serverApi.js`
- Modify: `src/data/serverApi.test.js`
- Create: `src/components/DataPlanReviewPanel.jsx`
- Create: `src/components/DataPlanReviewPanel.test.jsx`

**Test first:**

1. Add failing schema tests for `experiment_records`, typed field bindings, accepted evidence, dependency hashes, identity decisions, and forbidden result arrays in plans.
2. Add failing executor tests for both experiment layouts, stable ordering/hashes, dates, blanks, false/zero values, skipped rows, source refs, and series points.
3. Add failing tests for unit incompatibility, duplicate aliases, ambiguous identity candidates, and missing accepted evidence.
4. Add failing route tests proving draft is transient and creates no store records or unrelated artifacts.
5. Add failing panel tests for included/skipped counts, field/unit table, identity decisions, warnings, source links, and disabled publish when blockers remain.

**Implementation:**

1. Add v2 validators and `emit_experiment_records`; do not let the executor infer semantics absent from accepted interpretation.
2. Compile one record per table row for `experimentAxis=rows` and one record per accepted region for `experimentAxis=region`.
3. Generate stable preview ids from plan content, not `Date.now()`.
4. Compute `dependencyHash` from accepted understanding version plus SourceDocument/version/range hashes, `previewHash` from id-independent canonical extraction content, and accepted `contentHash` from final snapshot content.
5. Return identity candidates without choosing ambiguous matches.
6. Return a structured `reviewSummary` with included/skipped rows, field coverage, units, warnings, and representative source refs.
7. Add `DataPlanReviewPanel` after accepted understanding; keep Publish disabled until all blockers have explicit decisions.

**Verify:**

```bash
node --test backend/src/saas/dataPlanSchemas.test.js
node --test backend/src/saas/dataPlanExecutor.test.js
node --test backend/src/saas/dataPlanAgent.test.js
node --test backend/src/saas/routes/saasRoutes.test.js
npm test -- src/data/serverApi.test.js src/components/DataPlanReviewPanel.test.jsx
npm --prefix backend test
npm test
npm run build
git diff --check
```

**Commit:** `feat: preview source-backed experiment records`

## Milestone 4: Transactional Publish And Persistence

**Purpose:** Make explicit publish durable, auditable, reloadable, and atomic.

**Files:**

- Create: `backend/migrations/010_data_plan_experiment_browser.sql`
- Modify: `backend/src/saas/memoryStore.js`
- Modify: `backend/src/saas/postgresStore.js`
- Create: `backend/src/saas/experimentBrowserPublish.js`
- Create: `backend/src/saas/experimentBrowserPublish.test.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `backend/src/saas/routes/saasRoutes.postgres.test.js`
- Modify: `src/data/serverApi.js`
- Modify: `src/data/serverApi.test.js`
- Modify: `src/components/DataPlanReviewPanel.jsx`
- Modify: `src/components/DataPlanReviewPanel.test.jsx`

**Test first:**

1. Define memory-store contract tests for DataPlan, DataSnapshot, ExperimentIdentity, snapshot head, and BrowserView CRUD.
2. Add failing publish tests for successful atomic write, rollback on failure, `preview_stale`, cross-project ids, duplicate publish idempotency, and editor permission.
3. Add failing tests proving only affected experiment heads advance when a later snapshot replaces part of a project.
4. Add failing Postgres route tests for persistence and reload when `LABRAT_TEST_DATABASE_URL` is configured.
5. Add failing frontend tests for publish progress, stale-preview recovery, success transition, and no double submit.

**Implementation:**

1. Apply the migration in a transaction and add indexes for project lists, identity lookup, active heads, and view ownership.
2. Add memory/Postgres parity methods and one `publishExperimentSnapshot(...)` transaction boundary.
3. Re-read and re-execute on publish; never persist the client preview payload as accepted content.
4. Persist accepted actor/time, evidence refs, hashes, warnings, and audit events.
5. Make an idempotency key mandatory for publish and return the prior result on exact retry.
6. Return `409 preview_stale` with enough detail for the client to refresh the draft without losing review choices.
7. On success, leave the accepted WorkbookUnderstanding intact and navigate to Browser with the published experiments selected.

**Verify:**

```bash
node --test backend/src/saas/experimentBrowserPublish.test.js
node --test backend/src/saas/routes/saasRoutes.test.js
node --test backend/src/saas/routes/saasRoutes.postgres.test.js
npm test -- src/data/serverApi.test.js src/components/DataPlanReviewPanel.test.jsx
npm --prefix backend test
npm test
npm run build
git diff --check
```

Record Postgres verification as skipped when no test database is configured.

**Commit:** `feat: publish accepted experiment snapshots`

## Milestone 5: Snapshot-Backed Experiment Browser

**Purpose:** Replace generic import row derivation with a project-scoped projection over active experiment snapshot heads.

**Files:**

- Create: `backend/src/saas/experimentProjection.js`
- Create: `backend/src/saas/experimentProjection.test.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Create: `src/data/experimentBrowserApi.js`
- Create: `src/data/experimentBrowserApi.test.js`
- Create: `src/components/ExperimentBrowser.jsx`
- Create: `src/components/ExperimentBrowser.test.jsx`
- Create: `src/components/ExperimentDetailDrawer.jsx`
- Create: `src/components/ExperimentDetailDrawer.test.jsx`
- Modify: `src/main.jsx`
- Modify: `src/styles.css`

**Test first:**

1. Add failing projection tests for one row per identity, active-head replacement, missing fields, stable column ids, incompatible unit separation, cursor pagination, bounded rows, and no full point arrays.
2. Add failing recommendation tests for deterministic role/coverage/confidence/warning scoring.
3. Add failing route tests for viewer access, project isolation, full detail, and unknown experiment ids.
4. Add failing component tests for loading, empty, error, dense table, recommended columns, search/filter/sort, row selection, and opening/closing the detail drawer.
5. Add failing detail tests for scalar fields, series point counts, warnings, source ranges, and source-cell navigation callbacks.

**Implementation:**

1. Build projection data only from `experiment_snapshot_heads` and accepted DataSnapshots.
2. Keep Experiment pinned; render six to eight recommended fields by default.
3. Use a temporary right-side columns drawer; closing it restores table width.
4. Use a right-side row detail drawer rather than a centered modal.
5. Fetch full experiment details lazily.
6. Preserve stable table dimensions, request cursor pages as needed, and virtualize rows for large projects. Do not disable virtualization for the Browser grid.
7. Replace the active `GenericImportBrowser` call site in `src/main.jsx`; do not hydrate Browser rows from `currentDatasetCommit`.

**Verify:**

```bash
node --test backend/src/saas/experimentProjection.test.js
node --test backend/src/saas/routes/saasRoutes.test.js
npm test -- src/data/experimentBrowserApi.test.js src/components/ExperimentBrowser.test.jsx src/components/ExperimentDetailDrawer.test.jsx
npm --prefix backend test
npm test
npm run build
git diff --check
```

Run browser QA at desktop and narrow widths. Check table/drawer overlap, long headers, empty cells, scrolling, keyboard focus, and a project with at least 1,000 projected rows.

**Commit:** `feat: browse accepted experiment snapshots`

## Milestone 6: Saved Views And Comparison Tray

**Purpose:** Let users build repeatable cross-experiment comparisons without changing scientific data.

**Files:**

- Create: `src/components/ExperimentColumnsDrawer.jsx`
- Create: `src/components/ExperimentColumnsDrawer.test.jsx`
- Create: `src/components/ExperimentCompareTray.jsx`
- Create: `src/components/ExperimentCompareTray.test.jsx`
- Modify: `src/components/ExperimentBrowser.jsx`
- Modify: `src/components/ExperimentBrowser.test.jsx`
- Modify: `src/data/experimentBrowserApi.js`
- Modify: `src/data/experimentBrowserApi.test.js`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/routes/saasRoutes.test.js`
- Modify: `src/styles.css`

**Test first:**

1. Add failing BrowserView CRUD tests for owner isolation, viewer-owned personal views, validation, default view, and deleted column ids.
2. Add failing columns-drawer tests for add/hide/reorder/resize/reset and unit-aware labels.
3. Add failing view tests for save, rename, load, set default, and preserving filters/sort/selected experiments after reload.
4. Add failing compare-tray tests for add/remove/clear, duplicate prevention, persistent visibility, and opening selected rows in a comparison table.
5. Add failing accessibility tests for keyboard operation and focus return from both drawers.

**Implementation:**

1. Persist only personal display state in BrowserView payloads.
2. Keep the comparison tray visible while users search/filter; selected experiments remain selected even if filtered out.
3. Start comparison with a source-backed scalar table and series inventory. Actual comparison charts are out of scope.
4. Surface unit incompatibility in comparison rather than coercing values.
5. Restore focus and table width when drawers close.

**Verify:**

```bash
node --test backend/src/saas/routes/saasRoutes.test.js
npm test -- src/data/experimentBrowserApi.test.js src/components/ExperimentBrowser.test.jsx src/components/ExperimentColumnsDrawer.test.jsx src/components/ExperimentCompareTray.test.jsx
npm test
npm run build
git diff --check
```

**Commit:** `feat: save experiment views and comparisons`

## Milestone 7: Legacy Retirement And Golden Workflow

**Purpose:** Remove the obsolete DatasetCommit/generic import path only after the replacement is proven end to end.

**Files:**

- Delete: `src/components/GenericImportBrowser.jsx`
- Delete: `src/components/GenericImportBrowser.test.jsx`
- Delete: `src/data/experimentBrowserRows.js`
- Delete: `src/data/experimentBrowserRows.test.js`
- Delete or replace: `src/data/genericProposalState.js`
- Delete or replace: `src/data/genericProposalState.test.js`
- Modify: `src/main.jsx`
- Modify: `backend/src/saas/routes/saasRoutes.js`
- Modify: `backend/src/saas/memoryStore.js`
- Modify: `backend/src/saas/postgresStore.js`
- Create: `backend/migrations/011_drop_legacy_dataset_path.sql`
- Modify: project-state, chart, and manuscript tests that still assume `currentDatasetCommit`
- Modify: active docs and contracts
- Create: `doc/qa/workbook-to-experiment-browser.md`

**Test first:**

1. Add a golden fixture containing at least three experiments, scalar conditions/outcomes, one series, a blank row, one skipped row, and source-backed units.
2. Add backend integration coverage for upload/session -> accepted understanding -> draft -> publish -> reload -> Browser projection.
3. Add frontend workflow coverage for red-box selection -> correction -> structured preview -> confirm -> DataPlan preview -> publish -> Browser -> save view -> compare -> detail.
4. Add negative coverage proving the workflow creates no DatasetCommit, generic import, mapping set, chart proposal, ChartSpec, FigurePackage, or ManuscriptPlacement.
5. Run `rg` assertions for forbidden active-path references before deleting old files.

**Implementation:**

1. Remove `currentDatasetCommit` from active project hydration and project-state responses.
2. Remove DatasetCommit/generic import routes, store methods, helpers, fixtures, and UI that have no non-legacy caller.
3. Remove or disable old chart/manuscript routes that cannot operate without DatasetCommit. Do not silently rewire them; the later DataSnapshot-to-chart milestone will reintroduce those capabilities through reviewed snapshots.
4. Add `011_drop_legacy_dataset_path.sql` to remove DatasetCommit/generic import tables, columns, and foreign keys from an existing development database; clean the fresh-database baseline as needed. Remove local compatibility migrations and old blank-project dataset defaults.
5. Update README, START_HERE, architecture, API, schema, data dictionary, progress, and manual QA docs to the accepted Snapshot model.
6. Run the full golden workflow manually with a real workbook and record screenshots/observations in the QA document.

**Verify:**

```bash
rg -n "currentDatasetCommit|datasetCommits|genericImports|genericMappingSets|GenericImportBrowser|buildGenericBrowserRows" src backend/src
npm run codex:verify
node --test backend/src/saas/routes/saasRoutes.postgres.test.js
git diff --check
```

Expected `rg` matches after cleanup must be limited to explicit archive/deprecation tests or none. Record any intentional remainder in `doc/qa/workbook-to-experiment-browser.md`.

**Commit:** `refactor: retire legacy dataset browser path`

## End-To-End Acceptance Scenario

Use a real or golden workbook with at least three experiments.

1. Upload the workbook and land in the workbook workspace with the review dock open.
2. Select multiple red boxes, switch the active box, and describe one correction in natural language.
3. Verify the structured interpretation preview shows experiment axis, identity, fields, units, included/skipped rows, warnings, and exact source ranges.
4. Confirm WorkbookUnderstanding.
5. Open `Review extracted experiments` and verify three source-backed preview records.
6. Resolve any identity decision and publish once.
7. Reload the browser and verify exactly three Experiment Browser rows remain.
8. Verify recommended columns are meaningful and unit-aware; add, hide, reorder, and resize columns.
9. Save and reload a personal view.
10. Select experiments into the persistent comparison tray and inspect scalar differences without silent unit conversion.
11. Open row detail and verify fields, series points, warnings, and source refs.
12. Confirm through API/store assertions that no legacy or chart/manuscript artifacts were created.

## Completion Definition

The path is complete only when:

- accepted source evidence can be published and reloaded from Postgres;
- Browser rows derive solely from active accepted DataSnapshots;
- every displayed value resolves to source refs and immutable hashes;
- corrections create new immutable snapshots and only affected experiment heads advance;
- duplicate/ambiguous identities, stale previews, skipped rows, and incompatible units are reviewable;
- saved views and comparison state survive reload;
- legacy Browser and DatasetCommit/generic import active code is removed;
- targeted tests, full frontend/backend tests, build, diff check, browser QA, and optional Postgres verification are recorded.

## Deliberately Deferred

- DataSnapshot-to-chart proposal and ChartSpec creation.
- FigurePackage and manuscript insertion.
- Automatic unit conversion.
- Shared/team BrowserViews.
- AI-generated Browser views; deterministic recommendation and manual configuration ship first.
- Full workbook canvas/tile virtualization. The review grid receives only the focused continuity work needed for this path; large-workbook viewer replacement remains a separate milestone unless QA proves it blocks the golden workflow.
