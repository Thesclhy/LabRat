# SaaS Database Schema v0

This document defines the first Postgres schema target for LabRat's multi-lab SaaS foundation. It favors clear persistence boundaries and JSONB scientific payloads over premature relational modeling of every experimental field.

## Conventions

- Primary ids are text with prefixes:
  - `user_...`
  - `lab_...`
  - `membership_...`
  - `session_...`
  - `project_...`
  - `file_...`
  - `import_run_...`
  - `commit_...`
  - `source_doc_...`
  - `source_region_...`
  - `source_index_blob_...`
  - `source_extract_proposal_...`
  - `observation_series_...`
  - `analysis_view_...`
  - `mapping_set_...`
  - `chart_proposal_set_...`
  - `chart_spec_...`
  - `manuscript_...`
  - `agent_run_...`
  - `audit_...`
- All lab-scoped scientific data must include `lab_id`.
- Use `created_at` and `updated_at` timestamps on mutable records.
- Use `created_by` / `updated_by` where user attribution matters.
- Use JSONB for complex scientific payloads in v0.
- Raw files are immutable file objects. Derived records reference them.
- Import acceptance creates a dataset commit.
- Accepted chart proposals create chart specs.
- Manuscripts persist blocks, pages, and canvas state.
- Audit events record critical actions.

## Entity Relationship Overview

```text
users
  -> lab_memberships
      -> labs
          -> projects
              -> file_objects
              -> import_runs
              -> source_documents
              -> source_regions
              -> source_extract_proposals
              -> dataset_commits
              -> observation_series
              -> analysis_views
              -> mapping_sets
              -> chart_proposal_sets
              -> chart_specs
              -> manuscripts
              -> agent_runs
          -> audit_events
  -> sessions
```

## `users`

Stores login identities. Users can belong to multiple labs through `lab_memberships`.

Columns:

```text
id text primary key
username text unique not null
display_name text not null
password_hash text not null
is_active boolean not null default true
is_super_admin boolean not null default false
last_login_at timestamptz
created_at timestamptz not null
updated_at timestamptz not null
created_by text references users(id)
```

Notes:

- Auth v0 uses `username + password`.
- Do not add email requirements in v0.
- Password hashes only; never store plaintext.
- `is_super_admin` grants instance-level admin access.

## `labs`

Stores lab/workspace boundaries.

Columns:

```text
id text primary key
name text not null
slug text unique not null
status text not null default 'active'
settings jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
created_by text references users(id)
```

Notes:

- `status` values: `active`, `archived`.
- `settings` can hold lab-level defaults such as unit preferences and chart defaults.

## `lab_memberships`

Maps users to labs and roles.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
user_id text not null references users(id)
role text not null
status text not null default 'active'
created_at timestamptz not null
updated_at timestamptz not null
created_by text references users(id)
unique(lab_id, user_id)
```

Allowed roles:

```text
lab_owner
lab_admin
editor
viewer
```

Notes:

- `super_admin` is represented by `users.is_super_admin`.
- API role checks should combine `is_super_admin` and active membership role.

## `sessions`

Stores server-side sessions for httpOnly cookies.

Columns:

```text
id text primary key
user_id text not null references users(id)
session_token_hash text unique not null
expires_at timestamptz not null
created_at timestamptz not null
last_seen_at timestamptz
ip_address text
user_agent text
revoked_at timestamptz
```

Notes:

- Store a hash of the session token, not the raw token.
- Logout sets `revoked_at`.

## `projects`

Server-backed LabRat projects scoped to one lab.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
name text not null
description text
status text not null default 'active'
current_dataset_commit_id text
metadata jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Notes:

- `current_dataset_commit_id` should point to a row in `dataset_commits` after commits exist.
- `metadata.projectProfile` stores the editable experiment background for the project.
- Keep project metadata focused on project context; scientific data belongs in commits/imports.
- Project profile v0 shape:

```json
{
  "schemaVersion": "labrat.projectProfile.v1",
  "researchGoal": "",
  "experimentBackground": "",
  "materials": "",
  "methods": "",
  "instruments": "",
  "analysisNotes": "",
  "tags": [],
  "updatedAt": "2026-06-14T00:00:00.000Z",
  "updatedBy": "user_..."
}
```

## `file_objects`

Immutable uploaded file versions.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
original_name text not null
mime_type text
extension text
size_bytes bigint not null
checksum_sha256 text not null
storage_provider text not null default 'local'
storage_key text not null
metadata jsonb not null default '{}'
created_at timestamptz not null
created_by text not null references users(id)
unique(project_id, checksum_sha256, original_name)
```

