# Server Project State Plan

This document defines the server source-of-truth model for logged-in LabRat workspaces. It replaces older local-project migration guidance. Do not build compatibility migrations for old IndexedDB, `.labrat.json`, or previous local project shapes unless the user explicitly reopens that requirement.

## Server Source Of Truth

A logged-in project is loaded from:

```text
GET /api/projects/:projectId/state
```

The response contains the project shell, editable project profile, current dataset commit, and all project-owned scientific/review records:

```text
project
projectProfile
currentDatasetCommit
datasetCommits
fileObjects
importRuns
mappingSets
chartProposalSets
chartSpecs
manuscripts
```

Frontend server mode should treat this response as the state to reload after imports, refreshes, mapping decisions, chart proposal decisions, chart spec creation, and manuscript saves.

## Project Profile

Experiment background is stored in `projects.metadata.projectProfile`.

```text
schemaVersion
researchGoal
experimentBackground
materials
methods
instruments
analysisNotes
tags
updatedAt
updatedBy
```

Use `POST /api/projects` for the initial profile and `PATCH /api/projects/:projectId/profile` for profile-only updates. Profile updates merge into existing project metadata and write `project.update` audit events.

## Scientific State

- Raw uploaded files are immutable `file_objects`.
- Import review and apply lifecycle is stored in `import_runs`.
- Accepted dataset states are immutable `dataset_commits`.
- Semantic review decisions are stored in `mapping_sets`.
- Chart review decisions are stored in `chart_proposal_sets`.
- Durable chart definitions are stored in `chart_specs`.
- Manuscript canvas state is stored in `manuscripts`.
- Supplemental workbook relationships are review proposals on import runs and become linked generic imports inside new dataset commits after approval.

Scientific data v0 remains JSONB-first inside commits/imports/review records. Do not split generic fields into relational experiment/measurement tables in this pass.

## Import Apply

Accepted normalize previews create a new full dataset commit.

Append mode:

```text
parent current dataset commit
  + new datasetPatch.genericImports[]
  -> new full dataset commit
```

Replace/refresh mode:

```text
parent current dataset commit
  - one active generic import
  + reviewed replacement generic import
  -> new full dataset commit
```

Parent commits are immutable. Duplicate committed import ids are rejected unless the operation is an explicit refresh replacing the target import.

Supplement mode:

```text
parent current dataset commit
  + reviewed supplemental generic import
  + relationship metadata pointing at existing experiment ids
  -> new full dataset commit
```

Supplement mode does not rewrite the target experiment. It links additional source-backed data to it.

## Chart State

- Chart interpretation returns a reviewable ChartSpec draft.
- Chart proposal endpoints persist reviewable chart proposal sets.
- Accepted proposals become durable chart specs through chart-spec APIs.
- Chart specs are validated against a project-owned dataset commit before persistence.
- Chart specs tied to older replaced dataset commits can be decorated as stale in API responses.
- Existing manuscript chart blocks should keep rendering from their stored chart spec snapshots.

## Frontend Direction

After login:

1. Load labs and projects.
2. Select or create a project.
3. Load `GET /api/projects/:projectId/state`.
4. Hydrate Overview, Experiment Browser, import review state, chart review state, chart specs, and manuscript canvas from server records.
5. Save edits through project-scoped APIs.
6. Reload project state after successful mutating operations.

Local IndexedDB can remain useful for logged-out experiments and development, but it is not a compatibility target for server-mode data.
