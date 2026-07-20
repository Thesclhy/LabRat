# SaaS Database Schema v0

Status: active
Last reviewed: 2026-07-20

The executable source of truth is `backend/migrations/`. This document records ownership, invariants, and the scientific lineage between current tables.

## Scope And Ownership

- Every project artifact belongs to one lab and one project.
- `users`, `labs`, `lab_memberships`, and `sessions` define authentication and authorization.
- `projects.metadata.projectProfile` stores bounded project context, not scientific result tables.
- Raw files and source indexes are immutable evidence.
- Accepted scientific data is stored only in accepted DataSnapshots and selected by per-experiment snapshot heads.

## Core Tables

### Identity And Access

```text
users
labs
lab_memberships
sessions
projects
audit_events
```

Membership roles are `viewer`, `editor`, `lab_admin`, with super-admin represented on the user. Audit events record actor, action, target, project/lab scope, summary, metadata, and timestamp.

### File And Evidence Layer

```text
file_objects
import_runs
source_documents
source_regions
source_index_blobs
```

`file_objects` stores immutable upload metadata and storage keys. `import_runs` records workbook indexing/scanning attempts. A successful run creates or reuses one `source_documents` row per project file, detected `source_regions`, and indexed cell payloads in `source_index_blobs`.

Source tables preserve workbook/sheet/range coordinates, raw values/formulas where indexed, source refs, confidence, warnings, checksum/version metadata, and creator timestamps.

### Workbook Interpretation Layer

```text
workbook_review_sessions
workbook_understandings
```

`workbook_review_sessions` stores the mutable review conversation: current red boxes, messages, structured draft interpretation, warnings, version, and status.

`workbook_understandings` stores accepted immutable semantic decisions for one session/source document: facts, region summaries, identity/field/unit interpretation, warnings, and decision summary. Confirmation does not create accepted experiment data.

### Accepted Data Layer

```text
data_plans
data_snapshots
experiment_identities
experiment_snapshot_heads
experiment_snapshot_publishes
```

`data_plans` stores an accepted reviewed extraction recipe with:

- `schema_version = labrat.dataPlan.v2`
- `task = experiment_browser_publish`
- `output_shape = experiment_records`
- operations and identity bindings
- accepted source evidence
- dependency hash, validation, warnings, actor/timestamps

`data_snapshots` stores immutable accepted output with:

- `schema_version = labrat.dataSnapshot.v2`
- content and dependency hashes
- complete `experiment_records`
- exact source refs, summary, warnings
- accepted actor/timestamp

`experiment_identities` gives each project experiment a stable id, canonical label, normalized label, and aliases. Identity creation/reuse is always explicit.

`experiment_snapshot_heads` selects one active `(data_snapshot_id, record_index)` for each project experiment. Publishing a partial snapshot advances only affected heads.

`experiment_snapshot_publishes` is the idempotency receipt keyed by `(project_id, idempotency_key)`. It stores request hash and exact successful response.

### Personal Browser State

```text
browser_views
```

BrowserViews are scoped by `(lab_id, project_id, owner_user_id)`. `payload` may contain display configuration and selected ids only; it cannot contain authoritative scientific values. At most one default view should exist per owner/project after store operations.

### Evidence-Backed Output Layer

```text
source_extract_proposals
chart_proposal_sets
chart_specs
manuscripts
agent_runs
```

`source_extract_proposals` stores reviewable bounded source selections and interpretation before chart creation.

`chart_proposal_sets` stores proposal/review state. Active proposal creation is source-backed only.

`chart_specs` stores durable evidence-backed chart definitions. `origin: source_extract` specs contain exact source refs and immutable source snapshot rows/series. `origin: analysis_result` specs use `labrat.chartSpec.v2`, set `analysis_result_id`, and contain exact analysis hashes, accepted input snapshot refs, a complete validated trace catalog, source-record lineage, and reviewed default trace visibility. There is no aggregate dataset foreign key.

`manuscripts` stores blocks, pages, canvas state, and references. Chart blocks carry their own complete ChartSpec snapshot plus placement-local `chartView.visibleTraceIds` for stable independent rendering and export.

`agent_runs` stores visible workflow steps, summarized tool observations, review-gated actions, usage metadata, and status. It does not store hidden chain-of-thought.

### Reviewed Analysis Layer

```text
analysis_threads
analysis_plan_revisions
analysis_runs
analysis_results
analysis_publications
```

`analysis_threads` is the durable project-scoped conversation/workflow container. It stores bounded visible messages and ordered artifact ids, not full result arrays in project state.

`analysis_plan_revisions` is append-only except for workflow status. Each row stores one complete reviewed plan and frozen AnalysisSelection with exact source rectangles, manifest, missing-value policy, Python source/program hash, dependency/selection/plan hashes, validation, feedback, and actor timestamps. `(analysis_thread_id, revision)` is unique.

