# Server Project State Plan

Status: contract
Read when: changing server project state, source-of-truth rules, or old local-data compatibility assumptions.
Last reviewed: 2026-07-20


This document defines the server source-of-truth model for logged-in LabRat workspaces. It replaces older local-project migration guidance. Do not build compatibility migrations for old IndexedDB, `.labrat.json`, or previous local project shapes unless the user explicitly reopens that requirement.

## Server Source Of Truth

A logged-in project is loaded from:

```text
GET /api/projects/:projectId/state
```

The response contains the project shell, editable project profile, evidence/review summaries, accepted DataPlan/DataSnapshot summaries, experiment snapshot heads, BrowserViews, and later output records:

```text
project
projectProfile
fileObjects
importRuns
sourceDocuments
workbookReviewSessions
workbookUnderstandings
dataPlans
dataSnapshots
experimentSnapshotHeads
browserViews
agentRuns
analysisThreads
chartProposalSets
chartSpecs
manuscripts
```

Full workbook grids, DataSnapshot point arrays, AnalysisPlanRevision selections/programs, and Browser rows do not belong in project state. Frontend server mode should use dedicated bounded range, analysis-thread/selection, experiment projection, and experiment detail endpoints for those payloads.

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
- Upload/scan lifecycle is stored in `import_runs`; active workflows do not normalize/apply import runs.
- Source evidence is stored in SourceDocuments and accepted interpretation in WorkbookUnderstandings.
- Accepted structured data is stored in immutable DataSnapshots produced by accepted DataPlans.
- One `experiment_snapshot_heads` row chooses the active accepted snapshot record for each stable experiment identity.
- Personal Browser display state is stored in `browser_views`.
- Reviewed analysis conversations and immutable calculation plans are stored in `analysis_threads` and `analysis_plan_revisions`; accepted plans create queued `analysis_runs`.
- Durable chart definitions are stored in `chart_specs`.
- Manuscript canvas state is stored in `manuscripts`.

Scientific record payloads remain JSONB-first inside DataPlans/DataSnapshots while stable experiment identity and active-head selection are relational.

## Publish To Browser

Upload and WorkbookUnderstanding confirmation never publish scientific data. After confirmation, the user reviews a transient experiment-record DataPlan/DataSnapshot preview and explicitly publishes it.

```text
accepted WorkbookUnderstanding
  -> transient DataPlan/DataSnapshot preview
  -> explicit identity and warning decisions
  -> transactional accepted DataPlan + DataSnapshot
  -> advance affected experiment snapshot heads
```

Publish re-reads source ranges, verifies dependency/preview hashes, and returns `preview_stale` before writes when evidence changed. Corrections create new immutable snapshots. There is no project-wide current dataset pointer.

## Chart State

- Chart interpretation resolves explicit SourceDocument evidence into a reviewable source extract/chart proposal.
- Accepted source-backed proposals become durable ChartSpecs through chart-spec APIs.
- ChartSpecs require immutable `sourceSnapshot.rows` or `sourceSnapshot.series` plus exact source refs.
- A later milestone will validate chart specs against accepted DataSnapshots.
- Existing manuscript chart blocks should keep rendering from their stored chart spec snapshots.

## Frontend Direction

After login:

1. Load labs and projects.
2. Select or create a project.
3. Load `GET /api/projects/:projectId/state`.
4. Hydrate Overview/review summaries from project state and query Experiment Browser through `GET /api/projects/:projectId/experiment-browser`.
5. Save edits through project-scoped APIs.
6. Reload the affected summary/projection after successful mutating operations.

Local IndexedDB can remain useful for logged-out experiments and development, but it is not a compatibility target for server-mode data.

## Retired State

The former project-wide dataset pointer, aggregate dataset records, mapping collections, and generic import/proposal collections have been removed. Do not add compatibility migrations, hydration fields, or dual-write logic for them.
