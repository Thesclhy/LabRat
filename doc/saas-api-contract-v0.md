# SaaS API Contract v0

This document defines the first authenticated, project-scoped API layer for LabRat. It complements the existing local/dev import endpoints in `doc/backend-api-contract.md`.

## General Rules

- All SaaS APIs use JSON unless file upload is explicitly stated.
- All mutating APIs require an authenticated session.
- Lab-scoped data must be checked against active membership or `super_admin`.
- `viewer` can read but cannot mutate scientific records.
- `editor` can create/edit projects, imports, mappings, chart specs, and manuscripts.
- `lab_admin` and `lab_owner` can manage lab users in addition to editor actions.
- `super_admin` can manage all labs and users.
- Responses should use stable ids with prefixes documented in `doc/saas-database-schema-v0.md`.
- Errors should use a consistent envelope:

```json
{
  "error": {
    "code": "forbidden",
    "message": "You do not have access to this lab."
  }
}
```

## Auth

### `POST /api/auth/login`

Purpose: create a session using `username + password`.

Request:

```json
{
  "username": "labuser",
  "password": "LabRatLab123!"
}
```

Response:

```json
{
  "user": {
    "id": "user_...",
    "username": "labuser",
    "displayName": "Hanqi Test Lab Owner",
    "isSuperAdmin": false
  },
  "labs": [
    {
      "labId": "lab_...",
      "name": "Hanqi Test Lab",
      "slug": "hanqi-test-lab",
      "role": "lab_owner"
    }
  ]
}
```

Rules:

- Set an httpOnly session cookie.
- Do not return password hashes.
- Write `auth.login` audit event on success.

### `POST /api/auth/logout`

Purpose: revoke the current session.

Response:

```json
{
  "ok": true
}
```

Rules:

- Revoke server-side session row.
- Clear session cookie.
- Write `auth.logout` audit event when a session existed.

### `GET /api/auth/me`

Purpose: return the current authenticated user and lab memberships.

Response:

```json
{
  "user": {
    "id": "user_...",
    "username": "labuser",
    "displayName": "Hanqi Test Lab Owner",
    "isSuperAdmin": false
  },
  "labs": [
    {
      "labId": "lab_...",
      "name": "Hanqi Test Lab",
      "slug": "hanqi-test-lab",
      "role": "lab_owner"
    }
  ]
}
```

## Admin

### `GET /api/admin/labs`

Required role: `super_admin`.

Response:

```json
{
  "labs": [
    {
      "id": "lab_...",
      "name": "Hanqi Test Lab",
      "slug": "hanqi-test-lab",
      "status": "active",
      "createdAt": "2026-06-14T00:00:00.000Z"
    }
  ]
}
```

### `POST /api/admin/labs`

Required role: `super_admin`.

Request:

```json
{
  "name": "Hanqi Test Lab",
  "slug": "hanqi-test-lab"
}
```

Response:

```json
{
  "lab": {
    "id": "lab_...",
    "name": "Hanqi Test Lab",
    "slug": "hanqi-test-lab",
    "status": "active"
  }
}
```

### `GET /api/admin/users`

Required role: `super_admin` for all users, or `lab_owner` / `lab_admin` when filtered to the caller's lab.

Query:

```text
?labId=lab_...
```

Response:

```json
{
  "users": [
    {
      "id": "user_...",
      "username": "labuser",
      "displayName": "Hanqi Test Lab Owner",
      "isActive": true,
      "isSuperAdmin": false,
      "memberships": [
        {
          "labId": "lab_...",
          "role": "lab_owner",
          "status": "active"
        }
      ]
    }
  ]
}
```

### `POST /api/admin/users`

Required role: `super_admin`, `lab_owner`, or `lab_admin`.

Request:

```json
{
  "username": "new_editor",
  "displayName": "New Editor",
  "temporaryPassword": "ChangeMe123!",
  "labId": "lab_...",
  "role": "editor",
  "isSuperAdmin": false
}
```

Response:

