# Current Development Plan

Status: active
Read when: deciding what LabRat should build next.
Last reviewed: 2026-08-01

This is the short active plan. Current execution status lives in `doc/current-milestone.md`; detailed implementation plans live under `doc/plans/`.

## Current Focus

LabRat's product direction remains Workbook Understanding First:

```text
Upload workbook
  -> SourceDocument / deterministic workbook index
  -> WorkbookReviewSession
  -> backend-LLM-drafted + backend-validated region revisions
  -> user independently confirms/corrects/ignores/deletes each region
  -> accepted RegionUnderstandingRevisions
  -> natural-language Experiment Browser AnalysisThread
  -> reviewed workbook and/or active-experiment selections and readable data-change plan
  -> onboarding direct-source mapping or general post-acceptance Python
     against real workbook/snapshot inputs
  -> reviewed list-column Browser preview
  -> explicit Publish to Browser as DataSnapshot v4
  -> Experiment Browser
```

Uploading Excel defaults to evidence indexing and region understanding only. It does not publish accepted records, create a ChartSpec, or insert manuscript content. SourceExtractProposal and ChartProposalSet are retired and must not be recreated.

The first complete product target is reviewed and sustainably editable data in
Experiment Browser. LabRat may select exact accepted workbook ranges, active
experiment fields, or both. The user reviews only sources and a natural-language
plan. Direct workbook fields inherit their stable metadata from accepted region
understanding only as input hints. After acceptance, Python sees ordered real
input lists and returns `columns[]` plus source-backed values addressed by
zero-based `columnIndex`. The backend validates the values, assigns each output
column one random internal `columnId`, merges complete frozen active records,
previews the Browser table, and atomically publishes an immutable DataSnapshot
v4 plus a new BrowserView. Unmentioned fields and series are preserved.

Pristine-project onboarding explicitly requests the backend-owned
`direct_source_mapping` strategy after plan acceptance. It compiles the exact
accepted RegionUnderstandingRevision row axis, identifier, inclusion rules,
field metadata, and materialized cells into the normal record-patch contract;
it makes no code-generation provider call and adds no eligibility-model step.
General Experiment Browser calculations, reshaping, active-snapshot work, and
future external-file linking retain model-generated Python.

The obsolete aggregate dataset/generic import implementation has been removed. No legacy local-data migration or dual-write path is required.

Use this split when deciding what to build:

- Product mainline: Workbook Understanding First, ending in Experiment Browser.
- Engineering mainline: accepted regions/active snapshots -> AnalysisThread
  `outputTarget: experiment_browser` -> list-column patches -> DataSnapshot v4 ->
  Browser projection.
- Completed execution milestone: backend conversational analysis, reviewed calculation, analysis-result ChartSpec publication, and placement-local trace visibility.

## Recently Completed

- Sustainable natural-language Experiment Browser publication: AnalysisThread
  now supports `outputTarget: experiment_browser`, mixed workbook and active
  snapshot selections, ordered list inputs, post-acceptance Python,
  source-validated field/series
  patches, complete-record merge previews, automated identity suggestions,
  stale-head and idempotency protection, atomic DataSnapshot v4/BrowserView
  publication, and automatic opening of the published view. Pure column
  visibility/order/filter/sort remains shared ProjectBrowserConfig-only. The old DataPlan
  draft/publish routes, frontend review panel, and deterministic writer modules
  are retired; historical accepted snapshots remain readable.
- List-indexed scalar publication: plans no longer contain `fieldTargets`,
  semantic keys, roles, or Browser ids. Python returns readable column
  definitions and per-experiment values by output `columnIndex`; the backend
  assigns and persists opaque random ids once per validated result. Duplicate
  readable columns stay independent and are disambiguated by source in Browser
  and model catalogs. Chart planning can select published fields by ordered
  position without exposing those ids.
- Real Anthropic plus local-Python Browser publication has been exercised from
  a confirmed 1,024-cell supplemental workbook through a mixed workbook +
  active-snapshot plan. The accepted result preserved 14 scalar fields, added
  two source-backed 62-point series, advanced only Exp1's snapshot head, and
  opened a new non-default BrowserView. One bounded automatic code repair now
  handles Python execution or output-contract errors without asking the user
  to revise an unchanged scientific plan.
- Immediate asynchronous workbook-region review: upload/session creation stops
  after deterministic indexing and durable pending-region creation, then opens
  Workbook Review while a three-request browser queue fills each card's AI
  explanation. Initial hints survive refresh, failed regions retry
  independently, and manual selections share the same queue.
- Uploaded-workbook lifecycle controls: the Overview chooser lists every active
  WorkbookReviewSession with separate Open/Delete actions. Delete is
  editor-only, confirmation-gated, version-checked, and logical; it removes the
  session and active regions from current review/evidence surfaces while
  retaining immutable source, ignored history, downstream artifacts, and audit.
