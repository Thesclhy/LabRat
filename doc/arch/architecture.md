# LabRat Architecture

Status: active reference
Last reviewed: 2026-07-16

LabRat is a server-first research workspace that turns workbook evidence into reviewed experiment records, cross-experiment Browser views, source-backed charts, and manuscript output while preserving provenance and review history.

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

DataSnapshot-backed chart planning is the next output milestone and must not be approximated through the retired aggregate dataset model.

## Runtime Topology

```text
React/Vite frontend :5173
  -> Node HTTP API :8787
      -> Postgres when DATABASE_URL is configured
      -> in-memory store for isolated development/tests
      -> local uploaded-file storage
```

Logged-in server mode treats backend project state as the source of truth. Old IndexedDB/project-file shapes are not migration targets.

## Frontend Surfaces

- **Projects/Overview**: project selection, profile, evidence/workflow summaries, and routing into active review work.
- **Workbook Review**: bounded Excel-like grid, stable red boxes, current-box conversation, structured semantic controls, blockers, and confirmation.
- **DataPlan Review**: deterministic experiment records, identity decisions, units, warnings, source navigation, stale-preview recovery, and explicit publish.
- **Experiment Browser**: accepted-head-only rows, configurable columns, typed filters/sort/search, saved personal views, persistent selection, comparison tray, and lazy detail/source evidence.
- **Chart Review**: source-evidence prompts and proposal acceptance; no generic normalized-data path.
- **Manuscript**: page/block canvas, source-backed chart insertion, editable chart layers, persistence, and PPTX export.
- **Ask LabRat**: project-scoped planning and review-gated actions, not a second data store.

## Backend Components

- **Auth/Admin**: users, sessions, labs, memberships, roles, seed-account safety.
- **Project State**: bounded summaries for files, evidence, understandings, accepted snapshots, views, source-backed output, manuscripts, and AgentRuns.
- **Workbook Indexer**: conservative workbook scan and SourceDocument/SourceRegion/cell-index persistence.
- **Workbook Review Engine**: red-box revisions, bounded evidence inspection, structured interpretation, validation blockers, and accepted WorkbookUnderstanding.
- **Evidence Retrieval Agent**: accepted-understanding-only usable results plus explicitly non-usable unconfirmed suggestions.
- **DataPlan Agent/Executor**: deterministic row/region extraction, typed scalars/series, exact source refs, canonical hashes, and identity blockers.
- **Snapshot Publisher**: idempotent atomic accepted DataPlan/DataSnapshot/identity/head/audit transaction.
- **Experiment Projection**: unit-aware field catalog, cursor rows, filters/sort/search, and lazy detail.
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
- SourceExtractProposal/ChartProposalSet/ChartSpec are reviewed visualization artifacts.
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
- Manuscript chart blocks keep a ChartSpec snapshot for stable historical rendering.

## Chart Architecture

The frontend renders an internal ChartSpec, never arbitrary model-generated Plotly JSON.

```text
explicit source evidence
  -> reviewable extract/chart proposal
  -> backend ChartSpec validation
  -> frontend sourceSnapshot renderer
  -> user review
  -> durable ChartSpec
```

Current ChartSpecs require `origin: source_extract`, exact source refs, and immutable row/series snapshots. Non-source proposals receive `data_snapshot_chart_not_implemented` until accepted DataSnapshot chart planning is designed and implemented.

## AI Boundary

AI may classify, rank, explain, and draft bounded reviewable patches. Deterministic backend code owns evidence reads, validation, identity checks, unit/value parsing, hashes, publication, and authorization. Scientific mutations require explicit user confirmation.

## Retired Architecture

The aggregate dataset commit, generic import/mapping/proposal collections, analysis views, observation-series registry, local project persistence, old master/supplement workflow, and unscoped import/chart endpoints have been removed. Do not recreate compatibility adapters or dual-write logic for them.
