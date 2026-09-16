# Server Project State Plan

Status: contract
Read when: changing server project state, source-of-truth rules, or old local-data compatibility assumptions.
Last reviewed: 2026-08-23


This document defines the server source-of-truth model for logged-in LabRat workspaces. It replaces older local-project migration guidance. Do not build compatibility migrations for old IndexedDB, `.labrat.json`, or previous local project shapes unless the user explicitly reopens that requirement.

## Server Source Of Truth

A logged-in project is loaded from the project shell plus explicit v1 resource
reads:

```text
GET /api/v1/projects/:projectId
GET /api/v1/projects/:projectId/files
GET /api/v1/projects/:projectId/import-runs
GET /api/v1/projects/:projectId/source-documents
GET /api/v1/projects/:projectId/workbook-review-sessions
GET /api/v1/projects/:projectId/region-understandings
GET /api/v1/projects/:projectId/data-plans
GET /api/v1/projects/:projectId/data-snapshots
GET /api/v1/projects/:projectId/agent/runs
GET /api/v1/projects/:projectId/analysis-threads
GET /api/v1/projects/:projectId/chart-specs
GET /api/v1/projects/:projectId/manuscripts
GET /api/v1/projects/:projectId/browser-views
GET /api/v1/projects/:projectId/browser-config
GET /api/v1/projects/:projectId/experiment-browser?limit=1
```

The frontend composes these responses into a transient UI workspace object. It
is not a persisted domain object and there is no `/api/v1/.../state` endpoint.
The UI object contains the project shell, editable project profile,
evidence/review summaries, accepted DataPlan/DataSnapshot summaries, the
shared ProjectBrowserConfig, historical BrowserViews, and later output records:

```text
project
projectProfile
fileObjects
importRuns
sourceDocuments
workbookReviewSessions
workbookReviewRegions
regionUnderstandings
dataPlans
dataSnapshots
publishedExperimentCount
projectBrowserConfig
browserViews
agentRuns
analysisThreads
chartSpecs
manuscripts
```

`experimentSnapshotHeads` is no longer fabricated or hydrated into this UI
object; the scoped Experiment Browser count supplies the visible published
experiment count. A selected-experiment shell receives only the project shell
and its authorized Browser count, not project-wide resource lists.

Full workbook grids, DataSnapshot point arrays, materialized analysis inputs,
generated Python, full Plotly payloads, and Browser rows do not belong in the
transient workspace object. Frontend server mode uses bounded range,
analysis-thread/source-selection, ChartSpec detail, experiment projection, and
experiment detail endpoints for those payloads. Cursor-based ChartSpec and
Manuscript summary pages are followed to completion; AgentRun and
AnalysisThread history stays intentionally bounded to the newest 100 entries.

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

Use `POST /api/v1/projects` for the initial profile and
`PATCH /api/v1/projects/:projectId/profile` for profile-only updates. Profile
updates merge into existing project metadata and write `project.update` audit
events.

## Scientific State

- Raw uploaded files are immutable `file_objects`.
- Upload/scan lifecycle is stored in `import_runs`; active workflows do not normalize/apply import runs.
- Source evidence is stored in SourceDocuments; accepted interpretation is stored as exact RegionUnderstandingRevisions selected by active WorkbookReviewRegions.
- Accepted structured data is stored in immutable DataSnapshots. Historical
  snapshots may reference accepted DataPlans; current Browser writes are
  published from an accepted AnalysisResult after plan and result review.
- One `experiment_snapshot_heads` row chooses the active accepted snapshot record for each stable experiment identity.
- Live Experiment Browser display state is shared project-wide in
  `project_browser_configs`; historical owner-scoped `browser_views` remain for
  publication provenance and older clients.
- Reviewed analysis conversations and immutable calculation plans are stored in `analysis_threads` and `analysis_plan_revisions`; accepted plans create queued `analysis_runs`.
- Durable chart definitions are stored in `chart_specs`.
- Manuscript canvas state is stored in `manuscripts`.

Scientific record payloads remain JSONB-first inside DataPlans/DataSnapshots while stable experiment identity and active-head selection are relational.

## Publish To Browser

Upload and region-revision confirmation never publish scientific data. After
one or more exact region revisions are confirmed, the user reviews an
AnalysisPlanRevision, executes its accepted inputs, reviews the validated
Experiment Browser result, and explicitly publishes it.

```text
accepted RegionUnderstandingRevisions
  -> reviewed AnalysisPlanRevision
  -> accepted AnalysisRun and validated AnalysisResult
  -> explicit identity and warning decisions
  -> transactional accepted AnalysisResult + DataSnapshot
  -> advance affected experiment snapshot heads
```

Publish re-resolves accepted evidence and frozen snapshot heads, verifies the
reviewed result and idempotency receipt, and refuses stale inputs before writes.
Corrections create new immutable snapshots. There is no project-wide current
dataset pointer.

## Chart State

- All chart requests create a reviewed analysis plan over confirmed regions and/or accepted active snapshot records.
- Accepted plan execution produces an immutable validated AnalysisResult; explicit result acceptance atomically creates an `origin: analysis_result` ChartSpec with confirmed-region and/or accepted snapshot refs, complete validated traces, hashes, and lineage.
- Existing manuscript chart blocks should keep rendering from their stored chart spec snapshots.

## Frontend Direction

After login:

1. Load labs and projects.
2. Select or create a project.
3. Load the project shell, then compose Overview/review summaries from the
   explicit `/api/v1/projects/:projectId/...` resource endpoints above.
4. Query Experiment Browser through
   `GET /api/v1/projects/:projectId/experiment-browser`.
5. Save edits through project-scoped APIs.
6. Reload the affected summary/projection after successful mutating operations.

Local IndexedDB can remain useful for logged-out experiments and development, but it is not a compatibility target for server-mode data.

## Retired State

The former project-state aggregate, project-wide dataset pointer, aggregate
dataset records, mapping collections, generic import/proposal collections,
SourceExtractProposal, and ChartProposalSet are absent from v1. Do not add
compatibility migrations, hydration fields, or dual-write logic for them. The
unversioned project-state route exists only in the rollback implementation.