- Docker-first local runtime: Compose now starts persistent Postgres, the Node
  backend with Python available for the development-only local analysis
  executor, and Vite behind health-gated dependencies. Backend migrations use
  a checksum ledger and advisory lock, so one-time migrations are not replayed
  on process restart. Full stack down/up preserves login-visible project data.
- Two-page analysis review: `Source` keeps exact workbook red boxes and the
  natural-language plan; after acceptance, `Result` materializes the reviewed
  workbook selections, generates Python from the real multi-table input, and
  directly shows backend-validated authoritative Plotly. Plan revisions contain
  no Python, field mapping, scientific values, or review hashes. The former
  technical result table, row lineage UI, 500-cell aggregate analysis limit,
  and field-selection registry are removed. Result supports searchable
  curve-only visibility, readable exclusions, and zero-series acceptance
  blocking; ChartSpec v3 and each Canvas block retain independent visible
  curves.
- Progressive full-sheet Workbook Review loading: the active sheet's complete
  `usedRange` hydrates through visible-first bounded tiles with three background
  workers, persistent per-sheet cell/completion caches, late-response
  isolation, progress and failed-range retry. The active region card alone
  controls the blue highlight; ordinary
  drag creates a new active region and Ctrl/Command drag also adds a region
  without cancelling or deleting earlier selections.
- Region Understanding MVP: upload, WorkbookReviewSession grouping, server-owned WorkbookReviewRegions, immutable AI/user-feedback revisions, and independent confirm/ignore/logical-delete decisions.
- Tool-Governed Evidence Retrieval MVP: `POST /api/projects/:projectId/evidence/retrieve` returns usable accepted evidence and non-usable unconfirmed suggestions.
- Historical DataPlan Agent Phase 1-2 (now retired): DataPlan/DataSnapshot
  schemas, deterministic preview execution, draft API, and frontend helper
  coverage established the first Browser publication path before the
  AnalysisThread record-patch replacement.
- Structured region interpretation: the backend model receives only the selected bounded range, limited neighboring context, and workbook manifest; typed experiment/field/unit/inclusion proposals are independently revised and exact accepted revisions become read-only evidence.
- Integrated region-review completion: desktop and 390x844 QA now cover upload, bounded summaries, immutable feedback revision, independent confirm/ignore, bulk identity creation, deterministic preview, publish, reload, and all three selectivity fields in Browser. Initial active-region sheet focus and narrow-screen page overflow were fixed during QA.
- Experiment-record DataPlan preview: deterministic row/region extraction, typed values and series, canonical dependency/preview hashes, explicit identity decisions, source-backed warnings, bounded reads, and a transient review panel.
- Transactional accepted-snapshot publish: mandatory idempotency, backend evidence re-read/re-execution, stale-preview recovery, atomic accepted DataPlan/DataSnapshot persistence, explicit experiment identity updates, affected-head advancement, and audit receipts without DatasetCommit/chart/manuscript side effects.
- Snapshot-backed Experiment Browser: accepted-head-only rows, project-isolated cursor APIs, unit-aware recommended columns, typed search/filter/sort, virtualized large-project rendering, lazy detail, and accepted source-evidence navigation.
- Shared Browser configuration: project-wide renamed labels, visibility, order,
  widths, filters, and sort with versioned reentry restoration. Historical
  personal BrowserViews remain provenance only.
- Personal Experiment Browser annotations: per-user stars, bounded notes, six
  row-highlight colors, note tooltips, and server-side Starred-only filtering
  without exposing annotation authorship to other project members.
- DataPlan identity review bulk workflow: unmatched experiments can be created in one action, unique exact matches can be accepted together, canonical labels identify reuse targets, selected rows can be changed or cleared, and summary/filter/undo controls preserve explicit review before publish.
- WorkbookReviewWorkspace tile loading: stable 40-row by 12-column windows, bounded LRU caching, in-flight request reuse, scroll settling, directional prefetch, retained loaded cells, and correct document/Sheet/range resets avoid repeat SourceDocument `/range` reads and stale viewport state when users drag away, return, or switch workbooks.
- Milestone 7 legacy retirement: removed aggregate dataset/mapping/analysis/observation stores and routes, retired unscoped normalize/chart endpoints, added migration 011, kept source-backed ChartSpecs, and passed the golden workbook-to-Browser workflow.
- Legacy import chain cleanup: removed active master/supplement/normalize/apply product paths, added WorkbookReviewSession APIs, and made Overview use one Upload workbook review surface.
- Project Evidence Retrieval API v0: read-only `POST /api/projects/:projectId/search`.
- Phase 1.1 minimal Excel-like Source Workbook viewer: large ranges are browsed through bounded sheet windows with region/draft overlays.
- Phase 1 read-only Workbook Source Review UI in import/scan review.
- SourceDocument, SourceRegion, AgentRun, and reviewed analysis-result ChartSpec foundations.
- Server project state with auth, labs, projects, files, source review, accepted snapshots/heads, BrowserViews, source-backed charts, manuscripts, and audit events.
- Approved and completed the backend conversational-analysis design:
  backend-only model access, intent routing, exact Excel red-box plan review,
  post-acceptance Python from real multi-table input, validated Plotly result
  review, atomic AnalysisResult/ChartSpec v3 creation, and placement-local
  Canvas curve visibility.
