# Current Development Plan

Status: active
Read when: deciding what LabRat should build next.
Last reviewed: 2026-07-20

This is the short active plan. Current execution status lives in `doc/current-milestone.md`; detailed implementation plans live under `doc/plans/`.

## Current Focus

LabRat's product direction remains Workbook Understanding First:

```text
Upload workbook
  -> SourceDocument / deterministic workbook index
  -> WorkbookReviewSession
  -> LLM-drafted + backend-validated WorkbookUnderstanding
  -> user confirms/corrects through chat + red boxes
  -> accepted WorkbookUnderstanding
  -> reviewed DataPlan / DataSnapshot preview
  -> explicit Publish to Browser
  -> accepted DataSnapshot
  -> Experiment Browser
```

Uploading Excel defaults to evidence indexing and workbook understanding only. It does not normalize data, choose master/supplement roles, create a DatasetCommit, create a SourceExtractProposal, create a ChartSpec, or insert manuscript content. Those are later reviewed actions.

The first complete product target is now reviewed workbook data in Experiment Browser. Accepted WorkbookUnderstanding evidence is compiled into reviewable experiment-record DataPlans and deterministic DataSnapshot previews. Explicit publish persists an immutable accepted DataSnapshot and advances the affected experiment identities. Experiment Browser derives its rows from those accepted snapshots.

The obsolete aggregate dataset/generic import implementation has been removed. No legacy local-data migration or dual-write path is required.

Use this split when deciding what to build:

- Product mainline: Workbook Understanding First, ending in Experiment Browser.
- Engineering mainline: structured WorkbookUnderstanding -> experiment-record DataPlan -> accepted DataSnapshot -> Browser projection.
- Completed execution milestone: backend conversational analysis, reviewed calculation, analysis-result ChartSpec publication, and placement-local trace visibility.

## Recently Completed

