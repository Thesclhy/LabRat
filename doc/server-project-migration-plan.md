# Server Project State Plan

This document replaces the older local-project migration guidance. Current product direction is server-first for logged-in workspaces. Do not build compatibility migrations for old IndexedDB, `.labrat.json`, or previous local project shapes unless the user explicitly reopens that requirement.

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

Use `POST /api/projects` for the initial profile and `PATCH /api/projects/:projectId` for updates. Profile updates merge into existing project metadata and write `project.update` audit events.

## Scientific State

- Raw uploaded files are immutable `file_objects`.
- Import review and apply lifecycle is stored in `import_runs`.
- Accepted dataset states are immutable `dataset_commits`.
- Semantic review decisions are stored in `mapping_sets`.
- Chart review decisions are stored in `chart_proposal_sets`.
- Durable chart definitions are stored in `chart_specs`.
- Manuscript canvas state is stored in `manuscripts`.

Scientific data v0 remains JSONB-first inside commits/imports/review records. Do not split generic fields into relational experiment/measurement tables in this pass.

## Frontend Direction

After login:

1. Load labs and projects.
2. Select a project.
3. Load `GET /api/projects/:projectId/state`.
4. Hydrate the Experiment Browser, import review state, chart review state, and manuscript canvas from server records.
5. Save edits through project-scoped APIs instead of local project migrations.

Local IndexedDB can remain useful for development or logged-out experiments, but it is not a compatibility target for server-mode data.
