# LabRat Architecture

Status: active reference
Last reviewed: 2026-08-23

LabRat is a server-first research workspace that turns workbook evidence into reviewed experiment records, cross-experiment Browser views, evidence-backed charts, and manuscript output while preserving provenance and review history.

## Product Flow

```text
Upload workbook
  -> immutable FileObject
  -> deterministic SourceDocument/SourceRegion index
  -> WorkbookReviewSession grouping + WorkbookReviewRegions
  -> accepted RegionUnderstandingRevisions
  -> reviewed Experiment Browser AnalysisPlanRevision
  -> onboarding direct-source mapping or general post-acceptance Python record patches
  -> explicit transactional DataSnapshot v4 publish
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

Experiment Browser data uses the same reviewed workflow with
`outputTarget: experiment_browser`. Planning may combine exact confirmed
workbook ranges and active snapshot fields. Execution returns source-backed
record patches; backend merge preview and explicit acceptance create one
DataSnapshot v4 plus BrowserView without overwriting historical snapshots.

The pristine-project onboarding surface opts into a backend-owned fixed source
mapper after plan acceptance. It consumes only accepted row/field semantics
and exact materialized cells, then returns the ordinary record-patch contract.
This removes variable code generation from the master-table demonstration
without changing the general Python path used by calculations, reshaping,
active snapshots, or future external-file relationships.

WorkbookReviewSession creation stops after deterministic indexing and durable
candidate-region creation. It returns pending regions immediately; Workbook
Review opens the source workspace and performs bounded per-region
interpretation with a three-request concurrency limit. This is a resumable
browser-orchestrated queue, not a durable backend worker.

## Runtime Topology

```text
Docker Compose (default local development runtime)
  -> React/Vite frontend :5173
      -> NestJS/Fastify `/api/v1` :8787 in production, :8788 when isolated
          -> Postgres :5432 in-network / :5433 on the host
          -> persistent uploaded-file volume
          -> development-only local Python executor

Isolated tests may still use the in-memory store. Production uses persistent
Postgres/file storage and must replace the local executor with the configured
hardened HTTPS worker.
```

Logged-in server mode treats explicit backend v1 resources as the source of
truth. React may compose those bounded responses into transient workspace state,
but no project-state aggregate is part of v1. Old IndexedDB/project-file shapes
are not migration targets.

## Frontend Surfaces

- **Projects/Overview**: project selection, profile, evidence/workflow summaries, and routing into active review work.
- **Workbook Review**: progressively loaded Excel grid, active-card blue range, compact independent region summaries, feedback revisions, and per-region confirm/ignore/logical-delete controls.
- **Experiment Data Review**: Source/Result review for selected workbook ranges
  and active experiment fields, natural-language transformations, merged Browser
  table preview, ambiguous identity decisions, and explicit publication.
- **Experiment Browser**: accepted-head-only scientific rows, shared custom
  documentation columns, configurable columns, typed filters/sort/search,
  personal annotations, and lazy detail/source evidence.
- **Chart Review**: reviewed analysis plan/result flow plus accepted ChartSpec management.
- **Manuscript**: page/block canvas, analysis-result ChartSpec insertion, placement-local trace controls, editable chart layers, persistence, and PPTX export.
- **Ask LabRat**: project-scoped planning and review-gated actions, not a second data store.

## Backend Components

- **Auth/Admin**: users, sessions, labs, memberships, roles, seed-account safety.
- **Workspace API**: authorization-scoped project shells and bounded resource
  lists for files, evidence, understandings, accepted snapshots, views,
  analysis-result output, manuscripts, AgentRuns, and AnalysisThreads.
- **Backend Model Provider / Intent Router**: server-secret provider access, structured output validation, deterministic command priority, direct project answers, and reviewed-analysis routing without a Browser fallback.
- **Workbook Indexer**: conservative workbook scan and SourceDocument/SourceRegion/cell-index persistence.
- **Workbook Review Engine**: stable regions, bounded backend-model interpretation, immutable revisions, optimistic state changes, and exact accepted revision pointers.
- **Evidence Retrieval Agent**: active accepted-region-revision-only usable results plus explicitly non-usable unconfirmed suggestions.
- **Experiment Browser Analysis**: mixed workbook/snapshot input catalogs,
  source-backed record-patch validation, complete-record merge, change preview,
  and identity candidates.
- **Experiment Snapshot Publisher**: stale-head-protected, idempotent atomic
  AnalysisResult/DataSnapshot v4/identity/head/BrowserView/audit transaction.
- **Experiment Projection**: unit-aware field catalog, cursor rows, filters/sort/search, and lazy detail.
- **Analysis Source Selection Service**: catalogs active confirmed regions,
  validates exact subranges, derives red rectangles, performs bounded paged
  reads, and materializes multi-table executor input.
- **Analysis Thread Service**: target-specific immutable review-only plan revisions, feedback
  revisioning, idempotent queued-run creation, post-acceptance Python
  generation, run orchestration, complete Plotly or Experiment Browser preview,
  and result-linked replanning.
- **Server-owned plan drafting**: once routing has durably created an
  AnalysisThread, the provider request outlives the initiating browser
  connection. Frontends observe the thread by id, recover it after reload, and
  treat `plan_failed` plus its bounded persisted failure as a retryable terminal
  draft state instead of using browser memory as authority.
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
- DataPlan is historical provenance only; new Browser writes use reviewed
  AnalysisPlanRevisions.
- DataSnapshot is immutable accepted structured data.
- ExperimentIdentity is stable project identity.
- ExperimentSnapshotHead selects the current accepted record for one experiment.
- Experiment Browser is a read model.
- ProjectBrowserConfig is the shared project-wide Experiment Browser display
  state. BrowserView is retained only as historical publication/view
  provenance and does not drive the active Browser UI.
- ExperimentAnnotation is private per project user and adds only star, note,
  and highlight presentation metadata to an active ExperimentIdentity.
- ExperimentCustomColumn and ExperimentCustomValue are shared project
  documentation metadata keyed to stable ExperimentIdentities, separate from
  immutable accepted DataSnapshots.
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
active confirmed RegionUnderstandingRevisions and/or active DataSnapshot heads
  -> LLM-selected exact sourceSelections and/or experimentSelections
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
reviewed workbook or frozen experiment selections, complete finite Plotly
`data/layout`, a matching flat trace catalog, and a reviewed non-empty
default-visible subset.

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

The backend uses an in-process provider gateway. Domain prompts, schemas, and
review boundaries remain provider-neutral; Anthropic and DeepSeek adapters own
only wire-format conversion, tool loops, usage normalization, cancellation,
and sanitized transport errors. Anthropic Messages and DeepSeek Chat
Completions remain separate adapters because their authentication, structured
output, thinking, and tool-result formats differ. Every environment explicitly
selects one provider at startup; there is no automatic failover and no external
gateway service. Production deployment accepts only the non-secret provider
name from GitHub and keeps both keys exclusively in the Lightsail environment
file, with provider and release rollback treated as one transaction.

## Retired Architecture

The aggregate dataset commit, generic import/mapping/proposal collections, SourceExtractProposal/ChartProposalSet path, analysis views, observation-series registry, local project persistence, old master/supplement workflow, and unscoped/direct chart endpoints have been removed. Do not recreate compatibility adapters or dual-write logic for them.