```json
{
  "user": {
    "id": "user_...",
    "username": "new_editor",
    "displayName": "New Editor",
    "isActive": true
  },
  "membership": {
    "labId": "lab_...",
    "role": "editor",
    "status": "active"
  }
}
```

Rules:

- Lab admins cannot create `super_admin` users.
- Lab admins cannot create users outside their lab.
- Write `admin.user.create` audit event.

### `PATCH /api/admin/users/:userId`

Purpose: update display name, active status, or lab role.

Request:

```json
{
  "displayName": "Updated Name",
  "isActive": true,
  "memberships": [
    {
      "labId": "lab_...",
      "role": "editor",
      "status": "active"
    }
  ]
}
```

### `POST /api/admin/users/:userId/reset-password`

Purpose: set a temporary password for v0 admin-created accounts.

Request:

```json
{
  "temporaryPassword": "NewTemp123!"
}
```

Response:

```json
{
  "ok": true
}
```

Rules:

- Return no password hash.
- Write `admin.user.reset_password` audit event.
- Email reset flow is out of scope.

## Labs

### `GET /api/labs`

Purpose: list labs visible to the current user.

Response:

```json
{
  "labs": [
    {
      "id": "lab_...",
      "name": "Hanqi Test Lab",
      "slug": "hanqi-test-lab",
      "role": "lab_owner"
    }
  ]
}
```

## Projects

Project records are server-first. The project profile is the editable experiment background stored in `projects.metadata.projectProfile`.

Project profile shape:

```json
{
  "schemaVersion": "labrat.projectProfile.v1",
  "researchGoal": "Study gas selectivity across catalysts.",
  "experimentBackground": "Batch reactor screening campaign.",
  "materials": "Ru/TiO2 and HDPE.",
  "methods": "Hydrogenolysis screening.",
  "instruments": "GC-FID, Parr reactor.",
  "analysisNotes": "Use reviewed generic imports only.",
  "tags": ["screening", "selectivity"],
  "updatedAt": "2026-06-14T00:00:00.000Z",
  "updatedBy": "user_..."
}
```

### `GET /api/projects`

Query:

```text
?labId=lab_...
```

Response:

```json
{
  "projects": [
    {
      "id": "project_...",
      "labId": "lab_...",
      "name": "Blank Project",
      "description": "",
      "currentDatasetCommitId": "commit_...",
      "projectProfile": {},
      "updatedAt": "2026-06-14T00:00:00.000Z"
    }
  ]
}
```

### `POST /api/projects`

Required role: `editor` or above.

Request:

```json
{
  "labId": "lab_...",
  "name": "New Project",
  "description": "Optional project description",
  "projectProfile": {
    "researchGoal": "Study gas selectivity."
  }
}
```

Response:

```json
{
  "project": {
    "id": "project_...",
    "labId": "lab_...",
    "name": "New Project",
    "description": "Optional project description",
    "currentDatasetCommitId": null,
    "projectProfile": {}
  }
}
```

### `GET /api/projects/:projectId`

Response:

```json
{
  "project": {
    "id": "project_...",
    "labId": "lab_...",
    "name": "New Project",
    "description": "Optional project description",
    "currentDatasetCommitId": "commit_...",
    "metadata": {},
    "projectProfile": {}
  },
  "currentDatasetCommit": {
    "id": "commit_...",
    "datasetPayload": {}
  }
}
```

### `PATCH /api/projects/:projectId`

Required role: `editor` or above.

Request:

```json
{
  "name": "Updated Project",
  "description": "Updated description",
  "status": "active",
  "projectProfile": {
    "researchGoal": "Updated goal.",
    "tags": ["updated"]
  }
}
```

Rules:

- `projectProfile` is merged into `projects.metadata.projectProfile`.
- Updating `projectProfile` must not erase unrelated `projects.metadata` keys.
- `viewer` can read project records; `editor` or above can update them.
- Project update writes a `project.update` audit event with changed fields.

### `PATCH /api/projects/:projectId/profile`

Purpose: update only the editable experiment background.

Required role: `editor` or above.

Request:

