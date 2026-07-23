# LabRat Architecture

Status: active reference
Last reviewed: 2026-07-20

LabRat is a server-first research workspace that turns workbook evidence into reviewed experiment records, cross-experiment Browser views, evidence-backed charts, and manuscript output while preserving provenance and review history.

## Product Flow

```text
Upload workbook
  -> immutable FileObject
  -> deterministic SourceDocument/SourceRegion index
  -> WorkbookReviewSession grouping + WorkbookReviewRegions
  -> accepted RegionUnderstandingRevisions
  -> reviewed experiment-record DataPlan preview
  -> explicit transactional publish
  -> accepted immutable DataSnapshot
  -> ExperimentIdentity/SnapshotHead projection
  -> Experiment Browser
```

Reviewed analysis begins as:

```text
natural-language analysis request
  -> backend intent router / durable AnalysisThread
  -> planning model pages through confirmed regions and selects exact ranges
  -> immutable sourceSelections + readable AnalysisPlanRevision review
  -> user accepts red boxes and natural-language processing
  -> queued AnalysisRun
  -> backend materializes one table per selection
  -> code-generation model sees real inputs and writes policy-checked Python
  -> versioned adapter execution
  -> backend Plotly safety/shape/limit/declared-invariant validation
  -> immutable awaiting-review Plotly AnalysisResult
  -> user reviews chart, exclusions, and default curve visibility
  -> atomic accepted AnalysisResult + analysis-result ChartSpec v3
```

Execution creates no ChartSpec. Only explicit result acceptance crosses the atomic ChartSpec publication boundary.

## Runtime Topology

```text
React/Vite frontend :5173
  -> Node HTTP API :8787
      -> Postgres when DATABASE_URL is configured
      -> in-memory store for isolated development/tests
      -> local uploaded-file storage
      -> disabled executor by default
      -> local bounded runner outside production or configured hardened HTTPS worker
```

Logged-in server mode treats backend project state as the source of truth. Old IndexedDB/project-file shapes are not migration targets.

## Frontend Surfaces

- **Projects/Overview**: project selection, profile, evidence/workflow summaries, and routing into active review work.
- **Workbook Review**: progressively loaded Excel grid, active-card blue range, compact independent region summaries, feedback revisions, and per-region confirm/ignore/logical-delete controls.
- **DataPlan Review**: deterministic experiment records, identity decisions, units, warnings, source navigation, stale-preview recovery, and explicit publish.
- **Experiment Browser**: accepted-head-only rows, configurable columns, typed filters/sort/search, saved personal views, persistent selection, comparison tray, and lazy detail/source evidence.
- **Chart Review**: reviewed analysis plan/result flow plus accepted ChartSpec management.
- **Manuscript**: page/block canvas, analysis-result ChartSpec insertion, placement-local trace controls, editable chart layers, persistence, and PPTX export.
- **Ask LabRat**: project-scoped planning and review-gated actions, not a second data store.

## Backend Components

- **Auth/Admin**: users, sessions, labs, memberships, roles, seed-account safety.
- **Project State**: bounded summaries for files, evidence, understandings, accepted snapshots, views, analysis-result output, manuscripts, AgentRuns, and AnalysisThreads.
- **Backend Model Provider / Intent Router**: server-secret provider access, structured output validation, deterministic command priority, direct project answers, and reviewed-analysis routing without a Browser fallback.
- **Workbook Indexer**: conservative workbook scan and SourceDocument/SourceRegion/cell-index persistence.
- **Workbook Review Engine**: stable regions, bounded backend-model interpretation, immutable revisions, optimistic state changes, and exact accepted revision pointers.
- **Evidence Retrieval Agent**: active accepted-region-revision-only usable results plus explicitly non-usable unconfirmed suggestions.
- **DataPlan Agent/Executor**: deterministic row/region extraction, typed scalars/series, exact source refs, canonical hashes, and identity blockers.
- **Snapshot Publisher**: idempotent atomic accepted DataPlan/DataSnapshot/identity/head/audit transaction.
- **Experiment Projection**: unit-aware field catalog, cursor rows, filters/sort/search, and lazy detail.
- **Analysis Source Selection Service**: catalogs active confirmed regions,
  validates exact subranges, derives red rectangles, performs bounded paged
  reads, and materializes multi-table executor input.
- **Analysis Thread Service**: immutable review-only plan revisions, feedback
  revisioning, idempotent queued-run creation, post-acceptance Python
  generation, run orchestration, complete Plotly preview, and result-linked
  replanning.
