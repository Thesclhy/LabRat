# SaaS Database Schema v0

Status: active
Last reviewed: 2026-08-18

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
workbook_review_regions
region_understanding_revisions
```

`workbook_review_sessions` groups review activity for one SourceDocument and stores bounded summary/messages/warnings/version metadata. It has no aggregate understanding or workbook-wide accepted state.

`workbook_review_sessions.status = deleted` is the project-facing workbook
removal boundary. Deleting a session atomically marks its active
`workbook_review_regions` deleted so the workbook cannot supply new accepted
evidence, while retaining immutable SourceDocument, revision, audit, accepted
snapshot, and chart history.

`workbook_review_regions` stores stable source ownership, sheet/range,
selection method, a bounded initial `interpretation_hint`,
active/ignored/deleted disposition, review status, optimistic version, and
current/accepted revision pointers. The hint allows deferred pending work to
resume without browser-only state. `region_understanding_revisions` stores
immutable numbered AI/user-feedback interpretations with summary, typed
semantics, source refs, source/dependency hashes, validation, provider
metadata, warnings, and confidence. Accepting one exact revision does not
create accepted experiment data.

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

### Shared Browser State And Historical Views

```text
project_browser_configs
browser_views
experiment_annotations
experiment_custom_columns
experiment_custom_values
```

`project_browser_configs` has one row per project and is the authoritative live
Experiment Browser presentation state shared by project members. Its versioned
payload stores label overrides, visibility, order, widths, filters, and sort
only. Optimistic version checks prevent stale-session overwrites. Editors may
write; viewers read.

BrowserViews remain scoped by `(lab_id, project_id, owner_user_id)` as
historical publication/view provenance. Their payload cannot contain
authoritative scientific values, and they no longer drive the active Browser
UI.

`experiment_annotations` has at most one row per `(project_id, user_id,
experiment_id)`. It stores a bounded personal note and one of six highlight
colors. Reads and writes always include the authenticated `user_id`; annotation
and author information are not shared with other project members. These rows
are personal presentation metadata and never modify scientific records.

`experiment_custom_columns` stores shared project documentation-column
definitions with versioned labels. `experiment_custom_values` stores bounded
text keyed uniquely by `(project_id, custom_column_id, experiment_id)` with a
version and actor timestamps. Both are editable by project editors and readable
by project viewers. They are not accepted scientific values and never modify a
DataSnapshot; deleting a definition cascades only its custom values.

### Evidence-Backed Output Layer

```text
chart_specs
manuscripts
agent_runs
```

`chart_specs` stores durable `origin: analysis_result` chart definitions. Each
spec uses `labrat.chartSpec.v3`, sets `analysis_result_id`, and contains exact
analysis artifact ids, reviewed workbook and/or active-experiment selections,
complete validated Plotly `data/layout`, a matching flat trace catalog, and
reviewed default trace visibility. Frozen experiment selections carry their
base snapshot-head refs so publication can reject concurrent head changes.
There is no proposal or aggregate dataset foreign key.

`manuscripts` stores blocks, pages, canvas state, and references. Chart blocks carry their own complete ChartSpec snapshot plus placement-local `chartView.visibleTraceIds` for stable independent rendering and export.

`agent_runs` stores visible workflow steps, summarized tool observations, review-gated actions, usage metadata, and status. It does not store hidden chain-of-thought.

### Reusable Chart Layer

Migration 024 implements these Milestone 2 tables:

```text
chart_style_profiles
chart_style_profile_versions
reusable_chart_templates
reusable_chart_template_versions
```

Migration 025 implements the Milestone 3 binding/application tables:

```text
reusable_chart_template_slot_bindings
reusable_chart_template_applications
```

Migration 026 adds nullable `analysis_threads.input_mode`, constrained to
`experiment_browser | workbook`. New chart workflows persist one explicit
mode; null remains valid only so historical immutable threads are not rewritten.

Profile/template containers own project-scoped names, logical status, and
current-version pointers. Accepted version payloads are immutable and
content-hashed. A template version pins one accepted source ChartSpec and
accepted style version plus input-slot, recipe, encoding, missing-data, and
geometry contracts. It contains no experiment values, Plotly arrays, prompt,
or executable code.

Slot bindings are append-only user-reviewed decisions scoped to one project,
template version, and stable input/source signature. Applications are
idempotency receipts for exact template version, experiment snapshot heads,
and bindings; they point to normal analysis artifacts and never duplicate the
AnalysisResult.

Workbook chart templates (slot `sourceKind: "linked_region"`) reuse these
tables without a migration: `frozen_head_refs` stays empty and the frozen
region revisions live as `frozenRegionRefs` inside the application's
`compatibility` JSON, which the row mapper exposes as
`application.frozenRegionRefs`. Slot payloads may carry
`seriesContract.seriesSelector`; workbook review regions gain no new columns
beyond the `linked_experiment_id` and `data_kind` added by migration 028.

Reference chart files remain presentation assets through FileObject linkage;
they are not SourceDocuments or scientific evidence. See
`doc/contracts/reusable-chart-template-contract-v1.md` before changing this
layer.

### Reviewed Analysis Layer

```text
analysis_threads
analysis_plan_revisions
analysis_thread_retry_receipts
analysis_runs
analysis_results
analysis_publications
analysis_experiment_publications
```

`analysis_threads` is the durable project-scoped conversation/workflow
container. It stores bounded visible messages, ordered artifact ids, and the
explicit chart input mode, not full result arrays in project state.

`analysis_plan_revisions` is append-only except for workflow status. Each row
stores one complete reviewed `outputTarget + inputMode + sourceSelections +
experimentSelections + reviewPlan + displayPlan`
payload, derived source rectangles, validation, feedback, and actor timestamps.
It stores no Python, materialized values, field mapping, expected result table,
or plan/selection/dependency/program review hashes.
`(analysis_thread_id, revision)` is unique.

`analysis_thread_retry_receipts` makes evidence-recovery planning durable and provider-call idempotent. `(project_id, idempotency_key)` is unique; each receipt binds the requesting actor, thread, and request hash, records `drafting`, `retryable`, or `completed`, and points completed work to exactly one AnalysisPlanRevision. A six-minute drafting lease prevents concurrent provider calls while allowing an abandoned claim to be recovered. If a revision was durably created before receipt completion, the next replay reconciles the receipt from the thread's current plan revision instead of calling the provider again.

`analysis_runs` links one accepted plan revision to an immutable execution
attempt. Plan acceptance creates a `queued` row without Python. Execution
re-resolves accepted source selections and frozen experiment heads, materializes
the exact multi-table/experiment input, generates policy-checked Python against
that input, and moves the run
through `running` to `failed`, `validation_failed`, or
`awaiting_result_review`. Running claims carry an internal token and lease
metadata so an expired worker may be replaced without allowing the old worker
to finalize. The run records the materialized input, generated Python,
input/program/runtime hashes, execution phases, diagnostics, warnings, and
validation. `(project_id, idempotency_key)` makes acceptance retry-safe.
An explicit generation retry creates another immutable queued row referencing
the same accepted plan and records `retryOfAnalysisRunId` in its bounded
payload; the failed predecessor is never reset or overwritten. The
onboarding-only direct source mapper is recorded as the run's execution
strategy and uses the same result/finalization tables, so no parallel accepted
data model or migration is introduced.

`analysis_results` stores only backend-validated immutable executor output. A valid run finalization inserts one `awaiting_review` result in the same transaction that updates its AnalysisRun and AnalysisThread; failed or invalid output inserts no result. Result publication updates only acceptance workflow metadata, never the immutable result payload/hashes. `analysis_publications` records the atomic accepted-result plus ChartSpec boundary. `analysis_experiment_publications` records the accepted-result plus DataSnapshot v3 and BrowserView boundary. Both are keyed by `(project_id, idempotency_key)`.

`chart_specs.analysis_result_id` identifies the accepted AnalysisResult that owns the complete validated trace catalog in the immutable spec.

## Transaction Boundary

Publishing an accepted Experiment Browser analysis result is one atomic operation:

```text
lock thread, revision, run, result, and idempotency key
  -> verify exact validated AnalysisResult
  -> verify every frozen base snapshot head is unchanged
  -> resolve reviewed identity decisions
  -> merge record patches with complete active records
  -> create immutable DataSnapshot v3
  -> create/reuse reviewed ExperimentIdentities
  -> advance affected ExperimentSnapshotHeads
  -> create one owner-scoped BrowserView
  -> accept result and complete run/thread
  -> store analysis_experiment_publications receipt
  -> record audit event
