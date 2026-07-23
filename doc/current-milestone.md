# Current Milestone

Status: complete
Read when: checking what the next implementation slice should be.
Last reviewed: 2026-07-23

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

Completed milestone: real-provider E2E for the new confirmed-region analysis
chain. Workbook upload/region understanding, read-only project Q&A, and
reviewed analysis/chart planning share one backend AgentRun entrypoint.
Analysis planning now uses only active accepted RegionUnderstandingRevisions:
the model pages through confirmed regions, chooses one or more exact workbook
ranges, and persists only `sourceSelections`, structured review meaning, and
readable display steps. After acceptance, the backend materializes one Python
input table per selection, then asks the model to generate Python against that
real input. The executor returns authoritative Plotly, which is checked for
safety, structure, limits, source ownership, and only explicitly reviewed
calculation invariants. Whole-series constraints use `trace_y_sum`; stacked
component normalization at every shared X category uses `x_group_y_sum`.

The field-mapping AnalysisSelection registry, aggregate 500-cell analysis
limit, pre-acceptance Python, result-table/lineage UI, and user-facing hash
review are retired. ChartSpec v3 stores complete Plotly and a flat curve
catalog. Source/Result review, ChartSpec detail loading, Canvas reload, and PPTX
export all honor each Canvas block's independent `visibleTraceIds`. Automated
verification passes with frontend 243/243 and backend 203 passed plus one
optional PostgreSQL skip; production still requires a hardened external
executor. A real Anthropic plus local-Python browser run selected two
non-contiguous workbook ranges as two input tables, generated and validated a
12-point/three-series chart, published ChartSpec v3, and preserved independent
2/3 versus 3/3 Canvas curve visibility across save and reload.

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
- The reviewed-analysis architecture is implemented: backend intent routing,
  exact confirmed-range red-box review, post-acceptance Python from real input,
  validated Plotly result review, atomic ChartSpec v3 publication, and
  placement-local Canvas curve visibility.
- Conversational-analysis Task 1 is implemented: backend-only provider configuration, bounded intent routing, direct project answers, reviewed-analysis disposition for trends/calculations/charts, explicit-only Browser navigation, and removal of frontend provider credentials/direct calls.
- Conversational-analysis Tasks 2-7 are superseded by the current v2/v3
  contracts: exact confirmed source selections, review-only PlanRevisions,
  post-acceptance Python, authoritative validated Plotly, result-id
  publication, and flat curve catalogs.
- Conversational-analysis Task 8 is implemented: one trace-aware chart-view normalizer applies reviewed analysis defaults; Manuscript insertion lazy-loads full ChartSpec details before snapshotting; insertion, reload, chart context, Canvas rendering, and PPTX export all use placement-local `visibleTraceIds`; the selected-chart inspector provides searchable trace toggles, counts, Select all, and Clear; duplicate placements remain independent through undo/redo.
- Conversational-analysis Task 9 is implemented: a real grouped-header workbook golden route test covers accepted experiment publication, natural-language analysis routing, feedback revision 2, exact-plan execution, invariant-validated normalized selectivity, atomic analysis-result ChartSpec publication, reload, and complete source lineage without legacy artifacts. A stateful frontend golden test covers LabRat plan review through result acceptance and Manuscript trace filtering.
- Unified chart cutover is implemented: all natural-language and explicit-range chart requests use confirmed region and/or active DataSnapshot evidence through the reviewed analysis state machine. SourceExtractProposal, ChartProposalSet, direct chart interpretation, AgentRun confirmation cards, and sourceSnapshot render compatibility are retired.
- Chat workbook file entry is implemented: one upload creates one serializable
  filename link, clicking it reloads the exact WorkbookReviewSession, and
  Workbook Review remains the only region-level control surface.
- Reviewed record ordering is shared by result validation and ChartSpec
  publication, keeping result rows, trace lineage, and input snapshot refs in
  the accepted natural-label or workbook-index order.

Deployment work not included in this completed milestone:

- Production analysis execution still requires an external hardened no-network worker and deployment-managed provider credentials.
- Optional MCP access remains a future adapter over the same backend tools and review state; it is not required for the first-party workflow.

## Next Recommended Slice

1. Exercise migrations 013/014/016/017 and the region-to-DataPlan plus
   reviewed-analysis paths against a configured Postgres test database.
2. Operationalize the hardened analysis worker, secret management, timeouts,
   audit telemetry, and provider cost/latency monitoring in a production-like
   environment.

## Guardrails

- DataPlan inputs must come from exact active accepted RegionUnderstandingRevisions and backend-owned SourceDocument reads.
- DataPlan/DataSnapshot persistence must not create ChartSpecs, FigurePackages, or manuscript placements.
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
```

Latest Task 4 evidence: targeted frontend analysis/API/workspace/AgentPanel coverage passed 51/51 and the production build succeeded with the existing Plotly chunk-size warning. Browser QA used only repository-owned synthetic workbook data plus a local deterministic provider stub; it confirmed analysis routing, two non-contiguous source rectangles, red-cell focus, feedback revision supersession, exact-plan acceptance/queueing, stale-card recovery, desktop split geometry, mobile stacked geometry, and no page-level horizontal overflow. No external provider received QA data.

Latest Task 5 evidence: full frontend passed 222/222, full backend passed 223 with 1 optional Postgres integration skip, and the production build succeeded with the existing Plotly chunk-size warning. Focused executor/policy/result-validator/analysis-thread/route tests, an actual local-runner smoke check, and Python runner/JavaScript syntax checks passed. Local execution remains a development adapter; production requires an external hardened worker.

Latest Task 6 evidence: focused result-workspace edge coverage passed 14/14, related frontend API/workspace/conversation/ProjectDashboard coverage passed 63/63, and the production build succeeded with the existing Plotly chunk-size warning. The result view covers complete trace pagination, mismatched preview hashes, evidence pagination, earlier-run rehydration, exclusions, warnings, lineage, and incompatible units.

Latest Task 7 evidence: full verification passed with frontend 239/239, backend 229 passed plus 1 optional Postgres integration skip, and a successful production build with the existing Plotly chunk-size warning. Focused publication/store/route coverage passed 43 backend tests and API/workspace/rendering/project coverage passed 87 frontend tests after transaction and bounded-list hardening.

Latest Task 8 evidence: focused chart-view/renderer/Canvas/export/ProjectDashboard coverage passed 100/100, full frontend passed 247/247, JavaScript syntax and diff checks passed, and the production build succeeded with the existing Plotly chunk-size warning. That checkpoint covered both source and analysis renderers; the later unified cutover removed source-view migration and source-backed rendering compatibility.

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
- The LabRat-managed arbitrary Python runtime remains the largest security and operations risk; the local subprocess adapter is development-only and production must use the hardened worker contract.
- Retired SourceExtractProposal, ChartProposalSet, direct chart interpretation,
  and sourceSnapshot rendering routes must remain absent rather than returning
  as compatibility paths.
- Local in-memory backend development intentionally does not auto-reload; restart `npm --prefix backend run dev` after backend source edits so sessions are not silently discarded.
