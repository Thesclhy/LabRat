# Current Milestone

Status: in progress
Read when: checking what the next implementation slice should be.
Last reviewed: 2026-07-22

This file tracks the active execution state. Keep `doc/plan.md` as the short roadmap, `doc/task-checklist.md` as the reusable execution checklist, and `doc/PROGRESS.md` as the completed-work log.

## Strategic Split

- Product mainline: Workbook Understanding First, ending in Experiment Browser.
- Engineering mainline: accepted RegionUnderstandingRevisions -> experiment-record DataPlan -> accepted DataSnapshot -> Browser projection.
- Completed milestone: Backend conversational analysis and chart workflow implementation.
- Completed milestone: progressive full-sheet workbook loading and
  checkbox-controlled selection highlights.

## Completed Milestone

The approved region-level Workbook Understanding cutover documented
in `doc/plans/workbook-region-understanding-redesign-design.md` and
`doc/plans/workbook-region-understanding-redesign-implementation-plan.md`.
WorkbookReviewSession remains the Excel container; independently versioned and
confirmed region understandings replace aggregate WorkbookUnderstanding
acceptance. Implementation now includes bounded backend model interpretation,
per-region revise/confirm/ignore/logical-delete APIs, accepted-region DataPlan
dependencies, the simplified review dock, legacy contract retirement, and the
golden workbook-to-Browser workflow. Full automated verification plus desktop
and 390x844 browser QA now cover the integrated upload/review/publish path.

## Current Position

Active milestone: real DataSnapshot-to-ChartSpec frontend closure. Backend
capability/retry APIs, development-only local execution configuration,
fail-closed frontend runtime gates, and AnalysisPlan structured output are
implemented. Retry now has durable memory/PostgreSQL idempotency receipts and
six-minute abandoned-claim recovery. Full verification passes with frontend
263/263 and backend 245 passed plus one optional PostgreSQL skip. A fresh
63-head local Python/persistence diagnostic also passes with 57 result rows, 6
reasoned exclusions, 3 traces, one reloaded ChartSpec, 63 input snapshot refs,
and 184 source refs. The real Anthropic plus local-Python browser run is now
recorded: 4 plan revisions and 3 execution attempts eventually produced 57
validated rows, 6 exclusions, 3 traces, and one reloaded ChartSpec from all 63
heads. The acceptance gate remains open because `Manage approved charts`
cannot display the persisted analysis-result ChartSpec and the Manuscript
insertion preview and Canvas render blank despite the Chart Review preview
rendering correctly.

Implemented:

- Region-level Workbook Understanding: WorkbookReviewSession groups one workbook; stable WorkbookReviewRegions and immutable RegionUnderstandingRevisions independently support bounded backend AI summaries, feedback revisions, exact confirmation, ignore, and logical delete.
- Tool-Governed Evidence Retrieval MVP: `POST /api/projects/:projectId/evidence/retrieve` returns usable active accepted RegionUnderstandingRevision evidence and marks unconfirmed suggestions as not DataPlan-ready.
- Transient DataPlan Agent Phase 1-2: DataPlan/DataSnapshot schemas, backend DataPlan tools, deterministic DataSnapshot preview execution, fallback DataPlan agent orchestration, `POST /api/projects/:projectId/data-plans/draft`, frontend `draftServerProjectDataPlan()`, and route/helper/unit coverage.
- DataPlan identity bulk review: users can create all unmatched experiments, accept unique exact matches, apply selected-row actions, filter by decision state, inspect totals, and undo the latest batch while create/reuse remains explicit and publish-gated; reusable identities match and display their canonical labels.
- WorkbookReviewWorkspace full-sheet loading: the complete current-sheet
  `usedRange` is enumerated into 40-row by 12-column SourceDocument windows
  below 500 cells; visible tiles load first and three background workers fill
  the rest. Per-sheet normalized cell/completion caches retain loaded and empty
  tiles across navigation, stale responses stay isolated, failed ranges can be
  retried without re-reading successful tiles, and toolbar progress reports the
  exact loaded tile count. The active region card alone controls the blue
  highlight; ordinary drag and Ctrl/Command drag create new server regions
  without cancelling or deleting prior region records.