- Workbook Understanding MVP: upload, WorkbookReviewSession, red-box/natural-language revisions, and accepted WorkbookUnderstanding persistence.
- Tool-Governed Evidence Retrieval MVP: `POST /api/projects/:projectId/evidence/retrieve` returns usable accepted evidence and non-usable unconfirmed suggestions.
- Transient DataPlan Agent Phase 1-2: DataPlan/DataSnapshot schemas, backend DataPlan tools, deterministic preview execution, `POST /api/projects/:projectId/data-plans/draft`, and frontend helper coverage.
- Structured WorkbookUnderstanding interpretation: bounded evidence inspection, typed experiment/field/unit/inclusion proposals, conversational and structured correction, confirmation blockers, and accepted read-only semantics.
- Experiment-record DataPlan preview: deterministic row/region extraction, typed values and series, canonical dependency/preview hashes, explicit identity decisions, source-backed warnings, bounded reads, and a transient review panel.
- Transactional accepted-snapshot publish: mandatory idempotency, backend evidence re-read/re-execution, stale-preview recovery, atomic accepted DataPlan/DataSnapshot persistence, explicit experiment identity updates, affected-head advancement, and audit receipts without DatasetCommit/chart/manuscript side effects.
- Snapshot-backed Experiment Browser: accepted-head-only rows, project-isolated cursor APIs, unit-aware recommended columns, typed search/filter/sort, virtualized large-project rendering, lazy detail, and accepted source-evidence navigation.
- Personal Browser views and comparison: owner-isolated saved display state, configurable columns, default view restoration, persistent selection, and source-backed scalar/series comparison without unit coercion.
- DataPlan identity review bulk workflow: unmatched experiments can be created in one action, unique exact matches can be accepted together, canonical labels identify reuse targets, selected rows can be changed or cleared, and summary/filter/undo controls preserve explicit review before publish.
- WorkbookReviewWorkspace tile loading: stable 40-row by 12-column windows, bounded LRU caching, in-flight request reuse, scroll settling, directional prefetch, retained loaded cells, and correct document/Sheet/range resets avoid repeat SourceDocument `/range` reads and stale viewport state when users drag away, return, or switch workbooks.
- Milestone 7 legacy retirement: removed aggregate dataset/mapping/analysis/observation stores and routes, retired unscoped normalize/chart endpoints, added migration 011, kept source-backed ChartSpecs, and passed the golden workbook-to-Browser workflow.
- Legacy import chain cleanup: removed active master/supplement/normalize/apply product paths, added WorkbookReviewSession APIs, and made Overview use one Upload workbook review surface.
- Project Evidence Retrieval API v0: read-only `POST /api/projects/:projectId/search`.
- Phase 1.1 minimal Excel-like Source Workbook viewer: large ranges are browsed through bounded sheet windows with region/draft overlays.
- Phase 1 read-only Workbook Source Review UI in import/scan review.
- SourceDocument, SourceRegion, SourceExtractProposal, AgentRun, and source-backed ChartSpec foundations.
- Server project state with auth, labs, projects, files, source review, accepted snapshots/heads, BrowserViews, source-backed charts, manuscripts, and audit events.
- Approved the backend conversational-analysis design: backend-only model access, intent routing, Excel red-box plan review, immutable plan revisions with exact Python, LabRat-managed sandbox execution, result review, atomic AnalysisResult/ChartSpec creation, and placement-local Canvas trace visibility.
- Implemented conversational-analysis Task 1: provider secrets/model calls now stay on the backend, bounded intent routing replaces unknown-message Browser fallback, project purpose/overview can answer directly, derived analysis/chart requests enter analysis planning, and frontend provider credential/direct-call UI is removed.
- Implemented conversational-analysis Task 2: accepted-head-only unit-aware selections, source review rectangles and limits, frozen plan/program schema validation, and a project-scoped six-tool planning registry without execution.
- Implemented conversational-analysis Task 3: durable threads and immutable plan revisions, backend-only initial/feedback plan drafting, exact accepted-selection/source/Python hashes, migration/store parity, bounded review routes, AgentRun artifact links, stale-plan checks, and idempotent acceptance that creates a queued run without executing or creating a chart.
- Implemented conversational-analysis Task 4: normal LabRat analysis cards open a persistent Excel-plus-conversation review workspace; accepted source cells are highlighted as non-contiguous red rectangles; users can iterate immutable plan revisions through the split modify composer; exact visible hashes gate acceptance; stale cards reopen the latest active revision; and responsive layouts keep Result/Chart unavailable before execution.
- Implemented conversational-analysis Task 5: accepted queued runs are revalidated and executed through a versioned backend adapter; static/runner Python policy and production-disabled defaults bound code execution; valid output is hash/shape/lineage/count/invariant checked before one immutable awaiting-review AnalysisResult is persisted; result previews and hash-bound replanning are available without creating a ChartSpec.
- Implemented conversational-analysis Task 6: the existing LabRat review workspace now binds exact run/result hashes, reviews validated rows, exclusions, missing policy, warnings, invariants, lineage and source evidence, loads the complete trace domain, separates incompatible units, preserves historical runs, and supports immutable result-feedback revisions plus reviewed default trace visibility.
- Implemented conversational-analysis Task 7: exact result/default-trace acceptance now atomically rechecks accepted heads, accepts the existing result, completes its run/thread, creates one provenance-complete analysis-result ChartSpec v2, records an idempotent receipt/audit event, exposes bounded list metadata plus full detail, and renders validated traces without a sourceSnapshot.
- Implemented conversational-analysis Task 8: a shared trace-aware chart-view model migrates legacy source experiment selections, inherits reviewed analysis defaults, lazy-loads complete ChartSpecs before Manuscript insertion, keeps each placement's visible traces independent, exposes searchable Canvas trace controls, bounds LabRat chart context, and filters PPTX output by the placement-local view.
- Completed conversational-analysis Task 9: backend and stateful frontend golden workflows now cover natural-language request through revision, exact-plan execution, validated result review, atomic trace-complete ChartSpec publication, Manuscript insertion, independent placement views, reload, and source lineage. Final contracts cover both ChartSpec origins and backend-only model/executor boundaries. Desktop/mobile browser QA also fixed immutable-snapshot reload rendering, a selected-chart context update loop, and chart-preview title/legend overlap.

## Next Recommended Slices

1. Deploy and exercise the hardened no-network analysis worker with production secret management, audit telemetry, timeout controls, and provider cost/latency monitoring.
2. Run migration 012 and the atomic publication workflow against configured Postgres in CI or a staging environment.
3. Evaluate an optional MCP adapter only as another client of the existing backend tools and confirmation state.

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
- WorkbookUnderstandings, DataPlans, DataSnapshots, and later chart/manuscript artifacts must remain traceable to source refs.
- SourceDocument is the evidence layer; WorkbookUnderstanding is the interpretation layer; DataPlan is the reviewed extraction recipe; DataSnapshot is immutable accepted structured data; Experiment Browser is a read model.
- Browser publish must not create chart proposals, ChartSpecs, FigurePackages, or manuscript placements.
- MCP and embedding/RAG adapters are future access layers, not the source of truth.

## Details

- Current milestone: `doc/current-milestone.md`
- Long-form active plan: `doc/plans/agent-first-evidence-workflow.md`
- Evidence retrieval plan: `doc/plans/tool-governed-evidence-retrieval-plan.md`
- DataPlan Agent plan: `doc/plans/tool-governed-dataplan-agent-transition-plan.md`
- Workbook-to-Browser plan: `doc/plans/workbook-review-to-experiment-browser-plan.md`
- Roadmap: `doc/plans/roadmap.md`
- API contracts: `doc/contracts/saas-api-contract-v0.md`
- Data dictionary: `doc/contracts/canonical-data-dictionary.md`
- AI boundaries: `doc/arch/ai-boundaries.md`
