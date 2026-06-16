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
  - `mapping_set_...`
  - `chart_proposal_set_...`
  - `chart_spec_...`
  - `manuscript_...`
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
              -> dataset_commits
              -> mapping_sets
              -> chart_proposal_sets
              -> chart_specs
              -> manuscripts
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
- Manuscripts should reference chart specs, not chart proposal ids.
- API creation should reject chart specs whose source fields or source refs do not resolve in the referenced dataset commit.
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
mapping_sets(lab_id, project_id)
chart_proposal_sets(lab_id, project_id)
chart_specs(lab_id, project_id)
manuscripts(lab_id, project_id)
audit_events(lab_id, project_id, created_at)
audit_events(actor_user_id, created_at)
```