- Target architecture and milestone sequence are approved in `doc/plans/workbook-review-to-experiment-browser-plan.md`.
- Milestone 0 contract cutover: active API/schema/data/architecture/AI contracts now define the Snapshot-backed Browser path and mark DatasetCommit/generic imports deprecated.
- Workbook source range race fix: late detected-region responses no longer overwrite a manual range entered while loading.
- Region redesign Tasks 1-8: migration/store parity, bounded backend interpretation, nested region APIs, upload-time candidate seeding, exact accepted-revision evidence/DataPlan dependencies, compact independent region cards, region-level Overview status, aggregate WorkbookUnderstanding retirement, contract reconciliation, full verification, and browser QA are complete.
- Milestone 3 experiment-record DataPlan preview: accepted evidence compiles into deterministic row- or region-oriented records with typed values, canonical hashes, explicit identity decisions, bounded SourceDocument reads, visible warnings/source refs, and a transient review panel without Browser mutation.
- Milestone 4 transactional publish: migration/store parity, backend evidence re-read and deterministic re-execution, mandatory idempotency, stale-preview recovery, atomic accepted DataPlan/DataSnapshot plus identity/head persistence, audit receipts, editor authorization, and a locked frontend success state.
- Milestone 5 Snapshot-backed Experiment Browser: accepted-snapshot/head-only projection, project-isolated list/detail APIs, deterministic unit-aware recommended columns, cursor pagination, typed search/filter/sort, virtualized rows, lazy detail, selection, and read-only source evidence navigation.
- Milestone 6 saved views and comparison: owner-isolated personal BrowserView CRUD, complete column configuration, default/load/save/rename/delete controls, persistent cross-query selection, and a lazy source-backed scalar/series comparison table without unit coercion.
- Milestone 7 legacy retirement and golden workflow: removed aggregate dataset/mapping/analysis/observation stores, routes, helpers, and UI contracts; removed unscoped normalize/semantic-map/generic chart endpoints; added migration 011; made ChartSpec validation/rendering source-only; added golden workbook upload-review-draft-publish-reload-Browser coverage; retained source-backed chart/Manuscript workflows; accepted natural-language documentation exclusion; and stabilized local in-memory development sessions by running the backend without file-watch restarts.
- Post-milestone regression hardening: direct project-content summaries no longer create confirmation-gated Browser actions while explicit upload/chart intent keeps priority; Project Overview reports pending/confirmed regions and opens the session containing the latest pending region; Ctrl/Meta selection adds without cancellation; Experiment Browser uses one horizontal scroll owner; and grouped two-row workbook headers preserve all child fields plus parent/leaf header provenance through publish and Browser projection.
- The next architecture has been approved conversationally and written for review in `doc/plans/backend-conversational-analysis-chart-design.md`: backend intent routing, plan/revision review against Excel red boxes, exact accepted Python in a LabRat-managed sandbox, validated result review, atomic AnalysisResult/ChartSpec publication, and placement-local Canvas trace visibility.
- Conversational-analysis Task 1 is implemented: backend-only provider configuration, bounded intent routing, direct project answers, reviewed-analysis disposition for trends/calculations/charts, explicit-only Browser navigation, and removal of frontend provider credentials/direct calls.
- Conversational-analysis Task 2 is implemented: accepted-active-head analysis schemas and selection hashes, unit-aware field catalog, source rectangle compression/limits, plan validation, and a project-scoped six-tool planning registry with no executor.
- Conversational-analysis Task 3 is implemented: migration 012 plus memory/Postgres parity for AnalysisThreads, immutable AnalysisPlanRevisions, queued AnalysisRuns, reserved AnalysisResults/publication receipts, and atomic future result publication; project-scoped thread/revision/selection/accept routes; feedback-only backend redrafting; AgentRun creation of durable threads and first reviewable revisions; bounded state/list/selection responses; stale-head/hash rejection; and idempotent plan acceptance with no execution or ChartSpec side effect.
- Conversational-analysis Task 4 is implemented: authenticated frontend analysis helpers; normal LabRat analysis-plan cards; a persistent Source/Result/Chart review workspace with Excel-backed non-contiguous red source rectangles; readable coverage, warnings, revision history, and exact Python; a split Accept/modify composer; immutable feedback revisions; exact-hash acceptance; current-revision recovery when reopening stale conversation cards; and responsive desktop/mobile layouts. Result and Chart remain disabled until later milestones.
- Conversational-analysis Task 5 is implemented: versioned Python policy and runner checks; canonical frozen execution packages; production-disabled local execution with a hardened-worker adapter; transactional active-head verification; claim-token lease recovery; finite/schema/id/identity/lineage/unit/input-accounting/missing-policy/limit/invariant validation; immutable awaiting-review AnalysisResult persistence only for valid output; independently paged result/evidence previews; replay-safe execute routes; and exact-result-hash feedback replanning. No ChartSpec is created.
- Conversational-analysis Task 6 is implemented: exact run/result/preview identity binding; complete paged trace loading; Source/Result/Chart review tabs; validated values, exclusions, missing policy, warnings, invariants, hashes, per-row lineage and source navigation; independently paged evidence; unit-compatible chart panels; default-visible trace selection; stale async response protection; historical result rehydration; and exact-result-hash feedback to later immutable plan revisions. Real acceptance remains disabled until Task 7 provides the atomic publication route.
- Conversational-analysis Task 7 is implemented: strict analysis-result ChartSpec v2 validation; exact result/default-trace acceptance; active-head rechecks inside one idempotent memory/Postgres transaction; acceptance-only result mutation; run/thread completion; complete immutable trace catalogs with accepted snapshot refs and lineage; bounded project/list metadata plus full detail reads; editor-only publication; real Analysis Review wiring; and shared rendering with local trace filtering and unit-safe axes.
- Conversational-analysis Task 8 is implemented: one trace-aware chart-view normalizer migrates legacy source experiment filters into stable trace ids and applies reviewed analysis defaults; Manuscript insertion lazy-loads full ChartSpec details before snapshotting; insertion, reload, chart context, Canvas rendering, and PPTX export all use placement-local `visibleTraceIds`; the selected-chart inspector provides searchable trace toggles, counts, Select all, and Clear; duplicate placements remain independent through undo/redo; and source-backed ChartSpecs remain compatible.
- Conversational-analysis Task 9 is implemented: a real grouped-header workbook golden route test now covers accepted experiment publication, natural-language analysis routing, feedback revision 2, exact-plan execution, invariant-validated normalized selectivity, atomic ChartSpec publication, reload, and complete source lineage without legacy artifacts. A stateful frontend golden test covers LabRat plan review through result acceptance and Manuscript trace filtering. Active contracts now describe both ChartSpec origins and the backend-only provider/executor boundary. Browser QA confirmed direct project answers, exact `Sheet1!L3:N4` red cells, no execution before revision acceptance, validated 2-input/2-output results, two default-visible experiment traces, one atomic chart, independent 2/2 and 1/2 Manuscript placements after reload, responsive review layouts, and no new console errors. Reloaded Manuscript blocks now render from their immutable complete snapshots, selected-chart context no longer loops when project summaries are recreated, and chart-review title/legend spacing is stable.