- Implemented conversational-analysis Task 1: provider secrets/model calls now stay on the backend, bounded intent routing replaces unknown-message Browser fallback, project purpose/overview can answer directly, derived analysis/chart requests enter analysis planning, and frontend provider credential/direct-call UI is removed.
- Implemented conversational-analysis Tasks 2-7, then replaced their
  development-only field/hash/result-table contracts with the exact confirmed
  range -> review-only PlanRevision -> materialized input -> generated Python
  -> validated Plotly -> ChartSpec v3 chain described above.
- Implemented conversational-analysis Task 8: a shared trace-aware chart-view model inherits reviewed analysis defaults, lazy-loads complete ChartSpecs before Manuscript insertion, keeps each placement's visible traces independent, exposes searchable Canvas trace controls, bounds LabRat chart context, and filters PPTX output by the placement-local view.
- Completed conversational-analysis Task 9: backend and stateful frontend golden workflows cover natural-language request through revision, exact-plan execution, validated result review, atomic trace-complete ChartSpec publication, Manuscript insertion, independent placement views, reload, and source lineage.
- Unified LabRat chart cutover: removed SourceExtractProposal/ChartProposalSet routes, stores, migrations, frontend cards, proposal review, and sourceSnapshot rendering. Explicit Excel ranges and ordinary chart requests now use the same confirmed-evidence analysis plan.
- Simplified chat workbook entry: each upload now produces one persisted
  filename link to its exact WorkbookReviewSession; Workbook Review remains the
  sole region list and review surface.
- Unified reviewed record ordering across validation and ChartSpec publication
  so result rows, trace lineage, and `inputSnapshotRefs` follow the accepted
  natural-label or workbook-index order.

## Next Recommended Slices

1. Repeat the real-provider workflow with a second supplemental field batch,
   then derive one scalar field entirely from active snapshot data.
2. Add the configured Postgres route suite and repeatable migration smoke to CI.
3. Deploy and exercise the hardened no-network analysis worker with production secret management, audit telemetry, timeout controls, and provider cost/latency monitoring.

## Operating Loop

Every non-trivial milestone should follow:

```text
npm run codex:preflight
  -> read doc/START_HERE.md and this plan
  -> update doc/current-milestone.md for active milestone state
  -> use doc/task-checklist.md as the execution checklist
  -> implement one coherent milestone
  -> run targeted verification
  -> update doc/PROGRESS.md
  -> re-read touched contracts
```

## Guardrails

- AI produces intent, explanations, and reviewable patches; it does not invent scientific values or directly write final data.
- Raw files are immutable evidence.
- Mutating actions require explicit user confirmation.
- RegionUnderstandingRevisions, AnalysisPlanRevisions, DataSnapshots, and later chart/manuscript artifacts must remain traceable to source refs.
- SourceDocument is the evidence layer; accepted RegionUnderstandingRevision is
  the interpretation layer; an Experiment Browser AnalysisPlanRevision is the
  reviewed transformation recipe; DataSnapshot is immutable accepted
  structured data; Experiment Browser is a read model.
- Browser publish must not create ChartSpecs, FigurePackages, or manuscript placements.
- MCP and embedding/RAG adapters are future access layers, not the source of truth.

## Details

- Current milestone: `doc/current-milestone.md`
- Long-form active plan: `doc/plans/agent-first-evidence-workflow.md`
- Evidence retrieval plan: `doc/plans/tool-governed-evidence-retrieval-plan.md`
- DataPlan Agent plan: `doc/plans/tool-governed-dataplan-agent-transition-plan.md`
- Workbook-to-Browser plan: `doc/plans/workbook-review-to-experiment-browser-plan.md`
- DataSnapshot-to-ChartSpec frontend closure plan: `doc/plans/datasnapshot-to-chartspec-frontend-closure-plan.md`
- Chat workbook file-entry design: `doc/plans/chat-workbook-file-entry-design.md`
- Roadmap: `doc/plans/roadmap.md`
- API contracts: `doc/contracts/saas-api-contract-v0.md`
- Data dictionary: `doc/contracts/canonical-data-dictionary.md`
- AI boundaries: `doc/arch/ai-boundaries.md`
