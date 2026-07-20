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
- Current execution milestone: implement the approved backend conversational-analysis and chart workflow.

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
- Approved the backend conversational-analysis design: backend-only model access, intent routing, Excel red-box plan review, immutable plan revisions with exact Python, LabRat-managed sandbox execution, result review, atomic AnalysisResult/ChartSpec creation, and placement-local Canvas trace visibility. The written specification is awaiting review at `doc/plans/backend-conversational-analysis-chart-design.md`; no implementation has started.
- Implemented conversational-analysis Task 1: provider secrets/model calls now stay on the backend, bounded intent routing replaces unknown-message Browser fallback, project purpose/overview can answer directly, derived analysis/chart requests enter analysis planning, and frontend provider credential/direct-call UI is removed.
- Implemented conversational-analysis Task 2: accepted-head-only unit-aware selections, source review rectangles and limits, frozen plan/program schema validation, and a project-scoped six-tool planning registry without execution.

## Next Recommended Slices

1. Execute `doc/plans/backend-conversational-analysis-chart-implementation-plan.md`, beginning with backend provider migration, intent routing, and frontend provider-key removal.
2. Continue through AnalysisThread -> accepted Python plan -> validated AnalysisResult -> DataSnapshot-backed ChartSpec in coherent tested milestones.
3. Preserve source-backed chart creation as a distinct evidence path and converge both forms only at the validated ChartSpec/rendering boundary.

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