Deployment work not included in this completed milestone:

- Production analysis execution still requires an external hardened no-network worker and deployment-managed provider credentials.
- Optional MCP access remains a future adapter over the same backend tools and review state; it is not required for the first-party workflow.

## Next Recommended Slice

1. Execute
   `doc/plans/datasnapshot-to-chartspec-frontend-closure-plan.md`: use the local
   Python adapter only in development, expose backend model/executor readiness,
   add `Retry with published data`, and pass the complete real Anthropic plus
   local-Python workflow against all 63 active `test1` experiment heads before
   declaring the frontend analysis path complete.
2. Implement the approved chat workbook file-entry design in
   `doc/plans/chat-workbook-file-entry-design.md`: one filename button per
   upload, exact WorkbookReviewSession reload on click, and no region-button
   duplication in chat.
3. Exercise migrations 013/014 and the region-to-DataPlan path against a configured Postgres test database.
4. Operationalize the hardened analysis worker, secret management, timeouts, audit telemetry, and provider cost/latency monitoring in a production-like environment.

## Guardrails

- DataPlan inputs must come from exact active accepted RegionUnderstandingRevisions and backend-owned SourceDocument reads.
- DataPlan/DataSnapshot persistence must not create ChartSpecs, chart proposals, FigurePackages, or manuscript placements.
- DataSnapshot values must be read deterministically from SourceDocument index/range data.
- Experiment aliases must resolve to an explicit create/reuse decision; no silent merge is allowed.
- Fields with incompatible units remain separate unless a reviewed conversion operation exists.
- Wrong experiment aliases must return clarification or validation errors, not another experiment's data.

## Verification Target

Region-understanding milestone completion verification:

```bash
npm run codex:verify
node --test backend/src/saas/routes/saasRoutes.postgres.test.js
git diff --check
rg -n "workbookUnderstandingIds|workbookUnderstandingId|workbook_understandings|current_understanding" src backend/src
```