- **Analysis Executor/Validator**: exact materialized run packages, internal
  claim-token leases, versioned static/runner Python policy, non-production
  local adapter, production hardened-worker adapter, and deterministic Plotly
  safety/shape/limit/source/declared-invariant validation.
- **Analysis Chart Publisher**: exact-result-id and visible-curve acceptance,
  immutable complete Plotly, idempotent result/run/thread completion, ChartSpec
  v3 creation, artifact links, receipts, and audit.
- **Manuscript Store**: pages, blocks, references, ChartSpec snapshots, and canvas state.

## Domain Ownership

- SourceDocument is the evidence layer.
- WorkbookReviewRegion is the mutable source-range anchor; RegionUnderstandingRevision is immutable semantic interpretation.
- DataPlan is the reviewed deterministic extraction recipe.
- DataSnapshot is immutable accepted structured data.
- ExperimentIdentity is stable project identity.
- ExperimentSnapshotHead selects the current accepted record for one experiment.
- Experiment Browser is a read model.
- BrowserView is personal display state only.
- AnalysisSourceSelection is an exact range inside one active accepted region.
- AnalysisThread owns one durable reviewed-analysis conversation and its artifact ids.
- AnalysisPlanRevision is a durable immutable set of source selections plus
  structured and readable review meaning; it contains no Python or values.
- AnalysisRun is an immutable attempt that is claimed once and finalized with bounded execution/validation metadata.
- AnalysisResult is immutable validated output awaiting a separate user review; acceptance changes workflow metadata only, and failed or invalid execution creates none.
- ChartSpec is created only by explicit acceptance of a validated AnalysisResult.
- Manuscript stores layout and snapshots, not a parallel scientific dataset.
- AgentRun stores visible workflow/audit traces, not hidden chain-of-thought.

## Data Integrity Rules

- Raw files and source indexes are immutable.
- Accepted snapshots are append-only; corrections create new reviewed snapshots.
- Every accepted value preserves exact source refs and deterministic provenance.
- Experiment identity create/reuse decisions are explicit; silent merge is forbidden.
- Incompatible units remain separate unless a reviewed conversion exists.
- Browser publish does not create chart/manuscript artifacts.
- Analysis execution does not create charts; explicit result acceptance creates one immutable analysis-result ChartSpec.
- Manuscript chart blocks keep a complete ChartSpec snapshot and placement-local `visibleTraceIds` for stable historical rendering and independent export.

## Chart Architecture

The frontend renders the backend-validated authoritative Plotly stored in an
internal ChartSpec. Model output is never rendered before backend validation.

```text
active confirmed RegionUnderstandingRevisions
  -> LLM-selected exact sourceSelections
  -> user-reviewed red boxes and natural-language plan
  -> materialized multi-table input
  -> post-acceptance generated Python
  -> validated immutable Plotly AnalysisResult
  -> explicit chart/default-curve review
  -> atomic backend publication
  -> durable analysis-result ChartSpec v3
  -> placement-local curve filtering
```

ChartSpecs require `origin: analysis_result`, exact analysis artifact ids,
reviewed source selections, complete finite Plotly `data/layout`, a matching
flat trace catalog, and a reviewed non-empty default-visible subset.

## AI Boundary

AI may classify, rank, explain, and draft bounded reviewable patches. Deterministic backend code owns evidence reads, validation, identity checks, unit/value parsing, hashes, publication, and authorization. Scientific mutations require explicit user confirmation.

For analysis planning, the model pages through confirmed region summaries and
bounded cells, selects exact workbook ranges, and drafts only calculation/chart
meaning. After user acceptance, backend services re-resolve and materialize one
table per selection; only then may the code-generation model inspect the real
input and return Python. Execution occurs only through the accepted AnalysisRun
service, never through a model tool call.

The Python policy is defense in depth, not the production isolation boundary. It blocks direct numeric-library I/O, module-chain escapes, private/runtime attributes, and known process/network/filesystem APIs, but local subprocess execution remains an explicitly enabled development adapter and is disabled in production. A production worker must provide OS/container-level network denial, read-only runtime assets, resource limits, per-run isolation, and runId idempotency in addition to the policy and result validator.

The frontend does not hold provider credentials or call provider APIs. AgentPanel submits project-scoped messages and compact selected context to the authenticated backend.

## Retired Architecture

The aggregate dataset commit, generic import/mapping/proposal collections, SourceExtractProposal/ChartProposalSet path, analysis views, observation-series registry, local project persistence, old master/supplement workflow, and unscoped/direct chart endpoints have been removed. Do not recreate compatibility adapters or dual-write logic for them.
