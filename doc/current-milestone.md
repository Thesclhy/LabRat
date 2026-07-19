# Current Milestone

Status: completed
Read when: checking what the next implementation slice should be.
Last reviewed: 2026-07-19

This file tracks the active execution state. Keep `doc/plan.md` as the short roadmap, `doc/task-checklist.md` as the reusable execution checklist, and `doc/PROGRESS.md` as the completed-work log.

## Strategic Split

- Product mainline: Workbook Understanding First, ending in Experiment Browser.
- Engineering mainline: accepted WorkbookUnderstanding -> experiment-record DataPlan -> accepted DataSnapshot -> Browser projection.
- Current milestone: Milestone 7 Legacy Retirement and Golden Workflow completed.

## Current Position

Implemented:

- Workbook Understanding MVP: uploaded workbooks become SourceDocument evidence, WorkbookReviewSession review state, draft red boxes, natural-language revisions, and accepted WorkbookUnderstanding records.
- Tool-Governed Evidence Retrieval MVP: `POST /api/projects/:projectId/evidence/retrieve` returns usable accepted WorkbookUnderstanding evidence and marks unconfirmed suggestions as not DataPlan-ready.
- Transient DataPlan Agent Phase 1-2: DataPlan/DataSnapshot schemas, backend DataPlan tools, deterministic DataSnapshot preview execution, fallback DataPlan agent orchestration, `POST /api/projects/:projectId/data-plans/draft`, frontend `draftServerProjectDataPlan()`, and route/helper/unit coverage.
- DataPlan identity bulk review: users can create all unmatched experiments, accept unique exact matches, apply selected-row actions, filter by decision state, inspect totals, and undo the latest batch while create/reuse remains explicit and publish-gated; reusable identities match and display their canonical labels.
- WorkbookReviewWorkspace stable tile loading: 40-row by 12-column SourceDocument windows stay below 500 cells, scroll changes are frame-coalesced and settled before reads, one directional tile is prefetched, fulfilled/pending requests share an LRU cache, loaded cells remain visible when another tile loads, and document/Sheet/range changes reset the real grid while adopting the selected workbook's own range.
- Target architecture and milestone sequence are approved in `doc/plans/workbook-review-to-experiment-browser-plan.md`.
- Milestone 0 contract cutover: active API/schema/data/architecture/AI contracts now define the Snapshot-backed Browser path and mark DatasetCommit/generic imports deprecated.
- Workbook source range race fix: late detected-region responses no longer overwrite a manual range entered while loading.
- Milestone 1 continuous workbook review: the conversation, red-box list, revisions, clarification, and confirmation stay docked beside the mounted workbook grid; detected regions seed stable drafts; Project Overview can reopen the latest session; confirmation remains in place and exposes `Review extracted experiments`.
- Milestone 2 structured WorkbookUnderstanding interpretation: bounded backend reads propose experiment axis, identity, fields, units, inclusion, series, warnings, and source refs; conversational and structured corrections share validated typed patches; unresolved identity/unit decisions block confirmation; accepted semantics become read-only.
- Milestone 3 experiment-record DataPlan preview: accepted evidence compiles into deterministic row- or region-oriented records with typed values, canonical hashes, explicit identity decisions, bounded SourceDocument reads, visible warnings/source refs, and a transient review panel without Browser mutation.
- Milestone 4 transactional publish: migration/store parity, backend evidence re-read and deterministic re-execution, mandatory idempotency, stale-preview recovery, atomic accepted DataPlan/DataSnapshot plus identity/head persistence, audit receipts, editor authorization, and a locked frontend success state.
- Milestone 5 Snapshot-backed Experiment Browser: accepted-snapshot/head-only projection, project-isolated list/detail APIs, deterministic unit-aware recommended columns, cursor pagination, typed search/filter/sort, virtualized rows, lazy detail, selection, and read-only source evidence navigation.
- Milestone 6 saved views and comparison: owner-isolated personal BrowserView CRUD, complete column configuration, default/load/save/rename/delete controls, persistent cross-query selection, and a lazy source-backed scalar/series comparison table without unit coercion.
- Milestone 7 legacy retirement and golden workflow: removed aggregate dataset/mapping/analysis/observation stores, routes, helpers, and UI contracts; removed unscoped normalize/semantic-map/generic chart endpoints; added migration 011; made ChartSpec validation/rendering source-only; added golden workbook upload-review-draft-publish-reload-Browser coverage; retained source-backed chart/Manuscript workflows; accepted natural-language documentation exclusion; and stabilized local in-memory development sessions by running the backend without file-watch restarts.
- Post-milestone regression hardening: direct project-content summaries no longer create confirmation-gated Browser actions while explicit upload/chart intent keeps priority; accepted review cards report accepted/published state and open the selected pending/accepted session; Ctrl/Meta workbook range selection supports additive/toggle behavior; Experiment Browser uses one horizontal scroll owner; and grouped two-row workbook headers preserve all child fields plus parent/leaf header provenance through publish and Browser projection.

Not implemented yet:

- Accepted DataSnapshot-backed chart proposal/ChartSpec planning.

## Next Recommended Slice

Define the next milestone around accepted DataSnapshot-backed chart planning:

1. Start from Browser-selected experiment ids and stable field/series ids.
2. Resolve active snapshot heads and validate unit compatibility/source refs server-side.
3. Return a reviewable chart proposal without mutating accepted data.
4. Compile accepted proposals into a ChartSpec form that shares rendering/layout behavior with source-backed specs.
5. Keep unsupported requests explicit until this contract is implemented.

## Guardrails

- DataPlan inputs must come from accepted WorkbookUnderstanding evidence and backend-owned SourceDocument reads.
- DataPlan/DataSnapshot persistence must not create ChartSpecs, chart proposals, FigurePackages, or manuscript placements.
- DataSnapshot values must be read deterministically from SourceDocument index/range data.
- Experiment aliases must resolve to an explicit create/reuse decision; no silent merge is allowed.
- Fields with incompatible units remain separate unless a reviewed conversion operation exists.
- Wrong experiment aliases must return clarification or validation errors, not another experiment's data.

## Verification Target

Milestone 7 completion verification:

```bash
rg -n "currentDatasetCommit|datasetCommits|genericImports|genericMappingSets|GenericImportBrowser|buildGenericBrowserRows" src backend/src
npm run codex:verify
node --test backend/src/saas/routes/saasRoutes.postgres.test.js
git diff --check
```

Latest local evidence: frontend 211/211, backend 150 passed plus 1 optional Postgres skip, and production build passed. Browser QA confirmed direct Chinese project summaries, accepted-review Overview state, grouped Selectivity Solid/Liquid/Gas fields with exact values, one horizontal Browser scroll owner, no page overflow, and no browser warnings/errors. The earlier 600-cell workbook QA also confirmed horizontal tile loading, local skeleton state, instant return to cached cells without another loading state, and stable workbook switching. Identity bulk review retains focused 60-item, canonical-label reuse, exact-match, selection, filter, undo, reset, and publish-gating coverage.

## Open Risks

- The worktree contains substantial existing changes from prior milestones; do not revert or restage unrelated files.
- Large workbook reads now use stable cached tiles, but the current grid still renders the complete selected row/column DOM with React Data Grid virtualization disabled; very large selected ranges still need a dedicated rendering architecture later.
- DataSnapshot-to-chart work must define unit, series, selection, and staleness rules rather than reuse removed contracts.
- Existing source-evidence chart flows must remain intact while the new chart path is added.
- Local in-memory backend development intentionally does not auto-reload; restart `npm --prefix backend run dev` after backend source edits so sessions are not silently discarded.