Latest Task 4 evidence: targeted frontend analysis/API/workspace/AgentPanel coverage passed 51/51 and the production build succeeded with the existing Plotly chunk-size warning. Browser QA used only repository-owned synthetic workbook data plus a local deterministic provider stub; it confirmed analysis routing, two non-contiguous source rectangles, red-cell focus, feedback revision supersession, exact-plan acceptance/queueing, stale-card recovery, desktop split geometry, mobile stacked geometry, and no page-level horizontal overflow. No external provider received QA data.

Latest Task 5 evidence: full frontend passed 222/222, full backend passed 223 with 1 optional Postgres integration skip, and the production build succeeded with the existing Plotly chunk-size warning. Focused executor/policy/result-validator/analysis-thread/route tests, an actual local-runner smoke check, and Python runner/JavaScript syntax checks passed. Local execution remains a development adapter; production requires an external hardened worker.

Latest Task 6 evidence: focused result-workspace edge coverage passed 14/14, related frontend API/workspace/conversation/ProjectDashboard coverage passed 63/63, and the production build succeeded with the existing Plotly chunk-size warning. The result view covers complete trace pagination, mismatched preview hashes, evidence pagination, earlier-run rehydration, exclusions, warnings, lineage, and incompatible units.

Latest Task 7 evidence: full verification passed with frontend 239/239, backend 229 passed plus 1 optional Postgres integration skip, and a successful production build with the existing Plotly chunk-size warning. Focused publication/store/route coverage passed 43 backend tests and API/workspace/rendering/project coverage passed 87 frontend tests after transaction and bounded-list hardening.

Latest Task 8 evidence: focused chart-view/renderer/Canvas/export/ProjectDashboard coverage passed 100/100, full frontend passed 247/247, JavaScript syntax and diff checks passed, and the production build succeeded with the existing Plotly chunk-size warning. Tests cover legacy source-view migration, reviewed analysis defaults, explicit empty views, duplicate placement independence through undo/redo, bounded LabRat context, full-detail lazy insertion, immutable snapshot retention, source and analysis export filtering, and source-backed rendering compatibility.

Latest Task 9 evidence: the grouped-header backend golden workflow passed through one trace-complete `origin: analysis_result` ChartSpec with exact source lineage. Frontend passed 250/250 with Vitest capped at four workers for repeatable Windows execution; backend passed 230 with 1 optional Postgres integration skip; the production build succeeded with the existing Plotly chunk-size warning. Desktop and 390x844 browser QA covered direct answers, reviewed plan revision, red source cells, validated result review, chart publication, duplicate Manuscript placements, reload persistence, mobile stacking, and console stability. PPTX placement filtering remains covered by automated export tests.

Latest full-sheet Workbook Review evidence: frontend passed 262/262,
backend passed 230 with 1 optional Postgres integration skip, and the production
build succeeded with the existing Plotly chunk-size warning. Browser QA on a
real two-sheet review confirmed visible-first completion at 14/14 and 21/21
ranges, immediate cached return, checkbox-only blue highlights, focus/selection
independence, ordinary drag replacement, Ctrl addition, and Ctrl toggle
removal. Frozen-request tests additionally verify that background hydration
waits for visible cells, never exceeds three workers, and starts a newly
selected Sheet from its top tile.

Latest region-understanding evidence: Tasks 1-8 are complete. Full verification
passed with frontend 252/252 and backend 234 passed plus 1 optional PostgreSQL
integration skip; the production build succeeded with the existing Plotly
chunk-size warning. Browser QA used the repository-owned two-sheet synthetic
master workbook and a local deterministic provider stub: it revised and
confirmed `Runs!A1:K5`, ignored README, bulk-created four identities, published
Exp28-Exp31, reloaded state, and verified Solid/Liquid/Gas fields in Browser.
QA found and fixed initial active-region sheet mismatch and page-level overflow
at 390x844; clean-page console verification reported no errors or warnings.

## Open Risks

- The worktree contains substantial existing changes from prior milestones; do not revert or restage unrelated files.
- Large workbook reads now hydrate and cache the complete current-sheet
  `usedRange`, but the grid still renders that complete row/column DOM with
  React Data Grid virtualization disabled; unusually large sheets still need a
  dedicated rendering architecture.
- DataSnapshot-to-chart work must define unit, series, selection, and staleness rules rather than reuse removed contracts.
- The LabRat-managed arbitrary Python runtime remains the largest security and operations risk; the local subprocess adapter is development-only and production must use the hardened worker contract.
- Existing source-evidence chart flows must remain intact while the new chart path is added.
- Local in-memory backend development intentionally does not auto-reload; restart `npm --prefix backend run dev` after backend source edits so sessions are not silently discarded.
