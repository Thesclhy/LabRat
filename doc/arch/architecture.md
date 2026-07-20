# LabRat Architecture

Status: active reference
Last reviewed: 2026-07-20

LabRat is a server-first research workspace that turns workbook evidence into reviewed experiment records, cross-experiment Browser views, evidence-backed charts, and manuscript output while preserving provenance and review history.

## Product Flow

```text
Upload workbook
  -> immutable FileObject
  -> deterministic SourceDocument/SourceRegion index
  -> WorkbookReviewSession with chat + red boxes
  -> accepted WorkbookUnderstanding
  -> reviewed experiment-record DataPlan preview
  -> explicit transactional publish
  -> accepted immutable DataSnapshot
  -> ExperimentIdentity/SnapshotHead projection
  -> Experiment Browser
```

Source-backed visualization is a separate reviewed branch:

```text
SourceDocument range
  -> SourceExtractProposal
  -> ChartProposalSet review
  -> source-backed ChartSpec with immutable sourceSnapshot
  -> Manuscript chart block / PPTX
```

Reviewed accepted-data analysis now begins as:

```text
natural-language analysis request
  -> backend intent router / durable AnalysisThread
  -> backend model chooses accepted fields, scope, calculation, and Python
  -> backend tools resolve exact active-head selection and source rectangles
  -> immutable AnalysisPlanRevision review
  -> exact-hash acceptance
  -> queued AnalysisRun
  -> frozen package execution in a versioned adapter
  -> backend shape/hash/lineage/invariant validation
  -> immutable awaiting-review AnalysisResult
  -> user reviews result, exclusions, lineage, and default trace visibility
  -> atomic accepted AnalysisResult + analysis-result ChartSpec v2
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
- **Workbook Review**: bounded Excel-like grid, stable red boxes, current-box conversation, structured semantic controls, blockers, and confirmation.
- **DataPlan Review**: deterministic experiment records, identity decisions, units, warnings, source navigation, stale-preview recovery, and explicit publish.
- **Experiment Browser**: accepted-head-only rows, configurable columns, typed filters/sort/search, saved personal views, persistent selection, comparison tray, and lazy detail/source evidence.
- **Chart Review**: source-evidence proposal review plus accepted-data analysis result review; no unreviewed generic normalized-data path.
- **Manuscript**: page/block canvas, source- and analysis-result ChartSpec insertion, placement-local trace controls, editable chart layers, persistence, and PPTX export.
- **Ask LabRat**: project-scoped planning and review-gated actions, not a second data store.

## Backend Components

- **Auth/Admin**: users, sessions, labs, memberships, roles, seed-account safety.
- **Project State**: bounded summaries for files, evidence, understandings, accepted snapshots, views, source- and analysis-result-backed output, manuscripts, AgentRuns, and AnalysisThreads.
- **Backend Model Provider / Intent Router**: server-secret provider access, structured output validation, deterministic command priority, direct project answers, and reviewed-analysis routing without a Browser fallback.
- **Workbook Indexer**: conservative workbook scan and SourceDocument/SourceRegion/cell-index persistence.
- **Workbook Review Engine**: red-box revisions, bounded evidence inspection, structured interpretation, validation blockers, and accepted WorkbookUnderstanding.
- **Evidence Retrieval Agent**: accepted-understanding-only usable results plus explicitly non-usable unconfirmed suggestions.
- **DataPlan Agent/Executor**: deterministic row/region extraction, typed scalars/series, exact source refs, canonical hashes, and identity blockers.
- **Snapshot Publisher**: idempotent atomic accepted DataPlan/DataSnapshot/identity/head/audit transaction.
- **Experiment Projection**: unit-aware field catalog, cursor rows, filters/sort/search, and lazy detail.
- **Analysis Tool Registry**: project-authorized, framework-independent read/plan tools for accepted field catalogs, experiment scope, selection previews/inspection, and plan validation. It exposes no calculation executor.
- **Analysis Thread Service**: immutable plan revision persistence, backend-owned draft normalization, exact selection/program hashing, feedback revisioning, stale-head detection, idempotent queued-run creation, run orchestration, bounded result preview, and result-linked replanning.
- **Analysis Executor/Validator**: canonical frozen run packages, transactionally checked active-head claims, internal claim-token leases, versioned static/runner Python policy, non-production local adapter, production hardened-worker adapter, and deterministic output/schema/identity/accounting/hash/lineage/unit/invariant validation before result persistence.
- **Analysis Chart Publisher**: exact-result-hash acceptance, transactionally rechecked active heads, immutable complete trace catalogs, idempotent result/run/thread completion, ChartSpec creation, artifact links, receipts, and audit.
- **Source Chart Resolver**: explicit range/experiment evidence, source extract proposals, immutable chart snapshots, and validation.
- **Manuscript Store**: pages, blocks, references, ChartSpec snapshots, and canvas state.

## Domain Ownership

- SourceDocument is the evidence layer.
- WorkbookUnderstanding is accepted semantic interpretation.
- DataPlan is the reviewed deterministic extraction recipe.
- DataSnapshot is immutable accepted structured data.
- ExperimentIdentity is stable project identity.
- ExperimentSnapshotHead selects the current accepted record for one experiment.
- Experiment Browser is a read model.
- BrowserView is personal display state only.
- AnalysisSelection is a transient accepted-head-only review artifact with dependency/selection hashes.
- AnalysisThread owns one durable reviewed-analysis conversation and its artifact ids.
- AnalysisPlanRevision is a durable immutable manifest, frozen selection, and exact program; it is not a result.
- AnalysisRun is an immutable attempt that is claimed once and finalized with bounded execution/validation metadata.
- AnalysisResult is immutable validated output awaiting a separate user review; acceptance changes workflow metadata only, and failed or invalid execution creates none.
- SourceExtractProposal/ChartProposalSet and analysis-result publication are separate reviewed paths that converge on ChartSpec.
- Manuscript stores layout and snapshots, not a parallel scientific dataset.
- AgentRun stores visible workflow/audit traces, not hidden chain-of-thought.

## Data Integrity Rules

- Raw files and source indexes are immutable.
- Accepted snapshots are append-only; corrections create new reviewed snapshots.
- Every accepted value preserves exact source refs and deterministic provenance.
- Experiment identity create/reuse decisions are explicit; silent merge is forbidden.
- Incompatible units remain separate unless a reviewed conversion exists.
- Browser publish does not create chart/manuscript artifacts.
- Source-backed chart creation does not mutate accepted snapshots.
- Analysis execution does not create charts; explicit result acceptance creates one immutable analysis-result ChartSpec.
- Manuscript chart blocks keep a complete ChartSpec snapshot and placement-local `visibleTraceIds` for stable historical rendering and independent export.

## Chart Architecture

The frontend renders an internal ChartSpec, never arbitrary model-generated Plotly JSON.

```text
explicit source evidence
  -> reviewable extract/chart proposal
  -> backend ChartSpec validation
  -> frontend sourceSnapshot renderer
  -> user review
  -> durable ChartSpec