```json
{
  "researchGoal": "Study gas selectivity.",
  "experimentBackground": "Batch reactor screening.",
  "materials": "Ru/TiO2 and HDPE.",
  "methods": "Hydrogenolysis screening.",
  "instruments": "GC-FID",
  "analysisNotes": "Focus on gas/liquid/solid selectivity.",
  "tags": ["selectivity"]
}
```

Response:

```json
{
  "project": {},
  "projectProfile": {}
}
```

Rules:

- Merge into `projects.metadata.projectProfile`.
- Preserve unrelated `projects.metadata` keys.
- Write `project.update` audit event.

### `GET /api/projects/:projectId/state`

Purpose: load one project as the server source of truth.

Response:

```json
{
  "project": {},
  "projectProfile": {},
  "currentDatasetCommit": {},
  "datasetCommits": [],
  "fileObjects": [],
  "importRuns": [],
  "mappingSets": [],
  "chartProposalSets": [],
  "chartSpecs": [],
  "manuscripts": []
}
```

Rules:

- Required role: `viewer` or above.
- The response is scoped to one project and must not include records from another project or lab.
- `currentDatasetCommit` includes the full current commit payload; list arrays may be used for UI state and review history.
- `chartSpecs[]` may include response-time staleness decoration such as `isStale`, `status: "stale"`, and `staleReason` when a chart spec references an older dataset commit after refresh/replace. Do not delete historical chart specs just because they are stale.

### `POST /api/projects/:projectId/ai/context`

Purpose: build compact context for project-scoped AI features without calling AI or writing database rows.

Required role: `viewer` or above.

Request:

```json
{
  "selectedImportIds": [],
  "selectedExperimentIds": []
}
```

Response:

```json
{
  "schemaVersion": "labrat.projectAiContext.v1",
  "project": {},
  "projectProfile": {},
  "currentDatasetCommitId": "commit_...",
  "sourceImportIds": [],
  "fieldInventory": [],
  "acceptedMappings": [],
  "priorChartDecisions": [],
  "existingCharts": [],
  "manuscripts": [],
  "warnings": []
}
```

Rules:

- Build `fieldInventory` from `currentDatasetCommit.datasetPayload.genericImports`.
- Include accepted mapping decisions from persisted `mapping_sets`.
- Include prior accepted/rejected chart decisions from `chart_proposal_sets`.
- Do not include raw workbook payloads or internal service input.

### `POST /api/projects/:projectId/charts/interpret`

Purpose: turn one user prompt into a validated ChartSpec draft using the current project dataset and mappings.

Required role: `viewer` or above for preview; `editor` or above when `persistAsProposal` is true.

Request:

```json
{
  "prompt": "plot gas selectivity vs temperature grouped by catalyst",
  "selectedImportIds": [],
  "selectedExperimentIds": [],
  "chartConstraints": {},
  "persistAsProposal": false
}
```

Response:

```json
{
  "schemaVersion": "labrat.chartInterpretResponse.v1",
  "chartSpecDraft": {},
  "clarification": null,
  "warnings": [],
  "chartProposalSet": {}
}
```

Rules:

- `chartProposalSet` is present only when `persistAsProposal` is true and a draft was produced.
- Default behavior is preview-only and does not write database rows.
- Return `409 dataset_commit_required` when the project has no current dataset commit.
- Does not create `chart_specs`; accepted charts still use chart-spec creation.

### `POST /api/projects/:projectId/charts/propose`

Purpose: automatically create reviewable chart recommendations from the current project dataset.

Required role: `editor` or above.

Request:

```json
{
  "userGoal": "Find useful selectivity charts",
  "selectedImportIds": [],
  "selectedExperimentIds": [],
  "chartConstraints": {}
}
```

Response:

```json
{
  "chartProposalSet": {},
  "proposalSet": {},
  "summary": {},
  "warnings": []
}
```

Rules:

