# Current Milestone

Status: in progress
Read when: checking what the next implementation slice should be.
Last reviewed: 2026-07-20

This file tracks the active execution state. Keep `doc/plan.md` as the short roadmap, `doc/task-checklist.md` as the reusable execution checklist, and `doc/PROGRESS.md` as the completed-work log.

## Strategic Split

- Product mainline: Workbook Understanding First, ending in Experiment Browser.
- Engineering mainline: accepted WorkbookUnderstanding -> experiment-record DataPlan -> accepted DataSnapshot -> Browser projection.
- Current milestone: Backend conversational analysis and chart workflow implementation.

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
- The next architecture has been approved conversationally and written for review in `doc/plans/backend-conversational-analysis-chart-design.md`: backend intent routing, plan/revision review against Excel red boxes, exact accepted Python in a LabRat-managed sandbox, validated result review, atomic AnalysisResult/ChartSpec publication, and placement-local Canvas trace visibility.
- Conversational-analysis Task 1 is implemented: backend-only provider configuration, bounded intent routing, direct project answers, reviewed-analysis disposition for trends/calculations/charts, explicit-only Browser navigation, and removal of frontend provider credentials/direct calls.
- Conversational-analysis Task 2 is implemented: accepted-active-head analysis schemas and selection hashes, unit-aware field catalog, source rectangle compression/limits, plan validation, and a project-scoped six-tool planning registry with no executor.
- Conversational-analysis Task 3 is implemented: migration 012 plus memory/Postgres parity for AnalysisThreads, immutable AnalysisPlanRevisions, queued AnalysisRuns, reserved AnalysisResults/publication receipts, and atomic future result publication; project-scoped thread/revision/selection/accept routes; feedback-only backend redrafting; AgentRun creation of durable threads and first reviewable revisions; bounded state/list/selection responses; stale-head/hash rejection; and idempotent plan acceptance with no execution or ChartSpec side effect.
- Conversational-analysis Task 4 is implemented: authenticated frontend analysis helpers; normal LabRat analysis-plan cards; a persistent Source/Result/Chart review workspace with Excel-backed non-contiguous red source rectangles; readable coverage, warnings, revision history, and exact Python; a split Accept/modify composer; immutable feedback revisions; exact-hash acceptance; current-revision recovery when reopening stale conversation cards; and responsive desktop/mobile layouts. Result and Chart remain disabled until later milestones.
- Conversational-analysis Task 5 is implemented: versioned Python policy and runner checks; canonical frozen execution packages; production-disabled local execution with a hardened-worker adapter; transactional active-head verification; claim-token lease recovery; finite/schema/id/identity/lineage/unit/input-accounting/missing-policy/limit/invariant validation; immutable awaiting-review AnalysisResult persistence only for valid output; independently paged result/evidence previews; replay-safe execute routes; and exact-result-hash feedback replanning. No ChartSpec is created.

Not implemented yet:

- Accepted DataSnapshot-backed chart proposal/ChartSpec planning.
- Frontend analysis-result review and accepted-result ChartSpec publication.

## Next Recommended Slice

Continue `doc/plans/backend-conversational-analysis-chart-implementation-plan.md` with Task 6:

1. Load result summaries and bounded preview pages into the existing Analysis Review workspace.
2. Show values/traces, exclusions, validation, lineage, and execution warnings before result acceptance.
3. Keep Accept and modify-feedback actions inside the LabRat split composer; feedback creates a later immutable plan revision.

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

Latest Task 4 evidence: targeted frontend analysis/API/workspace/AgentPanel coverage passed 51/51 and the production build succeeded with the existing Plotly chunk-size warning. Browser QA used only repository-owned synthetic workbook data plus a local deterministic provider stub; it confirmed analysis routing, two non-contiguous source rectangles, red-cell focus, feedback revision supersession, exact-plan acceptance/queueing, stale-card recovery, desktop split geometry, mobile stacked geometry, and no page-level horizontal overflow. No external provider received QA data.

Latest Task 5 evidence: full frontend passed 222/222, full backend passed 223 with 1 optional Postgres integration skip, and the production build succeeded with the existing Plotly chunk-size warning. Focused executor/policy/result-validator/analysis-thread/route tests, an actual local-runner smoke check, and Python runner/JavaScript syntax checks passed. Local execution remains a development adapter; production requires an external hardened worker.

## Open Risks

- The worktree contains substantial existing changes from prior milestones; do not revert or restage unrelated files.
- Large workbook reads now use stable cached tiles, but the current grid still renders the complete selected row/column DOM with React Data Grid virtualization disabled; very large selected ranges still need a dedicated rendering architecture later.
- DataSnapshot-to-chart work must define unit, series, selection, and staleness rules rather than reuse removed contracts.
- The LabRat-managed arbitrary Python runtime is the largest new security and operations risk; implementation must not use an unrestricted subprocess as a production sandbox.
- Existing source-evidence chart flows must remain intact while the new chart path is added.
- Local in-memory backend development intentionally does not auto-reload; restart `npm --prefix backend run dev` after backend source edits so sessions are not silently discarded.