accepted DataSnapshot heads
  -> reviewed AnalysisPlanRevision
  -> validated immutable AnalysisResult
  -> explicit result/default-trace review
  -> atomic backend publication
  -> durable analysis-result ChartSpec v2
  -> shared validated trace renderer
```

Source ChartSpecs require `origin: source_extract`, exact source refs, and immutable row/series snapshots. Analysis ChartSpecs require `origin: analysis_result`, exact analysis/dependency hashes, accepted input snapshot refs, complete finite trace arrays with source-record lineage, and a reviewed default-visible subset. Generic non-source proposals still receive `data_snapshot_chart_not_implemented`.

## AI Boundary

AI may classify, rank, explain, and draft bounded reviewable patches. Deterministic backend code owns evidence reads, validation, identity checks, unit/value parsing, hashes, publication, and authorization. Scientific mutations require explicit user confirmation.

For analysis planning, the model selects fields/scope and drafts calculation meaning plus Python. Backend services re-resolve accepted active-head data and overwrite selection, source, and Python hashes before persistence. The planning registry exposes no execution operation. Execution occurs only through the accepted AnalysisRun service, never through a model tool call.

The Python policy is defense in depth, not the production isolation boundary. It blocks direct numeric-library I/O, module-chain escapes, private/runtime attributes, and known process/network/filesystem APIs, but local subprocess execution remains an explicitly enabled development adapter and is disabled in production. A production worker must provide OS/container-level network denial, read-only runtime assets, resource limits, per-run isolation, and runId idempotency in addition to the policy and result validator.

The frontend does not hold provider credentials or call provider APIs. AgentPanel submits project-scoped messages and compact selected context to the authenticated backend.

## Retired Architecture

The aggregate dataset commit, generic import/mapping/proposal collections, analysis views, observation-series registry, local project persistence, old master/supplement workflow, and unscoped import/chart endpoints have been removed. Do not recreate compatibility adapters or dual-write logic for them.