`analysis_runs` links one accepted plan revision to an immutable execution attempt. Plan acceptance creates a `queued` row. Execution transactionally locks the run and selected active-head rows before moving it to `running`; changed heads instead terminally produce `validation_failed`. Running claims carry an internal token and lease metadata so an expired worker may be replaced without allowing the old worker to finalize. One atomic finalization moves the run to `failed`, `validation_failed`, or `awaiting_result_review`. The run records frozen input/program/runtime hashes, bounded executor metadata, result-preview hash, warnings, and validation. `(project_id, idempotency_key)` makes plan acceptance retry-safe.

`analysis_results` stores only backend-validated immutable executor output. A valid run finalization inserts one `awaiting_review` result in the same transaction that updates its AnalysisRun and AnalysisThread; failed or invalid output inserts no result. Result publication updates only acceptance workflow metadata, never the immutable result payload/hashes. `analysis_publications` records the atomic accepted-result plus ChartSpec boundary and is keyed by `(project_id, idempotency_key)`.

`chart_specs.analysis_result_id` is nullable so existing `source_extract` ChartSpecs remain valid. Analysis-result ChartSpecs set this foreign key and carry the complete validated trace catalog in their immutable spec.

## Transaction Boundary

Publishing accepted workbook data is one atomic operation:

```text
validate accepted WorkbookUnderstanding
  -> re-read SourceDocument evidence
  -> deterministically re-execute DataPlan
  -> validate dependency and preview hashes
  -> create accepted DataPlan
  -> create immutable DataSnapshot
  -> create/reuse explicit ExperimentIdentities
  -> advance affected ExperimentSnapshotHeads
  -> store idempotency receipt
  -> record audit event
```

Any failure rolls back all durable writes.

Accepting an analysis plan is a separate atomic operation:

```text
lock project/idempotency key
  -> verify current awaiting-review revision
  -> re-resolve active accepted snapshot selection
  -> verify plan/selection/dependency hashes
  -> mark revision accepted
  -> create one queued AnalysisRun
  -> update AnalysisThread artifact ids/status
  -> record audit event
```

This transaction does not execute Python or create an AnalysisResult/ChartSpec. A later explicit execution transaction claims only that queued run, validates frozen dependencies and output, and may create one awaiting-review AnalysisResult. It never creates a ChartSpec.

Accepting a validated analysis result is another atomic operation:

```text
lock project/idempotency key
  -> lock current thread, accepted plan, awaiting-result-review run, and awaiting-review result
  -> lock and verify every selected ExperimentSnapshotHead
  -> verify exact result/preview/selection/dependency/program/runtime hashes
  -> mark the existing AnalysisResult accepted
  -> mark AnalysisRun and AnalysisThread completed
  -> create one analysis-result ChartSpec with complete trace catalog
  -> link artifact ids
  -> store publication receipt
  -> record audit event
```

Any validation, stale-head, conflicting-idempotency, or insert failure rolls back all writes.

## Migration Sequence

```text
001_saas_auth_v0.sql
005_source_documents.sql
006_source_extract_proposals.sql
007_agent_runs.sql
008_workbook_review_sessions.sql
009_workbook_understandings.sql
010_data_plan_experiment_browser.sql
011_drop_legacy_dataset_path.sql
012_analysis_workflow.sql
```

Migration 011 removes the obsolete aggregate dataset, mapping, analysis-view, and observation-series tables/foreign keys from development databases. New databases never need those product paths.
Migration 012 adds reviewed analysis persistence, publication receipts, and nullable `chart_specs.analysis_result_id` while preserving the source-backed chart path.

## Invariants

- Source evidence is immutable and project-scoped.
- Accepted DataSnapshots are append-only; historical results are never overwritten.
- Browser rows are derived only from active experiment snapshot heads.
- Fields with incompatible units remain distinct unless a reviewed conversion operation exists.
- Scientific values require source refs and deterministic provenance.
- Browser publish must not create chart proposals, ChartSpecs, or manuscript blocks.
- Source-backed chart creation must not mutate accepted DataSnapshots.
- Analysis plan revisions are immutable apart from explicit status/acceptance metadata.
- Plan acceptance is idempotent and must not execute code or create result/chart artifacts.
- One queued AnalysisRun may be claimed once; expired running claims rotate their internal token, and finalization requires the current token.
- Active experiment heads are verified under the execution-claim transaction before code runs.
- Finalization and optional valid AnalysisResult insertion are atomic.
- Failed execution or result validation must not persist an AnalysisResult.
- Result acceptance is idempotent, must recheck selected active heads, and atomically creates exactly one ChartSpec while linking the accepted result/run/thread.
- Analysis-result ChartSpec list projections must not duplicate full trace arrays into project state; full arrays remain in the immutable stored spec and detail response.
- Placement-local trace visibility belongs to manuscript block payloads, never to a ChartSpec mutation.