- Reads project profile, current dataset commit, persisted mapping sets, and prior chart decisions.
- Builds field/data profiles before proposing charts, including coverage, spread, missingness, categorical cardinality, and paired x/y counts.
- Proposal payloads may include additive `origin`, `score`, `scoreBreakdown`, `insight`, and compact `aiIntent` fields.
- AI may suggest chart intents only; backend must resolve and validate all fields against the current dataset before returning proposals.
- Invalid or unresolved AI intents are discarded with warnings rather than saved as proposals.
- Persists one `chart_proposal_sets` row by default.
- Return `409 dataset_commit_required` when the project has no current dataset commit.
- Does not create `chart_specs`; accepted proposals must become chart specs before manuscript insertion.

## Files And Import Runs

### `GET /api/projects/:projectId/files`

Response:

```json
{
  "fileObjects": []
}
```

### `POST /api/projects/:projectId/files`

Purpose: upload an immutable raw file object.

Request:

- `multipart/form-data`
- `file`: workbook, CSV, or instrument file

Response:

```json
{
  "fileObject": {
    "id": "file_...",
    "projectId": "project_...",
    "originalName": "MasterTable_updated.xlsx",
    "sizeBytes": 123456,
    "checksumSha256": "..."
  }
}
```

### `POST /api/projects/:projectId/import-runs`

Purpose: create an import run from an uploaded file and run scan.

Request:

```json
{
  "fileObjectId": "file_..."
}
```

Response:

```json
{
  "importRun": {
    "id": "import_run_...",
    "projectId": "project_...",
    "fileObjectId": "file_...",
    "status": "review_ready",
    "scanResult": {},
    "warnings": []
  }
}
```

Rules:

- Wrap the existing scan logic.
- Persist the scan result.
- Write `import.scan` audit event.

### `GET /api/projects/:projectId/import-runs`

Response:

```json
{
  "importRuns": []
}
```

### `POST /api/import-runs/:id/normalize-preview`

Purpose: create a reviewable normalization preview from approved structures/mappings.

Request:

```json
{
  "approvedBlockIds": ["sheet_1_block_1"],
  "approvedStructures": {},
  "fieldRoleOverrides": {},
  "mappingOverrides": {}
}
```

Response:

```json
{
  "importRun": {
    "id": "import_run_...",
    "status": "normalized_preview",
    "normalizePreview": {}
  }
}
```

Rules:

- Wrap existing `POST /api/import/normalize` behavior.
- Do not mutate the active project dataset.
- Allowed only when the import run status is `review_ready` or `normalized_preview`.
- Return `409 invalid_import_run_transition` for `applied`, `rejected`, `failed`, or otherwise invalid statuses.
- Processing failures move the import run to `failed` and write an `import.failed` audit event.

### `POST /api/import-runs/:id/refresh-preview`

Purpose: compare a normalized replacement import against one active import in the current project dataset without writing database state.

Request:

```json
{
  "replaceImportId": "import_...",
  "expectedParentDatasetCommitId": "commit_..."
}
```

Response:

```json
{
  "schemaVersion": "labrat.importRefreshPreview.v1",
  "targetImportId": "import_old",
  "replacementImportId": "import_new",
  "parentDatasetCommitId": "commit_current",
  "hasChanges": true,
  "summary": {
    "experimentsAdded": 0,
    "experimentsRemoved": 0,
    "experimentsChanged": 4,
    "fieldsAdded": 1,
    "fieldsRemoved": 0,
    "valuesChanged": 12,
    "warningsChanged": 0
  },
  "warnings": []
}
```

Rules:

- Required role: `editor` or above for the import run's lab.
- The import run must already be in `normalized_preview`.
- The current project commit must match `expectedParentDatasetCommitId`; otherwise return `409 dataset_commit_conflict`.
- The selected `replaceImportId` must exist in the current dataset commit; otherwise return `404 refresh_target_not_found`.
- The normalized replacement must contain exactly one `datasetPatch.genericImports[]` item.
- This route is read-only and does not write audit events, import-run decisions, or dataset commits.

### `POST /api/import-runs/:id/apply`

Purpose: accept a normalized preview and create a full merged dataset commit.

Request:

```json
{
  "applyMode": "append",
  "reviewNote": "Approved MasterTable import."
}
```