```

Any failure rolls back all durable writes.

Accepting an analysis plan is a separate atomic operation:

```text
lock project/idempotency key
  -> verify current awaiting-review revision
  -> verify every source selection still belongs to its active accepted region
  -> mark revision accepted
  -> create one queued AnalysisRun
  -> update AnalysisThread artifact ids/status
  -> record audit event
```

This transaction does not generate or execute Python and does not create an
AnalysisResult, ChartSpec, or DataSnapshot. A later explicit execution
transaction claims only that queued run, materializes selected SourceDocument
ranges and/or active experiment fields, generates and policy-checks Python,
validates target-specific Plotly or record-patch output, and may create one
awaiting-review AnalysisResult.

Accepting a validated analysis result is another atomic operation:

```text
lock project/idempotency key
  -> lock current thread, accepted plan, awaiting-result-review run, and awaiting-review result
  -> verify exact AnalysisResult id and reviewed visible trace ids
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
007_agent_runs.sql
008_workbook_review_sessions.sql
009_workbook_understandings.sql
010_data_plan_experiment_browser.sql
011_drop_legacy_dataset_path.sql
012_analysis_workflow.sql
013_region_understandings.sql
014_drop_aggregate_workbook_understanding.sql
015_analysis_retry_receipts.sql
016_drop_legacy_chart_proposals.sql
017_reset_analysis_v2.sql
018_deferred_region_interpretation.sql
019_experiment_browser_analysis.sql
```

Migration 011 removes the obsolete aggregate dataset, mapping, analysis-view, and observation-series tables/foreign keys from development databases. New databases never need those product paths.
Migration 012 adds reviewed analysis persistence, publication receipts, and `chart_specs.analysis_result_id`.
Migration 013 adds stable review regions and immutable region-understanding revisions. Migration 014 intentionally drops the obsolete aggregate `workbook_understandings` table and embedded session understanding/region columns; development has no legacy migration or dual-write requirement.
Migration 015 adds project-scoped analysis-thread retry receipts, provider-call leases, and completed-revision replay for durable `Retry with published data` idempotency.
Migration 016 drops the retired source-extract/chart-proposal tables and ChartSpec proposal columns.
Migration 017 removes development-time analysis artifacts and drops the retired
AnalysisSelection, pre-acceptance Python, expected-output, runtime, and plan
hash columns from `analysis_plan_revisions`.

## Invariants

- Source evidence is immutable and project-scoped.
- Accepted DataSnapshots are append-only; historical results are never overwritten.
- Browser rows are derived only from active experiment snapshot heads.
- Fields with incompatible units remain distinct unless a reviewed conversion operation exists.
- Scientific values require source refs and deterministic provenance.
- Browser publish must not create ChartSpecs or manuscript blocks.
- Analysis plan revisions are immutable apart from explicit status/acceptance metadata.
- Plan acceptance is idempotent and must not execute code or create result/chart artifacts.
- Evidence-recovery retry requires a valid idempotency key. Same-key/same-request replay returns one existing revision, conflicting reuse is rejected, and an active six-minute drafting lease permits only one provider call per thread.
- One queued AnalysisRun may be claimed once; expired running claims rotate their internal token, and finalization requires the current token.
- Active experiment heads are verified under the execution-claim transaction before code runs.
- Finalization and optional valid AnalysisResult insertion are atomic.
- Failed execution or result validation must not persist an AnalysisResult.
- Result acceptance is idempotent, requires the exact result id plus a non-empty
  known curve set, and atomically creates exactly one ChartSpec while linking
  the accepted result/run/thread.
- Analysis-result ChartSpec list projections must not duplicate full trace arrays into project state; full arrays remain in the immutable stored spec and detail response.
- Placement-local trace visibility belongs to manuscript block payloads, never to a ChartSpec mutation.
- Reusable template/profile edits create immutable later versions; historical
  ChartSpecs pin exact lineage and never restyle or recalculate.
- Template application may auto-bind only exact stable identity or an unchanged
  prior reviewed binding. Ambiguous scientific meaning is a blocker.
- `chart_template_v1` execution creates a normal validated AnalysisResult and
  cannot directly create a ChartSpec.