Notes:

- Raw files are immutable.
- Re-uploading identical content can reuse an existing object or create a new reference, but must preserve checksum provenance.

## `import_runs`

Persists scan, review, normalize, and apply state for uploaded files.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
file_object_id text references file_objects(id)
status text not null
scan_result jsonb
normalize_preview jsonb
review_decisions jsonb not null default '{}'
warnings jsonb not null default '[]'
error jsonb
applied_dataset_commit_id text
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Allowed statuses:

```text
uploaded
scanned
review_ready
normalized_preview
applied
rejected
failed
```

Notes:

- `scan_result` can hold the current `labrat.importScan.v1` response.
- `normalize_preview` can hold the current `labrat.importNormalize.v1` response.
- Applying an import creates a dataset commit and sets `applied_dataset_commit_id`.
- Valid v0 lifecycle is `review_ready -> normalized_preview -> applied`, with `rejected` and `failed` as terminal states.
- Applying the same import run twice must not create a second dataset commit.

## `supplemental_import_batches`

Persists multi-workbook supplemental import jobs. Batches prepare reviewable import runs and relationship previews, but do not apply dataset commits.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
status text not null default 'queued'
summary jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Statuses:

```text
queued
processing
ready_for_review
failed
```

## `supplemental_import_batch_items`

Tracks each workbook inside a supplemental batch.

Columns:

```text
id text primary key
batch_id text not null references supplemental_import_batches(id)
lab_id text not null references labs(id)
project_id text not null references projects(id)
file_object_id text not null references file_objects(id)
import_run_id text references import_runs(id)
file_name text not null
status text not null default 'queued'
progress_message text
summary jsonb not null default '{}'
relationship_preview jsonb
warnings jsonb not null default '[]'
error jsonb
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Item statuses:

```text
queued
scanning
normalizing
resolving_relationship
ready_for_review
failed
```

Notes:

- `ready_for_review` items reference normal `import_runs` in `normalized_preview` state.
- Users still apply supplemental imports through reviewed `supplement_import`.
- Failed items preserve file id, error, and warnings so they can be retried.

## `dataset_commits`

Immutable accepted dataset states.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
parent_commit_id text references dataset_commits(id)
source_import_run_ids jsonb not null default '[]'
source_mapping_set_ids jsonb not null default '[]'
dataset_payload jsonb not null
summary jsonb not null default '{}'
warnings jsonb not null default '[]'
created_at timestamptz not null
created_by text not null references users(id)
```

Notes:

- Commits are immutable.
- `dataset_payload` stores the full accepted project dataset state, including all committed `genericImports[]`, not just the latest import patch.
- `parent_commit_id` points to the previous project dataset commit when a new accepted import appends data.
- Future phases can split high-volume field values into relational tables after behavior stabilizes.

## `source_documents`

Persists inspectable source metadata for uploaded files, beginning with Excel workbooks. Implemented by `005_source_documents.sql`.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
file_object_id text references file_objects(id)
import_run_id text references import_runs(id)
document_type text not null default 'excel_workbook'
index_version text not null default 'labrat.sourceIndex.v1'
status text not null default 'indexed'
metadata jsonb not null default '{}'
summary jsonb not null default '{}'
warnings jsonb not null default '[]'
created_at timestamptz not null
updated_at timestamptz not null
created_by text references users(id)
updated_by text references users(id)
unique (project_id, file_object_id)
```

Notes:

- Source documents are evidence records, not dataset commits.
- Do not include large cell grids in project state responses.
- Re-indexing for the same project/file object replaces region/blob index content while preserving the source document id.
- `metadata` stores workbook name, sheet names, sheet bounds, file object/import run refs, checksum, MIME type, and summary sheet metadata.

## `source_regions`

Persists detected regions inside a source document. Implemented by `005_source_documents.sql`.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
source_document_id text not null references source_documents(id)
import_run_id text references import_runs(id)
region_key text
kind text not null
label text
sheet_name text
range_ref text
start_row integer
end_row integer
start_col integer
end_col integer
confidence numeric
signals jsonb not null default '{}'
candidate_fields jsonb not null default '[]'
source_refs jsonb not null default '[]'
warnings jsonb not null default '[]'
status text not null default 'active'
created_at timestamptz not null
updated_at timestamptz not null
created_by text references users(id)
updated_by text references users(id)
```