Refresh replacement request:

```json
{
  "applyMode": "replace_import",
  "replaceImportId": "import_...",
  "expectedParentDatasetCommitId": "commit_...",
  "reviewNote": "Uploaded corrected MasterTable after updating selectivity values."
}
```

Response:

```json
{
  "datasetCommit": {
    "id": "commit_...",
    "projectId": "project_...",
    "parentCommitId": "commit_...",
    "summary": {
      "createdExperiments": 61,
      "createdFields": 793,
      "createdMeasurements": 183,
      "warningCount": 0
    }
  },
  "project": {
    "id": "project_...",
    "currentDatasetCommitId": "commit_..."
  }
}
```

Rules:

- Create immutable `dataset_commits` row.
- Update `projects.current_dataset_commit_id`.
- The new commit payload is the full current dataset state: parent commit payload plus the accepted `datasetPatch`.
- Append `datasetPatch.genericImports[]` by `importId`; reject duplicates with `409 duplicate_import_already_committed`.
- Default `applyMode` is `append`.
- `applyMode: "replace_import"` creates a new full dataset state where one active `genericImports[]` item is replaced by the normalized replacement import.
- Refresh apply annotates the replacement import with `refreshOfImportId` and `refreshMetadata`, and records replacement details in `datasetCommit.summary`.
- Refresh apply preserves the parent commit unchanged; old data remains available through commit history.
- Refresh apply returns `409 refresh_no_changes_detected` if the uploaded replacement does not change active experiment/field/warning data.
- Refresh apply returns `409 dataset_commit_conflict` if the current project commit no longer matches `expectedParentDatasetCommitId`.
- Refresh apply returns `404 refresh_target_not_found` if `replaceImportId` is not active in the current dataset commit.
- Preserve previous committed generic imports, mappings, chart proposals, curated experiments, sources, and other dataset payload keys.
- Allowed only from `normalized_preview`.
- A second apply returns `409 import_run_already_applied` and does not create another commit.
- Append apply writes `import.apply` and `dataset_commit.create` audit events.
- Refresh apply writes `import.refresh_apply` and `dataset_commit.create` audit events.

## Dataset Commits

### `GET /api/projects/:projectId/dataset-commits`

Response:

```json
{
  "datasetCommits": []
}
```

Rules:

- Required role: `viewer` or above.
- Dataset commits are immutable accepted scientific states.

## Mapping Sets

### `GET /api/projects/:projectId/mapping-sets`

Response:

```json
{
  "mappingSets": []
}
```

### `POST /api/projects/:projectId/mapping-sets`

Required role: `editor` or above.

Request:

```json
{
  "importRunId": "import_run_...",
  "datasetCommitId": "commit_...",
  "schemaVersion": "labrat.semanticMappingResponse.v1",
  "status": "proposed",
  "payload": {},
  "decisionSummary": {}
}
```

### `PATCH /api/mapping-sets/:mappingSetId`

Required role: `editor` or above.

Request:

```json
{
  "status": "accepted",
  "payload": {},
  "decisionSummary": {
    "accepted": 1,
    "rejected": 0
  }
}
```

Rules:

- Mapping decisions are stored separately from raw imports and dataset commits.
- Updates write `mapping_set.update_decision` audit events.

## Chart Proposal Sets

### `GET /api/projects/:projectId/chart-proposal-sets`

Response:

```json
{
  "chartProposalSets": []
}
```

### `POST /api/projects/:projectId/chart-proposal-sets`

Required role: `editor` or above.

Request:

```json
{
  "datasetCommitId": "commit_...",
  "mappingSetId": "mapping_set_...",
  "schemaVersion": "labrat.chartProposalSet.v1",
  "status": "proposed",
  "payload": {},
  "decisionSummary": {}
}
```

### `PATCH /api/chart-proposal-sets/:chartProposalSetId`

Required role: `editor` or above.

Request:

```json
{
  "status": "accepted",
  "payload": {},
  "decisionSummary": {
    "accepted": 1,
    "rejected": 0
  }
}
```

