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

### Source-Backed Output Layer

```text
source_extract_proposals
chart_proposal_sets
chart_specs
manuscripts
agent_runs
```

`source_extract_proposals` stores reviewable bounded source selections and interpretation before chart creation.

`chart_proposal_sets` stores proposal/review state. Active proposal creation is source-backed only.

`chart_specs` stores durable source-backed chart definitions. `spec` must contain exact source refs and immutable source snapshot rows/series. It has no accepted-data aggregate foreign key.

`manuscripts` stores blocks, pages, canvas state, and references. Chart blocks carry their own ChartSpec snapshot for stable rendering.

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

`analysis_runs` links one accepted plan revision to an immutable execution attempt. Plan acceptance currently creates only a `queued` row. `(project_id, idempotency_key)` makes acceptance retry-safe.

`analysis_results` and `analysis_publications` establish the append-only/result-publication schema for later executor and result-review milestones. They have no public creation routes yet. `analysis_publications` will key atomic accepted result plus ChartSpec receipts by `(project_id, idempotency_key)`.

`chart_specs.analysis_result_id` is nullable so existing `source_extract` ChartSpecs remain valid. No analysis-result ChartSpec is created by the current persistence milestone.

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

This transaction does not execute Python or create an AnalysisResult/ChartSpec.

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
Migration 012 adds reviewed analysis persistence and nullable `chart_specs.analysis_result_id` while preserving the source-backed chart path.

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