Notes:

- Region kinds include `standard_table`, `block_table`, `reaction_rate_time_series`, `component_distribution`, `formula_summary`, `calibration_table`, and `unknown_region`.
- Regions are review aids and extraction candidates; they are not accepted dataset values.
- Row/column bounds use the same zero-based indexing as scan cells while `range_ref` keeps Excel-style A1 notation.

## `source_index_blobs`

Stores or points to large source index payloads such as cell grids and search indexes. Implemented by `005_source_documents.sql`.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
source_document_id text not null references source_documents(id)
blob_kind text not null
storage_provider text not null default 'database'
storage_key text
payload jsonb
checksum_sha256 text
created_at timestamptz not null
created_by text references users(id)
```

Notes:

- Use either `storage_key` or `payload`; large blobs should prefer storage pointers.
- Range read APIs must enforce cell-count caps.
- Phase 5 stores Excel cell-grid blobs for bounded source query/range APIs, but project state and source document lists do not expose full grids.

## `source_extract_proposals` Planned

Persists reviewable structured extracts from source regions/ranges.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
source_document_id text references source_documents(id)
source_region_id text references source_regions(id)
dataset_commit_id text references dataset_commits(id)
status text not null default 'proposed'
purpose text
extract_type text
intent jsonb not null default '{}'
preview jsonb not null default '{}'
warnings jsonb not null default '[]'
decision_summary jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Notes:

- V1 source extracts can draft source-backed chart proposals.
- Promotion into dataset commits is deferred.

## `observation_series`

Persists comparable series derived from supplemental observation sets or reviewed source extracts.

Status: implemented for reaction-rate supplemental series.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
dataset_commit_id text references dataset_commits(id)
source_import_id text
observation_set_id text
experiment_id text
experiment_label text
series_kind text not null
x_field text not null
y_field text not null
source_refs jsonb not null default '[]'
summary jsonb not null default '{}'
status text not null default 'active'
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Notes:

- Reaction-rate supplemental workbooks should derive `reaction_rate_time_series` records first.
- APIs may decorate series as stale when `dataset_commit_id` no longer matches the current project dataset commit.

## `analysis_views`

Persists reviewable table/chart-ready analysis intents.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
dataset_commit_id text references dataset_commits(id)
view_type text not null
status text not null default 'draft'
title text
spec jsonb not null default '{}'
source_refs jsonb not null default '[]'
warnings jsonb not null default '[]'
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Notes:

- Implemented for `series_compare`; `source_range_extract`, `data_table`, and `chart_ready` remain planned view types.
- Analysis views are drafts/proposals; they do not mutate dataset commits.

## `mapping_sets`

Persists semantic mapping proposal sets and user decisions.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
import_run_id text references import_runs(id)
dataset_commit_id text references dataset_commits(id)
schema_version text not null
status text not null default 'proposed'
payload jsonb not null
decision_summary jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Notes:

- Keep accepted/rejected mapping decisions separate from raw imports.
- Accepted mappings can guide Browser columns and chart specs without rewriting raw generic imports.

## `chart_proposal_sets`

Persists chart proposals and review decisions.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
dataset_commit_id text references dataset_commits(id)
mapping_set_id text references mapping_sets(id)
schema_version text not null
status text not null default 'proposed'
payload jsonb not null
decision_summary jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Notes:

- Accepted chart proposals should create `chart_specs`.
- Do not insert raw proposals directly into manuscript blocks.

## `chart_specs`

Durable chart definitions that can be rendered in Browser, Manuscript, and PPTX export.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
dataset_commit_id text references dataset_commits(id)
mapping_set_id text references mapping_sets(id)
analysis_view_id text references analysis_views(id)
source_extract_proposal_id text references source_extract_proposals(id)
source_chart_proposal_set_id text references chart_proposal_sets(id)
source_proposal_id text
title text
chart_type text not null
spec jsonb not null
layout jsonb not null default '{}'
warnings jsonb not null default '[]'
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Notes:

- `spec` should reference source fields, generic import ids, dataset commit ids, and units.
- Current dataset-backed specs use ChartSpec v1.3. Planned v1.4-compatible specs may reference `analysis_view_id` or `source_extract_proposal_id`.
- Manuscripts should reference chart specs, not chart proposal ids.
- API creation should reject chart specs whose source fields or source refs do not resolve in the referenced dataset commit.
- Source-backed specs may use immutable `sourceSnapshot` and exact source refs instead of a dataset commit.
- Analysis-view-backed specs may resolve observation series from the current dataset commit.
- Refresh/replace does not delete or mutate older chart specs. APIs may decorate chart specs as stale when their `dataset_commit_id` no longer matches the active dataset, but the database row remains historical evidence.

## `manuscripts`

Persists manuscript canvas state.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
title text not null
status text not null default 'draft'
blocks jsonb not null default '[]'
pages jsonb not null default '[]'
canvas_state jsonb not null default '{}'
references_payload jsonb not null default '[]'
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Notes:

- Chart blocks should reference `chart_specs.id`.
- Preserve existing text/image/chart block shapes through migration helpers.

## `agent_runs` Planned

Persists controlled agent workflow traces.

Columns:

```text
id text primary key
lab_id text not null references labs(id)
project_id text not null references projects(id)
status text not null default 'created'
mode text
user_message text not null
selected_context jsonb not null default '{}'
visible_steps jsonb not null default '[]'
tool_trace jsonb not null default '[]'
analysis_view_id text references analysis_views(id)
proposal_refs jsonb not null default '[]'
actions jsonb not null default '[]'
usage jsonb not null default '{}'
warnings jsonb not null default '[]'
error jsonb
created_at timestamptz not null
updated_at timestamptz not null
created_by text not null references users(id)
updated_by text references users(id)
```

Statuses:

```text
created
planning
retrieving_evidence
drafting_view
drafting_proposal
waiting_for_user
executing_confirmed_action
completed
failed
cancelled
```

Notes:

- `visible_steps` are audit/workflow summaries, not hidden chain-of-thought.
- Planning must not mutate project state.
- Confirmed execution should use existing reviewed APIs and write audit events.

## `audit_events`

Records critical actions.

Columns:

```text
id text primary key
lab_id text references labs(id)
project_id text references projects(id)
actor_user_id text references users(id)
action text not null
target_type text
target_id text
summary text
metadata jsonb not null default '{}'
created_at timestamptz not null
ip_address text
user_agent text
```

Recommended actions:

```text
auth.login
auth.logout
admin.lab.create
admin.user.create
admin.user.update
admin.user.reset_password
project.create
project.update
file.upload
import.scan
import.normalize_preview
import.apply
import.failed
dataset_commit.create
mapping_set.create
mapping_set.update_decision
chart_proposal_set.create
chart_proposal_set.update_decision
chart_spec.create
source.index
source.extract.propose
analysis_view.create
agent_run.create
agent_run.confirm
manuscript.create
manuscript.update
export.pptx
```

Notes:

- Do not store session tokens, passwords, or API keys in audit metadata.
- Prefer concise metadata with ids and summaries over full scientific payload duplication.

## Required Indexes

At minimum:

```text
users(username)
sessions(session_token_hash)
sessions(user_id)
sessions(expires_at)
labs(slug)
lab_memberships(user_id)
lab_memberships(lab_id)
projects(lab_id)
file_objects(lab_id, project_id)
file_objects(checksum_sha256)
import_runs(lab_id, project_id)
dataset_commits(lab_id, project_id)
source_documents(lab_id, project_id)
source_regions(lab_id, project_id)
source_extract_proposals(lab_id, project_id)
observation_series(lab_id, project_id, dataset_commit_id)
analysis_views(lab_id, project_id)
mapping_sets(lab_id, project_id)
chart_proposal_sets(lab_id, project_id)
chart_specs(lab_id, project_id)
manuscripts(lab_id, project_id)
agent_runs(lab_id, project_id, created_at)
audit_events(lab_id, project_id, created_at)
audit_events(actor_user_id, created_at)
```