Rules:

- Chart proposal decisions are review state.
- Accepted chart proposals should still become `chart_specs` before manuscript insertion.
- Updates write `chart_proposal_set.update_decision` audit events.

## Chart Specs

### `POST /api/projects/:projectId/chart-specs/from-proposal`

Purpose: turn an accepted chart proposal into a durable chart spec.

Request:

```json
{
  "chartProposalSetId": "chart_proposal_set_...",
  "proposalId": "chart_1",
  "datasetCommitId": "commit_...",
  "layout": {}
}
```

Response:

```json
{
  "chartSpec": {
    "id": "chart_spec_...",
    "projectId": "project_...",
    "datasetCommitId": "commit_...",
    "sourceChartProposalSetId": "chart_proposal_set_...",
    "sourceProposalId": "chart_1",
    "chartType": "scatter",
    "title": "Selectivity Gas vs Temperature",
    "spec": {},
    "layout": {},
    "isStale": false,
    "status": "active",
    "staleReason": null
  }
}
```

Rules:

- A chart spec is the insertion target for manuscripts.
- Do not insert raw chart proposals into manuscripts.
- Requires a current or requested project-owned dataset commit.
- Saves `chart_specs.spec` as normalized `labrat.chartSpec.v1.2`.
- Validates the chart type and required x/y fields before saving.
- Supported v1.2 chart types are `scatter`, `point`, `bar`, `grouped_bar`, `stacked_bar`, and `distribution_bar`.
- `grouped_bar`, `stacked_bar`, and `distribution_bar` require `yFields[]` with at least two resolved fields.
- Validates allowlisted chart-local `transforms[]`; transform inputs must resolve in the dataset commit and do not mutate scientific dataset payloads.
- Validates source field ids and source refs against the dataset commit payload.
- Return `409 dataset_commit_required` when no dataset commit is available.
- Return `400 invalid_chart_spec` for unsupported or incomplete chart specs.
- Return `400 chart_source_unresolved` when a chart references fields or source refs not present in the dataset commit.
- Write `chart_spec.create` audit event.

### `GET /api/projects/:projectId/chart-specs`

Response:

```json
{
  "chartSpecs": [
    {
      "id": "chart_spec_...",
      "datasetCommitId": "commit_...",
      "isStale": false,
      "status": "active",
      "staleReason": null
    }
  ]
}
```

Rules:

- Return project-owned chart specs only.
- Decorate chart specs as stale when their `datasetCommitId` no longer matches the active/reachable current dataset after refresh/replace.
- Stale chart specs remain historical records and existing manuscript snapshots may still render them.

## Manuscripts

### `GET /api/projects/:projectId/manuscripts`

Response:

```json
{
  "manuscripts": [
    {
      "id": "manuscript_...",
      "projectId": "project_...",
      "title": "Group Meeting",
      "status": "draft",
      "updatedAt": "2026-06-14T00:00:00.000Z"
    }
  ]
}
```

### `POST /api/projects/:projectId/manuscripts`

Required role: `editor` or above.

Request:

```json
{
  "title": "Group Meeting",
  "blocks": [],
  "pages": [],
  "canvasState": {},
  "references": []
}
```

### `PATCH /api/manuscripts/:manuscriptId`

Required role: `editor` or above.

Request:

```json
{
  "title": "Updated Group Meeting",
  "blocks": [],
  "pages": [],
  "canvasState": {},
  "references": []
}
```

Rules:

- Persist chart blocks by chart spec id.
- Preserve existing canvas block shape through migration helpers.
- Write `manuscript.create` or `manuscript.update` audit events.

## Compatibility Endpoints

The current stateless local endpoints remain available during the migration:

```text
GET  /health
POST /api/import/scan
POST /api/import/normalize
POST /api/import/semantic-map
POST /api/charts/propose
POST /api/charts/interpret
```

These endpoints are documented in `doc/backend-api-contract.md`. New SaaS code should wrap their core scan/normalize/proposal services in authenticated project-scoped APIs instead of replacing the parser first.
